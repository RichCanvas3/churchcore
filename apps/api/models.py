from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class AuthContext(BaseModel):
    isAuthenticated: bool = False
    roles: list[str] = Field(default_factory=list)


class Session(BaseModel):
    churchId: str
    campusId: Optional[str] = None
    timezone: str = "UTC"
    userId: str
    personId: Optional[str] = None
    role: Literal["seeker", "guide"]
    auth: Optional[AuthContext] = None
    threadId: Optional[str] = None


class Input(BaseModel):
    skill: str = "chat"
    message: Optional[str] = None
    args: Optional[dict[str, Any]] = None
    session: Session


class NextAction(BaseModel):
    title: str
    skill: str
    args: Optional[dict[str, Any]] = None


class OutputEnvelope(BaseModel):
    message: str
    suggested_next_actions: list[NextAction] = Field(default_factory=list)
    cards: list[dict[str, Any]] = Field(default_factory=list)
    forms: list[dict[str, Any]] = Field(default_factory=list)
    handoff: list[dict[str, Any]] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    citations: list[dict[str, Any]] = Field(default_factory=list)

