import { getPool } from "./client";

export type Credential = {
  role: "PROFESSOR" | "GRUPO";
  roomId: string;
  roomExpired: boolean;
  groupNumero: number | null;
};

// PRD 8.2: apenas o hash do token é armazenado; a troca valida existência,
// revogação, expiração da credencial e expiração da sala.
export async function findCredentialByTokenHash(
  tokenHash: string,
): Promise<Omit<Credential, "roomExpired"> | null> {
  const row = (
    await getPool().query(
      `SELECT c.role, r.id AS room_id, g.numero AS group_numero
       FROM credentials c
       JOIN rooms r ON r.id = c.room_id
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.token_hash = $1
         AND c.revoked_at IS NULL
         AND c.expires_at > now()
         AND r.expires_at > now()`,
      [tokenHash],
    )
  ).rows[0];
  if (!row) {
    return null;
  }
  return {
    role: row.role,
    roomId: row.room_id,
    groupNumero: row.group_numero ?? null,
  };
}
