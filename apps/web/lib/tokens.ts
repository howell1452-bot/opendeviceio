import { createHash, randomBytes } from "node:crypto";

// API token helpers. A token is `odio_` + 32 random bytes (base64url). We store
// ONLY its sha256 hex digest in `api_tokens.token_hash`; the plaintext is shown
// to the user exactly once at mint time and never persisted.

export const TOKEN_PREFIX = "odio_";

/** Generate a fresh plaintext API token. Server-only (uses node:crypto). */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** sha256 hex digest of a plaintext token, for storage / lookup. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
