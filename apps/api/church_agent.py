from __future__ import annotations

import json
import os
import base64
import asyncio
import time
import traceback
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from langchain_openai import ChatOpenAI

from .knowledge_index import ensure_index_with_mcp, search_kb
from .mcp_tools import load_mcp_tools_from_env
from .models import Input, NextAction, OutputEnvelope, Session


_ai_gateway_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _ai_gateway_access_token() -> str:
    """
    OAuth2 client-credentials token for the external AI gateway.
    Cached in-process; refreshes ~60s early.
    """
    now = time.time()
    token = _ai_gateway_token_cache.get("token")
    expires_at = float(_ai_gateway_token_cache.get("expires_at") or 0.0)
    if isinstance(token, str) and token and now < (expires_at - 60.0):
        return token

    client_id = (os.environ.get("AI_GATEWAY_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("AI_GATEWAY_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("Missing AI_GATEWAY_CLIENT_ID / AI_GATEWAY_CLIENT_SECRET")

    token_url = (os.environ.get("AI_GATEWAY_TOKEN_URL") or "").strip()
    if not token_url:
        raise RuntimeError("Missing AI_GATEWAY_TOKEN_URL")
    form = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "api/access"}).encode("utf-8")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        token_url,
        data=form,
        headers={
            "content-type": "application/x-www-form-urlencoded",
            "authorization": f"Basic {basic}",
            "accept": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode("utf-8") if resp is not None else "{}"
    data = json.loads(raw or "{}") if isinstance(raw, str) else {}

    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("AI gateway token exchange failed (missing access_token)")

    # Spec says tokens expire in ~1h. Respect expires_in if provided.
    expires_in = data.get("expires_in")
    ttl = float(expires_in) if isinstance(expires_in, (int, float)) else 3600.0
    _ai_gateway_token_cache["token"] = access_token
    _ai_gateway_token_cache["expires_at"] = now + max(60.0, ttl)
    return access_token


def _llm_provider() -> str:
    raw = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if raw in {"openai", "ai_gateway"}:
        return raw
    # If the AI gateway is configured, prefer it by default.
    if (os.environ.get("AI_GATEWAY_CLIENT_ID") or "").strip() and (os.environ.get("AI_GATEWAY_CLIENT_SECRET") or "").strip():
        return "ai_gateway"
    return "openai"


def get_chat_model(*, temperature: Optional[float] = None) -> ChatOpenAI:
    """
    Single switch-point for model provider in LangSmith-deployed langserver.

    Env:
      - LLM_PROVIDER: "ai_gateway" | "openai" (if unset: prefer ai_gateway when configured)
      - OPENAI_MODEL (default "gpt-5.2")
      - AI_GATEWAY_MODEL (required when ai_gateway)
      - AI_GATEWAY_BASE_URL (required when ai_gateway)
      - AI_GATEWAY_TOKEN_URL (required when ai_gateway)
      - AI_GATEWAY_CLIENT_ID / AI_GATEWAY_CLIENT_SECRET (required when ai_gateway)
    """
    provider = _llm_provider()
    if provider == "ai_gateway":
        base_url = (os.environ.get("AI_GATEWAY_BASE_URL") or "").strip()
        model = (os.environ.get("AI_GATEWAY_MODEL") or "").strip()
        if not base_url or not model:
            raise RuntimeError("Missing AI_GATEWAY_BASE_URL / AI_GATEWAY_MODEL")
        token = _ai_gateway_access_token()
        kwargs: dict[str, Any] = {"model": model, "api_key": token, "base_url": base_url}
        if isinstance(temperature, (int, float)):
            kwargs["temperature"] = float(temperature)
        return ChatOpenAI(**kwargs)

    model = (os.environ.get("OPENAI_MODEL") or "gpt-5.2").strip()
    kwargs = {"model": model}
    if isinstance(temperature, (int, float)):
        kwargs["temperature"] = float(temperature)
    return ChatOpenAI(**kwargs)


def _as_text(v: Any, max_len: int = 8000) -> str:
    s = str(v or "")
    if len(s) <= max_len:
        return s
    return s[: max(0, max_len - 20)] + "\n...(truncated)..."


def _score_doc_for_query(doc: dict[str, Any], q: str) -> int:
    q = (q or "").strip().lower()
    if not q:
        return 0
    sid = str(doc.get("sourceId") or "").lower()
    txt = str(doc.get("text") or "").lower()
    score = 0
    for token in {t for t in q.replace("?", " ").replace(",", " ").split() if len(t) >= 3}:
        if token in sid:
            score += 6
        if token in txt:
            score += 1
    # Boost common church question categories
    if any(k in q for k in ["service", "times", "sunday", "gathering"]) and "services" in sid:
        score += 10
    if any(k in q for k in ["event", "events", "lunch", "night"]) and "events" in sid:
        score += 10
    if any(k in q for k in ["group", "groups", "small group"]) and "groups" in sid:
        score += 10
    if any(k in q for k in ["purpose", "vision", "mission", "strategy", "values", "beliefs", "intent"]) and (
        "strategy" in sid or "church.json" in sid
    ):
        score += 8
    if any(k in q for k in ["serve", "volunteer", "opportunit"]) and ("groups" in sid or "resources" in sid):
        score += 4
    return score


def _pick_relevant_docs(exported_docs: list[dict[str, Any]], query: str, k: int = 3) -> list[dict[str, Any]]:
    scored = sorted(exported_docs, key=lambda d: _score_doc_for_query(d, query), reverse=True)
    top = [d for d in scored if _score_doc_for_query(d, query) > 0][:k]
    if top:
        return top
    # Fallback to the most generally useful docs
    preferred = {"church/church.json", "church/services.json", "church/events.json", "church/groups.json", "church/strategy.json"}
    out: list[dict[str, Any]] = []
    for d in exported_docs:
        if str(d.get("sourceId")) in preferred:
            out.append(d)
    return out[:k]


def _citations_from_docs(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for d in docs:
        sid = d.get("sourceId")
        txt = d.get("text")
        if isinstance(sid, str) and isinstance(txt, str) and sid.strip():
            out.append({"sourceId": sid, "snippet": txt.strip().replace("\n", " ")[:400]})
    return out


def _ui_handoff_for_user_text(user_text: str) -> list[dict[str, Any]]:
    """
    Minimal client-side UI tool signaling.
    The web can render a right-side panel when the agent includes a handoff item:
      {"type":"ui_tool","tool_id":"household_manager", ...}
    """
    u = (user_text or "").strip().lower()
    if not u:
        return []

    planish = any(k in u for k in ["reading plan", "bible plan", "devotional plan", "this week's reading", "this weeks reading", "weekly plan"])
    if planish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "guide",
                "title": "Guide",
                "instructions": "Open the guide panel (includes this week’s sermon + Bible reading plan).",
            },
            {
                "type": "ui_tool",
                "tool_id": "bible_reader",
                "title": "Bible",
                "instructions": "Open the Bible reader (includes the reading plan section).",
            },
        ]
    checkinish = any(k in u for k in ["checkin", "check-in", "check in", "drop off", "pickup", "pick up"])
    if checkinish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "kids_checkin",
                "title": "Kids check-in",
                "instructions": "Open the kids check-in panel.",
            }
        ]

    calendarish = any(
        k in u
        for k in [
            "events calendar",
            "event calendar",
            "calendar of events",
            "show calendar",
            "show me the calendar",
            "calendar view",
            "weekly calendar",
            "week calendar",
        ]
    ) or u.strip() == "calendar" or ("calendar" in u and "event" in u)
    if calendarish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "calendar",
                "title": "Calendar",
                "instructions": "Open the events calendar panel.",
            }
        ]


def _is_short_ui_open_request(user_text: str) -> bool:
    u = (user_text or "").strip().lower()
    if not u:
        return False
    if len(u) > 40:
        return False
    # Intent: let 1-3 word "open/show" commands skip an LLM call.
    if u.startswith("open ") or u.startswith("show "):
        return True
    return u in {
        "calendar",
        "events",
        "event",
        "guide",
        "church",
        "bible",
        "bible reader",
        "kids checkin",
        "kids check-in",
        "checkin",
        "check-in",
        "groups",
        "my groups",
        "faith journey",
        "strategic intent",
        "congregation strategic intent",
    }

    intentish = any(
        k in u
        for k in [
            "strategic intent",
            "purpose",
            "vision",
            "mission",
            "strategy",
            "values",
            "beliefs",
            "why we exist",
            "what is the mission",
            "what's the mission",
            "mission of this church",
        ]
    )
    if intentish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "strategic_intent",
                "title": "Strategic intent",
                "instructions": "Open the church strategic intent panel (purpose/vision/mission/strategy).",
            }
        ]

    churchish = any(
        k in u
        for k in [
            "tell me about the church",
            "about the church",
            "tell me about calvary",
            "about calvary",
            "campus",
            "campuses",
            "locations",
            "location",
            "service times",
            "service time",
            "address",
            "where are you located",
        ]
    )
    if churchish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "church_overview",
                "title": "Church",
                "instructions": "Open the church overview panel (logo, campuses, service times).",
            }
        ]

    identityish = any(k in u for k in ["contact", "phone", "email", "address", "preferred name", "my info", "my details"])
    if identityish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "identity_contact",
                "title": "Identity & contact",
                "instructions": "Open the identity/contact panel.",
            }
        ]

    group_membershipish = any(
        k in u
        for k in [
            "my group",
            "my groups",
            "our group",
            "group roster",
            "group members",
            "invite to group",
            "invite someone",
            "remove from group",
            "change role",
            "life group",
            "lifegroup",
            "men's group",
            "mens group",
            "women's group",
            "womens group",
            "bible study group",
            "group bible study",
            "group study",
            "study notes",
            "group schedule",
            "group event",
            "plan an activity",
        ]
    )
    if group_membershipish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "groups_manager",
                "title": "My groups",
                "instructions": "Open the groups panel (my groups, roster, schedule, and group Bible study).",
            }
        ]

    communityish = any(
        k in u
        for k in [
            "community",
            "lifegroup",
            "life group",
            "lifegroups",
            "small group",
            "small groups",
            "class",
            "classes",
            "adult class",
            "adult classes",
            "starting point",
            "membership",
            "baptism",
            "serve",
            "serving",
            "serving team",
            "volunteer",
            "volunteering",
            "outreach",
            "missions",
            "global outreach",
            "trip",
            "mission trip",
        ]
    )
    if communityish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "community_manager",
                "title": "Community",
                "instructions": "Open the community panel (groups, classes, outreach, missions, trips).",
            }
        ]

    faith_journeyish = any(
        k in u
        for k in [
            "faith journey",
            "faith stage",
            "spiritual journey",
            "my stage",
            "phases",
            "phase",
            "where am i",
            "faith phase",
            "milestone",
            "milestones",
            "next step",
            "next steps",
            "what should i do next",
        ]
    )
    if faith_journeyish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "faith_journey",
                "title": "Faith journey",
                "instructions": "Open the faith journey panel (phase + milestones).",
            }
        ]

    commish = any(k in u for k in ["communication", "preferences", "opt in", "opt-in", "sms", "text me", "email me", "notifications"])
    if commish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "comm_prefs",
                "title": "Communication preferences",
                "instructions": "Open the communication preferences panel.",
            }
        ]

    guideish = any(k in u for k in ["guide", "talk with a guide", "mentor", "pastor", "someone to talk to", "meet with someone"])
    if guideish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "guide",
                "title": "Guide",
                "instructions": "Open the guide panel (journey + next steps + resources).",
            }
        ]

    careish = any(k in u for k in ["prayer", "pray for", "care", "pastoral", "counseling", "counselling"])
    if careish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "care_pastoral",
                "title": "Care & prayer",
                "instructions": "Open the care/prayer panel.",
            }
        ]

    teamsish = any(k in u for k in ["volunteer", "serving", "serve", "team", "teams", "skills", "gift", "gifts"])
    if teamsish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "teams_skills",
                "title": "Teams & skills",
                "instructions": "Open the teams/skills panel.",
            }
        ]

    sermonish = any(k in u for k in ["sermon", "message this week", "this week's message", "messages", "weekly sermons", "the weekly", "weekly podcast", "podcast"])
    if sermonish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "weekly_sermons",
                "title": "Weekly sermons",
                "instructions": "Open the Weekly Sermons panel (browse by campus; cached summary + transcript).",
            }
        ]

    kids_safetyish = any(k in u for k in ["kids safety", "authorized pickup", "authorised pickup", "custody", "allergy note", "release to", "do not release"])
    if kids_safetyish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "household_manager",
                "title": "Household",
                "instructions": "Open the household manager panel (includes pickup/custody/allergy notes).",
            }
        ]

    memoryish = any(k in u for k in ["memory", "profile memory", "manage memory", "edit memory"])
    if memoryish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "memory_manager",
                "title": "Memory manager",
                "instructions": "Open the memory manager panel.",
            }
        ]

    householdish = any(k in u for k in ["household", "family", "kids", "kid", "child", "children"])
    manageish = any(k in u for k in ["update", "edit", "add", "remove", "change", "member", "members"])
    if householdish and manageish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "household_manager",
                "title": "Household",
                "instructions": "Open the household manager panel.",
            }
        ]
    return []


