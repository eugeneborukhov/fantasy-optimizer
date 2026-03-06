import React, { useEffect, useState } from 'react';
import './App.css';
import pointsData from './stats/points.json';
import reboundsData from './stats/rebounds.json';
import assistsData from './stats/assists.json';
import blocksData from './stats/blocks.json';
import stealsData from './stats/steals.json';
import { getGameByNickname, getPositionByNickname, getSalaryByNickname } from './salaryUtils';

/**
 * Estimates statistical projection from a line and American odds.
 *
 * We interpret the odds as vig-included implied probability of the event being
 * equal-or-over the line (e.g. "18+" means X >= 18). For half lines (e.g. 21.5),
 * this corresponds to X >= ceil(21.5) = 22.
 *
 * We model the stat as a Poisson random variable X with mean λ and solve for λ such that:
 *   P(X >= ceil(line)) = impliedProbability(americanOdds)
 *
 * @param {number} line - The prop line (whole or half)
 * @param {number|string} americanOdds - American odds (e.g., -110, +150)
 * @returns {object|null} Statistical projection details
 */
function getStatisticalProjection(line, americanOdds) {
  const impliedProb = americanOddsToImpliedProbability(americanOdds);
  if (!Number.isFinite(line) || !Number.isFinite(impliedProb)) return null;
  if (impliedProb <= 0 || impliedProb >= 1) return null;

  const kMin = Math.max(0, Math.ceil(line));

  // Poisson CDF computed iteratively to avoid factorial overflow.
  function poissonCDF(lambda, kMax) {
    if (kMax < 0) return 0;
    let term = Math.exp(-lambda); // k=0
    let sum = term;
    for (let k = 1; k <= kMax; k++) {
      term *= lambda / k;
      sum += term;
    }
    return sum;
  }

  function probEqualOrOver(lambda) {
    if (kMin === 0) return 1;
    return 1 - poissonCDF(lambda, kMin - 1);
  }

  // Binary search for λ
  let low = 0;
  let high = Math.max(10, kMin * 2);
  while (probEqualOrOver(high) < impliedProb && high < 1000) {
    high *= 2;
  }

  const iterations = 30;
  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2;
    if (probEqualOrOver(mid) < impliedProb) low = mid;
    else high = mid;
  }

  const finalMean = (low + high) / 2;

  // Not a push anymore, but keeping the field for backwards compatibility.
  // This is the probability of landing exactly on ceil(line).
  const cdfAtK = poissonCDF(finalMean, kMin);
  const cdfAtKMinus1 = kMin - 1 >= 0 ? poissonCDF(finalMean, kMin - 1) : 0;
  const pExactAtKMin = kMin === 0 ? 0 : Math.max(0, cdfAtK - cdfAtKMinus1);

  return {
    projectedMean: finalMean.toFixed(2),
    chanceOfPush: (pExactAtKMin * 100).toFixed(2) + "%",
    fairWinProbability: (impliedProb * 100).toFixed(2) + "%"
  };
}

// // Example usage:
// const result = getStatisticalProjection(5, 150);
// console.log(result);
// /* Output: {
//   projectedMean: "4.74", 
//   chanceOfPush: "17.45%", 
//   fairWinProbability: "38.10%" 
// }
// */


function getProjectedStat(lineValue, oddsValue) {
  const lineNum = Number(lineValue);
  const oddsNum = Number(oddsValue);
  if (!Number.isFinite(lineNum) || !Number.isFinite(oddsNum)) return null;
  if (oddsNum === 0) return null;

  const result = getStatisticalProjection(lineNum, oddsNum);

  // Support both return styles:
  // - number (older implementation)
  // - object with { projectedMean: "4.74", ... } (current implementation)
  const projectedMean =
    typeof result === 'number'
      ? result
      : result && typeof result === 'object' && 'projectedMean' in result
        ? Number(result.projectedMean)
        : NaN;

  return Number.isFinite(projectedMean) ? projectedMean : null;
}


