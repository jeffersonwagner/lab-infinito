import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { NextRequest } from "next/server";
import { migrate } from "@/db/migrate";

// Etapa 3 (Previsão e controle): hipótese única/imutável e avanço de fase com
// confirmação de ausentes/pendentes recalculada sob bloqueio.
const dataDir = join(tmpdir(), `lab-invisivel-etapa3-${randomUUID()}`);
const PORT = 55434;

let pgInstance: InstanceType<typeof EmbeddedPostgres> | null = null;
let databaseUrl = "";

let roomsRoute: typeof import("@/app/api/rooms/route");
let sessionRoute: typeof import("@/app/api/session/route");
let hypothesisRoute: typeof import("@/app/api/hypothesis/route");
let advanceRoute: typeof import("@/app/api/room/advance/route");

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
  return setCookie!.split(";")[0];
}

let counter = 100;
function uniqueIp(): string {
  counter += 1;
  return `10.1.0.${counter}`;
}

type Sala = {
  roomId: string;
  professorCookie: string;
  groupCookies: string[];
};

async function criarSala(groupCount: number): Promise<Sala> {
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
    groupCookies.push(cookieFrom(res2 as Response));
  }
  return {
    roomId: body.roomId,
    professorCookie: cookieFrom(professorRes as Response),
    groupCookies,
  };
}

function hipoteseReq(
  sala: Sala,
  opts: { cookie?: string; groupNumero?: number; role?: string; roomId?: string; opcao?: string; justificativa?: string },
): NextRequest {
  return request("/api/hypothesis", {
    method: "POST",
    headers: { cookie: opts.cookie ?? sala.groupCookies[0] },
    body: {
      roomId: opts.roomId ?? sala.roomId,
      role: opts.role ?? "GRUPO",
      groupNumero: opts.role === "PROFESSOR" ? null : (opts.groupNumero ?? 1),
      opcao: "opcao" in opts ? opts.opcao : "DOBRA",
      justificativa: opts.justificativa,
    },
  });
}

