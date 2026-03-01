export function FormsRenderer({ forms }: { forms: Array<Record<string, unknown>> }) {
  if (!forms?.length) return null;
  return (
    <div style={{ border: "1px dashed #d1d5db", borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Forms</div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(forms, null, 2)}</pre>
    </div>
  );
}

