import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./NbaFullRoster.css";
import pointsJson from "../../sport/nba/type/stats/points.json";
import reboundsJson from "../../sport/nba/type/stats/rebounds.json";
import assistsJson from "../../sport/nba/type/stats/assists.json";
import salariesJson from "../../sport/nba/type/single-game/salaries.json";
import { projectMeanPoissonFromOverUnder } from "../../lib/poissonProjection";
import { projectMeanTunedLogNormalFromOverUnder } from "../../lib/pointsProjection";
import {
  optimizeMlbLineup,
  type LineupSlot,
  type MlbLineupPlayer,
} from "../../lib/mlbLineupOptimizer";
import { getMergedSelectionsForStatPrefix } from "./nbaStatSelections";

const STAT_GROUPS = [
  "Points",
  "Rebounds",
  "Assists",
  "Blocks",
  "Steals",
] as const;

type Column = {
  key: string;
  label: string;
};

function buildColumns(): Column[] {
  const columns: Column[] = [];

  columns.push({ key: "name", label: "Name" });
  columns.push({ key: "position", label: "Position" });

  for (const stat of STAT_GROUPS) {
    columns.push({ key: `${stat}:actual`, label: stat });
    columns.push({ key: `${stat}:over`, label: "Over" });
    columns.push({ key: `${stat}:proj`, label: `Projected ${stat}` });
  }

  columns.push({ key: "fantasyPoints", label: "Fantasy Points" });
  columns.push({ key: "salary", label: "Salary" });
  columns.push({ key: "value", label: "Value" });

  return columns;
}

const columns = buildColumns();

type PointsSelection = {
  label?: string;
  points?: number;
  milestoneValue?: number;
  marketId?: string | number;
  displayOdds?: {
    american?: string;
  };
  participants?: Array<{
    id?: string | number;
    name?: string;
  }>;
};

function formatAmericanOdds(american: string | undefined): string {
  return american ?? "";
}

type StatName = (typeof STAT_GROUPS)[number];

type StatSelection = PointsSelection;

function parseAmericanOdds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replaceAll("−", "-")
    .replaceAll("–", "-")
    .replaceAll("+", "");
  const match = normalized.match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function impliedProbabilityFromAmericanOdds(odds: number): number {
  if (odds < 0) {
    const a = Math.abs(odds);
    return a / (a + 100);
  }
  return 100 / (odds + 100);
}

function clamp01(p: number): number {
  if (p <= 0) return 1e-6;
  if (p >= 1) return 1 - 1e-6;
  return p;
}

function americanOddsFromProbability(p: number): string {
  const pp = clamp01(p);
  if (pp >= 0.5) {
    const odds = -Math.round((100 * pp) / (1 - pp));
    return String(odds);
  }
  const odds = Math.round((100 * (1 - pp)) / pp);
  return `+${odds}`;
}

type SalaryEntry = {
  Nickname?: string;
  Salary?: number;
  Position?: string;
  Team?: string;
};

type SalaryInfo = {
  salary: number;
  position: string;
  team: string;
};

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

function normalizePlayerName(name: string): string {
  let preNormalized = name.trim();

  // Exceptions for mismatched salary vs. stats feeds
  if (/^jaylin\s+williams\s*\(okc\)\s*$/i.test(preNormalized))
    preNormalized = "Jaylin Williams";
  if (/^nicolas\s+claxton\s*$/i.test(preNormalized))
    preNormalized = "Nic Claxton";
  if (/^ron\s+holland\s+ii\s*$/i.test(preNormalized))
    preNormalized = "Ronald Holland";

  const cleaned = preNormalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) return "";

  const tokens = cleaned.split(" ").filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

function buildSalaryMap(): Map<string, SalaryInfo> {
  const map = new Map<string, SalaryInfo>();
  const entries = Array.isArray(salariesJson)
    ? (salariesJson as SalaryEntry[])
    : ([] as SalaryEntry[]);

  for (const entry of entries) {
    const nickname = typeof entry?.Nickname === "string" ? entry.Nickname : "";
    const salary = typeof entry?.Salary === "number" ? entry.Salary : null;
    if (!nickname || salary === null) continue;

    const position = typeof entry?.Position === "string" ? entry.Position : "";
    const teamRaw = typeof entry?.Team === "string" ? entry.Team : "";
    const team = teamRaw.trim().toUpperCase();

    const key = normalizePlayerName(nickname);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { salary, position, team });
  }

  return map;
}

