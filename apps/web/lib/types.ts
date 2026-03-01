export type Session = {
  churchId: string;
  campusId?: string | null;
  timezone: string;
  userId: string;
  personId?: string | null;
  role: "seeker" | "guide";
  auth?: { isAuthenticated: boolean; roles: string[] };
  threadId?: string | null;
};

export type AgentInput = {
  skill: string;
  message?: string | null;
  args?: Record<string, unknown> | null;
  session: Session;
};

export type OutputEnvelope = {
  message: string;
  suggested_next_actions: Array<{ title: string; skill: string; args?: Record<string, unknown> }>;
  cards: Array<Record<string, unknown>>;
  forms: Array<Record<string, unknown>>;
  handoff: Array<Record<string, unknown>>;
  data: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
};

