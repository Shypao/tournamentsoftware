import {
  buildRounds,
  isRealTeam,
  isWaitingTeam,
  matchWinner,
  roundRobinComplete,
  roundRobinEliminationData,
  roundRobinMatches,
  roundRobinQualifiers,
  roundRobinStandings,
  scoreFor,
  splitTeam,
  tournamentFormat,
  type BracketData,
} from "./bracket.ts";

export type TournamentLevel = "A" | "B" | "C" | "D" | "E";
export type TournamentDivision =
  | "Men's Doubles"
  | "Mixed Doubles"
  | "Women's Doubles";


export type PlayerRecord = {
  id: string;
  name: string;
  partner: string;
  division: TournamentDivision;
  level: TournamentLevel;
  seed: string;
  opponent: string;
  court: string;
  time: string;
  round?: string;
  matchStatus?: "upcoming" | "eliminated" | "runner-up" | "champion";
};

export type CourtRecord = {
  id: string;
  name: string;
  status: "live" | "ready" | "available";
  detail: string;
};

export type ScheduleRecord = {
  id: string;
  time: string;
  court: string;
  division: TournamentDivision;
  level: TournamentLevel;
  teamOne: string;
  teamTwo: string;
  status: "upcoming" | "live" | "complete";
  score: string;
};

export function resolvePlayerProgress(
  player: PlayerRecord,
  bracket: BracketData,
  schedule: ScheduleRecord[],
): PlayerRecord {
  const wanted = [player.name, player.partner]
    .map((name) => name.trim().toLowerCase())
    .sort()
    .join("|");
  const team = bracket.teams.filter(isRealTeam).find(
    (entry) =>
      splitTeam(entry)
        .map((name) => name.trim().toLowerCase())
        .sort()
        .join("|") === wanted,
  );
  if (!team) return player;

  if (tournamentFormat(bracket) === "round_robin") {
    const matches = roundRobinMatches(bracket).filter((match) => match.pair.includes(team));
    const next = matches.find((match) => {
      const score = scoreFor(bracket, match.id);
      return score[0] !== 31 && score[1] !== 31;
    });
    if (next) {
      const opponent = next.pair[0] === team ? next.pair[1] : next.pair[0];
      const scheduled = schedule.find((item) => item.id === `${player.division}|${player.level}|${next.id}`);
      return { ...player, opponent, court: scheduled?.court || "To be assigned", time: scheduled?.time || "Check schedule", round: `BRACKET ${String.fromCharCode(65 + next.groupIndex)}`, matchStatus: "upcoming" };
    }
    const groupIndex = roundRobinMatches(bracket).find((match) => match.pair.includes(team))?.groupIndex ?? 0;
    const standing = roundRobinStandings(bracket, groupIndex).find((row) => row.team === team);
    if (!roundRobinComplete(bracket)) {
      return { ...player, opponent: "To be decided", court: "Group stage", time: "Awaiting remaining group matches", round: `BRACKET ${String.fromCharCode(65 + groupIndex)}`, matchStatus: "upcoming" };
    }
    const elimination = roundRobinEliminationData(bracket);
    if (elimination && roundRobinQualifiers(bracket).includes(team))
      return resolvePlayerProgress(player, elimination, schedule);
    return { ...player, opponent: `Ranked #${standing?.rank ?? "–"}`, court: "Round robin complete", time: `${standing?.wins ?? 0} wins · ${standing?.losses ?? 0} losses`, round: `BRACKET ${String.fromCharCode(65 + groupIndex)}`, matchStatus: "eliminated" };
  }

  for (const round of buildRounds(bracket)) {
    const match = round.matches.find((item) => item.pair.includes(team));
    if (!match) continue;
    const opponent = match.pair[0] === team ? match.pair[1] : match.pair[0];
    const winner = matchWinner(bracket, match.id, match.pair);
    if (winner && winner !== team) {
      const isFinal = round.label === "FINAL";
      return {
        ...player,
        opponent,
        court: isFinal ? "1st Placer" : "Eliminated",
        time: "Tournament complete",
        round: round.label,
        matchStatus: isFinal ? "runner-up" : "eliminated",
      };
    }
    if (winner === team) continue;

    const scheduled = schedule.find(
      (item) =>
        item.id === `${player.division}|${player.level}|${match.id}` ||
        (item.division === player.division &&
          item.level === player.level &&
          (item.teamOne === team || item.teamTwo === team)),
    );
    return {
      ...player,
      opponent: isWaitingTeam(opponent) ? "To be decided" : opponent,
      court: scheduled?.court || "To be assigned",
      time: scheduled?.time || "Check schedule",
      round: round.label,
      matchStatus: "upcoming",
    };
  }

  return {
    ...player,
    opponent: "Tournament champion",
    court: "Champion",
    time: "Tournament complete",
    round: "FINAL",
    matchStatus: "champion",
  };
}

