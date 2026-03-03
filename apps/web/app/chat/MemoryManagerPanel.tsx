"use client";

import { useMemo } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role?: string | null;
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

export function MemoryManagerPanel(props: {
  identity: Identity;
  onClose: () => void;
  onOpenTool: (toolId: string) => void;
}) {
  const btn = useMemo(
    () => ({
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "white",
      borderRadius: 10,
      padding: "8px 12px",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
    }),
    [],
  );

  const smallBtn = useMemo(() => ({ ...btn, background: "#64748b", fontWeight: 600 }), [btn]);

  const items = [
    { toolId: "identity_contact", title: "Identity & Contact", desc: "Preferred name + email/phone" },
    { toolId: "faith_journey", title: "Faith Journey", desc: "Phase + milestones" },
    { toolId: "community_manager", title: "Community", desc: "Groups, classes, outreach, missions" },
    { toolId: "comm_prefs", title: "Communication Preferences", desc: "SMS/email opt-in + channel" },
    { toolId: "care_pastoral", title: "Care & Prayer", desc: "Prayer requests (and more for staff)" },
    { toolId: "teams_skills", title: "Teams & Skills", desc: "Serving teams, skills, availability" },
    { toolId: "kids_safety", title: "Kids Safety", desc: "Pickup authorization + safety notes" },
  ];

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Memory Manager</span>
        <button type="button" onClick={props.onClose} style={smallBtn}>
          Close
        </button>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start", background: "#f8fafc" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          User: <strong>{props.identity.user_id}</strong> · Tenant: <strong>{props.identity.tenant_id}</strong>
        </div>
        {items.map((it) => (
          <div key={it.toolId} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>{it.title}</div>
              <button type="button" onClick={() => props.onOpenTool(it.toolId)} style={btn}>
                Open
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{it.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

