import assert from "node:assert/strict";
import test from "node:test";
import {
  nextDrawSize,
  roundRobinGroups,
  roundRobinMatches,
  roundRobinStandings,
  tournamentFormat,
  type BracketData,
} from "../lib/bracket.ts";

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
