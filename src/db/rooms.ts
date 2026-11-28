import { getPool } from "./client";
import { generateLinkToken, generateSessionId } from "@/lib/tokens";
import { computeGroupStats, type GroupStats } from "@/domain/calc";

export const ROOM_TTL_DAYS = 14;
export const SESSION_COOKIE = "__Host-lab_session";

export type CreatedRoom = {
  roomId: string;
  phase: string;
  createdAt: Date;
  expiresAt: Date;
  groupCount: number;
  links: { role: "PROFESSOR" | "GRUPO"; groupNumero: number | null; link: string }[];
};

export type CreateRoomArgs = {
  groupCount: number;
  baseUrl: string;
};

// PRD 9: cria sala, grupos e credenciais em transação única.
export async function createRoomWithCredentials({
  groupCount,
  baseUrl,
}: CreateRoomArgs): Promise<CreatedRoom> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = (
      await client.query<{ id: string; phase: string; created_at: Date; expires_at: Date }>(
        `INSERT INTO rooms (expires_at)
         VALUES (now() + ($1 || ' days')::interval)
         RETURNING id, phase, created_at, expires_at`,
        [String(ROOM_TTL_DAYS)],
      )
    ).rows[0];

    const tokens: { token: string; tokenHash: string }[] = [];
    for (let i = 0; i < groupCount; i++) {
      tokens.push(generateLinkToken());
    }
    const professorToken = generateLinkToken();

    const groupIds: { id: string; numero: number }[] = [];
    for (let numero = 1; numero <= groupCount; numero++) {
      const inserted = (
        await client.query<{ id: string }>(
          `INSERT INTO groups (room_id, numero) VALUES ($1, $2) RETURNING id`,
          [room.id, numero],
        )
      ).rows[0];
      groupIds.push({ id: inserted.id, numero });
    }

    await client.query(
      `INSERT INTO credentials (token_hash, role, room_id, group_id, expires_at)
       VALUES ($1, 'PROFESSOR', $2, NULL, $3)`,
      [professorToken.tokenHash, room.id, room.expires_at],
    );
    for (let i = 0; i < groupCount; i++) {
      await client.query(
        `INSERT INTO credentials (token_hash, role, room_id, group_id, expires_at)
         VALUES ($1, 'GRUPO', $2, $3, $4)`,
        [tokens[i].tokenHash, room.id, groupIds[i].id, room.expires_at],
      );
    }
    await client.query("COMMIT");

    const links: CreatedRoom["links"] = [
      {
        role: "PROFESSOR",
        groupNumero: null,
        link: `${baseUrl}/entrar#${professorToken.token}`,
      },
      ...groupIds.map((g, i) => ({
        role: "GRUPO" as const,
        groupNumero: g.numero,
        link: `${baseUrl}/entrar#${tokens[i].token}`,
      })),
    ];

    return {
      roomId: room.id,
      phase: room.phase,
      createdAt: room.created_at,
      expiresAt: room.expires_at,
      groupCount,
      links,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type ActiveSession = {
  sessionIdHash: string;
  role: "PROFESSOR" | "GRUPO";
  roomId: string;
  roomPhase: string;
  roomExpiresAt: Date;
  expiresAt: Date;
  groupNumero: number | null;
};

export async function findActiveSession(
  sessionIdHash: string,
): Promise<ActiveSession | null> {
  const result = await getPool().query(
    `SELECT s.session_id_hash, s.role, s.expires_at,
            r.id AS room_id, r.phase AS room_phase, r.expires_at AS room_expires_at,
            g.numero AS group_numero
     FROM sessions s
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE s.session_id_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND r.expires_at > now()`,
    [sessionIdHash],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    sessionIdHash: row.session_id_hash,
    role: row.role,
    roomId: row.room_id,
    roomPhase: row.room_phase,
    roomExpiresAt: row.room_expires_at,
    expiresAt: row.expires_at,
    groupNumero: row.group_numero ?? null,
  };
}

export async function insertSession(args: {
  role: "PROFESSOR" | "GRUPO";
  roomId: string;
  groupNumero: number | null;
}): Promise<{ sessionId: string; expiresAt: Date } | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const room = (
      await client.query(`SELECT id, expires_at FROM rooms WHERE id = $1 FOR SHARE`, [
        args.roomId,
      ])
    ).rows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return null;
    }
    let groupId: string | null = null;
    if (args.groupNumero !== null) {
      const group = (
        await client.query(
          `SELECT id FROM groups WHERE room_id = $1 AND numero = $2`,
          [args.roomId, args.groupNumero],
        )
      ).rows[0];
      if (!group) {
        await client.query("ROLLBACK");
        return null;
      }
      groupId = group.id;
    }
    const { sessionId, sessionIdHash } = generateSessionId();
    const inserted = (
      await client.query<{ expires_at: Date }>(
        `INSERT INTO sessions (session_id_hash, role, room_id, group_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING expires_at`,
        [sessionIdHash, args.role, args.roomId, groupId, room.expires_at],
      )
    ).rows[0];
    await client.query("COMMIT");
    return { sessionId, expiresAt: inserted.expires_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type TemposPorComprimento = { 50: number[]; 100: number[] };

export type GroupProjection = {
  numero: number;
  status: string;
  hypothesis: { opcao: string; justificativa: string | null } | null;
  measurementsConfirmed: boolean;
  // Tempos e estatísticas só são preenchidos quando autorizado: dados próprios
  // do grupo ou visão pós-REVELADO (PRD 4.2). Participante pendente fica com
  // tempos/stats nulos — aparece como SEM_MEDICAO, nunca como zero.
  tempos: TemposPorComprimento | null;
  stats: GroupStats | null;
};

export type RoomBase = {
  phase: string;
  expiresAt: Date;
};

export async function getRoomBase(roomId: string): Promise<RoomBase | null> {
  const row = (
    await getPool().query(
      `SELECT phase, expires_at FROM rooms WHERE id = $1 AND expires_at > now()`,
      [roomId],
    )
  ).rows[0];
  if (!row) {
    return null;
  }
  return { phase: row.phase, expiresAt: row.expires_at };
}

type GroupRow = {
  numero: number;
  status: string;
  opcao: string | null;
  justificativa: string | null;
  measurements_confirmed: boolean;
};

function statsDe(tempos: TemposPorComprimento): GroupStats {
  return computeGroupStats({ times: tempos[50] }, { times: tempos[100] });
}

// Carrega os grupos da sala. Tempos/estatísticas só entram na projeção quando
// includeMeasurements (dados próprios do grupo ou fase REVELADO).
async function loadGroups(
  roomId: string,
  includeMeasurements: boolean,
): Promise<GroupProjection[]> {
  const rows: GroupRow[] = (
    await getPool().query(
      `SELECT g.numero, g.status,
              h.opcao, h.justificativa,
              (sub.group_id IS NOT NULL) AS measurements_confirmed
       FROM groups g
       LEFT JOIN hypotheses h ON h.group_id = g.id
       LEFT JOIN submissions sub ON sub.group_id = g.id
       WHERE g.room_id = $1
       ORDER BY g.numero`,
      [roomId],
    )
  ).rows;

  let temposPorGrupo = new Map<number, TemposPorComprimento>();
  if (includeMeasurements && rows.length > 0) {
    const medidaRows = (
      await getPool().query(
        `SELECT g.numero AS numero, m.comprimento_cm, m.repeticao, m.segundos
         FROM measurements m JOIN groups g ON g.id = m.group_id
         WHERE g.room_id = $1 ORDER BY g.numero, m.comprimento_cm, m.repeticao`,
        [roomId],
      )
    ).rows as { numero: number; comprimento_cm: number; repeticao: number; segundos: string }[];
    for (const row of medidaRows) {
      const atual = temposPorGrupo.get(row.numero) ?? { 50: [0, 0, 0], 100: [0, 0, 0] };
      atual[row.comprimento_cm as 50 | 100][row.repeticao - 1] = parseFloat(row.segundos);
      temposPorGrupo.set(row.numero, atual);
    }
  }

  return rows.map((r) => {
    // Só expõe tempos quando há submissão confirmada (grupo participante);
    // pendente permanece sem medição, sem zero fictício (PRD 4.1/8.1).
    const tempos = r.measurements_confirmed ? (temposPorGrupo.get(r.numero) ?? null) : null;
    return {
      numero: r.numero,
      status: r.status,
      hypothesis: r.opcao ? { opcao: r.opcao, justificativa: r.justificativa } : null,
      measurementsConfirmed: r.measurements_confirmed,
      tempos,
      stats: tempos ? statsDe(tempos) : null,
    };
  });
}

export async function getProfessorProjection(roomId: string): Promise<{
  room: RoomBase;
  groups: GroupProjection[];
} | null> {
  const room = await getRoomBase(roomId);
  if (!room) {
    return null;
  }
  // PRD 4.2: antes da revelação o professor vê hipóteses e progresso de
  // envio; detalhes das medições apenas em REVELADO.
  const groups = await loadGroups(roomId, room.phase === "REVELADO");
  return { room, groups };
}

// PRD 4.2: antes da revelação o grupo vê apenas o próprio estado (com os
// próprios tempos/estatísticas); dados dos demais somente após REVELADO.
export async function getGroupProjection(
  roomId: string,
  groupNumero: number,
): Promise<{
  room: RoomBase;
  group: GroupProjection;
  revealed: boolean;
  resultados: GroupProjection[] | null;
} | null> {
  const room = await getRoomBase(roomId);
  if (!room) {
    return null;
  }
  const revealed = room.phase === "REVELADO";
  const own = (await loadGroups(roomId, true)).find((g) => g.numero === groupNumero);
  if (!own) {
    return null;
  }
  return {
    room,
    group: own,
    revealed,
    // PRD 4.1: após a revelação, grupos autorizados consultam os resultados
    // dos participantes; antes disso, nenhum dado alheio sai daqui.
    resultados: revealed ? await loadGroups(roomId, true) : null,
  };
}

export function sessionCookieValue(sessionId: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString();
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}
