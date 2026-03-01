from __future__ import annotations

from typing import Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage
from langgraph.graph import END, StateGraph

from apps.api.church_agent import run_church_agent
from apps.api.models import Input, OutputEnvelope, Session


class GraphState(TypedDict, total=False):
    input: dict[str, Any]
    output: dict[str, Any]
    messages: list[BaseMessage]


async def assistant_node(state: GraphState) -> GraphState:
    input_dict = state.get("input") or {}
    if not isinstance(input_dict, dict):
        out = OutputEnvelope(message="Invalid input.").model_dump()
        return {"output": out, "messages": [AIMessage(content=out["message"])]}

    session_dict = input_dict.get("session") or {}
    if not isinstance(session_dict, dict):
        out = OutputEnvelope(message="Missing session.").model_dump()
        return {"output": out, "messages": [AIMessage(content=out["message"])]}

    try:
        session = Session(**session_dict)
        inp = Input(
            skill=str(input_dict.get("skill") or "chat"),
            message=input_dict.get("message"),
            args=input_dict.get("args"),
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