// Returns a 9-player lineup maximizing fantasy points under the salary cap,
// with roster constraints: 1 C, 2 PF, 2 SF, 2 SG, 2 PG.
// Multi-position strings like "PG/SG" count as eligible for either slot.
function getOptimalLineup(
  players,
  reboundsMap,
  assistsMap,
  blocksMap,
  stealsMap,
  getSalaryByNickname,
  maxCount = 9,
  maxSalary = 60000,
  excludedIds = new Set()
) {
  const required = { C: 1, PF: 2, SF: 2, SG: 2, PG: 2 };
  const posOrder = ['C', 'PF', 'SF', 'SG', 'PG'];
  const totalRequired = posOrder.reduce((sum, p) => sum + required[p], 0);
  if (maxCount !== totalRequired) {
    maxCount = totalRequired;
  }

  const positionSet = new Set(posOrder);
  const normalizePositions = (positionStr) => {
    if (!positionStr) return [];
    return String(positionStr)
      .split(/[\/,]/)
      .map((p) => p.trim())
      .filter((p) => positionSet.has(p));
  };

  const playerObjs = players
    .map((p) => {
      const reboundsObj = reboundsMap.get(p.id) || {};
      const assistsObj = assistsMap.get(p.id) || {};
      const blocksObj = blocksMap.get(p.id) || {};
      const stealsObj = stealsMap.get(p.id) || {};

      const projectedPoints = getProjectedStat(p.points, p.oddsValue);
      const projectedRebounds = getProjectedStat(reboundsObj.rebounds, reboundsObj.oddsValue);
      const projectedAssists = getProjectedStat(assistsObj.assists, assistsObj.oddsValue);
      const projectedBlocks = getProjectedStat(blocksObj.blocks, blocksObj.oddsValue);
      const projectedSteals = getProjectedStat(stealsObj.steals, stealsObj.oddsValue);

      const pointsVal = projectedPoints ?? 0;
      const reboundsVal = projectedRebounds ?? 0;
      const assistsVal = projectedAssists ?? 0;
      const blocksVal = projectedBlocks ?? 0;
      const stealsVal = projectedSteals ?? 0;

      const salary = Number(getSalaryByNickname(p.name)) || 0;
      const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.0 * assistsVal + 3 * blocksVal + 3 * stealsVal;
      const positionStr = getPositionByNickname(p.name);
      const eligiblePositions = normalizePositions(positionStr);
      return {
        id: p.id,
        name: p.name,
        salary,
        fantasyPoints,
        position: positionStr,
        eligiblePositions
      };
    })
    .filter((p) => p.salary > 0 && p.eligiblePositions.length > 0 && !excludedIds.has(p.id));

  if (playerObjs.length < maxCount) return [];

  // Encode counts into a compact state integer using mixed radix:
  // C:0-1 (base2), others:0-2 (base3).
  const base = { C: 2, PF: 3, SF: 3, SG: 3, PG: 3 };
  const multipliers = {};
  let mult = 1;
  for (let i = posOrder.length - 1; i >= 0; i--) {
    multipliers[posOrder[i]] = mult;
    mult *= base[posOrder[i]];
  }
  const numStates = mult;

  const encode = (counts) => {
    let s = 0;
    for (const pos of posOrder) {
      s += counts[pos] * multipliers[pos];
    }
    return s;
  };

  const decode = (state) => {
    const counts = {};
    let rem = state;
    for (const pos of posOrder) {
      const m = multipliers[pos];
      const b = base[pos];
      const digit = Math.floor(rem / m) % b;
      counts[pos] = digit;
    }
    return counts;
  };

  const finalState = encode(required);

  // Precompute transitions: nextState[state][posIndex] -> newState or -1
  const nextState = Array.from({ length: numStates }, () => Array(posOrder.length).fill(-1));
  for (let state = 0; state < numStates; state++) {
    const counts = decode(state);
    for (let pi = 0; pi < posOrder.length; pi++) {
      const pos = posOrder[pi];
      if (counts[pos] < required[pos]) {
        const newCounts = { ...counts, [pos]: counts[pos] + 1 };
        nextState[state][pi] = encode(newCounts);
      }
    }
  }

  // DP per roster-state with a Pareto frontier over salary.
  // dp[state] is a Map<salary, node> where node has best points for that exact salary.
  const dp = Array.from({ length: numStates }, () => new Map());
  dp[0].set(0, { points: 0, salary: 0, prev: null, player: null });

  const pruneFrontier = (salaryToNode) => {
    if (salaryToNode.size <= 1) return salaryToNode;
    const entries = Array.from(salaryToNode.entries())
      .map(([salary, node]) => ({ salary, node }))
      .sort((a, b) => a.salary - b.salary);
    const pruned = new Map();
    let bestPointsSoFar = -Infinity;
    for (const { salary, node } of entries) {
      if (node.points > bestPointsSoFar) {
        bestPointsSoFar = node.points;
        pruned.set(salary, node);
      }
    }
    return pruned;
  };

  for (const player of playerObjs) {
    const updated = dp.map((m) => new Map(m));
    const eligiblePosIdx = player.eligiblePositions
      .map((p) => posOrder.indexOf(p))
      .filter((idx) => idx >= 0);

    for (let state = 0; state < numStates; state++) {
      const frontier = dp[state];
      if (frontier.size === 0) continue;

      for (const [salarySoFar, node] of frontier.entries()) {
        for (const pi of eligiblePosIdx) {
          const newState = nextState[state][pi];
          if (newState === -1) continue;
          const newSalary = salarySoFar + player.salary;
          if (newSalary > maxSalary) continue;
          const newPoints = node.points + player.fantasyPoints;
          const existing = updated[newState].get(newSalary);
          if (!existing || newPoints > existing.points) {
            updated[newState].set(newSalary, {
              points: newPoints,
              salary: newSalary,
              prev: node,
              player
            });
          }
        }
      }
    }

    // Prune after each player to keep maps small.
    for (let state = 0; state < numStates; state++) {
      updated[state] = pruneFrontier(updated[state]);
    }
    for (let state = 0; state < numStates; state++) {
      dp[state] = updated[state];
    }
  }

  const finalFrontier = dp[finalState];
  if (!finalFrontier || finalFrontier.size === 0) return [];

  // Choose the best points among all salaries <= cap.
  let bestNode = null;
  for (const node of finalFrontier.values()) {
    if (!bestNode || node.points > bestNode.points) {
      bestNode = node;
    }
  }
  if (!bestNode) return [];

  // Reconstruct lineup.
  const lineup = [];
  let cur = bestNode;
  while (cur && cur.player) {
    lineup.push({
      id: cur.player.id,
      name: cur.player.name,
      position: cur.player.position,
      salary: cur.player.salary,
      fantasyPoints: cur.player.fantasyPoints
    });
    cur = cur.prev;
  }
  return lineup.reverse();
}

