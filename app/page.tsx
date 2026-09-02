"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTournamentOperations,
  deriveCourtsFromSchedule,
  pendingScheduleMatches,
  resolvePlayerProgress,
  syncScheduleWithBracket,
  type PlayerRecord,
  type ScheduleRecord,
  type TournamentOperations,
} from "@/lib/tournament-data";
import {
  buildRounds,
  emptyScores,
  isOpenTeam,
  isRealTeam,
  isWaitingTeam,
  matchWinner,
  moveRoundParticipant,
  moveRoundMatch,
  roundRobinGroups,
  roundRobinMatches,
  roundRobinStandings,
  scoreFor,
  splitTeam,
  tournamentFormat,
  type BracketData,
  type MatchScore,
} from "@/lib/bracket";

type Level = "A" | "B" | "C" | "D" | "E";
type Division = "Men's Doubles" | "Mixed Doubles" | "Women's Doubles";
type View = "admin" | "player";
type AdminSection =
  | "overview"
  | "matches"
  | "teams"
  | "courts"
  | "brackets"
  | "schedule"
  | "settings";
type AdminUser = { userId: string; displayName: string; email: string };

const levels: Level[] = ["A", "B", "C", "D", "E"];
const divisions: {
  name: Division;
  levels: Level[];
  teams: number;
  note: string;
}[] = [
  {
    name: "Men's Doubles",
    levels: ["A", "B", "C", "D", "E"],
    teams: 28,
    note: "Open across all five levels",
  },
  {
    name: "Mixed Doubles",
    levels: ["B", "C", "D", "E"],
    teams: 24,
    note: "Levels B through E",
  },
  {
    name: "Women's Doubles",
    levels: ["C", "D", "E"],
    teams: 18,
    note: "Levels C through E",
  },
];

const levelDetails: Record<Level, { label: string; color: string }> = {
  A: { label: "Elite / Open", color: "#e43d35" },
  B: { label: "Advanced", color: "#ea6b35" },
  C: { label: "Intermediate", color: "#a73d58" },
  D: { label: "Recreational", color: "#555a71" },
  E: { label: "Beginner", color: "#8e6c52" },
};

const scores = [
  [21, 18],
  [17, 21],
  [21, 14],
  [21, 12],
];

const displayTeamName = (team: string) =>
  team.replace(/\s*\/\s*/g, " & ").toUpperCase();

const initialBracket = (_level: Level): BracketData => ({
  teams: [],
  scores: {},
});

function Brand() {
  return (
    <div className="brand invitational-brand">
      <img
        src="/red-court-invitational-logo.png"
        alt="Red Court Invitational 2026 shuttlecock emblem"
      />
      <span>
        RED COURT<small>INVITATIONAL 2026</small>
      </span>
    </div>
  );
}

function Sidebar({
  setView,
  section,
  setSection,
  adminName,
}: {
  setView: (view: View) => void;
  section: AdminSection;
  setSection: (section: AdminSection) => void;
  adminName: string;
}) {
  const item = (
    id: AdminSection,
    label: string,
    badge?: string,
  ) => (
    <button
      className={section === id ? "active" : ""}
      onClick={() => setSection(id)}
    >
      {label}
      {badge && <span className="nav-badge">{badge}</span>}
    </button>
  );
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Admin navigation">
        <p className="nav-label">TOURNAMENT</p>
        {item("overview", "Overview")}
        {item("matches", "Matches")}
        {item("teams", "Teams")}
        {item("courts", "Courts")}
        {item("brackets", "Brackets")}
        <p className="nav-label spaced">MANAGEMENT</p>
        {item("schedule", "Schedule")}
        {item("settings", "Settings")}
        <button onClick={() => setView("player")}>
          Public player page
        </button>
      </nav>
      <div className="date-card">
        <small>SCORING FORMAT</small>
        <b>First to 31 points</b>
        <span>Winner advances automatically</span>
      </div>
      <div className="admin-profile">
        <span>
          <strong>{adminName}</strong>
          <small>Tournament admin</small>
        </span>
        <button
          aria-label="Sign out"
          onClick={() =>
            fetch("/api/admin/logout", { method: "POST" }).then(() =>
              window.location.reload(),
            )
          }
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function AdminTopbar({ setView }: { setView: (view: View) => void }) {
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <img src="/red-court-invitational-logo.png" alt="" />
        <b>RED COURT INVITATIONAL</b>
      </div>
      <div className="view-switch">
        <button className="active">Admin</button>
        <button onClick={() => setView("player")}>Player page</button>
      </div>
      <div className="top-actions">
        <span className="event-label">2026 Invitational</span>
      </div>
    </header>
  );
}

function PublicHeader({
  setView,
  authenticated,
}: {
  setView: (view: View) => void;
  authenticated: boolean;
}) {
  return (
    <header className="public-header">
      <Brand />
      <nav>
        <a href="#find-player">Find my match</a>
        <a href="#divisions">Divisions</a>
        <a href="#venue">Venue</a>
      </nav>
      <div>
        <span>First to 31 points</span>
        {authenticated && (
          <button onClick={() => setView("admin")}>Admin dashboard</button>
        )}
      </div>
    </header>
  );
}

function LevelTabs({
  level,
  division,
  setLevel,
  showAllLevels = false,
  setShowAllLevels,
}: {
  level: Level;
  division: Division;
  setLevel: (level: Level) => void;
  showAllLevels?: boolean;
  setShowAllLevels?: (show: boolean) => void;
}) {
  const allowed =
    divisions.find((item) => item.name === division)?.levels ?? levels;
  return (
    <div className="level-tabs" aria-label="Bracket level">
      {setShowAllLevels && (
        <button
          className={`all-levels-toggle ${showAllLevels ? "active" : ""}`}
          aria-pressed={showAllLevels}
          onClick={() => setShowAllLevels(!showAllLevels)}
        >
          <span>All levels</span>
          <small>Overview</small>
        </button>
      )}
      {allowed.map((item) => (
        <button
          key={item}
          className={!showAllLevels && level === item ? "active" : ""}
          onClick={() => {
            setLevel(item);
            setShowAllLevels?.(false);
          }}
        >
          <span style={{ background: levelDetails[item].color }}>
            Level {item}
          </span>
          <small>{levelDetails[item].label}</small>
        </button>
      ))}
    </div>
  );
}

