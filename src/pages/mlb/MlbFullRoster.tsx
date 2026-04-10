import { Link } from 'react-router-dom'
import './MlbFullRoster.css'
import salariesJson from '../../sport/mlb/Type/full-roster/salaries.json'

const MLB_STAT_MODULES = import.meta.glob('../../sport/mlb/Type/stats/*.json', {
  eager: true,
})

function getMergedSelectionsForStatPrefix<TSelection>(prefix: string): TSelection[] {
  const normalizedPrefix = prefix.trim().toLowerCase()
  if (!normalizedPrefix) return []

  const merged: TSelection[] = []

  for (const [path, mod] of Object.entries(MLB_STAT_MODULES)) {
    const filename = path.split('/').pop()?.toLowerCase() ?? ''
    if (!filename.startsWith(normalizedPrefix)) continue

    const payload = (mod as any)?.default ?? mod
    const selections = (payload as any)?.selections
    if (Array.isArray(selections)) {
      merged.push(...(selections as TSelection[]))
    }
  }

  return merged
}

type SalaryEntry = {
  Id?: string
  Nickname?: string
  Salary?: number
  Position?: string
  FPPG?: string | number
}

type TotalBasesSelection = {
  label?: string
  milestoneValue?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    name?: string
    seoIdentifier?: string
  }>
  tags?: string[]
}

type TotalBasesInfo = {
  line: string
  threshold: number
  odds: string
  probabilityRaw: number
  preferred: boolean
}

type WalksSelection = {
  label?: string
  milestoneValue?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    name?: string
    seoIdentifier?: string
  }>
  tags?: string[]
}

type WalksInfo = {
  line: string
  threshold: number
  odds: string
  probabilityRaw: number
  preferred: boolean
}

type RunsSelection = {
  label?: string
  milestoneValue?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    name?: string
    seoIdentifier?: string
  }>
  tags?: string[]
}

type RunsInfo = {
  line: string
  threshold: number
  odds: string
  probabilityRaw: number
  preferred: boolean
}

type RbisSelection = {
  label?: string
  milestoneValue?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    name?: string
    seoIdentifier?: string
  }>
  tags?: string[]
}

type RbisInfo = {
  line: string
  threshold: number
  odds: string
  probabilityRaw: number
  preferred: boolean
}

type StolenBasesSelection = {
  label?: string
  milestoneValue?: number
  displayOdds?: {
    american?: string
  }
  participants?: Array<{
    name?: string
    seoIdentifier?: string
  }>
  tags?: string[]
}

type StolenBasesInfo = {
  line: string
  threshold: number
  odds: string
  probabilityRaw: number
  preferred: boolean
}

