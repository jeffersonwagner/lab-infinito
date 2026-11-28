import { getPool } from "./client";

export type LockHypothesisResult =
  | { kind: "OK" }
  | { kind: "IDEMPOTENT" }
  | { kind: "CONTENT_CONFLICT" }
  | { kind: "PHASE"; phase: string }
  | { kind: "ROOM_GONE" }
  | { kind: "SESSION_GONE" }
  | { kind: "NO_GROUP" };

export type LockHypothesisArgs = {
  sessionIdHash: string;
  roomId: string;
  groupNumero: number;
  opcao: string;
  justificativa: string | null;
};

// PRD 9/10: grava a hipótese única do grupo numa transação que bloqueia a sala
// (SELECT ... FOR UPDATE), revalidando sessão, expiração e fase dentro do
// bloqueio. Retry igual retorna sucesso sem duplicar ou alterar (idempotência
// vale inclusive após a fase avançar); conteúdo diferente retorna conflito.
export async function lockHypothesis(args: LockHypothesisArgs): Promise<LockHypothesisResult> {
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

    // Revalidação sob bloqueio: sessão revogada/expirada não pode ser aproveitada.
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

    const existing = (
      await client.query<{ opcao: string; justificativa: string | null }>(
        `SELECT opcao, justificativa FROM hypotheses WHERE group_id = $1`,
        [group.id],
      )
    ).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      const same =
        existing.opcao === args.opcao &&
        (existing.justificativa ?? null) === args.justificativa;
      // Comparação usa valores já normalizados (justificativa aparada).
      return same ? { kind: "IDEMPOTENT" } : { kind: "CONTENT_CONFLICT" };
    }

    if (room.phase !== "HIPOTESES") {
      await client.query("ROLLBACK");
      return { kind: "PHASE", phase: room.phase };
    }

    await client.query(
      `INSERT INTO hypotheses (group_id, opcao, justificativa) VALUES ($1, $2, $3)`,
      [group.id, args.opcao, args.justificativa],
    );
    if (group.status === "PENDENTE") {
      await client.query(`UPDATE groups SET status = 'PARTICIPANTE' WHERE id = $1`, [
        group.id,
      ]);
    }
    await client.query("COMMIT");
    return { kind: "OK" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
