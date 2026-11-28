import type { PoolClient } from "pg";
import { getPool } from "./client";
import { nextPhase, type Phase } from "@/domain/phases";
import { listasIguais } from "@/domain/validation";

export type AdvanceResult =
  | { kind: "OK"; phase: string }
  | { kind: "NO_NEXT"; phase: string }
  | { kind: "CONFIRMATION_REQUIRED"; pending: number[]; phase: string }
  | { kind: "CONFIRMATION_DIVERGED"; pending: number[]; phase: string }
  | { kind: "ROOM_GONE" }
  | { kind: "SESSION_GONE" };

export type AdvanceArgs = {
  sessionIdHash: string;
  roomId: string;
  // Lista exata confirmada pelo professor, já normalizada (ordenada, sem
  // duplicatas) ou null quando o professor não informou confirmação.
  confirmed: number[] | null;
};

// Pendências recalculadas DENTRO do bloqueio da sala (PRD 4.3/10):
// - saindo de HIPOTESES: grupos sem hipótese (serão marcados AUSENTE);
// - saindo de MEDICOES: participantes sem submissão de medições.
async function pendencias(client: PoolClient, roomId: string, phase: string): Promise<number[]> {
  if (phase === "HIPOTESES") {
    const rows = await client.query(
      `SELECT g.numero FROM groups g
       LEFT JOIN hypotheses h ON h.group_id = g.id
       WHERE g.room_id = $1 AND h.group_id IS NULL
       ORDER BY g.numero`,
      [roomId],
    );
    return rows.rows.map((r: { numero: number }) => r.numero);
  }
  if (phase === "MEDICOES") {
    const rows = await client.query(
      `SELECT g.numero FROM groups g
       LEFT JOIN submissions s ON s.group_id = g.id
       WHERE g.room_id = $1 AND g.status = 'PARTICIPANTE' AND s.group_id IS NULL
       ORDER BY g.numero`,
      [roomId],
    );
    return rows.rows.map((r: { numero: number }) => r.numero);
  }
  return [];
}

// PRD 9: apenas o professor avança a fase, sempre +1, sem pular ou voltar.
// A confirmação do professor só vale para a lista recalculada dentro da
// transação; divergência gera conflito com o estado autorizado atualizado.
export async function advanceRoomPhase(args: AdvanceArgs): Promise<AdvanceResult> {
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

    // Revalidação sob bloqueio: sessão de professor ativa e não revogada.
    const session = (
      await client.query(
        `SELECT 1 FROM sessions
         WHERE session_id_hash = $1 AND room_id = $2 AND role = 'PROFESSOR'
           AND group_id IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [args.sessionIdHash, args.roomId],
      )
    ).rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      return { kind: "SESSION_GONE" };
    }

    const next = nextPhase(room.phase as Phase);
    if (!next) {
      await client.query("ROLLBACK");
      return { kind: "NO_NEXT", phase: room.phase };
    }

    const pending = await pendencias(client, args.roomId, room.phase);
    if (args.confirmed !== null) {
      if (!listasIguais(args.confirmed, pending)) {
        await client.query("ROLLBACK");
        return { kind: "CONFIRMATION_DIVERGED", pending, phase: room.phase };
      }
    } else if (pending.length > 0) {
      // Sem ausentes/pendentes não se pede confirmação extra (PRD 4.3).
      await client.query("ROLLBACK");
      return { kind: "CONFIRMATION_REQUIRED", pending, phase: room.phase };
    }

    if (room.phase === "HIPOTESES") {
      // AUSENTE é definido somente no avanço da fase de hipóteses (PRD 4.3).
      await client.query(
        `UPDATE groups SET status = 'AUSENTE'
         WHERE room_id = $1 AND id NOT IN (SELECT group_id FROM hypotheses)`,
        [args.roomId],
      );
    }
    // Saindo de MEDICOES: participante pendente permanece PARTICIPANTE e
    // aparece como SEM_MEDICAO na revelação (nenhuma atualização aqui).

    await client.query(`UPDATE rooms SET phase = $2 WHERE id = $1`, [args.roomId, next]);
    await client.query("COMMIT");
    return { kind: "OK", phase: next };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
