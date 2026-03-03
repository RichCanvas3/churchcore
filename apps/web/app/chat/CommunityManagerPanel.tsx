"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role?: string | null;
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type CatalogItem = {
  id: string;
  campusId?: string | null;
  kind: string;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  signupUrl?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: number | boolean | null;
};

type CommunityCatalogListResponse = { ok?: boolean; items?: CatalogItem[]; error?: string };

type MyItem = {
  communityId: string;
  status: string;
  role: string;
  updatedAt?: string | null;
  campusId?: string | null;
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
  signupUrl?: string | null;
};

type CommunityMyListResponse = { ok?: boolean; person_id?: string | null; items?: MyItem[]; error?: string };

type JourneyGetStateResponse = {
  ok?: boolean;
  current_stage?: { id: string; title: string; summary?: string | null } | null;
  current_stage_entities?: any[];
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json as T;
}

function kindLabel(kind: string) {
  const k = String(kind || "");
  if (k === "lifegroup") return "LifeGroup";
  if (k === "class") return "Class";
  if (k === "ministry") return "Ministry";
  if (k === "outreach_local") return "Local outreach";
  if (k === "outreach_global") return "Global outreach";
  if (k === "trip") return "Trip";
  if (k === "serving_team") return "Serving team";
  if (k === "bible_study") return "Bible study";
  return k || "Other";
}

function safeUrl(u: unknown) {
  const s = typeof u === "string" ? u.trim() : "";
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s;
}