def _wants_sparql_journey(user_text: str) -> bool:
    u = (user_text or "").strip().lower()
    if not u:
        return False
    # Keep this narrow: only trigger SPARQL journey reasoning for explicit journey/salvation questions.
    return any(
        k in u
        for k in [
            "be saved",
            "saved",
            "salvation",
            "become a disciple",
            "become disciple",
            "disciple",
            "repent",
            "repentance",
            "faith in jesus",
            "faith in christ",
            "gospel",
            "baptism",
            "baptize",
            "next step",
            "next steps",
            "what should i do next",
            "faith journey",
            "journey stage",
            "my stage",
        ]
    )


def _should_fetch_church_export(user_text: str) -> bool:
    u = (user_text or "").strip().lower()
    if not u:
        return False
    # Only pull authoritative church data when the user is actually asking about the church.
    return any(
        k in u
        for k in [
            "service time",
            "service times",
            "sunday",
            "gathering",
            "campus",
            "campuses",
            "location",
            "locations",
            "address",
            "events",
            "event",
            "groups",
            "small group",
            "serve",
            "volunteer",
            "mission",
            "vision",
            "purpose",
            "strategy",
            "values",
            "beliefs",
            "tell me about the church",
            "about the church",
            "calvary",
        ]
    )


def _should_search_kb(user_text: str) -> bool:
    u = (user_text or "").strip().lower()
    if not u:
        return False
    # KB search can be expensive. Only do it for Scripture/resources + sermon/guide queries.
    return any(
        k in u
        for k in [
            "bible",
            "scripture",
            "verse",
            "passage",
            "reading plan",
            "bible plan",
            "devotional",
            "sermon",
            "message",
            "discussion guide",
            "leader guide",
            "study questions",
            "john",
            "romans",
            "ephesians",
            "psalm",
            "proverbs",
            "matthew",
        ]
    )


def _should_propose_memory_ops(user_text: str) -> bool:
    u = (user_text or "").strip().lower()
    if not u:
        return False
    # This is a SECOND model call. Keep it for turns that likely contain durable profile updates.
    return any(
        k in u
        for k in [
            "my name is",
            "call me",
            "preferred name",
            "my email",
            "email is",
            "my phone",
            "phone is",
            "text me",
            "sms",
            "allergy",
            "allergies",
            "custody",
            "authorized pickup",
            "i want to join",
            "i want to serve",
            "i want to volunteer",
            "pray for",
            "prayer request",
            "i live",
            "my address",
        ]
    )


