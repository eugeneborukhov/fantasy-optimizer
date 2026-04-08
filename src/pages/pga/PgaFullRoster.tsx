import { Link } from 'react-router-dom'
import './PgaFullRoster.css'
import statsJson from '../../sport/pga/stats.json'
import salariesJson from '../../sport/pga/salaries.json'

type Market = {
  id?: string | number
  name?: string
}

type Selection = {
  marketId?: string | number
  label?: string
  displayOdds?: {
    fractional?: string
  }
}

type SalaryEntry = {
  Nickname?: string
  Salary?: number
}

type Row = {
  name: string
  odds: string
  probability: number | ''
  probabilityRaw: number | null
  salary: number | ''
  value: number | ''
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function normalizePlayerName(name: string): string {
  let preNormalized = name.trim()

  // Exceptions for mismatched salary vs. stats feeds
  if (/^haotong\s+li$/i.test(preNormalized)) preNormalized = 'Hao-Tong Li'
  if (/^matt\s+mccarty$/i.test(preNormalized)) preNormalized = 'Matthew McCarty'
  if (/^nico\s+echavarria$/i.test(preNormalized))
    preNormalized = 'Nicolas Echavarria'
  if (/^pongsapak\s+laopakdee$/i.test(preNormalized))
    preNormalized = 'Fifa Laopakdee'
  if (/^sung\s*[-]?\s*jae\s+im$/i.test(preNormalized))
    preNormalized = 'Sungjae Im'

  const cleaned = preNormalized
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
  const entries = Array.isArray(salariesJson)
    ? (salariesJson as SalaryEntry[])
    : ([] as SalaryEntry[])

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

function parseFractionalOdds(value: string): { a: number; b: number } | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed.replace(/\s+/g, '')
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)$/)
  if (!match) return null

  const a = Number(match[1])
  const b = Number(match[2])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= 0) return null

  return { a, b }
}

function impliedProbabilityFromFractionalOdds(fractional: string): number | null {
  const parsed = parseFractionalOdds(fractional)
  if (!parsed) return null
  const { a, b } = parsed
  const denom = a + b
  if (denom <= 0) return null
  const p = b / denom
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  return p
}

