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

type PodcastRow = {
  id: string;
  episodeNumber?: number | null;
  title: string;
  speaker?: string | null;
  publishedAt?: string | null;
  passage?: string | null;
  sourceUrl?: string | null;
  watchUrl?: string | null;
  listenUrl?: string | null;
  imageUrl?: string | null;
  analysisUpdatedAt?: string | null;
};

type PodcastAnalysis = {
  podcastId: string;
  summaryMarkdown?: string | null;
  topics?: string[];
  verses?: string[];
  updatedAt?: string | null;
};

async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export function WeeklyPodcastsPanel(props: { identity: Identity; onClose: () => void }) {
  const identity = props.identity;
  const [loading, setLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [podcasts, setPodcasts] = useState<PodcastRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selected, setSelected] = useState<PodcastRow | null>(null);
  const [analysis, setAnalysis] = useState<PodcastAnalysis | null>(null);
  const [sourceText, setSourceText] = useState("");

  const selectedTitle = useMemo(() => (selected ? `${selected.title}` : ""), [selected]);

  async function refreshList() {
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<{ podcasts?: PodcastRow[] }>("/api/a2a/weekly_podcast/list", { identity, search: search.trim() || null, limit: 50 });
      setPodcasts(Array.isArray(out?.podcasts) ? out.podcasts : []);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Failed to load podcasts"));
    } finally {
      setLoading(false);
    }
  }

  async function loadOne(podcastId: string) {
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<{ podcast?: PodcastRow | null; analysis?: any | null }>("/api/a2a/weekly_podcast/get", { identity, podcast_id: podcastId });
      setSelected((out as any)?.podcast ?? null);
      setAnalysis((out as any)?.analysis ?? null);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Failed to load podcast"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPodcasts([]);
    setSelectedId("");
    setSelected(null);
    setAnalysis(null);
    setSourceText("");
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id]);

  useEffect(() => {
    if (!selectedId) return;
    void loadOne(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function analyzeNow() {
    if (!selectedId) return;
    const txt = sourceText.trim();
    if (txt.length < 20) {
      setUiError("Paste transcript/notes first (20+ chars).");
      return;
    }
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<{ analysis?: any }>("/api/a2a/weekly_podcast/analyze", { identity, podcast_id: selectedId, source_text: txt });
      await loadOne(selectedId);
      setAnalysis((out as any)?.analysis ?? null);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Analyze failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Weekly Podcast</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{selectedTitle || "Browse episodes and cache analysis"}</div>
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
            <div style={{ fontSize: 12, color: "#64748b" }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? void refreshList() : undefined)}
              placeholder="title or speaker"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Episodes</div>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}>
              <option value="">Select an episode…</option>
              {podcasts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.episodeNumber ? `Ep ${p.episodeNumber} — ` : ""}
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selected ? (
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>
              {selected.episodeNumber ? `Episode ${selected.episodeNumber}: ` : ""}
              {selected.title}
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {selected.publishedAt ? `Published: ${selected.publishedAt}` : ""}
              {selected.speaker ? ` · ${selected.speaker}` : ""}
              {selected.passage ? ` · ${selected.passage}` : ""}
            </div>
            {selected.sourceUrl ? (
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Open source page
              </a>
            ) : null}
          </div>
        ) : null}

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Analysis (cached)</div>
          {analysis?.summaryMarkdown ? (
            <>
              <div style={{ fontSize: 12, color: "#334155", whiteSpace: "pre-wrap" }}>{analysis.summaryMarkdown}</div>
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
            <div style={{ fontSize: 12, color: "#64748b" }}>No cached analysis yet.</div>
          )}
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Create/refresh analysis</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Paste transcript/notes (for now we analyze pasted text; we’re not auto-transcribing MP3 yet).</div>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={6}
            placeholder="Paste transcript or the breakdown text you already have…"
            style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", resize: "vertical" }}
          />
          <button
            disabled={loading || !selectedId}
            onClick={() => void analyzeNow()}
            style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900, opacity: loading ? 0.7 : 1, justifySelf: "start" }}
          >
            Analyze + cache
          </button>
        </div>
      </div>
    </div>
  );
}

