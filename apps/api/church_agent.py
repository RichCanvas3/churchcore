from __future__ import annotations

import json
import os
from typing import Any, Optional

from langchain_openai import ChatOpenAI

from .knowledge_index import ensure_index_with_mcp, search_kb
from .mcp_tools import load_mcp_tools_from_env
from .models import Input, NextAction, OutputEnvelope, Session


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

    kids_safetyish = any(k in u for k in ["kids safety", "authorized pickup", "authorised pickup", "custody", "allergy note", "release to", "do not release"])
    if kids_safetyish:
        return [
            {
                "type": "ui_tool",
                "tool_id": "kids_safety",
                "title": "Kids safety",
                "instructions": "Open the kids safety panel.",
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
    raw = await tool.ainvoke(payload if isinstance(payload, dict) else {})
    return _tool_raw_to_json(raw)


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


def _safe_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


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

    if skill in {"chat", "chat.stream"}:
        model = ChatOpenAI(model=os.environ.get("OPENAI_MODEL", "gpt-5.2"))
        user = (message or "").strip()
        mem, mem_summary = _memory_context_from_args(args)
        hh_summary = _household_context_from_args(args)
        journey, journey_summary = _journey_context_from_args(args)

        # Always ground church-specific questions in authoritative ChurchCore D1 data.
        # (No hallucinated service times/events/groups/resources.)
        exported = await _call_tool_json(tools, "churchcore_kb_export_docs", {"churchId": session.churchId, "limitPerTable": 200})
        exported_docs = exported.get("docs") if isinstance(exported, dict) else None
        exported_docs_list = exported_docs if isinstance(exported_docs, list) else []
        relevant_docs = _pick_relevant_docs([d for d in exported_docs_list if isinstance(d, dict)], user, k=3) if user else []
        church_context = "\n\n".join([f"SOURCE {d.get('sourceId')}:\n{_as_text(d.get('text'), 6000)}" for d in relevant_docs])

        # If embeddings are configured, also do semantic KB search (for better grounding).
        kb_text = ""
        kb_hits: list[Any] = []
        try:
            kb_ttl = int(float(os.environ.get("KB_INDEX_TTL_SECONDS", "300") or "300"))
            kb_index = await ensure_index_with_mcp(church_id=session.churchId, ttl_seconds=max(30, kb_ttl))
            kb_text, kb_hits = search_kb(kb_index, user, k=4) if user and kb_index else ("", [])
        except Exception:
            kb_text, kb_hits = ("", [])

        sys = (
            "You are Church Agent in seeker role. Help the person explore faith and take next steps.\n"
            "Do not invent service times, events, groups, or volunteer opportunities. Use ONLY the provided church data excerpt.\n"
            "Always be warm, concise, and propose 1-3 next actions.\n\n"
            "Client UI tools available (use handoff items when helpful):\n"
            "- church_overview: show church overview (logo, campuses, service times).\n"
            "- strategic_intent: show purpose/vision/mission/strategy (church strategic intent).\n"
            "- household_manager: manage household members (add/edit/remove kids, allergies, special needs).\n"
            "- kids_checkin: run kids check-in flow (find family, preview rooms, commit check-in).\n"
            "- guide: show journey position + next steps + resources.\n"
            "- memory_manager: manage person memory areas (hub).\n"
            "- identity_contact: view/edit preferred name + email/phone.\n"
            "- faith_journey: view/edit faith journey phase and milestones (Seeker, New Believer, Growing, etc.).\n"
            "- comm_prefs: view/edit communication preferences (SMS/email opt-in, preferred channel).\n"
            "- care_pastoral: manage prayer requests (and staff-only care notes).\n"
            "- teams_skills: staff-only serving teams/skills.\n"
            "- kids_safety: staff-only kids safety notes.\n"
            'If a UI tool should open, include a handoff item like: {"type":"ui_tool","tool_id":"identity_contact"}.\n\n'
            + (("Faith journey context:\n" + journey_summary + "\n\n") if journey_summary else "")
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
        memory_ops: list[dict[str, Any]] = []
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

    if not await _require_guide_permission(session, tools):
        return _permission_denied()

    if skill in {"chat", "chat.stream"}:
        model = ChatOpenAI(model=os.environ.get("OPENAI_MODEL", "gpt-5.2"))
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
    tools = await load_mcp_tools_from_env()
    session = inp.session
    role = session.role

    if role == "guide":
        return await handle_guide_skill(skill=inp.skill, message=inp.message, args=inp.args, session=session, tools=tools)

    return await handle_seeker_skill(skill=inp.skill, message=inp.message, args=inp.args, session=session, tools=tools)

