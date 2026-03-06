import { Link } from 'react-router-dom'
import './NbaFullRoster.css'
import pointsJson from '../../sport/nba/type/full-roster/stats/points.json'
import reboundsJson from '../../sport/nba/type/full-roster/stats/rebounds.json'
import assistsJson from '../../sport/nba/type/full-roster/stats/assists.json'
import stealsJson from '../../sport/nba/type/full-roster/stats/steals.json'
import blocksJson from '../../sport/nba/type/full-roster/stats/blocks.json'
import salariesJson from '../../sport/nba/type/full-roster/salaries.json'
import { projectMeanLogNormalFromOverUnder } from '../../lib/logNormalProjection'
import { projectMeanPoissonFromOverUnder } from '../../lib/poissonProjection'

const STAT_GROUPS = ['Points', 'Rebounds', 'Assists', 'Blocks', 'Steals'] as const

type Column = {
  key: string
  label: string
}

function buildColumns(): Column[] {
  const columns: Column[] = []

  columns.push({ key: 'name', label: 'Name' })

  for (const stat of STAT_GROUPS) {
    columns.push({ key: `${stat}:actual`, label: stat })
    columns.push({ key: `${stat}:over`, label: 'Over' })
    columns.push({ key: `${stat}:under`, label: 'Under' })
    columns.push({ key: `${stat}:proj`, label: `Projected ${stat}` })
  }

  columns.push({ key: 'fantasyPoints', label: 'Fantasy Points' })
  columns.push({ key: 'salary', label: 'Salary' })
  columns.push({ key: 'value', label: 'Value' })

  return columns
}

const columns = buildColumns()

type PointsSelection = {
  label?: string
  points?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    id?: string | number
    name?: string
  }>
}

function formatAmericanOdds(american: string | undefined): string {
  return american ?? ''
}

type StatName = (typeof STAT_GROUPS)[number]

type StatSelection = PointsSelection

type SalaryEntry = {
  Nickname?: string
  Salary?: number
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function normalizePlayerName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  if (!cleaned) return ''

  const tokens = cleaned.split(' ').filter(Boolean)
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  return tokens.join(' ')
}

function buildSalaryMap(): Map<string, number> {
  const map = new Map<string, number>()
  const entries = Array.isArray(salariesJson) ? (salariesJson as SalaryEntry[]) : ([] as SalaryEntry[])

  for (const entry of entries) {
    const nickname = typeof entry?.Nickname === 'string' ? entry.Nickname : ''
    const salary = typeof entry?.Salary === 'number' ? entry.Salary : null
    if (!nickname || salary === null) continue

    const key = normalizePlayerName(nickname)
    if (!key) continue
    if (!map.has(key)) map.set(key, salary)
  }

  return map
}

const salaryByName = buildSalaryMap()

type PlayerAccumulator = {
  name: string
  lines: Partial<Record<StatName, number>>
  overOdds: Partial<Record<StatName, string>>
  underOdds: Partial<Record<StatName, string>>
  projected: Partial<Record<StatName, number>>
}

function getOrCreatePlayer(map: Map<string, PlayerAccumulator>, playerId: string, playerName: string): PlayerAccumulator {
  const existing = map.get(playerId)
  if (existing) {
    if (!existing.name) existing.name = playerName
    return existing
  }

  const created: PlayerAccumulator = {
    name: playerName,
    lines: {},
    overOdds: {},
    underOdds: {},
    projected: {},
  }
  map.set(playerId, created)
  return created
}

function maybeProject(
  stat: StatName,
  player: PlayerAccumulator,
  projector: (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) => number | null,
) {
  if (player.projected[stat] !== undefined) return
  const line = player.lines[stat]
  const over = player.overOdds[stat]
  const under = player.underOdds[stat]
  if (line === undefined || !over || !under) return
  const projected = projector({ line, overAmericanOdds: over, underAmericanOdds: under })
  if (projected !== null) player.projected[stat] = projected
}

function mergeSelections(
  map: Map<string, PlayerAccumulator>,
  stat: StatName,
  selections: StatSelection[],
  projector: (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) => number | null,
) {
  for (const selection of selections) {
    const label = (selection.label ?? '').toLowerCase()
    const odds = formatAmericanOdds(selection.displayOdds?.american)
    const line = selection.points

    for (const participant of selection.participants ?? []) {
      const id = participant.id
      const playerId = id === undefined || id === null ? '' : String(id)
      if (!playerId) continue

      const player = getOrCreatePlayer(map, playerId, participant.name ?? '')

      if (player.lines[stat] === undefined && line !== undefined) player.lines[stat] = line
      if (label === 'over') player.overOdds[stat] = odds
      if (label === 'under') player.underOdds[stat] = odds

      maybeProject(stat, player, projector)
    }
  }
}