async function avancar(
  sala: Sala,
  opts: { cookie?: string; confirmados?: number[] | null } = {},
): Promise<Response> {
  return (await advanceRoute.POST(
    request("/api/room/advance", {
      method: "POST",
      headers: { cookie: opts.cookie ?? sala.professorCookie },
      body: {
        roomId: sala.roomId,
        role: "PROFESSOR",
        groupNumero: null,
        confirmados: opts.confirmados ?? null,
      },
    }),
  )) as Response;
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
  roomsRoute = await import("@/app/api/rooms/route");
  sessionRoute = await import("@/app/api/session/route");
  hypothesisRoute = await import("@/app/api/hypothesis/route");
  advanceRoute = await import("@/app/api/room/advance/route");
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

describe("POST /api/hypothesis", () => {
  it("grupo confirma hipótese válida: registra uma única vez e vira PARTICIPANTE", async () => {
    const sala = await criarSala(2);
    const res = await hypothesisRoute.POST(
      hipoteseReq(sala, { opcao: "MENOR", justificativa: "O dobro do comprimento não dobra o período." }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.confirmed).toBe(true);
    expect(body.repeated).toBe(false);

    const rows = await estadoBanco(
      `SELECT h.opcao, h.justificativa, g.status FROM hypotheses h
       JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].opcao).toBe("MENOR");
    expect(rows[0].status).toBe("PARTICIPANTE");
  });

  it("retry idempotente igual: 200 sem duplicar, mesmo com justificativa reaparada", async () => {
    const sala = await criarSala(2);
    await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "IGUAL", justificativa: "  teste  " }));
    const res = await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "IGUAL", justificativa: "teste" }));
    expect(res.status).toBe(200);
    expect((await res.json()).repeated).toBe(true);
    const rows = await estadoBanco(
      `SELECT h.opcao, h.justificativa FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].justificativa).toBe("teste");
  });

  it("retry com conteúdo diferente: 409 e conteúdo original preservado", async () => {
    const sala = await criarSala(2);
    await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "DOBRA", justificativa: "original" }));
    const res = await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "MENOR", justificativa: "original" }));
    expect(res.status).toBe(409);
    const rows = await estadoBanco(
      `SELECT h.opcao FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].opcao).toBe("DOBRA");
  });

  it.each([
    ["opção inválida", { opcao: "menor" }],
    ["opção não informada", { opcao: undefined }],
    ["justificativa de 201 caracteres", { opcao: "DOBRA", justificativa: "a".repeat(201) }],
  ])("payload inválido (%s): 422 e nada gravado", async (_nome, extra) => {
    const sala = await criarSala(2);
    const res = await hypothesisRoute.POST(hipoteseReq(sala, extra));
    expect(res.status).toBe(422);
    const rows = await estadoBanco(
      `SELECT 1 FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(rows).toHaveLength(0);
  });

  it("professor não confirma hipótese: 403", async () => {
    const sala = await criarSala(2);
    const res = await hypothesisRoute.POST(
      hipoteseReq(sala, { cookie: sala.professorCookie, role: "PROFESSOR", groupNumero: undefined as unknown as number }),
    );
    expect(res.status).toBe(403);
  });

  it.each([
    ["groupNumero divergente", { groupNumero: 2, cookie: undefined, role: undefined }],
    // Cookie de professor com identidade de grupo: divergência de identidade.
    ["papel divergente", { groupNumero: undefined, cookie: "__PROF__", role: "GRUPO" }],
  ])("identidade esperada divergente (%s): 409 sem gravar", async (_nome, extra) => {
    const sala = await criarSala(2);
    if (extra.cookie === "__PROF__") {
      extra.cookie = sala.professorCookie;
    }
    const res = await hypothesisRoute.POST(hipoteseReq(sala, extra));
    expect(res.status).toBe(409);
    const rows = await estadoBanco(
      `SELECT 1 FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(rows).toHaveLength(0);
  });

  it("grupo de outra sala não escreve nesta sala: 409", async () => {
    const salaA = await criarSala(1);
    const salaB = await criarSala(1);
    const res = await hypothesisRoute.POST(
      hipoteseReq(salaA, { cookie: salaB.groupCookies[0], roomId: salaA.roomId }),
    );
    expect(res.status).toBe(409);
    const naSalaA = await estadoBanco(
      `SELECT 1 FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [salaA.roomId],
    );
    expect(naSalaA).toHaveLength(0);
    // O grupo continua podendo escrever na própria sala.
    const naSalaB = await hypothesisRoute.POST(
      hipoteseReq(salaB, { cookie: salaB.groupCookies[0], roomId: salaB.roomId }),
    );
    expect(naSalaB.status).toBe(200);
  });

  it("sem cookie de sessão: 401", async () => {
    const sala = await criarSala(1);
    const res = await hypothesisRoute.POST(hipoteseReq(sala, { cookie: "" }));
    expect(res.status).toBe(401);
  });

  it("fora da fase HIPOTESES sem hipótese prévia: 409 com fase atual; retry igual pós-avanço segue idempotente", async () => {
    const sala = await criarSala(2);
    await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "IGUAL" }));
    // Grupo 2 fica ausente: professor confirma a lista exata [2].
    const adv = await avancar(sala, { confirmados: [2] });
    expect(adv.status).toBe(200);
    expect((await adv.json()).phase).toBe("MEDICOES");

    const tarde = await hypothesisRoute.POST(hipoteseReq(sala, { cookie: sala.groupCookies[1], groupNumero: 2, opcao: "DOBRA" }));
    expect(tarde.status).toBe(409);
    expect((await tarde.json()).phase).toBe("MEDICOES");

    // Retry igual do grupo 1 após a mudança de fase: sucesso sem duplicar.
    const retry = await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "IGUAL" }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).repeated).toBe(true);
  });
});

