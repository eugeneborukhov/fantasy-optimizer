import { Link } from 'react-router-dom'
import './NbaFullRoster.css'
import pointsJson from '../../sport/nba/type/single-game/stats/points.json'
import reboundsJson from '../../sport/nba/type/single-game/stats/rebounds.json'
import assistsJson from '../../sport/nba/type/single-game/stats/assists.json'
import stealsJson from '../../sport/nba/type/single-game/stats/steals.json'
import blocksJson from '../../sport/nba/type/single-game/stats/blocks.json'
import salariesJson from '../../sport/nba/type/single-game/salaries.json'
import { projectMeanPoissonFromOverUnder } from '../../lib/poissonProjection'
import { projectMeanTunedLogNormalFromOverUnder } from '../../lib/pointsProjection'

const STAT_GROUPS = ['Points', 'Rebounds', 'Assists', 'Blocks', 'Steals'] as const

type Column = {
    key: string
    label: string
}

function buildColumns(): Column[] {
    const columns: Column[] = []

    columns.push({ key: 'name', label: 'Name' })
    columns.push({ key: 'position', label: 'Position' })

    for (const stat of STAT_GROUPS) {
        columns.push({ key: `${stat}:actual`, label: stat })
        columns.push({ key: `${stat}:over`, label: 'Over' })
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
    milestoneValue?: number
    marketId?: string | number
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

function parseAmericanOdds(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = trimmed.replaceAll('−', '-').replaceAll('–', '-').replaceAll('+', '')
    const match = normalized.match(/-?\d+/)
    if (!match) return null
    const n = Number(match[0])
    return Number.isFinite(n) && n !== 0 ? n : null
}

function impliedProbabilityFromAmericanOdds(odds: number): number {
    if (odds < 0) {
        const a = Math.abs(odds)
        return a / (a + 100)
    }
    return 100 / (odds + 100)
}

function clamp01(p: number): number {
    if (p <= 0) return 1e-6
    if (p >= 1) return 1 - 1e-6
    return p
}

function americanOddsFromProbability(p: number): string {
    const pp = clamp01(p)
    if (pp >= 0.5) {
        const odds = -Math.round((100 * pp) / (1 - pp))
        return String(odds)
    }
    const odds = Math.round((100 * (1 - pp)) / pp)
    return `+${odds}`
}

type SalaryEntry = {
    Nickname?: string
    Salary?: number
    Position?: string
}

type SalaryInfo = {
    salary: number
    position: string
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

function buildSalaryMap(): Map<string, SalaryInfo> {
    const map = new Map<string, SalaryInfo>()
    const entries = Array.isArray(salariesJson) ? (salariesJson as SalaryEntry[]) : ([] as SalaryEntry[])

    for (const entry of entries) {
        const nickname = typeof entry?.Nickname === 'string' ? entry.Nickname : ''
        const salary = typeof entry?.Salary === 'number' ? entry.Salary : null
        if (!nickname || salary === null) continue

        const position = typeof entry?.Position === 'string' ? entry.Position : ''

        const key = normalizePlayerName(nickname)
        if (!key) continue
        if (!map.has(key)) map.set(key, { salary, position })
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

function mergeMilestoneSelections(
    map: Map<string, PlayerAccumulator>,
    stat: StatName,
    selections: StatSelection[],
    projector: (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) => number | null,
) {
    type Best = { milestone: number; american: string; p: number }

    const bestByPlayer = new Map<string, { name: string; best: Best | null }>()

    for (const selection of selections) {
        const milestone =
            typeof selection.milestoneValue === 'number'
                ? selection.milestoneValue
                : typeof selection.points === 'number'
                    ? selection.points
                    : null

        if (milestone === null) continue

        const american = formatAmericanOdds(selection.displayOdds?.american)
        if (!american) continue

        const parsedOdds = parseAmericanOdds(american)
        if (parsedOdds === null) continue
        const pOver = clamp01(impliedProbabilityFromAmericanOdds(parsedOdds))

        const participants = selection.participants ?? []
        if (participants.length === 0) continue

        for (const participant of participants) {
            const id = participant.id
            const playerId = id === undefined || id === null ? '' : String(id)
            if (!playerId) continue
            const playerName = participant.name ?? ''

            const existing = bestByPlayer.get(playerId)
            const currentBest = existing?.best
            const candidate: Best = { milestone, american, p: pOver }

            const isBetter =
                currentBest === null ||
                currentBest === undefined ||
                Math.abs(candidate.p - 0.5) < Math.abs(currentBest.p - 0.5)

            if (!existing) {
                bestByPlayer.set(playerId, { name: playerName, best: candidate })
            } else {
                if (!existing.name && playerName) existing.name = playerName
                if (isBetter) existing.best = candidate
            }
        }
    }

    for (const [playerId, entry] of bestByPlayer.entries()) {
        if (!entry.best) continue
        const player = getOrCreatePlayer(map, playerId, entry.name)

        const line = entry.best.milestone - 0.5
        const overOdds = entry.best.american
        const underOdds = americanOddsFromProbability(1 - entry.best.p)

        player.lines[stat] = line
        player.overOdds[stat] = overOdds
        player.underOdds[stat] = underOdds

        maybeProject(stat, player, projector)
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
        projectMeanTunedLogNormalFromOverUnder(params)

    const projectAssists = (params: { line: number; overAmericanOdds: string; underAmericanOdds: string }) =>
        params.line <= 4 ? projectMeanPoissonFromOverUnder(params) : projectMeanTunedLogNormalFromOverUnder(params)

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

        const assistsForTurnovers = projectedAssists ?? 0
        const estimatedTurnovers = assistsForTurnovers >= 5 ? assistsForTurnovers / 2.5 : assistsForTurnovers / 2.0

        // FanDuel NBA: -1 per turnover (estimated)
        const withTurnovers = value - estimatedTurnovers

        return Math.round(withTurnovers * 100) / 100
    }

    mergeMilestoneSelections(map, 'Points', pointsSelections, projectMeanTunedLogNormalFromOverUnder)
    mergeMilestoneSelections(map, 'Rebounds', reboundsSelections, projectRebounds)
    mergeMilestoneSelections(map, 'Assists', assistsSelections, projectAssists)
    mergeMilestoneSelections(map, 'Steals', stealsSelections, projectMeanPoissonFromOverUnder)
    mergeMilestoneSelections(map, 'Blocks', blocksSelections, projectMeanPoissonFromOverUnder)

    return [...map.values()]
        .filter((p) => p.name)
        .map((p) => {
            const fantasyPoints = computeFantasyPoints(p)
            const salaryInfo = salaryByName.get(normalizePlayerName(p.name))
            const salary = salaryInfo?.salary
            const position = salaryInfo?.position ?? ''

            const valueNumber =
                typeof fantasyPoints === 'number' && typeof salary === 'number' && salary > 0
                    ? Math.round(((fantasyPoints * 1000) / salary) * 100) / 100
                    : null

            const row: Record<string, string | number> = {
                position,
                salary: salary ?? '',
                value: valueNumber ?? '',
                name: p.name,
                'Points:actual': p.lines.Points ?? '',
                'Points:over': p.overOdds.Points ?? '',
                'Points:proj': p.projected.Points ?? '',

                'Rebounds:actual': p.lines.Rebounds ?? '',
                'Rebounds:over': p.overOdds.Rebounds ?? '',
                'Rebounds:proj': p.projected.Rebounds ?? '',

                'Assists:actual': p.lines.Assists ?? '',
                'Assists:over': p.overOdds.Assists ?? '',
                'Assists:proj': p.projected.Assists ?? '',

                'Blocks:actual': p.lines.Blocks ?? '',
                'Blocks:over': p.overOdds.Blocks ?? '',
                'Blocks:proj': p.projected.Blocks ?? '',

                'Steals:actual': p.lines.Steals ?? '',
                'Steals:over': p.overOdds.Steals ?? '',
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

type OptimalLineupRow = {
    name: string
    position: string
    salary: number | ''
    fantasyPoints: number | ''
    value: number | ''
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

type Candidate = {
    name: string
    salary: number
    fantasyPoints: number
}

type LineupResult = {
    rows: OptimalLineupRow[]
    totals: OptimalLineupRow
}

const SINGLE_GAME_ROSTER_SIZE = 6
const MVP_MULTIPLIER = 1.5

function pickSalaryUnitForMvp(salaries: number[]): number {
    if (salaries.length === 0) return 1

    const works = (unit: number) =>
        salaries.every((s) => s % unit === 0 && (s * 3) % (2 * unit) === 0)

    for (const unit of [100, 50, 25, 10, 5, 1]) {
        if (works(unit)) return unit
    }

    return 1
}

function orderSingleGameLineup(lineup: OptimalLineupRow[]): OptimalLineupRow[] {
    const copy = [...lineup]
    copy.sort((a, b) => {
        const aIsMvp = a.position === 'MVP' ? 1 : 0
        const bIsMvp = b.position === 'MVP' ? 1 : 0
        if (bIsMvp !== aIsMvp) return bIsMvp - aIsMvp
        return String(a.name).localeCompare(String(b.name))
    })
    return copy
}

function finalizeLineup(lineup: OptimalLineupRow[]): LineupResult {
    const orderedLineup = orderSingleGameLineup(lineup)

    while (orderedLineup.length < SINGLE_GAME_ROSTER_SIZE) {
        orderedLineup.push({ name: '', position: '', salary: '' as const, fantasyPoints: '' as const, value: '' as const })
    }

    const totalSalary = orderedLineup.reduce((sum, r) => sum + (typeof r.salary === 'number' ? r.salary : 0), 0)
    const totalFantasyPoints = orderedLineup.reduce(
        (sum, r) => sum + (typeof r.fantasyPoints === 'number' ? r.fantasyPoints : 0),
        0,
    )
    const totalValue: number | '' = totalSalary > 0 ? round2((totalFantasyPoints * 1000) / totalSalary) : ('' as const)

    return {
        rows: orderedLineup,
        totals: {
            name: 'TOTAL',
            position: '',
            salary: totalSalary > 0 ? totalSalary : ('' as const),
            fantasyPoints: totalFantasyPoints > 0 ? round2(totalFantasyPoints) : ('' as const),
            value: totalValue,
        },
    }
}

function buildTopTwoLineups(rows: Array<Record<string, string | number>>): { best: LineupResult; second: LineupResult } {
    const salaryCap = 60000

    const candidates: Candidate[] = rows
        .map((r) => {
            const name = typeof r.name === 'string' ? r.name : ''
            const salary = typeof r.salary === 'number' ? r.salary : null
            const fantasyPoints = typeof r.fantasyPoints === 'number' ? r.fantasyPoints : null

            if (!name || salary === null || fantasyPoints === null) return null
            if (salary <= 0 || salary > salaryCap) return null

            return { name, salary, fantasyPoints }
        })
        .filter((x): x is Candidate => x !== null)

    const unit = pickSalaryUnitForMvp(candidates.map((c) => c.salary))
    const capScaled = Math.floor(salaryCap / unit)

    const encodeState = (count: number, mvpUsed: 0 | 1) => count * 2 + mvpUsed
    const stateCount = (SINGLE_GAME_ROSTER_SIZE + 1) * 2
    const targetState = encodeState(SINGLE_GAME_ROSTER_SIZE, 1)

    const capPlusOne = capScaled + 1
    const cellCount = stateCount * capPlusOne
    const NEG_INF = -2147483648

    const bestScore = new Int32Array(cellCount)
    const secondScore = new Int32Array(cellCount)

    const bestPrev = new Int32Array(cellCount)
    const secondPrev = new Int32Array(cellCount)

    const bestPrevRank = new Int8Array(cellCount)
    const secondPrevRank = new Int8Array(cellCount)

    const bestChosenPlayer = new Int32Array(cellCount)
    const secondChosenPlayer = new Int32Array(cellCount)

    const bestChosenVariant = new Int8Array(cellCount)
    const secondChosenVariant = new Int8Array(cellCount)

    bestScore.fill(NEG_INF)
    secondScore.fill(NEG_INF)
    bestPrev.fill(-1)
    secondPrev.fill(-1)
    bestPrevRank.fill(-1)
    secondPrevRank.fill(-1)
    bestChosenPlayer.fill(-1)
    secondChosenPlayer.fill(-1)
    bestChosenVariant.fill(-1)
    secondChosenVariant.fill(-1)

    bestScore[encodeState(0, 0) * capPlusOne + 0] = 0

    const tryInsert = (cell: number, score: number, prevCell: number, prevRank: 0 | 1, playerIdx: number, variant: 0 | 1) => {
        const b = bestScore[cell]
        const s = secondScore[cell]

        if (score > b) {
            if (b > s) {
                secondScore[cell] = b
                secondPrev[cell] = bestPrev[cell]
                secondPrevRank[cell] = bestPrevRank[cell]
                secondChosenPlayer[cell] = bestChosenPlayer[cell]
                secondChosenVariant[cell] = bestChosenVariant[cell]
            }

            bestScore[cell] = score
            bestPrev[cell] = prevCell
            bestPrevRank[cell] = prevRank
            bestChosenPlayer[cell] = playerIdx
            bestChosenVariant[cell] = variant
            return
        }

        if (score < b && score > s) {
            secondScore[cell] = score
            secondPrev[cell] = prevCell
            secondPrevRank[cell] = prevRank
            secondChosenPlayer[cell] = playerIdx
            secondChosenVariant[cell] = variant
        }
    }

    for (let playerIdx = 0; playerIdx < candidates.length; playerIdx++) {
        const candidate = candidates[playerIdx]
        const normalCost = Math.round(candidate.salary / unit)
        const mvpCost = Math.round((candidate.salary * 3) / (2 * unit))
        if (normalCost <= 0) continue
        if (normalCost > capScaled) continue

        const fpUnits = Math.round(candidate.fantasyPoints * 100)
        if (!Number.isFinite(fpUnits)) continue

        const normalAdd = fpUnits * 2
        const mvpAdd = fpUnits * 3

        for (let used = capScaled; used >= 0; used--) {
            for (let count = SINGLE_GAME_ROSTER_SIZE - 1; count >= 0; count--) {
                for (let mvpUsed = 1 as 0 | 1; mvpUsed >= 0; mvpUsed = (mvpUsed - 1) as 0 | 1) {
                    const baseState = encodeState(count, mvpUsed)
                    const baseIdx = baseState * capPlusOne + used

                    for (let rank = 0 as 0 | 1; rank <= 1; rank = (rank + 1) as 0 | 1) {
                        const baseScoreValue = rank === 0 ? bestScore[baseIdx] : secondScore[baseIdx]
                        if (baseScoreValue === NEG_INF) continue

                        // Normal pick
                        if (used + normalCost <= capScaled) {
                            const nextState = encodeState(count + 1, mvpUsed)
                            const nextIdx = nextState * capPlusOne + (used + normalCost)
                            tryInsert(nextIdx, baseScoreValue + normalAdd, baseIdx, rank, playerIdx, 0)
                        }

                        // MVP pick (only if MVP not used yet)
                        if (mvpUsed === 0 && used + mvpCost <= capScaled) {
                            const nextState = encodeState(count + 1, 1)
                            const nextIdx = nextState * capPlusOne + (used + mvpCost)
                            tryInsert(nextIdx, baseScoreValue + mvpAdd, baseIdx, rank, playerIdx, 1)
                        }
                    }
                }
            }
        }
    }

    const bestPick = { score: NEG_INF, cell: -1, rank: 0 as 0 | 1 }
    const secondPick = { score: NEG_INF, cell: -1, rank: 0 as 0 | 1 }

    for (let used = 0; used <= capScaled; used++) {
        const cell = targetState * capPlusOne + used
        const scores: Array<{ score: number; rank: 0 | 1 }> = [
            { score: bestScore[cell], rank: 0 },
            { score: secondScore[cell], rank: 1 },
        ]

        for (const candidateScore of scores) {
            const score = candidateScore.score
            const rank = candidateScore.rank
            if (score === NEG_INF) continue

            if (score > bestPick.score) {
                if (score !== bestPick.score) {
                    secondPick.score = bestPick.score
                    secondPick.cell = bestPick.cell
                    secondPick.rank = bestPick.rank
                }
                bestPick.score = score
                bestPick.cell = cell
                bestPick.rank = rank
            } else if (score < bestPick.score && score > secondPick.score) {
                secondPick.score = score
                secondPick.cell = cell
                secondPick.rank = rank
            }
        }
    }

    const reconstruct = (cell: number, rank: 0 | 1): OptimalLineupRow[] => {
        const lineup: OptimalLineupRow[] = []
        if (cell < 0) return lineup

        let cursor = cell
        let cursorRank: 0 | 1 = rank

        while (cursor !== 0 && cursor >= 0) {
            const pIdx = cursorRank === 0 ? bestChosenPlayer[cursor] : secondChosenPlayer[cursor]
            const variant = cursorRank === 0 ? bestChosenVariant[cursor] : secondChosenVariant[cursor]
            if (pIdx < 0 || variant < 0) break

            const prevCell = cursorRank === 0 ? bestPrev[cursor] : secondPrev[cursor]
            const prevRankValue = cursorRank === 0 ? bestPrevRank[cursor] : secondPrevRank[cursor]
            const prevRank = (prevRankValue === 1 ? 1 : 0) as 0 | 1

            const c = candidates[pIdx]
            const isMvp = variant === 1
            const effectiveSalary = isMvp ? c.salary * MVP_MULTIPLIER : c.salary
            const effectiveFantasyPoints = isMvp ? c.fantasyPoints * MVP_MULTIPLIER : c.fantasyPoints
            const value = effectiveSalary > 0 ? round2((effectiveFantasyPoints * 1000) / effectiveSalary) : ('' as const)

            lineup.push({
                name: c.name,
                position: isMvp ? 'MVP' : '',
                salary: round2(effectiveSalary),
                fantasyPoints: round2(effectiveFantasyPoints),
                value: typeof value === 'number' ? value : ('' as const),
            })

            cursor = prevCell
            cursorRank = prevRank
        }

        lineup.reverse()
        return lineup
    }

    const bestLineup = bestPick.score === NEG_INF ? [] : reconstruct(bestPick.cell, bestPick.rank)
    const secondLineup = secondPick.score === NEG_INF ? [] : reconstruct(secondPick.cell, secondPick.rank)

    return {
        best: finalizeLineup(bestLineup),
        second: finalizeLineup(secondLineup),
    }
}

const lineups = buildTopTwoLineups(rows)
const optimal = lineups.best
const secondBest = lineups.second

export default function NbaSingleGame() {
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
                                            <td key={c.key}>{row[c.key] ?? ''}</td>
                                        ))}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>

                    <div className="lineupsRow">
                        <div className="lineupPanel">
                            <h2 className="sectionTitle">Optimal Lineup</h2>
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
                                        <td>{typeof optimal.totals.fantasyPoints === 'number' ? optimal.totals.fantasyPoints.toFixed(2) : optimal.totals.fantasyPoints}</td>
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
                                        <td>{typeof secondBest.totals.fantasyPoints === 'number' ? secondBest.totals.fantasyPoints.toFixed(2) : secondBest.totals.fantasyPoints}</td>
                                        <td>{secondBest.totals.value}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
