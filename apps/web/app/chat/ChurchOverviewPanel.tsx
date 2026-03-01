"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : ({} as any);
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return data;
}

function Link(props: { href: string; children: React.ReactNode }) {
  return (
    <a href={props.href} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
      {props.children}
    </a>
  );
}

type Campus = { id: string; name: string; address_line1?: string | null; city?: string | null; region?: string | null; postal_code?: string | null };
type Service = { id: string; campus_id?: string | null; name: string; day_of_week: number; start_time_local: string; timezone?: string | null; location_address?: string | null };
type StrategicSummary = Record<string, { title?: string; bodyMarkdown?: string }>;

export function ChurchOverviewPanel(props: { identity: Identity; onClose: () => void; onOpenTool?: (toolId: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<any>("/api/a2a/church/get_overview", { identity: props.identity });
      setData(out ?? null);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.identity.tenant_id]);

  const church = data?.church ?? null;
  const branding = data?.branding ?? null;
  const campuses: Campus[] = Array.isArray(data?.campuses) ? data.campuses : [];
  const strategic: StrategicSummary = (data?.strategic_intent_summary && typeof data.strategic_intent_summary === "object" ? data.strategic_intent_summary : {}) as any;

  const servicesByCampus = useMemo(() => {
    const services: Service[] = Array.isArray(data?.services) ? data.services : [];
    const m = new Map<string, Service[]>();
    for (const s of services) {
      const k = String(s.campus_id || "unknown");
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [data]);

  return (
    <div style={{ background: "white", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Church</div>
        <button
          onClick={props.onClose}
          style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div style={{ padding: 14, overflow: "auto", minHeight: 0, display: "grid", gap: 12 }}>
        {loading ? <div style={{ color: "#64748b", fontSize: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}

        {!loading && !error ? (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {branding?.logo_url ? (
                <img src={String(branding.logo_url)} alt="Church logo" style={{ height: 44, width: "auto", objectFit: "contain" }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "#0f172a", color: "white", display: "grid", placeItems: "center", fontWeight: 900 }}>
                  {String(church?.name || "C").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{church?.name ?? "Unknown church"}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {church?.website ? <Link href={String(church.website)}>{String(church.website)}</Link> : null}
                </div>
              </div>
            </div>

            {branding?.overview_markdown ? (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                {String(branding.overview_markdown)}
              </div>
            ) : null}

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 900, fontSize: 12 }}>Campuses & services</div>
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                {campuses.map((c) => {
                  const list = servicesByCampus.get(String(c.id)) ?? [];
                  return (
                    <div key={c.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 900 }}>{c.name}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
                        {[c.address_line1, c.city, c.region, c.postal_code].filter(Boolean).join(" ")}
                      </div>
                      {list.length ? (
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {list.map((s) => (
                            <div key={s.id} style={{ fontSize: 13 }}>
                              <span style={{ fontWeight: 800 }}>{s.start_time_local}</span> <span style={{ color: "#64748b" }}>{s.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>No service times loaded.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 900, fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>Strategic intent (summary)</div>
                <button
                  onClick={() => props.onOpenTool?.("strategic_intent")}
                  style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                >
                  Open strategic intent
                </button>
              </div>
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                {["purpose", "vision", "mission", "strategy"].map((k) => {
                  const it: any = (strategic as any)[k] ?? null;
                  if (!it) return null;
                  const label = k.charAt(0).toUpperCase() + k.slice(1);
                  return (
                    <div key={k} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 900 }}>{label}</div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{String(it.title || "")}</div>
                    </div>
                  );
                })}
                <div style={{ fontSize: 12, color: "#64748b" }}>Open the full view to see all entries (Calvary + ChurchCore initiative) and the full text.</div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

