import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './MlbFullRoster.css'
import singleGameSalariesJson from '../../sport/mlb/Type/single-game/salaries.json'
import { buildRows, HITTER_COLUMNS, type Row } from './MlbFullRoster'
import {
    optimizeMlbLineup,
    type LineupSlot,
    type OptimizedLineup,
    type MlbLineupPlayer,
} from '../../lib/mlbLineupOptimizer'

type Column = {
    key: keyof Row
    label: string
}

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
                            <th scope="col" key={String(c.key)}>
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
                                    <td
                                        key={String(c.key)}
                                        className={empty ? 'emptyCell' : undefined}
                                    >
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

type SingleGameSlotKey = 'MVP' | 'FLEX1' | 'FLEX2' | 'FLEX3' | 'FLEX4' | 'FLEX5'

const MLB_SINGLE_GAME_SLOTS: LineupSlot<SingleGameSlotKey>[] = [
    {
        key: 'MVP',
        label: 'MVP',
        isEligible: () => true,
        salaryMultiplier: 1.5,
        fantasyPointsMultiplier: 1.5,
    },
    { key: 'FLEX1', label: 'Flex', isEligible: () => true },
    { key: 'FLEX2', label: 'Flex', isEligible: () => true },
    { key: 'FLEX3', label: 'Flex', isEligible: () => true },
    { key: 'FLEX4', label: 'Flex', isEligible: () => true },
    { key: 'FLEX5', label: 'Flex', isEligible: () => true },
]

export default function MlbSingleGame() {
    const rows = useMemo(() => buildRows(singleGameSalariesJson), [])
    const hitters = rows.filter((r) => r.position !== 'P')

    const optimizerPlayers: MlbLineupPlayer[] = useMemo(() => {
        // Single Game page is hitters-only, and the optimizer should match.
        return hitters
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
    }, [hitters])

    const [optimalLineup, setOptimalLineup] = useState<OptimizedLineup<SingleGameSlotKey> | null>(
        null,
    )
    const [lineupStatus, setLineupStatus] = useState<'idle' | 'solving' | 'done' | 'error'>(
        'idle',
    )
    const [lineupError, setLineupError] = useState<string>('')

    useEffect(() => {
        let cancelled = false

        async function solve() {
            setLineupStatus('solving')
            setLineupError('')
            setOptimalLineup(null)

            try {
                const result = await optimizeMlbLineup({
                    players: optimizerPlayers,
                    salaryCap: 60_000,
                    slots: MLB_SINGLE_GAME_SLOTS,
                })

                if (cancelled) return

                if (!result) {
                    setLineupStatus('error')
                    setLineupError('No feasible lineup found.')
                    return
                }

                setOptimalLineup(result)
                setLineupStatus('done')
            } catch (err) {
                if (cancelled) return
                setLineupStatus('error')
                setLineupError(err instanceof Error ? err.message : 'Failed to solve lineup.')
            }
        }

        if (optimizerPlayers.length === 0) {
            setLineupStatus('error')
            setLineupError('No hitters have projections + salary available for optimization.')
            return () => {
                cancelled = true
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
                <h1>MLB Single Game</h1>
                <p>
                    <Link to="/">Back to Home</Link>
                </p>
            </header>

            <h2 className="sectionTitle">Hitters</h2>
            <DataTable rows={hitters} columns={HITTER_COLUMNS as Column[]} />

            <h2 className="sectionTitle">Optimal Lineup</h2>
            <p>Salary cap: $60,000 (MVP uses 1.5x salary and 1.5x fantasy points)</p>
            {lineupStatus === 'solving' ? (
                <p>Solving...</p>
            ) : lineupStatus === 'error' ? (
                <p>{lineupError}</p>
            ) : optimalLineup ? (
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
                            {MLB_SINGLE_GAME_SLOTS.map((slot) => {
                                const p = optimalLineup.playersBySlot[slot.key]
                                const salaryMult = slot.salaryMultiplier ?? 1
                                const pointsMult = slot.fantasyPointsMultiplier ?? 1

                                return (
                                    <tr key={slot.key}>
                                        <td>{slot.label}</td>
                                        <td>{p.name}</td>
                                        <td>{Math.round(p.salary * salaryMult)}</td>
                                        <td>{Math.round(p.fantasyPoints * pointsMult * 1000) / 1000}</td>
                                    </tr>
                                )
                            })}
                            <tr>
                                <td colSpan={2}>Total</td>
                                <td>{Math.round(optimalLineup.totalSalary)}</td>
                                <td>{Math.round(optimalLineup.totalFantasyPoints * 1000) / 1000}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    )
}
