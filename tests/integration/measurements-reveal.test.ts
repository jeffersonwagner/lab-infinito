import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { NextRequest } from "next/server";
import { migrate } from "@/db/migrate";
import { roundForDisplay } from "@/domain/calc";

// Etapa 4 (Medições e revelação): envio atômico de seis tempos, idempotência,
// autorização, projeção pós-REVELADO com SEM_MEDICAO e concorrência com avanço.
const dataDir = join(tmpdir(), `lab-invisivel-etapa4-${randomUUID()}`);
const PORT = 55435;

let pgInstance: InstanceType<typeof EmbeddedPostgres> | null = null;
let databaseUrl = "";

let roomsRoute: typeof import("@/app/api/rooms/route");
let sessionRoute: typeof import("@/app/api/session/route");
let roomRoute: typeof import("@/app/api/room/route");
let hypothesisRoute: typeof import("@/app/api/hypothesis/route");
let advanceRoute: typeof import("@/app/api/room/advance/route");
let measurementsRoute: typeof import("@/app/api/measurements/submit/route");

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

let counter = 200;
function uniqueIp(): string {
  counter += 1;
  return `10.2.0.${counter}`;
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

async function confirmarHipotese(
  sala: Sala,
  grupoIdx: number,
  opcao = "DOBRA",
): Promise<Response> {
  return (await hypothesisRoute.POST(
    request("/api/hypothesis", {
      method: "POST",
      headers: { cookie: sala.groupCookies[grupoIdx] },
      body: {
        roomId: sala.roomId,
        role: "GRUPO",
        groupNumero: grupoIdx + 1,
        opcao,
        justificativa: null,
      },
    }),
  )) as Response;
}

async function avancar(
  sala: Sala,
  opts: { confirmados?: number[] | null } = {},
): Promise<Response> {
  return (await advanceRoute.POST(
    request("/api/room/advance", {
      method: "POST",
      headers: { cookie: sala.professorCookie },
      body: {
        roomId: sala.roomId,
        role: "PROFESSOR",
        groupNumero: null,
        confirmados: opts.confirmados ?? null,
      },
    }),
  )) as Response;
}

// Sala pronta para medições: todos os grupos confirmaram hipótese e a fase
// avançou para MEDICOES.
async function salaEmMedicoes(groupCount: number): Promise<Sala> {
  const sala = await criarSala(groupCount);
  for (let i = 0; i < groupCount; i++) {
    const res = await confirmarHipotese(sala, i);
    expect(res.status).toBe(200);
  }
  const adv = await avancar(sala);
  expect(adv.status).toBe(200);
  return sala;
}

function corpoMedicoes(
  sala: Sala,
  opts: {
    cookie?: string;
    groupNumero?: number | null;
    role?: string;
    roomId?: string;
    tempos?: Record<string, Record<string, string>>;
  } = {},
): NextRequest {
  return request("/api/measurements/submit", {
    method: "POST",
    headers: { cookie: opts.cookie ?? sala.groupCookies[0] },
    body: {
      roomId: opts.roomId ?? sala.roomId,
      role: opts.role ?? "GRUPO",
      groupNumero: "groupNumero" in opts ? (opts.groupNumero as number) : 1,
      tempos:
        opts.tempos ??
        {
          50: { 1: "14,1", 2: "14,2", 3: "14,3" },
          100: { 1: "20,0", 2: "20,1", 3: "20,2" },
        },
    },
  });
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

async function medicoesDoGrupo(groupId: string): Promise<Record<string, unknown>[]> {
  return estadoBanco(
    `SELECT comprimento_cm, repeticao, segundos FROM measurements WHERE group_id = $1 ORDER BY comprimento_cm, repeticao`,
    [groupId],
  );
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
  roomRoute = await import("@/app/api/room/route");
  hypothesisRoute = await import("@/app/api/hypothesis/route");
  advanceRoute = await import("@/app/api/room/advance/route");
  measurementsRoute = await import("@/app/api/measurements/submit/route");
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

describe("POST /api/measurements/submit", () => {
  it("participante envia seis tempos válidos (vírgula): grava 6 medições + submissão atomicamente", async () => {
    const sala = await salaEmMedicoes(2);
    const res = await measurementsRoute.POST(corpoMedicoes(sala));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.confirmed).toBe(true);
    expect(body.repeated).toBe(false);

    const grupos = await estadoBanco(`SELECT id, status FROM groups WHERE room_id = $1`, [sala.roomId]);
    const grupo1 = grupos.find((g) => g.status === "PARTICIPANTE")!;
    const rows = await medicoesDoGrupo(grupo1.id as string);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.segundos)).toEqual([
      "14.100", "14.200", "14.300", "20.000", "20.100", "20.200",
    ]);
    const subs = await estadoBanco(`SELECT 1 FROM submissions WHERE group_id = $1`, [grupo1.id]);
    expect(subs).toHaveLength(1);
  });

  it("retry igual: 200 idempotente sem duplicar; conjunto diferente: 409 preservando o original", async () => {
    const sala = await salaEmMedicoes(1);
    await measurementsRoute.POST(corpoMedicoes(sala));
    const retry = await measurementsRoute.POST(corpoMedicoes(sala));
    expect(retry.status).toBe(200);
    expect((await retry.json()).repeated).toBe(true);

    const diferente = await measurementsRoute.POST(
      corpoMedicoes(sala, {
        tempos: { 50: { 1: "13,9", 2: "14,0", 3: "14,1" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } },
      }),
    );
    expect(diferente.status).toBe(409);
    const grupo = (await estadoBanco(`SELECT id FROM groups WHERE room_id = $1`, [sala.roomId]))[0];
    expect(await medicoesDoGrupo(grupo.id as string)).toHaveLength(6);
  });

  it.each([
    ["incompleto (5 tempos)", { 50: { 1: "14,1", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1" } }],
    ["expoente", { 50: { 1: "1e2", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } }],
    ["vazio", { 50: { 1: "", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } }],
    ["abaixo do mínimo", { 50: { 1: "1,9", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } }],
    ["acima do máximo", { 50: { 1: "120,1", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } }],
    ["milhar", { 50: { 1: "1.000", 2: "14,2", 3: "14,3" }, 100: { 1: "20,0", 2: "20,1", 3: "20,2" } }],
  ])("payload inválido (%s): 422 e nada gravado", async (_nome, tempos) => {
    const sala = await salaEmMedicoes(1);
    const res = await measurementsRoute.POST(corpoMedicoes(sala, { tempos: tempos as Record<string, Record<string, string>> }));
    expect(res.status).toBe(422);
    const grupo = (await estadoBanco(`SELECT id FROM groups WHERE room_id = $1`, [sala.roomId]))[0];
    expect(await medicoesDoGrupo(grupo.id as string)).toHaveLength(0);
    expect(
      await estadoBanco(
        `SELECT 1 FROM submissions s JOIN groups g ON g.id = s.group_id WHERE g.room_id = $1`,
        [sala.roomId],
      ),
    ).toHaveLength(0);
  });

  it("fora da fase MEDICOES (em HIPOTESES): 409", async () => {
    const sala = await criarSala(1);
    const res = await measurementsRoute.POST(corpoMedicoes(sala));
    expect(res.status).toBe(409);
  });

  it("grupo AUSENTE não envia medições: 409", async () => {
    const sala = await criarSala(2);
    await confirmarHipotese(sala, 0);
    await avancar(sala, { confirmados: [2] });
    const res = await measurementsRoute.POST(
      corpoMedicoes(sala, { cookie: sala.groupCookies[1], groupNumero: 2 }),
    );
    expect(res.status).toBe(409);
  });

  it("professor não envia medições: 403", async () => {
    const sala = await salaEmMedicoes(1);
    const res = await measurementsRoute.POST(
      corpoMedicoes(sala, { cookie: sala.professorCookie, role: "PROFESSOR", groupNumero: null }),
    );
    expect(res.status).toBe(403);
  });

  it("identidade divergente: 409; sem sessão: 401", async () => {
    const sala = await salaEmMedicoes(2);
    const divergente = await measurementsRoute.POST(
      corpoMedicoes(sala, { groupNumero: 2 }),
    );
    expect(divergente.status).toBe(409);
    const semSessao = await measurementsRoute.POST(
      corpoMedicoes(sala, { cookie: "" }),
    );
    expect(semSessao.status).toBe(401);
  });

  it("retry igual após a fase avançar: idempotente; nunca grava conjunto novo", async () => {
    const sala = await salaEmMedicoes(1);
    await measurementsRoute.POST(corpoMedicoes(sala));
    const revela = await avancar(sala, { confirmados: [] });
    expect(revela.status).toBe(200);
    const retry = await measurementsRoute.POST(corpoMedicoes(sala));
    expect(retry.status).toBe(200);
    expect((await retry.json()).repeated).toBe(true);
    const grupo = (await estadoBanco(`SELECT id FROM groups WHERE room_id = $1`, [sala.roomId]))[0];
    expect(await medicoesDoGrupo(grupo.id as string)).toHaveLength(6);
  });
});

describe("Revelação e projeções autorizadas", () => {
  it("caso fixo da seção 6: razão 1,42 exibida com precisão integral no servidor", async () => {
    const sala = await salaEmMedicoes(1);
    await measurementsRoute.POST(corpoMedicoes(sala)); // tempos do caso fixo
    const res = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=PROFESSOR`, {
        headers: { cookie: sala.professorCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups[0].tempos).toBeNull(); // antes da revelação: só progresso

    const revela = await avancar(sala, { confirmados: [] });
    expect(revela.status).toBe(200);

    const res2 = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=PROFESSOR`, {
        headers: { cookie: sala.professorCookie },
      }),
    );
    const body2 = await res2.json();
    const stats = body2.groups[0].stats;
    expect(stats.lengths[0].media).toBeCloseTo(14.2, 9);
    expect(stats.lengths[0].periodo).toBeCloseTo(1.42, 9);
    expect(stats.lengths[0].amplitude).toBeCloseTo(0.2, 9);
    expect(stats.lengths[1].periodo).toBeCloseTo(2.01, 9);
    // PRD 6: precisão integral no servidor (2,01 ÷ 1,42 = 1,41549…);
    // o arredondamento para 1,42 acontece só na apresentação.
    expect(stats.razao).toBeCloseTo(1.415492957746479, 9);
    expect(roundForDisplay(stats.razao, 2)).toBe(1.42);
    expect(stats.lengths[0].amplitudeAlerta).toBe(false);
  });

  it("grupo antes da revelação não recebe dados alheios; após revelação recebe comparação", async () => {
    const sala = await salaEmMedicoes(2);
    await measurementsRoute.POST(corpoMedicoes(sala, { cookie: sala.groupCookies[0], groupNumero: 1 }));

    const antes = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=GRUPO&groupNumero=1`, {
        headers: { cookie: sala.groupCookies[0] },
      }),
    );
    const antesBody = await antes.json();
    expect(antesBody.revealed).toBe(false);
    expect(antesBody.resultados).toBeNull();
    expect(antesBody.group.tempos).not.toBeNull(); // próprios dados: liberado

    await avancar(sala, { confirmados: [2] }); // grupo 2 pendente confirmado

    const depois = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=GRUPO&groupNumero=1`, {
        headers: { cookie: sala.groupCookies[0] },
      }),
    );
    const depoisBody = await depois.json();
    expect(depoisBody.revealed).toBe(true);
    expect(depoisBody.resultados).toHaveLength(2);
    const g2 = depoisBody.resultados.find((g: { numero: number }) => g.numero === 2);
    expect(g2.tempos).toBeNull();
    expect(g2.stats).toBeNull();
    expect(g2.measurementsConfirmed).toBe(false); // SEM_MEDICAO, não zero
  });

  it("grupo ausente consulta resultados após a revelação", async () => {
    const sala = await criarSala(2);
    await confirmarHipotese(sala, 0);
    await avancar(sala, { confirmados: [2] });
    await measurementsRoute.POST(corpoMedicoes(sala, { cookie: sala.groupCookies[0], groupNumero: 1 }));
    await avancar(sala, { confirmados: [] });
    const res = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=GRUPO&groupNumero=2`, {
        headers: { cookie: sala.groupCookies[1] },
      }),
    );
    const body = await res.json();
    expect(body.revealed).toBe(true);
    expect(body.group.status).toBe("AUSENTE");
    expect(body.group.tempos).toBeNull();
    expect(body.resultados).toHaveLength(2);
    expect(roundForDisplay(body.resultados[0].stats.razao, 2)).toBe(1.42);
  });

  it("participante pendente permanece PARTICIPANTE e aparece como sem medição", async () => {
    const sala = await salaEmMedicoes(1);
    const revela = await avancar(sala, { confirmados: [1] });
    expect(revela.status).toBe(200);
    const rows = await estadoBanco(`SELECT status FROM groups WHERE room_id = $1`, [sala.roomId]);
    expect(rows[0].status).toBe("PARTICIPANTE");
    const res = await roomRoute.GET(
      request(`/api/room?roomId=${sala.roomId}&role=PROFESSOR`, {
        headers: { cookie: sala.professorCookie },
      }),
    );
    const body = await res.json();
    expect(body.groups[0].measurementsConfirmed).toBe(false);
    expect(body.groups[0].tempos).toBeNull();
    expect(body.groups[0].stats).toBeNull();
  });
});

describe("Concorrência medição × revelação", () => {
  it("ordem consistente: ou a medição entra antes da revelação ou é recusada; sem dados parciais", async () => {
    const sala = await salaEmMedicoes(2);
    await measurementsRoute.POST(corpoMedicoes(sala, { cookie: sala.groupCookies[0], groupNumero: 1 }));
    // Grupo 2 envia e professor revela (confirmando lista vazia) em paralelo.
    const [resMedicao, resAvanco] = await Promise.all([
      measurementsRoute.POST(corpoMedicoes(sala, { cookie: sala.groupCookies[1], groupNumero: 2 })),
      avancar(sala, { confirmados: [] }),
    ]);
    const fase = (await estadoBanco(`SELECT phase FROM rooms WHERE id = $1`, [sala.roomId]))[0].phase as string;
    const grupo2 = (await estadoBanco(`SELECT id, status FROM groups WHERE room_id = $1 AND numero = 2`, [sala.roomId]))[0];
    const medicoes2 = await medicoesDoGrupo(grupo2.id as string);

    if (fase === "REVELADO") {
      // Dois desfechos consistentes: ou a medição gravou primeiro (incluída
      // antes da revelação) ou a revelação ocorreu primeiro e o envio foi
      // recusado. Em nenhum caso há dados parciais.
      if (resMedicao.status === 200) {
        expect(medicoes2).toHaveLength(6);
      } else {
        expect(resMedicao.status).toBe(409);
        expect(medicoes2).toHaveLength(0);
      }
    } else {
      // Medição gravou primeiro: entra no recálculo → confirmação pedida sem o grupo 2.
      expect(fase).toBe("MEDICOES");
      expect(resMedicao.status).toBe(200);
      expect(resAvanco.status).toBe(409);
      const corpo = await resAvanco.json();
      expect(corpo.requiresConfirmation).toBe(true);
      expect(corpo.pendentes).toEqual([]);
      expect(medicoes2).toHaveLength(6);
    }
    // Sempre consistente: grupo 1 participante com 6 medições.
    const grupo1 = (await estadoBanco(`SELECT id FROM groups WHERE room_id = $1 AND numero = 1`, [sala.roomId]))[0];
    expect(await medicoesDoGrupo(grupo1.id as string)).toHaveLength(6);
  });
});
