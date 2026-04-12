import GLPK from 'glpk.js'

export type MlbLineupPlayer = {
    id: string
    name: string
    positions: string[]
    salary: number
    fantasyPoints: number
    /** Optional team code used for stacking/limit constraints (e.g. "LAD"). */
    team?: string
}

export type MlbLineupSlotKey =
    | 'P'
    | 'C1B'
    | '2B'
    | '3B'
    | 'SS'
    | 'OF1'
    | 'OF2'
    | 'OF3'
    | 'UTIL'

export type LineupSlot<Key extends string = string> = {
    key: Key
    label: string
    isEligible: (player: MlbLineupPlayer) => boolean
    /** Multiplies the player's salary for cap + totals in this slot. */
    salaryMultiplier?: number
    /** Multiplies the player's fantasy points in this slot (objective + totals). */
    fantasyPointsMultiplier?: number
}

export type OptimizedLineup<Key extends string = string> = {
    playersBySlot: Record<Key, MlbLineupPlayer>
    /** Sum of (salary * slot.salaryMultiplier). */
    totalSalary: number
    /** Sum of (fantasyPoints * slot.fantasyPointsMultiplier). */
    totalFantasyPoints: number
}

export type MlbLineupSlot = LineupSlot<MlbLineupSlotKey>
export type MlbOptimizedLineup = OptimizedLineup<MlbLineupSlotKey>

function hasAnyPosition(player: MlbLineupPlayer, positions: string[]): boolean {
    const eligible = new Set(player.positions.map((p) => p.trim().toUpperCase()).filter(Boolean))
    return positions.some((p) => eligible.has(p.trim().toUpperCase()))
}

export const MLB_DK_SLOTS: MlbLineupSlot[] = [
    {
        key: 'P',
        label: 'P',
        isEligible: (p) => hasAnyPosition(p, ['P']),
    },
    {
        key: 'C1B',
        label: 'C/1B',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['C', '1B']),
    },
    {
        key: '2B',
        label: '2B',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['2B']),
    },
    {
        key: '3B',
        label: '3B',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['3B']),
    },
    {
        key: 'SS',
        label: 'SS',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['SS']),
    },
    {
        key: 'OF1',
        label: 'OF',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF', 'CF', 'RF', 'LF']),
    },
    {
        key: 'OF2',
        label: 'OF',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF', 'CF', 'RF', 'LF']),
    },
    {
        key: 'OF3',
        label: 'OF',
        isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF', 'CF', 'RF', 'LF']),
    },
    {
        key: 'UTIL',
        label: 'Util',
        isEligible: (p) => !hasAnyPosition(p, ['P']),
    },
]

