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
const CAMPUSES = new Set(["campus_boulder", "campus_erie", "campus_thornton"]);

const ACCOUNTS: Array<{ label: string; identity: DemoIdentity }> = [
  { label: "Noah Seeker", identity: { tenant_id: "calvarybible", user_id: "demo_user_noah", role: "seeker", campus_id: "campus_boulder", persona_id: "p_seeker_2" } },
  { label: "Ava Seeker", identity: { tenant_id: "calvarybible", user_id: "demo_user_ava", role: "seeker", campus_id: "campus_boulder", persona_id: "p_seeker_1" } },

  // Demo congregation (30 selectable people)
  { label: "Matt Carter", identity: { tenant_id: "calvarybible", user_id: "demo_user_matt_carter", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_01" } },
  { label: "Emily Carter", identity: { tenant_id: "calvarybible", user_id: "demo_user_emily_carter", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_02" } },
  { label: "Daniel Nguyen", identity: { tenant_id: "calvarybible", user_id: "demo_user_daniel_nguyen", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_03" } },
  { label: "Hannah Nguyen", identity: { tenant_id: "calvarybible", user_id: "demo_user_hannah_nguyen", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_04" } },
  { label: "Jose Ramirez", identity: { tenant_id: "calvarybible", user_id: "demo_user_jose_ramirez", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_05" } },
  { label: "Maria Ramirez", identity: { tenant_id: "calvarybible", user_id: "demo_user_maria_ramirez", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_06" } },
  { label: "Chris Brooks", identity: { tenant_id: "calvarybible", user_id: "demo_user_chris_brooks", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_07" } },
  { label: "Talia Brooks", identity: { tenant_id: "calvarybible", user_id: "demo_user_talia_brooks", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_08" } },
  { label: "Raj Patel", identity: { tenant_id: "calvarybible", user_id: "demo_user_raj_patel", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_09" } },
  { label: "Priya Patel", identity: { tenant_id: "calvarybible", user_id: "demo_user_priya_patel", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_10" } },
  { label: "Jordan Lee", identity: { tenant_id: "calvarybible", user_id: "demo_user_jordan_lee", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_11" } },
  { label: "Casey Kim", identity: { tenant_id: "calvarybible", user_id: "demo_user_casey_kim", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_12" } },
  { label: "Tyler Johnson", identity: { tenant_id: "calvarybible", user_id: "demo_user_tyler_johnson", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_13" } },
  { label: "Morgan Wright", identity: { tenant_id: "calvarybible", user_id: "demo_user_morgan_wright", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_14" } },
  { label: "Samir Ali", identity: { tenant_id: "calvarybible", user_id: "demo_user_samir_ali", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_15" } },
  { label: "Grace Parker", identity: { tenant_id: "calvarybible", user_id: "demo_user_grace_parker", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_16" } },
  { label: "Olivia Chen", identity: { tenant_id: "calvarybible", user_id: "demo_user_olivia_chen", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_17" } },
  { label: "Ethan Davis", identity: { tenant_id: "calvarybible", user_id: "demo_user_ethan_davis", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_18" } },
  { label: "Bella Martinez", identity: { tenant_id: "calvarybible", user_id: "demo_user_bella_martinez", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_19" } },
  { label: "Nate Thompson", identity: { tenant_id: "calvarybible", user_id: "demo_user_nate_thompson", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_20" } },
  { label: "Logan Reed", identity: { tenant_id: "calvarybible", user_id: "demo_user_logan_reed", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_21" } },
  { label: "Megan Scott", identity: { tenant_id: "calvarybible", user_id: "demo_user_megan_scott", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_22" } },
  { label: "Caleb Foster", identity: { tenant_id: "calvarybible", user_id: "demo_user_caleb_foster", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_23" } },
  { label: "Sierra Price", identity: { tenant_id: "calvarybible", user_id: "demo_user_sierra_price", role: "seeker", campus_id: "campus_boulder", persona_id: "p_demo_24" } },
  { label: "Derek Hall", identity: { tenant_id: "calvarybible", user_id: "demo_user_derek_hall", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_25" } },
  { label: "Kara Hall", identity: { tenant_id: "calvarybible", user_id: "demo_user_kara_hall", role: "seeker", campus_id: "campus_thornton", persona_id: "p_demo_26" } },
  { label: "Ben Wallace", identity: { tenant_id: "calvarybible", user_id: "demo_user_ben_wallace", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_27" } },
  { label: "Ruth Wallace", identity: { tenant_id: "calvarybible", user_id: "demo_user_ruth_wallace", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_28" } },
  { label: "Aiden Brooks", identity: { tenant_id: "calvarybible", user_id: "demo_user_aiden_brooks", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_29" } },
  { label: "Chloe Brooks", identity: { tenant_id: "calvarybible", user_id: "demo_user_chloe_brooks", role: "seeker", campus_id: "campus_erie", persona_id: "p_demo_30" } },
];

const Noah: DemoIdentity = ACCOUNTS[0]!.identity;

const PERSONA_BY_USER: Record<string, string> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.identity.user_id, a.identity.persona_id ?? ""]).filter(([, pid]) => Boolean(pid)),
) as Record<string, string>;

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
    const uid = String(j.user_id);
    if (!PERSONA_BY_USER[uid]) return null;
    const campusRaw = typeof (j as any).campus_id === "string" ? String((j as any).campus_id) : "";
    const campus_id = CAMPUSES.has(campusRaw) ? campusRaw : "campus_boulder";
    return {
      tenant_id: "calvarybible",
      user_id: uid,
      role: "seeker",
      campus_id,
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
    const campusRaw = typeof next.campus_id === "string" ? String(next.campus_id) : "";
    const campus_id = CAMPUSES.has(campusRaw) ? campusRaw : "campus_boulder";
    const normalized: DemoIdentity = {
      tenant_id: "calvarybible",
      user_id: uid,
      role: "seeker",
      campus_id,
      persona_id: PERSONA_BY_USER[uid] ?? undefined,
      timezone: next.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    setIdentityState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user_id: normalized.user_id, campus_id: normalized.campus_id }));
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

  const accounts = useMemo(() => ACCOUNTS, []);

  return <DemoIdentityContext.Provider value={{ identity, setIdentity, accounts }}>{props.children}</DemoIdentityContext.Provider>;
}

export function useDemoIdentity() {
  const ctx = useContext(DemoIdentityContext);
  if (!ctx) throw new Error("useDemoIdentity must be used within DemoIdentityProvider");
  return ctx;
}

