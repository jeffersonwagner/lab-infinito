import type { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  findActiveSession,
  getGroupProjection,
  getProfessorProjection,
} from "@/db/rooms";
import {
  errorNoStore,
  isValidUuid,
  jsonNoStore,
  parseCookies,
} from "@/lib/http";
import { hashToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

function identityFromQuery(req: NextRequest): {
  roomId: string;
  role: string;
  groupNumero: number | null;
} | null {
  const roomId = req.nextUrl.searchParams.get("roomId");
  const role = req.nextUrl.searchParams.get("role");
  const groupNumeroRaw = req.nextUrl.searchParams.get("groupNumero");
  if (!isValidUuid(roomId) || (role !== "PROFESSOR" && role !== "GRUPO")) {
    return null;
  }
  let groupNumero: number | null = null;
  if (role === "GRUPO") {
    const parsed = Number(groupNumeroRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
      return null;
    }
    groupNumero = parsed;
  }
  return { roomId, role, groupNumero };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = identityFromQuery(req);
  if (!expected) {
    return errorNoStore(422, "Identidade inválida.");
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
  // PRD 8.2: a identidade esperada (não secreta) é conferida com a sessão;
  // divergência → 409 sem executar nem retornar dados de outra identidade.
  if (
    session.roomId !== expected.roomId ||
    session.role !== expected.role ||
    (expected.role === "GRUPO" && session.groupNumero !== expected.groupNumero)
  ) {
    return errorNoStore(409, "Sessão não corresponde a esta identidade. Reabra o link correto da sala.");
  }
  if (expected.role === "PROFESSOR") {
    const projection = await getProfessorProjection(session.roomId);
    if (!projection) {
      return errorNoStore(401, "Sala não encontrada ou expirada.");
    }
    return jsonNoStore({
      role: "PROFESSOR",
      room: { phase: projection.room.phase, expiresAt: projection.room.expiresAt },
      groups: projection.groups,
    });
  }
  const projection = await getGroupProjection(session.roomId, expected.groupNumero as number);
  if (!projection) {
    return errorNoStore(401, "Sala não encontrada ou expirada.");
  }
  return jsonNoStore({
    role: "GRUPO",
    room: { phase: projection.room.phase, expiresAt: projection.room.expiresAt },
    group: projection.group,
    revealed: projection.revealed,
    // Só é não-nulo após REVELADO (PRD 4.2: nenhum dado alheio antes dela).
    resultados: projection.resultados,
  });
}
