import type { PoolClient } from "pg";
import { getPool } from "./client";
import type { SubmittedMeasurements } from "@/domain/measurements";

export type SubmitMeasurementsResult =
  | { kind: "OK" }
  | { kind: "IDEMPOTENT" }
  | { kind: "CONTENT_CONFLICT" }
  | { kind: "PHASE"; phase: string }
  | { kind: "NOT_PARTICIPANT"; status: string }
  | { kind: "ROOM_GONE" }
  | { kind: "SESSION_GONE" }
  | { kind: "NO_GROUP" };

export type SubmitMeasurementsArgs = {
  sessionIdHash: string;
  roomId: string;
  groupNumero: number;
  tempos: SubmittedMeasurements;
};

const EPSILON = 1e-9;

function mesmoValor(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

async function temposGravados(
  client: PoolClient,
  groupId: string,
): Promise<{ 50: number[]; 100: number[] } | null> {
  const rows = (
    await client.query<{ comprimento_cm: number; repeticao: number; segundos: string }>(
      `SELECT comprimento_cm, repeticao, segundos FROM measurements
       WHERE group_id = $1 ORDER BY comprimento_cm, repeticao`,
      [groupId],
    )
  ).rows;
  if (rows.length === 0) {
    return null;
  }
  const tempos: { 50: number[]; 100: number[] } = { 50: [0, 0, 0], 100: [0, 0, 0] };
  for (const row of rows) {
    tempos[row.comprimento_cm as 50 | 100][row.repeticao - 1] = parseFloat(row.segundos);
  }
  return tempos;
}

function mesmoConjunto(
  gravado: { 50: number[]; 100: number[] },
  enviado: SubmittedMeasurements,
): boolean {
  for (const length of [50, 100] as const) {
    for (const rep of [1, 2, 3] as const) {
      if (!mesmoValor(gravado[length][rep - 1], enviado[length][rep])) {
        return false;
      }
    }
  }
  return true;
}

// PRD 9/10: grava as seis medições + a submissão numa única transação que
// bloqueia a sala; revalida sessão, expiração, fase e participação dentro do
// bloqueio. Retry igual retorna sucesso sem duplicar/alterar (inclusive após
// a fase avançar); conjunto diferente retorna conflito. Falha parcial implica
// rollback integral.
export async function submitMeasurements(
  args: SubmitMeasurementsArgs,
): Promise<SubmitMeasurementsResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const room = (
      await client.query<{ id: string; phase: string; expires_at: Date }>(
        `SELECT id, phase, expires_at FROM rooms WHERE id = $1 FOR UPDATE`,
        [args.roomId],
      )
    ).rows[0];
    if (!room || room.expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { kind: "ROOM_GONE" };
    }

    const group = (
      await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM groups WHERE room_id = $1 AND numero = $2 FOR UPDATE`,
        [args.roomId, args.groupNumero],
      )
    ).rows[0];
    if (!group) {
      await client.query("ROLLBACK");
      return { kind: "NO_GROUP" };
    }

    const session = (
      await client.query(
        `SELECT 1 FROM sessions
         WHERE session_id_hash = $1 AND room_id = $2 AND group_id = $3
           AND role = 'GRUPO' AND revoked_at IS NULL AND expires_at > now()`,
        [args.sessionIdHash, args.roomId, group.id],
      )
    ).rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      return { kind: "SESSION_GONE" };
    }

    const submission = (
      await client.query(`SELECT 1 FROM submissions WHERE group_id = $1`, [group.id])
    ).rows[0];
    if (submission) {
      const gravado = await temposGravados(client, group.id);
      await client.query("ROLLBACK");
      if (gravado && mesmoConjunto(gravado, args.tempos)) {
        return { kind: "IDEMPOTENT" };
      }
      return { kind: "CONTENT_CONFLICT" };
    }

    if (room.phase !== "MEDICOES") {
      await client.query("ROLLBACK");
      return { kind: "PHASE", phase: room.phase };
    }
    // AUSENTE/sem hipótese fica fora das medições da rodada (PRD 4.1).
    if (group.status !== "PARTICIPANTE") {
      await client.query("ROLLBACK");
      return { kind: "NOT_PARTICIPANT", status: group.status };
    }

    for (const length of [50, 100] as const) {
      for (const rep of [1, 2, 3] as const) {
        await client.query(
          `INSERT INTO measurements (group_id, comprimento_cm, repeticao, segundos)
           VALUES ($1, $2, $3, $4)`,
          [group.id, length, rep, args.tempos[length][rep]],
        );
      }
    }
    await client.query(`INSERT INTO submissions (group_id) VALUES ($1)`, [group.id]);
    await client.query("COMMIT");
    return { kind: "OK" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