const salaryByName = buildSalaryMap();

type RosterPosition = "PG" | "SG" | "SF" | "PF" | "C";
const ROSTER_POSITIONS: RosterPosition[] = ["PG", "SG", "SF", "PF", "C"];

function parseEligiblePositions(position: string): RosterPosition[] {
  const normalized = position.trim().toUpperCase();
  if (!normalized) return [];

  const parts = normalized.split("/").map((p) => p.trim());
  const eligible: RosterPosition[] = [];
  for (const part of parts) {
    if (ROSTER_POSITIONS.includes(part as RosterPosition))
      eligible.push(part as RosterPosition);
  }
  return eligible;
}

type PlayerAccumulator = {
  name: string;
  lines: Partial<Record<StatName, number>>;
  overOdds: Partial<Record<StatName, string>>;
  underOdds: Partial<Record<StatName, string>>;
  projected: Partial<Record<StatName, number>>;
};

function getOrCreatePlayer(
  map: Map<string, PlayerAccumulator>,
  playerId: string,
  playerName: string,
): PlayerAccumulator {
  const existing = map.get(playerId);
  if (existing) {
    if (!existing.name) existing.name = playerName;
    return existing;
  }

  const created: PlayerAccumulator = {
    name: playerName,
    lines: {},
    overOdds: {},
    underOdds: {},
    projected: {},
  };
  map.set(playerId, created);
  return created;
}

function maybeProject(
  stat: StatName,
  player: PlayerAccumulator,
  projector: (params: {
    line: number;
    overAmericanOdds: string;
    underAmericanOdds: string;
  }) => number | null,
) {
  if (player.projected[stat] !== undefined) return;
  const line = player.lines[stat];
  const over = player.overOdds[stat];
  const under = player.underOdds[stat];
  if (line === undefined || !over || !under) return;
  const projected = projector({
    line,
    overAmericanOdds: over,
    underAmericanOdds: under,
  });
  if (projected !== null) player.projected[stat] = projected;
}

function mergeMilestoneSelections(
  map: Map<string, PlayerAccumulator>,
  stat: StatName,
  selections: StatSelection[],
  projector: (params: {
    line: number;
    overAmericanOdds: string;
    underAmericanOdds: string;
  }) => number | null,
) {
  type Best = { milestone: number; american: string; p: number };

  const bestByPlayer = new Map<string, { name: string; best: Best | null }>();

  for (const selection of selections) {
    const milestone =
      typeof selection.milestoneValue === "number"
        ? selection.milestoneValue
        : typeof selection.points === "number"
          ? selection.points
          : null;

    if (milestone === null) continue;

    const american = formatAmericanOdds(selection.displayOdds?.american);
    if (!american) continue;

    const parsedOdds = parseAmericanOdds(american);
    if (parsedOdds === null) continue;
    const pOver = clamp01(impliedProbabilityFromAmericanOdds(parsedOdds));

    const participants = selection.participants ?? [];
    if (participants.length === 0) continue;

    for (const participant of participants) {
      const id = participant.id;
      const playerId = id === undefined || id === null ? "" : String(id);
      if (!playerId) continue;
      const playerName = participant.name ?? "";

      const existing = bestByPlayer.get(playerId);
      const currentBest = existing?.best;
      const candidate: Best = { milestone, american, p: pOver };

      const isBetter =
        currentBest === null ||
        currentBest === undefined ||
        Math.abs(candidate.p - 0.5) < Math.abs(currentBest.p - 0.5);

      if (!existing) {
        bestByPlayer.set(playerId, { name: playerName, best: candidate });
      } else {
        if (!existing.name && playerName) existing.name = playerName;
        if (isBetter) existing.best = candidate;
      }
    }
  }

  for (const [playerId, entry] of bestByPlayer.entries()) {
    if (!entry.best) continue;
    const player = getOrCreatePlayer(map, playerId, entry.name);

    const line = entry.best.milestone - 0.5;
    const overOdds = entry.best.american;
    const underOdds = americanOddsFromProbability(1 - entry.best.p);

    player.lines[stat] = line;
    player.overOdds[stat] = overOdds;
    player.underOdds[stat] = underOdds;

    maybeProject(stat, player, projector);
  }
}

