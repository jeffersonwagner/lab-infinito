import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __labPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não definida (veja .env.example).");
  }
  if (!global.__labPool) {
    global.__labPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return global.__labPool;
}
