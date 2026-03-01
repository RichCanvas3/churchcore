export function HandoffRenderer({ handoff }: { handoff: Array<Record<string, unknown>> }) {
  if (!handoff?.length) return null;
  return (
    <div style={{ border: "1px solid #fee2e2", borderRadius: 10, padding: 12, background: "#fff1f2" }}>
      <div style={{ fontWeight: 800 }}>Handoff</div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(handoff, null, 2)}</pre>
    </div>
  );
}

