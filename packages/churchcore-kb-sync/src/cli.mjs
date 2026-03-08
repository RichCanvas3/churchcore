import fs from 'node:fs';
import path from 'node:path';
import { GraphDbClient } from '@churchcore/graphdb-client';

function usage() {
  // eslint-disable-next-line no-console
  console.log(`churchcore-kb-sync

One-time full rebuild sync: D1(SQLite) -> GraphDB.

Usage:
  churchcore-kb-sync --sqlite /path/to/churchcore.sqlite --church-id demo_church --context-base https://id.churchcore.ai/graph/d1

Env (GraphDB):
  GRAPHDB_BASE_URL, GRAPHDB_REPOSITORY, GRAPHDB_USERNAME, GRAPHDB_PASSWORD
  Optional: GRAPHDB_CF_ACCESS_CLIENT_ID, GRAPHDB_CF_ACCESS_CLIENT_SECRET
`);
}

function argValue(argv, key) {
  const idx = argv.indexOf(key);
  if (idx === -1) return null;
  return argv[idx + 1] || null;
}

function requiredArg(argv, key) {
  const v = argValue(argv, key);
  if (!v) throw new Error(`Missing arg: ${key}`);
  return v;
}

function iriEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=-]/g, (m) =>
    encodeURIComponent(m),
  );
}

function idIri(base, table, id) {
  return `${base}/${table}/${encodeURIComponent(String(id))}`;
}

function litString(s) {
  const v = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${v}"`;
}

function litDateTimeIso(s) {
  return `"${String(s)}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
}

function ttlPrefixBlock() {
  return [
    '@prefix cc: <https://ontology.churchcore.ai/cc#> .',
    '@prefix prov: <http://www.w3.org/ns/prov#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
  ].join('\n');
}

function* mapChurches(db, { idBase }) {
  const rows = db.prepare('select church_id, name from churches').all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'church', r.church_id)}>`;
    yield `${subj} a cc:Church ; cc:name ${litString(r.name || r.church_id)} .`;
  }
}

function* mapCampuses(db, { idBase }) {
  const rows = db.prepare('select campus_id, church_id, name from campuses').all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'campus', r.campus_id)}>`;
    const church = r.church_id ? `<${idIri(idBase, 'church', r.church_id)}>` : null;
    const parts = [`${subj} a cc:Campus`];
    if (r.name) parts.push(`cc:name ${litString(r.name)}`);
    if (church) parts.push(`prov:actedOnBehalfOf ${church}`);
    yield `${parts.join(' ; ')} .`;
  }
}

function* mapPeople(db, { idBase }) {
  const rows = db.prepare('select person_id, first_name, last_name, email, phone from people').all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'person', r.person_id)}>`;
    const parts = [`${subj} a cc:Person`];
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
    if (name) parts.push(`cc:name ${litString(name)}`);
    if (r.email) parts.push(`cc:description ${litString(`email:${r.email}`)}`);
    if (r.phone) parts.push(`cc:description ${litString(`phone:${r.phone}`)}`);
    yield `${parts.join(' ; ')} .`;
  }
}

function* mapHouseholds(db, { idBase }) {
  const rows = db.prepare('select household_id, name from households').all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'household', r.household_id)}>`;
    const parts = [`${subj} a cc:Resource`];
    if (r.name) parts.push(`cc:name ${litString(r.name)}`);
    yield `${parts.join(' ; ')} .`;
  }
}

function* mapGroups(db, { idBase }) {
  const rows = db
    .prepare(
      'select group_id, name, description, meeting_frequency, meeting_day_of_week, meeting_time_local, meeting_timezone, meeting_location_name, meeting_location_address from groups',
    )
    .all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'group', r.group_id)}>`;
    const parts = [`${subj} a cc:Resource`];
    if (r.name) parts.push(`cc:name ${litString(r.name)}`);
    if (r.description) parts.push(`cc:description ${litString(r.description)}`);
    if (r.meeting_frequency) parts.push(`cc:description ${litString(`meeting_frequency:${r.meeting_frequency}`)}`);
    if (r.meeting_day_of_week != null)
      parts.push(`cc:description ${litString(`meeting_day_of_week:${r.meeting_day_of_week}`)}`);
    if (r.meeting_time_local) parts.push(`cc:description ${litString(`meeting_time_local:${r.meeting_time_local}`)}`);
    if (r.meeting_timezone) parts.push(`cc:description ${litString(`meeting_timezone:${r.meeting_timezone}`)}`);
    if (r.meeting_location_name) parts.push(`cc:description ${litString(`meeting_location_name:${r.meeting_location_name}`)}`);
    if (r.meeting_location_address)
      parts.push(`cc:description ${litString(`meeting_location_address:${r.meeting_location_address}`)}`);
    yield `${parts.join(' ; ')} .`;
  }
}

