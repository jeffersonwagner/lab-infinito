import { getPool } from "./client";
import { generateLinkToken, generateSessionId } from "@/lib/tokens";

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

export type GroupProjection = {
  numero: number;
  status: string;
  hypothesis: { opcao: string; justificativa: string | null } | null;
  measurementsConfirmed: boolean;
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

export async function getProfessorProjection(roomId: string): Promise<{
  room: RoomBase;
  groups: GroupProjection[];
} | null> {
  const room = await getRoomBase(roomId);
  if (!room) {
    return null;
  }
  const rows = (
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
  return {
    room,
    groups: rows.map((r) => ({
      numero: r.numero,
      status: r.status,
      hypothesis: r.opcao ? { opcao: r.opcao, justificativa: r.justificativa } : null,
      measurementsConfirmed: r.measurements_confirmed,
    })),
  };
}

// PRD 4.2: na fase HIPOTESES o grupo vê apenas o próprio estado; dados dos
// demais somente após REVELADO (comparação completa chega na etapa 4).
export async function getGroupProjection(
  roomId: string,
  groupNumero: number,
): Promise<{
  room: RoomBase;
  group: GroupProjection;
  revealed: boolean;
} | null> {
  const room = await getRoomBase(roomId);
  if (!room) {
    return null;
  }
  const row = (
    await getPool().query(
      `SELECT g.numero, g.status,
              h.opcao, h.justificativa,
              (sub.group_id IS NOT NULL) AS measurements_confirmed
       FROM groups g
       LEFT JOIN hypotheses h ON h.group_id = g.id
       LEFT JOIN submissions sub ON sub.group_id = g.id
       WHERE g.room_id = $1 AND g.numero = $2`,
      [roomId, groupNumero],
    )
  ).rows[0];
  if (!row) {
    return null;
  }
  return {
    room,
    group: {
      numero: row.numero,
      status: row.status,
      hypothesis: row.opcao ? { opcao: row.opcao, justificativa: row.justificativa } : null,
      measurementsConfirmed: row.measurements_confirmed,
    },
    revealed: room.phase === "REVELADO",
  };
}

export function sessionCookieValue(sessionId: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString();
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}
