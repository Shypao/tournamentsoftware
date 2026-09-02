import { requireAdminApiUser } from "@/app/admin-auth";
import { ensureTournamentSchema } from "@/db";
import {
  defaultTournamentOperations,
  isTournamentOperations,
  normalizeTournamentOperations,
} from "@/lib/tournament-data";

async function readOperations() {
  const db = await ensureTournamentSchema();
  await db
    .prepare(
      `
    INSERT INTO tournament_operations (id, payload, version, updated_at)
    VALUES ('default', ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO NOTHING
  `,
    )
    .bind(JSON.stringify(defaultTournamentOperations))
    .run();
  const row = await db
    .prepare(
      "SELECT payload, version, updated_at, updated_by FROM tournament_operations WHERE id = 'default'",
    )
    .first<{
      payload: string;
      version: number;
      updated_at: string;
      updated_by: string | null;
    }>();
  if (!row) throw new Error("Tournament operations could not be initialized");
  return row;
}

export async function GET() {
  try {
    const row = await readOperations();
    return Response.json({
      operations: normalizeTournamentOperations(JSON.parse(row.payload)),
      version: row.version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    });
  } catch (error) {
    console.error("Operations read failed", error);
    return Response.json(
      { error: "Tournament operations are temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminApiUser();
  if (auth.response || !auth.user) return auth.response;
  try {
    const body = (await request.json()) as {
      operations?: unknown;
      baseVersion?: unknown;
    };
    if (
      !isTournamentOperations(body.operations) ||
      !Number.isInteger(body.baseVersion) ||
      Number(body.baseVersion) < 1
    ) {
      return Response.json(
        {
          error:
            "The schedule or tournament data is invalid. Refresh and try again.",
        },
        { status: 400 },
      );
    }
    const normalizedOperations = normalizeTournamentOperations(body.operations);
    const db = await ensureTournamentSchema();
    const result = await db
      .prepare(
        `
      UPDATE tournament_operations
      SET payload = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = 'default' AND version = ?
    `,
      )
      .bind(JSON.stringify(normalizedOperations), auth.user.userId, body.baseVersion)
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      const latest = await readOperations();
      return Response.json(
        {
          error:
            "Another admin saved newer tournament data. Your screen has been refreshed.",
          operations: normalizeTournamentOperations(JSON.parse(latest.payload)),
          version: latest.version,
        },
        { status: 409 },
      );
    }
    return Response.json({
      ok: true,
      version: Number(body.baseVersion) + 1,
      updatedBy: auth.user.displayName,
    });
  } catch (error) {
    console.error("Operations save failed", error);
    return Response.json(
      {
        error:
          "The tournament data could not be saved. Check your connection and retry.",
      },
      { status: 503 },
    );
  }
}
