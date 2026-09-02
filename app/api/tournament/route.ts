import { ensureTournamentSchema } from "@/db";
import { requireAdminApiUser } from "@/app/admin-auth";

const allowedDivisions = new Set([
  "Men's Doubles",
  "Mixed Doubles",
  "Women's Doubles",
]);
const allowedLevels = new Set(["A", "B", "C", "D", "E"]);

function validBracket(
  value: unknown,
): value is {
  teams: string[];
  scores: Record<string, [number, number]>;
  positionsLocked?: boolean;
  format?: "single_elimination" | "round_robin";
  groupSize?: number;
  advancement?: {
    mode: "top_per_group" | "best_overall";
    count: number;
    allowByes: boolean;
  };
  roundOrders?: Record<string, string[]>;
  roundSlotOrders?: Record<string, number[]>;
} {
  if (!value || typeof value !== "object") return false;
  const bracket = value as { teams?: unknown; scores?: unknown };
  if (
    !Array.isArray(bracket.teams) ||
    bracket.teams.length > 256 ||
    bracket.teams.some((team) => typeof team !== "string" || team.length > 80)
  )
    return false;
  if (
    "format" in bracket &&
    bracket.format !== "single_elimination" &&
    bracket.format !== "round_robin"
  )
    return false;
  if (
    "groupSize" in bracket &&
    (!Number.isInteger(bracket.groupSize) ||
      Number(bracket.groupSize) < 2 ||
      Number(bracket.groupSize) > 32)
  )
    return false;
  if ("advancement" in bracket) {
    const advancement = bracket.advancement;
    if (
      !advancement ||
      typeof advancement !== "object" ||
      !["top_per_group", "best_overall"].includes(
        String((advancement as { mode?: unknown }).mode),
      ) ||
      !Number.isInteger((advancement as { count?: unknown }).count) ||
      Number((advancement as { count: number }).count) < 0 ||
      Number((advancement as { count: number }).count) > 256 ||
      typeof (advancement as { allowByes?: unknown }).allowByes !== "boolean"
    )
      return false;
  }
  if (!bracket.scores || typeof bracket.scores !== "object") return false;
  if (
    "positionsLocked" in bracket &&
    typeof bracket.positionsLocked !== "boolean"
  )
    return false;
  if ("roundOrders" in bracket) {
    if (!bracket.roundOrders || typeof bracket.roundOrders !== "object")
      return false;
    const orders = Object.entries(
      bracket.roundOrders as Record<string, unknown>,
    );
    if (
      orders.length > 16 ||
      orders.some(
        ([round, order]) =>
          !/^r\d+$/.test(round) ||
          !Array.isArray(order) ||
          order.length > 256 ||
          order.some(
            (id) => typeof id !== "string" || !/^r\d+m\d+$/.test(id),
          ),
      )
    )
      return false;
  }
  if ("roundSlotOrders" in bracket) {
    if (!bracket.roundSlotOrders || typeof bracket.roundSlotOrders !== "object")
      return false;
    const slotOrders = Object.entries(
      bracket.roundSlotOrders as Record<string, unknown>,
    );
    if (
      slotOrders.length > 16 ||
      slotOrders.some(
        ([round, order]) =>
          !/^r\d+$/.test(round) ||
          !Array.isArray(order) ||
          order.length > 512 ||
          order.some(
            (slot) => !Number.isInteger(slot) || Number(slot) < 0 || Number(slot) > 511,
          ),
      )
    )
      return false;
  }
  const scores = Object.entries(bracket.scores as Record<string, unknown>);
  return (
    scores.length <= 32_768 &&
    scores.every(
      ([id, score]) =>
        /^(?:r\d+m\d+|rr-g\d+-m\d+)$/.test(id) &&
        Array.isArray(score) &&
        score.length === 2 &&
        score.every(
          (point) => Number.isInteger(point) && point >= 0 && point <= 31,
        ),
    )
  );
}

export async function GET(request: Request) {
  try {
    const db = await ensureTournamentSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      const result = await db
        .prepare("SELECT id, payload FROM tournament_state ORDER BY id")
        .all<{ id: string; payload: string }>();
      const brackets = Object.fromEntries(
        result.results.map((row) => [row.id, JSON.parse(row.payload)]),
      );
      return Response.json({ brackets });
    }
    const row = await db
      .prepare(
        "SELECT payload, version, updated_at FROM tournament_state WHERE id = ?",
      )
      .bind(id)
      .first<{ payload: string; version: number; updated_at: string }>();
    return Response.json(
      row
        ? {
            bracket: JSON.parse(row.payload),
            version: row.version,
            updatedAt: row.updated_at,
          }
        : { bracket: null, version: 0 },
    );
  } catch (error) {
    console.error("Tournament read failed", error);
    return Response.json(
      { error: "Tournament storage is unavailable" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminApiUser();
  if (auth.response || !auth.user) return auth.response;
  try {
    const body = (await request.json()) as {
      id?: string;
      division?: string;
      level?: string;
      bracket?: unknown;
      baseVersion?: unknown;
    };
    if (
      !body.id ||
      body.id !== `${body.division}-${body.level}` ||
      !body.division ||
      !body.level ||
      !allowedDivisions.has(body.division) ||
      !allowedLevels.has(body.level) ||
      !validBracket(body.bracket) ||
      !Number.isInteger(body.baseVersion) ||
      Number(body.baseVersion) < 0
    )
      return Response.json(
        { error: "Invalid tournament bracket" },
        { status: 400 },
      );
    const db = await ensureTournamentSchema();
    const existing = await db
      .prepare("SELECT version FROM tournament_state WHERE id = ?")
      .bind(body.id)
      .first<{ version: number }>();
    if (!existing) {
      if (body.baseVersion !== 0)
        return Response.json(
          {
            error: "This bracket changed elsewhere. Refreshing is required.",
            version: 0,
          },
          { status: 409 },
        );
      await db
        .prepare(
          `
        INSERT INTO tournament_state (id, division, level, payload, version, updated_at, updated_by)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
      `,
        )
        .bind(
          body.id,
          body.division,
          body.level,
          JSON.stringify(body.bracket),
          auth.user.userId,
        )
        .run();
      return Response.json({
        ok: true,
        version: 1,
        updatedBy: auth.user.displayName,
      });
    }
    if (existing.version !== body.baseVersion) {
      const latest = await db
        .prepare(
          "SELECT payload, version, updated_at FROM tournament_state WHERE id = ?",
        )
        .bind(body.id)
        .first<{ payload: string; version: number; updated_at: string }>();
      return Response.json(
        {
          error:
            "Another admin saved a newer bracket. Your screen has been refreshed.",
          bracket: latest ? JSON.parse(latest.payload) : null,
          version: latest?.version ?? 0,
          updatedAt: latest?.updated_at,
        },
        { status: 409 },
      );
    }
    const result = await db
      .prepare(
        `
      UPDATE tournament_state
      SET payload = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = ? AND version = ?
    `,
      )
      .bind(
        JSON.stringify(body.bracket),
        auth.user.userId,
        body.id,
        body.baseVersion,
      )
      .run();
    if ((result.meta?.changes ?? 0) === 0)
      return Response.json(
        { error: "Another admin saved at the same time. Refresh and retry." },
        { status: 409 },
      );
    return Response.json({
      ok: true,
      version: Number(body.baseVersion) + 1,
      updatedBy: auth.user.displayName,
    });
  } catch (error) {
    console.error("Tournament save failed", error);
    return Response.json(
      {
        error:
          "Tournament bracket could not be saved. Check your connection and retry.",
      },
      { status: 503 },
    );
  }
}
