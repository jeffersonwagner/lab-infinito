import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, findActiveSession } from "@/db/rooms";
import { lockHypothesis } from "@/db/hypotheses";
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
import {
  parseHypothesisOption,
  parseJustificativa,
} from "@/domain/validation";

export const dynamic = "force-dynamic";

// PRD 9: POST /api/hypothesis/lock — grupo autenticado registra a previsão
// única. Matriz 4.2: professor NÃO confirma hipótese; grupo só a sua.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!originAllowed(req)) {
    return errorNoStore(403, "Origem não permitida.");
  }
  if (!checkRateLimit(`hypothesis:${getClientIp(req)}`, 30, 10 * 60 * 1000)) {
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
  const opcao = parseHypothesisOption(raw.opcao);
  if (!opcao.ok) {
    return errorNoStore(422, opcao.error);
  }
  const justificativa = parseJustificativa(raw.justificativa);
  if (!justificativa.ok) {
    return errorNoStore(422, justificativa.error);
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
  // Matriz 4.2: professor não confirma hipótese.
  if (expected.role !== "GRUPO" || expected.groupNumero === null) {
    return errorNoStore(403, "Apenas grupos registram previsões.");
  }

  let result;
  try {
    result = await lockHypothesis({
      sessionIdHash: session.sessionIdHash,
      roomId: session.roomId,
      groupNumero: expected.groupNumero,
      opcao: opcao.value,
      justificativa: justificativa.value,
    });
  } catch (err) {
    console.error("Erro ao registrar hipótese:", err);
    return errorNoStore(500, "Erro interno ao registrar a previsão.");
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
        "Sua previsão já foi registrada com outro conteúdo e não pode ser alterada.",
      );
    case "PHASE":
      return jsonNoStore(
        {
          error: `A sala não está mais na fase de previsões (fase atual: ${result.phase}).`,
          phase: result.phase,
        },
        { status: 409 },
      );
    case "ROOM_GONE":
    case "SESSION_GONE":
    case "NO_GROUP":
      return errorNoStore(401, "Sessão inválida ou expirada. Abra novamente o link da sua sala.");
  }
}