describe("POST /api/room/advance", () => {
  it("todos responderam: avança sem pedir confirmação", async () => {
    const sala = await criarSala(2);
    for (let i = 0; i < 2; i++) {
      const res = await hypothesisRoute.POST(hipoteseReq(sala, { cookie: sala.groupCookies[i], groupNumero: i + 1, opcao: "DOBRA" }));
      expect(res.status).toBe(200);
    }
    const res = await avancar(sala);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).phase).toBe("MEDICOES");
    const rows = await estadoBanco(`SELECT status FROM groups WHERE room_id = $1 ORDER BY numero`, [sala.roomId]);
    expect(rows.map((r) => r.status)).toEqual(["PARTICIPANTE", "PARTICIPANTE"]);
  });

  it("com ausentes: 409 pede confirmação; lista divergente 409; lista exata avança e marca AUSENTE", async () => {
    const sala = await criarSala(3);
    await hypothesisRoute.POST(hipoteseReq(sala, { cookie: sala.groupCookies[0], groupNumero: 1, opcao: "MENOR" }));

    const sem = await avancar(sala);
    expect(sem.status).toBe(409);
    const corpoSem = await sem.json();
    expect(corpoSem.requiresConfirmation).toBe(true);
    expect(corpoSem.pendentes).toEqual([2, 3]);
    expect(corpoSem.phase).toBe("HIPOTESES");

    const divergente = await avancar(sala, { confirmados: [2] });
    expect(divergente.status).toBe(409);
    expect((await divergente.json()).pendentes).toEqual([2, 3]);

    const exata = await avancar(sala, { confirmados: [3, 2] });
    expect(exata.status).toBe(200);
    const rows = await estadoBanco(`SELECT numero, status FROM groups WHERE room_id = $1 ORDER BY numero`, [sala.roomId]);
    expect(rows.map((r) => r.status)).toEqual(["PARTICIPANTE", "AUSENTE", "AUSENTE"]);
  });

  it("todos ausentes com confirmação explícita: avança com zero participantes", async () => {
    const sala = await criarSala(2);
    const res = await avancar(sala, { confirmados: [1, 2] });
    expect(res.status).toBe(200);
    const rows = await estadoBanco(`SELECT status FROM groups WHERE room_id = $1 ORDER BY numero`, [sala.roomId]);
    expect(rows.map((r) => r.status)).toEqual(["AUSENTE", "AUSENTE"]);
  });

  it("grupo não avança: 403; identidade divergente: 409; sem sessão: 401", async () => {
    const sala = await criarSala(1);
    const resGrupo = (await advanceRoute.POST(
      request("/api/room/advance", {
        method: "POST",
        headers: { cookie: sala.groupCookies[0] },
        body: {
          roomId: sala.roomId,
          role: "GRUPO",
          groupNumero: 1,
          confirmados: null,
        },
      }),
    )) as Response;
    expect(resGrupo.status).toBe(403);
    const resDivergente = await avancar(sala, { cookie: sala.groupCookies[0] });
    expect(resDivergente.status).toBe(409);
    const res = await avancar(sala, { cookie: " __Host-lab_session=inexistente" });
    expect(res.status).toBe(401);
  });

  it("avanço repetido cegamente: 409 com estado autorizado atualizado, sem segunda transição", async () => {
    const sala = await criarSala(2);
    for (let i = 0; i < 2; i++) {
      await hypothesisRoute.POST(hipoteseReq(sala, { cookie: sala.groupCookies[i], groupNumero: i + 1, opcao: "IGUAL" }));
    }
    expect((await avancar(sala)).status).toBe(200);
    // Retry após resposta perdida: fase agora MEDICOES; sem submissões, há
    // pendentes → conflito pedindo confirmação, e a fase continua MEDICOES.
    const retry = await avancar(sala);
    expect(retry.status).toBe(409);
    const corpo = await retry.json();
    expect(corpo.phase).toBe("MEDICOES");
    expect(corpo.requiresConfirmation).toBe(true);
    expect(corpo.pendentes).toEqual([1, 2]);
    const fase = await estadoBanco(`SELECT phase FROM rooms WHERE id = $1`, [sala.roomId]);
    expect(fase[0].phase).toBe("MEDICOES");
  });

  it("avanço sem confirmação com pendentes ao revelar: 409; confirmado: REVELADO e status mantido", async () => {
    const sala = await criarSala(1);
    await hypothesisRoute.POST(hipoteseReq(sala, { opcao: "DOBRA" }));
    expect((await avancar(sala)).status).toBe(200); // → MEDICOES
    // Sem submissões (etapa 4), o participante está pendente.
    const sem = await avancar(sala);
    expect(sem.status).toBe(409);
    expect((await sem.json()).pendentes).toEqual([1]);
    const com = await avancar(sala, { confirmados: [1] });
    expect(com.status).toBe(200);
    expect((await com.json()).phase).toBe("REVELADO");
    const rows = await estadoBanco(`SELECT status FROM groups WHERE room_id = $1`, [sala.roomId]);
    expect(rows[0].status).toBe("PARTICIPANTE"); // SEM_MEDICAO na apresentação
    const deNovo = await avancar(sala);
    expect(deNovo.status).toBe(409);
    expect((await deNovo.json()).phase).toBe("REVELADO");
  });

  it("confirmados inválidos: 422", async () => {
    const sala = await criarSala(2);
    const res = await avancar(sala, { confirmados: [5] });
    expect(res.status).toBe(422);
  });
});

