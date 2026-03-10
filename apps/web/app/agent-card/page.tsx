"use client";

import { useEffect, useState } from "react";

export default function AgentCardPage() {
  const [out, setOut] = useState<{ ok: boolean; status: number; json: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(Boolean(mq.matches));
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent-card", { cache: "no-store" })
      .then(async (res) => {
        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
        if (!cancelled) setOut({ ok: res.ok, status: res.status, json });
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message ?? e ?? "Failed to load"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#f8fafc" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? 12 : 16, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Agent card</div>
          {out ? (
            <div style={{ fontSize: 12, color: out.ok ? "#16a34a" : "#b91c1c", fontWeight: 800 }}>
              {out.ok ? "OK" : "Error"} ({out.status})
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{err ? "Error" : "Loading…"}</div>
          )}
        </div>

        <div style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
            `/.well-known/agent-card.json`
          </div>
          <pre style={{ margin: 0, padding: 12, fontSize: isMobile ? 11 : 12, lineHeight: 1.45, overflow: "auto" }}>
            {err ? err : JSON.stringify(out?.json ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

