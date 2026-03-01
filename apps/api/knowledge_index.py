from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Optional

from langchain_openai import OpenAIEmbeddings

from .mcp_tools import load_mcp_tools_from_env


@dataclass(frozen=True)
class KnowledgeHit:
    sourceId: str
    snippet: str


@dataclass(frozen=True)
class IndexedChunk:
    sourceId: str
    text: str
    embedding: list[float]


def _truthy_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    v = raw.strip().lower()
    return v in {"1", "true", "yes", "y", "on"}


def _tool_raw_to_json(raw: Any) -> Optional[dict[str, Any]]:
    try:
        if isinstance(raw, dict):
            content = raw.get("content")
            if isinstance(content, list):
                raw = content
            else:
                return raw

        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    return json.loads(str(item.get("text")))
            return None

        if isinstance(raw, str):
            return json.loads(raw)

        return None
    except Exception:
        return None


async def _mcp_call_json(tool_suffix: str, args: dict[str, Any]) -> Optional[dict[str, Any]]:
    tools = await load_mcp_tools_from_env()
    tool = next(
        (
            t
            for t in tools
            if isinstance(getattr(t, "name", None), str)
            and (t.name == tool_suffix or t.name.endswith(f"_{tool_suffix}"))
        ),
        None,
    )
    if not tool:
        return None
    try:
        raw = await tool.ainvoke(args if isinstance(args, dict) else {})
        return _tool_raw_to_json(raw)
    except Exception:
        return None


_CACHED_BY_CHURCH: dict[str, list[IndexedChunk]] = {}
_CACHED_BUILT_AT: dict[str, float] = {}


async def ensure_index_with_mcp(*, church_id: str, ttl_seconds: int = 300) -> list[IndexedChunk]:
    """
    Builds a KB index from:
    - local markdown in packages/knowledge/content
    - content MCP docs (markdown) when configured (content_list_docs)
    - ChurchCore persisted kb_chunks (preferred, fast, survives restarts)

    Cached in-memory with a TTL (per church_id).
    """
    church_id = (church_id or "").strip()
    if not church_id:
        return []

    now = asyncio.get_running_loop().time()
    built_at = _CACHED_BUILT_AT.get(church_id)
    cached = _CACHED_BY_CHURCH.get(church_id)
    if cached is not None and built_at is not None and (now - built_at) < ttl_seconds:
        return cached

    persist_enabled = _truthy_env("KB_PERSIST_TO_CHURCHCORE", default=True)
    if persist_enabled:
        persisted = await _mcp_call_json("churchcore_kb_list_chunks", {"churchId": church_id, "limit": 5000, "offset": 0})
        if isinstance(persisted, dict) and isinstance(persisted.get("chunks"), list) and (persisted.get("chunks") or []):
            out: list[IndexedChunk] = []
            for c in persisted.get("chunks") or []:
                if not isinstance(c, dict):
                    continue
                sid = c.get("sourceId")
                txt = c.get("text")
                emb = c.get("embedding")
                if not isinstance(sid, str) or not isinstance(txt, str) or not isinstance(emb, list):
                    continue
                try:
                    embedding = [float(x) for x in emb]
                except Exception:
                    continue
                out.append(IndexedChunk(sourceId=sid, text=txt, embedding=embedding))
            if out:
                _CACHED_BY_CHURCH[church_id] = out
                _CACHED_BUILT_AT[church_id] = now
                return out

    # Export docs directly from ChurchCore D1 via MCP (source-of-truth).
    exported = await _mcp_call_json("churchcore_kb_export_docs", {"churchId": church_id, "limitPerTable": 200})
    docs: list[dict[str, Any]] = []
    if isinstance(exported, dict) and isinstance(exported.get("docs"), list):
        for d in exported.get("docs") or []:
            if not isinstance(d, dict):
                continue
            sid = d.get("sourceId")
            txt = d.get("text")
            if isinstance(sid, str) and isinstance(txt, str) and sid.strip() and txt.strip():
                docs.append({"sourceId": sid.strip(), "text": txt})

    chunks: list[tuple[str, str]] = []
    for d in docs:
        for piece in chunk_text(str(d["text"]), chunk_size=900, overlap=150):
            chunks.append((str(d["sourceId"]), piece))

    embeddings = OpenAIEmbeddings(
        api_key=os.environ.get("OPENAI_API_KEY"),
        model=os.environ.get("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"),
    )
    vectors = embeddings.embed_documents([t for (_, t) in chunks]) if chunks else []
    out: list[IndexedChunk] = []
    for i, (sid, text) in enumerate(chunks):
        out.append(IndexedChunk(sourceId=sid, text=text, embedding=list(vectors[i] or [])))

    # Persist to ChurchCore (best effort), so hosted runs can reuse it.
    if persist_enabled and out:
        batch: list[dict[str, Any]] = []
        for idx, c in enumerate(out):
            batch.append({"chunkId": f"{church_id}:{c.sourceId}#{idx}", "sourceId": c.sourceId, "text": c.text, "embedding": c.embedding})
            if len(batch) >= 200:
                await _mcp_call_json("churchcore_kb_upsert_chunks", {"churchId": church_id, "chunks": batch})
                batch = []
        if batch:
            await _mcp_call_json("churchcore_kb_upsert_chunks", {"churchId": church_id, "chunks": batch})

    _CACHED_BY_CHURCH[church_id] = out
    _CACHED_BUILT_AT[church_id] = now
    return out


def search_kb(index: list[IndexedChunk], query: str, k: int = 4) -> tuple[str, list[KnowledgeHit]]:
    embeddings = OpenAIEmbeddings(
        api_key=os.environ.get("OPENAI_API_KEY"),
        model=os.environ.get("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"),
    )
    q = embeddings.embed_query(query)

    scored = sorted(
        [(cosine_similarity(q, c.embedding), c) for c in index],
        key=lambda x: x[0],
        reverse=True,
    )[:k]

    hits: list[KnowledgeHit] = []
    for _, c in scored:
        sid = c.sourceId
        snippet = (c.text or "").strip().replace("\n", " ")[:400]
        hits.append(KnowledgeHit(sourceId=sid, snippet=snippet))

    if not hits:
        return "No relevant knowledge base content found.", []

    tool_text = "Knowledge base matches:\n" + "\n".join([f"- [{i+1}] {h.sourceId}: {h.snippet}" for i, h in enumerate(hits)])
    return tool_text, hits


def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    clean = text.replace("\r\n", "\n").strip()
    if len(clean) <= chunk_size:
        return [clean] if clean else []
    out: list[str] = []
    i = 0
    while i < len(clean):
        end = min(len(clean), i + chunk_size)
        out.append(clean[i:end])
        if end >= len(clean):
            break
        i = max(0, end - overlap)
    return [s for s in out if s.strip()]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    dot = 0.0
    an = 0.0
    bn = 0.0
    for i in range(n):
        av = float(a[i])
        bv = float(b[i])
        dot += av * bv
        an += av * av
        bn += bv * bv
    denom = (an**0.5) * (bn**0.5)
    return 0.0 if denom == 0.0 else dot / denom