def _cards_from_export_docs(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for d in docs:
        sid = str(d.get("sourceId") or "")
        txt = d.get("text")
        if not isinstance(txt, str) or not txt.strip():
            continue
        if sid == "church/services.json":
            try:
                j = json.loads(txt)
                services = j.get("services")
                if isinstance(services, list):
                    cards.append({"type": "services", "title": "Service times", "items": services})
            except Exception:
                pass
        if sid == "church/events.json":
            try:
                j = json.loads(txt)
                events = j.get("events")
                if isinstance(events, list):
                    cards.append({"type": "events", "title": "Events", "items": events})
            except Exception:
                pass
        if sid == "church/groups.json":
            try:
                j = json.loads(txt)
                groups = j.get("groups")
                if isinstance(groups, list):
                    cards.append({"type": "groups", "title": "Groups", "items": groups})
            except Exception:
                pass
    return cards


def _tool_raw_to_json(raw: Any) -> Optional[dict[str, Any]]:
    """
    MCP tools commonly return:
      {"content":[{"type":"text","text":"{...json...}"}]}
    or:
      [{"type":"text","text":"{...json...}"}]
    Normalize to parsed JSON dict.
    """
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


def _tool_raw_to_text(raw: Any) -> str:
    """
    Normalize MCP tool outputs to a single text string.
    Useful for tools that return non-JSON confirmations (e.g., email sent).
    """
    try:
        if isinstance(raw, dict):
            content = raw.get("content")
            if isinstance(content, list):
                raw = content
            else:
                return _as_text(raw, 4000)

        if isinstance(raw, list):
            texts: list[str] = []
            for item in raw:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    texts.append(str(item.get("text")))
            return "\n".join([t for t in texts if t.strip()]).strip()

        return str(raw or "").strip()
    except Exception:
        return str(raw or "").strip()


def _find_tool_by_suffix(tools: list[Any], suffix: str) -> Any | None:
    suffix = (suffix or "").strip()
    if not suffix:
        return None
    for t in tools:
        name = getattr(t, "name", None)
        if not isinstance(name, str) or not name:
            continue
        if name == suffix or name.endswith(f"_{suffix}"):
            return t
    return None


async def _call_tool_json(tools: list[Any], tool_suffix: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    tool = _find_tool_by_suffix(tools, tool_suffix)
    if not tool:
        return None
    try:
        raw = await tool.ainvoke(payload if isinstance(payload, dict) else {})
    except Exception as e:
        return {
            "ok": False,
            "reason": "tool_invoke_failed",
            "tool": str(getattr(tool, "name", tool_suffix) or tool_suffix),
            "error": str(e),
        }

    parsed = _tool_raw_to_json(raw)
    if parsed is not None:
        return parsed

    # If the tool returned a non-JSON error payload, preserve it so callers can surface real failures.
    txt = _tool_raw_to_text(raw)
    return {
        "ok": False,
        "reason": "tool_returned_non_json",
        "tool": str(getattr(tool, "name", tool_suffix) or tool_suffix),
        "error": (txt or "Tool returned non-JSON output.")[:2000],
    }


async def _call_tool_text(tools: list[Any], tool_suffix: str, payload: dict[str, Any]) -> Optional[str]:
    tool = _find_tool_by_suffix(tools, tool_suffix)
    if not tool:
        return None
    raw = await tool.ainvoke(payload if isinstance(payload, dict) else {})
    txt = _tool_raw_to_text(raw)
    return txt if txt else ""


def _permission_denied() -> OutputEnvelope:
    return OutputEnvelope(
        message="You don’t have permission to use guide tools.",
        handoff=[
            {
                "type": "request_access",
                "instructions": "Ask a church administrator to grant you the guide/staff role, then sign in again.",
            }
        ],
        suggested_next_actions=[NextAction(title="Check permissions", skill="profile.permissions_check")],
    )


async def _require_guide_permission(session: Session, tools: list[Any]) -> bool:
    auth = session.auth
    if not auth or not auth.isAuthenticated:
        return False
    if not any(r in {"guide", "staff"} for r in auth.roles):
        return False

    # Canonical check via ChurchCore MCP when available.
    res = await _call_tool_json(
        tools,
        "churchcore_permissions_check",
        {"churchId": session.churchId, "userId": session.userId, "requestedRole": "guide"},
    )
    if not res:
        return False
    allowed = res.get("allowed")
    return bool(allowed) if isinstance(allowed, bool) else False


def _missing_mcp(tool_name: str) -> OutputEnvelope:
    return OutputEnvelope(
        message=f"Missing MCP tool: {tool_name}. Configure MCP_SERVERS_JSON + MCP_TOOL_ALLOWLIST in your LangSmith Deployment.",
        handoff=[
            {
                "type": "configure_mcp",
                "required_tool": tool_name,
                "envs": ["MCP_SERVERS_JSON", "MCP_TOOL_NAME_PREFIX", "MCP_TOOL_ALLOWLIST"],
            }
        ],
    )


def _memory_context_from_args(args: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """
    A2A gateway injects person-scoped memory into args.__context.person_memory.
    We treat it as a read-only snapshot and (optionally) propose MemoryOps back.
    """
    ctx = args.get("__context")
    if not isinstance(ctx, dict):
        return None, ""
    mem = ctx.get("person_memory")
    if not isinstance(mem, dict):
        return None, ""
    summary = mem.get("summary")
    if isinstance(summary, str) and summary.strip():
        return mem, summary.strip()

    # Fallback: build a tiny summary from common fields.
    stage = ""
    sj = mem.get("spiritualJourney")
    if isinstance(sj, dict) and isinstance(sj.get("stage"), str):
        stage = str(sj.get("stage") or "").strip()
    intent = mem.get("intentProfile")
    intent_keys = []
    if isinstance(intent, dict):
        intent_keys = [k for k, v in intent.items() if bool(v) and isinstance(k, str)]
    bits = []
    if stage:
        bits.append(f"stage={stage}")
    if intent_keys:
        bits.append("intents=" + ",".join(intent_keys[:6]))
    return mem, ("; ".join(bits)).strip()


def _household_context_from_args(args: dict[str, Any]) -> str:
    ctx = args.get("__context")
    if not isinstance(ctx, dict):
        return ""
    hh = ctx.get("household")
    if not isinstance(hh, dict):
        return ""
    s = hh.get("summary")
    return str(s).strip() if isinstance(s, str) else ""


def _journey_context_from_args(args: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    ctx = args.get("__context")
    if not isinstance(ctx, dict):
        return None, ""
    j = ctx.get("journey")
    if not isinstance(j, dict):
        return None, ""
    cur = j.get("current_stage")
    cur_title = ""
    if isinstance(cur, dict) and isinstance(cur.get("title"), str):
        cur_title = str(cur.get("title") or "").strip()
    steps = j.get("next_steps")
    step_titles: list[str] = []
    if isinstance(steps, list):
        for s in steps[:5]:
            node = s.get("node") if isinstance(s, dict) else None
            if isinstance(node, dict) and isinstance(node.get("title"), str):
                t = str(node.get("title") or "").strip()
                if t:
                    step_titles.append(t)
    summary_bits: list[str] = []
    if cur_title:
        summary_bits.append(f"stage={cur_title}")
    if step_titles:
        summary_bits.append("next=" + ", ".join(step_titles[:3]))
    return j, ("; ".join(summary_bits)).strip()


def _identity_contact_context_from_args(args: dict[str, Any]) -> str:
    ctx = args.get("__context")
    if not isinstance(ctx, dict):
        return ""
    ic = ctx.get("identity_contact")
    if not isinstance(ic, dict):
        return ""
    bits: list[str] = []
    church_id = ic.get("churchId")
    campus_id = ic.get("campusId")
    preferred = ic.get("preferredName")
    email = ic.get("email")
    phone = ic.get("phone")
    if isinstance(church_id, str) and church_id.strip():
        bits.append(f"churchId={church_id.strip()}")
    if isinstance(campus_id, str) and campus_id.strip():
        bits.append(f"campusId={campus_id.strip()}")
    if isinstance(preferred, str) and preferred.strip():
        bits.append(f"preferredName={preferred.strip()}")
    if isinstance(email, str) and email.strip():
        bits.append(f"email={email.strip()}")
    if isinstance(phone, str) and phone.strip():
        bits.append(f"phone={phone.strip()}")
    return "; ".join(bits).strip()


def _weekly_context_from_args(args: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """
    A2A gateway may inject week-scoped sermon + plan data into args.__context.weekly.
    Treat as a read-only snapshot to ground Bible-study style answers.
    """
    ctx = args.get("__context")
    if not isinstance(ctx, dict):
        return None, ""
    weekly = ctx.get("weekly")
    if not isinstance(weekly, dict):
        return None, ""

    plan = weekly.get("plan") if isinstance(weekly.get("plan"), dict) else {}
    week = plan.get("week") if isinstance(plan.get("week"), dict) else {}
    sermon = weekly.get("sermon") if isinstance(weekly.get("sermon"), dict) else {}
    today = str(weekly.get("today") or "").strip()

    title = str(sermon.get("title") or week.get("title") or "").strip()
    passage = str(sermon.get("passage") or week.get("passage") or "").strip()
    week_start = str(week.get("weekStartDate") or "").strip()
    week_end = str(week.get("weekEndDate") or "").strip()

    today_items = plan.get("today_items") if isinstance(plan.get("today_items"), list) else []
    today_lines: list[str] = []
    for it in today_items[:4]:
        if not isinstance(it, dict):
            continue
        lab = str(it.get("label") or "").strip()
        ref = str(it.get("ref") or "").strip()
        done = bool(it.get("completed"))
        if lab or ref:
            today_lines.append(f"- {'[done] ' if done else ''}{lab or 'Reading'}{(' — ' + ref) if ref else ''}".strip())

    guide_discussion_url = str(sermon.get("guideDiscussionUrl") or "").strip()
    guide_leader_url = str(sermon.get("guideLeaderUrl") or "").strip()

    bits: list[str] = []
    if week_start or week_end:
        bits.append(f"Week: {week_start or '?'} → {week_end or '?'}")
    if title or passage:
        bits.append(f"Sermon: {title or 'This week'}{(' (' + passage + ')') if passage else ''}")
    if today:
        bits.append(f"Today: {today}")
    if today_lines:
        bits.append("Today's plan items:\n" + "\n".join(today_lines))
    if guide_discussion_url or guide_leader_url:
        bits.append(
            "Guides:\n"
            + ("\n".join([f"- Discussion: {guide_discussion_url}" if guide_discussion_url else "", f"- Leader: {guide_leader_url}" if guide_leader_url else ""]).strip())
        )
    return weekly, ("\n".join([b for b in bits if b.strip()])).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_to_unix(iso: str) -> Optional[int]:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _pick_hour(hourly: list[dict[str, Any]], target_unix: int) -> Optional[dict[str, Any]]:
    best = None
    best_delta = None
    for h in hourly:
        if not isinstance(h, dict):
            continue
        dt = h.get("dt")
        if not isinstance(dt, int):
            continue
        d = abs(dt - target_unix)
        if best_delta is None or d < best_delta:
            best = h
            best_delta = d
    return best


def _week_window_iso(start_date: str) -> tuple[str, str, str]:
    """
    Returns (weekStartISODate, fromIsoZ, toIsoZ) where start_date is YYYY-MM-DD.
    """
    s = (start_date or "").strip()
    try:
        d = datetime.fromisoformat(s).date()
    except Exception:
        d = datetime.now(timezone.utc).date()
    week_start = d.isoformat()
    week_end = (d + timedelta(days=6)).isoformat()
    from_iso = f"{week_start}T00:00:00.000Z"
    to_iso = f"{week_end}T23:59:59.999Z"
    return week_start, from_iso, to_iso


async def _weather_hourly(tools: list[Any], *, lat: float, lon: float, hours: int = 48) -> Optional[dict[str, Any]]:
    try:
        return await _call_tool_json(
            tools,
            "weather_forecast_hourly",
            {"lat": float(lat), "lon": float(lon), "hours": int(hours), "units": "imperial"},
        )
    except Exception:
        return None


async def _weather_daily(tools: list[Any], *, lat: float, lon: float, days: int = 8) -> Optional[dict[str, Any]]:
    try:
        return await _call_tool_json(
            tools,
            "weather_forecast_daily",
            {"lat": float(lat), "lon": float(lon), "days": int(days), "units": "imperial"},
        )
    except Exception:
        return None


def _campus_latlon(campus_id: Optional[str]) -> tuple[float, float, str]:
    cid = str(campus_id or "").strip()
    # Approximate coordinates for weather context.
    # (We keep these here rather than in DB so weather works even if events lack lat/lon.)
    if cid == "campus_erie":
        return 40.0506, -105.0496, "Erie Campus"
    if cid == "campus_thornton":
        return 39.9183, -104.9453, "Thornton Campus"
    return 40.0403, -105.2539, "Boulder Campus"


def _weather_summary_from_hourly(hourly: list[dict[str, Any]], label: str) -> str:
    # Pick a few upcoming hours and summarize.
    if not isinstance(hourly, list) or not hourly:
        return f"Weather ({label}): no forecast data available."
    rows: list[str] = []
    for h in hourly[:6]:
        if not isinstance(h, dict):
            continue
        dt = h.get("dt")
        try:
            ts = datetime.fromtimestamp(int(dt), tz=timezone.utc).strftime("%-I%p UTC") if isinstance(dt, int) else ""
        except Exception:
            ts = ""
        temp = h.get("temp")
        pop = h.get("pop")
        w = h.get("weather")
        desc = ""
        if isinstance(w, list) and w and isinstance(w[0], dict) and isinstance(w[0].get("description"), str):
            desc = str(w[0].get("description"))
        ttxt = f"{float(temp):.0f}°F" if isinstance(temp, (int, float)) else "?°F"
        ptxt = f"{int(round(float(pop) * 100))}% precip" if isinstance(pop, (int, float)) else "?% precip"
        bits = " • ".join([b for b in [ts, desc, ttxt, ptxt] if b])
        if bits:
            rows.append(f"- {bits}")
    if not rows:
        return f"Weather ({label}): no usable forecast points."
    return "\n".join([f"Weather ({label}) next ~6h:", *rows])


def _safe_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def _safe_json_extract(text: str) -> Any:
    """
    Best-effort JSON extraction when the model wraps JSON in extra text.
    """
    raw = str(text or "").strip()
    if not raw:
        return None
    direct = _safe_json_loads(raw)
    if direct is not None:
        return direct
    # Try to extract the first JSON object.
    try:
        i = raw.find("{")
        j = raw.rfind("}")
        if i >= 0 and j > i:
            return _safe_json_loads(raw[i : j + 1])
    except Exception:
        pass
    # Try to extract the first JSON array.
    try:
        i = raw.find("[")
        j = raw.rfind("]")
        if i >= 0 and j > i:
            return _safe_json_loads(raw[i : j + 1])
    except Exception:
        pass
    return None


def _json_only_envelope_error(message: str) -> OutputEnvelope:
    return OutputEnvelope(message=message, data={"ok": False})


async def _predict_journey_flows_with_sparql(
    *,
    model: ChatOpenAI,
    tools: list[Any],
    session: Session,
    args: dict[str, Any],
) -> OutputEnvelope:
    """
    LLM-driven:
      1) propose SPARQL queries
      2) execute them via churchcore_graphdb_sparql_query
      3) synthesize predicted TimeVaryingConcept/Manifestation/State changes + next actions
    """
    mem, _mem_summary = _memory_context_from_args(args)
    journey, _journey_summary = _journey_context_from_args(args)
    weekly, _weekly_summary = _weekly_context_from_args(args)

    # Step 1 (deterministic): canonical GraphDB query pack.
    # Long-term: avoids LLM-invented IRIs by using the ontology's actual namespaces.
    ontology_graph = "https://churchcore.ai/graph/ontology"
    ccfj_prefix = "https://ontology.churchcore.ai/cc/faith-journey#"
    qclean: list[dict[str, str]] = [
        {
            "name": "ontology_triple_count",
            "purpose": "Verify the ontology named graph is populated.",
            "query": f"SELECT (COUNT(*) AS ?triples) WHERE {{ GRAPH <{ontology_graph}> {{ ?s ?p ?o }} }}",
        },
        {
            "name": "journey_graphs",
            "purpose": "List JourneyGraph resources + names.",
            "query": f"""
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>
SELECT ?graph ?name WHERE {{
  GRAPH <{ontology_graph}> {{
    ?graph a ccjourney:JourneyGraph .
    OPTIONAL {{ ?graph cc:name ?name }}
  }}
}} LIMIT 200
""".strip(),
        },
        {
            "name": "ccfj_nodes",
            "purpose": "Fetch ChurchCore faith-journey nodes + linked state categories (labels/definitions).",
            "query": f"""
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?node ?nodeName ?state ?stateLabel ?stateNotation ?stateDefinition ?stateScopeNote WHERE {{
  GRAPH <{ontology_graph}> {{
    ?node a ccjourney:JourneyNode .
    FILTER(STRSTARTS(STR(?node), "{ccfj_prefix}"))
    OPTIONAL {{ ?node cc:name ?nodeName }}
    OPTIONAL {{
      ?node ccjourney:representsState ?state .
      OPTIONAL {{ ?state skos:prefLabel ?stateLabel }}
      OPTIONAL {{ ?state skos:notation ?stateNotation }}
      OPTIONAL {{ ?state skos:definition ?stateDefinition }}
      OPTIONAL {{ ?state skos:scopeNote ?stateScopeNote }}
    }}
  }}
}} LIMIT 5000
""".strip(),
        },
        {
            "name": "ccfj_edges",
            "purpose": "Fetch ChurchCore faith-journey edges (from/to/kind).",
            "query": f"""
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>
SELECT ?edge ?from ?to ?edgeKind WHERE {{
  GRAPH <{ontology_graph}> {{
    ?edge a ccjourney:JourneyEdge ;
          ccjourney:fromNode ?from ;
          ccjourney:toNode ?to .
    FILTER(STRSTARTS(STR(?edge), "{ccfj_prefix}"))
    OPTIONAL {{ ?edge ccjourney:edgeKind ?edgeKind }}
  }}
}} LIMIT 10000
""".strip(),
        },
    ]

    # Step 2: execute SPARQL via MCP (parallel).
    async def _run_sparql_one(q: dict[str, str]) -> tuple[str, dict[str, Any]]:
        name = str(q.get("name") or "").strip() or "q"
        t0 = time.perf_counter()
        res = await _call_tool_json(
            tools,
            "churchcore_graphdb_sparql_query",
            {"churchId": session.churchId, "query": q.get("query") or "", "accept": "application/sparql-results+json"},
        )
        t1 = time.perf_counter()
        return (
            name,
            {
                "purpose": str(q.get("purpose") or "").strip(),
                "ok": bool(res and res.get("ok")),
                "result": res,
                "timingMs": int(round((t1 - t0) * 1000.0)),
            },
        )

    sparql_t0 = time.perf_counter()
    pairs = await asyncio.gather(*[_run_sparql_one(q) for q in qclean])
    sparql_t1 = time.perf_counter()
    results: dict[str, Any] = {k: v for (k, v) in pairs}
    sparql_total_ms = int(round((sparql_t1 - sparql_t0) * 1000.0))

    # Parse helpers for SPARQL JSON results.
    def _bindings_for(name: str) -> list[dict[str, Any]]:
        r = results.get(name) if isinstance(results.get(name), dict) else None
        tool_res = r.get("result") if isinstance(r, dict) else None
        if not isinstance(tool_res, dict) or tool_res.get("ok") is not True:
            return []
        payload = tool_res.get("result")
        if not isinstance(payload, dict):
            return []
        res2 = payload.get("results")
        if not isinstance(res2, dict):
            return []
        b = res2.get("bindings")
        return [x for x in b if isinstance(x, dict)] if isinstance(b, list) else []

    def _bval(row: dict[str, Any], key: str) -> str | None:
        v = row.get(key)
        if isinstance(v, dict):
            vv = v.get("value")
            return str(vv) if isinstance(vv, str) else None
        return None

    failed = [name for name, r in results.items() if not (isinstance(r, dict) and r.get("ok") is True)]
    if failed:
        # Hard fail if SPARQL isn't working so it's visible in tracing/UI.
        qmap = {q["name"]: q.get("query") for q in qclean if isinstance(q, dict) and isinstance(q.get("name"), str)}
        brief: dict[str, Any] = {}
        for name in failed[:6]:
            r = results.get(name) if isinstance(results.get(name), dict) else {}
            rr = (r or {}).get("result") if isinstance(r, dict) else None
            if isinstance(rr, dict):
                brief[name] = {
                    "reason": rr.get("reason") or rr.get("error") or rr.get("message"),
                    "query_snippet": str(qmap.get(name) or "").strip().replace("\n", " ")[:260],
                }
            else:
                brief[name] = {"reason": "no_result", "query_snippet": str(qmap.get(name) or "").strip().replace("\n", " ")[:260]}
        msg_lines = [f"SPARQL query failed for: {', '.join(failed[:6])}"]
        for name in failed[:3]:
            reason = ""
            b = brief.get(name)
            if isinstance(b, dict):
                reason = str(b.get("reason") or "").strip()
            if reason:
                msg_lines.append(f"- {name}: {reason[:500]}")
        msg_lines.append("See `data.failed_brief` for full details.")
        return OutputEnvelope(
            message="\n".join(msg_lines).strip(),
            data={
                "ok": False,
                "reason": "sparql_execution_failed",
                "failed": failed,
                "failed_brief": brief,
                "note": "Check failed_brief[*].reason for GraphDB/config/auth/SPARQL errors.",
            },
        )

    # Validate ontology graph has triples and journey graphs exist.
    triple_rows = _bindings_for("ontology_triple_count")
    triples = None
    if triple_rows:
        t = _bval(triple_rows[0], "triples")
        try:
            triples = int(float(t)) if isinstance(t, str) and t.strip() else None
        except Exception:
            triples = None
    if not triples or triples <= 0:
        return OutputEnvelope(
            message="Ontology graph is empty (no triples). Load ontology TTL into GraphDB context https://churchcore.ai/graph/ontology.",
            data={"ok": False, "reason": "ontology_graph_empty", "triples": triples, "ontologyGraph": ontology_graph},
        )

    graph_rows = _bindings_for("journey_graphs")
    graphs: list[dict[str, str]] = []
    for r in graph_rows:
        g = _bval(r, "graph")
        nm = _bval(r, "name") or ""
        if g:
            graphs.append({"graph": g, "name": nm})

    # Pull nodes/edges (faith-journey namespace) into structured form for the reasoning step.
    node_rows = _bindings_for("ccfj_nodes")
    nodes_by_iri: dict[str, dict[str, Any]] = {}
    for r in node_rows:
        iri = _bval(r, "node")
        if not iri:
            continue
        node = nodes_by_iri.get(iri) or {"nodeIri": iri}
        nm = _bval(r, "nodeName")
        if nm and not node.get("name"):
            node["name"] = nm
        st = _bval(r, "state")
        if st and not node.get("stateIri"):
            node["stateIri"] = st
        for k_src, k_dst in [
            ("stateLabel", "stateLabel"),
            ("stateNotation", "stateNotation"),
            ("stateDefinition", "stateDefinition"),
            ("stateScopeNote", "stateScopeNote"),
        ]:
            vv = _bval(r, k_src)
            if vv and not node.get(k_dst):
                node[k_dst] = vv
        nodes_by_iri[iri] = node

    edge_rows = _bindings_for("ccfj_edges")
    edges: list[dict[str, Any]] = []
    for r in edge_rows:
        e = _bval(r, "edge")
        f = _bval(r, "from")
        t = _bval(r, "to")
        if not e or not f or not t:
            continue
        edges.append({"edgeIri": e, "from": f, "to": t, "edgeKind": _bval(r, "edgeKind") or ""})

    # Determine current stage from journey_context (gateway uses ids like stage_new_believer).
    # Map to ontology node IRI using stable naming conventions + SKOS notation on the represented state.
    current_stage_id = ""
    try:
        cur = (journey or {}).get("current_stage") if isinstance(journey, dict) else None
        current_stage_id = str((cur or {}).get("id") or "").strip() if isinstance(cur, dict) else ""
    except Exception:
        current_stage_id = ""
    stage_key = current_stage_id.replace("stage_", "", 1).strip().lower() if current_stage_id else ""
    current_node_iri = ""
    if stage_key:
        guess = f"{ccfj_prefix}journey_stage_{stage_key}"
        if guess in nodes_by_iri:
            current_node_iri = guess
        else:
            for iri, n in nodes_by_iri.items():
                if str(n.get("stateNotation") or "").strip().lower() == stage_key:
                    current_node_iri = iri
                    break

    # If we still can't map, continue but be explicit (synthesis can fall back to graph-level guidance).
    current_node = nodes_by_iri.get(current_node_iri) if current_node_iri else None

    # Step 3: synthesize predictions
    sys2 = (
        "You are a faith-journey guide.\n"
        "Use the user's memory + the provided canonical journey graph data from GraphDB to:\n"
        "- predict plausible TimeVaryingConcept/Manifestation/State changes (synthetic forecast)\n"
        "- recommend next actions (journey steps) per graph\n"
        "Return STRICT JSON ONLY with shape:\n"
        '{\"ok\":true,\"asOf\":\"<iso>\",\"predictions\":[{\"graphId\":\"\",\"graphName\":\"\",\"current\":{\"nodeId\":\"\",\"title\":\"\"},\"predictedChanges\":[{\"timeHorizonDays\":7,\"stateIri\":null,\"stateLabel\":\"\",\"manifestationLabel\":\"\",\"confidence\":0.0,\"evidence\":[\"...\"],\"notes\":\"\"}],\"recommendedNextActions\":[{\"fromNodeId\":\"\",\"fromTitle\":\"\",\"toNodeId\":\"\",\"toTitle\":\"\",\"nodeId\":\"\",\"title\":\"\",\"edgeKind\":\"\",\"confidence\":0.0,\"reason\":\"\",\"evidence\":[\"...\"]}]}],\"sparqlUsed\":[\"q1\",\"q2\"]}\n'
        "Notes:\n"
        "- Keep predictions pastorally appropriate and avoid certainty language.\n"
        "- Ground recommendations in memory context (sermons, verses, completed steps) and in the journey graph structure.\n"
        "- For each recommended next action, include a specific 'reason' and 2-6 short 'evidence' bullets.\n"
        "- Always include graph grounding: fromNodeId/fromTitle should match current; toNodeId/toTitle should match the recommended node.\n"
    )
    user2 = json.dumps(
        {
            "churchId": session.churchId,
            "personId": session.personId,
            "userId": session.userId,
            "timezone": session.timezone,
            "memory": mem or {},
            "journey_context": journey or {},
            "weekly_context": weekly or {},
            "graphdb": {
                "ontologyGraph": ontology_graph,
                "triples": triples,
                "journeyGraphs": graphs,
                "faithJourney": {
                    "namespace": ccfj_prefix,
                    "currentStageId": current_stage_id,
                    "currentNode": current_node,
                    "nodes": list(nodes_by_iri.values())[:6000],
                    "edges": edges[:12000],
                },
            },
        },
        ensure_ascii=False,
    )[:12000]

    r2 = await model.ainvoke([("system", sys2), ("user", user2)])
    raw2 = str(getattr(r2, "content", "") or "").strip()
    j2 = _safe_json_extract(raw2)
    if not isinstance(j2, dict):
        return _json_only_envelope_error("Could not parse predictive journey output.")
    j2["ok"] = True
    if "asOf" not in j2:
        j2["asOf"] = _now_iso()
    if "sparqlUsed" not in j2:
        j2["sparqlUsed"] = [q["name"] for q in qclean]

    # Attach lightweight debug summaries for transparency (no full SPARQL results).
    queries_used: list[dict[str, Any]] = []
    for q in qclean:
        name = str(q.get("name") or "").strip()
        if not name:
            continue
        r = results.get(name) if isinstance(results.get(name), dict) else {}
        tool_res = (r or {}).get("result") if isinstance(r, dict) else None
        ok = bool(isinstance(tool_res, dict) and tool_res.get("ok") is True)
        bindings_count = None
        if ok and isinstance(tool_res, dict):
            payload = tool_res.get("result")
            try:
                if isinstance(payload, dict):
                    bindings = payload.get("results", {}).get("bindings") if isinstance(payload.get("results"), dict) else None
                    if isinstance(bindings, list):
                        bindings_count = len(bindings)
            except Exception:
                bindings_count = None
        queries_used.append(
            {
                "name": name,
                "purpose": str(q.get("purpose") or "").strip(),
                "ok": ok,
                "querySnippet": str(q.get("query") or "").strip().replace("\n", " ")[:260],
                "bindingsCount": bindings_count,
                "timingMs": (r or {}).get("timingMs") if isinstance(r, dict) else None,
            }
        )
    j2["sparqlDebug"] = {
        "totalTimingMs": sparql_total_ms,
        "ontologyGraph": ontology_graph,
        "queriesUsed": queries_used[:20],
        "triples": triples,
        "notes": [
            "If rows=0 with ok=true, the query executed but matched nothing (often wrong IRIs or empty ontology graph).",
            "This run uses a canonical query pack anchored to https://ontology.churchcore.ai/* vocabularies to avoid invented IRIs.",
        ],
    }

    # Normalize/ensure graph grounding fields exist on recommended actions.
    preds = j2.get("predictions")
    if isinstance(preds, list):
        for p in preds:
            if not isinstance(p, dict):
                continue
            cur = p.get("current") if isinstance(p.get("current"), dict) else {}
            cur_id = str((cur or {}).get("nodeId") or "").strip()
            cur_title = str((cur or {}).get("title") or "").strip()
            recs = p.get("recommendedNextActions")
            if not isinstance(recs, list):
                continue
            for a in recs:
                if not isinstance(a, dict):
                    continue
                if cur_id and not str(a.get("fromNodeId") or "").strip():
                    a["fromNodeId"] = cur_id
                if cur_title and not str(a.get("fromTitle") or "").strip():
                    a["fromTitle"] = cur_title
                # Back-compat: if model only filled nodeId/title, mirror to toNodeId/toTitle.
                node_id = str(a.get("toNodeId") or a.get("nodeId") or "").strip()
                node_title = str(a.get("toTitle") or a.get("title") or "").strip()
                if node_id:
                    a["toNodeId"] = node_id
                if node_title:
                    a["toTitle"] = node_title

    n_preds = len(preds) if isinstance(preds, list) else 0
    return OutputEnvelope(
        message=f"SPARQL grounded journey prediction generated. graphs={n_preds}",
        data={"ok": True, "journey_prediction": j2},
    )


async def _propose_memory_ops(
    *,
    model: ChatOpenAI,
    role: str,
    existing_memory: dict[str, Any] | None,
    user_text: str,
    assistant_text: str,
) -> list[dict[str, Any]]:
    """
    Ask the model to propose MemoryOps (gateway applies policy + persistence).
    Keep this small and schema-first.
    """
    role = (role or "seeker").strip().lower()
    sys = (
        "You extract durable person-memory updates from a chat turn.\n"
        "Return STRICT JSON only (no markdown), with shape:\n"
        '{\"memory_ops\":[{\"op\":\"set|append\",\"path\":\"a.b\",\"value\":...,\"visibility\":\"self|team|pastoral|restricted\",\"confidence\":0.0}]}\n'
        "Rules:\n"
        "- Only include ops that are strongly supported by the user's message.\n"
        "- Prefer updating: summary, spiritualJourney.stage, intentProfile.*, identity.preferredName.\n"
        "- If role=seeker: visibility must be \"self\" only.\n"
        "- If role=guide: you may use team/pastoral/restricted when appropriate.\n"
    )
    payload = {
        "role": role,
        "existing_memory": existing_memory or {},
        "user_text": user_text,
        "assistant_text": assistant_text,
    }
    r = await model.ainvoke([("system", sys), ("user", json.dumps(payload, ensure_ascii=False)[:8000])])
    raw = str(getattr(r, "content", "") or "").strip()
    j = _safe_json_loads(raw)
    ops = j.get("memory_ops") if isinstance(j, dict) else None
    out = ops if isinstance(ops, list) else []

    # Minimal normalization + role-based clamp.
    clean: list[dict[str, Any]] = []
    for op in out:
        if not isinstance(op, dict):
            continue
        o = str(op.get("op") or "").strip()
        p = str(op.get("path") or "").strip()
        if o not in {"set", "append"} or not p:
            continue
        vis = str(op.get("visibility") or "self").strip()
        if role != "guide":
            vis = "self"
        conf = op.get("confidence")
        clean.append(
            {
                "op": o,
                "path": p,
                "value": op.get("value"),
                "visibility": vis,
                "confidence": float(conf) if isinstance(conf, (int, float)) else None,
            }
        )
    return clean[:20]


async def handle_seeker_skill(
    *,
    skill: str,
    message: Optional[str],
    args: Optional[dict[str, Any]],
    session: Session,
    tools: list[Any],
) -> OutputEnvelope:
    skill = (skill or "chat").strip()
    args = args if isinstance(args, dict) else {}

    if skill == "calendar.week":
        start = str(args.get("start") or args.get("weekStartISO") or "").strip()
        week_start, from_iso, to_iso = _week_window_iso(start)
        week_end = (datetime.fromisoformat(week_start).date() + timedelta(days=6)).isoformat()

        res = await _call_tool_json(
            tools,
            "churchcore_list_events",
            {
                "churchId": session.churchId,
                "campusId": session.campusId,
                "timezone": session.timezone,
                "fromIso": from_iso,
                "toIso": to_iso,
            },
        )
        if not res:
            return _missing_mcp("churchcore_list_events")

        events = res.get("events") if isinstance(res, dict) else None
        items = [e for e in events if isinstance(e, dict)] if isinstance(events, list) else []

        # Weather: group calls by location and attach a small snapshot for outdoor events.
        by_loc: dict[str, dict[str, float]] = {}
        for e in items:
            is_outdoor = bool(e.get("is_outdoor") or e.get("isOutdoor"))
            lat = e.get("lat")
            lon = e.get("lon")
            if not is_outdoor or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            key = f"{float(lat):.5f},{float(lon):.5f}"
            by_loc[key] = {"lat": float(lat), "lon": float(lon)}

        forecasts: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for key, loc in by_loc.items():
            hourly = await _weather_hourly(tools, lat=loc["lat"], lon=loc["lon"], hours=48) or {}
            daily = await _weather_daily(tools, lat=loc["lat"], lon=loc["lon"], days=8) or {}
            hourly_list = hourly.get("hourly") if isinstance(hourly, dict) else None
            daily_list = daily.get("daily") if isinstance(daily, dict) else None
            forecasts[key] = {
                "hourly": [x for x in hourly_list if isinstance(x, dict)] if isinstance(hourly_list, list) else [],
                "daily": [x for x in daily_list if isinstance(x, dict)] if isinstance(daily_list, list) else [],
            }

        out_items: list[dict[str, Any]] = []
        for e in items:
            out = dict(e)
            is_outdoor = bool(e.get("is_outdoor") or e.get("isOutdoor"))
            lat = e.get("lat")
            lon = e.get("lon")
            start_at = str(e.get("start_at") or "")
            t = _parse_iso_to_unix(start_at) if start_at else None

            weather = None
            if is_outdoor and isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and isinstance(t, int):
                key = f"{float(lat):.5f},{float(lon):.5f}"
                f = forecasts.get(key) or {"hourly": [], "daily": []}
                hourly_list = f.get("hourly") or []
                daily_list = f.get("daily") or []

                if hourly_list:
                    h = _pick_hour(hourly_list, t)
                    if h:
                        desc = None
                        w = h.get("weather")
                        if isinstance(w, list) and w and isinstance(w[0], dict):
                            desc = w[0].get("description")
                        weather = {
                            "summary": str(desc or "Hourly forecast"),
                            "temp": h.get("temp"),
                            "wind_speed": h.get("wind_speed"),
                            "wind_gust": h.get("wind_gust"),
                            "pop": h.get("pop"),
                        }

                if weather is None and daily_list:
                    best = None
                    best_delta = None
                    for d in daily_list:
                        dt = d.get("dt")
                        if not isinstance(dt, int):
                            continue
                        delta = abs(dt - t)
                        if best_delta is None or delta < best_delta:
                            best = d
                            best_delta = delta
                    if best:
                        desc = None
                        w = best.get("weather")
                        if isinstance(w, list) and w and isinstance(w[0], dict):
                            desc = w[0].get("description")
                        temp_max = None
                        temp = best.get("temp")
                        if isinstance(temp, dict):
                            temp_max = temp.get("max")
                        weather = {
                            "summary": str(desc or "Daily forecast"),
                            "temp": temp_max,
                            "wind_speed": best.get("wind_speed"),
                            "wind_gust": best.get("wind_gust"),
                            "pop": best.get("pop"),
                        }

            out["weatherForecast"] = weather
            out_items.append(out)

        schedule = {"asOfISO": _now_iso(), "weekStartISO": week_start, "weekEndISO": week_end, "events": out_items}
        return OutputEnvelope(message="", data={"schedule": schedule})

    if skill in {"journey.predict_flows", "journey.predict"}:
        model = get_chat_model()
        return await _predict_journey_flows_with_sparql(model=model, tools=tools, session=session, args=args)

    if skill == "notify.send_email":
        return OutputEnvelope(
            message="Email sending is only available in guide role.",
            suggested_next_actions=[NextAction(title="Open Guide", skill="chat")],
            data={"skill": skill},
        )

    if skill == "weekly_podcast.analyze":
        provider = _llm_provider()
        model_name = os.environ.get("AI_GATEWAY_MODEL", "ai-gateway") if provider == "ai_gateway" else os.environ.get("OPENAI_MODEL", "gpt-5.2")
        model = get_chat_model()
        src = str(args.get("source_text") or "").strip()
        if len(src) < 20:
            return OutputEnvelope(message="Missing transcript/notes.", data={"skill": skill})

        sys = (
            "You extract a podcast analysis from transcript/notes.\n"
            "Return ONLY valid JSON with keys:\n"
            '- "summary_markdown": string (6-20 bullets/short paragraphs)\n'
            '- "topics": array of short strings (deduped)\n'
            '- "verses": array of scripture references like \"John 13:3-5\" (deduped)\n'
            '- "source": string (e.g. \"user_paste\" or \"openai_whisper\")\n'
        )
        user = (
            f"Podcast id: {args.get('podcast_id')}\n"
            f"Source: {args.get('mp3_url') or 'text'}\n\n"
            "Transcript/notes:\n"
            + src
        )
        raw = model.invoke([{"role": "system", "content": sys}, {"role": "user", "content": user}]).content
        parsed = None
        try:
            parsed = json.loads(str(raw or "{}"))
        except Exception:
            parsed = None

        if not isinstance(parsed, dict):
            return OutputEnvelope(message="Could not parse analysis.", data={"skill": skill})

        summary = str(parsed.get("summary_markdown") or "").strip()
        topics = parsed.get("topics") if isinstance(parsed.get("topics"), list) else []
        verses = parsed.get("verses") if isinstance(parsed.get("verses"), list) else []
        topics_clean = [str(t).strip() for t in topics if str(t).strip()][:50]
        verses_clean = [str(v).strip() for v in verses if str(v).strip()][:80]
        source = str(parsed.get("source") or (args.get("mp3_url") and "openai_whisper") or "user_paste")

        return OutputEnvelope(
            message="",
            data={
                "weekly_podcast_analysis": {
                    "summary_markdown": summary,
                    "topics": topics_clean,
                    "verses": verses_clean,
                    "model": model_name,
                    "source": source,
                }
            },
        )

    if skill == "sermon.compare":
        provider = _llm_provider()
        model_name = os.environ.get("AI_GATEWAY_MODEL", "ai-gateway") if provider == "ai_gateway" else os.environ.get("OPENAI_MODEL", "gpt-5.2")
        model = get_chat_model()
        sermons = args.get("sermons")
        sermons_list = sermons if isinstance(sermons, list) else []
        sermons_clean: list[dict[str, Any]] = []
        for s in sermons_list:
            if not isinstance(s, dict):
                continue
            transcript = s.get("transcript") if isinstance(s.get("transcript"), dict) else {}
            analysis = s.get("analysis") if isinstance(s.get("analysis"), dict) else {}
            sermons_clean.append(
                {
                    "id": s.get("id"),
                    "campusId": s.get("campusId"),
                    "title": s.get("title"),
                    "speaker": s.get("speaker"),
                    "preachedAt": s.get("preachedAt"),
                    "passage": s.get("passage"),
                    "seriesTitle": s.get("seriesTitle"),
                    "notes": {
                        "summaryMarkdown": analysis.get("summaryMarkdown"),
                        "topics": analysis.get("topics"),
                        "verses": analysis.get("verses"),
                        "keyPoints": analysis.get("keyPoints"),
                    },
                    "transcriptText": transcript.get("transcriptText"),
                }
            )

        if len(sermons_clean) < 2:
            return OutputEnvelope(message="Not enough sermons to compare.", data={"skill": skill})

        sys = (
            "You compare 2-3 weekly sermons across campuses.\n"
            "Use the full transcripts as the primary source of truth; the notes/summary are secondary.\n"
            "Do not invent details not supported by the transcripts.\n"
            "At the END of comparison_markdown, include a section titled exactly:\n"
            '"## Theology / Interpretation Differences"\n'
            "- If you detect differences in theological interpretation, doctrine, or meaning, list them as bullets with short evidence.\n"
            '- If none are present, say "No theological/interpretation differences detected.".\n'
            "Then include a section titled exactly:\n"
            '"## Material Differences in What Was Said"\n'
            "- List concrete differences in claims/emphases/stated applications/illustrations as bullets.\n"
            '- If none are present, say "No material differences detected.".\n'
            "Return ONLY valid JSON with keys:\n"
            '- "comparison_markdown": string (with headings and bullets)\n'
            '- "commonalities": array of short strings\n'
            '- "differences_by_campus": object mapping campusId -> array of short strings\n'
            '- "discussion_questions": array of questions for group discussion\n'
        )
        user = json.dumps(
            {
                "instruction": "Compare what is similar and where they differ across campuses; focus on theology, application emphasis, illustrations, tone, and call-to-action. Cite specific transcript phrases sparingly (short quotes only). Always end with the required Theology/Interpretation Differences + Material Differences sections.",
                "sermons": sermons_clean,
            }
        )

        raw = model.invoke([{"role": "system", "content": sys}, {"role": "user", "content": user}]).content
        parsed = None
        try:
            parsed = json.loads(str(raw or "{}"))
        except Exception:
            parsed = None

        if not isinstance(parsed, dict):
            return OutputEnvelope(message="Could not parse comparison.", data={"skill": skill})

        comparison_md = str(parsed.get("comparison_markdown") or "").strip()
        common = parsed.get("commonalities") if isinstance(parsed.get("commonalities"), list) else []
        diffs = parsed.get("differences_by_campus") if isinstance(parsed.get("differences_by_campus"), dict) else {}
        questions = parsed.get("discussion_questions") if isinstance(parsed.get("discussion_questions"), list) else []

        common_clean = [str(x).strip() for x in common if str(x).strip()][:40]
        diffs_clean: dict[str, list[str]] = {}
        for k, v in diffs.items():
            if not isinstance(k, str):
                continue
            vv = v if isinstance(v, list) else []
            diffs_clean[k] = [str(x).strip() for x in vv if str(x).strip()][:40]
        questions_clean = [str(x).strip() for x in questions if str(x).strip()][:30]

        return OutputEnvelope(
            message="",
            data={
                "sermon_comparison": {
                    "comparison_markdown": comparison_md,
                    "commonalities": common_clean,
                    "differences_by_campus": diffs_clean,
                    "discussion_questions": questions_clean,
                    "model": model_name,
                }
            },
        )

    if skill in {"chat", "chat.stream"}:
        model = get_chat_model()
        user = (message or "").strip()
        mem, mem_summary = _memory_context_from_args(args)
        hh_summary = _household_context_from_args(args)
        journey, journey_summary = _journey_context_from_args(args)
        identity_contact_summary = _identity_contact_context_from_args(args)
        weekly, weekly_summary = _weekly_context_from_args(args)

        # Fast path: "open/show X" UI-tool requests shouldn't pay for a full model call.
        ui_handoff_direct = _ui_handoff_for_user_text(user)
        if ui_handoff_direct and _is_short_ui_open_request(user):
            # Keep this terse so the UI can immediately render the right panel.
            title = str(ui_handoff_direct[0].get("title") or "tool").strip().lower()
            msg = "Opening that."
            if title == "calendar":
                msg = "Opening the calendar."
            elif title:
                msg = f"Opening {title}."
            return OutputEnvelope(message=msg, handoff=ui_handoff_direct)

        # If the user is asking an explicit faith-journey / salvation / "next steps" question,
        # ground the answer with GraphDB via SPARQL (canonical journey graphs + edges),
        # then render a short actionable response.
        if user and _wants_sparql_journey(user):
            pred_env = await _predict_journey_flows_with_sparql(model=model, tools=tools, session=session, args=args)
            # Bubble up SPARQL errors loudly so we don't silently fall back to generic chat.
            if isinstance(getattr(pred_env, "data", None), dict) and pred_env.data.get("ok") is False:
                return pred_env
            pred = None
            if isinstance(getattr(pred_env, "data", None), dict):
                pred = pred_env.data.get("journey_prediction")
            if isinstance(pred, dict) and isinstance(pred.get("predictions"), list):
                lines: list[str] = []
                lines.append("Recommended next steps (grounded in the canonical journey graphs):")
                preds = [p for p in (pred.get("predictions") or []) if isinstance(p, dict)]
                for p in preds[:6]:
                    gname = str(p.get("graphName") or p.get("graphId") or "Journey").strip()
                    cur = p.get("current") if isinstance(p.get("current"), dict) else {}
                    cur_title = str((cur or {}).get("title") or "").strip()
                    header = gname
                    if cur_title:
                        header = f"{gname} — current: {cur_title}"
                    lines.append(f"\n{header}")
                    recs = p.get("recommendedNextActions") if isinstance(p.get("recommendedNextActions"), list) else []
                    rec_items = [a for a in recs if isinstance(a, dict)]
                    for a in rec_items[:4]:
                        title = str(a.get("title") or a.get("nodeTitle") or a.get("nodeId") or "").strip()
                        if title:
                            lines.append(f"- {title}")
                out_text = "\n".join([l for l in lines if l.strip()]).strip()
                return OutputEnvelope(
                    message=out_text,
                    handoff=[{"type": "ui_tool", "tool_id": "faith_journey", "title": "Faith journey"}],
                    data={"journey_prediction": pred},
                )
            # If the prediction came back but didn't include the expected structure, fail loudly.
            if isinstance(pred, dict):
                return OutputEnvelope(
                    message="Journey prediction ran, but did not return any predicted next steps.",
                    data={"ok": False, "reason": "journey_prediction_missing_predictions", "journey_prediction": pred},
                )

        # Deterministic: if the user asks for weather, use weather MCP directly.
        u = user.lower()
        if user and any(k in u for k in ["weather", "forecast", "rain", "snow", "wind"]) and not any(
            k in u for k in ["whether", "whatever"]
        ):
            lat, lon, label = _campus_latlon(session.campusId)
            hourly = await _weather_hourly(tools, lat=lat, lon=lon, hours=24) or {}
            hourly_list = hourly.get("hourly") if isinstance(hourly, dict) else None
            pts = [x for x in hourly_list if isinstance(x, dict)] if isinstance(hourly_list, list) else []
            txt = _weather_summary_from_hourly(pts, label)
            return OutputEnvelope(
                message=txt,
                suggested_next_actions=[
                    NextAction(title="Open calendar", skill="chat", args=None),
                ],
                handoff=[{"type": "ui_tool", "tool_id": "calendar", "title": "Calendar"}],
                data={"weather": hourly or {}, "campus": session.campusId},
            )

        # Deterministic: if the user asks to email/remind, send to their own email (if on file).
        if user and any(k in u for k in ["email me", "send me an email", "remind me"]) and "@" not in u:
            person_id = str(session.personId or "").strip()
            person = None
            if person_id:
                person_resp = await _call_tool_json(tools, "churchcore_people_get", {"churchId": session.churchId, "personId": person_id})
                person = person_resp.get("person") if isinstance(person_resp, dict) else None
            email = str(person.get("email") or "").strip() if isinstance(person, dict) else ""
            if not email:
                return OutputEnvelope(
                    message="I can email you, but I don’t have an email address on file yet. Add it in Identity & contact.",
                    handoff=[{"type": "ui_tool", "tool_id": "identity_contact", "title": "Identity & contact"}],
                )
            # Best-effort: send immediate email (scheduling handled in guide role for now).
            body = f"Reminder:\n\n{user}\n\n— Church Agent"
            tool_txt = await _call_tool_text(tools, "sendEmail", {"to": email, "subject": "Reminder", "text": body})
            if tool_txt is None:
                return _missing_mcp("sendgrid_sendEmail")
            return OutputEnvelope(message=f"{tool_txt or 'Email sent.'} (to {email})")

        # Only ground with authoritative church data when the user is asking church questions.
        relevant_docs: list[dict[str, Any]] = []
        church_context = ""
        if user and _should_fetch_church_export(user):
            exported = await _call_tool_json(tools, "churchcore_kb_export_docs", {"churchId": session.churchId, "limitPerTable": 200})
            exported_docs = exported.get("docs") if isinstance(exported, dict) else None
            exported_docs_list = exported_docs if isinstance(exported_docs, list) else []
            relevant_docs = _pick_relevant_docs([d for d in exported_docs_list if isinstance(d, dict)], user, k=3)
            church_context = "\n\n".join([f"SOURCE {d.get('sourceId')}:\n{_as_text(d.get('text'), 6000)}" for d in relevant_docs])

        # If embeddings are configured, also do semantic KB search (for better grounding).
        kb_text = ""
        kb_hits: list[Any] = []
        if user and _should_search_kb(user):
            try:
                kb_ttl = int(float(os.environ.get("KB_INDEX_TTL_SECONDS", "300") or "300"))
                kb_index = await ensure_index_with_mcp(church_id=session.churchId, ttl_seconds=max(30, kb_ttl))
                boosted_query = user
                try:
                    week = (weekly or {}).get("plan", {}).get("week", {}) if isinstance((weekly or {}).get("plan"), dict) else {}
                    week_start = str(week.get("weekStartDate") or "").strip()
                    if week_start:
                        boosted_query = f"{session.campusId} {week_start} {user}".strip()
                except Exception:
                    boosted_query = user
                kb_text, kb_hits = search_kb(kb_index, boosted_query, k=4) if user and kb_index else ("", [])
            except Exception:
                kb_text, kb_hits = ("", [])

        sys = (
            "You are Church Agent in seeker role. Help the person explore faith and take next steps.\n"
            "Do not invent service times, events, groups, or volunteer opportunities. Use ONLY the provided church data excerpt.\n"
            "Always be warm, concise, and propose 1-3 next actions.\n\n"
            "If week-scoped sermon/plan context is provided, prefer it for: verse-of-the-day, Bible study prompts, and discussion questions.\n"
            "When the user says 'this week', interpret it as the provided weekly context.\n\n"
            "Client UI tools available (use handoff items when helpful):\n"
            "- church_overview: show church overview (logo, campuses, service times).\n"
            "- strategic_intent: show purpose/vision/mission/strategy (church strategic intent).\n"
            "- calendar: show events calendar (week view, with outdoor weather).\n"
            "- bible_reader: read Bible passages (WEB text in-panel, NIV link).\n"
            "- household_manager: manage household (kids, custody notes, allergies; authorized pickup + extended family).\n"
            "- weekly_sermons: browse sermons by campus; view cached summary/topics/verses/transcript.\n"
            "- kids_checkin: run kids check-in flow (find family, preview rooms, commit check-in).\n"
            "- guide: show journey position + next steps + resources.\n"
            "- memory_manager: manage person memory areas (hub).\n"
            "- groups_manager: manage my long-lived groups (roster, invites, schedule, group Bible study).\n"
            "- identity_contact: view/edit preferred name + email/phone.\n"
            "- faith_journey: view/edit faith journey phase and milestones (Seeker, New Believer, Growing, etc.).\n"
            "- comm_prefs: view/edit communication preferences (SMS/email opt-in, preferred channel).\n"
            "- care_pastoral: manage prayer requests (and staff-only care notes).\n"
            "- teams_skills: staff-only serving teams/skills.\n"
            'If a UI tool should open, include a handoff item like: {"type":"ui_tool","tool_id":"identity_contact"}.\n\n'
            + (("Identity/contact context (authoritative):\n" + identity_contact_summary + "\n\n") if identity_contact_summary else "")
            + (("Faith journey context:\n" + journey_summary + "\n\n") if journey_summary else "")
            + (("This week context:\n" + weekly_summary + "\n\n") if weekly_summary else "")
            + (("Known person memory (shared across topics):\n" + mem_summary + "\n\n") if mem_summary else "")
            + (("Household context:\n" + hh_summary + "\n\n") if hh_summary else "")
            + (("Authoritative church data excerpt:\n" + church_context + "\n\n") if church_context else "")
            + (kb_text + "\n\n" if kb_text else "")
        )
        if not user:
            return OutputEnvelope(
                message="What’s on your mind today?",
                suggested_next_actions=[
                    NextAction(title="Service times", skill="discover.service_times"),
                    NextAction(title="Upcoming events", skill="discover.events"),
                    NextAction(title="Small groups", skill="discover.groups"),
                ],
            )
        r = await model.ainvoke([("system", sys), ("user", user)])
        txt = getattr(r, "content", "") if r else ""
        out_text = str(txt or "").strip() or "How can I help?"
        ui_handoff = _ui_handoff_for_user_text(user)

        # If the assistant recommends scripture references, offer the Bible reader tool.
        # (UI also auto-links refs, but this makes the right panel discoverable.)
        try:
            scripture_re = r"\b(?:[1-3]\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+\d{1,3}:\d{1,3}(?:[-–—]\d{1,3})?(?:,\s*\d{1,3}(?:[-–—]\d{1,3})?)*\b"
            has_scripture = bool(__import__("re").search(scripture_re, out_text or ""))
        except Exception:
            has_scripture = False
        if has_scripture and not any(isinstance(h, dict) and h.get("type") == "ui_tool" and h.get("tool_id") == "bible_reader" for h in ui_handoff):
            ui_handoff = [
                *ui_handoff,
                {
                    "type": "ui_tool",
                    "tool_id": "bible_reader",
                    "title": "Bible",
                    "instructions": "Open the Bible reader for recommended passages.",
                },
            ]
        memory_ops: list[dict[str, Any]] = []
        if _should_propose_memory_ops(user):
            try:
                memory_ops = await _propose_memory_ops(
                    model=model,
                    role=str(session.role or "seeker"),
                    existing_memory=mem,
                    user_text=user,
                    assistant_text=out_text,
                )
            except Exception:
                memory_ops = []

        return OutputEnvelope(
            message=out_text,
            suggested_next_actions=[
                NextAction(title="Service times", skill="discover.service_times"),
                NextAction(title="Upcoming events", skill="discover.events"),
                NextAction(title="Request contact", skill="connect.request_contact"),
            ],
            cards=_cards_from_export_docs(relevant_docs),
            handoff=ui_handoff,
            citations=([{"sourceId": h.sourceId, "snippet": h.snippet} for h in kb_hits] if kb_hits else _citations_from_docs(relevant_docs)),
            data={"memory_ops": memory_ops, "memory_summary_used": mem_summary},
        )

    # Aliases (spec names)
    if skill == "discover.volunteer_opportunities":
        skill = "discover.volunteer_opportunities"

    if skill == "discover.service_times":
        res = await _call_tool_json(
            tools,
            "churchcore_list_services",
            {"churchId": session.churchId, "campusId": session.campusId, "timezone": session.timezone},
        )
        if not res:
            return _missing_mcp("churchcore_list_services")
        services = res.get("services") if isinstance(res, dict) else None
        items = services if isinstance(services, list) else []
        return OutputEnvelope(
            message="Here are the service times.",
            cards=[{"type": "services", "title": "Service times", "items": items}],
            suggested_next_actions=[NextAction(title="Upcoming events", skill="discover.events")],
            data={"services": items},
        )

    if skill == "discover.events":
        res = await _call_tool_json(
            tools,
            "churchcore_list_events",
            {"churchId": session.churchId, "campusId": session.campusId, "timezone": session.timezone},
        )
        if not res:
            return _missing_mcp("churchcore_list_events")
        events = res.get("events") if isinstance(res, dict) else None
        items = events if isinstance(events, list) else []
        return OutputEnvelope(
            message="Here are upcoming events.",
            cards=[{"type": "events", "title": "Upcoming events", "items": items}],
            suggested_next_actions=[
                NextAction(title="Small groups", skill="discover.groups"),
                NextAction(title="Volunteer opportunities", skill="discover.volunteer_opportunities"),
            ],
            data={"events": items},
        )

    if skill == "discover.groups":
        res = await _call_tool_json(
            tools,
            "churchcore_list_groups",
            {"churchId": session.churchId, "campusId": session.campusId},
        )
        if not res:
            return _missing_mcp("churchcore_list_groups")
        groups = res.get("groups") if isinstance(res, dict) else None
        items = groups if isinstance(groups, list) else []
        return OutputEnvelope(
            message="Here are groups you can join.",
            cards=[{"type": "groups", "title": "Groups", "items": items}],
            suggested_next_actions=[NextAction(title="Request contact", skill="connect.request_contact")],
            data={"groups": items},
        )

    if skill == "discover.volunteer_opportunities":
        res = await _call_tool_json(tools, "churchcore_list_volunteer_opportunities", {"churchId": session.churchId})
        if not res:
            return _missing_mcp("churchcore_list_volunteer_opportunities")
        opps = res.get("opportunities") if isinstance(res, dict) else None
        items = opps if isinstance(opps, list) else []
        return OutputEnvelope(
            message="Here are volunteer opportunities.",
            cards=[{"type": "opportunities", "title": "Volunteer opportunities", "items": items}],
            suggested_next_actions=[NextAction(title="Submit serving interest", skill="serve.submit_interest")],
            data={"opportunities": items},
        )

    if skill == "connect.request_contact":
        payload = {
            "churchId": session.churchId,
            "userId": session.userId,
            "name": args.get("name"),
            "email": args.get("email"),
            "phone": args.get("phone"),
            "message": args.get("message") or message,
        }
        res = await _call_tool_json(tools, "churchcore_request_contact", payload)
        if not res:
            return _missing_mcp("churchcore_request_contact")
        return OutputEnvelope(
            message="Thanks — we’ll reach out soon.",
            cards=[{"type": "request", "title": "Contact request submitted", "body": f"requestId={res.get('requestId')}"}],
            data=res,
        )

    if skill == "connect.schedule_visit":
        payload = {
            "churchId": session.churchId,
            "userId": session.userId,
            "preferredDate": args.get("preferredDate"),
            "preferredServiceId": args.get("preferredServiceId"),
            "notes": args.get("notes") or message,
        }
        res = await _call_tool_json(tools, "churchcore_schedule_visit_request", payload)
        if not res:
            return _missing_mcp("churchcore_schedule_visit_request")
        return OutputEnvelope(
            message="Visit request submitted.",
            cards=[{"type": "request", "title": "Visit request", "body": f"requestId={res.get('requestId')}"}],
            data=res,
        )

    if skill in {"serve.start_onboarding", "serve.submit_interest"}:
        payload = {
            "churchId": session.churchId,
            "userId": session.userId,
            "interests": args.get("interests"),
            "notes": args.get("notes") or message,
        }
        res = await _call_tool_json(tools, "churchcore_submit_serve_interest", payload)
        if not res:
            return _missing_mcp("churchcore_submit_serve_interest")
        return OutputEnvelope(
            message="Got it — we’ll follow up about serving.",
            cards=[{"type": "request", "title": "Serve interest submitted", "body": f"requestId={res.get('requestId')}"}],
            data=res,
        )

    if skill == "care.submit_prayer_request":
        payload = {
            "churchId": session.churchId,
            "userId": session.userId,
            "request": args.get("request") or message,
            "isPrivate": bool(args.get("isPrivate", True)),
        }
        res = await _call_tool_json(tools, "churchcore_submit_prayer_request", payload)
        if not res:
            return _missing_mcp("churchcore_submit_prayer_request")
        return OutputEnvelope(
            message="Thank you — your prayer request has been received.",
            cards=[{"type": "request", "title": "Prayer request submitted", "body": f"requestId={res.get('requestId')}"}],
            data=res,
        )

    if skill == "care.request_pastoral_care":
        req_txt = args.get("request") or message
        if not isinstance(req_txt, str) or not req_txt.strip():
            return OutputEnvelope(
                message="What would you like care about?",
                forms=[
                    {
                        "type": "pastoral_care_request",
                        "fields": [
                            {"name": "request", "type": "textarea", "required": True},
                            {"name": "urgency", "type": "select", "options": ["low", "normal", "high"], "required": False},
                            {"name": "safeToText", "type": "checkbox", "required": False},
                        ],
                    }
                ],
            )
        payload = {
            "churchId": session.churchId,
            "userId": session.userId,
            "request": req_txt,
            "urgency": args.get("urgency") or "normal",
            "safeToText": bool(args.get("safeToText", False)),
        }
        res = await _call_tool_json(tools, "churchcore_request_pastoral_care", payload)
        if not res:
            return _missing_mcp("churchcore_request_pastoral_care")
        return OutputEnvelope(
            message="Thanks — a care team member will follow up.",
            cards=[{"type": "request", "title": "Pastoral care request submitted", "body": f"requestId={res.get('requestId')}"}],
            data=res,
        )

    if skill == "profile.permissions_check":
        res = await _call_tool_json(
            tools, "churchcore_permissions_check", {"churchId": session.churchId, "userId": session.userId}
        )
        if not res:
            return OutputEnvelope(
                message="Permissions (client-side only).",
                cards=[
                    {
                        "type": "permissions",
                        "title": "Permissions",
                        "items": [
                            {"role": session.role},
                            {"isAuthenticated": bool(session.auth and session.auth.isAuthenticated)},
                            {"roles": (session.auth.roles if session.auth else [])},
                        ],
                    }
                ],
            )
        return OutputEnvelope(
            message="Permissions check result.",
            cards=[{"type": "permissions", "title": "Permissions", "items": [res]}],
            data=res,
        )

    if skill == "profile.membership_status":
        res = await _call_tool_json(tools, "churchcore_membership_status", {"churchId": session.churchId, "userId": session.userId})
        if not res:
            return _missing_mcp("churchcore_membership_status")
        return OutputEnvelope(message="Membership status.", cards=[{"type": "membership", "title": "Membership", "items": [res]}], data=res)

    return OutputEnvelope(
        message=f"Unknown seeker skill: {skill}",
        suggested_next_actions=[
            NextAction(title="Service times", skill="discover.service_times"),
            NextAction(title="Upcoming events", skill="discover.events"),
        ],
        data={"skill": skill},
    )


async def handle_guide_skill(
    *,
    skill: str,
    message: Optional[str],
    args: Optional[dict[str, Any]],
    session: Session,
    tools: list[Any],
) -> OutputEnvelope:
    skill = (skill or "chat").strip()
    args = args if isinstance(args, dict) else {}

    if skill == "calendar.week":
        # Not sensitive; allow even if guide permission isn't configured.
        return await handle_seeker_skill(skill=skill, message=message, args=args, session=session, tools=tools)

    if skill in {"journey.predict_flows", "journey.predict"}:
        model = get_chat_model()
        return await _predict_journey_flows_with_sparql(model=model, tools=tools, session=session, args=args)

    if skill == "notify.send_email":
        to = str(args.get("to") or "").strip()
        subject = str(args.get("subject") or "").strip() or "Message from your church"
        text = str(args.get("text") or "").strip()
        html = args.get("html")
        payload: dict[str, Any] = {"to": to, "subject": subject}
        if text:
            payload["text"] = text
        if isinstance(html, str) and html.strip():
            payload["html"] = html.strip()
        if not to:
            return OutputEnvelope(message="Missing required arg: to", data={"skill": skill})
        tool_txt = await _call_tool_text(tools, "sendEmail", payload)
        if tool_txt is None:
            return _missing_mcp("sendgrid_sendEmail")
        return OutputEnvelope(message=tool_txt or "Email sent.", data={"to": to, "subject": subject})

    if skill == "notify.schedule_email":
        to = str(args.get("to") or "").strip()
        subject = str(args.get("subject") or "").strip() or "Reminder"
        text = str(args.get("text") or "").strip()
        send_at = args.get("send_at")
        try:
            send_at_i = int(send_at) if isinstance(send_at, (int, float, str)) and str(send_at).strip() else 0
        except Exception:
            send_at_i = 0
        if not to:
            return OutputEnvelope(message="Missing required arg: to", data={"skill": skill})
        if send_at_i <= 0:
            return OutputEnvelope(message="Missing/invalid required arg: send_at (unix seconds)", data={"skill": skill})
        payload: dict[str, Any] = {"to": to, "subject": subject, "send_at": send_at_i}
        if text:
            payload["text"] = text
        tool_txt = await _call_tool_text(tools, "scheduleEmail", payload)
        if tool_txt is None:
            return _missing_mcp("sendgrid_scheduleEmail")
        return OutputEnvelope(message=tool_txt or f"Email scheduled (send_at={send_at_i}).", data={"to": to, "subject": subject, "send_at": send_at_i})

    if skill == "weekly_podcast.analyze":
        # Same behavior as seeker: produce structured analysis for caching.
        return await handle_seeker_skill(skill=skill, message=message, args=args, session=session, tools=tools)

    if not await _require_guide_permission(session, tools):
        return _permission_denied()

    if skill in {"chat", "chat.stream"}:
        model = get_chat_model()
        kb_ttl = int(float(os.environ.get("KB_INDEX_TTL_SECONDS", "300") or "300"))
        kb_index = await ensure_index_with_mcp(church_id=session.churchId, ttl_seconds=max(30, kb_ttl))
        kb_text, kb_hits = search_kb(kb_index, (message or "").strip(), k=4) if (message or "").strip() and kb_index else ("", [])
        sys = (
            "You are Church Agent in guide role. Be concise and operational.\n"
            "You can triage, create follow-ups, and write notes via ChurchCore MCP.\n"
            "If asked for restricted operations, confirm permissions and use the appropriate tool.\n\n"
            + (kb_text + "\n\n" if kb_text else "")
        )
        user = (message or "").strip()
        if not user:
            return OutputEnvelope(
                message="What do you want to do?",
                suggested_next_actions=[
                    NextAction(title="Assigned seekers", skill="guide.view_assigned_seekers"),
                    NextAction(title="Open care requests", skill="care.view_requests"),
                ],
            )
        r = await model.ainvoke([("system", sys), ("user", user)])
        txt = getattr(r, "content", "") if r else ""
        return OutputEnvelope(
            message=str(txt or "").strip() or "How can I help?",
            suggested_next_actions=[
                NextAction(title="Assigned seekers", skill="guide.view_assigned_seekers"),
                NextAction(title="Open care requests", skill="care.view_requests"),
            ],
            citations=[{"sourceId": h.sourceId, "snippet": h.snippet} for h in kb_hits],
        )

    if skill == "guide.view_assigned_seekers":
        res = await _call_tool_json(tools, "churchcore_list_assigned_seekers", {"churchId": session.churchId, "guideUserId": session.userId})
        if not res:
            return _missing_mcp("churchcore_list_assigned_seekers")
        seekers = res.get("seekers") if isinstance(res, dict) else None
        items = seekers if isinstance(seekers, list) else []
        return OutputEnvelope(
            message="Assigned seekers.",
            cards=[{"type": "seekers", "title": "Assigned seekers", "items": items}],
            suggested_next_actions=[
                NextAction(
                    title="Add note to first seeker",
                    skill="guide.add_note_to_seeker",
                    args={"seekerId": (items[0].get("id") if items and isinstance(items[0], dict) else None), "note": "Checked in; next step: schedule a visit."},
                )
            ]
            if items
            else [],
            data={"seekers": items},
        )

    if skill == "guide.add_note_to_seeker":
        seeker_id = args.get("seekerId")
        note = args.get("note") or message
        if not isinstance(seeker_id, str) or not seeker_id.strip() or not isinstance(note, str) or not note.strip():
            return OutputEnvelope(
                message="Missing seekerId or note.",
                forms=[
                    {
                        "type": "note",
                        "fields": [
                            {"name": "seekerId", "type": "text", "required": True},
                            {"name": "note", "type": "textarea", "required": True},
                        ],
                    }
                ],
            )
        res = await _call_tool_json(
            tools,
            "churchcore_append_journey_note",
            {"churchId": session.churchId, "seekerId": seeker_id, "authorUserId": session.userId, "note": note},
        )
        if not res:
            return _missing_mcp("churchcore_append_journey_note")
        return OutputEnvelope(
            message="Note added.",
            cards=[{"type": "note", "title": "Journey note appended", "body": f"noteId={res.get('noteId')}"}],
            data=res,
        )

    if skill == "care.view_requests":
        res = await _call_tool_json(tools, "churchcore_list_requests", {"churchId": session.churchId, "status": "open"})
        if not res:
            return _missing_mcp("churchcore_list_requests")
        reqs = res.get("requests") if isinstance(res, dict) else None
        items = reqs if isinstance(reqs, list) else []
        return OutputEnvelope(
            message="Open care queue.",
            cards=[{"type": "requests", "title": "Open requests", "items": items}],
            data={"requests": items},
        )

    if skill == "guide.view_seeker_profile":
        seeker_id = args.get("seekerId")
        if not isinstance(seeker_id, str) or not seeker_id.strip():
            return OutputEnvelope(
                message="Missing seekerId.",
                forms=[{"type": "seeker_profile", "fields": [{"name": "seekerId", "type": "text", "required": True}]}],
            )
        res = await _call_tool_json(tools, "churchcore_get_seeker_profile", {"churchId": session.churchId, "seekerId": seeker_id})
        if not res:
            return _missing_mcp("churchcore_get_seeker_profile")
        return OutputEnvelope(message="Seeker profile.", cards=[{"type": "seeker_profile", "title": "Seeker profile", "items": [res.get("seeker")]}], data=res)

    if skill == "guide.view_journey_state":
        seeker_id = args.get("seekerId")
        if not isinstance(seeker_id, str) or not seeker_id.strip():
            return OutputEnvelope(
                message="Missing seekerId.",
                forms=[{"type": "journey_state", "fields": [{"name": "seekerId", "type": "text", "required": True}]}],
            )
        res = await _call_tool_json(tools, "churchcore_get_journey_state", {"churchId": session.churchId, "seekerId": seeker_id})
        if not res:
            return _missing_mcp("churchcore_get_journey_state")
        return OutputEnvelope(message="Journey state.", cards=[{"type": "journey_state", "title": "Journey state", "items": [res]}], data=res)

    if skill == "guide.create_followup_task":
        seeker_id = args.get("seekerId")
        title = args.get("title") or "Follow up"
        if not isinstance(seeker_id, str) or not seeker_id.strip():
            return OutputEnvelope(
                message="Missing seekerId.",
                forms=[
                    {
                        "type": "create_followup",
                        "fields": [
                            {"name": "seekerId", "type": "text", "required": True},
                            {"name": "title", "type": "text", "required": True},
                            {"name": "dueAt", "type": "text", "required": False},
                            {"name": "notes", "type": "textarea", "required": False},
                        ],
                    }
                ],
            )
        res = await _call_tool_json(
            tools,
            "churchcore_create_followup_task",
            {
                "churchId": session.churchId,
                "seekerId": seeker_id,
                "assignedToUserId": session.userId,
                "title": title,
                "dueAt": args.get("dueAt"),
                "notes": args.get("notes") or message,
                "actorUserId": session.userId,
            },
        )
        if not res:
            return _missing_mcp("churchcore_create_followup_task")
        return OutputEnvelope(message="Follow-up created.", cards=[{"type": "followup", "title": "Follow-up task", "items": [res]}], data=res)

    # Stubs for remaining guide skills (return envelope; expand later)
    if skill.startswith("guide.") or skill.startswith("group.") or skill.startswith("serve.") or skill.startswith("insights.") or skill == "profile.role_bindings":
        return OutputEnvelope(
            message=f"Not implemented yet: {skill}",
            suggested_next_actions=[
                NextAction(title="Assigned seekers", skill="guide.view_assigned_seekers"),
                NextAction(title="Open care requests", skill="care.view_requests"),
            ],
            data={"skill": skill},
        )

    if skill == "care.assign_case":
        request_id = args.get("requestId")
        assigned_to = args.get("assignedToUserId") or session.userId
        if not isinstance(request_id, str) or not request_id.strip():
            return OutputEnvelope(
                message="Missing requestId.",
                forms=[{"type": "assign_case", "fields": [{"name": "requestId", "type": "text", "required": True}]}],
            )
        res = await _call_tool_json(
            tools,
            "churchcore_assign_care_case",
            {"churchId": session.churchId, "requestId": request_id, "assignedToUserId": assigned_to, "actorUserId": session.userId},
        )
        if not res:
            return _missing_mcp("churchcore_assign_care_case")
        return OutputEnvelope(message="Case assigned.", data=res)

    if skill == "care.escalate_to_staff":
        request_id = args.get("requestId")
        if not isinstance(request_id, str) or not request_id.strip():
            return OutputEnvelope(
                message="Missing requestId.",
                forms=[{"type": "escalate_case", "fields": [{"name": "requestId", "type": "text", "required": True}, {"name": "reason", "type": "textarea"}]}],
            )
        res = await _call_tool_json(
            tools,
            "churchcore_escalate_to_staff",
            {"churchId": session.churchId, "requestId": request_id, "actorUserId": session.userId, "reason": args.get("reason")},
        )
        if not res:
            return _missing_mcp("churchcore_escalate_to_staff")
        return OutputEnvelope(message="Case escalated.", data=res)

    if skill == "care.close_case":
        request_id = args.get("requestId")
        if not isinstance(request_id, str) or not request_id.strip():
            return OutputEnvelope(
                message="Missing requestId.",
                forms=[{"type": "close_case", "fields": [{"name": "requestId", "type": "text", "required": True}, {"name": "resolution", "type": "textarea"}]}],
            )
        res = await _call_tool_json(
            tools,
            "churchcore_close_case",
            {"churchId": session.churchId, "requestId": request_id, "actorUserId": session.userId, "resolution": args.get("resolution")},
        )
        if not res:
            return _missing_mcp("churchcore_close_case")
        return OutputEnvelope(message="Case closed.", data=res)

    if skill == "profile.permissions_check":
        res = await _call_tool_json(tools, "churchcore_permissions_check", {"churchId": session.churchId, "userId": session.userId, "requestedRole": "guide"})
        if not res:
            return _missing_mcp("churchcore_permissions_check")
        return OutputEnvelope(message="Permissions check result.", cards=[{"type": "permissions", "title": "Permissions", "items": [res]}], data=res)

    return OutputEnvelope(message=f"Unknown guide skill: {skill}", data={"skill": skill})


async def run_church_agent(inp: Input) -> OutputEnvelope:
    try:
        tools = await load_mcp_tools_from_env()
        tools = tools if isinstance(tools, list) else []
        session = inp.session
        role = session.role

        if role == "guide":
            return await handle_guide_skill(skill=inp.skill, message=inp.message, args=inp.args, session=session, tools=tools)

        return await handle_seeker_skill(skill=inp.skill, message=inp.message, args=inp.args, session=session, tools=tools)
    except Exception as e:
        tr = traceback.format_exc()
        # Keep trace bounded so it fits in LangSmith outputs.
        tr_tail = tr[-8000:] if isinstance(tr, str) else str(tr or "")[-8000:]
        return OutputEnvelope(
            message="Internal error in church_agent. See data.trace.",
            data={
                "ok": False,
                "error": "church_agent_exception",
                "detail": str(getattr(e, "message", "") or str(e) or "error"),
                "trace": tr_tail,
            },
        )

