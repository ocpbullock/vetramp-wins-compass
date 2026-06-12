// Lightweight regression coverage for the security and workflow fixes.
//
// These are intentionally static-analysis style tests: the edge functions
// import Deno-only modules from URLs, so we can't execute them under Node.
// Instead we read source files and assert the invariants that previously
// regressed (team scoping, auth gating, route/asset presence, etc.) so
// future edits that violate them fail loudly.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("ai-client cache keys are team-scoped", () => {
  const src = read("supabase/functions/_shared/ai-client.ts");

  it("getCachedResponse refuses to return data without a teamId", () => {
    // The early-return guard prevents leaking another team's cached response.
    expect(src).toMatch(/if \(!teamId\) return null;/);
  });

  it("getCachedResponse filters cache reads by team_id", () => {
    expect(src).toMatch(/\.eq\(["']team_id["'],\s*teamId\)/);
  });

  it("setCachedResponse skips writes without a teamId", () => {
    expect(src).toMatch(/if \(!opts\.teamId\)/);
    expect(src).toMatch(/setCachedResponse skipped/);
  });

  it("setCachedResponse upserts with a team-scoped conflict target", () => {
    expect(src).toMatch(
      /onConflict:\s*["']team_id,function_name,cache_key["']/,
    );
  });
});

describe("knowledge base ingest requires team_id and membership", () => {
  const src = read("supabase/functions/ingest-knowledge/index.ts");

  it("authenticates before touching the request body", () => {
    const authIdx = src.indexOf("await authenticate(req)");
    const insertIdx = src.indexOf('.from("knowledge_base")');
    expect(authIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(authIdx);
  });

  it("resolves and verifies the team before inserting", () => {
    expect(src).toMatch(/resolveTeamId\(ctx,\s*teamId\s*\?\?\s*null\)/);
    expect(src).toMatch(/if \(!verifiedTeamId\)/);
  });

  it("insert payload includes team_id and user_id", () => {
    expect(src).toMatch(/team_id:\s*verifiedTeamId/);
    expect(src).toMatch(/user_id:\s*ctx\.user\.id/);
  });
});

describe("edge auth helper rejects missing/invalid auth", () => {
  const src = read("supabase/functions/_shared/auth.ts");

  it("rejects requests without a Bearer token (401)", () => {
    expect(src).toMatch(
      /if \(!authHeader\.startsWith\(["']Bearer ["']\)\)\s*\{[\s\S]*?AuthError\(401/,
    );
  });

  it("rejects invalid or expired tokens (401)", () => {
    expect(src).toMatch(
      /if \(error \|\| !data\?\.user\)\s*\{[\s\S]*?AuthError\(401/,
    );
  });

  it("assertProposalAccess uses the user-scoped client and returns 403", () => {
    expect(src).toMatch(/ctx\.userClient[\s\S]*?\.from\(["']proposals["']\)/);
    expect(src).toMatch(/AuthError\(403,\s*["']Proposal not found or not accessible["']\)/);
  });

  it("assertTeamMember requires a teamId and returns 403 on miss", () => {
    expect(src).toMatch(/AuthError\(400,\s*["']teamId required["']\)/);
    expect(src).toMatch(/AuthError\(403,\s*["']Not a member of this team["']\)/);
  });
});

describe("parse-sow gates proposal updates on access checks", () => {
  const src = read("supabase/functions/parse-sow/index.ts");

  it("calls assertProposalAccess before any parsing_status write", () => {
    const accessIdx = src.indexOf("assertProposalAccess(ctx, proposalId)");
    const firstStatusWrite = src.indexOf('parsing_status:');
    expect(accessIdx).toBeGreaterThan(-1);
    expect(firstStatusWrite).toBeGreaterThan(accessIdx);
  });

  it("returns the auth error response when access is denied", () => {
    expect(src).toMatch(/authErrorResponse\(e,\s*corsHeaders\)/);
  });
});

describe("sam-attachments gates downloads on access checks", () => {
  const src = read("supabase/functions/sam-attachments/index.ts");

  it("authenticates and asserts proposal access before downloading", () => {
    const authIdx = src.indexOf("authenticate(req)");
    const accessIdx = src.indexOf("assertProposalAccess(ctx, proposalId)");
    const downloadIdx = src.indexOf('action === "download"');
    expect(authIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeGreaterThan(authIdx);
    expect(downloadIdx).toBeGreaterThan(accessIdx);
  });

  it("writes attachments to a proposal-scoped storage path, not a user folder", () => {
    expect(src).toMatch(/proposals\/\$\{proposalId\}\//);
    expect(src).not.toMatch(/\$\{userId\}\/\$\{proposalId\}\//);
  });
});

describe("server function auth middleware is registered globally", () => {
  const src = read("src/start.ts");

  it("imports attachSupabaseAuth", () => {
    expect(src).toMatch(
      /import\s*\{\s*attachSupabaseAuth\s*\}\s*from\s*["']@\/integrations\/supabase\/auth-attacher["']/,
    );
  });

  it("registers attachSupabaseAuth in functionMiddleware", () => {
    expect(src).toMatch(/functionMiddleware:\s*\[[^\]]*attachSupabaseAuth[^\]]*\]/);
  });

  it("preserves errorMiddleware in requestMiddleware", () => {
    expect(src).toMatch(/requestMiddleware:\s*\[[^\]]*errorMiddleware[^\]]*\]/);
  });
});

describe("build prerequisites: routes and assets exist", () => {
  it("the proposal detail route file referenced by routeTree.gen exists", () => {
    const tree = read("src/routeTree.gen.ts");
    // The generated tree imports child route modules; the proposal detail
    // file must be present or the build fails with an unresolved import.
    expect(tree).toMatch(/proposals\.\$proposalId/);
    expect(
      existsSync(resolve(root, "src/routes/proposals.$proposalId.tsx")),
    ).toBe(true);
  });

  it("every imported @/assets/* file actually exists on disk", () => {
    // Tiny grep across src/ for @/assets/<file> imports — every target
    // must resolve, otherwise Vite fails the build.
    const { execSync } = require("node:child_process");
    const out = execSync(
      `grep -rhoE "@/assets/[A-Za-z0-9._/-]+" src || true`,
      { cwd: root, encoding: "utf8" },
    );
    const refs = Array.from(new Set(out.split("\n").filter(Boolean)));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const rel = ref.replace(/^@\//, "src/");
      const full = join(root, rel);
      expect(existsSync(full), `${ref} should exist`).toBe(true);
    }
  });
});

describe("ai_response_cache writes are service-role only (no client UPDATE)", () => {
  it("ai-client documents the no-client-UPDATE invariant", () => {
    const src = read("supabase/functions/_shared/ai-client.ts");
    expect(src).toMatch(/NO client-facing UPDATE policy/);
  });

  it("setCachedResponse upserts via the service-role admin client", () => {
    const src = read("supabase/functions/_shared/ai-client.ts");
    expect(src).toMatch(/admin\.from\(["']ai_response_cache["']\)\.upsert/);
  });

  it("no migration grants an UPDATE policy on ai_response_cache", () => {
    const { execSync } = require("node:child_process");
    const out = execSync(
      `grep -rEn "CREATE POLICY[^;]+ON[[:space:]]+public\\.ai_response_cache[^;]+FOR[[:space:]]+UPDATE" supabase/migrations || true`,
      { cwd: root, encoding: "utf8" },
    );
    expect(out.trim()).toBe("");
  });
});

describe("proposal-attachments storage uses a single proposal-access model", () => {
  it("legacy user-folder storage policies are dropped", () => {
    const { execSync } = require("node:child_process");
    const drops = execSync(
      `grep -rEn 'DROP POLICY[^;]+"Users (read|upload|delete) own proposal files"' supabase/migrations || true`,
      { cwd: root, encoding: "utf8" },
    );
    expect(drops).toMatch(/Users read own proposal files/);
    expect(drops).toMatch(/Users upload own proposal files/);
    expect(drops).toMatch(/Users delete own proposal files/);
  });

  it("client upload path is proposal-scoped, not user-folder-scoped", () => {
    const src = read("src/routes/proposals.$proposalId.tsx");
    expect(src).toMatch(/proposals\/\$\{proposalId\}\//);
    expect(src).not.toMatch(/\$\{user\.id\}\/\$\{proposalId\}\//);
  });
});

describe("edge function CORS reflects request origin against an allowlist", () => {
  const src = read("supabase/functions/_shared/cors.ts");

  it("does not use a wildcard Access-Control-Allow-Origin", () => {
    expect(src).not.toMatch(/["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/);
  });

  it("exposes a buildCorsHeaders(req) function", () => {
    expect(src).toMatch(/export function buildCorsHeaders\(req:\s*Request\)/);
  });

  it("reads the ALLOWED_ORIGINS env var", () => {
    expect(src).toContain("ALLOWED_ORIGINS");
  });

  it("reflects the request origin only when it exactly matches the allowlist", () => {
    // Exact-match check (no .endsWith / wildcard / regex), and the header
    // is only added inside the matched branch.
    expect(src).toMatch(/allowed\.includes\(origin\)/);
    expect(src).not.toMatch(/\.endsWith\(/);
  });

  it("includes the project's published and preview origins plus localhost in the defaults", () => {
    expect(src).toContain("https://vetramp-wins-compass.lovable.app");
    expect(src).toContain("http://localhost:5173");
    expect(src).toContain("http://localhost:3000");
    expect(src).toMatch(/id-preview--[a-z0-9-]+\.lovable\.app/);
  });

  it("sets the Vary: Origin header so caches don't leak the wrong allow-origin", () => {
    expect(src).toMatch(/["']Vary["']\s*:\s*["']Origin["']/);
  });

  const HANDLER_FILES = [
    "supabase/functions/vendor-profile/index.ts",
    "supabase/functions/usaspending-detail/index.ts",
    "supabase/functions/ingest-knowledge/index.ts",
    "supabase/functions/search-entities/index.ts",
    "supabase/functions/usaspending-analytics/index.ts",
    "supabase/functions/search-usaspending/index.ts",
    "supabase/functions/generate-teaming-outreach/index.ts",
    "supabase/functions/search-sam/index.ts",
    "supabase/functions/sam-attachments/index.ts",
    "supabase/functions/competitive-intel/index.ts",
    "supabase/functions/generate-proposal/index.ts",
    "supabase/functions/generate-proposal-section/index.ts",
    "supabase/functions/parse-sow/index.ts",
    "supabase/functions/customer-intel/index.ts",
  ];

  it.each(HANDLER_FILES)(
    "%s computes per-request CORS headers via buildCorsHeaders(req)",
    (file) => {
      const fileSrc = read(file);
      expect(fileSrc).toContain("buildCorsHeaders");
      expect(fileSrc).toMatch(/const\s+corsHeaders\s*=\s*buildCorsHeaders\(req\)/);
      // The legacy wildcard import must be gone.
      expect(fileSrc).not.toMatch(
        /import\s*\{\s*corsHeaders\s*\}\s*from\s*["']\.\.\/_shared\/cors\.ts["']/,
      );
    },
  );
});
