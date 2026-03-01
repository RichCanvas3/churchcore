"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoIdentity } from "./DemoIdentityProvider";

type Person = { first_name?: string | null; last_name?: string | null; id?: string | null } | null;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
  return json;
}

export function AppHeader(props: { height?: number }) {
  const h = props.height ?? 56;

  const { identity, accounts, setIdentity } = useDemoIdentity();

  const [person, setPerson] = useState<Person>(null);

  useEffect(() => {
    postJson<{ person?: any }>("/api/a2a/thread/list", { identity, include_archived: false })
      .then((out) => setPerson((out?.person ?? null) as any))
      .catch(() => {});
  }, [identity]);

  const label = useMemo(() => {
    const first = typeof (person as any)?.first_name === "string" ? String((person as any).first_name) : "";
    const last = typeof (person as any)?.last_name === "string" ? String((person as any).last_name) : "";
    const full = `${first} ${last}`.trim();
    return full || "Noah Seeker";
  }, [person]);

  return (
    <div
      style={{
        height: h,
        borderBottom: "1px solid #e2e8f0",
        background: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 900 }}>Church Agent</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>A2A + LangGraph</div>
      </div>

      <details>
        <summary style={{ cursor: "pointer", listStyle: "none", fontWeight: 800 }}>
          {label} <span style={{ color: "#64748b", fontWeight: 600, fontSize: 12 }}>({identity.role})</span>
        </summary>
        <div
          style={{
            position: "absolute",
            right: 14,
            marginTop: 10,
            width: 240,
            border: "1px solid #e2e8f0",
            background: "white",
            borderRadius: 12,
            padding: 10,
            display: "grid",
            gap: 10,
          }}
        >
          <a href="/chat" style={{ fontSize: 14 }}>
            Chat
          </a>
          <a href="/checkin" style={{ fontSize: 14 }}>
            Kids check-in
          </a>
          <a href="/guide" style={{ fontSize: 14 }}>
            Guide
          </a>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Switch account</div>
            <div style={{ display: "grid", gap: 6 }}>
              {accounts.map((a) => (
                <button
                  key={a.identity.user_id}
                  onClick={() => setIdentity(a.identity)}
                  style={{
                    textAlign: "left",
                    border: "1px solid #e2e8f0",
                    background: a.identity.user_id === identity.user_id ? "#f1f5f9" : "white",
                    borderRadius: 10,
                    padding: "8px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            churchId={identity.tenant_id}
            <br />
            userId={identity.user_id}
            <br />
            personId={(person as any)?.id ?? "p_seeker_2"}
          </div>
        </div>
      </details>
    </div>
  );
}

