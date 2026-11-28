import type { NextRequest, NextResponse } from "next/server";
import { deleteExpiredRooms } from "@/db/cleanup";
import { errorNoStore, jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CLEANUP_SECRET;
  if (!secret) {
    // Sem segredo configurado, a rotina fica desabilitada: nunca executar
    // limpeza destrutiva em endpoint aberto (PRD 11/12).
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

// Rotina de limpeza para agendador (ex.: Vercel Cron), protegida por segredo.
// Não é um endpoint administrativo público: sem/tr segredo configurado ou com
// segredo errado, responde sem executar nada.
async function executar(req: NextRequest): Promise<NextResponse> {
  if (!process.env.CLEANUP_SECRET) {
    return errorNoStore(503, "Limpeza não configurada (CLEANUP_SECRET ausente).");
  }
  if (!autorizado(req)) {
    return errorNoStore(403, "Não autorizado.");
  }
  try {
    const removidas = await deleteExpiredRooms();
    return jsonNoStore({ ok: true, removidas });
  } catch (err) {
    console.error("Erro na limpeza de salas expiradas:", err);
    return errorNoStore(500, "Erro interno na limpeza.");
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return executar(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return executar(req);
}
