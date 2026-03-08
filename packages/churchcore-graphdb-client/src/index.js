const DEFAULT_TIMEOUT_MS = 60_000;

function mustGetEnv(env, key) {
  const v = env?.[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(s) {
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
}

export function graphdbConfigFromEnv(env) {
  return {
    baseUrl: (env?.GRAPHDB_BASE_URL || '').replace(/\/+$/, ''),
    repository: env?.GRAPHDB_REPOSITORY || '',
    username: env?.GRAPHDB_USERNAME || '',
    password: env?.GRAPHDB_PASSWORD || '',
    cfAccessClientId: env?.GRAPHDB_CF_ACCESS_CLIENT_ID || '',
    cfAccessClientSecret: env?.GRAPHDB_CF_ACCESS_CLIENT_SECRET || '',
  };
}

export class GraphDbClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.repository
   * @param {string=} opts.username
   * @param {string=} opts.password
   * @param {string=} opts.cfAccessClientId
   * @param {string=} opts.cfAccessClientSecret
   * @param {number=} opts.timeoutMs
   * @param {number=} opts.maxRetries
   */
  constructor(opts) {
    if (!opts?.baseUrl) throw new Error('GraphDbClient requires baseUrl');
    this.baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
    this.repository = String(opts.repository || '');
    this.username = opts.username ? String(opts.username) : '';
    this.password = opts.password ? String(opts.password) : '';
    this.cfAccessClientId = opts.cfAccessClientId ? String(opts.cfAccessClientId) : '';
    this.cfAccessClientSecret = opts.cfAccessClientSecret ? String(opts.cfAccessClientSecret) : '';
    this.timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 4;
  }

  static fromEnv(env) {
    const cfg = graphdbConfigFromEnv(env);
    return new GraphDbClient({
      baseUrl: mustGetEnv(cfg, 'baseUrl'),
      repository: mustGetEnv(cfg, 'repository'),
      username: cfg.username || '',
      password: cfg.password || '',
      cfAccessClientId: cfg.cfAccessClientId || '',
      cfAccessClientSecret: cfg.cfAccessClientSecret || '',
    });
  }

  buildHeaders(extra = {}) {
    /** @type {Record<string, string>} */
    const h = { ...extra };
    if (this.username && this.password) {
      const token = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
      h.Authorization = `Basic ${token}`;
    }
    if (this.cfAccessClientId && this.cfAccessClientSecret) {
      h['CF-Access-Client-Id'] = this.cfAccessClientId;
      h['CF-Access-Client-Secret'] = this.cfAccessClientSecret;
    }
    return h;
  }

  async fetchWithRetry(url, init) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok && isRetryableStatus(res.status) && attempt < this.maxRetries) {
          attempt++;
          const backoff = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
          await sleep(backoff);
          continue;
        }
        return res;
      } catch (e) {
        if (attempt < this.maxRetries) {
          attempt++;
          const backoff = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
          await sleep(backoff);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  repoUrl(pathname) {
    if (!this.repository) throw new Error('GraphDbClient repository not configured');
    return `${this.baseUrl}/repositories/${encodeURIComponent(this.repository)}${pathname}`;
  }

  statementsUrl(query = '') {
    if (!this.repository) throw new Error('GraphDbClient repository not configured');
    return `${this.baseUrl}/repositories/${encodeURIComponent(this.repository)}/statements${query}`;
  }

  async sparqlQuery(query, { accept = 'application/sparql-results+json' } = {}) {
    const url = this.repoUrl('');
    const body = new URLSearchParams({ query });
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders({
        accept,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      }),
      body,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`GraphDB SPARQL query failed (${res.status}): ${text.slice(0, 1000)}`);
    if (accept.includes('json')) return JSON.parse(text);
    return text;
  }

  async sparqlUpdate(update) {
    const url = this.statementsUrl('');
    const body = new URLSearchParams({ update });
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders({
        accept: 'text/plain',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      }),
      body,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`GraphDB SPARQL update failed (${res.status}): ${text.slice(0, 1000)}`);
    return true;
  }

  async clearGraph(contextIri) {
    const update = `CLEAR GRAPH <${contextIri}>`;
    return this.sparqlUpdate(update);
  }

  async uploadTurtleToGraph(turtle, { contextIri } = {}) {
    const q = contextIri ? `?context=${encodeURIComponent(`<${contextIri}>`)}` : '';
    const url = this.statementsUrl(q);
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders({
        accept: 'text/plain',
        'content-type': 'text/turtle;charset=UTF-8',
      }),
      body: turtle,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`GraphDB upload failed (${res.status}): ${text.slice(0, 1000)}`);
    return true;
  }
}