function buildRows(): Array<Record<string, string | number>> {
  const map = new Map<string, PlayerAccumulator>();

  const pointsSelections =
    (pointsJson as { selections?: StatSelection[] }).selections ?? [];
  const reboundsSelections =
    (reboundsJson as { selections?: StatSelection[] }).selections ?? [];
  const assistsSelections =
    (assistsJson as { selections?: StatSelection[] }).selections ?? [];
  const stealsSelections = getMergedSelectionsForStatPrefix<StatSelection>(
    "steals",
  );
  const blocksSelections = getMergedSelectionsForStatPrefix<StatSelection>(
    "blocks",
  );

  const projectRebounds = (params: {
    line: number;
    overAmericanOdds: string;
    underAmericanOdds: string;
  }) => projectMeanTunedLogNormalFromOverUnder(params);

  const projectAssists = (params: {
    line: number;
    overAmericanOdds: string;
    underAmericanOdds: string;
  }) =>
    params.line <= 4
      ? projectMeanPoissonFromOverUnder(params)
      : projectMeanTunedLogNormalFromOverUnder(params);

  const computeFantasyPoints = (p: PlayerAccumulator): number | "" => {
    const projectedPoints = p.projected.Points;
    const projectedRebounds = p.projected.Rebounds;
    const projectedAssists = p.projected.Assists;
    const projectedSteals = p.projected.Steals;
    const projectedBlocks = p.projected.Blocks;

    if (
      projectedPoints === undefined &&
      projectedRebounds === undefined &&
      projectedAssists === undefined &&
      projectedSteals === undefined &&
      projectedBlocks === undefined
    ) {
      return "";
    }

    const value =
      (projectedPoints ?? 0) +
      1.2 * (projectedRebounds ?? 0) +
      1.5 * (projectedAssists ?? 0) +
      3 * (projectedSteals ?? 0) +
      3 * (projectedBlocks ?? 0);

    const assistsForTurnovers = projectedAssists ?? 0;
    const estimatedTurnovers =
      assistsForTurnovers >= 5
        ? assistsForTurnovers / 2.5
        : assistsForTurnovers / 2.0;

    // FanDuel NBA: -1 per turnover (estimated)
    const withTurnovers = value - estimatedTurnovers;

    return Math.round(withTurnovers * 100) / 100;
  };

  mergeMilestoneSelections(
    map,
    "Points",
    pointsSelections,
    projectMeanTunedLogNormalFromOverUnder,
  );
  mergeMilestoneSelections(
    map,
    "Rebounds",
    reboundsSelections,
    projectRebounds,
  );
  mergeMilestoneSelections(map, "Assists", assistsSelections, projectAssists);
  mergeMilestoneSelections(
    map,
    "Steals",
    stealsSelections,
    projectMeanPoissonFromOverUnder,
  );
  mergeMilestoneSelections(
    map,
    "Blocks",
    blocksSelections,
    projectMeanPoissonFromOverUnder,
  );

  return [...map.values()]
    .filter((p) => p.name)
    .map((p) => {
      const fantasyPoints = computeFantasyPoints(p);
      const salaryInfo = salaryByName.get(normalizePlayerName(p.name));
      if (!salaryInfo) return null;
      const salary = salaryInfo.salary;
      const position = salaryInfo.position ?? "";
      const team = salaryInfo.team ?? "";

      const valueNumber =
        typeof fantasyPoints === "number" &&
          typeof salary === "number" &&
          salary > 0
          ? Math.round(((fantasyPoints * 1000) / salary) * 100) / 100
          : null;

      const row: Record<string, string | number> = {
        team,
        position,
        salary: salary ?? "",
        value: valueNumber ?? "",
        name: p.name,
        "Points:actual": p.lines.Points ?? "",
        "Points:over": p.overOdds.Points ?? "",
        "Points:proj": p.projected.Points ?? "",

        "Rebounds:actual": p.lines.Rebounds ?? "",
        "Rebounds:over": p.overOdds.Rebounds ?? "",
        "Rebounds:proj": p.projected.Rebounds ?? "",

        "Assists:actual": p.lines.Assists ?? "",
        "Assists:over": p.overOdds.Assists ?? "",
        "Assists:proj": p.projected.Assists ?? "",

        "Blocks:actual": p.lines.Blocks ?? "",
        "Blocks:over": p.overOdds.Blocks ?? "",
        "Blocks:proj": p.projected.Blocks ?? "",

        "Steals:actual": p.lines.Steals ?? "",
        "Steals:over": p.overOdds.Steals ?? "",
        "Steals:proj": p.projected.Steals ?? "",

        fantasyPoints,
      };

      return { row, valueSort: valueNumber ?? -Infinity };
    })
    .filter(
      (x): x is { row: Record<string, string | number>; valueSort: number } =>
        x !== null,
    )
    .sort((a, b) => {
      if (b.valueSort !== a.valueSort) return b.valueSort - a.valueSort;
      return String(a.row.name).localeCompare(String(b.row.name));
    })
    .map((x) => x.row);
}

