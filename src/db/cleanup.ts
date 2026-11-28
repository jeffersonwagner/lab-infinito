import { getPool } from "./client";

// PRD 11: rotina autenticada de limpeza das salas expiradas e dados
// associados. O ON DELETE CASCADE do schema remove grupos, hipóteses,
// medições, submissões, credenciais e sessões ligadas à sala.
export async function deleteExpiredRooms(): Promise<number> {
  const result = await getPool().query(
    `DELETE FROM rooms WHERE expires_at <= now()`,
  );
  return result.rowCount ?? 0;
}