export function CommunityManagerPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [mine, setMine] = useState<MyItem[]>([]);
  const [stage, setStage] = useState<JourneyGetStateResponse | null>(null);

  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const mineById = useMemo(() => {
    const m = new Map<string, MyItem>();
    for (const it of mine) {
      const id = String(it?.communityId ?? "").trim();
      if (id) m.set(id, it);
    }
    return m;
  }, [mine]);

  const recommended = useMemo(() => {
    const entities = Array.isArray((stage as any)?.current_stage_entities) ? ((stage as any).current_stage_entities as any[]) : [];
    const comm = entities.filter((e) => e && e.type === "community" && e.community);
    return comm.map((e) => ({
      id: String(e.community?.id ?? ""),
      kind: String(e.community?.kind ?? ""),
      title: String(e.community?.title ?? ""),
      description: e.community?.description ?? null,
      sourceUrl: e.community?.source_url ?? e.community?.sourceUrl ?? null,
      signupUrl: e.community?.signup_url ?? e.community?.signupUrl ?? null,
    }));
  }, [stage]);

  const btn = useMemo(
    () => ({
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "white",
      borderRadius: 10,
      padding: "8px 12px",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 600,
    }),
    [],
  );

  const secondaryBtn = useMemo(() => ({ ...btn, background: "#64748b", borderColor: "#64748b" }), [btn]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [s, my, cat] = await Promise.all([
        postJson<JourneyGetStateResponse>("/api/a2a/journey/get_state", { identity }),
        postJson<CommunityMyListResponse>("/api/a2a/community/my/list", { identity }),
        postJson<CommunityCatalogListResponse>("/api/a2a/community/catalog/list", {
          identity,
          campus_id: identity.campus_id ?? null,
          kind: kind || null,
          search: q.trim() || null,
          include_inactive: false,
          limit: 200,
        }),
      ]);
      if ((s as any)?.ok === false) throw new Error(String((s as any)?.error ?? "Failed to load stage"));
      if ((my as any)?.ok === false) throw new Error(String((my as any)?.error ?? "Failed to load your communities"));
      if ((cat as any)?.ok === false) throw new Error(String((cat as any)?.error ?? "Failed to load catalog"));

      setStage(s);
      setMine(Array.isArray(my.items) ? my.items : []);
      setCatalog(Array.isArray(cat.items) ? cat.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load community");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCatalog([]);
    setMine([]);
    setStage(null);
    setError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

  async function join(communityId: string) {
    setMutating(true);
    setError(null);
    try {
      await postJson("/api/a2a/community/join", { identity, community_id: communityId, status: "active" });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setMutating(false);
    }
  }

  async function leave(communityId: string) {
    setMutating(true);
    setError(null);
    try {
      await postJson("/api/a2a/community/leave", { identity, community_id: communityId });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Leave failed");
    } finally {
      setMutating(false);
    }
  }

  async function mark(communityId: string, status: "attended" | "completed") {
    setMutating(true);
    setError(null);
    try {
      await postJson("/api/a2a/community/mark", { identity, community_id: communityId, status });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setMutating(false);
    }
  }

  function Card(props: {
    item: { id: string; kind: string; title: string; description?: string | null; sourceUrl?: string | null; signupUrl?: string | null };
    status?: string | null;
  }) {
    const id = props.item.id;
    const status = props.status ? String(props.status) : "";
    const isActive = status && status !== "inactive";
    const canJoin = !isActive;
    const canLeave = isActive;
    const signup = safeUrl(props.item.signupUrl);
    const source = safeUrl(props.item.sourceUrl);

    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "white", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontWeight: 900, color: "#0f172a" }}>{props.item.title}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{kindLabel(props.item.kind)}</div>
        </div>
        {props.item.description ? <div style={{ fontSize: 12, color: "#64748b" }}>{props.item.description}</div> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {status ? <span style={{ fontSize: 12, color: "#334155" }}>Status: <strong>{status}</strong></span> : null}
          {canJoin ? (
            <button type="button" disabled={mutating || !id} onClick={() => void join(id)} style={btn}>
              Join
            </button>
          ) : null}
          {canLeave ? (
            <button type="button" disabled={mutating || !id} onClick={() => void leave(id)} style={secondaryBtn}>
              Leave
            </button>
          ) : null}
          {isActive ? (
            <>
              <button type="button" disabled={mutating || !id} onClick={() => void mark(id, "attended")} style={secondaryBtn}>
                Mark attended
              </button>
              <button type="button" disabled={mutating || !id} onClick={() => void mark(id, "completed")} style={secondaryBtn}>
                Mark completed
              </button>
            </>
          ) : null}
          {signup ? (
            <a href={signup} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
              Sign up
            </a>
          ) : null}
          {source ? (
            <a href={source} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
              Source
            </a>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{id}</div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Community</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Stage: <strong>{stage?.current_stage?.title ?? "Unknown"}</strong>
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={secondaryBtn}>
            Refresh
          </button>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", minHeight: 0, display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
        {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : null}

        {recommended.length ? (
          <section style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Recommended for your stage</div>
            {recommended.map((it) => (
              <Card key={`rec:${it.id}`} item={it} status={mineById.get(it.id)?.status ?? null} />
            ))}
          </section>
        ) : null}

        <section style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>My communities</div>
          {mine.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {mine.map((m) => (
                <Card
                  key={`my:${m.communityId}`}
                  item={{
                    id: String(m.communityId),
                    kind: String(m.kind ?? ""),
                    title: String(m.title ?? "Community"),
                    description: m.description ?? null,
                    sourceUrl: m.sourceUrl ?? null,
                    signupUrl: m.signupUrl ?? null,
                  }}
                  status={String(m.status ?? "")}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>You’re not part of any communities yet.</div>
          )}
        </section>

        <section style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Explore</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search (LifeGroups, outreach, missions...)"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}>
              <option value="">All kinds</option>
              <option value="lifegroup">LifeGroups</option>
              <option value="class">Classes</option>
              <option value="serving_team">Serving teams</option>
              <option value="outreach_local">Local outreach</option>
              <option value="outreach_global">Global outreach</option>
              <option value="trip">Trips</option>
              <option value="ministry">Ministry</option>
              <option value="bible_study">Bible study</option>
              <option value="other">Other</option>
            </select>
          </div>
          <button type="button" disabled={loading} onClick={() => void refresh()} style={btn}>
            Search
          </button>

          {catalog.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {catalog.map((it) => (
                <Card
                  key={`cat:${it.id}`}
                  item={{
                    id: String(it.id),
                    kind: String(it.kind ?? ""),
                    title: String(it.title ?? ""),
                    description: it.description ?? null,
                    sourceUrl: it.sourceUrl ?? null,
                    signupUrl: it.signupUrl ?? null,
                  }}
                  status={mineById.get(String(it.id))?.status ?? null}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No results.</div>
          )}
        </section>
      </div>
    </div>
  );
}

