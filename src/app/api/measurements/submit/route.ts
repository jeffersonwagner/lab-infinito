import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, findActiveSession } from "@/db/rooms";
import { submitMeasurements } from "@/db/measurements";
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
import { parseMeasurementsPayload } from "@/domain/measurements";

export const dynamic = "force-dynamic";

// PRD 9: POST /api/measurements/submit — grupo participante envia exatamente
// seis tempos identificados por comprimento/repetição; o servidor valida e
// grava o conjunto + submissão atomicamente. Matriz 4.2: professor não envia.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!originAllowed(req)) {
    return errorNoStore(403, "Origem não permitida.");
  }
  if (!checkRateLimit(`measurements:${getClientIp(req)}`, 30, 10 * 60 * 1000)) {
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
  const tempos = parseMeasurementsPayload(raw.tempos);
  if (!tempos.ok) {
    return errorNoStore(422, tempos.error);
  }

  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return errorNoStore(401, "Sessão inexistente. Abra novamente o link da sua sala.");
  }
  const session = await findActiveSession(hashToken(sessionId));
  if (!session) {
    return errorNoStore(401, "Sessão inválida ou expirada. Abra novamente o link da sua sala.");
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
  if (expected.role !== "GRUPO" || expected.groupNumero === null) {
    return errorNoStore(403, "Apenas grupos enviam medições.");
  }

  let result;
  try {
    result = await submitMeasurements({
      sessionIdHash: session.sessionIdHash,
      roomId: session.roomId,
      groupNumero: expected.groupNumero,
      tempos: tempos.value,
    });
  } catch (err) {
    console.error("Erro ao registrar medições:", err);
    return errorNoStore(500, "Erro interno ao registrar as medições.");
  }

  switch (result.kind) {
    case "OK":
      return jsonNoStore({ confirmed: true, repeated: false });
    case "IDEMPOTENT":
      // Retry equivalente após resposta perdida: sucesso sem duplicar/alterar.
      return jsonNoStore({ confirmed: true, repeated: true });
    case "CONTENT_CONFLICT":
      return errorNoStore(
        409,
        "Suas medições já foram confirmadas com outro conjunto e não podem ser alteradas.",
      );
    case "PHASE":
      return jsonNoStore(
        {
          error: `A sala não está mais na fase de medições (fase atual: ${result.phase}).`,
          phase: result.phase,
        },
        { status: 409 },
      );
    case "NOT_PARTICIPANT":
      return errorNoStore(
        409,
        "Este grupo não é participante da rodada (ficou sem hipótese/ausente) e não envia medições.",
      );
    case "ROOM_GONE":
    case "SESSION_GONE":
    case "NO_GROUP":
      return errorNoStore(401, "Sessão inválida ou expirada. Abra novamente o link da sua sala.");
  }
}
