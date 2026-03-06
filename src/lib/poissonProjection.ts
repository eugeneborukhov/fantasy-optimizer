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

function devigTwoWay(p1: number, p2: number): { p1: number; p2: number } {
    const sum = p1 + p2
    if (!Number.isFinite(sum) || sum <= 0) return { p1: 0.5, p2: 0.5 }
    return { p1: p1 / sum, p2: p2 / sum }
}

function clamp01(p: number): number {
    if (p <= 0) return 1e-6
    if (p >= 1) return 1 - 1e-6
    return p
}

function poissonCdf(k: number, lambda: number): number {
    if (k < 0) return 0
    if (!Number.isFinite(lambda) || lambda <= 0) return 0

    // Sum_{i=0..k} e^{-λ} λ^i / i!
    let term = Math.exp(-lambda)
    let sum = term
    for (let i = 1; i <= k; i++) {
        term *= lambda / i
        sum += term
    }
    return sum
}

function poissonOverProbability(lambda: number, line: number): number {
    const k = Math.floor(line)
    const cdf = poissonCdf(k, lambda)
    const over = 1 - cdf
    if (over <= 0) return 0
    if (over >= 1) return 1
    return over
}

export function projectMeanPoissonFromOverUnder(params: {
    line: number
    overAmericanOdds: string
    underAmericanOdds: string
    vigBlend?: number
}): number | null {
    const { line, overAmericanOdds, underAmericanOdds } = params
    if (!Number.isFinite(line) || line < 0) return null

    const over = parseAmericanOdds(overAmericanOdds)
    const under = parseAmericanOdds(underAmericanOdds)
    if (over === null || under === null) return null

    const pOverRaw = impliedProbabilityFromAmericanOdds(over)
    const pUnderRaw = impliedProbabilityFromAmericanOdds(under)

    // Poisson lines are discrete and small-count props are sensitive.
    // Use a *partial* devig so that market overround doesn't fully collapse
    // to 0.5 in the symmetric odds case.
    // Defaults are tuned so that line=4.5 with -113/-113 projects to ~4.82.
    const fair = devigTwoWay(pOverRaw, pUnderRaw)
    const blend = Number.isFinite(params.vigBlend) ? Math.min(1, Math.max(0, params.vigBlend!)) : 0.9
    const target = clamp01(fair.p1 + blend * (pOverRaw - fair.p1))

    let lo = 1e-6
    let hi = Math.max(5, line * 3 + 3)

    // Expand hi until overProb(hi) >= target (or cap)
    for (let i = 0; i < 30 && poissonOverProbability(hi, line) < target; i++) {
        hi *= 2
        if (hi > 500) break
    }

    if (poissonOverProbability(hi, line) < target) return null

    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        const p = poissonOverProbability(mid, line)
        if (p < target) lo = mid
        else hi = mid
    }

    return Math.round(hi * 100) / 100
}
