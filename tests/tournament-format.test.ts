import assert from "node:assert/strict";
import test from "node:test";
import {
  nextDrawSize,
  buildRounds,
  moveRoundParticipant,
  roundRobinComplete,
  roundRobinEliminationData,
  roundRobinGroups,
  roundRobinMatches,
  roundRobinQualifiers,
  roundRobinStandings,
  tournamentFormat,
  type BracketData,
} from "../lib/bracket.ts";
import {
  pendingScheduleMatches,
  syncScheduleWithBracket,
} from "../lib/tournament-data.ts";

const teams = Array.from({ length: 20 }, (_, index) => `PLAYER ${index * 2 + 1} / PLAYER ${index * 2 + 2}`);

test("legacy tournaments remain single elimination", () => {
  assert.equal(tournamentFormat({ teams: [], scores: {} }), "single_elimination");
  assert.equal(nextDrawSize(20), 32);
});

test("20 teams in groups of four produce five groups and 30 unique matches", () => {
  const data: BracketData = { teams, scores: {}, format: "round_robin", groupSize: 4 };
  const groups = roundRobinGroups(data);
  const matches = roundRobinMatches(data);
  assert.deepEqual(groups.map((group) => group.length), [4, 4, 4, 4, 4]);
  assert.equal(matches.length, 30);
  const pairs = matches.map((match) => [...match.pair].sort().join("|"));
  assert.equal(new Set(pairs).size, matches.length);
  assert.ok(matches.every((match) => match.pair[0] !== match.pair[1]));
});

test("odd groups generate every pairing without self matches", () => {
  const data: BracketData = { teams: teams.slice(0, 5), scores: {}, format: "round_robin", groupSize: 5 };
  assert.equal(roundRobinMatches(data).length, 10);
});

test("standings apply head-to-head after wins", () => {
  const data: BracketData = {
    teams: teams.slice(0, 4),
    format: "round_robin",
    groupSize: 4,
    scores: {},
  };
  const matches = roundRobinMatches(data);
  const winners = new Map([
    [[teams[0], teams[1]].sort().join("|"), teams[0]],
    [[teams[0], teams[2]].sort().join("|"), teams[0]],
    [[teams[0], teams[3]].sort().join("|"), teams[3]],
    [[teams[1], teams[2]].sort().join("|"), teams[1]],
    [[teams[1], teams[3]].sort().join("|"), teams[1]],
    [[teams[2], teams[3]].sort().join("|"), teams[2]],
  ]);
  for (const match of matches) {
    const winner = winners.get([...match.pair].sort().join("|"));
    data.scores[match.id] = match.pair[0] === winner ? [31, 20] : [20, 31];
  }
  const standings = roundRobinStandings(data, 0);
  assert.deepEqual(standings.slice(0, 2).map((row) => row.wins), [2, 2]);
  assert.equal(standings[0].team, teams[0]);
  assert.equal(standings[1].team, teams[1]);
});

test("single elimination waits until all four round-robin brackets finish", () => {
  const data: BracketData = {
    teams: teams.slice(0, 16),
    format: "round_robin",
    groupSize: 4,
    advancement: { mode: "top_per_group", count: 2, allowByes: true },
    scores: {},
  };
  const matches = roundRobinMatches(data);
  assert.equal(roundRobinGroups(data).length, 4);
  assert.equal(roundRobinComplete(data), false);
  assert.equal(roundRobinEliminationData(data), null);

  matches.slice(0, -1).forEach((match) => {
    data.scores[match.id] = [31, 20];
  });
  assert.equal(roundRobinComplete(data), false);
  assert.equal(roundRobinQualifiers(data).length, 0);

  data.scores[matches.at(-1)!.id] = [31, 20];
  assert.equal(roundRobinComplete(data), true);
  const elimination = roundRobinEliminationData(data);
  assert.ok(elimination);
  assert.equal(elimination.teams.length, 8);
  assert.equal(buildRounds(elimination)[0].matches.length, 4);
});

test("top two qualifiers do not immediately replay their group match", () => {
  const data: BracketData = {
    teams: teams.slice(0, 16),
    format: "round_robin",
    groupSize: 4,
    advancement: { mode: "top_per_group", count: 2, allowByes: true },
    scores: {},
  };
  for (const match of roundRobinMatches(data)) data.scores[match.id] = [31, 20];
  const groups = roundRobinGroups(data);
  const groupByTeam = new Map(
    groups.flatMap((group, groupIndex) =>
      group.map((team) => [team, groupIndex] as const),
    ),
  );
  const openingMatches = buildRounds(roundRobinEliminationData(data)!)[0].matches;
  assert.ok(
    openingMatches.every(
      (match) => groupByTeam.get(match.pair[0]) !== groupByTeam.get(match.pair[1]),
    ),
  );
});

test("completed groups publish only the opening single-elimination matches as pending", () => {
  const data: BracketData = {
    teams: teams.slice(0, 16),
    format: "round_robin",
    groupSize: 4,
    advancement: { mode: "top_per_group", count: 2, allowByes: true },
    scores: {},
  };
  for (const match of roundRobinMatches(data)) data.scores[match.id] = [31, 20];
  const schedule = syncScheduleWithBracket([], "Men's Doubles", "A", data);
  const pending = pendingScheduleMatches(schedule, { "Men's Doubles-A": data });
  assert.equal(pending.length, 4);
  assert.ok(pending.every((match) => match.id.includes("|r0m")));
});

test("participant names can move in quarterfinals and semifinals", () => {
  const data: BracketData = {
    teams: teams.slice(0, 8),
    scores: {
      r0m0: [31, 10],
      r0m1: [31, 11],
      r0m2: [31, 12],
      r0m3: [31, 13],
      r1m0: [31, 20],
      r1m1: [25, 31],
      r2m0: [31, 22],
    },
  };

  const movedQuarterfinal = moveRoundParticipant(data, 0, 0, 2);
  const quarterfinals = buildRounds(movedQuarterfinal)[0];
  assert.deepEqual(quarterfinals.matches[0].pair, [teams[2], teams[1]]);
  assert.deepEqual(quarterfinals.matches[1].pair, [teams[0], teams[3]]);
  assert.deepEqual(movedQuarterfinal.scores.r0m0, [0, 0]);
  assert.deepEqual(movedQuarterfinal.scores.r2m0, [0, 0]);

  const movedSemifinal = moveRoundParticipant(data, 1, 0, 2);
  const semifinals = buildRounds(movedSemifinal)[1];
  assert.equal(semifinals.matches[0].pair[0], teams[4]);
  assert.equal(semifinals.matches[1].pair[0], teams[0]);
  assert.deepEqual(movedSemifinal.scores.r0m0, [31, 10]);
  assert.deepEqual(movedSemifinal.scores.r1m0, [0, 0]);
  assert.deepEqual(movedSemifinal.scores.r2m0, [0, 0]);
});