function* mapGroupMemberships(db, { idBase }) {
  const rows = db.prepare('select group_id, person_id, role, status, created_at from group_memberships').all();
  for (const r of rows) {
    const subj = `<${idIri(idBase, 'group_membership', `${r.group_id}:${r.person_id}`)}>`;
    const group = `<${idIri(idBase, 'group', r.group_id)}>`;
    const person = `<${idIri(idBase, 'person', r.person_id)}>`;
    const parts = [
      `${subj} a prov:Association`,
      `prov:agent ${person}`,
      `prov:hadPlan ${group}`,
    ];
    if (r.role) parts.push(`cc:description ${litString(`role:${r.role}`)}`);
    if (r.status) parts.push(`cc:description ${litString(`status:${r.status}`)}`);
    if (r.created_at) parts.push(`prov:generatedAtTime ${litDateTimeIso(r.created_at)}`);
    yield `${parts.join(' ; ')} .`;
  }
}

function buildTurtle(db, opts) {
  const lines = [ttlPrefixBlock()];
  const mappers = [
    mapChurches,
    mapCampuses,
    mapPeople,
    mapHouseholds,
    mapGroups,
    mapGroupMemberships,
  ];
  for (const fn of mappers) {
    for (const t of fn(db, opts)) lines.push(t);
    lines.push('');
  }
  return lines.join('\n');
}

async function uploadOntologies(client, { contextIri }) {
  // Upload “upper ontologies” + local ontology into their own contexts (keeps instance graph cleaner).
  // For now we just rely on these being in the repo; the operator can also load them via GraphDB UI.
  const pkgs = [
    { name: 'agentictrust-ontology', dir: '../agentictrust-ontology/ontology' },
    { name: 'churchcore-ontology', dir: '../churchcore-ontology/ontology' },
    { name: 'churchcore-local-ontology', dir: '../churchcore-local-ontology/ontology' },
  ];

  for (const p of pkgs) {
    const abs = path.resolve(new URL(import.meta.url).pathname, '..', p.dir);
    if (!fs.existsSync(abs)) continue;
    const files = fs.readdirSync(abs).filter((f) => f.endsWith('.ttl'));
    for (const f of files) {
      const ttl = fs.readFileSync(path.join(abs, f), 'utf8');
      // Same context for ontologies for now; easy to split later.
      // eslint-disable-next-line no-await-in-loop
      await client.uploadTurtleToGraph(ttl, { contextIri: `${contextIri}/ontology` });
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const sqlitePath = requiredArg(argv, '--sqlite');
  const churchId = requiredArg(argv, '--church-id');
  const contextBase = requiredArg(argv, '--context-base'); // e.g. https://id.churchcore.ai/graph/d1
  const idBase = argValue(argv, '--id-base') || 'https://id.churchcore.ai';

  const contextIri = `${contextBase.replace(/\/+$/, '')}/${encodeURIComponent(churchId)}`;

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  const client = GraphDbClient.fromEnv(process.env);

  // Clear instance graph and re-upload.
  // eslint-disable-next-line no-console
  console.log(`[kb-sync] clearing graph ${contextIri}`);
  await client.clearGraph(contextIri);

  // eslint-disable-next-line no-console
  console.log(`[kb-sync] uploading ontologies -> ${contextIri}/ontology`);
  await uploadOntologies(client, { contextIri });

  const turtle = buildTurtle(db, { idBase: `${idBase.replace(/\/+$/, '')}` });
  // eslint-disable-next-line no-console
  console.log(`[kb-sync] uploading instance ttl (${turtle.length} bytes) -> ${contextIri}`);
  await client.uploadTurtleToGraph(turtle, { contextIri });

  // eslint-disable-next-line no-console
  console.log(`[kb-sync] done`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[kb-sync] failed', e);
  process.exitCode = 1;
});