describe("Concorrência hipótese × avanço", () => {
  it("ordem consistente: ou o envio entra no recálculo ou o avanço pede confirmação; sem dados parciais", async () => {
    const sala = await criarSala(2);
    // Grupo 1 envia hipótese e professor avança (confirmando lista vazia)
    // simultaneamente; o bloqueio da sala serializa as operações.
    const [resHipotese, resAvanco] = await Promise.all([
      hypothesisRoute.POST(hipoteseReq(sala, { opcao: "MENOR" })),
      avancar(sala, { confirmados: [] }),
    ]);
    const hipoteseOk = resHipotese.status === 200;
    const avancoCorpo = await resAvanco.json();

    const rows = await estadoBanco(
      `SELECT g.numero, g.status, h.opcao FROM groups g
       LEFT JOIN hypotheses h ON h.group_id = g.id
       WHERE g.room_id = $1 ORDER BY g.numero`,
      [sala.roomId],
    );
    const fase = (await estadoBanco(`SELECT phase FROM rooms WHERE id = $1`, [sala.roomId]))[0].phase as string;

    if (fase === "MEDICOES") {
      // Avanço ocorreu primeiro na serialização: hipótese foi recusada (409).
      expect(hipoteseOk).toBe(false);
      expect(resHipotese.status).toBe(409);
      expect(rows[0].status).toBe("AUSENTE");
      expect(rows[0].opcao).toBeNull();
    } else {
      // Hipótese gravou primeiro: deve constar no recálculo do avanço.
      expect(fase).toBe("HIPOTESES");
      expect(resAvanco.status).toBe(409);
      expect(avancoCorpo.requiresConfirmation).toBe(true);
      expect(avancoCorpo.pendentes).toEqual([2]);
      expect(hipoteseOk).toBe(true);
      expect(rows[0].opcao).toBe("MENOR");
      expect(rows[0].status).toBe("PARTICIPANTE");
    }
    // Em nenhum caso há duplicação ou estado parcial.
    expect(rows).toHaveLength(2);
    const hipoteses = await estadoBanco(
      `SELECT COUNT(*)::int AS n FROM hypotheses h JOIN groups g ON g.id = h.group_id WHERE g.room_id = $1`,
      [sala.roomId],
    );
    expect(hipoteses[0].n).toBe(hipoteseOk ? 1 : 0);
  });
});
