import { createHash, randomBytes } from "node:crypto";

export function generateLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function generateSessionId(): { sessionId: string; sessionIdHash: string } {
  const sessionId = randomBytes(32).toString("base64url");
  return { sessionId, sessionIdHash: hashToken(sessionId) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
