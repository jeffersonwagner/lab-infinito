import type { NextRequest, NextResponse } from "next/server";
import { findCredentialByTokenHash } from "@/db/credentials";
import { SESSION_COOKIE, insertSession, sessionCookieValue } from "@/db/rooms";
import { checkRateLimit } from "@/lib/rateLimit";
import { hashToken } from "@/lib/tokens";
import {
  errorNoStore,
  getClientIp,
  jsonNoStore,
  originAllowed,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!originAllowed(req)) {
    return errorNoStore(403, "Origem não permitida.");
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`session:${ip}`, 30, 10 * 60 * 1000)) {
    return errorNoStore(429, "Muitas tentativas. Aguarde alguns minutos.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorNoStore(422, "Corpo inválido.");
  }
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token === "" || token.length > 200) {
    return errorNoStore(422, "Token ausente ou inválido.");
  }
  const credential = await findCredentialByTokenHash(hashToken(token));
  // Erro genérico: não revelar se o token existe, expirou ou foi revogado.
  if (!credential) {
    return errorNoStore(401, "Link inválido ou expirado. Verifique o link recebido.");
  }
  let groupNumero: number | null = null;
  if (credential.role === "GRUPO") {
    groupNumero = credential.groupNumero;
    if (groupNumero === null) {
      return errorNoStore(401, "Link inválido ou expirado. Verifique o link recebido.");
    }
  }
  const session = await insertSession({
    role: credential.role,
    roomId: credential.roomId,
    groupNumero,
  });
  if (!session) {
    return errorNoStore(401, "Link inválido ou expirado. Verifique o link recebido.");
  }
  return jsonNoStore(
    {
      identity: {
        role: credential.role,
        roomId: credential.roomId,
        groupNumero,
        expiresAt: session.expiresAt,
      },
    },
    { headers: { "Set-Cookie": sessionCookieValue(session.sessionId, session.expiresAt) } },
  );
}
