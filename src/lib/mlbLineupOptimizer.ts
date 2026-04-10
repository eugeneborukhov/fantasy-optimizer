import GLPK from 'glpk.js'

export type MlbLineupPlayer = {
  id: string
  name: string
  positions: string[]
  salary: number
  fantasyPoints: number
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

export type MlbLineupSlot = {
  key: MlbLineupSlotKey
  label: string
  isEligible: (player: MlbLineupPlayer) => boolean
}

export type MlbOptimizedLineup = {
  playersBySlot: Record<MlbLineupSlotKey, MlbLineupPlayer>
  totalSalary: number
  totalFantasyPoints: number
}

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
    isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF']),
  },
  {
    key: 'OF2',
    label: 'OF',
    isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF']),
  },
  {
    key: 'OF3',
    label: 'OF',
    isEligible: (p) => !hasAnyPosition(p, ['P']) && hasAnyPosition(p, ['OF']),
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
}): Promise<MlbOptimizedLineup | null> {
  const { players, salaryCap } = params
  const slots = params.slots ?? MLB_DK_SLOTS

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

  type VarDef = { name: string; playerIndex: number; slotIndex: number }
  const vars: VarDef[] = []

  for (let si = 0; si < slots.length; si++) {
    for (let pi = 0; pi < usablePlayers.length; pi++) {
      if (!slots[si].isEligible(usablePlayers[pi])) continue
      vars.push({ name: `x_${pi}_${si}`, playerIndex: pi, slotIndex: si })
    }
  }

  if (vars.length === 0) return null

  const objectiveVars = vars.map((v) => ({
    name: v.name,
    coef: usablePlayers[v.playerIndex].fantasyPoints,
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
    vars: vars.map((v) => ({ name: v.name, coef: usablePlayers[v.playerIndex].salary })),
    bnds: { type: glpk.GLP_UP, lb: 0, ub: salaryCap },
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

  const picks: Record<MlbLineupSlotKey, MlbLineupPlayer> = {} as any

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

  const chosen = Object.values(picks)
  const totalSalary = chosen.reduce((sum, p) => sum + p.salary, 0)
  const totalFantasyPoints = chosen.reduce((sum, p) => sum + p.fantasyPoints, 0)

  return {
    playersBySlot: picks,
    totalSalary,
    totalFantasyPoints,
  }
}