export async function optimizeMlbLineup(params: {
    players: MlbLineupPlayer[]
    salaryCap: number
    slots?: MlbLineupSlot[]
    /**
     * Optional restriction: for each team, count selected players whose eligible positions intersect `positions`
     * and constrain that count to be <= `maxPlayersPerTeam`.
     */
    maxPlayersPerTeamByPositions?: { maxPlayersPerTeam: number; positions: string[] }
    /**
     * Excludes lineups that match the exact set of player ids (order/slot doesn't matter).
     * Each entry adds a constraint: "pick at most N-1 of these N players".
     */
    excludeLineupsByPlayerIds?: string[][]
}): Promise<MlbOptimizedLineup | null>
export async function optimizeMlbLineup<Key extends string>(params: {
    players: MlbLineupPlayer[]
    salaryCap: number
    slots: LineupSlot<Key>[]
    /**
     * Optional restriction: for each team, count selected players whose eligible positions intersect `positions`
     * and constrain that count to be <= `maxPlayersPerTeam`.
     */
    maxPlayersPerTeamByPositions?: { maxPlayersPerTeam: number; positions: string[] }
    /**
     * Excludes lineups that match the exact set of player ids (order/slot doesn't matter).
     * Each entry adds a constraint: "pick at most N-1 of these N players".
     */
    excludeLineupsByPlayerIds?: string[][]
}): Promise<OptimizedLineup<Key> | null>
export async function optimizeMlbLineup<Key extends string>(params: {
    players: MlbLineupPlayer[]
    salaryCap: number
    slots?: LineupSlot<Key>[]
    maxPlayersPerTeamByPositions?: { maxPlayersPerTeam: number; positions: string[] }
    excludeLineupsByPlayerIds?: string[][]
}): Promise<OptimizedLineup<Key> | null> {
    const { players, salaryCap } = params
    const slots = (params.slots ?? (MLB_DK_SLOTS as unknown as LineupSlot<Key>[]))
    const maxPlayersPerTeamByPositions = params.maxPlayersPerTeamByPositions
    const excludeLineupsByPlayerIds = params.excludeLineupsByPlayerIds ?? []

    const usablePlayers = players.filter(
        (p) =>
            p.id &&
            p.name &&
            Number.isFinite(p.salary) &&
            p.salary > 0 &&
            Number.isFinite(p.fantasyPoints),
    )

    if (usablePlayers.length === 0) return null

    const glpk = await GLPK()

    const idToPlayerIndex = new Map<string, number>()
    for (let i = 0; i < usablePlayers.length; i++) idToPlayerIndex.set(usablePlayers[i].id, i)

    type VarDef = { name: string; playerIndex: number; slotIndex: number }
    const vars: VarDef[] = []

    for (let si = 0; si < slots.length; si++) {
        for (let pi = 0; pi < usablePlayers.length; pi++) {
            if (!slots[si].isEligible(usablePlayers[pi])) continue
            vars.push({ name: `x_${pi}_${si}`, playerIndex: pi, slotIndex: si })
        }
    }

    if (vars.length === 0) return null

    const varsByPlayerIndex = new Map<number, { name: string; coef: number }[]>()
    for (const v of vars) {
        const arr = varsByPlayerIndex.get(v.playerIndex) ?? []
        arr.push({ name: v.name, coef: 1 })
        varsByPlayerIndex.set(v.playerIndex, arr)
    }

    function sanitizeConstraintName(value: string): string {
        return value
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24)
    }

    const objectiveVars = vars.map((v) => ({
        name: v.name,
        coef:
            usablePlayers[v.playerIndex].fantasyPoints *
            (slots[v.slotIndex].fantasyPointsMultiplier ?? 1),
    }))

    const bounds = vars.map((v) => ({
        name: v.name,
        type: glpk.GLP_DB,
        lb: 0,
        ub: 1,
    }))

    const binaries = vars.map((v) => v.name)

    const subjectTo: any[] = []

    // Slot fill constraints
    for (let si = 0; si < slots.length; si++) {
        const slotVars = vars
            .filter((v) => v.slotIndex === si)
            .map((v) => ({ name: v.name, coef: 1 }))

        if (slotVars.length === 0) {
            throw new Error(`No eligible players for slot ${slots[si].label}.`)
        }

        subjectTo.push({
            name: `slot_${slots[si].key}`,
            vars: slotVars,
            bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 },
        })
    }

    // Player uniqueness constraints
    for (let pi = 0; pi < usablePlayers.length; pi++) {
        const playerVars = vars
            .filter((v) => v.playerIndex === pi)
            .map((v) => ({ name: v.name, coef: 1 }))
        if (playerVars.length === 0) continue

        subjectTo.push({
            name: `player_${pi}`,
            vars: playerVars,
            bnds: { type: glpk.GLP_UP, lb: 0, ub: 1 },
        })
    }

    // Salary cap
    subjectTo.push({
        name: 'salary_cap',
        vars: vars.map((v) => ({
            name: v.name,
            coef: usablePlayers[v.playerIndex].salary * (slots[v.slotIndex].salaryMultiplier ?? 1),
        })),
        bnds: { type: glpk.GLP_UP, lb: 0, ub: salaryCap },
    })

    // Per-team max constraint for a set of positions
    if (
        maxPlayersPerTeamByPositions &&
        Number.isFinite(maxPlayersPerTeamByPositions.maxPlayersPerTeam) &&
        maxPlayersPerTeamByPositions.maxPlayersPerTeam >= 0 &&
        Array.isArray(maxPlayersPerTeamByPositions.positions) &&
        maxPlayersPerTeamByPositions.positions.length > 0
    ) {
        const positions = maxPlayersPerTeamByPositions.positions
        const maxPerTeam = maxPlayersPerTeamByPositions.maxPlayersPerTeam
        const teamToPlayerIndexes = new Map<string, number[]>()

        for (let pi = 0; pi < usablePlayers.length; pi++) {
            const teamRaw = usablePlayers[pi].team
            const team = typeof teamRaw === 'string' ? teamRaw.trim().toUpperCase() : ''
            if (!team) continue
            if (!hasAnyPosition(usablePlayers[pi], positions)) continue
            const arr = teamToPlayerIndexes.get(team) ?? []
            arr.push(pi)
            teamToPlayerIndexes.set(team, arr)
        }

        let teamConstraintIdx = 0
        for (const [team, playerIndexes] of teamToPlayerIndexes.entries()) {
            const constraintVars = playerIndexes.flatMap((pi) => varsByPlayerIndex.get(pi) ?? [])
            if (constraintVars.length === 0) continue
            subjectTo.push({
                name: `team_${sanitizeConstraintName(team)}_${teamConstraintIdx++}`,
                vars: constraintVars,
                bnds: { type: glpk.GLP_UP, lb: 0, ub: maxPerTeam },
            })
        }
    }

    // Exclude exact player sets ("not the same 9 players")
    excludeLineupsByPlayerIds.forEach((ids, idx) => {
        const playerIndexes = Array.from(
            new Set(
                ids
                    .map((id) => idToPlayerIndex.get(id))
                    .filter((pi): pi is number => typeof pi === 'number'),
            ),
        )

        if (playerIndexes.length === 0) return

        const constraintVars = playerIndexes.flatMap((pi) => varsByPlayerIndex.get(pi) ?? [])
        if (constraintVars.length === 0) return

        // If a lineup picks all N of these players, it would have LHS=N. Force LHS <= N-1.
        subjectTo.push({
            name: `exclude_lineup_${idx}`,
            vars: constraintVars,
            bnds: { type: glpk.GLP_UP, lb: 0, ub: playerIndexes.length - 1 },
        })
    })

    const lp = {
        name: 'mlb_lineup',
        objective: {
            direction: glpk.GLP_MAX,
            name: 'obj',
            vars: objectiveVars,
        },
        subjectTo,
        bounds,
        binaries,
    }

    // In the web-worker build of glpk.js, `solve` is async.
    // In the non-worker build it can be sync; `await` works for both.
    const raw = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF })

    const solution = ((raw as any)?.result ?? raw) as any
    const status: unknown = solution?.status
    const values: Record<string, number> = (solution?.vars ?? {}) as Record<string, number>

    // If we can detect an infeasible status, report it clearly.
    const statusNumber = typeof status === 'number' ? status : null
    if (
        statusNumber !== null &&
        statusNumber !== glpk.GLP_OPT &&
        statusNumber !== glpk.GLP_FEAS
    ) {
        throw new Error(`Lineup solve failed (status ${statusNumber}).`)
    }

    const picks: Record<Key, MlbLineupPlayer> = {} as any

    for (const v of vars) {
        const val = values[v.name]
        if (typeof val !== 'number' || val < 0.5) continue
        const slotKey = slots[v.slotIndex].key
        picks[slotKey] = usablePlayers[v.playerIndex]
    }

    // Ensure every slot filled
    for (const slot of slots) {
        if (!picks[slot.key]) {
            throw new Error(`No player selected for slot ${slot.label}.`)
        }
    }

    let totalSalary = 0
    let totalFantasyPoints = 0
    for (const slot of slots) {
        const p = picks[slot.key]
        totalSalary += p.salary * (slot.salaryMultiplier ?? 1)
        totalFantasyPoints += p.fantasyPoints * (slot.fantasyPointsMultiplier ?? 1)
    }

    return {
        playersBySlot: picks,
        totalSalary,
        totalFantasyPoints,
    }
}
