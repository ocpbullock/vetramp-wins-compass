// Regression: team invite tokens must be stored ONLY as a hash at rest, and
// acceptance must be single-use. These are static-analysis style assertions
// plus a runtime test of the hash helper.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { generateInviteToken, hashInviteToken } from "../src/lib/invite-tokens";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("invite-tokens helper", () => {
  it("hashInviteToken produces a SHA-256 hex digest of the raw token", () => {
    const raw = "00000000-0000-4000-8000-000000000000";
    const expected = createHash("sha256").update(raw).digest("hex");
    expect(hashInviteToken(raw)).toBe(expected);
    expect(hashInviteToken(raw)).toHaveLength(64);
    expect(hashInviteToken(raw)).not.toBe(raw);
  });

  it("generateInviteToken returns a raw token and its hash that match", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("different tokens hash to different digests", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("user_invites tokens hashed at rest", () => {
  const adminSrc = read("src/lib/admin.functions.ts");
  const teamsSrc = read("src/lib/teams.functions.ts");
  const oppSrc = read("src/lib/opportunity-teams.functions.ts");

  it("invite creation inserts token_hash, not the raw token", () => {
    // Every invite-creating path generates a token + hash and stores only the hash.
    expect(adminSrc).toContain("generateInviteToken");
    expect(adminSrc).toMatch(/token_hash:\s*tokenHash/);
    expect(oppSrc).toContain("generateInviteToken");
    expect(oppSrc).toMatch(/token_hash:\s*tokenHash/);
    // The resend paths also rotate to a fresh token + hash.
    expect(teamsSrc).toContain("generateInviteToken");
    expect(teamsSrc).toMatch(/token_hash:\s*tokenHash/);
  });

  it("no source file inserts or selects a raw `token` column on user_invites", () => {
    // Raw token must never be stored or queried by column name.
    for (const src of [adminSrc, teamsSrc, oppSrc]) {
      expect(src).not.toMatch(/\.eq\(\s*["']token["']/);
      expect(src).not.toMatch(/token:\s*[a-zA-Z_]+[,}\s]/); // no `token: rawToken` inserts
      expect(src).not.toMatch(/invite\.token\b/); // no reads of invite.token
    }
  });

  it("token lookup at acceptance time hashes the incoming token", () => {
    expect(adminSrc).toContain("hashInviteToken(data.token)");
    expect(adminSrc).toMatch(/\.eq\(\s*["']token_hash["'],\s*tokenHash\s*\)/);
  });

  it("emailed magic link carries the raw token, not the hash", () => {
    for (const src of [adminSrc, teamsSrc, oppSrc]) {
      expect(src).toMatch(/accept-invite\?token=\$\{token\}/);
    }
  });
});

describe("acceptInvite enforces single-use", () => {
  const src = read("src/lib/admin.functions.ts");

  it("flips status pending -> accepted with a pending guard so re-use fails", () => {
    // The .eq("status","pending") on the UPDATE is the single-use guard:
    // the second concurrent acceptance updates zero rows.
    expect(src).toMatch(/\.update\(\{[^}]*status:\s*["']accepted["'][^}]*\}\)/s);
    expect(src).toMatch(/\.eq\(\s*["']status["'],\s*["']pending["']\s*\)/);
  });

  it("rejects a re-used token with a clear error pointing to a new invite", () => {
    expect(src).toMatch(/already been used/i);
    expect(src).toMatch(/send a new invite|new invite/i);
  });

  it("records accepted_at + accepted_by on consumption", () => {
    expect(src).toMatch(/accepted_at:\s*nowIso/);
    expect(src).toMatch(/accepted_by:\s*context\.userId/);
  });
});

describe("accept-invite UI surfaces expired / used errors with new-invite hint", () => {
  const src = read("src/routes/accept-invite.tsx");

  it("has distinct `expired` and `used` states", () => {
    expect(src).toContain('state === "expired"');
    expect(src).toContain('state === "used"');
  });

  it("tells the user to request a new invite for both states", () => {
    expect(src).toMatch(/request a new invite[\s\S]*request a new invite/i);
  });
});
