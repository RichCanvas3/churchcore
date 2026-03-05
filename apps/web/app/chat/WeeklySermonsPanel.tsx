"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role?: string | null;
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type SermonRow = {
  id: string;
  campusId?: string | null;
  title: string;
  speaker?: string | null;
  preachedAt?: string | null;
  passage?: string | null;
  seriesTitle?: string | null;
  sourceUrl?: string | null;
  watchUrl?: string | null;
  listenUrl?: string | null;
  downloadUrl?: string | null;
  guideDiscussionUrl?: string | null;
  guideLeaderUrl?: string | null;
  analysisUpdatedAt?: string | null;
  transcriptUpdatedAt?: string | null;
};

type SermonAnalysis = {
  messageId: string;
  summaryMarkdown?: string | null;
  topics?: string[];
  verses?: string[];
  keyPoints?: string[];
  updatedAt?: string | null;
};

type SermonTranscriptMeta = {
  messageId: string;
  sourceUrl?: string | null;
  model?: string | null;
  charCount?: number | null;
  updatedAt?: string | null;
};

async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

function campusLabel(campusId: string | null | undefined) {
  if (campusId === "campus_boulder") return "Boulder";
  if (campusId === "campus_erie") return "Erie";
  if (campusId === "campus_thornton") return "Thornton";
  return campusId || "Unknown";
}

export function WeeklySermonsPanel(props: { identity: Identity; onClose: () => void }) {
  const identity = props.identity;
  const [loading, setLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [campusId, setCampusId] = useState<string>(() => identity.campus_id ?? "campus_boulder");
  const [sermons, setSermons] = useState<SermonRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selected, setSelected] = useState<SermonRow | null>(null);
  const [analysis, setAnalysis] = useState<SermonAnalysis | null>(null);
  const [transcript, setTranscript] = useState<SermonTranscriptMeta | null>(null);

  const selectedTitle = useMemo(() => (selected ? `${selected.title}` : ""), [selected]);

  async function refreshList(nextCampusId?: string) {
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<{ sermons?: SermonRow[] }>("/api/a2a/sermon/list", {
        identity,
        campus_id: (nextCampusId ?? campusId) || null,
        search: search.trim() || null,
        limit: 50,
      });
      setSermons(Array.isArray(out?.sermons) ? out.sermons : []);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Failed to load sermons"));
    } finally {
      setLoading(false);
    }
  }

  async function loadOne(messageId: string) {
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<{ sermon?: SermonRow | null; analysis?: any | null; transcript?: any | null }>("/api/a2a/sermon/get", {
        identity,
        message_id: messageId,
      });
      setSelected((out as any)?.sermon ?? null);
      setAnalysis((out as any)?.analysis ?? null);
      setTranscript((out as any)?.transcript ?? null);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Failed to load sermon"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSermons([]);
    setSelectedId("");
    setSelected(null);
    setAnalysis(null);
    setTranscript(null);
    setSearch("");
    setCampusId(identity.campus_id ?? "campus_boulder");
    void refreshList(identity.campus_id ?? "campus_boulder");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id]);

  useEffect(() => {
    if (!selectedId) return;
    void loadOne(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Weekly Sermons</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{selectedTitle || "Browse sermons by campus (summary + transcript indexed)"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void refreshList()} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
          <button onClick={props.onClose} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start" }}>
        {uiError ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{uiError}</div> : null}

        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Campus</div>
            <select
              value={campusId}
              onChange={(e) => {
                const next = String(e.target.value || identity.campus_id || "campus_boulder");
                setCampusId(next);
                setSelectedId("");
                setSelected(null);
                setAnalysis(null);
                setTranscript(null);
                void refreshList(next);
              }}
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            >
              <option value="campus_boulder">Boulder</option>
              <option value="campus_erie">Erie</option>
              <option value="campus_thornton">Thornton</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? void refreshList() : undefined)}
              placeholder="title, speaker, or passage"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Sermons</div>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}>
              <option value="">Select a sermon…</option>
              {sermons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.preachedAt ? `${String(s.preachedAt).slice(0, 10)} — ` : ""}
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selected ? (
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>{selected.title}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {selected.preachedAt ? `Date: ${String(selected.preachedAt).slice(0, 10)}` : ""}
              {selected.campusId ? ` · ${campusLabel(selected.campusId)}` : ""}
              {selected.speaker ? ` · ${selected.speaker}` : ""}
              {selected.passage ? ` · ${selected.passage}` : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
              {selected.sourceUrl ? (
                <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                  Source page
                </a>
              ) : null}
              {selected.watchUrl ? (
                <a href={selected.watchUrl} target="_blank" rel="noreferrer">
                  Watch
                </a>
              ) : null}
              {selected.listenUrl ? (
                <a href={selected.listenUrl} target="_blank" rel="noreferrer">
                  Listen
                </a>
              ) : null}
              {selected.guideDiscussionUrl ? (
                <a href={selected.guideDiscussionUrl} target="_blank" rel="noreferrer">
                  Discussion guide
                </a>
              ) : null}
              {selected.guideLeaderUrl ? (
                <a href={selected.guideLeaderUrl} target="_blank" rel="noreferrer">
                  Leader guide
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Summary (cached)</div>
          {analysis?.summaryMarkdown ? (
            <>
              <div style={{ fontSize: 12, color: "#334155", whiteSpace: "pre-wrap" }}>{analysis.summaryMarkdown}</div>
              {Array.isArray(analysis.keyPoints) && analysis.keyPoints.length ? (
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <strong>Key points:</strong> {analysis.keyPoints.join("; ")}
                </div>
              ) : null}
              {Array.isArray(analysis.topics) && analysis.topics.length ? (
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <strong>Topics:</strong> {analysis.topics.join(", ")}
                </div>
              ) : null}
              {Array.isArray(analysis.verses) && analysis.verses.length ? (
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <strong>Verses:</strong> {analysis.verses.join(", ")}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No cached summary yet.</div>
          )}
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Transcript (status)</div>
          {transcript ? (
            <div style={{ fontSize: 12, color: "#334155" }}>
              {transcript.charCount ? `${transcript.charCount.toLocaleString()} chars` : "Present"}
              {transcript.model ? ` · ${transcript.model}` : ""}
              {transcript.sourceUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={transcript.sourceUrl} target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No transcript stored yet.</div>
          )}
        </div>

        {loading ? <div style={{ fontSize: 12, color: "#64748b" }}>Loading…</div> : null}
      </div>
    </div>
  );
}