function getNextBestLineup(players, reboundsMap, assistsMap, blocksMap, stealsMap, getSalaryByNickname, maxCount = 9, maxSalary = 60000) {
  const best = getOptimalLineup(players, reboundsMap, assistsMap, blocksMap, stealsMap, getSalaryByNickname, maxCount, maxSalary);
  if (best.length === 0) return { best: [], nextBest: [] };

  let bestAlt = [];
  let bestAltPoints = -Infinity;

  for (const player of best) {
    const excluded = new Set([player.id]);
    const alt = getOptimalLineup(players, reboundsMap, assistsMap, blocksMap, stealsMap, getSalaryByNickname, maxCount, maxSalary, excluded);
    if (alt.length !== maxCount) continue;
    const altPoints = alt.reduce((sum, p) => sum + Number(p.fantasyPoints || 0), 0);
    if (altPoints > bestAltPoints) {
      bestAltPoints = altPoints;
      bestAlt = alt;
    }
  }

  return { best, nextBest: bestAlt };
}

// Returns a maxCount-player lineup maximizing fantasy points under the salary cap,
// with no position constraints.
function getOptimalLineupNoPositions(
  players,
  reboundsMap,
  assistsMap,
  blocksMap,
  stealsMap,
  getSalaryByNickname,
  maxCount = 6,
  maxSalary = 60000,
  excludedIds = new Set()
) {
  const playerObjs = players
    .map((p) => {
      const reboundsObj = reboundsMap.get(p.id) || {};
      const assistsObj = assistsMap.get(p.id) || {};
      const blocksObj = blocksMap.get(p.id) || {};
      const stealsObj = stealsMap.get(p.id) || {};

      const projectedPoints = getProjectedStat(p.points, p.oddsValue);
      const projectedRebounds = getProjectedStat(reboundsObj.rebounds, reboundsObj.oddsValue);
      const projectedAssists = getProjectedStat(assistsObj.assists, assistsObj.oddsValue);
      const projectedBlocks = getProjectedStat(blocksObj.blocks, blocksObj.oddsValue);
      const projectedSteals = getProjectedStat(stealsObj.steals, stealsObj.oddsValue);

      const pointsVal = projectedPoints ?? 0;
      const reboundsVal = projectedRebounds ?? 0;
      const assistsVal = projectedAssists ?? 0;
      const blocksVal = projectedBlocks ?? 0;
      const stealsVal = projectedSteals ?? 0;

      const salary = Number(getSalaryByNickname(p.name)) || 0;
      const fantasyPoints =
        pointsVal +
        1.2 * reboundsVal +
        1.0 * assistsVal +
        3 * blocksVal +
        3 * stealsVal;

      return {
        id: p.id,
        name: p.name,
        salary,
        fantasyPoints,
        position: getPositionByNickname(p.name)
      };
    })
    .filter((p) => p.salary > 0 && !excludedIds.has(p.id));

  if (playerObjs.length < maxCount) return [];

  // dp[count] = Map<salary, node>
  const dp = Array.from({ length: maxCount + 1 }, () => new Map());
  dp[0].set(0, { points: 0, salary: 0, prev: null, player: null });

  const pruneFrontier = (salaryToNode) => {
    if (salaryToNode.size <= 1) return salaryToNode;
    const entries = Array.from(salaryToNode.entries())
      .map(([salary, node]) => ({ salary, node }))
      .sort((a, b) => a.salary - b.salary);
    const pruned = new Map();
    let bestPointsSoFar = -Infinity;
    for (const { salary, node } of entries) {
      if (node.points > bestPointsSoFar) {
        bestPointsSoFar = node.points;
        pruned.set(salary, node);
      }
    }
    return pruned;
  };

  for (const player of playerObjs) {
    for (let count = maxCount - 1; count >= 0; count--) {
      const frontier = dp[count];
      if (frontier.size === 0) continue;
      for (const [salarySoFar, node] of frontier.entries()) {
        const newSalary = salarySoFar + player.salary;
        if (newSalary > maxSalary) continue;
        const newPoints = node.points + player.fantasyPoints;
        const existing = dp[count + 1].get(newSalary);
        if (!existing || newPoints > existing.points) {
          dp[count + 1].set(newSalary, {
            points: newPoints,
            salary: newSalary,
            prev: node,
            player
          });
        }
      }
    }
    for (let count = 0; count <= maxCount; count++) {
      dp[count] = pruneFrontier(dp[count]);
    }
  }

  const finalFrontier = dp[maxCount];
  if (!finalFrontier || finalFrontier.size === 0) return [];

  let bestNode = null;
  for (const node of finalFrontier.values()) {
    if (!bestNode || node.points > bestNode.points) bestNode = node;
  }
  if (!bestNode) return [];

  const lineup = [];
  let cur = bestNode;
  while (cur && cur.player) {
    lineup.push({
      id: cur.player.id,
      name: cur.player.name,
      position: cur.player.position,
      salary: cur.player.salary,
      fantasyPoints: cur.player.fantasyPoints
    });
    cur = cur.prev;
  }

  return lineup.reverse();
}

