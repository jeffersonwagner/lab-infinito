import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { NextRequest } from "next/server";
import { migrate } from "@/db/migrate";

const dataDir = join(tmpdir(), `lab-invisivel-api-${randomUUID()}`);

let pgInstance: InstanceType<typeof EmbeddedPostgres> | null = null;
let databaseUrl = "";

let roomsRoute: typeof import("@/app/api/rooms/route");
let sessionRoute: typeof import("@/app/api/session/route");
let roomRoute: typeof import("@/app/api/room/route");

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

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  const pair = setCookie!.split(";")[0];
  return pair;
}

let counter = 0;
function uniqueIp(): string {
  counter += 1;
  return `10.0.0.${counter}`;
}

beforeAll(async () => {
  pgInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "test",
    password: "test",
    port: 55433,
    persistent: false,
  });
  await pgInstance.initialise();
  await pgInstance.start();
  await pgInstance.createDatabase("lab_test");
  databaseUrl = "postgresql://test:test@localhost:55433/lab_test";
  process.env.DATABASE_URL = databaseUrl;
  roomsRoute = await import("@/app/api/rooms/route");
  sessionRoute = await import("@/app/api/session/route");
  roomRoute = await import("@/app/api/room/route");
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
  if (pgInstance) {
    await pgInstance.stop();
  }
  rmSync(dataDir, { recursive: true, force: true });
}, 120000);

describe("POST /api/rooms", () => {
  async function createRoom(groupCount: number, ip = uniqueIp()) {
    const res = await roomsRoute.POST(
      request("/api/rooms", {
        method: "POST",
        body: { groupCount },
        headers: { "x-forwarded-for": ip },
      }),
    );
    return res as Response;
  }

  it("cria sala com 2 grupos: links distintos, só hashes no banco, expiração 14 dias", async () => {
    const res = await createRoom(2);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.groupLinks).toHaveLength(2);
    expect(body.groupLinks[0].groupNumero).toBe(1);
    expect(body.groupLinks[1].groupNumero).toBe(2);

    const links = [body.professorLink, ...body.groupLinks.map((g: { link: string }) => g.link)];
    const tokens = links.map((l: string) => l.split("#")[1]);
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(43);
    }
    for (const link of links) {
      expect(link.startsWith("/entrar#")).toBe(false);
      expect(link).toContain("/entrar#");
    }
    expect(links.every((l: string) => l.startsWith("http://localhost:3000/entrar#"))).toBe(true);

    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const creds = (
        await client.query(
          `SELECT token_hash, role, expires_at, group_id, room_id FROM credentials
           WHERE room_id = $1 ORDER BY role`,
          [body.roomId],
        )
      ).rows;
      expect(creds).toHaveLength(3);
      expect(creds.filter((c: { role: string }) => c.role === "GRUPO")).toHaveLength(2);
      for (const token of tokens) {
        const { createHash } = await import("node:crypto");
        const expectedHash = createHash("sha256").update(token, "utf8").digest("hex");
        expect(creds.some((c: { token_hash: string }) => c.token_hash === expectedHash)).toBe(true);
        expect(
          creds.some((c: { token_hash: string }) => c.token_hash.includes(token.slice(0, 20))),
        ).toBe(false);
      }
      const room = (await client.query(`SELECT expires_at - created_at AS ttl FROM rooms WHERE id = $1`, [body.roomId])).rows[0];
      expect(room.ttl.days).toBe(14);
    } finally {
      await client.end();
    }
  });

  it.each([
    [1],
    [4],
  ])("cria sala com %i grupos", async (n) => {
    const res = await createRoom(n);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.groupLinks).toHaveLength(n);
  });

  it.each([0, 5, 2.5, "dois", null, undefined])("rejeita groupCount %p com 422", async (raw) => {
    const res = await createRoom(raw as number);
    expect(res.status).toBe(422);
  });

  it("limita criação por IP (melhor esforço em memória)", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const res = await createRoom(1, ip);
      expect(res.status).toBe(201);
    }
    const sixth = await createRoom(1, ip);
    expect(sixth.status).toBe(429);
  });

  it("rejeita Origin divergente do host (escritas)", async () => {
    const res = await roomsRoute.POST(
      request("/api/rooms", {
        method: "POST",
        body: { groupCount: 1 },
        headers: {
          "x-forwarded-for": uniqueIp(),
          origin: "https://site-malicioso.example",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/session", () => {
  async function createRoomAndExtractTokens(groupCount = 2) {
    const ip = uniqueIp();
    const res = await roomsRoute.POST(
      request("/api/rooms", {
        method: "POST",
        body: { groupCount },
        headers: { "x-forwarded-for": ip },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    return {
      body,
      professorToken: body.professorLink.split("#")[1],
      groupTokens: body.groupLinks.map((g: { link: string }) => g.link.split("#")[1]),
    };
  }

  async function exchange(token: string, ip = uniqueIp()) {
    const res = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token },
        headers: { "x-forwarded-for": ip },
      }),
    );
    return res as Response;
  }

  it("troca token de grupo por sessão com identidade e cookie HttpOnly", async () => {
    const { groupTokens } = await createRoomAndExtractTokens(2);
    const res = await exchange(groupTokens[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    const body = await res.json();
    expect(body.identity).toEqual({
      role: "GRUPO",
      roomId: expect.any(String),
      groupNumero: 1,
      expiresAt: expect.any(String),
    });

    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const sessions = (await client.query(`SELECT session_id_hash, role, group_id, expires_at FROM sessions`)).rows;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].role).toBe("GRUPO");
      const cookieValue = setCookie.split("=")[1].split(";")[0];
      const { createHash } = await import("node:crypto");
      expect(sessions[0].session_id_hash).toBe(
        createHash("sha256").update(cookieValue, "utf8").digest("hex"),
      );
    } finally {
      await client.end();
    }
  });

  it("troca token de professor: sem groupNumero", async () => {
    const { professorToken } = await createRoomAndExtractTokens(2);
    const res = await exchange(professorToken);
    const body = await res.json();
    expect(body.identity.role).toBe("PROFESSOR");
    expect(body.identity.groupNumero).toBeNull();
  });

  it.each(["", "x".repeat(201), "token-adulterado", 42, null, undefined])(
    "rejeita token %p com 422 ou 401",
    async (raw) => {
      const res = await exchange(raw as string);
      expect([401, 422]).toContain(res.status);
    },
  );

  it("limita tentativas por IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 30; i++) {
      await exchange("invalido", ip);
    }
    const limited = await exchange("invalido", ip);
    expect(limited.status).toBe(429);
  });
});