const rows = buildRows();

type OptimalLineupRow = {
  name: string;
  position: string;
  salary: number | "";
  fantasyPoints: number | "";
  value: number | "";
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type LineupResult = {
  rows: OptimalLineupRow[];
  totals: OptimalLineupRow;
};

const SINGLE_GAME_ROSTER_SIZE = 6;
const MVP_MULTIPLIER = 1.5;

function orderSingleGameLineup(lineup: OptimalLineupRow[]): OptimalLineupRow[] {
  const copy = [...lineup];
  copy.sort((a, b) => {
    const aIsMvp = a.position === "MVP" ? 1 : 0;
    const bIsMvp = b.position === "MVP" ? 1 : 0;
    if (bIsMvp !== aIsMvp) return bIsMvp - aIsMvp;
    return String(a.name).localeCompare(String(b.name));
  });
  return copy;
}

function finalizeLineup(lineup: OptimalLineupRow[]): LineupResult {
  const orderedLineup = orderSingleGameLineup(lineup);

  while (orderedLineup.length < SINGLE_GAME_ROSTER_SIZE) {
    orderedLineup.push({
      name: "",
      position: "",
      salary: "" as const,
      fantasyPoints: "" as const,
      value: "" as const,
    });
  }

  const totalSalary = orderedLineup.reduce(
    (sum, r) => sum + (typeof r.salary === "number" ? r.salary : 0),
    0,
  );
  const totalFantasyPoints = orderedLineup.reduce(
    (sum, r) =>
      sum + (typeof r.fantasyPoints === "number" ? r.fantasyPoints : 0),
    0,
  );
  const totalValue: number | "" =
    totalSalary > 0
      ? round2((totalFantasyPoints * 1000) / totalSalary)
      : ("" as const);

  return {
    rows: orderedLineup,
    totals: {
      name: "TOTAL",
      position: "",
      salary: totalSalary > 0 ? totalSalary : ("" as const),
      fantasyPoints:
        totalFantasyPoints > 0 ? round2(totalFantasyPoints) : ("" as const),
      value: totalValue,
    },
  };
}

type SingleGameSlotKey = "MVP" | "U1" | "U2" | "U3" | "U4" | "U5";

const NBA_SINGLE_GAME_SLOTS: Array<LineupSlot<SingleGameSlotKey>> = [
  {
    key: "MVP",
    label: "MVP",
    isEligible: () => true,
    salaryMultiplier: MVP_MULTIPLIER,
    fantasyPointsMultiplier: MVP_MULTIPLIER,
  },
  { key: "U1", label: "", isEligible: () => true },
  { key: "U2", label: "", isEligible: () => true },
  { key: "U3", label: "", isEligible: () => true },
  { key: "U4", label: "", isEligible: () => true },
  { key: "U5", label: "", isEligible: () => true },
];

function lineupFromOptimizedSingleGame(
  optimized: { playersBySlot: Record<string, MlbLineupPlayer> } | null,
): LineupResult {
  if (!optimized) return finalizeLineup([]);

  const lineup: OptimalLineupRow[] = NBA_SINGLE_GAME_SLOTS.map((slot) => {
    const player = optimized.playersBySlot[slot.key];
    const salaryMultiplier = slot.salaryMultiplier ?? 1;
    const fantasyPointsMultiplier = slot.fantasyPointsMultiplier ?? 1;
    const effectiveSalary = round2(player.salary * salaryMultiplier);
    const effectiveFantasyPoints = round2(
      player.fantasyPoints * fantasyPointsMultiplier,
    );

    const value =
      effectiveSalary > 0
        ? round2((effectiveFantasyPoints * 1000) / effectiveSalary)
        : ("" as const);

    return {
      name: player.name,
      position: slot.label,
      salary: effectiveSalary,
      fantasyPoints: effectiveFantasyPoints,
      value: typeof value === "number" ? value : ("" as const),
    };
  });

  return finalizeLineup(lineup);
}

export default function NbaSingleGame() {
  const optimizerPlayers = useMemo((): MlbLineupPlayer[] => {
    const salaryCap = 60000;
    const byId = new Map<string, MlbLineupPlayer>();

    for (const r of rows) {
      const name = typeof r.name === "string" ? r.name : "";
      const key = normalizePlayerName(name);
      if (!key) continue;

      const salary = typeof r.salary === "number" ? r.salary : null;
      const fantasyPoints =
        typeof r.fantasyPoints === "number" ? r.fantasyPoints : null;
      const position = typeof r.position === "string" ? r.position : "";
      const team = typeof r.team === "string" ? r.team : "";

      if (!name || salary === null || fantasyPoints === null) continue;
      if (salary <= 0 || salary > salaryCap) continue;

      const eligible = parseEligiblePositions(position);
      if (eligible.length === 0) continue;

      const existing = byId.get(key);
      const next: MlbLineupPlayer = {
        id: key,
        name,
        positions: eligible,
        salary,
        fantasyPoints,
        team: team.trim().toUpperCase(),
      };

      if (!existing) {
        byId.set(key, next);
        continue;
      }

      const mergedPositions = [...new Set([...existing.positions, ...next.positions])];
      const isBetter =
        next.fantasyPoints > existing.fantasyPoints ||
        (next.fantasyPoints === existing.fantasyPoints &&
          next.salary < existing.salary);

      byId.set(key, {
        ...(isBetter ? next : existing),
        positions: mergedPositions,
        team: (existing.team || next.team || "").trim().toUpperCase(),
      });
    }

    return [...byId.values()];
  }, []);

  const [optimal, setOptimal] = useState<LineupResult>(() => finalizeLineup([]));
  const [secondBest, setSecondBest] = useState<LineupResult>(() => finalizeLineup([]));
  const [thirdBest, setThirdBest] = useState<LineupResult>(() => finalizeLineup([]));
  const [lineupStatus, setLineupStatus] = useState<"solving" | "done" | "error">("solving");
  const [lineupError, setLineupError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLineupStatus("solving");
        setLineupError("");

        const best = await optimizeMlbLineup({
          players: optimizerPlayers,
          salaryCap: 60000,
          slots: NBA_SINGLE_GAME_SLOTS,
          maxPlayersPerTeamByPositions: {
            maxPlayersPerTeam: 4,
            positions: ["PG", "SG", "SF", "PF", "C"],
          },
        });

        const bestIds = best
          ? Array.from(new Set(Object.values(best.playersBySlot).map((p) => p.id)))
          : [];

        const second = await optimizeMlbLineup({
          players: optimizerPlayers,
          salaryCap: 60000,
          slots: NBA_SINGLE_GAME_SLOTS,
          maxPlayersPerTeamByPositions: {
            maxPlayersPerTeam: 4,
            positions: ["PG", "SG", "SF", "PF", "C"],
          },
          excludeLineupsByPlayerIds: bestIds.length > 0 ? [bestIds] : [],
        });

        const secondIds = second
          ? Array.from(new Set(Object.values(second.playersBySlot).map((p) => p.id)))
          : [];

        const third =
          bestIds.length > 0 && secondIds.length > 0
            ? await optimizeMlbLineup({
                players: optimizerPlayers,
                salaryCap: 60000,
                slots: NBA_SINGLE_GAME_SLOTS,
                maxPlayersPerTeamByPositions: {
                  maxPlayersPerTeam: 4,
                  positions: ["PG", "SG", "SF", "PF", "C"],
                },
                excludeLineupsByPlayerIds: [bestIds, secondIds],
              })
            : null;

        if (cancelled) return;
        setOptimal(lineupFromOptimizedSingleGame(best));
        setSecondBest(lineupFromOptimizedSingleGame(second));
        setThirdBest(lineupFromOptimizedSingleGame(third));
        setLineupStatus("done");
      } catch (e) {
        if (cancelled) return;
        setOptimal(finalizeLineup([]));
        setSecondBest(finalizeLineup([]));
        setThirdBest(finalizeLineup([]));
        setLineupStatus("error");
        setLineupError(e instanceof Error ? e.message : String(e));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [optimizerPlayers]);

  return (
    <div className="page">
      <header className="pageHeader">
        <h1>NBA / Single Game</h1>
        <Link to="/">Back to Home</Link>
      </header>

      <main className="pageMain">
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="emptyCell" colSpan={columns.length}>
                    No data yet
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.name}>
                    {columns.map((c) => (
                      <td key={c.key}>{row[c.key] ?? ""}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="lineupsRow">
            <div className="lineupPanel">
              <h2 className="sectionTitle">Optimal Lineup</h2>
              {lineupStatus === "error" ? (
                <div className="emptyCell">{lineupError || "Lineup solve failed"}</div>
              ) : lineupStatus === "solving" ? (
                <div className="emptyCell">Solving…</div>
              ) : null}
              <table className="dataTable">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Position</th>
                    <th scope="col">Salary</th>
                    <th scope="col">Fantasy Points</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {optimal.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.name}</td>
                      <td>{r.position}</td>
                      <td>{r.salary}</td>
                      <td>{r.fantasyPoints}</td>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>{optimal.totals.name}</td>
                    <td>{optimal.totals.position}</td>
                    <td>{optimal.totals.salary}</td>
                    <td>
                      {typeof optimal.totals.fantasyPoints === "number"
                        ? optimal.totals.fantasyPoints.toFixed(2)
                        : optimal.totals.fantasyPoints}
                    </td>
                    <td>{optimal.totals.value}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="lineupPanel">
              <h2 className="sectionTitle">Second Best Lineup</h2>
              <table className="dataTable">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Position</th>
                    <th scope="col">Salary</th>
                    <th scope="col">Fantasy Points</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {secondBest.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.name}</td>
                      <td>{r.position}</td>
                      <td>{r.salary}</td>
                      <td>{r.fantasyPoints}</td>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>{secondBest.totals.name}</td>
                    <td>{secondBest.totals.position}</td>
                    <td>{secondBest.totals.salary}</td>
                    <td>
                      {typeof secondBest.totals.fantasyPoints === "number"
                        ? secondBest.totals.fantasyPoints.toFixed(2)
                        : secondBest.totals.fantasyPoints}
                    </td>
                    <td>{secondBest.totals.value}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="lineupPanel">
              <h2 className="sectionTitle">Third Best Lineup</h2>
              <table className="dataTable">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Position</th>
                    <th scope="col">Salary</th>
                    <th scope="col">Fantasy Points</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {thirdBest.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.name}</td>
                      <td>{r.position}</td>
                      <td>{r.salary}</td>
                      <td>{r.fantasyPoints}</td>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>{thirdBest.totals.name}</td>
                    <td>{thirdBest.totals.position}</td>
                    <td>{thirdBest.totals.salary}</td>
                    <td>
                      {typeof thirdBest.totals.fantasyPoints === "number"
                        ? thirdBest.totals.fantasyPoints.toFixed(2)
                        : thirdBest.totals.fantasyPoints}
                    </td>
                    <td>{thirdBest.totals.value}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