function getOptimalLineupNoPositionsWithMVP(
  players,
  reboundsMap,
  assistsMap,
  blocksMap,
  stealsMap,
  getSalaryByNickname,
  maxCount = 6,
  maxSalary = 60000
) {
  const playerObjs = players
    .map((p) => {
      const reboundsObj = reboundsMap.get(p.id) || {};
      const assistsObj = assistsMap.get(p.id) || {};
      const blocksObj = blocksMap.get(p.id) || {};
      const stealsObj = stealsMap.get(p.id) || {};

      const projectedPoints = getProjectedStat(p.points, p.oddsValue);
      const projectedRebounds = getProjectedStat(reboundsObj.rebounds, reboundsObj.oddsValue);
      const projectedAssists = getProjectedStat(assistsObj.assists, assistsObj.oddsValue);
      const projectedBlocks = getProjectedStat(blocksObj.blocks, blocksObj.oddsValue);
      const projectedSteals = getProjectedStat(stealsObj.steals, stealsObj.oddsValue);

      const pointsVal = projectedPoints ?? 0;
      const reboundsVal = projectedRebounds ?? 0;
      const assistsVal = projectedAssists ?? 0;
      const blocksVal = projectedBlocks ?? 0;
      const stealsVal = projectedSteals ?? 0;

      const salary = Number(getSalaryByNickname(p.name)) || 0;
      const fantasyPoints =
        pointsVal +
        1.2 * reboundsVal +
        1.0 * assistsVal +
        3 * blocksVal +
        3 * stealsVal;

      return {
        id: p.id,
        name: p.name,
        salary,
        fantasyPoints,
        position: getPositionByNickname(p.name)
      };
    })
    .filter((p) => p.salary > 0);

  if (playerObjs.length < maxCount) return { lineup: [], mvp: null };

  const pickBestNoPos = (candidates, count, cap) => {
    if (candidates.length < count) return [];
    const dp = Array.from({ length: count + 1 }, () => new Map());
    dp[0].set(0, { points: 0, salary: 0, prev: null, player: null });

    const pruneFrontier = (salaryToNode) => {
      if (salaryToNode.size <= 1) return salaryToNode;
      const entries = Array.from(salaryToNode.entries())
        .map(([salary, node]) => ({ salary, node }))
        .sort((a, b) => a.salary - b.salary);
      const pruned = new Map();
      let bestPointsSoFar = -Infinity;
      for (const { salary, node } of entries) {
        if (node.points > bestPointsSoFar) {
          bestPointsSoFar = node.points;
          pruned.set(salary, node);
        }
      }
      return pruned;
    };

    for (const player of candidates) {
      for (let c = count - 1; c >= 0; c--) {
        const frontier = dp[c];
        if (frontier.size === 0) continue;
        for (const [salarySoFar, node] of frontier.entries()) {
          const newSalary = salarySoFar + player.salary;
          if (newSalary > cap) continue;
          const newPoints = node.points + player.fantasyPoints;
          const existing = dp[c + 1].get(newSalary);
          if (!existing || newPoints > existing.points) {
            dp[c + 1].set(newSalary, {
              points: newPoints,
              salary: newSalary,
              prev: node,
              player
            });
          }
        }
      }
      for (let c = 0; c <= count; c++) {
        dp[c] = pruneFrontier(dp[c]);
      }
    }

    const finalFrontier = dp[count];
    if (!finalFrontier || finalFrontier.size === 0) return [];
    let bestNode = null;
    for (const node of finalFrontier.values()) {
      if (!bestNode || node.points > bestNode.points) bestNode = node;
    }
    if (!bestNode) return [];
    const lineup = [];
    let cur = bestNode;
    while (cur && cur.player) {
      lineup.push({
        id: cur.player.id,
        name: cur.player.name,
        position: cur.player.position,
        salary: cur.player.salary,
        fantasyPoints: cur.player.fantasyPoints
      });
      cur = cur.prev;
    }
    return lineup.reverse();
  };

  let best = { lineup: [], mvp: null, totalPoints: -Infinity };

  for (const mvp of playerObjs) {
    const mvpSalary = mvp.salary * 1.5;
    if (mvpSalary > maxSalary) continue;
    const remainingCap = maxSalary - mvpSalary;
    const others = playerObjs.filter((p) => p.id !== mvp.id);
    const rest = pickBestNoPos(others, maxCount - 1, remainingCap);
    if (rest.length !== maxCount - 1) continue;

    const totalPoints = mvp.fantasyPoints * 1.5 + rest.reduce((s, p) => s + p.fantasyPoints, 0);
    if (totalPoints > best.totalPoints) {
      best = {
        lineup: [
          {
            id: mvp.id,
            name: mvp.name,
            position: mvp.position,
            salary: mvp.salary,
            fantasyPoints: mvp.fantasyPoints
          },
          ...rest
        ],
        mvp,
        totalPoints
      };
    }
  }

  if (best.lineup.length !== maxCount || !best.mvp) return { lineup: [], mvp: null };
  return { lineup: best.lineup, mvp: best.mvp };
}

