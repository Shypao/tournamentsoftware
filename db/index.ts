import { createClient, type Client, type InValue } from "@libsql/client/web";
import {
  createTournamentOperationsTable,
  createTournamentStateTable,
} from "./schema";

let client: Client | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not configured");
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return client;
}

class PreparedStatement {
  private args: InValue[] = [];

  constructor(private sql: string) {}

  bind(...args: unknown[]) {
    this.args = args as InValue[];
    return this;
  }

  async run() {
    const result = await getClient().execute({ sql: this.sql, args: this.args });
    return { meta: { changes: result.rowsAffected } };
  }

  async all<T>() {
    const result = await getClient().execute({ sql: this.sql, args: this.args });
    return { results: result.rows as unknown as T[] };
  }

  async first<T>() {
    const result = await getClient().execute({ sql: this.sql, args: this.args });
    return (result.rows[0] as unknown as T | undefined) ?? null;
  }
}

export function getDb() {
  return {
    prepare(sql: string) {
      return new PreparedStatement(sql);
    },
  };
}

export async function ensureTournamentSchema() {
  const db = getDb();
  await db.prepare(createTournamentStateTable).run();
  const columns = await db
    .prepare("PRAGMA table_info(tournament_state)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  if (!names.has("version"))
    await db
      .prepare(
        "ALTER TABLE tournament_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  if (!names.has("updated_by"))
    await db
      .prepare("ALTER TABLE tournament_state ADD COLUMN updated_by TEXT")
      .run();
  await db.prepare(createTournamentOperationsTable).run();
  return db;
}

export async function resetTournamentStorage(
  operationsPayload: string,
  updatedBy: string,
) {
  await ensureTournamentSchema();
  const results = await getClient().batch(
    [
      { sql: "DELETE FROM tournament_state", args: [] },
      {
        sql: `
          INSERT INTO tournament_operations (id, payload, version, updated_at, updated_by)
          VALUES ('default', ?, 1, CURRENT_TIMESTAMP, ?)
          ON CONFLICT(id) DO UPDATE SET
            payload = excluded.payload,
            version = tournament_operations.version + 1,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = excluded.updated_by
        `,
        args: [operationsPayload, updatedBy],
      },
      {
        sql: "SELECT version FROM tournament_operations WHERE id = 'default'",
        args: [],
      },
    ],
    "write",
  );
  return Number(results[2]?.rows[0]?.version ?? 1);
}