export type TournamentOperations = {
  players: PlayerRecord[];
  courts: CourtRecord[];
  schedule: ScheduleRecord[];
  schedulePublished: boolean;
};

/**
 * A court's live status/detail is always derived from whichever match is
 * currently assigned to it in the schedule (match.court === court.name).
 * This keeps the Courts page and the schedule in sync: assigning a match to
 * a court anywhere in the app (Schedule editor or the Courts assignment
 * panel) automatically updates what the Courts page shows, so there's only
 * one place to look to know who's playing where.
 */
export function deriveCourtsFromSchedule(
  courts: CourtRecord[],
  schedule: ScheduleRecord[],
): CourtRecord[] {
  return courts.map((court) => {
    const assigned = schedule.filter(
      (match) => match.court === court.name && match.status !== "complete",
    );
    const live = assigned.find((match) => match.status === "live");
    const nextUpcoming = assigned
      .filter((match) => match.status === "upcoming")
      .sort((a, b) => a.time.localeCompare(b.time))[0];
    const active = live ?? nextUpcoming;
    if (!active) {
      return { ...court, status: "available", detail: "No active match" };
    }
    const label = `${active.teamOne.replace(/\s*\/\s*/g, " & ").toUpperCase()} vs ${active.teamTwo.replace(/\s*\/\s*/g, " & ").toUpperCase()} · ${active.score} · ${active.division.replace(
      " Doubles",
      "",
    )} ${active.level}`;
    return {
      ...court,
      status: live ? "live" : "ready",
      detail: live ? label : `Next at ${active.time} · ${label}`,
    };
  });
}

/**
 * Whenever a bracket gets a real match-up (two real teams paired against
 * each other, in round 1 or any later round once both feeders are decided),
 * make sure there's a corresponding schedule row for it so it immediately
 * shows up in the Schedule editor and the "Assign a match to a court" panel.
 * Existing rows are only updated (never re-created), so a court/time an
 * admin already assigned is preserved.
 */
export function syncScheduleWithBracket(
  schedule: ScheduleRecord[],
  division: TournamentDivision,
  level: TournamentLevel,
  bracketData: BracketData,
): ScheduleRecord[] {
  const elimination = roundRobinEliminationData(bracketData);
  const rounds = tournamentFormat(bracketData) === "round_robin"
    ? [
        { matches: roundRobinMatches(bracketData) },
        ...(elimination ? buildRounds(elimination) : []),
      ]
    : buildRounds(bracketData);
  let changed = false;
  const activeIds = new Set<string>();
  let next = [...schedule];
  for (const round of rounds) {
    for (const match of round.matches) {
      const [teamOne, teamTwo] = match.pair;
      if (!isRealTeam(teamOne) || !isRealTeam(teamTwo)) continue;
      const id = `${division}|${level}|${match.id}`;
      const currentScore = scoreFor(bracketData, match.id);
      const score = `${currentScore[0]}–${currentScore[1]}`;
      const roundRobinMatch = match.id.startsWith("rr-");
      const winner = roundRobinMatch
        ? currentScore[0] === 31 ? teamOne : currentScore[1] === 31 ? teamTwo : null
        : matchWinner(elimination ?? bracketData, match.id, match.pair);
      activeIds.add(id);
      const existingIndex = next.findIndex((row) => row.id === id);
      if (existingIndex === -1) {
        next.push({
          id,
          time: "",
          court: "TBA",
          division,
          level,
          teamOne,
          teamTwo,
          status: winner ? "complete" : "upcoming",
          score,
        });
        changed = true;
      } else {
        const existing = next[existingIndex];
        const status = winner
          ? "complete"
          : existing.status === "complete"
            ? "upcoming"
            : existing.status;
        if (
          existing.teamOne !== teamOne ||
          existing.teamTwo !== teamTwo ||
          existing.score !== score ||
          existing.status !== status
        ) {
          next[existingIndex] = {
            ...existing,
            teamOne,
            teamTwo,
            score,
            status,
          };
          changed = true;
        }
      }
    }
  }
  const reconciled = next.filter(
    (row) =>
      !row.id.startsWith(`${division}|${level}|`) || activeIds.has(row.id),
  );
  if (reconciled.length !== next.length) {
    next = reconciled;
    changed = true;
  }
  return changed ? next : schedule;
}

