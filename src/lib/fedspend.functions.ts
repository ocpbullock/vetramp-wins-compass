// Thin server-function wrappers for Fed-Spend Phase 1.
// All runtime logic lives in ./fedspend-phase1.server.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type {
  RecompeteResponse,
  SubawardsResponse,
} from "./fedspend-types";

export const getFedSpendRecompetes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamId: string; naicsCodes: string[]; maxDays?: number; force?: boolean }) => input)
  .handler(async ({ data, context }): Promise<RecompeteResponse> => {
    const {
      fetchRecompetes,
      recompeteCacheKey,
      RECOMPETE_TTL_MS,
    } = await import("./fedspend-phase1.server");
    const { supabase } = context;

    const naicsCodes = [...new Set(data.naicsCodes.filter((c) => /^\d{4,6}$/.test(c)))].slice(0, 6);
    const maxDays = Math.min(Math.max(data.maxDays ?? 365, 30), 730);
    const now = new Date();

    if (naicsCodes.length === 0) {
      return { rows: [], cached: false, fetchedAt: now.toISOString(), naicsCodes, maxDays };
    }

    const key = recompeteCacheKey(naicsCodes, maxDays);

    if (!data.force) {
      const { data: cached } = await supabase
        .from("fedspend_cache")
        .select("payload, fetched_at")
        .eq("team_id", data.teamId)
        .eq("cache_key", key)
        .maybeSingle();
      if (cached && now.getTime() - new Date(cached.fetched_at).getTime() < RECOMPETE_TTL_MS) {
        const payload = (cached.payload ?? {}) as { rows?: unknown };
        return {
          rows: (payload.rows ?? []) as RecompeteResponse["rows"],
          cached: true,
          fetchedAt: cached.fetched_at,
          naicsCodes,
          maxDays,
        };
      }
    }

    try {
      const rows = await fetchRecompetes(naicsCodes, maxDays);
      await supabase
        .from("fedspend_cache")
        .upsert(
          { team_id: data.teamId, cache_key: key, payload: { rows } as unknown as Json, fetched_at: now.toISOString() },
          { onConflict: "team_id,cache_key" },
        );
      return { rows, cached: false, fetchedAt: now.toISOString(), naicsCodes, maxDays };
    } catch (e) {
      return {
        rows: [],
        cached: false,
        fetchedAt: now.toISOString(),
        naicsCodes,
        maxDays,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

export const getFedSpendSubawards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamId: string; companyName: string; force?: boolean }) => input)
  .handler(async ({ data, context }): Promise<SubawardsResponse> => {
    const {
      fetchSubawards,
      subawardsCacheKey,
      SUBAWARD_TTL_MS,
    } = await import("./fedspend-phase1.server");
    const { supabase } = context;

    const companyName = data.companyName.trim();
    const now = new Date();
    const empty = {
      companyName,
      asPrime: [],
      asSub: [],
      cached: false,
      fetchedAt: now.toISOString(),
      suspectCount: 0,
    } satisfies SubawardsResponse;
    if (companyName.length < 3) return empty;

    const key = subawardsCacheKey(companyName);

    if (!data.force) {
      const { data: cached } = await supabase
        .from("fedspend_cache")
        .select("payload, fetched_at")
        .eq("team_id", data.teamId)
        .eq("cache_key", key)
        .maybeSingle();
      if (cached && now.getTime() - new Date(cached.fetched_at).getTime() < SUBAWARD_TTL_MS) {
        const payload = (cached.payload ?? {}) as Partial<SubawardsResponse>;
        return {
          companyName,
          asPrime: payload.asPrime ?? [],
          asSub: payload.asSub ?? [],
          suspectCount: payload.suspectCount ?? 0,
          cached: true,
          fetchedAt: cached.fetched_at,
        };
      }
    }

    try {
      const result = await fetchSubawards(companyName);
      await supabase.from("fedspend_cache").upsert(
        {
          team_id: data.teamId,
          cache_key: key,
          payload: { ...result } as unknown as Json,
          fetched_at: now.toISOString(),
        },
        { onConflict: "team_id,cache_key" },
      );
      return { companyName, ...result, cached: false, fetchedAt: now.toISOString() };
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : String(e) };
    }
  });

export const checkFedSpendHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { fedspendHealth } = await import("./fedspend-phase1.server");
    return fedspendHealth();
  });
