from __future__ import annotations

from typing import Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage
from langgraph.graph import END, StateGraph

from apps.api.church_agent import run_church_agent
from apps.api.models import Input, OutputEnvelope, Session


class GraphState(TypedDict, total=False):
    # LangGraph initializes state from the API `input` payload.
    # Our Next.js proxy sends {skill, message, args, session} at the top level.
    skill: str
    message: Any
    args: Any
    session: dict[str, Any]

    # Back-compat: some clients may nest under `input`.
    input: dict[str, Any]

    output: dict[str, Any]
    messages: list[BaseMessage]


async def assistant_node(state: GraphState) -> GraphState:
    input_dict = state.get("input")
    if isinstance(input_dict, dict):
        payload = input_dict
    else:
        payload = {
            "skill": state.get("skill"),
            "message": state.get("message"),
            "args": state.get("args"),
            "session": state.get("session"),
        }

    session_dict = payload.get("session") or {}
    if not isinstance(session_dict, dict):
        out = OutputEnvelope(message="Missing session.").model_dump()
        return {"output": out, "messages": [AIMessage(content=out["message"])]}

    try:
        session = Session(**session_dict)
        inp = Input(
            skill=str(payload.get("skill") or "chat"),
            message=payload.get("message"),
            args=payload.get("args"),
            session=session,
        )
    except Exception as e:
        out = OutputEnvelope(message=f"Invalid input: {e}").model_dump()
        return {"output": out, "messages": [AIMessage(content=out["message"])]}

    result = await run_church_agent(inp)
    out = result.model_dump()
    return {"output": out, "messages": [AIMessage(content=str(out.get("message", "")))]}


builder: StateGraph = StateGraph(GraphState)
builder.add_node("assistant", assistant_node)
builder.set_entry_point("assistant")
builder.add_edge("assistant", END)

graph = builder.compile()

