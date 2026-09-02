import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey().notNull(),
  division: text("division").notNull(),
  level: text("level").notNull(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by"),
});

export const tournamentOperations = sqliteTable("tournament_operations", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by"),
});

export const createTournamentStateTable = `
  CREATE TABLE IF NOT EXISTS tournament_state (
    id TEXT PRIMARY KEY NOT NULL,
    division TEXT NOT NULL,
    level TEXT NOT NULL,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export const createTournamentOperationsTable = `
  CREATE TABLE IF NOT EXISTS tournament_operations (
    id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
  )
`;