function buildRows(): Array<Record<string, string | number>> {
  const map = new Map<string, PlayerAccumulator>()

  const pointsSelections = (pointsJson as { selections?: StatSelection[] }).selections ?? []
  const reboundsSelections = (reboundsJson as { selections?: StatSelection[] }).selections ?? []
  const assistsSelections = (assistsJson as { selections?: StatSelection[] }).selections ?? []
  const stealsSelections = (stealsJson as { selections?: StatSelection[] }).selections ?? []
  const blocksSelections = (blocksJson as { selections?: StatSelection[] }).selections ?? []

  const projectRebounds = (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) =>
    params.line <= 5
      ? projectMeanPoissonFromOverUnder(params)
      : projectMeanLogNormalFromOverUnder(params)

  const projectAssists = (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) =>
    params.line <= 5
      ? projectMeanPoissonFromOverUnder(params)
      : projectMeanLogNormalFromOverUnder(params)

  const computeFantasyPoints = (p: PlayerAccumulator): number | '' => {
    const projectedPoints = p.projected.Points
    const projectedRebounds = p.projected.Rebounds
    const projectedAssists = p.projected.Assists
    const projectedSteals = p.projected.Steals
    const projectedBlocks = p.projected.Blocks

    if (
      projectedPoints === undefined &&
      projectedRebounds === undefined &&
      projectedAssists === undefined &&
      projectedSteals === undefined &&
      projectedBlocks === undefined
    ) {
      return ''
    }

    const value =
      (projectedPoints ?? 0) +
      1.2 * (projectedRebounds ?? 0) +
      1.5 * (projectedAssists ?? 0) +
      3 * (projectedSteals ?? 0) +
      3 * (projectedBlocks ?? 0)

    return Math.round(value * 100) / 100
  }

  mergeSelections(map, 'Points', pointsSelections, projectMeanLogNormalFromOverUnder)
  mergeSelections(map, 'Rebounds', reboundsSelections, projectRebounds)
  mergeSelections(map, 'Assists', assistsSelections, projectAssists)
  mergeSelections(map, 'Steals', stealsSelections, projectMeanPoissonFromOverUnder)
  mergeSelections(map, 'Blocks', blocksSelections, projectMeanPoissonFromOverUnder)

  return [...map.values()]
    .filter((p) => p.name)
    .map((p) => {
      const fantasyPoints = computeFantasyPoints(p)
      const salary = salaryByName.get(normalizePlayerName(p.name))

      const valueNumber =
        typeof fantasyPoints === 'number' && typeof salary === 'number' && salary > 0
          ? Math.round(((fantasyPoints * 1000) / salary) * 100) / 100
          : null

      const row: Record<string, string | number> = {
        salary: salary ?? '',
        value: valueNumber ?? '',
        name: p.name,
        'Points:actual': p.lines.Points ?? '',
        'Points:over': p.overOdds.Points ?? '',
        'Points:under': p.underOdds.Points ?? '',
        'Points:proj': p.projected.Points ?? '',

        'Rebounds:actual': p.lines.Rebounds ?? '',
        'Rebounds:over': p.overOdds.Rebounds ?? '',
        'Rebounds:under': p.underOdds.Rebounds ?? '',
        'Rebounds:proj': p.projected.Rebounds ?? '',

        'Assists:actual': p.lines.Assists ?? '',
        'Assists:over': p.overOdds.Assists ?? '',
        'Assists:under': p.underOdds.Assists ?? '',
        'Assists:proj': p.projected.Assists ?? '',

        'Blocks:actual': p.lines.Blocks ?? '',
        'Blocks:over': p.overOdds.Blocks ?? '',
        'Blocks:under': p.underOdds.Blocks ?? '',
        'Blocks:proj': p.projected.Blocks ?? '',

        'Steals:actual': p.lines.Steals ?? '',
        'Steals:over': p.overOdds.Steals ?? '',
        'Steals:under': p.underOdds.Steals ?? '',
        'Steals:proj': p.projected.Steals ?? '',

        fantasyPoints,
      }

      return { row, valueSort: valueNumber ?? -Infinity }
    })
    .sort((a, b) => {
      if (b.valueSort !== a.valueSort) return b.valueSort - a.valueSort
      return String(a.row.name).localeCompare(String(b.row.name))
    })
    .map((x) => x.row)
}

const rows = buildRows()

export default function NbaFullRoster() {
  return (
    <div className="page">
      <header className="pageHeader">
        <h1>NBA / Full Roster</h1>
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
                      <td key={c.key}>{row[c.key] ?? ''}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
