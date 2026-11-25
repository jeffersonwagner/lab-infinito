import type { NextRequest, NextResponse } from "next/server";
import { parseGroupCount } from "@/domain/validation";
import { createRoomWithCredentials } from "@/db/rooms";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  deriveBaseUrl,
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
  if (!checkRateLimit(`rooms:${ip}`, 5, 60 * 60 * 1000)) {
    return errorNoStore(429, "Limite de criação de salas atingido. Tente novamente mais tarde.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorNoStore(422, "Corpo inválido.");
  }
  const groupCount = (body as { groupCount?: unknown } | null)?.groupCount;
  const parsed = parseGroupCount(groupCount);
  if (!parsed.ok) {
    return errorNoStore(422, parsed.error);
  }
  const baseUrl = deriveBaseUrl(req);
  if (!baseUrl) {
    return errorNoStore(500, "Não foi possível determinar a URL base.");
  }
  try {
    const created = await createRoomWithCredentials({ groupCount: parsed.value, baseUrl });
    return jsonNoStore(
      {
        roomId: created.roomId,
        phase: created.phase,
        expiresAt: created.expiresAt,
        professorLink: created.links.find((l) => l.role === "PROFESSOR")?.link,
        groupLinks: created.links
          .filter((l) => l.role === "GRUPO")
          .map((l) => ({ groupNumero: l.groupNumero, link: l.link })),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao criar sala:", err instanceof Error ? err.message : String(err));
    return errorNoStore(500, "Falha ao criar a sala. Tente novamente.");
  }
}
