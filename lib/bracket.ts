export type MatchScore = [number, number];
export type BracketData = {
  teams: string[];
  scores: Record<string, MatchScore>;
  positionsLocked?: boolean;
  roundOrders?: Record<string, string[]>;
  roundSlotOrders?: Record<string, number[]>;
};
export type BracketRound = { label: string; short: string; matches: { id: string; pair: [string, string] }[] };

export function isOpenTeam(team: string) {
  return !team || team === "BYE" || team.startsWith("Open slot");
}

export function isWaitingTeam(team: string) {
  return team.startsWith("Winner ");
}

export function isRealTeam(team: string) {
  return !isOpenTeam(team) && !isWaitingTeam(team);
}

export function nextDrawSize(quantity: number) {
  let size = 2;
  while (size < Math.max(2, quantity)) size *= 2;
  return size;
}

/** Pair every team in the opening round. A single bye is added only when the
 * number of teams is odd, so a 10-team draw begins with exactly 5 matches. */
export function balancedFirstRound(inputTeams: string[]) {
  const realTeams = inputTeams.filter(isRealTeam);
  const expectedSize = realTeams.length + (realTeams.length % 2);
  const padded = inputTeams.map((team) => (isRealTeam(team) ? team : "BYE"));
  const alreadyBalanced =
    inputTeams.length === expectedSize &&
    Array.from({ length: expectedSize / 2 }, (_, index) =>
      padded.slice(index * 2, index * 2 + 2),
    ).every((pair) => pair.some(isRealTeam));
  if (alreadyBalanced) return padded;
  return realTeams.length % 2 === 0 ? realTeams : [...realTeams, "BYE"];
}

function legacyScoreId(data: BracketData, id: string) {
  if (data.teams.length !== 8) return null;
  const map: Record<string, string> = { r0m0: "q0", r0m1: "q1", r0m2: "q2", r0m3: "q3", r1m0: "s0", r1m1: "s1", r2m0: "f0" };
  return map[id] ?? null;
}

export function scoreFor(data: BracketData, id: string): MatchScore {
  const legacy = legacyScoreId(data, id);
  return data.scores[id] ?? (legacy ? data.scores[legacy] : undefined) ?? [0, 0];
}

export function matchWinner(data: BracketData, id: string, pair: [string, string]) {
  if (data.teams.filter(isRealTeam).length < 2) return null;
  if (isRealTeam(pair[0]) && isOpenTeam(pair[1])) return pair[0];
  if (isRealTeam(pair[1]) && isOpenTeam(pair[0])) return pair[1];
  if (!isRealTeam(pair[0]) || !isRealTeam(pair[1])) return null;
  const score = scoreFor(data, id);
  return score[0] === 31 ? pair[0] : score[1] === 31 ? pair[1] : null;
}

function roundName(index: number, total: number) {
  const remaining = total - index;
  if (remaining === 1) return { label: "FINAL", short: "F" };
  if (remaining === 2) return { label: "SEMIFINALS", short: "SF" };
  if (remaining === 3) return { label: "QUARTERFINALS", short: "QF" };
  const elimination = index + 1;
  return { label: `ELIMINATION ${elimination}`, short: `ELIM ${elimination}` };
}

export function buildRounds(data: BracketData): BracketRound[] {
  const teams = balancedFirstRound(data.teams);
  const total = Math.ceil(Math.log2(Math.max(2, teams.length)));
  const rounds: BracketRound[] = [];
  let participants = teams;
  for (let roundIndex = 0; roundIndex < total; roundIndex += 1) {
    if (participants.length % 2 !== 0) participants = [...participants, "BYE"];
    const slotOrder = data.roundSlotOrders?.[`r${roundIndex}`];
    if (
      slotOrder?.length === participants.length &&
      new Set(slotOrder).size === participants.length &&
      slotOrder.every((slot) => slot >= 0 && slot < participants.length)
    )
      participants = slotOrder.map((slot) => participants[slot]);
    const name = roundName(roundIndex, total);
    let matches = Array.from({ length: participants.length / 2 }, (_, matchIndex) => ({
      id: `r${roundIndex}m${matchIndex}`,
      pair: [participants[matchIndex * 2], participants[matchIndex * 2 + 1]] as [string, string],
    }));
    const savedOrder = data.roundOrders?.[`r${roundIndex}`];
    if (savedOrder?.length) {
      const position = new Map(savedOrder.map((id, index) => [id, index]));
      matches = [...matches].sort(
        (left, right) =>
          (position.get(left.id) ?? matches.length) -
          (position.get(right.id) ?? matches.length),
      );
    }
    rounds.push({ ...name, matches });
    participants = matches.map((match, matchIndex) => matchWinner(data, match.id, match.pair) ?? `Winner ${name.short} ${matchIndex + 1}`);
  }
  return rounds;
}

