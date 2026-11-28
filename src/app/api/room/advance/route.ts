import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, findActiveSession } from "@/db/rooms";
import { advanceRoomPhase } from "@/db/advance";
import { parseExpectedIdentity } from "@/lib/expectedIdentity";
import {
  errorNoStore,
  getClientIp,
  jsonNoStore,
  originAllowed,
  parseCookies,
} from "@/lib/http";
import { checkRateLimit } from "@/lib/rateLimit";
import { hashToken } from "@/lib/tokens";
import { parsePendingConfirmation } from "@/domain/validation";

export const dynamic = "force-dynamic";

// PRD 9: POST /api/room/advance — professor pede a próxima fase, incluindo a
// confirmação da lista exata de ausentes/pendentes quando existir; a lista é
// revalidada sob bloqueio e divergência gera 409 com o estado atualizado.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!originAllowed(req)) {
    return errorNoStore(403, "Origem não permitida.");
  }
  if (!checkRateLimit(`advance:${getClientIp(req)}`, 30, 10 * 60 * 1000)) {
    return errorNoStore(429, "Muitas tentativas. Aguarde alguns minutos.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorNoStore(422, "Corpo inválido.");
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  const expected = parseExpectedIdentity({
    roomId: raw.roomId,
    role: raw.role,
    groupNumero: raw.groupNumero,
  });
  if (!expected) {
    return errorNoStore(422, "Identidade inválida.");
  }
  const confirmed = parsePendingConfirmation(raw.confirmados);
  if (!confirmed.ok) {
    return errorNoStore(422, confirmed.error);
  }

  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return errorNoStore(401, "Sessão inexistente. Abra novamente o link do professor.");
  }
  const session = await findActiveSession(hashToken(sessionId));
  if (!session) {
    return errorNoStore(401, "Sessão inválida ou expirada. Abra novamente o link do professor.");
  }
  if (
    session.roomId !== expected.roomId ||
    session.role !== expected.role ||
    (expected.role === "GRUPO" && session.groupNumero !== expected.groupNumero)
  ) {
    return errorNoStore(
      409,
      "Sessão não corresponde a esta identidade. Reabra o link correto da sala.",
    );
  }
  // Matriz 4.2: apenas o professor avança ou revela.
  if (expected.role !== "PROFESSOR") {
    return errorNoStore(403, "Apenas o professor avança a fase da sala.");
  }

  let result;
  try {
    result = await advanceRoomPhase({
      sessionIdHash: session.sessionIdHash,
      roomId: session.roomId,
      confirmed: confirmed.value,
    });
  } catch (err) {
    console.error("Erro ao avançar fase:", err);
    return errorNoStore(500, "Erro interno ao avançar a fase.");
  }

  switch (result.kind) {
    case "OK":
      return jsonNoStore({ phase: result.phase });
    case "NO_NEXT":
      // Nunca repetir avanço cegamente: conflito com estado autorizado.
      return jsonNoStore(
        {
          error: "A sala já está na última fase e não pode avançar.",
          phase: result.phase,
        },
        { status: 409 },
      );
    case "CONFIRMATION_REQUIRED":
    case "CONFIRMATION_DIVERGED": {
      const message =
        result.kind === "CONFIRMATION_REQUIRED"
          ? "Existem grupos ausentes/pendentes. Confirme a lista exata para avançar."
          : "A lista de ausentes/pendentes mudou. Confirme a lista atualizada.";
      return jsonNoStore(
        {
          error: message,
          phase: result.phase,
          requiresConfirmation: true,
          pendentes: result.pending,
        },
        { status: 409 },
      );
    }
    case "ROOM_GONE":
    case "SESSION_GONE":
      return errorNoStore(401, "Sessão inválida ou expirada. Abra novamente o link do professor.");
  }
}
