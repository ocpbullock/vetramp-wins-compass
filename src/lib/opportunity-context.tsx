import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SelectedOpportunity = {
  id: string;
  title: string | null;
  agency: string | null;
  naicsCode: string | null;
  setAside: string | null;
  scopeKeywords: string[];
  requiredVehicles: string[];
  incumbentName: string | null;
  primeContractorName: string | null;
};

export type TargetProfile = {
  naics: string[];
  setAside: string | null;
  agency: string | null;
  scopeKeywords: string[];
  requiredVehicles: string[];
};

type Ctx = {
  selectedOpportunityId: string | null;
  selected: SelectedOpportunity | null;
  targetProfile: TargetProfile;
  setSelectedOpportunityId: (id: string | null) => void;
  setTargetProfile: (p: TargetProfile) => void;
};

const EMPTY_PROFILE: TargetProfile = {
  naics: [],
  setAside: null,
  agency: null,
  scopeKeywords: [],
  requiredVehicles: [],
};

const STORAGE_ID = "vetramp.opportunityContext.selectedId";
const STORAGE_PROFILE = "vetramp.opportunityContext.targetProfile";

const OpportunityCtx = createContext<Ctx | null>(null);

function splitKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_ID);
    return v && v !== "null" ? v : null;
  } catch {
    return null;
  }
}

function readStoredProfile(): TargetProfile {
  if (typeof window === "undefined") return EMPTY_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_PROFILE);
    if (!raw) return EMPTY_PROFILE;
    const parsed = JSON.parse(raw);
    return {
      naics: Array.isArray(parsed?.naics) ? parsed.naics : [],
      setAside: parsed?.setAside ?? null,
      agency: parsed?.agency ?? null,
      scopeKeywords: Array.isArray(parsed?.scopeKeywords) ? parsed.scopeKeywords : [],
      requiredVehicles: Array.isArray(parsed?.requiredVehicles) ? parsed.requiredVehicles : [],
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function OpportunityProvider({ children }: { children: ReactNode }) {
  const [selectedOpportunityId, setSelectedOpportunityIdState] = useState<string | null>(() => readStoredId());
  const [targetProfile, setTargetProfileState] = useState<TargetProfile>(() => readStoredProfile());
  const [selected, setSelected] = useState<SelectedOpportunity | null>(null);

  // Persist id
  useEffect(() => {
    try {
      if (selectedOpportunityId) {
        window.localStorage.setItem(STORAGE_ID, selectedOpportunityId);
      } else {
        window.localStorage.removeItem(STORAGE_ID);
      }
    } catch {
      /* ignore */
    }
  }, [selectedOpportunityId]);

  // Persist target profile
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PROFILE, JSON.stringify(targetProfile));
    } catch {
      /* ignore */
    }
  }, [targetProfile]);

  // Hydrate selected from proposals
  useEffect(() => {
    let cancelled = false;
    if (!selectedOpportunityId) {
      setSelected(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select(
          "id, opportunity_title, agency, naics_code, set_aside, targeted_scope_areas, known_incumbent, prime_contractor_name"
        )
        .eq("id", selectedOpportunityId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setSelected(null);
        return;
      }
      setSelected({
        id: data.id,
        title: data.opportunity_title ?? null,
        agency: data.agency ?? null,
        naicsCode: data.naics_code ?? null,
        setAside: data.set_aside ?? null,
        scopeKeywords: splitKeywords(data.targeted_scope_areas),
        requiredVehicles: [],
        incumbentName: data.known_incumbent ?? null,
        primeContractorName: data.prime_contractor_name ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOpportunityId]);

  const value = useMemo<Ctx>(
    () => ({
      selectedOpportunityId,
      selected,
      targetProfile,
      setSelectedOpportunityId: setSelectedOpportunityIdState,
      setTargetProfile: setTargetProfileState,
    }),
    [selectedOpportunityId, selected, targetProfile]
  );

  return <OpportunityCtx.Provider value={value}>{children}</OpportunityCtx.Provider>;
}

export function useOpportunityContext(): Ctx {
  const ctx = useContext(OpportunityCtx);
  if (!ctx) throw new Error("useOpportunityContext must be used within OpportunityProvider");
  return ctx;
}
