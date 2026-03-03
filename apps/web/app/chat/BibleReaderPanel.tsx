"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type BiblePassageResponse = {
  ok?: boolean;
  ref?: string;
  translation?: string;
  text?: string;
  verses?: Array<{ book?: string | null; chapter?: number | null; verse?: number | null; text?: string }>;
  error?: string;
  detail?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? (json as any)?.detail ?? `Request failed (${res.status})`);
  return json;
}

function normalizeRef(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

export function BibleReaderPanel(props: { identity: Identity; initialRef?: string | null; onClose: () => void }) {
  const identity = props.identity;
  const [ref, setRef] = useState<string>(() => normalizeRef(props.initialRef || "Ephesians 2:8-9"));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<BiblePassageResponse | null>(null);

  const normalizedRef = useMemo(() => normalizeRef(ref), [ref]);
  const bibleGatewayUrl = useMemo(() => {
    const q = encodeURIComponent(normalizedRef || "");
    return `https://www.biblegateway.com/passage/?search=${q}&version=NIV`;
  }, [normalizedRef]);

  async function load(nextRef: string) {
    const r = normalizeRef(nextRef);
    if (!r) return;
    setLoading(true);
    setErr("");
    try {
      const out = await postJson<BiblePassageResponse>("/api/a2a/bible/passage", {
        identity,
        ref: r,
        translation: "web",
      });
      if ((out as any)?.ok === false) throw new Error(String((out as any)?.error ?? "Failed to load passage"));
      setData(out);
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Failed to load passage"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Reload when the active ref changes (e.g., clicked from chat).
  useEffect(() => {
    setRef(normalizeRef(props.initialRef || ref));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialRef]);

  useEffect(() => {
    void load(normalizedRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id, normalizedRef]);

  const verses = Array.isArray(data?.verses) ? data!.verses! : [];
  const displayRef = String(data?.ref || normalizedRef || "").trim();
  const text = String(data?.text || "").trim();

  const btn: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "white",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "white" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900 }}>Bible</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            In-panel text: WEB (public domain) • Open NIV in a new tab
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href={bibleGatewayUrl} target="_blank" rel="noopener noreferrer" style={btn}>
            Open NIV
          </Link>
          <button type="button" onClick={props.onClose} style={btn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: 12, background: "#f8fafc", display: "grid", gap: 12, alignContent: "start" }}>
        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Passage</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. Ephesians 2:8-9"
              style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", fontWeight: 700 }}
            />
            <button type="button" onClick={() => void load(ref)} style={btn} disabled={loading}>
              {loading ? "Loading…" : "Go"}
            </button>
          </div>
          {err ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{err}</div> : null}
          {displayRef ? <div style={{ fontSize: 12, color: "#64748b" }}>Showing: {displayRef}</div> : null}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Text</div>
          {text ? (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: "#0f172a" }}>{text}</pre>
          ) : verses.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {verses.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <div style={{ minWidth: 28, fontSize: 12, color: "#64748b", fontWeight: 900 }}>{v.verse ?? ""}</div>
                  <div style={{ fontSize: 14, color: "#0f172a", lineHeight: 1.55 }}>{String(v.text ?? "").trim()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>{loading ? "Loading…" : "No text available."}</div>
          )}
        </section>
      </div>
    </div>
  );
}

