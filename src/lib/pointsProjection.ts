function parseAmericanOdds(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null

    // Sportsbooks sometimes use U+2212 (minus) instead of ASCII '-'
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
    if (!Number.isFinite(sum) || sum <= 0) {
        return { p1: 0.5, p2: 0.5 }
    }
    return { p1: p1 / sum, p2: p2 / sum }
}

function clamp01(p: number): number {
    if (p <= 0) return 1e-6
    if (p >= 1) return 1 - 1e-6
    return p
}

// Peter John Acklam's approximation for inverse normal CDF
function normalInv(p: number): number {
    const a = [
        -3.969683028665376e1,
        2.209460984245205e2,
        -2.759285104469687e2,
        1.38357751867269e2,
        -3.066479806614716e1,
        2.506628277459239,
    ]
    const b = [
        -5.447609879822406e1,
        1.615858368580409e2,
        -1.556989798598866e2,
        6.680131188771972e1,
        -1.328068155288572e1,
    ]
    const c = [
        -7.784894002430293e-3,
        -3.223964580411365e-1,
        -2.400758277161838,
        -2.549732539343734,
        4.374664141464968,
        2.938163982698783,
    ]
    const d = [
        7.784695709041462e-3,
        3.224671290700398e-1,
        2.445134137142996,
        3.754408661907416,
    ]

    const plow = 0.02425
    const phigh = 1 - plow

    const pp = clamp01(p)

    if (pp < plow) {
        const q = Math.sqrt(-2 * Math.log(pp))
        return (
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        )
    }

    if (pp > phigh) {
        const q = Math.sqrt(-2 * Math.log(1 - pp))
        return -(
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        )
    }

    const q = pp - 0.5
    const r = q * q
    return (
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    )
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}

function tunedTargetMeanFromLineAndOverOdds(line: number, overOdds: number): number {
    // Calibration anchored to -113 examples:
    // - 13.5 @ -113 -> 14.25
    // - 26.5 @ -113 -> 27.75
    const baseP = impliedProbabilityFromAmericanOdds(-113)
    const pOver = impliedProbabilityFromAmericanOdds(overOdds)
    const oddsMultiplier = pOver / baseP

    const baseAdjustment = (line + 6) / 26
    return line + baseAdjustment * oddsMultiplier
}

export function projectMeanTunedLogNormalFromOverUnder(params: {
    line: number
    overAmericanOdds: string
    underAmericanOdds: string
}): number | null {
    const { line, overAmericanOdds, underAmericanOdds } = params
    if (!Number.isFinite(line) || line <= 0) return null

    const over = parseAmericanOdds(overAmericanOdds)
    const under = parseAmericanOdds(underAmericanOdds)
    if (over === null || under === null) return null

    const pOverRaw = impliedProbabilityFromAmericanOdds(over)
    const pUnderRaw = impliedProbabilityFromAmericanOdds(under)
    const fair = devigTwoWay(pOverRaw, pUnderRaw)
    const pOverFair = clamp01(fair.p1)

    const targetMean = tunedTargetMeanFromLineAndOverOdds(line, over)
    const ratio = targetMean / line
    if (!Number.isFinite(ratio) || ratio <= 0) return null

    // Choose sigma so that both are true:
    // 1) P(X > line) = pOverFair
    // 2) E[X] = targetMean
    // For X ~ LogNormal(mu, sigma):
    // mean = line * exp(-sigma*z + 0.5*sigma^2), where z = Φ^{-1}(1 - pOverFair)
    const z = normalInv(1 - pOverFair)
    const lnRatio = Math.log(ratio)
    const disc = z * z + 2 * lnRatio
    if (!Number.isFinite(disc) || disc < 0) return null

    const sigma = z + Math.sqrt(disc)
    if (!Number.isFinite(sigma) || sigma <= 0) return null

    const mu = Math.log(line) - sigma * z
    const mean = Math.exp(mu + 0.5 * sigma * sigma)

    return round2(mean)
}

export function projectMeanTunedPoissonFromOverUnder(params: {
    line: number
    overAmericanOdds: string
    underAmericanOdds: string
}): number | null {
    const { line, overAmericanOdds } = params
    if (!Number.isFinite(line) || line < 0) return null

    const over = parseAmericanOdds(overAmericanOdds)
    if (over === null) return null

    const mean = tunedTargetMeanFromLineAndOverOdds(line, over)
    return round2(mean)
}

/**
 * Points props are ingested as milestone selections (e.g. "14+") and then converted
 * to a half-point line (e.g. 13.5). This projector is tuned so that:
 * - line 13.5 at -113 -> 14.25
 * - line 26.5 at -113 -> 27.75
 */
export function projectMeanPointsFromLine(params: {
    line: number
    overAmericanOdds: string
    underAmericanOdds: string
}): number | null {
    return projectMeanTunedLogNormalFromOverUnder(params)
}
