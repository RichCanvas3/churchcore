from __future__ import annotations

import json
import os
from typing import Any, Optional

from langchain_openai import ChatOpenAI

from .knowledge_index import ensure_index_with_mcp, search_kb
from .mcp_tools import load_mcp_tools_from_env
from .models import Input, NextAction, OutputEnvelope, Session


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
        kb_ttl = int(float(os.environ.get("KB_INDEX_TTL_SECONDS", "300") or "300"))
        kb_index = await ensure_index_with_mcp(church_id=session.churchId, ttl_seconds=max(30, kb_ttl))
        kb_text, kb_hits = search_kb(kb_index, (message or "").strip(), k=4) if (message or "").strip() and kb_index else ("", [])
        sys = (
            "You are Church Agent in seeker role. Help the person explore faith and take next steps.\n"
            "Do not invent service times, events, groups, or volunteer opportunities; instead suggest discover skills.\n"
            "Always be warm, concise, and propose 1-3 next actions.\n\n"
            + (kb_text + "\n\n" if kb_text else "")
        )
        user = (message or "").strip()
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
        return OutputEnvelope(
            message=str(txt or "").strip() or "How can I help?",
            suggested_next_actions=[
                NextAction(title="Service times", skill="discover.service_times"),
                NextAction(title="Upcoming events", skill="discover.events"),
                NextAction(title="Request contact", skill="connect.request_contact"),
            ],
            citations=[{"sourceId": h.sourceId, "snippet": h.snippet} for h in kb_hits],
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