function americanOddsFromFractionalOdds(fractional: string): string {
  const parsed = parseFractionalOdds(fractional)
  if (!parsed) return ''

  const { a, b } = parsed
  const decimal = 1 + a / b
  const net = decimal - 1
  if (!Number.isFinite(net) || net <= 0) return ''

  // American odds conversion:
  // - For favorites (decimal < 2): -100 / (decimal - 1)
  // - For underdogs (decimal >= 2): +100 * (decimal - 1)
  if (decimal >= 2) {
    const odds = Math.round(net * 100)
    return `+${odds}`
  }

  const odds = -Math.round(100 / net)
  return String(odds)
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function round8(n: number): number {
  return Math.round(n * 100000000) / 100000000
}

function buildRows(): Row[] {
  const markets = (statsJson as { markets?: Market[] }).markets ?? []
  const selections = (statsJson as { selections?: Selection[] }).selections ?? []

  const market = markets.find((m) => m?.name === 'Top 10 (Including Ties)')
  const marketId = market?.id
  const marketIdStr = marketId === undefined || marketId === null ? '' : String(marketId)

  const salaryByName = buildSalaryMap()

  const rows: Row[] = []

  for (const selection of selections) {
    const selectionMarketId =
      selection?.marketId === undefined || selection?.marketId === null
        ? ''
        : String(selection.marketId)

    if (!marketIdStr || selectionMarketId !== marketIdStr) continue

    const name = selection?.label?.trim() ?? ''
    if (!name) continue

    const fractionalOdds = selection?.displayOdds?.fractional?.trim() ?? ''
    const odds = fractionalOdds ? americanOddsFromFractionalOdds(fractionalOdds) : ''

    const parsedAmerican = odds ? parseAmericanOdds(odds) : null
    const probabilityRaw =
      parsedAmerican !== null
        ? impliedProbabilityFromAmericanOdds(parsedAmerican)
        : fractionalOdds
          ? impliedProbabilityFromFractionalOdds(fractionalOdds)
          : null

    const probability = probabilityRaw !== null ? round4(probabilityRaw) : ''

    const salary = salaryByName.get(normalizePlayerName(name))

    const value =
      probabilityRaw !== null && typeof salary === 'number' && salary > 0
        ? round8((probabilityRaw / salary) * 100000)
        : ''

    rows.push({
      name,
      odds,
      probability,
      probabilityRaw,
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

type LineupEntry = {
  name: string
  salary: number
  probability: number
  odds: string
}

type LineupResult = {
  key: string
  entries: LineupEntry[]
  totalSalary: number
  totalProbability: number
}

type KState = {
  value: number
  key: string
  prev: KState | null
  index: number
}

function insertStateTopK(
  states: KState[],
  incoming: KState,
  k: number,
): KState[] {
  const existingIndex = states.findIndex((s) => s.key === incoming.key)
  if (existingIndex >= 0) {
    if (incoming.value <= states[existingIndex].value) return states
    const copy = states.slice()
    copy[existingIndex] = incoming
    copy.sort((a, b) => b.value - a.value)
    if (copy.length > k) copy.length = k
    return copy
  }

  if (states.length < k) {
    const copy = states.concat(incoming)
    copy.sort((a, b) => b.value - a.value)
    return copy
  }

  const worst = states[states.length - 1]
  if (incoming.value <= worst.value) return states

  const copy = states.slice(0, states.length - 1).concat(incoming)
  copy.sort((a, b) => b.value - a.value)
  return copy
}

function buildTopLineups(
  allRows: Row[],
  lineupSize: number,
  maxSalary: number,
  k: number,
): LineupResult[] {
  const candidates: LineupEntry[] = allRows
    .filter(
      (r) =>
        typeof r.salary === 'number' &&
        r.salary > 0 &&
        r.probabilityRaw !== null &&
        r.probabilityRaw > 0 &&
        r.probabilityRaw < 1,
    )
    .map((r) => ({
      name: r.name,
      salary: r.salary as number,
      probability: r.probabilityRaw as number,
      odds: r.odds,
    }))

  if (candidates.length < lineupSize) return []

  // dp[count] = Map<salarySum, topKStates>
  const dp: Array<Map<number, KState[]>> = Array.from(
    { length: lineupSize + 1 },
    () => new Map(),
  )

  dp[0].set(0, [{ value: 0, key: '', prev: null, index: -1 }])

  for (let i = 0; i < candidates.length; i++) {
    const player = candidates[i]
    for (let count = lineupSize - 1; count >= 0; count--) {
      for (const [salarySum, states] of dp[count].entries()) {
        const newSalary = salarySum + player.salary
        if (newSalary > maxSalary) continue

        for (const state of states) {
          const newValue = state.value + player.probability
          const newKey = state.key ? `${state.key},${i}` : String(i)
          const nextState: KState = {
            value: newValue,
            key: newKey,
            prev: state.index === -1 ? null : state,
            index: i,
          }

          const existingList = dp[count + 1].get(newSalary) ?? []
          const updated = insertStateTopK(existingList, nextState, k)
          if (updated !== existingList) dp[count + 1].set(newSalary, updated)
          else if (!dp[count + 1].has(newSalary)) dp[count + 1].set(newSalary, existingList)
        }
      }
    }
  }

  const allResults: LineupResult[] = []
  for (const [salarySum, states] of dp[lineupSize].entries()) {
    for (const state of states) {
      if (!state.key) continue
      const indices = state.key.split(',').map((s) => Number(s))
      if (indices.length !== lineupSize || indices.some((n) => !Number.isFinite(n))) continue

      const entries = indices
        .map((idx) => candidates[idx])
        .filter(Boolean) as LineupEntry[]

      if (entries.length !== lineupSize) continue

      allResults.push({
        key: state.key,
        entries,
        totalSalary: salarySum,
        totalProbability: state.value,
      })
    }
  }

  // Sort for display: highest totalProbability first, then higher salary (closer to cap).
  allResults.sort((a, b) => {
    if (b.totalProbability !== a.totalProbability) return b.totalProbability - a.totalProbability
    return b.totalSalary - a.totalSalary
  })

  const unique: LineupResult[] = []
  const seen = new Set<string>()
  for (const r of allResults) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    unique.push(r)
    if (unique.length >= k) break
  }

  return unique
}

const rows = buildRows()
const topLineups = buildTopLineups(rows, 6, 60000, 30)

export default function PgaFullRoster() {
  return (
    <div>
      <header className="pageHeader">
        <h1>PGA / Full Roster</h1>
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </header>

      <div className="tableWrap">
        <h2>Top 30 Lineups (6 golfers, max $60,000)</h2>
        {topLineups.length > 0 ? (
          <table className="dataTable">
            <thead>
              <tr>
                <th scope="col">Lineup</th>
                <th scope="col">Golfers</th>
                <th scope="col">Total Probability</th>
                <th scope="col">Total Salary</th>
              </tr>
            </thead>
            <tbody>
              {topLineups.map((l, idx) => (
                <tr key={l.key}>
                  <td>{idx + 1}</td>
                  <td>{l.entries.map((p) => p.name).join(', ')}</td>
                  <td>{round4(l.totalProbability)}</td>
                  <td>{l.totalSalary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Unable to compute lineups from the available data.</p>
        )}
      </div>

      <div className="tableWrap">
        <table className="dataTable">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Odds of Finishing Top 10</th>
              <th scope="col">Probability</th>
              <th scope="col">Salary</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.odds}</td>
                <td>{r.probability}</td>
                <td>{r.salary}</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