type Row = {
  key: string
  name: string
  position: string
  totalBases: string | ''
  totalBasesOdds: string
  projectedTotalBases: number | ''
  walks: string | ''
  walksOdds: string
  projectedWalks: number | ''
  runs: string | ''
  runsOdds: string
  projectedRuns: number | ''
  rbis: string | ''
  rbisOdds: string
  projectedRbis: number | ''
  stolenBases: string | ''
  stolenBasesOdds: string
  projectedStolenBases: number | ''
  fantasyPoints: number | ''
  salary: number | ''
  value: number | ''
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function normalizePlayerName(name: string): string {
  const cleaned = name
    .trim()
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

function parseAmericanOdds(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed
    .replaceAll('−', '-')
    .replaceAll('–', '-')
    .replaceAll('+', '')

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

function clampProbability(p: number): number {
  if (p <= 0) return 1e-9
  if (p >= 1) return 1 - 1e-9
  return p
}

function poissonPAtLeastK(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) return 0
  if (!Number.isFinite(k) || k <= 0) return 1

  // P(X >= k) = 1 - sum_{i=0}^{k-1} e^{-lambda} * lambda^i / i!
  let pmf = Math.exp(-lambda) // i = 0
  let cdf = pmf

  for (let i = 1; i <= k - 1; i++) {
    pmf = (pmf * lambda) / i
    cdf += pmf
  }

  const survival = 1 - cdf
  if (survival <= 0) return 0
  if (survival >= 1) return 1
  return survival
}

function invertPoissonMeanFromAtLeastK(pAtLeastK: number, k: number): number | null {
  if (!Number.isFinite(pAtLeastK) || !Number.isFinite(k) || k <= 0) return null

  const p = clampProbability(pAtLeastK)
  let lo = 0
  let hi = Math.max(1, k)

  // Expand upper bound until it brackets the target probability.
  for (let i = 0; i < 60 && poissonPAtLeastK(hi, k) < p; i++) {
    hi *= 2
    if (hi > 256) break
  }

  // Binary search for lambda.
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    const pmid = poissonPAtLeastK(mid, k)
    if (pmid < p) lo = mid
    else hi = mid
  }

  const lambda = (lo + hi) / 2
  return Number.isFinite(lambda) ? lambda : null
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

function parseFantasyPoints(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function computeHitterFantasyPoints(params: {
  projectedTotalBases: number
  projectedWalks: number
  projectedRuns: number
  projectedRbis: number
  projectedStolenBases: number
}): number {
  const {
    projectedTotalBases,
    projectedWalks,
    projectedRuns,
    projectedRbis,
    projectedStolenBases,
  } = params

  return (
    projectedTotalBases * 3 +
    projectedWalks * 3.2 +
    projectedRuns * 3 +
    projectedRbis * 3.5 +
    projectedStolenBases * 6
  )
}

function buildTotalBasesMap(): Map<string, TotalBasesInfo> {
  const selections = getMergedSelectionsForStatPrefix<TotalBasesSelection>('totalbases')
  const map = new Map<string, TotalBasesInfo>()

  for (const selection of selections) {
    const participant = selection?.participants?.[0]
    const participantName =
      (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
    if (!participantName) continue

    const odds = selection?.displayOdds?.american?.trim() ?? ''
    const parsed = odds ? parseAmericanOdds(odds) : null
    if (!odds || parsed === null) continue

    const probabilityRaw = impliedProbabilityFromAmericanOdds(parsed)
    const label = typeof selection?.label === 'string' ? selection.label.trim() : ''
    const milestone =
      typeof selection?.milestoneValue === 'number' ? selection.milestoneValue : null
    const line = label || (milestone !== null ? `${milestone}+` : '')
    if (!line) continue

    const threshold =
      milestone !== null
        ? milestone
        : (() => {
            const m = line.match(/(\d+)/)
            const n = m ? Number(m[1]) : NaN
            return Number.isFinite(n) ? n : NaN
          })()

    if (!Number.isFinite(threshold) || threshold <= 0) continue

    const preferred =
      selection?.tags?.includes('MostBalancedOdds') ||
      selection?.tags?.includes('MostBalancedGlobalProbability') ||
      false

    const key = normalizePlayerName(participantName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (preferred && !existing.preferred) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (!preferred && existing.preferred) continue

    // If multiple candidates exist, prefer the one closest to a 50/50 line (more "balanced"),
    // using higher probability as a fallback tie-break.
    const existingBalance = Math.abs(existing.probabilityRaw - 0.5)
    const incomingBalance = Math.abs(probabilityRaw - 0.5)

    if (incomingBalance < existingBalance) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (incomingBalance === existingBalance && probabilityRaw > existing.probabilityRaw) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
    }
  }

  return map
}

function buildWalksMap(): Map<string, WalksInfo> {
  const selections = getMergedSelectionsForStatPrefix<WalksSelection>('walks')
  const map = new Map<string, WalksInfo>()

  for (const selection of selections) {
    const participant = selection?.participants?.[0]
    const participantName =
      (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
    if (!participantName) continue

    const odds = selection?.displayOdds?.american?.trim() ?? ''
    const parsed = odds ? parseAmericanOdds(odds) : null
    if (!odds || parsed === null) continue

    const probabilityRaw = impliedProbabilityFromAmericanOdds(parsed)
    const label = typeof selection?.label === 'string' ? selection.label.trim() : ''
    const milestone =
      typeof selection?.milestoneValue === 'number' ? selection.milestoneValue : null
    const line = label || (milestone !== null ? `${milestone}+` : '')
    if (!line) continue

    const threshold =
      milestone !== null
        ? milestone
        : (() => {
            const m = line.match(/(\d+)/)
            const n = m ? Number(m[1]) : NaN
            return Number.isFinite(n) ? n : NaN
          })()

    if (!Number.isFinite(threshold) || threshold <= 0) continue

    const preferred =
      selection?.tags?.includes('MostBalancedOdds') ||
      selection?.tags?.includes('MostBalancedGlobalProbability') ||
      false

    const key = normalizePlayerName(participantName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (preferred && !existing.preferred) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (!preferred && existing.preferred) continue

    const existingBalance = Math.abs(existing.probabilityRaw - 0.5)
    const incomingBalance = Math.abs(probabilityRaw - 0.5)

    if (incomingBalance < existingBalance) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (incomingBalance === existingBalance && probabilityRaw > existing.probabilityRaw) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
    }
  }

  return map
}

function buildRunsMap(): Map<string, RunsInfo> {
  const selections = getMergedSelectionsForStatPrefix<RunsSelection>('runs')
  const map = new Map<string, RunsInfo>()

  for (const selection of selections) {
    const participant = selection?.participants?.[0]
    const participantName =
      (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
    if (!participantName) continue

    const odds = selection?.displayOdds?.american?.trim() ?? ''
    const parsed = odds ? parseAmericanOdds(odds) : null
    if (!odds || parsed === null) continue

    const probabilityRaw = impliedProbabilityFromAmericanOdds(parsed)
    const label = typeof selection?.label === 'string' ? selection.label.trim() : ''
    const milestone =
      typeof selection?.milestoneValue === 'number' ? selection.milestoneValue : null
    const line = label || (milestone !== null ? `${milestone}+` : '')
    if (!line) continue

    const threshold =
      milestone !== null
        ? milestone
        : (() => {
            const m = line.match(/(\d+)/)
            const n = m ? Number(m[1]) : NaN
            return Number.isFinite(n) ? n : NaN
          })()

    if (!Number.isFinite(threshold) || threshold <= 0) continue

    const preferred =
      selection?.tags?.includes('MostBalancedOdds') ||
      selection?.tags?.includes('MostBalancedGlobalProbability') ||
      false

    const key = normalizePlayerName(participantName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (preferred && !existing.preferred) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (!preferred && existing.preferred) continue

    const existingBalance = Math.abs(existing.probabilityRaw - 0.5)
    const incomingBalance = Math.abs(probabilityRaw - 0.5)

    if (incomingBalance < existingBalance) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (incomingBalance === existingBalance && probabilityRaw > existing.probabilityRaw) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
    }
  }

  return map
}

function buildRbisMap(): Map<string, RbisInfo> {
  const selections = getMergedSelectionsForStatPrefix<RbisSelection>('rbis')
  const map = new Map<string, RbisInfo>()

  for (const selection of selections) {
    const participant = selection?.participants?.[0]
    const participantName =
      (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
    if (!participantName) continue

    const odds = selection?.displayOdds?.american?.trim() ?? ''
    const parsed = odds ? parseAmericanOdds(odds) : null
    if (!odds || parsed === null) continue

    const probabilityRaw = impliedProbabilityFromAmericanOdds(parsed)
    const label = typeof selection?.label === 'string' ? selection.label.trim() : ''
    const milestone =
      typeof selection?.milestoneValue === 'number' ? selection.milestoneValue : null
    const line = label || (milestone !== null ? `${milestone}+` : '')
    if (!line) continue

    const threshold =
      milestone !== null
        ? milestone
        : (() => {
            const m = line.match(/(\d+)/)
            const n = m ? Number(m[1]) : NaN
            return Number.isFinite(n) ? n : NaN
          })()

    if (!Number.isFinite(threshold) || threshold <= 0) continue

    const preferred =
      selection?.tags?.includes('MostBalancedOdds') ||
      selection?.tags?.includes('MostBalancedGlobalProbability') ||
      false

    const key = normalizePlayerName(participantName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (preferred && !existing.preferred) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (!preferred && existing.preferred) continue

    const existingBalance = Math.abs(existing.probabilityRaw - 0.5)
    const incomingBalance = Math.abs(probabilityRaw - 0.5)

    if (incomingBalance < existingBalance) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (incomingBalance === existingBalance && probabilityRaw > existing.probabilityRaw) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
    }
  }

  return map
}

function buildStolenBasesMap(): Map<string, StolenBasesInfo> {
  const selections =
    getMergedSelectionsForStatPrefix<StolenBasesSelection>('stolenbases')
  const map = new Map<string, StolenBasesInfo>()

  for (const selection of selections) {
    const participant = selection?.participants?.[0]
    const participantName =
      (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
    if (!participantName) continue

    const odds = selection?.displayOdds?.american?.trim() ?? ''
    const parsed = odds ? parseAmericanOdds(odds) : null
    if (!odds || parsed === null) continue

    const probabilityRaw = impliedProbabilityFromAmericanOdds(parsed)
    const label = typeof selection?.label === 'string' ? selection.label.trim() : ''
    const milestone =
      typeof selection?.milestoneValue === 'number' ? selection.milestoneValue : null
    const line = label || (milestone !== null ? `${milestone}+` : '')
    if (!line) continue

    const threshold =
      milestone !== null
        ? milestone
        : (() => {
            const m = line.match(/(\d+)/)
            const n = m ? Number(m[1]) : NaN
            return Number.isFinite(n) ? n : NaN
          })()

    if (!Number.isFinite(threshold) || threshold <= 0) continue

    const preferred =
      selection?.tags?.includes('MostBalancedOdds') ||
      selection?.tags?.includes('MostBalancedGlobalProbability') ||
      false

    const key = normalizePlayerName(participantName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (preferred && !existing.preferred) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (!preferred && existing.preferred) continue

    const existingBalance = Math.abs(existing.probabilityRaw - 0.5)
    const incomingBalance = Math.abs(probabilityRaw - 0.5)

    if (incomingBalance < existingBalance) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
      continue
    }

    if (incomingBalance === existingBalance && probabilityRaw > existing.probabilityRaw) {
      map.set(key, { line, threshold, odds, probabilityRaw, preferred })
    }
  }

  return map
}

function buildRows(): Row[] {
  const salaryEntries = Array.isArray(salariesJson)
    ? (salariesJson as SalaryEntry[])
    : ([] as SalaryEntry[])

  const totalBasesByName = buildTotalBasesMap()
  const walksByName = buildWalksMap()
  const runsByName = buildRunsMap()
  const rbisByName = buildRbisMap()
  const stolenBasesByName = buildStolenBasesMap()

  const rows: Row[] = []

  for (const entry of salaryEntries) {
    const name = typeof entry?.Nickname === 'string' ? entry.Nickname.trim() : ''
    if (!name) continue

    const key = typeof entry?.Id === 'string' && entry.Id.trim() ? entry.Id.trim() : name

    const position = typeof entry?.Position === 'string' ? entry.Position : ''
    const salary = typeof entry?.Salary === 'number' ? entry.Salary : null
    const salaryFantasyPointsRaw = parseFantasyPoints(entry?.FPPG)

    const totalBasesInfo = totalBasesByName.get(normalizePlayerName(name))
    const totalBases = totalBasesInfo?.line ?? ''

    const projectedTotalBasesRaw =
      totalBasesInfo !== undefined
        ? invertPoissonMeanFromAtLeastK(totalBasesInfo.probabilityRaw, totalBasesInfo.threshold)
        : null
    const projectedTotalBases =
      projectedTotalBasesRaw !== null ? round3(projectedTotalBasesRaw) : ''

    const walksInfo = walksByName.get(normalizePlayerName(name))
    const walks = walksInfo?.line ?? ''
    const projectedWalksRaw =
      walksInfo !== undefined
        ? invertPoissonMeanFromAtLeastK(walksInfo.probabilityRaw, walksInfo.threshold)
        : null
    const projectedWalks = projectedWalksRaw !== null ? round3(projectedWalksRaw) : ''

    const runsInfo = runsByName.get(normalizePlayerName(name))
    const runs = runsInfo?.line ?? ''
    const projectedRunsRaw =
      runsInfo !== undefined
        ? invertPoissonMeanFromAtLeastK(runsInfo.probabilityRaw, runsInfo.threshold)
        : null
    const projectedRuns = projectedRunsRaw !== null ? round3(projectedRunsRaw) : ''

    const rbisInfo = rbisByName.get(normalizePlayerName(name))
    const rbis = rbisInfo?.line ?? ''
    const projectedRbisRaw =
      rbisInfo !== undefined
        ? invertPoissonMeanFromAtLeastK(rbisInfo.probabilityRaw, rbisInfo.threshold)
        : null
    const projectedRbis = projectedRbisRaw !== null ? round3(projectedRbisRaw) : ''

    const stolenBasesInfo = stolenBasesByName.get(normalizePlayerName(name))
    const stolenBases = stolenBasesInfo?.line ?? ''
    const projectedStolenBasesRaw =
      stolenBasesInfo !== undefined
        ? invertPoissonMeanFromAtLeastK(
            stolenBasesInfo.probabilityRaw,
            stolenBasesInfo.threshold,
          )
        : null
    const projectedStolenBases =
      projectedStolenBasesRaw !== null ? round3(projectedStolenBasesRaw) : ''

    const isPitcher = position === 'P'

    const fantasyPoints = isPitcher
      ? salaryFantasyPointsRaw !== null
        ? round3(salaryFantasyPointsRaw)
        : ''
      : typeof projectedTotalBases === 'number' &&
          typeof projectedWalks === 'number' &&
          typeof projectedRuns === 'number' &&
          typeof projectedRbis === 'number' &&
          typeof projectedStolenBases === 'number'
        ? round3(
            computeHitterFantasyPoints({
              projectedTotalBases,
              projectedWalks,
              projectedRuns,
              projectedRbis,
              projectedStolenBases,
            }),
          )
        : ''

    const value =
      typeof salary === 'number' && salary > 0 && typeof fantasyPoints === 'number'
        ? round6((fantasyPoints / salary) * 1000)
        : ''

    rows.push({
      key,
      name,
      position,
      totalBases,
      totalBasesOdds: totalBasesInfo?.odds ?? '',
      projectedTotalBases,
      walks,
      walksOdds: walksInfo?.odds ?? '',
      projectedWalks,
      runs,
      runsOdds: runsInfo?.odds ?? '',
      projectedRuns,
      rbis,
      rbisOdds: rbisInfo?.odds ?? '',
      projectedRbis,
      stolenBases,
      stolenBasesOdds: stolenBasesInfo?.odds ?? '',
      projectedStolenBases,
      fantasyPoints,
      salary: typeof salary === 'number' ? salary : '',
      value,
    })
  }

  return rows.sort((a, b) => {
    const aValueSort = typeof a.value === 'number' ? a.value : -Infinity
    const bValueSort = typeof b.value === 'number' ? b.value : -Infinity
    if (bValueSort !== aValueSort) return bValueSort - aValueSort

    const aSalarySort = typeof a.salary === 'number' ? a.salary : Infinity
    const bSalarySort = typeof b.salary === 'number' ? b.salary : Infinity
    if (aSalarySort !== bSalarySort) return aSalarySort - bSalarySort

    return a.name.localeCompare(b.name)
  })
}

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'position', label: 'Position' },
  { key: 'totalBases', label: 'Total Bases' },
  { key: 'totalBasesOdds', label: 'Total Bases Odds' },
  { key: 'projectedTotalBases', label: 'Projected Total Bases' },
  { key: 'walks', label: 'Walks' },
  { key: 'walksOdds', label: 'Odds' },
  { key: 'projectedWalks', label: 'Projected Walks' },
  { key: 'runs', label: 'Runs' },
  { key: 'runsOdds', label: 'Odds' },
  { key: 'projectedRuns', label: 'Projected Runs' },
  { key: 'rbis', label: 'RBIs' },
  { key: 'rbisOdds', label: 'Odds' },
  { key: 'projectedRbis', label: 'Projected RBIs' },
  { key: 'stolenBases', label: 'Stolen Bases' },
  { key: 'stolenBasesOdds', label: 'Odds' },
  { key: 'projectedStolenBases', label: 'Projected Stolen Bases' },
  { key: 'fantasyPoints', label: 'Fantasy Points' },
  { key: 'salary', label: 'Salary' },
  { key: 'value', label: 'Value' },
] as const

function DataTable({ rows }: { rows: Row[] }) {
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
              <td>{row.name}</td>
              <td>{row.position}</td>
              <td className={row.totalBases === '' ? 'emptyCell' : undefined}>
                {row.totalBases === '' ? '' : row.totalBases}
              </td>
              <td className={row.totalBasesOdds ? undefined : 'emptyCell'}>
                {row.totalBasesOdds}
              </td>
              <td className={row.projectedTotalBases === '' ? 'emptyCell' : undefined}>
                {row.projectedTotalBases === '' ? '' : row.projectedTotalBases}
              </td>
              <td className={row.walks === '' ? 'emptyCell' : undefined}>
                {row.walks === '' ? '' : row.walks}
              </td>
              <td className={row.walksOdds ? undefined : 'emptyCell'}>{row.walksOdds}</td>
              <td className={row.projectedWalks === '' ? 'emptyCell' : undefined}>
                {row.projectedWalks === '' ? '' : row.projectedWalks}
              </td>
              <td className={row.runs === '' ? 'emptyCell' : undefined}>
                {row.runs === '' ? '' : row.runs}
              </td>
              <td className={row.runsOdds ? undefined : 'emptyCell'}>{row.runsOdds}</td>
              <td className={row.projectedRuns === '' ? 'emptyCell' : undefined}>
                {row.projectedRuns === '' ? '' : row.projectedRuns}
              </td>
              <td className={row.rbis === '' ? 'emptyCell' : undefined}>
                {row.rbis === '' ? '' : row.rbis}
              </td>
              <td className={row.rbisOdds ? undefined : 'emptyCell'}>{row.rbisOdds}</td>
              <td className={row.projectedRbis === '' ? 'emptyCell' : undefined}>
                {row.projectedRbis === '' ? '' : row.projectedRbis}
              </td>
              <td className={row.stolenBases === '' ? 'emptyCell' : undefined}>
                {row.stolenBases === '' ? '' : row.stolenBases}
              </td>
              <td className={row.stolenBasesOdds ? undefined : 'emptyCell'}>
                {row.stolenBasesOdds}
              </td>
              <td className={row.projectedStolenBases === '' ? 'emptyCell' : undefined}>
                {row.projectedStolenBases === '' ? '' : row.projectedStolenBases}
              </td>
              <td className={row.fantasyPoints === '' ? 'emptyCell' : undefined}>
                {row.fantasyPoints === '' ? '' : row.fantasyPoints}
              </td>
              <td className={row.salary === '' ? 'emptyCell' : undefined}>
                {row.salary === '' ? '' : row.salary}
              </td>
              <td className={row.value === '' ? 'emptyCell' : undefined}>
                {row.value === '' ? '' : row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MlbFullRoster() {
  const rows = buildRows()
  const pitchers = rows.filter((r) => r.position === 'P')
  const hitters = rows.filter((r) => r.position !== 'P')

  return (
    <div>
      <header className="pageHeader">
        <h1>MLB Full Roster</h1>
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </header>

      <h2 className="sectionTitle">Hitters</h2>
      <DataTable rows={hitters} />

      <h2 className="sectionTitle">Pitchers</h2>
      <DataTable rows={pitchers} />
    </div>
  )
}
