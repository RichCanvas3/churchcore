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

function mdToText(md: string) {
  // D1 seed content often contains double-escaped newlines ("\\n").
  const normalized = String(md || "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");

  return normalized
    .replace(/\r/g, "")
    .replace(/^> /gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_`]/g, "")
    .trim();
}

function Linkified(props: { text: string }) {
  const text = String(props.text || "");
  const re = /https?:\/\/[^\s)]+/g;
  const parts: Array<{ kind: "text"; value: string } | { kind: "url"; url: string }> = [];
  let last = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    const idx = m.index;
    if (idx > last) parts.push({ kind: "text", value: text.slice(last, idx) });
    parts.push({ kind: "url", url: String(m[0]) });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  if (parts.length <= 1) return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.value}</span>;
        return (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
            {p.url}
          </a>
        );
      })}
    </span>
  );
}

type Intent = {
  id: string;
  intentType: string;
  title: string;
  bodyMarkdown: string;
  sortOrder: number;
  sourceUrl?: string | null;
  updatedAt?: string | null;
};

export function StrategicIntentPanel(props: { identity: Identity; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<{ intents?: Intent[] }>("/api/a2a/church/strategic_intent/list", {
        identity: props.identity,
      });
      setIntents(Array.isArray(out?.intents) ? out.intents : []);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.identity.tenant_id, props.identity.user_id]);

  const grouped = useMemo(() => {
    const g = new Map<string, Intent[]>();
    for (const it of intents) {
      const k = String(it.intentType || "other");
      g.set(k, [...(g.get(k) ?? []), it]);
    }
    const order = ["purpose", "vision", "mission", "strategy", "value", "belief", "aim", "goal", "objective", "other"];
    const keys = [...g.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });
    return { g, keys };
  }, [intents]);

  return (
    <div style={{ background: "white", minHeight: 0 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          padding: 14,
          borderBottom: "1px solid #e2e8f0",
          background: "white",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 14 }}>Congregation Strategic Intent</div>
        <button
          onClick={props.onClose}
          style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {loading ? <div style={{ color: "#64748b", fontSize: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}

        {!loading && !error && !intents.length ? <div style={{ color: "#64748b" }}>No strategic intent records yet.</div> : null}

        {grouped.keys.map((k) => {
          const items = grouped.g.get(k) ?? [];
          const title = k.charAt(0).toUpperCase() + k.slice(1);
          const itemsSorted = [...items].sort((a, b) => {
            const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
            const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
            return ao - bo || String(a.title || "").localeCompare(String(b.title || ""));
          });
          return (
            <div key={k} style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 900, fontSize: 12 }}>{title}</div>
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                {itemsSorted.map((it) => {
                  const showItemTitle = String(it.title || "").trim().toLowerCase() !== title.trim().toLowerCase();
                  return (
                  <div key={it.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 900 }}>{showItemTitle ? it.title : null}</div>
                      {it.sourceUrl ? (
                        <a href={String(it.sourceUrl)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
                          Source
                        </a>
                      ) : null}
                    </div>
                    <div style={{ marginTop: showItemTitle ? 8 : 0, fontSize: 13, lineHeight: 1.45, color: "#0f172a" }}>
                      <Linkified text={mdToText(it.bodyMarkdown)} />
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

