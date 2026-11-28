import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { NextRequest } from "next/server";
import { migrate } from "@/db/migrate";

// Etapa 5 (Experiência e estabilidade): limpeza autenticada de salas
// expiradas e negação de acesso/escrita após a expiração natural.
const dataDir = join(tmpdir(), `lab-invisivel-etapa5-${randomUUID()}`);
const PORT = 55436;
const SECRET = "segredo-de-teste-da-limpeza";

let pgInstance: InstanceType<typeof EmbeddedPostgres> | null = null;
let databaseUrl = "";

let roomsRoute: typeof import("@/app/api/rooms/route");
let sessionRoute: typeof import("@/app/api/session/route");
let hypothesisRoute: typeof import("@/app/api/hypothesis/route");
let advanceRoute: typeof import("@/app/api/room/advance/route");
let cleanupRoute: typeof import("@/app/api/cron/cleanup/route");

function request(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as NextRequest;
}

let counter = 300;
function uniqueIp(): string {
  counter += 1;
  return `10.3.0.${counter}`;
}

async function criarSala(groupCount: number): Promise<{ roomId: string; professorCookie: string; groupCookies: string[] }> {
  const res = await roomsRoute.POST(
    request("/api/rooms", {
      method: "POST",
      body: { groupCount },
      headers: { "x-forwarded-for": uniqueIp() },
    }),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  const professorRes = await sessionRoute.POST(
    request("/api/session", {
      method: "POST",
      body: { token: body.professorLink.split("#")[1] },
      headers: { "x-forwarded-for": uniqueIp() },
    }),
  );
  expect(professorRes.status).toBe(200);
  const groupCookies: string[] = [];
  for (const link of body.groupLinks) {
    const res2 = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token: link.link.split("#")[1] },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    expect(res2.status).toBe(200);
    groupCookies.push((res2 as Response).headers.get("set-cookie")!.split(";")[0]);
  }
  return {
    roomId: body.roomId,
    professorCookie: (professorRes as Response).headers.get("set-cookie")!.split(";")[0],
    groupCookies,
  };
}

async function estadoBanco(
  query: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query(query, params)).rows;
  } finally {
    await client.end();
  }
}

function cleanupReq(auth?: string): NextRequest {
  return request("/api/cron/cleanup", {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

beforeAll(async () => {
  pgInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "test",
    password: "test",
    port: PORT,
    persistent: false,
  });
  await pgInstance.initialise();
  await pgInstance.start();
  await pgInstance.createDatabase("lab_test");
  databaseUrl = `postgresql://test:test@localhost:${PORT}/lab_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.CLEANUP_SECRET = SECRET;
  roomsRoute = await import("@/app/api/rooms/route");
  sessionRoute = await import("@/app/api/session/route");
  hypothesisRoute = await import("@/app/api/hypothesis/route");
  advanceRoute = await import("@/app/api/room/advance/route");
  cleanupRoute = await import("@/app/api/cron/cleanup/route");
  await migrate(databaseUrl);
}, 180000);

afterAll(async () => {
  const { getPool } = await import("@/db/client");
  try {
    await getPool().end();
  } catch {
    // pool pode não ter sido criado
  }
  delete process.env.DATABASE_URL;
  delete process.env.CLEANUP_SECRET;
  if (pgInstance) {
    await pgInstance.stop();
  }
  rmSync(dataDir, { recursive: true, force: true });
}, 120000);

describe("POST/GET /api/cron/cleanup", () => {
  it("sem segredo configurado: 503; segredo errado: 403 — nada é removido", async () => {
    const ativa = await criarSala(1);
    const semSecret = process.env.CLEANUP_SECRET;
    delete process.env.CLEANUP_SECRET;
    const resSem = await cleanupRoute.GET(cleanupReq(`Bearer ${SECRET}`));
    expect(resSem.status).toBe(503);
    process.env.CLEANUP_SECRET = semSecret;

    const resErrado = await cleanupRoute.GET(cleanupReq("Bearer errado"));
    expect(resErrado.status).toBe(403);
    const resVazio = await cleanupRoute.GET(cleanupReq());
    expect(resVazio.status).toBe(403);

    const rooms = await estadoBanco(`SELECT id FROM rooms WHERE id = $1`, [ativa.roomId]);
    expect(rooms).toHaveLength(1);
  });

  it("segredo correto: remove só salas expiradas, com cascata; sala ativa permanece", async () => {
    const ativa = await criarSala(2);
    const expirada = await criarSala(1);
    await estadoBanco(
      `UPDATE rooms SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [expirada.roomId],
    );

    const res = await cleanupRoute.GET(cleanupReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).removidas).toBe(1);

    expect(await estadoBanco(`SELECT 1 FROM rooms WHERE id = $1`, [expirada.roomId])).toHaveLength(0);
    expect(await estadoBanco(`SELECT 1 FROM rooms WHERE id = $1`, [ativa.roomId])).toHaveLength(1);
    // Cascata: credenciais, grupos e sessões da sala expirada foram removidos.
    expect(await estadoBanco(`SELECT 1 FROM credentials WHERE room_id = $1`, [expirada.roomId])).toHaveLength(0);
    expect(await estadoBanco(`SELECT 1 FROM groups WHERE room_id = $1`, [expirada.roomId])).toHaveLength(0);
    expect(await estadoBanco(`SELECT 1 FROM sessions WHERE room_id = $1`, [expirada.roomId])).toHaveLength(0);
  });

  it("execução repetida sem expiradas: removidas = 0", async () => {
    const res = await cleanupRoute.POST(cleanupReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).removidas).toBe(0);
  });
});

describe("Sala expirada: negação de acesso e escrita mesmo antes da limpeza", () => {
  it("hipótese e avanço em sala expirada: 401 (sessão/sala negadas)", async () => {
    const sala = await criarSala(1);
    await estadoBanco(
      `UPDATE rooms SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [sala.roomId],
    );

    const resHipotese = await hypothesisRoute.POST(
      request("/api/hypothesis", {
        method: "POST",
        headers: { cookie: sala.groupCookies[0] },
        body: { roomId: sala.roomId, role: "GRUPO", groupNumero: 1, opcao: "DOBRA", justificativa: null },
      }),
    );
    expect(resHipotese.status).toBe(401);

    const resAvanco = await advanceRoute.POST(
      request("/api/room/advance", {
        method: "POST",
        headers: { cookie: sala.professorCookie },
        body: { roomId: sala.roomId, role: "PROFESSOR", groupNumero: null, confirmados: null },
      }),
    );
    expect(resAvanco.status).toBe(401);

    // Nada foi escrito e a sala permanece (a limpeza cuida da remoção).
    expect(await estadoBanco(`SELECT 1 FROM hypotheses`, [])).toHaveLength(0);
    const fase = await estadoBanco(`SELECT phase FROM rooms WHERE id = $1`, [sala.roomId]);
    expect(fase[0].phase).toBe("HIPOTESES");
  });
});