// Deduplicate assists by id, keep odds closest to -110
function getBestAssistsMap(selections) {
  const assistsMap = new Map();
  selections && selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const american = parseAmericanOdds(odds);
    if (!Number.isFinite(american)) return;
    const oddsValue = american;
    const assists = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!assistsMap.has(p.id)) {
        assistsMap.set(p.id, { assists, oddsValue, oddsStr: odds });
      } else {
        const existing = assistsMap.get(p.id);
        if (Math.abs(american + 110) < Math.abs(Number(existing.oddsValue) + 110)) {
          assistsMap.set(p.id, { assists, oddsValue, oddsStr: odds });
        }
      }
    });
  });
  return assistsMap;
}

// Deduplicate blocks by id, keep odds closest to -110 (same logic as points)
function getBestBlocksMap(selections) {
  const blocksMap = new Map();
  selections && selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const american = parseAmericanOdds(odds);
    if (!Number.isFinite(american)) return;
    const oddsValue = american;
    const blocks = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!blocksMap.has(p.id)) {
        blocksMap.set(p.id, { blocks, oddsValue, oddsStr: odds });
      } else {
        const existing = blocksMap.get(p.id);
        if (Math.abs(american + 110) < Math.abs(Number(existing.oddsValue) + 110)) {
          blocksMap.set(p.id, { blocks, oddsValue, oddsStr: odds });
        }
      }
    });
  });
  return blocksMap;
}

// Deduplicate steals by id, keep odds closest to -110 (same logic as points)
function getBestStealsMap(selections) {
  const stealsMap = new Map();
  selections && selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const american = parseAmericanOdds(odds);
    if (!Number.isFinite(american)) return;
    const oddsValue = american;
    const steals = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!stealsMap.has(p.id)) {
        stealsMap.set(p.id, { steals, oddsValue, oddsStr: odds });
      } else {
        const existing = stealsMap.get(p.id);
        if (Math.abs(american + 110) < Math.abs(Number(existing.oddsValue) + 110)) {
          stealsMap.set(p.id, { steals, oddsValue, oddsStr: odds });
        }
      }
    });
  });
  return stealsMap;
}



