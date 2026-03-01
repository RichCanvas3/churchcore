export function CardsRenderer({ cards }: { cards: Array<Record<string, unknown>> }) {
  if (!cards?.length) return null;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {cards.map((c, idx) => (
        <div
          key={idx}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 12,
            background: "white",
          }}
        >
          <div style={{ fontWeight: 700 }}>{String((c as any).title ?? (c as any).type ?? "Card")}</div>
          {(c as any).body ? <div style={{ marginTop: 6 }}>{String((c as any).body)}</div> : null}
          {(c as any).items && Array.isArray((c as any).items) ? (
            <ul style={{ marginTop: 8 }}>
              {(c as any).items.map((it: any, j: number) => (
                <li key={j}>{typeof it === "string" ? it : JSON.stringify(it)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