/**
 * Court calls are an action list, not match history. Keep only matches that
 * still need to be played. Checking the bracket winner as well as the stored
 * schedule status prevents a completed match from lingering when bracket
 * scoring advances a team before the schedule row has been updated.
 */
export function pendingScheduleMatches(
  schedule: ScheduleRecord[],
  brackets: Record<string, BracketData>,
): ScheduleRecord[] {
  return schedule.filter((row) => {
    if (row.status === "complete") return false;

    const bracket = brackets[`${row.division}-${row.level}`];
    if (!bracket) return true;

    const prefix = `${row.division}|${row.level}|`;
    if (!row.id.startsWith(prefix)) return true;

    const matchId = row.id.slice(prefix.length);
    const elimination = roundRobinEliminationData(bracket);
    const matches = tournamentFormat(bracket) === "round_robin"
      ? [
          ...roundRobinMatches(bracket),
          ...(elimination
            ? buildRounds(elimination).flatMap((round) => round.matches)
            : []),
        ]
      : buildRounds(bracket).flatMap((round) => round.matches);
    const match = matches.find((candidate) => candidate.id === matchId);

    // A generated row whose bracket match no longer exists is stale.
    if (!match) return false;
    if (match.id.startsWith("rr-")) {
      const score = scoreFor(bracket, match.id);
      return score[0] !== 31 && score[1] !== 31;
    }
    return !matchWinner(elimination ?? bracket, match.id, match.pair);
  });
}

const defaultSchedule: ScheduleRecord[] = [];

export const TOURNAMENT_COURT_COUNT = 9;

const baseCourts: CourtRecord[] = Array.from(
  { length: TOURNAMENT_COURT_COUNT },
  (_, index) => ({
  id: `court-${index + 1}`,
  name: `Court ${index + 1}`,
  status: "available" as const,
  detail: "No active match",
  }),
);

export const defaultTournamentOperations: TournamentOperations = {
  players: [],
  courts: deriveCourtsFromSchedule(baseCourts, defaultSchedule),
  schedule: defaultSchedule,
  schedulePublished: false,
};

/** Keep older saved sessions compatible when the venue court count changes. */
export function normalizeTournamentOperations(
  operations: TournamentOperations,
): TournamentOperations {
  const allowedCourtNames = new Set(baseCourts.map((court) => court.name));
  const schedule = operations.schedule.map((match) =>
    match.court !== "TBA" && !allowedCourtNames.has(match.court)
      ? { ...match, court: "TBA" }
      : match,
  );
  const currentCourts = new Map(
    operations.courts.map((court) => [court.name, court]),
  );
  const courts = baseCourts.map(
    (court) => currentCourts.get(court.name) ?? court,
  );
  return {
    ...operations,
    schedule,
    courts: deriveCourtsFromSchedule(courts, schedule),
  };
}

export function isTournamentOperations(
  value: unknown,
): value is TournamentOperations {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TournamentOperations>;
  if (!Array.isArray(data.players) || data.players.length > 1000) return false;
  if (!Array.isArray(data.courts) || data.courts.length > 100) return false;
  if (!Array.isArray(data.schedule) || data.schedule.length > 2000)
    return false;
  if (typeof data.schedulePublished !== "boolean") return false;
  return JSON.stringify(value).length <= 750_000;
}
