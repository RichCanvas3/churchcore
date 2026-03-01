import type { OutputEnvelope } from "../lib/types";

export function NextActionsRenderer({
  actions,
  onAction,
}: {
  actions: OutputEnvelope["suggested_next_actions"];
  onAction: (skill: string, args?: Record<string, unknown>) => void;
}) {
  if (!actions?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {actions.map((a, idx) => (
        <button
          key={idx}
          onClick={() => onAction(a.skill, a.args)}
          style={{
            border: "1px solid #d1d5db",
            padding: "8px 10px",
            borderRadius: 10,
            background: "white",
            cursor: "pointer",
          }}
        >
          {a.title}
        </button>
      ))}
    </div>
  );
}

