import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './MlbFullRoster.css'
import fullRosterSalariesJson from '../../sport/mlb/Type/full-roster/salaries.json'
import { projectMeanPoissonFromOverUnder } from '../../lib/poissonProjection'
import {
    optimizeMlbLineup,
    type MlbOptimizedLineup,
    type MlbLineupPlayer,
    MLB_DK_SLOTS,
} from '../../lib/mlbLineupOptimizer'

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
    Team?: string
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

type EarnedRunsSelection = {
    label?: string
    points?: number
    outcomeType?: string
    displayOdds?: {
        american?: string
    }
    participants?: Array<{
        name?: string
        seoIdentifier?: string
    }>
    tags?: string[]
}

type EarnedRunsInfo = {
    line: number
    overOdds: string
    underOdds: string
    odds: string
}

type OutsRecordedSelection = {
    label?: string
    points?: number
    outcomeType?: string
    displayOdds?: {
        american?: string
    }
    participants?: Array<{
        name?: string
        seoIdentifier?: string
    }>
    tags?: string[]
}

type OutsRecordedInfo = {
    line: number
    overOdds: string
    underOdds: string
    odds: string
}

type StrikeoutsSelection = {
    label?: string
    points?: number
    outcomeType?: string
    displayOdds?: {
        american?: string
    }
    participants?: Array<{
        name?: string
        seoIdentifier?: string
    }>
    tags?: string[]
}

type StrikeoutsInfo = {
    line: number
    overOdds: string
    underOdds: string
    odds: string
}

type WinsSelection = {
    label?: string
    outcomeType?: string
    displayOdds?: {
        american?: string
    }
    participants?: Array<{
        name?: string
        seoIdentifier?: string
    }>
}

type WinsInfo = {
    yesOdds: string
    noOdds: string
    yesProbabilityFair: number
}

