import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { migrate } from "@/db/migrate";

const dataDir = join(tmpdir(), `lab-invisivel-pg-${randomUUID()}`);

let pgInstance: InstanceType<typeof EmbeddedPostgres> | null = null;
let databaseUrl = "";

beforeAll(async () => {
  pgInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "test",
    password: "test",
    port: 55432,
    persistent: false,
  });
  await pgInstance.initialise();
  await pgInstance.start();
  await pgInstance.createDatabase("lab_test");
  databaseUrl = "postgresql://test:test@localhost:55432/lab_test";
}, 180000);

afterAll(async () => {
  if (pgInstance) {
    await pgInstance.stop();
  }
  rmSync(dataDir, { recursive: true, force: true });
}, 120000);

describe("schema (migração 0001)", () => {
  it("aplica migrações em ordem", async () => {
    const applied = await migrate(databaseUrl);
    expect(applied).toContain("0001_init.sql");
    const appliedAgain = await migrate(databaseUrl);
    expect(appliedAgain).toHaveLength(0);
  });

  it("persiste sala, grupos, hipótese e medições", async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const room = (
        await client.query<{ id: string; phase: string }>(
          `INSERT INTO rooms (expires_at)
           VALUES (now() + interval '14 days')
           RETURNING id, phase`,
        )
      ).rows[0];
      expect(room).toBeDefined();
      expect(room.phase).toBe("HIPOTESES");
      await expect(async () => {
        await client.query(
          "INSERT INTO rooms (expires_at) VALUES (now() - interval '1 day')",
        );
      }).rejects.toThrow(/rooms_expires_after_created/i);

      const g1 = (
        await client.query<{ id: string }>(
          `INSERT INTO groups (room_id, numero) VALUES ($1, 1) RETURNING id`,
          [room.id],
        )
      ).rows[0];
      await expect(
        client.query(`INSERT INTO groups (room_id, numero) VALUES ($1, 1)`, [room.id]),
      ).rejects.toThrow(/groups_room_id_numero_key|duplicate key/i);

      await expect(
        client.query(`INSERT INTO groups (room_id, numero) VALUES ($1, 5)`, [room.id]),
      ).rejects.toThrow(/numero/);

      await client.query(`INSERT INTO groups (room_id, numero) VALUES ($1, 2)`, [room.id]);
      const h1 = await client.query(
        `INSERT INTO hypotheses (group_id, opcao, justificativa)
         VALUES ($1, 'DOBRA', 'O período cresce com o comprimento.')
         RETURNING confirmed_at`,
        [g1.id],
      );
      expect(h1.rows).toHaveLength(1);
      await expect(
        client.query(`INSERT INTO hypotheses (group_id, opcao) VALUES ($1, 'MENOR')`, [
          g1.id,
        ]),
      ).rejects.toThrow(/groups_pkey|duplicate key/i);
      await expect(
        client.query(`INSERT INTO hypotheses (group_id, opcao) VALUES ($1, 'CHOVE')`, [
          g1.id,
        ]),
      ).rejects.toThrow(/opcao/i);
      const longText = "x".repeat(201);
      await expect(
        client.query(
          `INSERT INTO hypotheses (group_id, opcao, justificativa) VALUES ($1, 'MENOR', $2)`,
          [g1.id, longText],
        ),
      ).rejects.toThrow(/justificativa/i);

      for (const [l, times] of [
        [50, ["14,1", "14,2", "14,3"]],
        [100, ["20,0", "20,1", "20,2"]],
      ] as const) {
        for (const [i, t] of times.entries()) {
          await client.query(
            `INSERT INTO measurements (group_id, comprimento_cm, repeticao, segundos)
             VALUES ($1, $2, $3, $4)`,
            [g1.id, l, i + 1, t.replace(",", ".")],
          );
        }
      }
      await expect(
        client.query(
          `INSERT INTO measurements (group_id, comprimento_cm, repeticao, segundos)
           VALUES ($1, 50, 1, '15.0')`,
          [g1.id],
        ),
      ).rejects.toThrow(/duplicate key/i);
      await expect(
        client.query(
          `INSERT INTO measurements (group_id, comprimento_cm, repeticao, segundos)
           VALUES ($1, 50, 1, '200')`,
          [g1.id],
        ),
      ).rejects.toThrow(/segundos/i);
      await client.query(
        `INSERT INTO submissions (group_id) VALUES ($1)`,
        [g1.id],
      );
      await expect(
        client.query(`INSERT INTO submissions (group_id) VALUES ($1)`, [g1.id]),
      ).rejects.toThrow(/duplicate key/i);
    } finally {
      await client.end();
    }
  });

  it("exige consistência entre grupo e sala em credentials e sessions", async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const r1 = (
        await client.query<{ id: string }>(
          `INSERT INTO rooms (expires_at) VALUES (now() + interval '14 days') RETURNING id`,
        )
      ).rows[0];
      const r2 = (
        await client.query<{ id: string }>(
          `INSERT INTO rooms (expires_at) VALUES (now() + interval '14 days') RETURNING id`,
        )
      ).rows[0];
      const gRoom1 = (
        await client.query<{ id: string }>(
          `INSERT INTO groups (room_id, numero) VALUES ($1, 1) RETURNING id`,
          [r1.id],
        )
      ).rows[0];

      await expect(
        client.query(
          `INSERT INTO credentials (token_hash, role, room_id, group_id, expires_at)
           VALUES ('hashA', 'PROFESSOR', $1, NULL, now() + interval '14 days')`,
          [r1.id],
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO credentials (token_hash, role, room_id, group_id, expires_at)
           VALUES ('hashB', 'GRUPO', $1, NULL, now() + interval '14 days')`,
          [r1.id],
        ),
      ).rejects.toThrow(/credentials_role_matches_group/i);
      await expect(
        client.query(
          `INSERT INTO credentials (token_hash, role, room_id, group_id, expires_at)
           VALUES ('hashC', 'GRUPO', $2, $1, now() + interval '14 days')`,
          [gRoom1.id, r2.id],
        ),
      ).rejects.toThrow(/credentials_group_same_room/i);

      await expect(
        client.query(
          `INSERT INTO sessions (session_id_hash, role, room_id, group_id, expires_at)
           VALUES ('sessX', 'GRUPO', $2, $1, now() + interval '14 days')`,
          [gRoom1.id, r2.id],
        ),
      ).rejects.toThrow(/sessions_group_same_room/i);
    } finally {
      await client.end();
    }
  });
});