export function emptyScores(teamCount = 8): Record<string, MatchScore> {
  const result: Record<string, MatchScore> = {};
  let size = Math.max(2, teamCount);
  const rounds = Math.ceil(Math.log2(size));
  for (let round = 0; round < rounds; round += 1) {
    const matches = Math.ceil(size / 2);
    for (let match = 0; match < matches; match += 1)
      result[`r${round}m${match}`] = [0, 0];
    size = matches;
  }
  return result;
}

export function moveFirstRoundMatch(
  data: BracketData,
  fromMatch: number,
  toMatch: number,
): BracketData {
  const paddedTeams = balancedFirstRound(data.teams);
  const drawSize = paddedTeams.length;
  const matchCount = drawSize / 2;
  if (
    fromMatch < 0 ||
    toMatch < 0 ||
    fromMatch >= matchCount ||
    toMatch >= matchCount ||
    fromMatch === toMatch
  )
    return data;

  const matches = Array.from({ length: matchCount }, (_, index) =>
    paddedTeams.slice(index * 2, index * 2 + 2),
  );
  const [moved] = matches.splice(fromMatch, 1);
  matches.splice(toMatch, 0, moved);
  return {
    ...data,
    teams: matches.flat(),
    scores: emptyScores(drawSize),
  };
}

export function moveRoundMatch(
  data: BracketData,
  roundIndex: number,
  fromMatch: number,
  toMatch: number,
): BracketData {
  if (roundIndex === 0) return moveFirstRoundMatch(data, fromMatch, toMatch);
  const round = buildRounds(data)[roundIndex];
  if (
    !round ||
    fromMatch < 0 ||
    toMatch < 0 ||
    fromMatch >= round.matches.length ||
    toMatch >= round.matches.length ||
    fromMatch === toMatch
  )
    return data;
  const order = round.matches.map((match) => match.id);
  const [moved] = order.splice(fromMatch, 1);
  order.splice(toMatch, 0, moved);
  const scores = { ...data.scores };
  Object.keys(scores).forEach((id) => {
    const match = /^r(\d+)m/.exec(id);
    if (match && Number(match[1]) > roundIndex) scores[id] = [0, 0];
  });
  return {
    ...data,
    scores,
    roundOrders: { ...data.roundOrders, [`r${roundIndex}`]: order },
  };
}

export function moveRoundParticipant(
  data: BracketData,
  roundIndex: number,
  fromSlot: number,
  toSlot: number,
): BracketData {
  const round = buildRounds(data)[roundIndex];
  const slotCount = (round?.matches.length ?? 0) * 2;
  if (
    !round ||
    !round.matches.some((match) => match.pair.some(isOpenTeam)) ||
    fromSlot < 0 ||
    toSlot < 0 ||
    fromSlot >= slotCount ||
    toSlot >= slotCount ||
    fromSlot === toSlot
  )
    return data;
  const order =
    data.roundSlotOrders?.[`r${roundIndex}`]?.length === slotCount
      ? [...data.roundSlotOrders[`r${roundIndex}`]]
      : Array.from({ length: slotCount }, (_, index) => index);
  [order[fromSlot], order[toSlot]] = [order[toSlot], order[fromSlot]];
  const scores = { ...data.scores };
  Object.keys(scores).forEach((id) => {
    const match = /^r(\d+)m/.exec(id);
    if (match && Number(match[1]) >= roundIndex) scores[id] = [0, 0];
  });
  return {
    ...data,
    scores,
    roundSlotOrders: {
      ...data.roundSlotOrders,
      [`r${roundIndex}`]: order,
    },
  };
}

export function splitTeam(team: string): [string, string] {
  if (team.startsWith("Open slot")) return ["", ""];
  const [one = "", two = ""] = team.split(" / ");
  return [one, two];
}