function parseAmericanOdds(oddsStr) {
  // Remove any non-numeric characters except minus sign
  const cleaned = String(oddsStr)
    .replace(/\u2212/g, '-')
    .replace(/[^\d-]/g, '');
  return parseInt(cleaned, 10);
}

function americanOddsToImpliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function getUniqueParticipantsWithBestOdds(selections) {
  const participantMap = new Map();
  selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const american = parseAmericanOdds(odds);
    if (!Number.isFinite(american)) return;
    const oddsValue = american;

    // Points markets are O/U. For those, keep only Over so oddsValue is P(X >= ceil(line)).
    const isOverUnderSelection =
      (sel && (sel.label === 'Over' || sel.label === 'Under')) ||
      (sel && (sel.outcomeType === 'Over' || sel.outcomeType === 'Under')) ||
      (sel && sel.points != null);
    if (isOverUnderSelection) {
      const isOver = (sel && sel.label === 'Over') || (sel && sel.outcomeType === 'Over');
      if (!isOver) return;
    }

    const points =
      sel && sel.points != null
        ? sel.points
        : sel && sel.milestoneValue != null
          ? sel.milestoneValue
          : sel.label
            ? sel.label.replace('+', '')
            : '';
    (sel.participants || []).forEach(p => {
      if (!participantMap.has(p.id)) {
        participantMap.set(p.id, { ...p, oddsValue, oddsStr: odds, points });
      } else {
        const existing = participantMap.get(p.id);
        // Compare which odds is closer to -110
        if (Math.abs(american + 110) < Math.abs(Number(existing.oddsValue) + 110)) {
          participantMap.set(p.id, { ...p, oddsValue, oddsStr: odds, points });
        }
      }
    });
  });
  // Return array of {id, name, oddsStr, points}
  return Array.from(participantMap.values());
}