function AllLevelsOverview({
  division,
  brackets,
  onOpen,
}: {
  division: Division;
  brackets: Record<string, BracketData>;
  onOpen: (level: Level) => void;
}) {
  const allowed =
    divisions.find((item) => item.name === division)?.levels ?? levels;
  return (
    <div className="all-levels-overview">
      <div className="all-levels-heading">
        <div>
          <b>All levels at a glance</b>
          <span>Select a level to manage its entries and live bracket.</span>
        </div>
        <span>{allowed.length} LEVELS</span>
      </div>
      <div className="all-level-cards">
        {allowed.map((item) => {
          const data = brackets[`${division}-${item}`] ?? initialBracket(item);
          const count = data.teams.filter(isRealTeam).length;
          const rounds = count ? buildRounds(data).length : 0;
          return (
            <button key={item} onClick={() => onOpen(item)}>
              <span style={{ background: levelDetails[item].color }}>
                Level {item}
              </span>
              <b>{levelDetails[item].label}</b>
              <small>{count} teams · {rounds || "No"} rounds</small>
              <em>Open level</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DivisionTabs({
  division,
  setDivision,
  setLevel,
}: {
  division: Division;
  setDivision: (division: Division) => void;
  setLevel: (level: Level) => void;
}) {
  return (
    <div className="division-tabs">
      {divisions.map((item) => (
        <button
          key={item.name}
          className={division === item.name ? "active" : ""}
          onClick={() => {
            setDivision(item.name);
            setLevel(item.levels[0]);
          }}
        >
          <span>{item.name}</span>
          <small>{item.levels.map((l) => `Level ${l}`).join(" · ")}</small>
        </button>
      ))}
    </div>
  );
}

function RoundRobinBoard({
  data,
  onChange,
  readOnly = false,
}: {
  data: BracketData;
  onChange?: (data: BracketData) => void;
  readOnly?: boolean;
}) {
  const groups = roundRobinGroups(data);
  const matches = roundRobinMatches(data);
  const [active, setActive] = useState(0);
  const groupIndex = Math.min(active, Math.max(0, groups.length - 1));
  const groupMatches = matches.filter((match) => match.groupIndex === groupIndex);
  const standings = roundRobinStandings(data, groupIndex);
  const setMatchScore = (id: string, side: 0 | 1, raw: number) => {
    if (!onChange) return;
    const current = scoreFor(data, id);
    const value = Math.max(0, Math.min(31, Number.isFinite(raw) ? raw : 0));
    const next: MatchScore = [...current] as MatchScore;
    next[side] = value;
    if (value === 31 && next[side === 0 ? 1 : 0] === 31)
      next[side === 0 ? 1 : 0] = 30;
    onChange({ ...data, scores: { ...data.scores, [id]: next } });
  };
  if (!groups.length)
    return <div className="empty-bracket-state"><b>No teams entered yet</b><small>Add at least two teams to generate round robin matches.</small></div>;
  return (
    <div className="round-robin-board">
      <div className="round-robin-tabs" role="tablist" aria-label="Round robin brackets">
        {groups.map((group, index) => (
          <button type="button" role="tab" aria-selected={groupIndex === index} className={groupIndex === index ? "active" : ""} onClick={() => setActive(index)} key={index}>
            <b>Bracket {String.fromCharCode(65 + index)}</b><small>{group.length} teams · {group.length * (group.length - 1) / 2} matches</small>
          </button>
        ))}
      </div>
      <div className="round-robin-grid">
        <section className="standings-card">
          <header><div><span>LIVE TABLE</span><h3>Standings</h3></div><small>Wins · H2H · Point difference</small></header>
          <div className="standings-scroll"><table><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>+/-</th></tr></thead><tbody>
            {standings.map((row) => <tr key={row.team}><td><b className={row.rank === 1 ? "leader" : ""}>{row.rank}</b></td><td>{displayTeamName(row.team)}</td><td>{row.played}</td><td className="standing-wins">{row.wins}</td><td>{row.losses}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="round-robin-match-card">
          <header><div><span>MATCHES</span><h3>Bracket {String.fromCharCode(65 + groupIndex)}</h3></div><small>{groupMatches.filter((match) => { const score = scoreFor(data, match.id); return score[0] === 31 || score[1] === 31; }).length} / {groupMatches.length} complete</small></header>
          <div className="round-robin-match-list">{groupMatches.map((match) => { const score = scoreFor(data, match.id); return (
            <article key={match.id} className={score[0] === 31 || score[1] === 31 ? "complete" : ""}>
              <span>M{match.position}</span><div><b>{displayTeamName(match.pair[0])}</b><small>vs</small><b>{displayTeamName(match.pair[1])}</b></div>
              {readOnly ? <strong>{score[0]}–{score[1]}</strong> : <fieldset aria-label={`Score for match ${match.position}`}><input aria-label={`${match.pair[0]} score`} type="number" min="0" max="31" value={score[0]} onChange={(event) => setMatchScore(match.id, 0, Number(event.target.value))}/><i>–</i><input aria-label={`${match.pair[1]} score`} type="number" min="0" max="31" value={score[1]} onChange={(event) => setMatchScore(match.id, 1, Number(event.target.value))}/></fieldset>}
            </article>); })}</div>
        </section>
      </div>
      {(data.advancement?.count ?? 0) > 0 && <div className="advancement-status"><b>ADVANCEMENT READY</b><span>{data.advancement?.count} team{data.advancement?.count === 1 ? "" : "s"} · {data.advancement?.mode === "best_overall" ? "best overall" : "from each bracket"} · {data.advancement?.allowByes === false ? "no byes" : "byes allowed"}</span></div>}
    </div>
  );
}

function MiniMatch({
  one,
  two,
  winner,
  score = 0,
  points: suppliedPoints,
  highlightTeam,
}: {
  one: string;
  two: string;
  winner?: string;
  score?: number;
  points?: MatchScore;
  highlightTeam?: string;
}) {
  const points = suppliedPoints ?? scores[score % scores.length];
  return (
    <div className={`mini-match ${highlightTeam && [one, two].includes(highlightTeam) ? "player-match-highlight" : ""}`}>
      <div className={`${winner === one ? "winner" : ""} ${highlightTeam === one ? "your-team-row" : ""}`}>
        <span>{displayTeamName(one)}{highlightTeam === one && <em>Your team</em>}</span>
        <b>{points[0]}</b>
      </div>
      <div className={`${winner === two ? "winner" : ""} ${highlightTeam === two ? "your-team-row" : ""}`}>
        <span>{displayTeamName(two)}{highlightTeam === two && <em>Your team</em>}</span>
        <b>{points[1]}</b>
      </div>
    </div>
  );
}

function Bracket({
  level,
  data,
  highlightTeam,
}: {
  level: Level;
  data?: BracketData;
  highlightTeam?: string;
}) {
  const bracket = data ?? initialBracket(level);
  if (tournamentFormat(bracket) === "round_robin")
    return <RoundRobinBoard data={bracket} readOnly />;
  const rounds = buildRounds(bracket);
  const finalMatch = rounds.at(-1)?.matches[0];
  const champion = finalMatch
    ? matchWinner(bracket, finalMatch.id, finalMatch.pair)
    : null;
  const firstPlacer = finalMatch?.pair.find(
    (team) => isRealTeam(team) && team !== champion,
  );
  if (!bracket.teams.some(isRealTeam))
    return (
      <div className="empty-bracket-state">
        <b>No teams entered yet</b>
        <small>
          The official bracket will be created from the doubles teams added by
          the administrator.
        </small>
      </div>
    );
  const entered = bracket.teams.filter(isRealTeam).length;
  if (highlightTeam) {
    const columnWidth = 240;
    const columnGap = 56;
    const stackHeight = Math.max(520, (rounds[0]?.matches.length ?? 1) * 88);
    const bracketWidth =
      rounds.length * columnWidth + (rounds.length - 1) * columnGap;
    return (
      <div className="player-classic-bracket">
        <div className="player-bracket-guide">
          <b>Full tournament bracket</b>
          <span>Scroll sideways to follow each winner to the next round.</span>
        </div>
        <div className="bracket-scroll player-classic-scroll">
          <div
            className="player-classic-grid"
            style={{
              width: `${bracketWidth}px`,
              gridTemplateColumns: `repeat(${rounds.length}, ${columnWidth}px)`,
              columnGap: `${columnGap}px`,
            }}
          >
            <svg
              className="player-bracket-lines"
              width={bracketWidth}
              height={stackHeight}
              viewBox={`0 0 ${bracketWidth} ${stackHeight}`}
              aria-hidden="true"
            >
              <defs>
                <marker id="player-bracket-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 8 4 L 0 8 z" />
                </marker>
              </defs>
              {rounds.slice(0, -1).flatMap((round, roundIndex) => {
                const nextRound = rounds[roundIndex + 1];
                return round.matches.map((match, matchIndex) => {
                  const targetIndex = Math.min(
                    Math.floor(matchIndex / 2),
                    nextRound.matches.length - 1,
                  );
                  const startX =
                    roundIndex * (columnWidth + columnGap) + columnWidth;
                  const endX = (roundIndex + 1) * (columnWidth + columnGap);
                  const middleX = startX + columnGap / 2;
                  const startY =
                    ((matchIndex + 0.5) * stackHeight) /
                    round.matches.length;
                  const endY =
                    ((targetIndex + 0.5) * stackHeight) /
                    nextRound.matches.length;
                  return (
                    <path
                      key={`line-${match.id}`}
                      d={`M ${startX} ${startY} H ${middleX} V ${endY} H ${endX - 3}`}
                      markerEnd="url(#player-bracket-arrow)"
                    />
                  );
                });
              })}
            </svg>
            {rounds.map((round, roundIndex) => (
              <section className="player-classic-round" key={round.label}>
                <header>
                  <b>{round.label}</b>
                  <small>
                    {roundIndex === 0
                      ? `${entered} teams`
                      : `${round.matches.length} ${round.matches.length === 1 ? "match" : "matches"}`}
                  </small>
                </header>
                <div
                  className="player-classic-stack"
                  style={{
                    height: `${stackHeight}px`,
                    gridTemplateRows: `repeat(${round.matches.length}, 1fr)`,
                  }}
                >
                  {round.matches.map((match) => (
                    <div className="player-classic-match" key={match.id}>
                      <MiniMatch
                        one={match.pair[0]}
                        two={match.pair[1]}
                        winner={matchWinner(bracket, match.id, match.pair) ?? undefined}
                        points={scoreFor(bracket, match.id)}
                        highlightTeam={highlightTeam}
                      />
                    </div>
                  ))}
                  {roundIndex === rounds.length - 1 && (
                    <div className={`player-classic-champion ${champion ? "decided" : ""}`}>
                      <span>CHAMPION</span>
                      <b>{champion ? displayTeamName(champion) : "To be decided"}</b>
                      <i />
                      <span>1ST PLACER</span>
                      <b>{firstPlacer ? displayTeamName(firstPlacer) : "To be decided"}</b>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const fitRounds = rounds.length <= 5;
  return (
    <div className="bracket-scroll">
      <div
        className="bracket-shell adaptive-bracket"
        style={{
          gridTemplateColumns: `repeat(${rounds.length}, minmax(190px, 1fr))`,
          width: fitRounds ? "100%" : `${rounds.length * 220}px`,
          minWidth: fitRounds ? "0" : `${rounds.length * 220}px`,
        }}
      >
        {rounds.map((round, roundIndex) => (
          <div className="round adaptive-round" key={round.label}>
            <h4>
              {round.label}{" "}
              <span>
                {roundIndex === 0
                  ? `${entered} teams entered`
                  : `${round.matches.length} matches`}
              </span>
            </h4>
            <div className="round-match-stack">
              {round.matches.map((match) => (
                <MiniMatch
                  key={match.id}
                  one={match.pair[0]}
                  two={match.pair[1]}
                  winner={
                    matchWinner(bracket, match.id, match.pair) ?? undefined
                  }
                  points={scoreFor(bracket, match.id)}
                />
              ))}
            </div>
            {roundIndex === rounds.length - 1 && (
              <div className={`trophy ${champion ? "decided" : ""}`}>
                <b>{champion ?? "Champions"}</b>
                <small>
                  {champion ? "Tournament winner" : "First to 31 points"}
                </small>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreMatch({
  id,
  pair,
  data,
  onChange,
  movableMatchIndex,
  roundIndex,
  dragged,
  onMatchDragStart,
  onMatchDrop,
  participantDragEnabled,
  draggedParticipantSlot,
  onParticipantDragStart,
  onParticipantDrop,
  positionsLocked,
}: {
  id: string;
  pair: [string, string];
  data: BracketData;
  onChange: (data: BracketData) => void;
  movableMatchIndex?: number;
  roundIndex: number;
  dragged?: boolean;
  onMatchDragStart?: (index: number) => void;
  onMatchDrop?: (index: number) => void;
  participantDragEnabled?: boolean;
  draggedParticipantSlot?: number | null;
  onParticipantDragStart?: (slot: number) => void;
  onParticipantDrop?: (slot: number) => void;
  positionsLocked?: boolean;
}) {
  const points = scoreFor(data, id);
  const winner = matchWinner(data, id, pair);
  const playable = isRealTeam(pair[0]) && isRealTeam(pair[1]);
  const bye = winner && !playable;
  const cardDraggable = movableMatchIndex !== undefined && !positionsLocked;
  const resetAfter = (nextScores: Record<string, MatchScore>) => {
    Object.keys(nextScores).forEach((key) => {
      const match = /^r(\d+)m/.exec(key);
      if (match && Number(match[1]) > roundIndex) nextScores[key] = [0, 0];
    });
  };
  const setScore = (side: 0 | 1, value: number) => {
    const next = Math.max(0, Math.min(31, Number.isFinite(value) ? value : 0));
    const score: MatchScore = [...points] as MatchScore;
    score[side] = next;
    if (next === 31)
      score[side === 0 ? 1 : 0] = Math.min(score[side === 0 ? 1 : 0], 30);
    const nextScores = { ...data.scores, [id]: score };
    resetAfter(nextScores);
    onChange({ ...data, scores: nextScores });
  };
  return (
    <div
      className={`score-editor-match ${winner ? "complete" : ""} ${
        movableMatchIndex !== undefined
          ? positionsLocked
            ? "match-placement-locked"
            : "match-draggable"
          : ""
      } ${dragged ? "dragging" : ""}`}
      draggable={cardDraggable}
      onDragStart={() =>
        cardDraggable && onMatchDragStart?.(movableMatchIndex)
      }
      onDragEnd={() => onMatchDragStart?.(-1)}
      onDragOver={(event) =>
        cardDraggable && event.preventDefault()
      }
      onDrop={() =>
        cardDraggable && onMatchDrop?.(movableMatchIndex)
      }
    >
      {movableMatchIndex !== undefined && (
        <div className="match-drag-bar" title="Drag to move this matchup">
          <b>{positionsLocked ? "Placement locked" : "Drag matchup card"}</b>
          <small>{positionsLocked ? "Scores stay editable" : "Team names locked"}</small>
        </div>
      )}
      {pair.map((team, side) => {
        const matchNumber = Number(id.split("m")[1] ?? 0);
        const participantSlot = matchNumber * 2 + side;
        const nameDraggable = Boolean(participantDragEnabled && !positionsLocked);
        return (
        <div key={side}>
          <span
            className={`locked-team-name ${
              isWaitingTeam(team) || isOpenTeam(team)
                ? "placeholder-team"
                : ""
            } ${nameDraggable ? "bye-participant-draggable" : ""} ${
              draggedParticipantSlot === participantSlot
                ? "participant-dragging"
                : ""
            }`}
            draggable={nameDraggable}
            title={
              nameDraggable
                ? "Drag this name onto another slot to choose who receives the bye"
                : undefined
            }
            onDragStart={(event) => {
              if (!nameDraggable) return;
              event.stopPropagation();
              onParticipantDragStart?.(participantSlot);
            }}
            onDragEnd={(event) => {
              if (!nameDraggable) return;
              event.stopPropagation();
              onParticipantDragStart?.(-1);
            }}
            onDragOver={(event) => {
              if (!nameDraggable) return;
              event.stopPropagation();
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (!nameDraggable) return;
              event.stopPropagation();
              onParticipantDrop?.(participantSlot);
            }}
          >
            {team}
          </span>
          <div className="score-stepper">
            <input
              className="manual-score-input"
              disabled={!playable}
              type="number"
              min="0"
              max="31"
              value={points[side] === 0 ? "" : points[side]}
              placeholder="0"
              inputMode="numeric"
              aria-label={`${team} score`}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) =>
                setScore(side as 0 | 1, Number(event.target.value))
              }
            />
          </div>
        </div>
      )})}
      <small>
        {bye
          ? `BYE · ${winner} advances automatically`
          : winner
            ? `${winner} advances`
            : playable
              ? "First team to 31 advances"
              : pair.some(isOpenTeam) && pair.some(isWaitingTeam)
                ? `${pair.find(isWaitingTeam)} advances automatically when decided`
                : "Waiting for teams"}
      </small>
    </div>
  );
}

function BracketEditor({
  data,
  onChange,
  onSave,
  saving,
}: {
  data: BracketData;
  onChange: (data: BracketData) => void;
  onSave: () => void;
  saving: string;
}) {
  const [draggedMatch, setDraggedMatch] = useState<{
    round: number;
    match: number;
  } | null>(null);
  const [draggedParticipant, setDraggedParticipant] = useState<{
    round: number;
    slot: number;
  } | null>(null);
  const rounds = buildRounds(data);
  const finalMatch = rounds.at(-1)?.matches[0];
  const champion = finalMatch
    ? matchWinner(data, finalMatch.id, finalMatch.pair)
    : null;
  const entered = data.teams.filter(isRealTeam).length;
  const adminColumnWidth = 260;
  const adminColumnGap = 64;
  const adminStackHeight = Math.max(
    680,
    (rounds[0]?.matches.length ?? 1) * 148,
  );
  const adminBracketWidth =
    rounds.length * adminColumnWidth +
    (rounds.length - 1) * adminColumnGap;
  const focusRound = (roundIndex: number) =>
    document
      .getElementById(`admin-round-${roundIndex}`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
  const moveMatch = (roundIndex: number, toMatch: number) => {
    if (
      !draggedMatch ||
      draggedMatch.round !== roundIndex ||
      draggedMatch.match === toMatch
    ) {
      setDraggedMatch(null);
      return;
    }
    onChange(moveRoundMatch(data, roundIndex, draggedMatch.match, toMatch));
    setDraggedMatch(null);
  };
  const moveParticipant = (roundIndex: number, toSlot: number) => {
    if (
      !draggedParticipant ||
      draggedParticipant.round !== roundIndex ||
      draggedParticipant.slot === toSlot
    ) {
      setDraggedParticipant(null);
      return;
    }
    onChange(
      moveRoundParticipant(
        data,
        roundIndex,
        draggedParticipant.slot,
        toSlot,
      ),
    );
    setDraggedParticipant(null);
  };
  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <div>
          <b>Official live bracket</b>
          <span>
            {entered} doubles teams · {entered * 2} players · bracket expands
            automatically · team names are locked · unlock placement to drag
            match cards within any round.
          </span>
        </div>
        <span className="save-status">{saving}</span>
        <button
          className={`placement-lock ${data.positionsLocked ? "locked" : ""}`}
          type="button"
          onClick={() => {
            setDraggedMatch(null);
            setDraggedParticipant(null);
            onChange({
              ...data,
              positionsLocked: !data.positionsLocked,
            });
          }}
        >
          {data.positionsLocked ? "Positions locked" : "Lock match cards"}
        </button>
        <button onClick={onSave}>Save & publish changes</button>
      </div>
      {entered === 0 ? (
        <div className="empty-bracket-state admin-empty">
          <b>Your official bracket starts empty</b>
          <small>
            Add a doubles team in Official Entries above. No teams are
            hardcoded.
          </small>
        </div>
      ) : (
        <>
          <div className="round-navigator">
            <span>VIEW ROUND</span>
            {rounds.map((round, roundIndex) => (
              <button
                key={round.label}
                onClick={() => focusRound(roundIndex)}
                className={roundIndex === rounds.length - 1 ? "final-nav" : ""}
              >
                {round.label}
              </button>
            ))}
          </div>
          <div className="bracket-scroll editor-scroll">
            <div
              className="editor-bracket adaptive-editor admin-classic-grid"
              style={{
                gridTemplateColumns: `repeat(${rounds.length}, ${adminColumnWidth}px)`,
                columnGap: `${adminColumnGap}px`,
                width: `${adminBracketWidth}px`,
              }}
            >
              <svg
                className="admin-bracket-lines"
                width={adminBracketWidth}
                height={adminStackHeight}
                viewBox={`0 0 ${adminBracketWidth} ${adminStackHeight}`}
                aria-hidden="true"
              >
                <defs>
                  <marker id="admin-bracket-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {rounds.slice(0, -1).flatMap((round, roundIndex) => {
                  const nextRound = rounds[roundIndex + 1];
                  return round.matches.map((match, matchIndex) => {
                    const targetIndex = Math.min(
                      Math.floor(matchIndex / 2),
                      nextRound.matches.length - 1,
                    );
                    const startX =
                      roundIndex * (adminColumnWidth + adminColumnGap) +
                      adminColumnWidth;
                    const endX =
                      (roundIndex + 1) *
                      (adminColumnWidth + adminColumnGap);
                    const middleX = startX + adminColumnGap / 2;
                    const startY =
                      ((matchIndex + 0.5) * adminStackHeight) /
                      round.matches.length;
                    const endY =
                      ((targetIndex + 0.5) * adminStackHeight) /
                      nextRound.matches.length;
                    return (
                      <path
                        key={`admin-line-${match.id}`}
                        d={`M ${startX} ${startY} H ${middleX} V ${endY} H ${endX - 3}`}
                        markerEnd="url(#admin-bracket-arrow)"
                      />
                    );
                  });
                })}
              </svg>
              {rounds.map((round, roundIndex) => {
                const roundHasBye = round.matches.some((match) =>
                  match.pair.some(isOpenTeam),
                );
                return (
                <div
                  id={`admin-round-${roundIndex}`}
                  className="editor-round dynamic-editor-round admin-classic-round"
                  key={round.label}
                >
                  <h4>
                    {round.label}
                    <small>{round.matches.length} {round.matches.length === 1 ? "match" : "matches"}</small>
                  </h4>
                  <div
                    className="editor-round-matches admin-classic-stack"
                    style={{
                      height: `${adminStackHeight}px`,
                      gridTemplateRows: `repeat(${round.matches.length}, 1fr)`,
                    }}
                  >
                    {round.matches.map((match, matchIndex) => (
                      <ScoreMatch
                        key={match.id}
                        id={match.id}
                        pair={match.pair}
                        data={data}
                        onChange={onChange}
                        roundIndex={roundIndex}
                        dragged={
                          draggedMatch?.round === roundIndex &&
                          draggedMatch.match === matchIndex
                        }
                        onMatchDragStart={(index) =>
                          setDraggedMatch(
                            index < 0
                              ? null
                              : { round: roundIndex, match: index },
                          )
                        }
                        onMatchDrop={(index) => moveMatch(roundIndex, index)}
                        participantDragEnabled={roundHasBye}
                        draggedParticipantSlot={
                          draggedParticipant?.round === roundIndex
                            ? draggedParticipant.slot
                            : null
                        }
                        onParticipantDragStart={(slot) => {
                          setDraggedMatch(null);
                          setDraggedParticipant(
                            slot < 0 ? null : { round: roundIndex, slot },
                          );
                        }}
                        onParticipantDrop={(slot) =>
                          moveParticipant(roundIndex, slot)
                        }
                        positionsLocked={data.positionsLocked}
                        movableMatchIndex={matchIndex}
                      />
                    ))}
                  </div>
                  {roundIndex === rounds.length - 1 && (
                    <div className="advance-note">
                      <b>{champion ? displayTeamName(champion) : "CHAMPION PENDING"}</b>
                      <small>
                        {champion
                          ? "Final result published"
                          : "First to 31 wins"}
                      </small>
                    </div>
                  )}
                </div>
              )})}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EntryManager({
  data,
  division,
  level,
  brackets,
  onChange,
}: {
  data: BracketData;
  division: Division;
  level: Level;
  brackets: Record<string, BracketData>;
  onChange: (data: BracketData) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [playerOne, setPlayerOne] = useState("");
  const [playerTwo, setPlayerTwo] = useState("");
  const [notice, setNotice] = useState("");
  const [draggedEntry, setDraggedEntry] = useState<number | null>(null);
  const [pendingTeam, setPendingTeam] = useState<{
    one: string;
    two: string;
    existing: { name: string; count: number }[];
  } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    index: number;
    team: string;
  } | null>(null);
  const enteredTeams = data.teams
    .map((team, index) => ({ team, index }))
    .filter(({ team }) => isRealTeam(team));
  const filled = enteredTeams.length;
  const playerCount = filled * 2;
  const openingMatches = Math.ceil(filled / 2);
  const format = tournamentFormat(data);
  const groups = roundRobinGroups(data);
  const roundRobinMatchCount = roundRobinMatches(data).length;
  const changePlayer = (index: number, side: 0 | 1, value: string) => {
    const pair = splitTeam(data.teams[index]);
    pair[side] = value.toUpperCase();
    const teams = [...data.teams];
    teams[index] =
      pair[0] || pair[1] ? `${pair[0]} / ${pair[1]}` : `Open slot ${index + 1}`;
    onChange({ ...data, teams, scores: emptyScores(teams.length) });
    setNotice("Entry updated · bracket scores reset");
  };
  const removeTeam = (index: number) => {
    const teams = data.teams.filter(
      (team, teamIndex) => teamIndex !== index && isRealTeam(team),
    );
    onChange({ ...data, teams, scores: emptyScores(teams.length) });
    setNotice("Team removed · bracket updated immediately");
  };
  const clearEntries = () => {
    onChange({ ...data, teams: [], scores: emptyScores(0) });
    setNotice("Entry list cleared. Add your official doubles teams below.");
  };
  const moveTeam = (from: number, to: number) => {
    const teams = data.teams.filter(isRealTeam);
    if (from < 0 || to < 0 || from >= teams.length || to >= teams.length || from === to)
      return;
    const [moved] = teams.splice(from, 1);
    teams.splice(to, 0, moved);
    onChange({ ...data, teams, scores: emptyScores(teams.length) });
    setNotice(`Seed ${from + 1} moved to position ${to + 1} · bracket updated`);
  };
  const commitTeam = (one: string, two: string) => {
    const teams = data.teams.filter(isRealTeam);
    const upperOne = one.toUpperCase();
    const upperTwo = two.toUpperCase();
    const nextTeams = [...teams, `${upperOne} / ${upperTwo}`];
    onChange({ ...data, teams: nextTeams, scores: emptyScores(nextTeams.length) });
    setPlayerOne("");
    setPlayerTwo("");
    setShowForm(false);
    setNotice(
      `${upperOne} / ${upperTwo} added · live bracket expanded to include team ${nextTeams.length}`,
    );
  };
  const countPlayerEntries = (name: string) =>
    Object.values(brackets).reduce(
      (count, bracket) =>
        count +
        bracket.teams.filter((team) =>
          splitTeam(team).some(
            (playerName) =>
              playerName.trim().toLowerCase() === name.trim().toLowerCase(),
          ),
        ).length,
      0,
    );
  const addTeam = (event: FormEvent) => {
    event.preventDefault();
    const one = playerOne.trim().toUpperCase();
    const two = playerTwo.trim().toUpperCase();
    if (!one || !two) {
      setNotice("Enter both players in the doubles team.");
      return;
    }
    const duplicateInLevel = data.teams.filter(isRealTeam).some((team) =>
      splitTeam(team).some(
        (name) =>
          name.toLowerCase() === one.toLowerCase() ||
          name.toLowerCase() === two.toLowerCase(),
      ),
    );
    if (duplicateInLevel) {
      setNotice("A player cannot be entered twice in the same division and level.");
      return;
    }
    const existing = [one, two]
      .map((name) => ({ name, count: countPlayerEntries(name) }))
      .filter((item) => item.count > 0);
    if (existing.length > 0) {
      setPendingTeam({ one, two, existing });
      return;
    }
    commitTeam(one, two);
  };
  return (
    <div className="entry-manager">
      <section className="format-selector" aria-label="Tournament format">
        <div className="format-selector-heading">
          <div>
            <b>TOURNAMENT FORMAT</b>
            <span>Choose how {division} · Level {level} will be played.</span>
          </div>
          <strong>{format === "round_robin" ? "ROUND ROBIN" : "SINGLE ELIMINATION"}</strong>
        </div>
        <div className="format-options">
          <button
            type="button"
            className={format === "single_elimination" ? "selected" : ""}
            onClick={() => {
              onChange({ ...data, format: "single_elimination", scores: emptyScores(data.teams.length) });
              setNotice("Single elimination selected · match scores reset");
            }}
          >
            <i aria-hidden="true" />
            <span><b>Single Elimination</b><small>One loss eliminates a team. Winners advance automatically.</small></span>
          </button>
          <button
            type="button"
            className={format === "round_robin" ? "selected" : ""}
            onClick={() => {
              onChange({ ...data, format: "round_robin", groupSize: data.groupSize ?? 4, scores: {} });
              setNotice("Round robin selected · all group matches generated automatically");
            }}
          >
            <i aria-hidden="true" />
            <span><b>Round Robin</b><small>Every team plays every other team in its bracket once.</small></span>
          </button>
        </div>
        {format === "round_robin" && (
          <div className="round-robin-settings">
            <label>
              <span>Teams per bracket</span>
              <input
                type="number"
                min="2"
                max="32"
                value={data.groupSize ?? 4}
                onChange={(event) =>
                  onChange({
                    ...data,
                    groupSize: Math.max(2, Math.min(32, Number(event.target.value) || 2)),
                    scores: {},
                  })
                }
              />
            </label>
            <label>
              <span>Teams advancing</span>
              <input
                type="number"
                min="0"
                max="256"
                value={data.advancement?.count ?? 0}
                onChange={(event) =>
                  onChange({
                    ...data,
                    advancement: {
                      mode: data.advancement?.mode ?? "top_per_group",
                      count: Math.max(0, Math.min(256, Number(event.target.value) || 0)),
                      allowByes: data.advancement?.allowByes ?? true,
                    },
                  })
                }
              />
            </label>
            <label className="advancement-mode">
              <span>Advancement rule</span>
              <select
                value={data.advancement?.mode ?? "top_per_group"}
                onChange={(event) =>
                  onChange({
                    ...data,
                    advancement: {
                      mode: event.target.value as "top_per_group" | "best_overall",
                      count: data.advancement?.count ?? 0,
                      allowByes: data.advancement?.allowByes ?? true,
                    },
                  })
                }
              >
                <option value="top_per_group">Top teams from each bracket</option>
                <option value="best_overall">Best teams overall</option>
              </select>
            </label>
            <span className="format-calculation">
              <b>{groups.length} bracket{groups.length === 1 ? "" : "s"} · {roundRobinMatchCount} matches</b>
              <small>Generated once from the saved entry list—never on refresh.</small>
            </span>
          </div>
        )}
      </section>
      <div className="entry-summary">
        <div>
          <span className="entry-count">
            <strong>{filled}</strong>
            <small>TEAMS</small>
          </span>
          <p>
            <b>UNLIMITED OFFICIAL ENTRIES</b>
            <small>
              {division} · Level {level} · {playerCount} registered players
            </small>
          </p>
        </div>
        <div>
          <button className="quiet-action" onClick={clearEntries}>
            Clear entries
          </button>
          <button
            className="add-entry-button"
            onClick={() => setShowForm((value) => !value)}
          >
            Add doubles team
          </button>
        </div>
      </div>
      <div className="bracket-growth">
        <span>
          <b>{format === "round_robin" ? `ROUND ROBIN: ${roundRobinMatchCount} TOTAL MATCHES` : `LIVE BRACKET: ${openingMatches} OPENING MATCHES`}</b>
        </span>
        <small>
          {format === "round_robin"
            ? `${groups.length} bracket${groups.length === 1 ? "" : "s"} · no duplicate matchups`
            : filled < 2
            ? "Add at least 2 teams to begin scoring"
            : filled % 2 === 0
              ? "Every team is paired in the opening round"
              : "One team receives a bye because the team count is odd"}
        </small>
      </div>
      {showForm && (
        <form className="add-entry-form" onSubmit={addTeam}>
          <label>
            <span>Player 1 full name</span>
            <input
              value={playerOne}
              onChange={(event) => setPlayerOne(event.target.value.toUpperCase())}
              placeholder="e.g. Juan Dela Cruz"
              autoFocus
            />
          </label>
          <span className="pair-link">and</span>
          <label>
            <span>Player 2 full name</span>
            <input
              value={playerTwo}
              onChange={(event) => setPlayerTwo(event.target.value.toUpperCase())}
              placeholder="e.g. Marco Santos"
            />
          </label>
          <button type="submit">Add to bracket</button>
        </form>
      )}
      <div className="entry-list">
        {enteredTeams.map(({ team, index }, seed) => {
          const pair = splitTeam(team);
          return (
            <div
              className={`entry-row ${draggedEntry === seed ? "dragging" : ""}`}
              key={`${team}-${index}`}
              draggable
              onDragStart={() => setDraggedEntry(seed)}
              onDragEnd={() => setDraggedEntry(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedEntry !== null) moveTeam(draggedEntry, seed);
                setDraggedEntry(null);
              }}
            >
              <span className="seed-number" title="Drag to reseed">Seed {seed + 1}</span>
              <label>
                <small>PLAYER 1</small>
                <input
                  value={pair[0]}
                  onChange={(event) =>
                    changePlayer(index, 0, event.target.value)
                  }
                />
              </label>
              <span className="pair-slash">/</span>
              <label>
                <small>PLAYER 2</small>
                <input
                  value={pair[1]}
                  onChange={(event) =>
                    changePlayer(index, 1, event.target.value)
                  }
                />
              </label>
              <button
                className="remove-entry"
                type="button"
                onClick={() => setPendingRemoval({ index, team })}
                aria-label={`Remove team ${seed + 1}`}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="entry-footer">
        <span>
          {notice ||
            "Drag a team to reseed it. The bracket updates immediately."}
        </span>
        <b>
          {filled} teams · {playerCount} players entered
        </b>
      </div>
      {pendingTeam && (
        <div className="confirmation-backdrop" role="presentation">
          <section
            className="confirmation-dialog duplicate-entry-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="duplicate-entry-title"
          >
            <h2 id="duplicate-entry-title">Confirm another player entry</h2>
            <p>
              {pendingTeam.existing
                .map(
                  (item) =>
                    `${item.name} already has ${item.count} ${
                      item.count === 1 ? "entry" : "entries"
                    }`,
                )
                .join(". ")}.
            </p>
            <p>
              Add this team as the next entry in {division}, Level {level}?
            </p>
            <div>
              <button
                className="secondary"
                type="button"
                onClick={() => setPendingTeam(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  commitTeam(pendingTeam.one, pendingTeam.two);
                  setPendingTeam(null);
                }}
              >
                Confirm additional entry
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingRemoval && (
        <div className="confirmation-backdrop" role="presentation">
          <section
            className="confirmation-dialog remove-team-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-team-title"
          >
            <h2 id="remove-team-title">Remove this team?</h2>
            <p>
              <b>{pendingRemoval.team}</b> will be removed from {division}, Level {level}.
              The bracket and its scores will update immediately.
            </p>
            <div>
              <button
                className="secondary"
                type="button"
                onClick={() => setPendingRemoval(null)}
              >
                Cancel
              </button>
              <button
                className="primary danger-action"
                type="button"
                onClick={() => {
                  removeTeam(pendingRemoval.index);
                  setPendingRemoval(null);
                }}
              >
                Remove team
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CourtAssignmentPanel({
  operations,
  matches,
  onChange,
}: {
  operations: TournamentOperations;
  matches?: ScheduleRecord[];
  onChange: (operations: TournamentOperations) => void;
}) {
  const assignableMatches = (matches ?? operations.schedule).filter(
    (match): match is ScheduleRecord =>
      match.status === "upcoming" || match.status === "live",
  );
  const [matchId, setMatchId] = useState(assignableMatches[0]?.id ?? "");
  const [courtId, setCourtId] = useState(operations.courts[0]?.id ?? "");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!assignableMatches.some((match) => match.id === matchId)) {
      setMatchId(assignableMatches[0]?.id ?? "");
    }
  }, [assignableMatches, matchId]);

  const selectedMatch = assignableMatches.find((match) => match.id === matchId);
  const selectedCourt = operations.courts.find((court) => court.id === courtId);
  const courtHasOtherLiveMatch =
    !!selectedCourt &&
    selectedCourt.status === "live" &&
    selectedMatch?.court !== selectedCourt.name;

  const assign = () => {
    if (!selectedMatch || !selectedCourt) return;
    onChange({
      ...operations,
      schedule: operations.schedule.map((match) =>
        match.id === selectedMatch.id
          ? { ...match, court: selectedCourt.name }
          : match,
      ),
    });
    setConfirmation(
      `${displayTeamName(selectedMatch.teamOne)} vs ${displayTeamName(selectedMatch.teamTwo)} assigned to ${selectedCourt.name}.`,
    );
  };

  return (
    <section className="panel court-assign-panel">
      <div className="panel-head">
        <div>
          <h2>Assign a match to a court</h2>
          <p>Pick any upcoming or live match, choose a court, and assign it.</p>
        </div>
      </div>
      {assignableMatches.length === 0 ? (
        <p className="court-assign-empty">
          No upcoming or live matches to assign right now.
        </p>
      ) : (
        <div className="court-assign-body">
          <div className="court-assign-form">
            <label>
              <span>Match</span>
              <select
                value={matchId}
                onChange={(event) => {
                  setMatchId(event.target.value);
                  setConfirmation("");
                }}
                aria-label="Select match to assign"
              >
                {assignableMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.time} · {match.division.replace(" Doubles", "")}{" "}
                    {match.level} · {displayTeamName(match.teamOne)} vs {displayTeamName(match.teamTwo)} ·{" "}
                    {match.court === "TBA"
                      ? "unassigned"
                      : `now on ${match.court}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Court</span>
              <select
                value={courtId}
                onChange={(event) => {
                  setCourtId(event.target.value);
                  setConfirmation("");
                }}
                aria-label="Select target court"
              >
                {operations.courts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                    {court.status !== "available" ? " (occupied)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              onClick={assign}
              disabled={!selectedMatch || !selectedCourt}
            >
              Assign to court
            </button>
          </div>
          {courtHasOtherLiveMatch && (
            <p className="court-assign-warning">
              {selectedCourt?.name} already has a live match on it. Assigning
              this one there too will replace what the court card shows —
              remember to give the current match a new court.
            </p>
          )}
          {confirmation && !courtHasOtherLiveMatch && (
            <p className="court-assign-confirmation">{confirmation}</p>
          )}
        </div>
      )}
    </section>
  );
}

function ScheduleEditor({
  operations,
  matches,
  onChange,
  saveStatus,
}: {
  operations: TournamentOperations;
  matches?: ScheduleRecord[];
  onChange: (operations: TournamentOperations) => void;
  saveStatus: string;
}) {
  const updateMatch = (
    id: string,
    field: "time" | "court",
    value: string,
  ) =>
    onChange({
      ...operations,
      schedule: operations.schedule.map((match) =>
        match.id === id ? { ...match, [field]: value } : match,
      ),
    });
  return (
    <div className="schedule-editor">
      <div className="schedule-toolbar">
        <span>{saveStatus}</span>
        <small>Only the match time and court assignment can be changed.</small>
      </div>
      {(matches ?? operations.schedule).length === 0 && (
        <p className="court-assign-empty">
          No waiting or pending matches right now.
        </p>
      )}
      {(matches ?? operations.schedule).map((match) => (
        <article className="schedule-edit-row" key={match.id}>
          <input
            type="time"
            value={match.time}
            onChange={(event) =>
              updateMatch(match.id, "time", event.target.value)
            }
            aria-label="Match time"
          />
          <select
            value={match.court}
            onChange={(event) =>
              updateMatch(match.id, "court", event.target.value)
            }
            aria-label="Court"
          >
            <option value="TBA">TBA</option>
            {operations.courts.map((court) => (
              <option key={court.id} value={court.name}>{court.name}</option>
            ))}
          </select>
          <span className="locked-field division-field">{match.division}</span>
          <span className="locked-field level-field">Level {match.level}</span>
          <span className="locked-field team-field">{displayTeamName(match.teamOne)}</span>
          <span>vs.</span>
          <span className="locked-field team-field">{displayTeamName(match.teamTwo)}</span>
          <span className={`locked-status ${match.status}`}>{match.status}</span>
          <strong className="locked-score">{match.score}</strong>
        </article>
      ))}
    </div>
  );
}

function AdminView({
  section,
  setSection,
  setView,
  level,
  division,
  setLevel,
  setDivision,
  bracketData,
  brackets,
  showAllLevels,
  setShowAllLevels,
  bracketVersion,
  onBracketChange,
  onBracketSaved,
  onBracketConflict,
  operations,
  operationsVersion,
  onOperationsChange,
  onOperationsSaved,
  onOperationsConflict,
  onSessionReset,
}: {
  section: AdminSection;
  setSection: (section: AdminSection) => void;
  setView: (view: View) => void;
  level: Level;
  division: Division;
  setLevel: (level: Level) => void;
  setDivision: (division: Division) => void;
  bracketData: BracketData;
  brackets: Record<string, BracketData>;
  showAllLevels: boolean;
  setShowAllLevels: (show: boolean) => void;
  bracketVersion: number;
  onBracketChange: (data: BracketData) => void;
  onBracketSaved: (version: number) => void;
  onBracketConflict: (data: BracketData, version: number) => void;
  operations: TournamentOperations;
  operationsVersion: number;
  onOperationsChange: (data: TournamentOperations) => void;
  onOperationsSaved: (version: number) => void;
  onOperationsConflict: (data: TournamentOperations, version: number) => void;
  onSessionReset: (version: number) => void;
}) {
  const [saving, setSaving] = useState(
    "All bracket changes are saved automatically",
  );
  const [saveSequence, setSaveSequence] = useState(0);
  const [operationsSaving, setOperationsSaving] = useState(
    "Schedule is up to date",
  );
  const [operationsSequence, setOperationsSequence] = useState(0);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState("");
  const bracketVersionsRef = useRef<Record<string, number>>({});
  const bracketSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const operationsVersionRef = useRef(operationsVersion);
  const operationsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeBracketKey = `${division}-${level}`;
  useEffect(() => {
    bracketVersionsRef.current[activeBracketKey] = bracketVersion;
  }, [activeBracketKey, bracketVersion]);
  useEffect(() => {
    operationsVersionRef.current = operationsVersion;
  }, [operationsVersion]);
  const liveMatches = useMemo(
    () => operations.schedule.filter((match) => match.status === "live"),
    [operations.schedule],
  );
  const pendingMatches = useMemo(
    () => pendingScheduleMatches(operations.schedule, brackets),
    [operations.schedule, brackets],
  );
  const saveBracket = () => {
    const key = `${division}-${level}`;
    const snapshot = bracketData;
    const snapshotDivision = division;
    const snapshotLevel = level;
    const savedCallback = onBracketSaved;
    const conflictCallback = onBracketConflict;

    bracketSaveQueueRef.current = bracketSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setSaving("Saving…");
        let baseVersion = bracketVersionsRef.current[key] ?? bracketVersion;
        let latestConflict: { bracket?: BracketData; version?: number; error?: string } = {};

        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await fetch("/api/tournament", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: key,
                division: snapshotDivision,
                level: snapshotLevel,
                bracket: snapshot,
                baseVersion,
              }),
            });
            const result = await response.json().catch(() => ({}));

            if (response.status === 409) {
              latestConflict = result;
              let latestVersion = Number.isInteger(result.version)
                ? result.version
                : undefined;
              if (latestVersion === undefined) {
                const latestResponse = await fetch(
                  `/api/tournament?id=${encodeURIComponent(key)}`,
                );
                const latest = latestResponse.ok
                  ? await latestResponse.json()
                  : null;
                if (Number.isInteger(latest?.version)) {
                  latestVersion = latest.version;
                  latestConflict = latest;
                }
              }
              if (latestVersion !== undefined && attempt < 2) {
                baseVersion = latestVersion;
                bracketVersionsRef.current[key] = latestVersion;
                setSaving("Syncing latest bracket and retrying…");
                continue;
              }
              if (latestConflict.bracket && latestVersion !== undefined) {
                conflictCallback(latestConflict.bracket, latestVersion);
              }
              throw new Error(
                latestConflict.error ||
                  "The bracket changed elsewhere. Your score was not discarded; retry now.",
              );
            }

            if (!response.ok) throw new Error(result.error || "Save failed");
            bracketVersionsRef.current[key] = result.version;
            savedCallback(result.version);
            setSaving(`Saved automatically · version ${result.version}`);
            return;
          }
        } catch (error) {
          setSaving(
            error instanceof Error
              ? error.message
              : "Not saved · check your connection and try again",
          );
        }
      });
  };
  const changeBracket = (data: BracketData, message: string) => {
    onBracketChange(data);
    setSaving(message);
    setSaveSequence((value) => value + 1);
    const syncedSchedule = syncScheduleWithBracket(
      operations.schedule,
      division,
      level,
      data,
    );
    if (syncedSchedule !== operations.schedule) {
      changeOperations({ ...operations, schedule: syncedSchedule });
    }
  };
  useEffect(() => {
    if (!saveSequence) return;
    const timer = window.setTimeout(saveBracket, 900);
    return () => window.clearTimeout(timer);
  }, [saveSequence]);
  const saveOperations = () => {
    const snapshot = operations;
    const savedCallback = onOperationsSaved;
    const conflictCallback = onOperationsConflict;

    operationsSaveQueueRef.current = operationsSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setOperationsSaving("Saving schedule…");
        let baseVersion = operationsVersionRef.current;
        let latestConflict: {
          operations?: TournamentOperations;
          version?: number;
          error?: string;
        } = {};

        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await fetch("/api/operations", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operations: snapshot, baseVersion }),
            });
            const result = await response.json().catch(() => ({}));

            if (response.status === 409) {
              latestConflict = result;
              let latestVersion = Number.isInteger(result.version)
                ? result.version
                : undefined;
              if (latestVersion === undefined) {
                const latestResponse = await fetch("/api/operations");
                const latest = latestResponse.ok
                  ? await latestResponse.json()
                  : null;
                if (Number.isInteger(latest?.version)) {
                  latestVersion = latest.version;
                  latestConflict = latest;
                }
              }
              if (latestVersion !== undefined && attempt < 2) {
                baseVersion = latestVersion;
                operationsVersionRef.current = latestVersion;
                setOperationsSaving("Syncing latest schedule and retrying…");
                continue;
              }
              if (latestConflict.operations && latestVersion !== undefined) {
                conflictCallback(latestConflict.operations, latestVersion);
              }
              throw new Error(
                latestConflict.error ||
                  "The schedule changed elsewhere. Your changes were not discarded; retry now.",
              );
            }

            if (!response.ok) throw new Error(result.error || "Save failed");
            operationsVersionRef.current = result.version;
            savedCallback(result.version);
            setOperationsSaving(
              `Saved automatically · version ${result.version}`,
            );
            return;
          }
        } catch (error) {
          setOperationsSaving(
            error instanceof Error ? error.message : "Schedule was not saved",
          );
        }
      });
  };
  const changeOperations = (data: TournamentOperations) => {
    const synced = {
      ...data,
      courts: deriveCourtsFromSchedule(data.courts, data.schedule),
    };
    onOperationsChange(synced);
    setOperationsSaving("Unsaved changes · autosaving…");
    setOperationsSequence((value) => value + 1);
  };
  const resetTournamentSession = async () => {
    if (resetStatus === "Resetting tournament session…") return;
    setResetStatus("Resetting tournament session…");
    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "RESET" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Reset failed");
      onSessionReset(result.version);
      setResetConfirmationOpen(false);
      setResetStatus("Tournament session reset successfully.");
    } catch (error) {
      setResetStatus(
        error instanceof Error ? error.message : "Tournament reset failed.",
      );
    }
  };
  useEffect(() => {
    const syncedSchedule = syncScheduleWithBracket(
      operations.schedule,
      division,
      level,
      bracketData,
    );
    if (syncedSchedule !== operations.schedule)
      changeOperations({ ...operations, schedule: syncedSchedule });
  }, [bracketData, division, level]);
  useEffect(() => {
    if (!operationsSequence) return;
    const timer = window.setTimeout(saveOperations, 900);
    return () => window.clearTimeout(timer);
  }, [operationsSequence]);
  const title = (
    kicker: string,
    heading: string,
    description: string,
    action?: ReactNode,
  ) => (
    <section className="admin-page-title">
      <div>
        <p className="eyebrow">
          {kicker}
        </p>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="hero-actions">{action}</div>}
    </section>
  );
  if (section === "teams")
    return (
      <main className="page section-page">
        {title(
          "TEAM MANAGEMENT",
          "Official team entries",
          "Add, edit, remove, and seed doubles teams for every division and level.",
          <button className="primary" onClick={() => setSection("brackets")}>
            View live bracket
          </button>,
        )}
        <section className="panel entries-panel">
          <div className="panel-head">
            <div>
              <h2>Entries & seeding</h2>
              <p>Changes autosave to the official bracket.</p>
            </div>
            <div className="entries-head-actions">
              <span className="official-badge">OFFICIAL DRAW</span>
              <span className="save-status">{saving}</span>
            </div>
          </div>
          <DivisionTabs
            division={division}
            setDivision={setDivision}
            setLevel={setLevel}
          />
          <LevelTabs
            level={level}
            division={division}
            setLevel={setLevel}
            showAllLevels={showAllLevels}
            setShowAllLevels={setShowAllLevels}
          />
          {showAllLevels ? (
            <AllLevelsOverview
              division={division}
              brackets={brackets}
              onOpen={(nextLevel) => {
                setLevel(nextLevel);
                setShowAllLevels(false);
              }}
            />
          ) : (
            <EntryManager
              data={bracketData}
              division={division}
              level={level}
              brackets={brackets}
              onChange={(data) =>
                changeBracket(data, "Unsaved entry changes · autosaving…")
              }
            />
          )}
        </section>
      </main>
    );
  if (section === "brackets")
    return (
      <main className="page section-page bracket-page">
        {title(
          "LIVE SCORING",
          "Tournament brackets",
          "Score matches, follow automatic advancement, and jump directly to every round.",
          <button className="secondary" onClick={() => setSection("teams")}>
            Manage teams
          </button>,
        )}
        <section className="panel bracket-panel">
          <div className="panel-head bracket-heading">
            <div>
              <h2>Editable tournament bracket</h2>
              <p>First to 31 advances automatically to the next round.</p>
            </div>
            <span className="race-badge">RACE TO 31</span>
          </div>
          <DivisionTabs
            division={division}
            setDivision={setDivision}
            setLevel={setLevel}
          />
          <LevelTabs
            level={level}
            division={division}
            setLevel={setLevel}
            showAllLevels={showAllLevels}
            setShowAllLevels={setShowAllLevels}
          />
          {showAllLevels ? (
            <AllLevelsOverview
              division={division}
              brackets={brackets}
              onOpen={(nextLevel) => {
                setLevel(nextLevel);
                setShowAllLevels(false);
              }}
            />
          ) : <>
           <div className="bracket-meta">
            <span>
              <i style={{ background: levelDetails[level].color }} />{" "}
              {division.toUpperCase()} · LEVEL {level}
            </span>
             <small>
               {bracketData.teams.filter(isRealTeam).length} teams entered ·
               {tournamentFormat(bracketData) === "round_robin"
                 ? ` Round Robin · ${roundRobinGroups(bracketData).length} brackets`
                 : " First to 31"}
             </small>
           </div>
           {tournamentFormat(bracketData) === "round_robin" ? (
             <div className="editor-wrap">
               <div className="editor-toolbar">
                 <div><b>Official round robin</b><span>Results update standings and rankings immediately.</span></div>
                 <span className="save-status">{saving}</span>
                 <button onClick={saveBracket}>Save & publish changes</button>
               </div>
               <RoundRobinBoard
                 data={bracketData}
                 onChange={(data) =>
                   changeBracket(data, "Unsaved score changes · autosaving…")
                 }
               />
             </div>
           ) : (
             <BracketEditor
               data={bracketData}
               onChange={(data) =>
                 changeBracket(data, "Unsaved score changes · autosaving…")
               }
               onSave={saveBracket}
               saving={saving}
             />
           )}
          </>}
        </section>
      </main>
    );
  if (section === "matches")
    return (
      <main className="page section-page">
        {title(
          "MATCH CONTROL",
          "Live matches",
          "Monitor active courts and current doubles scores.",
        )}
        <section className="panel live-panel full-page-panel">
          <div className="panel-head">
            <div>
              <h2>Matches on court</h2>
              <p>Live tournament activity</p>
            </div>
            <span className="race-badge">{liveMatches.length} LIVE</span>
          </div>
          <div className="match-list">
            {liveMatches.map((match) => (
              <div className="live-match" key={match.id}>
                <div className="court-label">
                  <span>{match.court}</span>
                  <small>
                    {match.division.replace(" Doubles", "")} {match.level}
                  </small>
                </div>
                <div className="pair">
                  <span>
                    {displayTeamName(match.teamOne)}
                  </span>
                  <span>
                    {displayTeamName(match.teamTwo)}
                  </span>
                </div>
                <div className="score">
                  <strong>{match.score}</strong>
                  <small>Live</small>
                </div>
                <button onClick={() => setSection("schedule")}>View</button>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  if (section === "courts")
    return (
      <main className="page section-page">
        {title(
          "COURT MANAGEMENT",
          "Tournament courts",
          "See which courts are live, available, or preparing for the next match.",
        )}
        <CourtAssignmentPanel
          operations={operations}
          matches={pendingMatches}
          onChange={changeOperations}
        />
        <div className="court-grid-status">{operationsSaving}</div>
        <section className="court-management-grid">
          {operations.courts.map((court) => (
            <article
              className={`panel court-card ${court.status === "available" ? "available" : "active"}`}
              key={court.id}
            >
              <span>{court.name}</span>
              <b>
                {court.status === "live"
                  ? "Match in progress"
                  : court.status === "ready"
                    ? "Ready for assignment"
                    : "Available"}
              </b>
              <small>{court.detail}</small>
              <em>{court.status.toUpperCase()}</em>
            </article>
          ))}
        </section>
      </main>
    );
  if (section === "schedule")
    return (
      <main className="page section-page">
        {title(
          "TOURNAMENT SCHEDULE",
          "Court calls & schedule",
          "Edit the shared match order; every change autosaves for players and admins.",
          <button
            className="primary"
            onClick={() =>
              changeOperations({
                ...operations,
                schedulePublished: !operations.schedulePublished,
              })
            }
          >
            {operations.schedulePublished
              ? "Schedule published"
              : "Publish schedule"}
          </button>,
        )}
        <section className="panel schedule-page-panel wide">
          <div className="panel-head">
            <div>
              <h2>Editable court calls</h2>
              <p>
                Time, court, teams, status, and score are stored in the
                tournament database.
              </p>
            </div>
          </div>
          <ScheduleEditor
            operations={operations}
            matches={pendingMatches}
            onChange={changeOperations}
            saveStatus={operationsSaving}
          />
        </section>
      </main>
    );
  if (section === "settings")
    return (
      <main className="page section-page">
        {title(
          "TOURNAMENT SETTINGS",
          "Rules & configuration",
          "Review the official Red Court Invitational tournament format.",
        )}
        <section className="settings-grid">
          <article className="panel setting-card">
            <span>SCORING</span>
            <h3>First to 31 points</h3>
            <p>The first doubles team to reach 31 wins the match.</p>
            <b>LOCKED OFFICIAL RULE</b>
          </article>
          <article className="panel setting-card">
            <span>ADVANCEMENT</span>
            <h3>Automatic bracket progress</h3>
            <p>Winners are placed into the next round immediately.</p>
            <b>ENABLED</b>
          </article>
          <article className="panel setting-card">
            <span>ENTRIES</span>
            <h3>Unlimited doubles teams</h3>
            <p>
              Each level expands its elimination bracket as teams are added.
            </p>
            <b>ENABLED</b>
          </article>
          <article className="panel setting-card danger-setting">
            <span>SESSION DATA</span>
            <h3>Reset tournament session</h3>
            <p>
              Clear every player, bracket, score, scheduled match, and court
              assignment. Your admin login and database connection stay active.
            </p>
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                setResetStatus("");
                setResetConfirmationOpen(true);
              }}
            >
              Reset tournament session
            </button>
            {resetStatus && <small className="reset-status">{resetStatus}</small>}
          </article>
        </section>
        {resetConfirmationOpen && (
          <div className="confirmation-backdrop" role="presentation">
            <section
              className="confirmation-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="reset-dialog-title"
              aria-describedby="reset-dialog-copy"
            >
              <span className="confirmation-icon">!</span>
              <h2 id="reset-dialog-title">Reset this tournament session?</h2>
              <p id="reset-dialog-copy">
                This permanently removes all players, brackets, scores, match
                times, and court assignments. This action cannot be undone.
              </p>
              {resetStatus && (
                <p className="reset-dialog-status" role="status" aria-live="polite">
                  {resetStatus}
                </p>
              )}
              <div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setResetConfirmationOpen(false)}
                  disabled={resetStatus === "Resetting tournament session…"}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={resetTournamentSession}
                  disabled={resetStatus === "Resetting tournament session…"}
                >
                  {resetStatus === "Resetting tournament session…"
                    ? "Resetting…"
                    : "Yes, reset session"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  const registeredTeams = Object.values(
    operations.players.reduce<Record<string, boolean>>(
      (result, player) => ({
        ...result,
        [[player.name, player.partner].sort().join(" / ")]: true,
      }),
      {},
    ),
  ).length;
  const activeCourts = operations.courts.filter(
    (court) => court.status !== "available",
  ).length;
  return (
    <main className="page">
      <section className="hero-row invitational-admin-hero">
        <div>
          <p className="eyebrow">
            OCTOBER 4, 2026 · LIVE TOURNAMENT
          </p>
          <h1>Red Court Invitational Control</h1>
          <p>
            All doubles divisions, courts, teams, scoring, and brackets in one
            place.
          </p>
        </div>
        <img
          className="admin-event-logo"
          src="/red-court-invitational-logo.png"
          alt="Red Court Invitational 2026"
        />
        <div className="hero-actions">
          <button className="secondary" onClick={() => setView("player")}>
            Public player page
          </button>
          <button className="primary" onClick={() => setSection("schedule")}>
            {operations.schedulePublished
              ? "Schedule published"
              : "Update schedule"}
          </button>
        </div>
      </section>
      <section className="stat-grid">
        <article>
          <div>
            <small>REGISTERED TEAMS</small>
            <strong>{registeredTeams}</strong>
            <em>From saved player records</em>
          </div>
        </article>
        <article>
          <div>
            <small>SCHEDULED MATCHES</small>
            <strong>{operations.schedule.length}</strong>
            <em>Shared live schedule</em>
          </div>
        </article>
        <article>
          <div>
            <small>ACTIVE COURTS</small>
            <strong>
              {activeCourts} <i>/ {operations.courts.length}</i>
            </strong>
            <em>{operations.courts.length - activeCourts} available</em>
          </div>
        </article>
        <article>
          <div>
            <small>POINTS TO WIN</small>
            <strong>31</strong>
            <em>Winner advances</em>
          </div>
        </article>
      </section>
      <section className="division-overview" id="divisions">
        {divisions.map((item, index) => {
          const count =
            operations.players.filter((player) => player.division === item.name)
              .length / 2;
          return (
            <article
              key={item.name}
              className={division === item.name ? "selected" : ""}
              onClick={() => {
                setDivision(item.name);
                setLevel(item.levels[0]);
              }}
            >
              <div>
                <small>DIVISION</small>
                <h3>{item.name}</h3>
                <p>{item.note}</p>
                <div>
                  {item.levels.map((l) => (
                    <b key={l}>Level {l}</b>
                  ))}
                </div>
              </div>
              <em>
                {count}
                <small> teams</small>
              </em>
            </article>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <article className="panel live-panel">
          <div className="panel-head">
            <div>
              <h2>Live doubles matches</h2>
              <p>{liveMatches.length} matches currently on court</p>
            </div>
            <button onClick={() => setSection("matches")}>View all</button>
          </div>
          <div className="match-list">
            {liveMatches.map((match) => (
              <div className="live-match" key={match.id}>
                <div className="court-label">
                  <span>{match.court}</span>
                  <small>
                    {match.division.replace(" Doubles", "")} {match.level}
                  </small>
                </div>
                <div className="pair">
                  <span>
                    {displayTeamName(match.teamOne)}
                  </span>
                  <span>
                    {displayTeamName(match.teamTwo)}
                  </span>
                </div>
                <div className="score">
                  <strong>{match.score}</strong>
                  <small>Live</small>
                </div>
                <button onClick={() => setSection("schedule")}>View</button>
              </div>
            ))}
          </div>
        </article>
        <article className="panel timeline-panel">
          <div className="panel-head">
            <div>
              <h2>Up next</h2>
              <p>Database-backed court calls</p>
            </div>
            <button onClick={() => setSection("schedule")}>
              Full schedule
            </button>
          </div>
          <div className="timeline">
            {pendingMatches
              .slice(0, 3)
              .map((match) => (
                <div key={match.id}>
                  <time>{match.time}</time>
                  <i className={match.status === "live" ? "current" : ""} />
                  <span>
                    <b>
                      {match.court} · {match.division.replace(" Doubles", "")}{" "}
                      {match.level}
                    </b>
                    <small>
                      {displayTeamName(match.teamOne)} vs. {displayTeamName(match.teamTwo)}
                    </small>
                  </span>
                  {match.status === "live" && <em>Live</em>}
                </div>
              ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function SearchLanding({
  query,
  setQuery,
  onSearch,
  noResult,
  operations,
  brackets,
  directoryNames,
  onSelectName,
}: {
  query: string;
  setQuery: (query: string) => void;
  onSearch: (event: FormEvent) => void;
  noResult: boolean;
  operations: TournamentOperations;
  brackets: Record<string, BracketData>;
  directoryNames: string[];
  onSelectName: (name: string) => void;
}) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const pendingMatches = useMemo(
    () => pendingScheduleMatches(operations.schedule, brackets),
    [operations.schedule, brackets],
  );
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const filteredDirectoryNames = directoryNames.filter((name) =>
    name.toLowerCase().includes(directoryQuery.trim().toLowerCase()),
  );
  return (
    <main className="public-page">
      <section className="search-hero" id="find-player">
        <div className="court-lines" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <img
          className="hero-event-logo"
          src="/red-court-invitational-logo.png"
          alt="Red Court Invitational 2026"
        />
        <p className="public-kicker">OCTOBER 4, 2026 · BADMINTON DOUBLES</p>
        <h1>
          Find your match.
          <br />
          <span>Step onto court ready.</span>
        </h1>
        <form className="player-search" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Enter your full name"
            aria-label="Player name"
            autoFocus
          />
          <button type="submit">Find my match</button>
        </form>
        {noResult && (
          <p className="search-error">
            We couldn't find that name. Check the spelling or ask the tournament
            desk.
          </p>
        )}
        <button
          className="player-directory-launch"
          type="button"
          onClick={() => setDirectoryOpen(true)}
        >
          <span>A–Z</span>
          <div>
            <strong>Player name list</strong>
            <small>Browse and find your name</small>
          </div>
        </button>
        <div className="event-facts">
          <span>
            <b>31</b>
            <small>Points to win</small>
          </span>
          <i />
          <span>
            <b>{pendingMatches.length}</b>
            <small>Pending matches</small>
          </span>
          <i />
          <span>
            <b>{operations.courts.length}</b>
            <small>Match courts</small>
          </span>
        </div>
      </section>
      {directoryOpen && (
        <div className="directory-modal-backdrop" role="presentation">
          <section
            className="directory-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-title"
          >
            <header>
              <div>
                <span>A–Z</span>
                <div>
                  <h2 id="directory-title">Find your name</h2>
                  <p>Select your name to open your match.</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close player list"
                onClick={() => setDirectoryOpen(false)}
              >
                Close
              </button>
            </header>
            <label className="directory-search">
              <input
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                placeholder="Search player names"
                aria-label="Search player names"
                autoFocus
              />
            </label>
            <div className="directory-alphabet" aria-hidden="true">
              {alphabet.map((letter) => (
                <span
                  className={
                    directoryNames.some((name) =>
                      name.toUpperCase().startsWith(letter),
                    )
                      ? "has-name"
                      : ""
                  }
                  key={letter}
                >
                  {letter}
                </span>
              ))}
            </div>
            <div className="directory-names">
              {filteredDirectoryNames.length > 0 ? (
                filteredDirectoryNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setDirectoryOpen(false);
                      setDirectoryQuery("");
                      onSelectName(name);
                    }}
                  >
                    <span>{name}</span>
                  </button>
                ))
              ) : (
                <p>
                  {directoryNames.length > 0
                    ? "No player names match your search."
                    : "Player names will appear here after teams are added."}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
      <section className="public-divisions" id="divisions">
        <div>
          <p className="public-kicker">TOURNAMENT DRAWS</p>
          <h2>Every division at a glance</h2>
          <p>
            Red Court Invitational is doubles-only, with levels designed for
            fair, competitive matches.
          </p>
        </div>
        <div className="public-division-grid">
          {divisions.map((item, index) => (
            <article key={item.name}>
              <span>0{index + 1}</span>
              <h3>{item.name}</h3>
              <p>{item.note}</p>
              <div>
                {item.levels.map((level) => (
                  <b key={level}>{level}</b>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="public-schedule" id="schedule">
        <div className="public-schedule-head">
          <div>
            <p className="public-kicker">TOURNAMENT DAY · OCTOBER 4, 2026</p>
            <h2>Live match schedule</h2>
            <p>Times, courts, opponents, and scores update from the official tournament desk.</p>
          </div>
          <span className={operations.schedulePublished ? "published" : "draft"}>
            {operations.schedulePublished ? "OFFICIAL SCHEDULE" : "SCHEDULE PREVIEW"}
          </span>
        </div>
        <div className="public-schedule-list">
          {pendingMatches.length === 0 && (
            <p className="court-assign-empty">
              No waiting or pending matches right now.
            </p>
          )}
          {pendingMatches.map((match) => (
            <article key={match.id}>
              <time>{match.time || "TBA"}</time>
              <div><b>{displayTeamName(match.teamOne)}</b><small>vs. {displayTeamName(match.teamTwo)}</small></div>
              <span>{match.division.replace(" Doubles", "")} · Level {match.level}</span>
              <strong>{match.court}</strong>
              <em className={match.status} aria-label={`${match.status}: ${match.score}`}>
                <span>{match.status}</span>
                <b>{match.score}</b>
              </em>
            </article>
          ))}
        </div>
      </section>
      <section className="public-venue" id="venue">
        <div>
          <p className="public-kicker">MATCH FORMAT</p>
          <h2>Reach 31 points and advance.</h2>
          <p>
            Every match is one game to 31. The winning team moves automatically
            into the next bracket round.
          </p>
        </div>
        <div>
          <b>Red Court Sports Center</b>
          <small>Official 2026 invitational venue</small>
        </div>
      </section>
    </main>
  );
}

function PlayerResult({
  player,
  entries,
  selectedEntry,
  onEntryChange,
  onReset,
  bracketData,
}: {
  player: PlayerRecord;
  entries: PlayerRecord[];
  selectedEntry: number;
  onEntryChange: (index: number) => void;
  onReset: () => void;
  bracketData: BracketData;
}) {
  const entryLabel = (index: number) => {
    const number = index + 1;
    if (number % 100 >= 11 && number % 100 <= 13) return `${number}th Entry`;
    return `${number}${number % 10 === 1 ? "st" : number % 10 === 2 ? "nd" : number % 10 === 3 ? "rd" : "th"} Entry`;
  };
  return (
    <main className="public-page result-page">
      <section className="result-welcome">
        <div>
          <button onClick={onReset}>Search another player</button>
          <p className="public-kicker">PLAYER MATCH CENTER</p>
          <h1>Hi, {player.name.split(" ")[0].toUpperCase()}!</h1>
          <p>Here is everything you need for tournament day.</p>
        </div>
        <div className="result-team">
          <span>
            <small>YOUR TEAM</small>
            <b>
              {displayTeamName(`${player.name} / ${player.partner}`)}
            </b>
            <em>
              {player.division} · Level {player.level} · Seed {player.seed}
            </em>
          </span>
        </div>
      </section>
      {entries.length > 1 && (
        <nav className="player-entry-tabs" aria-label="Player tournament entries">
          {entries.map((entry, index) => (
            <button
              className={selectedEntry === index ? "active" : ""}
              type="button"
              key={`${entry.id}-${index}`}
              onClick={() => onEntryChange(index)}
            >
              <b>{entryLabel(index)}</b>
              <small>{entry.division} · Level {entry.level}</small>
            </button>
          ))}
        </nav>
      )}
      <section className="result-grid">
        <article className="next-match-card result-match">
          <div className="next-label">
            {player.matchStatus === "champion" || player.matchStatus === "runner-up" || player.matchStatus === "eliminated"
              ? "TOURNAMENT RESULT"
              : "YOUR NEXT MATCH"}{" "}
            <em>{player.round ?? "First to 31"}</em>
          </div>
          {player.matchStatus === "champion" ? (
            <div className="final-result-call champion-result-call">
              <div className="placement-medal" aria-hidden="true">C</div>
              <span>
                <small>CHAMPION</small>
                <strong>Champion</strong>
                <em>Official tournament winner</em>
              </span>
              <span>
                <small>WINNING TEAM</small>
                <strong>{displayTeamName(`${player.name} / ${player.partner}`)}</strong>
                <em>{player.division} · Level {player.level}</em>
              </span>
            </div>
          ) : player.matchStatus === "runner-up" ? (
            <div className="final-result-call first-placer-result-call">
              <div className="placement-medal" aria-hidden="true">1</div>
              <span>
                <small>OFFICIAL FINAL PLACEMENT</small>
                <strong>1st Placer</strong>
                <em>Tournament finalist</em>
              </span>
              <span>
                <small>YOUR TEAM</small>
                <strong>{displayTeamName(`${player.name} / ${player.partner}`)}</strong>
                <em>{player.division} · Level {player.level}</em>
              </span>
            </div>
          ) : player.matchStatus === "eliminated" ? (
            <div className="final-result-call eliminated-result-call">
              <span>
                <small>{(player.round ?? "FINAL RESULT").toUpperCase()}</small>
                <strong>Eliminated</strong>
                <em>{player.time}</em>
              </span>
              <span>
                <small>ELIMINATED BY</small>
                <strong>{displayTeamName(player.opponent)}</strong>
                <em>Official bracket result</em>
              </span>
            </div>
          ) : (
            <div className="court-call">
              <span>
                <small>
                  {(player.round ?? "NEXT MATCH").toUpperCase()} · {player.division.toUpperCase()} {player.level}
                </small>
                <strong>{player.court}</strong>
                <em>Be ready by {player.time}</em>
              </span>
              <b>VS</b>
              <span className="opponent">
                <small>OPPONENTS</small>
                <strong>{displayTeamName(player.opponent)}</strong>
                <em>Match starts at {player.time}</em>
              </span>
            </div>
          )}
          <div className="ready-note">
            <span>31</span>
            <p>
              <b>First team to 31 points advances</b>
              <small>
                Scores and the next bracket round update automatically.
              </small>
            </p>
            {(player.matchStatus === "upcoming" || !player.matchStatus) && (
              <button>Add reminder</button>
            )}
          </div>
        </article>
      </section>
      <section className="panel my-bracket">
        <div className="panel-head">
          <div>
            <h2>Your live bracket</h2>
            <p>
              {player.division} · Level {player.level}
            </p>
          </div>
          <span className="updated">Updated just now</span>
        </div>
        <div className="bracket-meta">
          <span>
            <i style={{ background: levelDetails[player.level].color }} /> LIVE
            SCORES & ADVANCEMENT
          </span>
          <small>First to 31 · Winner advances</small>
        </div>
        <Bracket
          level={player.level}
          data={bracketData}
          highlightTeam={`${player.name} / ${player.partner}`}
        />
      </section>
    </main>
  );
}

function PlayerView({
  setView,
  brackets,
  operations,
  authenticated,
}: {
  setView: (view: View) => void;
  brackets: Record<string, BracketData>;
  operations: TournamentOperations;
  authenticated: boolean;
}) {
  const [query, setQuery] = useState("");
  const [playerEntries, setPlayerEntries] = useState<PlayerRecord[]>([]);
  const [selectedEntry, setSelectedEntry] = useState(0);
  const [searched, setSearched] = useState(false);
  const [publishedBrackets, setPublishedBrackets] = useState(brackets);
  const [publishedOperations, setPublishedOperations] = useState(operations);
  useEffect(() => {
    setPublishedOperations(operations);
  }, [operations]);
  useEffect(() => {
    const refreshPublicData = () =>
      Promise.all([
        fetch("/api/tournament").then((response) =>
          response.ok ? response.json() : null,
        ),
        fetch("/api/operations").then((response) =>
          response.ok ? response.json() : null,
        ),
      ])
        .then(([tournamentResult, operationsResult]) => {
          if (tournamentResult?.brackets)
            setPublishedBrackets((current) => ({
              ...current,
              ...tournamentResult.brackets,
            }));
          if (operationsResult?.operations)
            setPublishedOperations(operationsResult.operations);
        })
        .catch(() => undefined);
    refreshPublicData();
    const timer = window.setInterval(refreshPublicData, 4000);
    return () => window.clearInterval(timer);
  }, []);
  const directoryNames = useMemo(() => {
    const names = new Set<string>();
    publishedOperations.players.forEach((item) => {
      if (item.name.trim()) names.add(item.name.trim());
      if (item.partner.trim()) names.add(item.partner.trim());
    });
    Object.values(publishedBrackets).forEach((bracket) => {
      bracket.teams.filter(isRealTeam).forEach((team) => {
        splitTeam(team).forEach((name) => {
          if (name.trim()) names.add(name.trim());
        });
      });
    });
    return Array.from(names).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [publishedOperations.players, publishedBrackets]);
  const findPlayer = (searchValue: string) => {
    const target = searchValue.trim().toLowerCase();
    const matches = new Map<string, PlayerRecord>();
    publishedOperations.players
      .filter(
        (item) =>
          item.name.toLowerCase() === target ||
          item.partner.toLowerCase() === target,
      )
      .forEach((item) => {
        const normalized =
          item.partner.toLowerCase() === target
            ? { ...item, name: item.partner, partner: item.name }
            : item;
        matches.set(
          `${normalized.division}|${normalized.level}|${normalized.name}|${normalized.partner}`,
          normalized,
        );
      });
    for (const [key, bracket] of Object.entries(publishedBrackets)) {
      const level = key.slice(-1) as Level;
      const division = key.slice(0, -2) as Division;
      bracket.teams.forEach((team, teamIndex) => {
        const teamNames = splitTeam(team);
        const side = teamNames.findIndex(
          (name) => name.trim().toLowerCase() === target,
        );
        if (side >= 0) {
          const pair = splitTeam(bracket.teams[teamIndex]);
          const opponentIndex =
            teamIndex % 2 === 0 ? teamIndex + 1 : teamIndex - 1;
          const scheduled = publishedOperations.schedule.find(
            (item) =>
              item.division === division &&
              item.level === level &&
              (item.teamOne.includes(pair[side]) ||
                item.teamTwo.includes(pair[side])),
          );
          const match: PlayerRecord = {
            id: `bracket-${key}-${teamIndex}-${side}`,
            name: pair[side as 0 | 1],
            partner: pair[side === 0 ? 1 : 0],
            division,
            level,
            seed: `#${String(teamIndex + 1).padStart(2, "0")}`,
            opponent: bracket.teams[opponentIndex] || "To be decided",
            court: scheduled?.court ?? "To be assigned",
            time: scheduled?.time ?? "Check schedule",
          };
          matches.set(
            `${division}|${level}|${match.name}|${match.partner}`,
            match,
          );
        }
      });
    }
    const nextEntries = Array.from(matches.values()).sort((left, right) =>
      `${left.division}-${left.level}`.localeCompare(
        `${right.division}-${right.level}`,
      ),
    );
    setPlayerEntries(nextEntries);
    setSelectedEntry(0);
    setSearched(true);
  };
  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    findPlayer(query);
  };
  const basePlayer = playerEntries[selectedEntry] ?? null;
  useEffect(() => {
    if (!basePlayer) return;
    const key = `${basePlayer.division}-${basePlayer.level}`;
    fetch(`/api/tournament?id=${encodeURIComponent(key)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result?.bracket)
          setPublishedBrackets((current) => ({
            ...current,
            [key]: result.bracket,
          }));
      })
      .catch(() => undefined);
  }, [basePlayer?.division, basePlayer?.level]);
  const playerBracket = basePlayer
    ? (publishedBrackets[`${basePlayer.division}-${basePlayer.level}`] ??
      initialBracket(basePlayer.level))
    : null;
  const player =
    basePlayer && playerBracket
      ? resolvePlayerProgress(
          basePlayer,
          playerBracket,
          publishedOperations.schedule,
        )
      : null;
  return (
    <div className="public-shell">
      <PublicHeader setView={setView} authenticated={authenticated} />
      {player && playerBracket ? (
        <PlayerResult
          player={player}
          entries={playerEntries}
          selectedEntry={selectedEntry}
          onEntryChange={setSelectedEntry}
          bracketData={playerBracket}
          onReset={() => {
            setPlayerEntries([]);
            setSelectedEntry(0);
            setQuery("");
            setSearched(false);
          }}
        />
      ) : (
        <SearchLanding
          query={query}
          setQuery={setQuery}
          onSearch={handleSearch}
          noResult={searched && playerEntries.length === 0}
          operations={publishedOperations}
          brackets={publishedBrackets}
          directoryNames={directoryNames}
          onSelectName={(name) => {
            setQuery(name);
            findPlayer(name);
          }}
        />
      )}
      <footer className="public-footer">
        <Brand />
        <span>Badminton doubles · First to 31 points · Winner advances</span>
        <small>Need help? Visit the tournament desk.</small>
      </footer>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("player");
  const [level, setLevel] = useState<Level>("A");
  const [division, setDivision] = useState<Division>("Men's Doubles");
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [brackets, setBrackets] = useState<Record<string, BracketData>>({});
  const [bracketVersions, setBracketVersions] = useState<
    Record<string, number>
  >({});
  const [operations, setOperations] = useState<TournamentOperations>(
    defaultTournamentOperations,
  );
  const [operationsVersion, setOperationsVersion] = useState(1);
  const bracketKey = `${division}-${level}`;
  const currentBracket = brackets[bracketKey] ?? initialBracket(level);
  const updateBracket = (data: BracketData) =>
    setBrackets((current) => ({ ...current, [bracketKey]: data }));
  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json())
      .then((result) => {
        setAdminUser(result.user ?? null);
        if (result.authenticated) setView("admin");
      })
      .catch(() => setAdminUser(null))
      .finally(() => setAuthChecked(true));
  }, []);
  useEffect(() => {
    fetch("/api/tournament")
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result?.brackets)
          setBrackets((current) => ({ ...result.brackets, ...current }));
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    fetch("/api/operations")
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result?.operations) {
          setOperations(result.operations);
          setOperationsVersion(result.version);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (bracketKey in bracketVersions) return;
    let active = true;
    fetch(`/api/tournament?id=${encodeURIComponent(bracketKey)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (active) {
          if (result?.bracket)
            setBrackets((current) => ({
              ...current,
              [bracketKey]: result.bracket,
            }));
          if (Number.isInteger(result?.version))
            setBracketVersions((current) => ({
              ...current,
              [bracketKey]: result.version,
            }));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bracketKey, bracketVersions]);
  if (!authChecked)
    return (
      <div className="app-loading">
        <Brand />
        <span>Loading tournament…</span>
      </div>
    );
  if (view === "player" || !adminUser)
    return (
      <PlayerView
        setView={setView}
        brackets={brackets}
        operations={operations}
        authenticated={Boolean(adminUser)}
      />
    );
  return (
    <div className="app-shell">
      <Sidebar
        setView={setView}
        section={adminSection}
        setSection={setAdminSection}
        adminName={adminUser.displayName}
      />
      <div className="content-shell">
        <AdminTopbar setView={setView} />
        <AdminView
          section={adminSection}
          setSection={setAdminSection}
          setView={setView}
          level={level}
          division={division}
          setLevel={setLevel}
          setDivision={setDivision}
          bracketData={currentBracket}
          brackets={brackets}
          showAllLevels={showAllLevels}
          setShowAllLevels={setShowAllLevels}
          bracketVersion={bracketVersions[bracketKey] ?? 0}
          onBracketChange={updateBracket}
          onBracketSaved={(version) =>
            setBracketVersions((current) => ({
              ...current,
              [bracketKey]: version,
            }))
          }
          onBracketConflict={(data, version) => {
            updateBracket(data);
            setBracketVersions((current) => ({
              ...current,
              [bracketKey]: version,
            }));
          }}
          operations={operations}
          operationsVersion={operationsVersion}
          onOperationsChange={setOperations}
          onOperationsSaved={setOperationsVersion}
          onOperationsConflict={(data, version) => {
            setOperations(data);
            setOperationsVersion(version);
          }}
          onSessionReset={(version) => {
            setBrackets({});
            setBracketVersions({});
            setOperations(defaultTournamentOperations);
            setOperationsVersion(version);
            setShowAllLevels(false);
          }}
        />
      </div>
    </div>
  );
}
