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

    # 1) Preferred: load persisted chunks (paged) for full coverage.
    if persist_enabled:
        out: list[IndexedChunk] = []
        offset = 0
        page = 5000
        while True:
            persisted = await _mcp_call_json("churchcore_kb_list_chunks", {"churchId": church_id, "limit": page, "offset": offset})
            rows = persisted.get("chunks") if isinstance(persisted, dict) else None
            items = rows if isinstance(rows, list) else []
            if not items:
                break
            for c in items:
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
            if len(items) < page:
                break
            offset += len(items)
        if out:
            _CACHED_BY_CHURCH[church_id] = out
            _CACHED_BUILT_AT[church_id] = now
            return out

    # 2) Build: export ALL D1 tables (paged), embed in batches, and persist.
    tables_resp = await _mcp_call_json("churchcore_kb_list_tables", {"churchId": church_id})
    tables = tables_resp.get("tables") if isinstance(tables_resp, dict) else None
    table_items = tables if isinstance(tables, list) else []
    table_names: list[str] = []
    for t in table_items:
        if isinstance(t, dict) and isinstance(t.get("table"), str) and str(t.get("table") or "").strip():
            table_names.append(str(t.get("table")).strip())
    table_names = sorted(set(table_names))

    embeddings = OpenAIEmbeddings(
        api_key=os.environ.get("OPENAI_API_KEY"),
        model=os.environ.get("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"),
    )

    out: list[IndexedChunk] = []
    chunk_buffer: list[tuple[str, str]] = []
    chunk_seq = 0

    async def flush_buffer() -> None:
        nonlocal chunk_seq, chunk_buffer, out
        if not chunk_buffer:
            return
        texts = [t for (_, t) in chunk_buffer]
        vectors = embeddings.embed_documents(texts) if texts else []
        built: list[IndexedChunk] = []
        for i, (sid, text) in enumerate(chunk_buffer):
            emb = list(vectors[i] or []) if i < len(vectors) else []
            built.append(IndexedChunk(sourceId=sid, text=text, embedding=emb))

        out.extend(built)

        if persist_enabled and built:
            up: list[dict[str, Any]] = []
            for c in built:
                up.append(
                    {
                        "chunkId": f"{church_id}:{c.sourceId}#{chunk_seq}",
                        "sourceId": c.sourceId,
                        "text": c.text,
                        "embedding": c.embedding,
                    }
                )
                chunk_seq += 1
                if len(up) >= 200:
                    await _mcp_call_json("churchcore_kb_upsert_chunks", {"churchId": church_id, "chunks": up})
                    up = []
            if up:
                await _mcp_call_json("churchcore_kb_upsert_chunks", {"churchId": church_id, "chunks": up})

        chunk_buffer = []

    # Iterate tables and pages; chunk each row-doc into embedding chunks.
    for table in table_names:
        offset = 0
        limit = 200
        while True:
            exported = await _mcp_call_json(
                "churchcore_kb_export_table_docs",
                {"churchId": church_id, "table": table, "limit": limit, "offset": offset},
            )
            docs = exported.get("docs") if isinstance(exported, dict) else None
            docs_list = docs if isinstance(docs, list) else []
            if not docs_list:
                break
            for d in docs_list:
                if not isinstance(d, dict):
                    continue
                sid = d.get("sourceId")
                txt = d.get("text")
                if not isinstance(sid, str) or not isinstance(txt, str) or not sid.strip() or not txt.strip():
                    continue
                for piece in chunk_text(txt, chunk_size=900, overlap=150):
                    chunk_buffer.append((sid.strip(), piece))
                    if len(chunk_buffer) >= 200:
                        await flush_buffer()
            has_more = bool(exported.get("hasMore")) if isinstance(exported, dict) else False
            next_off = exported.get("nextOffset") if isinstance(exported, dict) else None
            if not has_more or not isinstance(next_off, int):
                break
            offset = next_off

    if chunk_buffer:
        await flush_buffer()

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