describe("GET /api/room (matriz de acesso)", () => {
  let roomId: string;
  let professorCookie: string;
  let group1Cookie: string;
  let group2Cookie: string;

  async function getRoom(cookie: string, roomId: string, role: string, groupNumero?: number) {
    const params = new URLSearchParams({ roomId, role });
    if (groupNumero !== undefined) params.set("groupNumero", String(groupNumero));
    return (await roomRoute.GET(
      request(`/api/room?${params}`, { headers: { cookie } }),
    )) as Response;
  }

  beforeAll(async () => {
    const res = await roomsRoute.POST(
      request("/api/rooms", {
        method: "POST",
        body: { groupCount: 2 },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    const body = await res.json();
    roomId = body.roomId;
    const professorRes = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token: body.professorLink.split("#")[1] },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    professorCookie = cookieFrom(professorRes);
    const g1 = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token: body.groupLinks[0].link.split("#")[1] },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    group1Cookie = cookieFrom(g1);
    const g2 = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token: body.groupLinks[1].link.split("#")[1] },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    group2Cookie = cookieFrom(g2);
  });

  it("professor vê todos os grupos e fases da sala", async () => {
    const res = await getRoom(professorCookie, roomId, "PROFESSOR");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.role).toBe("PROFESSOR");
    expect(body.room.phase).toBe("HIPOTESES");
    expect(body.groups).toHaveLength(2);
  });

  it("grupo vê apenas o próprio estado, sem dados de outros grupos", async () => {
    const res = await getRoom(group1Cookie, roomId, "GRUPO", 1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group.numero).toBe(1);
    expect(body.group.hypothesis).toBeNull();
    expect(body.groups).toBeUndefined();
    expect(body).not.toHaveProperty("groups");
  });

  it("sessão sem cookie → 401", async () => {
    const params = new URLSearchParams({ roomId, role: "PROFESSOR" });
    const res = await roomRoute.GET(
      request(`/api/room?${params}`),
    );
    expect(res.status).toBe(401);
  });

  it("cookie adulterado → 401", async () => {
    const params = new URLSearchParams({ roomId, role: "PROFESSOR" });
    const res = await roomRoute.GET(
      request(`/api/room?${params}`, {
        headers: { cookie: "__Host-lab_session=valor-falso" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("identidade esperada divergente (grupo usando roomId com papel de professor) → 409 sem dados", async () => {
    const res = await getRoom(group1Cookie, roomId, "PROFESSOR");
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain('"groups"');
  });

  it("grupo pedindo dados de outro número → 409", async () => {
    const res = await getRoom(group1Cookie, roomId, "GRUPO", 2);
    expect(res.status).toBe(409);
  });

  it("sessões de salas distintas ficam isoladas", async () => {
    const res = await roomsRoute.POST(
      request("/api/rooms", {
        method: "POST",
        body: { groupCount: 1 },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    const otherRoom = await res.json();
    const roomA = await getRoom(professorCookie, otherRoom.roomId, "PROFESSOR");
    expect(roomA.status).toBe(409);
    const params = new URLSearchParams({ roomId: otherRoom.roomId, role: "GRUPO", groupNumero: "1" });
    const groupA = await roomRoute.GET(
      request(`/api/room?${params}`, { headers: { cookie: group1Cookie } }),
    );
    expect(groupA.status).toBe(409);
  });

  it("sala expirada → sessão/credencial negadas mesmo sem limpeza", async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`UPDATE rooms SET expires_at = now() - interval '1 minute' WHERE id = $1`, [roomId]);
    } finally {
      await client.end();
    }
    const roomRes = await getRoom(professorCookie, roomId, "PROFESSOR");
    expect(roomRes.status).toBe(401);

    const { groupTokens: fresh } = await (async () => {
      const created = await roomsRoute.POST(
        request("/api/rooms", {
          method: "POST",
          body: { groupCount: 1 },
          headers: { "x-forwarded-for": uniqueIp() },
        }),
      );
      const createdBody = await created.json();
      return { groupTokens: [createdBody.groupLinks[0].link.split("#")[1]] };
    })();

    const { Client: C2 } = await import("pg");
    const c2 = new C2({ connectionString: databaseUrl });
    await c2.connect();
    try {
      const credHash = (
        await c2.query(
          `SELECT token_hash FROM credentials WHERE room_id = (SELECT id FROM rooms ORDER BY created_at DESC LIMIT 1) AND role = 'GRUPO' LIMIT 1`,
        )
      ).rows[0].token_hash;
      await c2.query(`UPDATE credentials SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [credHash]);
    } finally {
      await c2.end();
    }
    const expiredCred = await sessionRoute.POST(
      request("/api/session", {
        method: "POST",
        body: { token: fresh[0] },
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    expect(expiredCred.status).toBe(401);
  });
});