function App() {
  const [generatedGameLineups, setGeneratedGameLineups] = useState({});

  const participants = pointsData.selections
    ? getUniqueParticipantsWithBestOdds(pointsData.selections)
    : [];

  const participantsByGame = (() => {
    const map = new Map();
    for (const p of participants) {
      const game = getGameByNickname(p.name);
      if (!game) continue;
      if (!map.has(game)) map.set(game, []);
      map.get(game).push(p);
    }
    return map;
  })();

  // Build a map of id -> best rebounds label (same logic as points)
  function getBestReboundsMap(selections) {
    const reboundsMap = new Map();
    selections && selections.forEach(sel => {
      const odds = sel.displayOdds && sel.displayOdds.american;
      if (!odds) return;
      const american = parseAmericanOdds(odds);
      if (!Number.isFinite(american)) return;
      const oddsValue = american;
      const rebounds = sel.label ? sel.label.replace('+', '') : '';
      (sel.participants || []).forEach(p => {
        if (!reboundsMap.has(p.id)) {
          reboundsMap.set(p.id, { rebounds, oddsValue, oddsStr: odds });
        } else {
          const existing = reboundsMap.get(p.id);
          if (Math.abs(american + 110) < Math.abs(Number(existing.oddsValue) + 110)) {
            reboundsMap.set(p.id, { rebounds, oddsValue, oddsStr: odds });
          }
        }
      });
    });
    return reboundsMap;
  }

  const reboundsMap = reboundsData && reboundsData.selections
    ? getBestReboundsMap(reboundsData.selections)
    : new Map();

  const assistsMap = assistsData && assistsData.selections
    ? getBestAssistsMap(assistsData.selections)
    : new Map();

  const blocksMap = blocksData && blocksData.selections
    ? getBestBlocksMap(blocksData.selections)
    : new Map();

  const stealsMap = stealsData && stealsData.selections
    ? getBestStealsMap(stealsData.selections)
    : new Map();



  return (
    <div className="App">
      <h1>Names Table</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Position</th>
            <th>Points</th>
            <th>Projected Points</th>
            <th>Points Odds</th>
            <th>Rebounds</th>
            <th>Projected Rebounds</th>
            <th>Rebounds Odds</th>
            <th>Assists</th>
            <th>Projected Assists</th>
            <th>Assists Odds</th>
            <th>Blocks</th>
            <th>Projected Blocks</th>
            <th>Blocks Odds</th>
            <th>Steals</th>
            <th>Projected Steals</th>
            <th>Steals Odds</th>
            <th>Salary</th>
            <th>Fantasy Points</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {[...participants]
            .map((p) => {
              const reboundsObj = reboundsMap.get(p.id) || {};
              const assistsObj = assistsMap.get(p.id) || {};
              const blocksObj = blocksMap.get(p.id) || {};
              const stealsObj = stealsMap.get(p.id) || {};

              const projectedPoints = getProjectedStat(p.points, p.oddsValue);
              const projectedRebounds = getProjectedStat(reboundsObj.rebounds, reboundsObj.oddsValue);
              const projectedAssists = getProjectedStat(assistsObj.assists, assistsObj.oddsValue);
              const projectedBlocks = getProjectedStat(blocksObj.blocks, blocksObj.oddsValue);
              const projectedSteals = getProjectedStat(stealsObj.steals, stealsObj.oddsValue);

              const pointsVal = projectedPoints ?? 0;
              const reboundsVal = projectedRebounds ?? 0;
              const assistsVal = projectedAssists ?? 0;
              const blocksVal = projectedBlocks ?? 0;
              const stealsVal = projectedSteals ?? 0;

              const salary = getSalaryByNickname(p.name);
              const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.0 * assistsVal + 3 * blocksVal + 3 * stealsVal;
              const value = salary && Number(salary) > 0 ? (fantasyPoints / Number(salary)) * 1000 : 0;
              const position = getPositionByNickname(p.name);
              return {
                p,
                reboundsObj,
                assistsObj,
                blocksObj,
                stealsObj,
                projectedPoints,
                projectedRebounds,
                projectedAssists,
                projectedBlocks,
                projectedSteals,
                salary,
                fantasyPoints,
                value,
                position
              };
            })
            .sort((a, b) => b.value - a.value)
            .map(({ p, reboundsObj, assistsObj, blocksObj, stealsObj, projectedPoints, projectedRebounds, projectedAssists, projectedBlocks, projectedSteals, salary, fantasyPoints, value, position }) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{position}</td>
                <td>{p.points}</td>
                <td>{projectedPoints !== null ? Number(projectedPoints).toFixed(2) : ''}</td>
                <td>{p.oddsStr}</td>
                <td>{reboundsObj.rebounds || ''}</td>
                <td>{projectedRebounds !== null ? Number(projectedRebounds).toFixed(2) : ''}</td>
                <td>{reboundsObj.oddsStr || ''}</td>
                <td>{assistsObj.assists || ''}</td>
                <td>{projectedAssists !== null ? Number(projectedAssists).toFixed(2) : ''}</td>
                <td>{assistsObj.oddsStr || ''}</td>
                <td>{blocksObj.blocks || ''}</td>
                <td>{projectedBlocks !== null ? Number(projectedBlocks).toFixed(2) : ''}</td>
                <td>{blocksObj.oddsStr || ''}</td>
                <td>{stealsObj.steals || ''}</td>
                <td>{projectedSteals !== null ? Number(projectedSteals).toFixed(2) : ''}</td>
                <td>{stealsObj.oddsStr || ''}</td>
                <td>{salary}</td>
                <td>{fantasyPoints.toFixed(2)}</td>
                <td>{salary && Number(salary) > 0 ? value.toFixed(2) : ''}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <h2>Optimal Lineup (All Games)</h2>
      {(() => {
        const { best: lineup, nextBest } = getNextBestLineup(
          participants,
          reboundsMap,
          assistsMap,
          blocksMap,
          stealsMap,
          getSalaryByNickname,
          9,
          60000
        );
        const isEmpty = lineup.length === 0;
        const totalSalary = lineup.reduce((sum, row) => sum + row.salary, 0);
        const totalFantasyPoints = lineup.reduce((sum, row) => sum + row.fantasyPoints, 0);
        const paddedLineup = [...lineup];
        while (paddedLineup.length < 9) {
          paddedLineup.push({ name: '', salary: '', fantasyPoints: '' });
        }

        const isNextBestEmpty = nextBest.length === 0;
        const totalSalary2 = nextBest.reduce((sum, row) => sum + row.salary, 0);
        const totalFantasyPoints2 = nextBest.reduce((sum, row) => sum + row.fantasyPoints, 0);
        const paddedNextBest = [...nextBest];
        while (paddedNextBest.length < 9) {
          paddedNextBest.push({ name: '', salary: '', fantasyPoints: '' });
        }

        return (
          <>
            {isEmpty && (
              <div style={{ color: 'red', marginBottom: '8px' }}>
                No valid 9-player lineup exists under the $60,000 salary cap.
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Salary</th>
                  <th>Fantasy Points</th>
                </tr>
              </thead>
              <tbody>
                {paddedLineup.map(({ name, position, salary, fantasyPoints }, idx) => (
                  <tr key={idx}>
                    <td>{name}</td>
                    <td>{position || (name ? getPositionByNickname(name) : '')}</td>
                    <td>{salary}</td>
                    <td>{fantasyPoints !== '' ? Number(fantasyPoints).toFixed(2) : ''}</td>
                  </tr>
                ))}
                <tr key="aggregate-all" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                  <td>Total</td>
                  <td></td>
                  <td>{totalSalary}</td>
                  <td>{totalFantasyPoints.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <h2>Next Best Lineup (All Games)</h2>
            {isNextBestEmpty && !isEmpty && (
              <div style={{ color: 'red', marginBottom: '8px' }}>
                No second lineup could be found under the $60,000 salary cap.
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Salary</th>
                  <th>Fantasy Points</th>
                </tr>
              </thead>
              <tbody>
                {paddedNextBest.map(({ name, position, salary, fantasyPoints }, idx) => (
                  <tr key={idx}>
                    <td>{name}</td>
                    <td>{position || (name ? getPositionByNickname(name) : '')}</td>
                    <td>{salary}</td>
                    <td>{fantasyPoints !== '' ? Number(fantasyPoints).toFixed(2) : ''}</td>
                  </tr>
                ))}
                <tr key="aggregate-all-2" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                  <td>Total</td>
                  <td></td>
                  <td>{totalSalary2}</td>
                  <td>{Number(totalFantasyPoints2 || 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </>
        );
      })()}

      <h2>Optimal Lineups By Game</h2>
      {Array.from(participantsByGame.entries())
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([game, gameParticipants]) => {
          const generated = generatedGameLineups[game];
          const lineup = generated && Array.isArray(generated.lineup) ? generated.lineup : [];
          const mvp = generated && generated.mvp ? generated.mvp : null;

          const isGenerated = Boolean(generated);
          const isEmpty = isGenerated && lineup.length === 0;

          const mvpId = mvp ? mvp.id : '';
          const totalSalary =
            lineup.reduce((sum, row) => sum + Number(row.salary || 0), 0) +
            (mvp ? 0.5 * Number(mvp.salary || 0) : 0);
          const totalFantasyPoints =
            lineup.reduce((sum, row) => sum + Number(row.fantasyPoints || 0), 0) +
            (mvp ? 0.5 * Number(mvp.fantasyPoints || 0) : 0);

          const paddedLineup = [...lineup];
          while (paddedLineup.length < 6) paddedLineup.push({ name: '', salary: '', fantasyPoints: '' });

          return (
            <div key={game} style={{ marginTop: '16px' }}>
              <h3>{game}</h3>
              <button
                onClick={() => {
                  const result = getOptimalLineupNoPositionsWithMVP(
                    gameParticipants,
                    reboundsMap,
                    assistsMap,
                    blocksMap,
                    stealsMap,
                    getSalaryByNickname,
                    6,
                    60000
                  );
                  setGeneratedGameLineups((prev) => ({ ...prev, [game]: result }));
                }}
                style={{ marginBottom: '8px' }}
              >
                Generate
              </button>

              {isGenerated && !isEmpty && mvp && (
                <div style={{ marginBottom: '8px' }}>
                  MVP: <strong>{mvp.name}</strong> — Salary: {Math.round(Number(mvp.salary || 0) * 1.5)}, Fantasy Points: {(Number(mvp.fantasyPoints || 0) * 1.5).toFixed(2)}
                </div>
              )}

              {isGenerated && isEmpty && (
                <div style={{ color: 'red', marginBottom: '8px' }}>
                  No valid 6-player lineup exists under the $60,000 salary cap.
                </div>
              )}

              {isGenerated && !isEmpty && (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Position</th>
                      <th>Salary</th>
                      <th>Fantasy Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paddedLineup.map(({ id, name, position, salary, fantasyPoints }, idx) => {
                      const isMvp = id && id === mvpId;
                      const salaryDisplay = isMvp ? Math.round(Number(salary) * 1.5) : salary;
                      const pointsDisplay =
                        fantasyPoints !== ''
                          ? isMvp
                            ? Number(fantasyPoints) * 1.5
                            : Number(fantasyPoints)
                          : '';

                      return (
                        <tr key={idx} style={isMvp ? { fontWeight: 'bold' } : undefined}>
                          <td>{name ? (isMvp ? `${name} (MVP)` : name) : ''}</td>
                          <td>{position || (name ? getPositionByNickname(name) : '')}</td>
                          <td>{salaryDisplay}</td>
                          <td>{pointsDisplay !== '' ? Number(pointsDisplay).toFixed(2) : ''}</td>
                        </tr>
                      );
                    })}
                    <tr key="aggregate" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                      <td>Total</td>
                      <td></td>
                      <td>{Math.round(totalSalary)}</td>
                      <td>{totalFantasyPoints.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
    </div>
  );
}

export default App;
