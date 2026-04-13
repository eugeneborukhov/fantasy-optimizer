import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './MlbFullRoster.css'
import fullRosterSalariesJson from '../../sport/mlb/Type/full-roster/salaries.json'
import { buildRows, HITTER_COLUMNS, PITCHER_COLUMNS, type Column, type Row } from './mlbRows'
import {
    optimizeMlbLineup,
    type MlbOptimizedLineup,
    type MlbLineupPlayer,
    MLB_DK_SLOTS,
} from '../../lib/mlbLineupOptimizer'

function DataTable({ rows, columns }: { rows: Row[]; columns: Column[] }) {
    function cellValue(row: Row, key: keyof Row): string | number {
        const value = row[key] as unknown
        return typeof value === 'number' || typeof value === 'string' ? value : ''
    }

    return (
        <div className="tableWrap">
            <table className="dataTable">
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th scope="col" key={c.key}>
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.key}>
                            {columns.map((c) => {
                                const v = cellValue(row, c.key)
                                const empty = v === ''
                                return (
                                    <td key={String(c.key)} className={empty ? 'emptyCell' : undefined}>
                                        {empty ? '' : v}
                                    </td>
                                )
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function parseEligiblePositions(position: string): string[] {
    return position
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean)
}

export default function MlbFullRoster() {
    const rows = useMemo(() => buildRows(fullRosterSalariesJson), [])
    const pitchers = rows.filter((r) => r.position === 'P')
    const hitters = rows.filter((r) => r.position !== 'P')

    const games = useMemo(() => {
        const set = new Set<string>()
        for (const r of rows) {
            const g = typeof r.game === 'string' ? r.game.trim() : ''
            if (g) set.add(g)
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [rows])

    const [excludedGames, setExcludedGames] = useState<string[]>([])
    const excludedGamesSet = useMemo(() => new Set(excludedGames), [excludedGames])

    const optimizerPlayers: MlbLineupPlayer[] = useMemo(() => {
        return rows
            .filter((r) => !excludedGamesSet.has(r.game))
            .map((r) => {
                if (typeof r.salary !== 'number' || r.salary <= 0) return null
                if (typeof r.fantasyPoints !== 'number') return null
                return {
                    id: r.key,
                    name: r.name,
                    positions: parseEligiblePositions(r.position),
                    salary: r.salary,
                    fantasyPoints: r.fantasyPoints,
                    team: r.team,
                } satisfies MlbLineupPlayer
            })
            .filter(Boolean) as MlbLineupPlayer[]
    }, [rows, excludedGamesSet])

    const [optimalLineup, setOptimalLineup] = useState<MlbOptimizedLineup | null>(null)
    const [secondOptimalLineup, setSecondOptimalLineup] = useState<MlbOptimizedLineup | null>(null)
    const [lineupStatus, setLineupStatus] = useState<'idle' | 'solving' | 'done' | 'error'>('idle')
    const [lineupError, setLineupError] = useState<string>('')

    useEffect(() => {
        if (optimizerPlayers.length === 0) return
        let cancelled = false

        async function solve() {
            setLineupStatus('solving')
            setLineupError('')
            setOptimalLineup(null)
            setSecondOptimalLineup(null)

            try {
                const result = await optimizeMlbLineup({
                    players: optimizerPlayers,
                    salaryCap: 35_000,
                    slots: MLB_DK_SLOTS,
                    maxPlayersPerTeamByPositions: {
                        maxPlayersPerTeam: 4,
                        positions: ['2B', 'SS', '1B', 'C', 'CF', 'RF', 'OF', 'LF', '3B'],
                    },
                })

                if (cancelled) return

                if (!result) {
                    setLineupStatus('error')
                    setLineupError('No feasible lineup found.')
                    return
                }

                const bestPlayerIds = Array.from(
                    new Set(Object.values(result.playersBySlot).map((p) => p.id)),
                )

                const second = await optimizeMlbLineup({
                    players: optimizerPlayers,
                    salaryCap: 35_000,
                    slots: MLB_DK_SLOTS,
                    excludeLineupsByPlayerIds: [bestPlayerIds],
                    maxPlayersPerTeamByPositions: {
                        maxPlayersPerTeam: 4,
                        positions: ['2B', 'SS', '1B', 'C', 'CF', 'RF', 'OF', 'LF', '3B'],
                    },
                })

                setOptimalLineup(result)
                setSecondOptimalLineup(second)
                setLineupStatus('done')
            } catch (err) {
                if (cancelled) return
                setLineupStatus('error')
                setLineupError(err instanceof Error ? err.message : 'Failed to solve lineup.')
            }
        }

        solve()

        return () => {
            cancelled = true
        }
    }, [optimizerPlayers])

    return (
        <div>
            <header className="pageHeader">
                <h1>MLB Full Roster</h1>
                <p>
                    <Link to="/">Back to Home</Link>
                </p>
            </header>

            <h2 className="sectionTitle">Hitters</h2>
            <DataTable rows={hitters} columns={HITTER_COLUMNS} />

            <h2 className="sectionTitle">Pitchers</h2>
            <DataTable rows={pitchers} columns={PITCHER_COLUMNS} />

            <h2 className="sectionTitle">Optimal Lineup</h2>
            <p>Salary cap: $35,000</p>
            {optimizerPlayers.length === 0 ? (
                <p>No players available for optimization (check exclusions, projections, and salary).</p>
            ) : lineupStatus === 'solving' ? (
                <p>Solving...</p>
            ) : lineupStatus === 'error' ? (
                <p>{lineupError}</p>
            ) : optimalLineup ? (
                <>
                    <div className="tableWrap">
                        <table className="dataTable">
                            <thead>
                                <tr>
                                    <th scope="col">Slot</th>
                                    <th scope="col">Name</th>
                                    <th scope="col">Salary</th>
                                    <th scope="col">Fantasy Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {MLB_DK_SLOTS.map((slot) => {
                                    const p = optimalLineup.playersBySlot[slot.key]
                                    return (
                                        <tr key={slot.key}>
                                            <td>{slot.label}</td>
                                            <td>{p.name}</td>
                                            <td>{p.salary}</td>
                                            <td>{Math.round(p.fantasyPoints * 1000) / 1000}</td>
                                        </tr>
                                    )
                                })}
                                <tr>
                                    <td colSpan={2}>Total</td>
                                    <td>{optimalLineup.totalSalary}</td>
                                    <td>{Math.round(optimalLineup.totalFantasyPoints * 1000) / 1000}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <h2 className="sectionTitle">2nd Optimal Lineup</h2>
                    {secondOptimalLineup ? (
                        <div className="tableWrap">
                            <table className="dataTable">
                                <thead>
                                    <tr>
                                        <th scope="col">Slot</th>
                                        <th scope="col">Name</th>
                                        <th scope="col">Salary</th>
                                        <th scope="col">Fantasy Points</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {MLB_DK_SLOTS.map((slot) => {
                                        const p = secondOptimalLineup.playersBySlot[slot.key]
                                        return (
                                            <tr key={slot.key}>
                                                <td>{slot.label}</td>
                                                <td>{p.name}</td>
                                                <td>{p.salary}</td>
                                                <td>{Math.round(p.fantasyPoints * 1000) / 1000}</td>
                                            </tr>
                                        )
                                    })}
                                    <tr>
                                        <td colSpan={2}>Total</td>
                                        <td>{secondOptimalLineup.totalSalary}</td>
                                        <td>{Math.round(secondOptimalLineup.totalFantasyPoints * 1000) / 1000}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p>No 2nd-best distinct lineup found.</p>
                    )}
                </>
            ) : null}

            <h2 className="sectionTitle">Exclude Game(s)</h2>
            {games.length === 0 ? (
                <p>No games found.</p>
            ) : (
                <div className="excludeGamesWrap">
                    <div className="excludeGamesList">
                        {games.map((game) => (
                            <label key={game} className="excludeGameItem">
                                <input
                                    type="checkbox"
                                    checked={excludedGamesSet.has(game)}
                                    onChange={(e) => {
                                        const checked = e.currentTarget.checked
                                        setExcludedGames((prev) => {
                                            const next = new Set(prev)
                                            if (checked) next.add(game)
                                            else next.delete(game)
                                            return Array.from(next)
                                        })
                                    }}
                                />
                                <span>{game}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