export type Row = {
    key: string
    name: string
    position: string
    team: string
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
    earnedRuns: string | ''
    earnedRunsOdds: string
    projectedEarnedRuns: number | ''
    outsRecorded: string | ''
    outsRecordedOdds: string
    projectedOutsRecorded: number | ''
    strikeouts: string | ''
    strikeoutsOdds: string
    projectedStrikeouts: number | ''
    wins: string | ''
    winsOdds: string
    projectedWins: number | ''
    qualityStartProbability: string | ''
    fantasyPoints: number | ''
    salary: number | ''
    value: number | ''
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

type Column = {
    key: keyof Row
    label: string
}

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

function poissonCdfAtMostK(lambda: number, k: number): number {
    if (!Number.isFinite(lambda) || lambda < 0) return 0
    if (!Number.isFinite(k)) return 0
    if (k < 0) return 0

    // P(X <= k) = sum_{i=0}^{k} e^{-lambda} * lambda^i / i!
    let pmf = Math.exp(-lambda) // i = 0
    let cdf = pmf

    for (let i = 1; i <= k; i++) {
        pmf = (pmf * lambda) / i
        cdf += pmf
    }

    if (cdf <= 0) return 0
    if (cdf >= 1) return 1
    return cdf
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
        projectedWalks * 3 +
        projectedRuns * 3.2 +
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

function buildEarnedRunsMap(): Map<string, EarnedRunsInfo> {
    const selections = getMergedSelectionsForStatPrefix<EarnedRunsSelection>('earnedruns')
    type Group = {
        line: number
        overOdds: string
        underOdds: string
        hasOver: boolean
        hasUnder: boolean
        isMain: boolean
        pOverRaw: number
    }

    const byPlayer = new Map<string, Map<number, Group>>()

    for (const selection of selections) {
        const outcome = typeof selection?.outcomeType === 'string' ? selection.outcomeType : ''
        const outcomeNorm = outcome.trim().toLowerCase()
        if (outcomeNorm !== 'over' && outcomeNorm !== 'under') continue

        const line = typeof selection?.points === 'number' ? selection.points : null
        if (line === null || !Number.isFinite(line) || line < 0) continue

        const participant = selection?.participants?.[0]
        const participantName =
            (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
        if (!participantName) continue

        const odds = selection?.displayOdds?.american?.trim() ?? ''
        const parsed = odds ? parseAmericanOdds(odds) : null
        if (!odds || parsed === null) continue

        const key = normalizePlayerName(participantName)
        if (!key) continue

        const isMain = selection?.tags?.includes('MainPointLine') || false
        const pRaw = impliedProbabilityFromAmericanOdds(parsed)

        if (!byPlayer.has(key)) byPlayer.set(key, new Map())
        const byLine = byPlayer.get(key)!

        const existing = byLine.get(line)
        const group: Group = existing ?? {
            line,
            overOdds: '',
            underOdds: '',
            hasOver: false,
            hasUnder: false,
            isMain: false,
            pOverRaw: 0.5,
        }

        group.isMain = group.isMain || isMain

        if (outcomeNorm === 'over') {
            group.overOdds = odds
            group.hasOver = true
            group.pOverRaw = pRaw
        } else {
            group.underOdds = odds
            group.hasUnder = true
        }

        byLine.set(line, group)
    }

    const result = new Map<string, EarnedRunsInfo>()

    for (const [playerKey, byLine] of byPlayer.entries()) {
        const candidates = Array.from(byLine.values()).filter((g) => g.hasOver && g.hasUnder)
        if (candidates.length === 0) continue

        const mainCandidates = candidates.filter((c) => c.isMain)
        const pool = mainCandidates.length > 0 ? mainCandidates : candidates

        pool.sort((a, b) => {
            const aBalance = Math.abs(a.pOverRaw - 0.5)
            const bBalance = Math.abs(b.pOverRaw - 0.5)
            if (aBalance !== bBalance) return aBalance - bBalance
            return a.line - b.line
        })

        const best = pool[0]
        result.set(playerKey, {
            line: best.line,
            overOdds: best.overOdds,
            underOdds: best.underOdds,
            odds: `O ${best.overOdds} / U ${best.underOdds}`,
        })
    }

    return result
}

function buildOutsRecordedMap(): Map<string, OutsRecordedInfo> {
    const selections = getMergedSelectionsForStatPrefix<OutsRecordedSelection>('outsrecorded')
    type Group = {
        line: number
        overOdds: string
        underOdds: string
        hasOver: boolean
        hasUnder: boolean
        isMain: boolean
        pOverRaw: number
    }

    const byPlayer = new Map<string, Map<number, Group>>()

    for (const selection of selections) {
        const outcome = typeof selection?.outcomeType === 'string' ? selection.outcomeType : ''
        const outcomeNorm = outcome.trim().toLowerCase()
        if (outcomeNorm !== 'over' && outcomeNorm !== 'under') continue

        const line = typeof selection?.points === 'number' ? selection.points : null
        if (line === null || !Number.isFinite(line) || line < 0) continue

        const participant = selection?.participants?.[0]
        const participantName =
            (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
        if (!participantName) continue

        const odds = selection?.displayOdds?.american?.trim() ?? ''
        const parsed = odds ? parseAmericanOdds(odds) : null
        if (!odds || parsed === null) continue

        const key = normalizePlayerName(participantName)
        if (!key) continue

        const isMain = selection?.tags?.includes('MainPointLine') || false
        const pRaw = impliedProbabilityFromAmericanOdds(parsed)

        if (!byPlayer.has(key)) byPlayer.set(key, new Map())
        const byLine = byPlayer.get(key)!

        const existing = byLine.get(line)
        const group: Group = existing ?? {
            line,
            overOdds: '',
            underOdds: '',
            hasOver: false,
            hasUnder: false,
            isMain: false,
            pOverRaw: 0.5,
        }

        group.isMain = group.isMain || isMain

        if (outcomeNorm === 'over') {
            group.overOdds = odds
            group.hasOver = true
            group.pOverRaw = pRaw
        } else {
            group.underOdds = odds
            group.hasUnder = true
        }

        byLine.set(line, group)
    }

    const result = new Map<string, OutsRecordedInfo>()

    for (const [playerKey, byLine] of byPlayer.entries()) {
        const candidates = Array.from(byLine.values()).filter((g) => g.hasOver && g.hasUnder)
        if (candidates.length === 0) continue

        const mainCandidates = candidates.filter((c) => c.isMain)
        const pool = mainCandidates.length > 0 ? mainCandidates : candidates

        pool.sort((a, b) => {
            const aBalance = Math.abs(a.pOverRaw - 0.5)
            const bBalance = Math.abs(b.pOverRaw - 0.5)
            if (aBalance !== bBalance) return aBalance - bBalance
            return a.line - b.line
        })

        const best = pool[0]
        result.set(playerKey, {
            line: best.line,
            overOdds: best.overOdds,
            underOdds: best.underOdds,
            odds: `O ${best.overOdds} / U ${best.underOdds}`,
        })
    }

    return result
}

function buildStrikeoutsMap(): Map<string, StrikeoutsInfo> {
    const selections = getMergedSelectionsForStatPrefix<StrikeoutsSelection>('strikeouts')
    type Group = {
        line: number
        overOdds: string
        underOdds: string
        hasOver: boolean
        hasUnder: boolean
        isMain: boolean
        pOverRaw: number
    }

    const byPlayer = new Map<string, Map<number, Group>>()

    for (const selection of selections) {
        const outcome = typeof selection?.outcomeType === 'string' ? selection.outcomeType : ''
        const outcomeNorm = outcome.trim().toLowerCase()
        if (outcomeNorm !== 'over' && outcomeNorm !== 'under') continue

        const line = typeof selection?.points === 'number' ? selection.points : null
        if (line === null || !Number.isFinite(line) || line < 0) continue

        const participant = selection?.participants?.[0]
        const participantName =
            (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
        if (!participantName) continue

        const odds = selection?.displayOdds?.american?.trim() ?? ''
        const parsed = odds ? parseAmericanOdds(odds) : null
        if (!odds || parsed === null) continue

        const key = normalizePlayerName(participantName)
        if (!key) continue

        const isMain = selection?.tags?.includes('MainPointLine') || false
        const pRaw = impliedProbabilityFromAmericanOdds(parsed)

        if (!byPlayer.has(key)) byPlayer.set(key, new Map())
        const byLine = byPlayer.get(key)!

        const existing = byLine.get(line)
        const group: Group = existing ?? {
            line,
            overOdds: '',
            underOdds: '',
            hasOver: false,
            hasUnder: false,
            isMain: false,
            pOverRaw: 0.5,
        }

        group.isMain = group.isMain || isMain

        if (outcomeNorm === 'over') {
            group.overOdds = odds
            group.hasOver = true
            group.pOverRaw = pRaw
        } else {
            group.underOdds = odds
            group.hasUnder = true
        }

        byLine.set(line, group)
    }

    const result = new Map<string, StrikeoutsInfo>()

    for (const [playerKey, byLine] of byPlayer.entries()) {
        const candidates = Array.from(byLine.values()).filter((g) => g.hasOver && g.hasUnder)
        if (candidates.length === 0) continue

        const mainCandidates = candidates.filter((c) => c.isMain)
        const pool = mainCandidates.length > 0 ? mainCandidates : candidates

        pool.sort((a, b) => {
            const aBalance = Math.abs(a.pOverRaw - 0.5)
            const bBalance = Math.abs(b.pOverRaw - 0.5)
            if (aBalance !== bBalance) return aBalance - bBalance
            return a.line - b.line
        })

        const best = pool[0]
        result.set(playerKey, {
            line: best.line,
            overOdds: best.overOdds,
            underOdds: best.underOdds,
            odds: `O ${best.overOdds} / U ${best.underOdds}`,
        })
    }

    return result
}

function buildWinsMap(): Map<string, WinsInfo> {
    const selections = getMergedSelectionsForStatPrefix<WinsSelection>('wins')
    type Group = {
        yesOdds: string
        noOdds: string
        hasYes: boolean
        hasNo: boolean
        pYesRaw: number
        pNoRaw: number
    }

    const byPlayer = new Map<string, Map<string, Group>>()

    for (const selection of selections) {
        const outcome = typeof selection?.outcomeType === 'string' ? selection.outcomeType : ''
        const outcomeNorm = outcome.trim().toLowerCase()
        if (outcomeNorm !== 'yes' && outcomeNorm !== 'no') continue

        const participant = selection?.participants?.[0]
        const participantName =
            (participant?.seoIdentifier?.trim() || participant?.name?.trim()) ?? ''
        if (!participantName) continue

        const odds = selection?.displayOdds?.american?.trim() ?? ''
        const parsed = odds ? parseAmericanOdds(odds) : null
        if (!odds || parsed === null) continue

        const key = normalizePlayerName(participantName)
        if (!key) continue

        const marketId = typeof (selection as any)?.marketId === 'string' ? (selection as any).marketId : 'default'

        if (!byPlayer.has(key)) byPlayer.set(key, new Map())
        const byMarket = byPlayer.get(key)!

        const existing = byMarket.get(marketId)
        const group: Group = existing ?? {
            yesOdds: '',
            noOdds: '',
            hasYes: false,
            hasNo: false,
            pYesRaw: 0.5,
            pNoRaw: 0.5,
        }

        const pRaw = impliedProbabilityFromAmericanOdds(parsed)

        if (outcomeNorm === 'yes') {
            group.yesOdds = odds
            group.hasYes = true
            group.pYesRaw = pRaw
        } else {
            group.noOdds = odds
            group.hasNo = true
            group.pNoRaw = pRaw
        }

        byMarket.set(marketId, group)
    }

    const result = new Map<string, WinsInfo>()

    for (const [playerKey, byMarket] of byPlayer.entries()) {
        const candidates = Array.from(byMarket.values()).filter((g) => g.hasYes && g.hasNo)
        if (candidates.length === 0) continue

        candidates.sort((a, b) => {
            const aOverround = a.pYesRaw + a.pNoRaw
            const bOverround = b.pYesRaw + b.pNoRaw
            if (aOverround !== bOverround) return aOverround - bOverround
            return Math.abs(a.pYesRaw - 0.5) - Math.abs(b.pYesRaw - 0.5)
        })

        const best = candidates[0]
        const sum = best.pYesRaw + best.pNoRaw
        const yesProbabilityFair = sum > 0 ? best.pYesRaw / sum : 0.5

        result.set(playerKey, {
            yesOdds: best.yesOdds,
            noOdds: best.noOdds,
            yesProbabilityFair,
        })
    }

    return result
}

export function buildRows(salariesSource: unknown): Row[] {
    const salaryEntries = Array.isArray(salariesSource)
        ? (salariesSource as SalaryEntry[])
        : ([] as SalaryEntry[])

    const totalBasesByName = buildTotalBasesMap()
    const walksByName = buildWalksMap()
    const runsByName = buildRunsMap()
    const rbisByName = buildRbisMap()
    const stolenBasesByName = buildStolenBasesMap()
    const earnedRunsByName = buildEarnedRunsMap()
    const outsRecordedByName = buildOutsRecordedMap()
    const strikeoutsByName = buildStrikeoutsMap()
    const winsByName = buildWinsMap()

    const rows: Row[] = []

    for (const entry of salaryEntries) {
        const name = typeof entry?.Nickname === 'string' ? entry.Nickname.trim() : ''
        if (!name) continue

        const key = typeof entry?.Id === 'string' && entry.Id.trim() ? entry.Id.trim() : name

        const position = typeof entry?.Position === 'string' ? entry.Position : ''
        const team = typeof entry?.Team === 'string' ? entry.Team : ''
        const salary = typeof entry?.Salary === 'number' ? entry.Salary : null

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

        const earnedRunsInfo = earnedRunsByName.get(normalizePlayerName(name))
        const earnedRuns = earnedRunsInfo !== undefined ? String(earnedRunsInfo.line) : ''
        const projectedEarnedRunsRaw =
            earnedRunsInfo !== undefined
                ? projectMeanPoissonFromOverUnder({
                    line: earnedRunsInfo.line,
                    overAmericanOdds: earnedRunsInfo.overOdds,
                    underAmericanOdds: earnedRunsInfo.underOdds,
                })
                : null
        const projectedEarnedRuns = projectedEarnedRunsRaw !== null ? round3(projectedEarnedRunsRaw) : ''

        const outsRecordedInfo = outsRecordedByName.get(normalizePlayerName(name))
        const outsRecorded = outsRecordedInfo !== undefined ? String(outsRecordedInfo.line) : ''
        const projectedOutsRecordedRaw =
            outsRecordedInfo !== undefined
                ? projectMeanPoissonFromOverUnder({
                    line: outsRecordedInfo.line,
                    overAmericanOdds: outsRecordedInfo.overOdds,
                    underAmericanOdds: outsRecordedInfo.underOdds,
                })
                : null
        const projectedOutsRecorded =
            projectedOutsRecordedRaw !== null ? round3(projectedOutsRecordedRaw) : ''

        const strikeoutsInfo = strikeoutsByName.get(normalizePlayerName(name))
        const strikeouts = strikeoutsInfo !== undefined ? String(strikeoutsInfo.line) : ''
        const projectedStrikeoutsRaw =
            strikeoutsInfo !== undefined
                ? projectMeanPoissonFromOverUnder({
                    line: strikeoutsInfo.line,
                    overAmericanOdds: strikeoutsInfo.overOdds,
                    underAmericanOdds: strikeoutsInfo.underOdds,
                })
                : null
        const projectedStrikeouts =
            projectedStrikeoutsRaw !== null ? round3(projectedStrikeoutsRaw) : ''

        const winsInfo = winsByName.get(normalizePlayerName(name))
        const wins = winsInfo !== undefined ? 'Yes' : ''
        const winsOdds = winsInfo?.yesOdds ?? ''
        const projectedWins =
            winsInfo !== undefined ? round3(clampProbability(winsInfo.yesProbabilityFair)) : ''

        const isPitcher = position === 'P'

        const qualityStartProbabilityRaw =
            isPitcher &&
                typeof projectedOutsRecorded === 'number' &&
                typeof projectedEarnedRuns === 'number'
                ? clampProbability(
                    poissonPAtLeastK(projectedOutsRecorded, 18) *
                    poissonCdfAtMostK(projectedEarnedRuns, 3),
                )
                : 0

        const qualityStartProbability =
            isPitcher &&
                typeof projectedOutsRecorded === 'number' &&
                typeof projectedEarnedRuns === 'number'
                ? `${round3(qualityStartProbabilityRaw * 100)}%`
                : ''

        const projectedOutsRecordedValue =
            typeof projectedOutsRecorded === 'number' ? projectedOutsRecorded : 0
        const projectedEarnedRunsValue =
            typeof projectedEarnedRuns === 'number' ? projectedEarnedRuns : 0
        const projectedStrikeoutsValue =
            typeof projectedStrikeouts === 'number' ? projectedStrikeouts : 0
        const projectedWinsValue = typeof projectedWins === 'number' ? projectedWins : 0

        const fantasyPoints = isPitcher
            ? round3(
                projectedOutsRecordedValue * 1 -
                projectedEarnedRunsValue * 3 +
                qualityStartProbabilityRaw * 4 +
                projectedStrikeoutsValue * 1 +
                projectedWinsValue * 6,
            )
            : round3(
                computeHitterFantasyPoints({
                    projectedTotalBases:
                        typeof projectedTotalBases === 'number' ? projectedTotalBases : 0,
                    projectedWalks: typeof projectedWalks === 'number' ? projectedWalks : 0,
                    projectedRuns: typeof projectedRuns === 'number' ? projectedRuns : 0,
                    projectedRbis: typeof projectedRbis === 'number' ? projectedRbis : 0,
                    projectedStolenBases:
                        typeof projectedStolenBases === 'number' ? projectedStolenBases : 0,
                }),
            )

        const value =
            typeof salary === 'number' && salary > 0 && typeof fantasyPoints === 'number'
                ? round6((fantasyPoints / salary) * 1000)
                : ''

        rows.push({
            key,
            name,
            position,
            team,
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
            earnedRuns,
            earnedRunsOdds: earnedRunsInfo?.odds ?? '',
            projectedEarnedRuns,
            outsRecorded,
            outsRecordedOdds: outsRecordedInfo?.odds ?? '',
            projectedOutsRecorded,
            strikeouts,
            strikeoutsOdds: strikeoutsInfo?.odds ?? '',
            projectedStrikeouts,
            wins,
            winsOdds,
            projectedWins,
            qualityStartProbability,
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

export const HITTER_COLUMNS: Column[] = [
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
]

const PITCHER_COLUMNS: Column[] = [
    { key: 'name', label: 'Name' },
    { key: 'position', label: 'Position' },
    { key: 'earnedRuns', label: 'Earned Runs' },
    { key: 'earnedRunsOdds', label: 'Odds' },
    { key: 'projectedEarnedRuns', label: 'Projected Earned Runs' },
    { key: 'outsRecorded', label: 'Outs Recorded' },
    { key: 'outsRecordedOdds', label: 'Odds' },
    { key: 'projectedOutsRecorded', label: 'Projected Outs Recorded' },
    { key: 'strikeouts', label: 'Strikeouts' },
    { key: 'strikeoutsOdds', label: 'Odds' },
    { key: 'projectedStrikeouts', label: 'Projected Strikeouts' },
    { key: 'wins', label: 'Wins' },
    { key: 'winsOdds', label: 'Odds' },
    { key: 'projectedWins', label: 'Projected Wins' },
    { key: 'qualityStartProbability', label: 'Quality Start Probability' },
    { key: 'fantasyPoints', label: 'Fantasy Points' },
    { key: 'salary', label: 'Salary' },
    { key: 'value', label: 'Value' },
]

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

    const optimizerPlayers: MlbLineupPlayer[] = useMemo(() => {
        return rows
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
    }, [rows])

    const [optimalLineup, setOptimalLineup] = useState<MlbOptimizedLineup | null>(null)
    const [secondOptimalLineup, setSecondOptimalLineup] = useState<MlbOptimizedLineup | null>(null)
    const [lineupStatus, setLineupStatus] = useState<'idle' | 'solving' | 'done' | 'error'>('idle')
    const [lineupError, setLineupError] = useState<string>('')

    useEffect(() => {
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

        if (optimizerPlayers.length === 0) {
            setLineupStatus('error')
            setLineupError('No players have projections + salary available for optimization.')
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
            {lineupStatus === 'solving' ? (
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
        </div>
    )
}
