// Helpers for invite token issuance & verification.
//
// Security invariant: the database stores only a SHA-256 HASH of the invite
// token (column `user_invites.token_hash`). The raw UUID token lives only
// inside the magic-link URL we email out. On acceptance we re-hash the
// incoming token and look it up by hash, so a DB leak cannot be used to
// hijack a pending invite.
import { createHash, randomUUID } from "crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomUUID();
  return { token, tokenHash: hashInviteToken(token) };
}
