"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type DemoIdentity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string;
  persona_id?: string;
  timezone?: string;
};

const STORAGE_KEY = "churchcore.demo_identity.v1";

const Noah: DemoIdentity = {
  tenant_id: "calvarybible",
  user_id: "demo_user_noah",
  role: "seeker",
  campus_id: "campus_boulder",
  persona_id: "p_seeker_2",
};

const Ava: DemoIdentity = {
  tenant_id: "calvarybible",
  user_id: "demo_user_ava",
  role: "seeker",
  campus_id: "campus_boulder",
  persona_id: "p_seeker_1",
};

const PERSONA_BY_USER: Record<string, string> = {
  [Noah.user_id]: "p_seeker_2",
  [Ava.user_id]: "p_seeker_1",
};

type Ctx = {
  identity: DemoIdentity;
  setIdentity: (next: DemoIdentity) => void;
  accounts: Array<{ label: string; identity: DemoIdentity }>;
};

const DemoIdentityContext = createContext<Ctx | null>(null);

function readStored(): DemoIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    if (j.user_id !== Noah.user_id && j.user_id !== Ava.user_id) return null;
    const uid = String(j.user_id);
    return {
      tenant_id: "calvarybible",
      user_id: uid,
      role: "seeker",
      campus_id: "campus_boulder",
      persona_id: PERSONA_BY_USER[uid] ?? undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
  } catch {
    return null;
  }
}

export function DemoIdentityProvider(props: { children: React.ReactNode }) {
  const [identity, setIdentityState] = useState<DemoIdentity>(() => ({
    ...Noah,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  }));

  useEffect(() => {
    const stored = readStored();
    if (stored) setIdentityState(stored);
  }, []);

  function setIdentity(next: DemoIdentity) {
    const uid = String(next.user_id);
    const normalized: DemoIdentity = {
      tenant_id: "calvarybible",
      user_id: uid,
      role: "seeker",
      campus_id: "campus_boulder",
      persona_id: PERSONA_BY_USER[uid] ?? undefined,
      timezone: next.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    setIdentityState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user_id: normalized.user_id }));
      window.dispatchEvent(new Event("churchcore-demo-identity-changed"));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const onChange = () => {
      const stored = readStored();
      if (stored) setIdentityState(stored);
    };
    window.addEventListener("churchcore-demo-identity-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("churchcore-demo-identity-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const accounts = useMemo(() => [{ label: "Noah Seeker", identity: Noah }, { label: "Ava Seeker", identity: Ava }], []);

  return <DemoIdentityContext.Provider value={{ identity, setIdentity, accounts }}>{props.children}</DemoIdentityContext.Provider>;
}

export function useDemoIdentity() {
  const ctx = useContext(DemoIdentityContext);
  if (!ctx) throw new Error("useDemoIdentity must be used within DemoIdentityProvider");
  return ctx;
}

