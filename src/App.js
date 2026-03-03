import React, { useEffect, useState } from 'react';
import './App.css';
import pointsData from './stats/points.json';
import reboundsData from './stats/rebounds.json';
import assistsData from './stats/assists.json';
import blocksData from './stats/blocks.json';
import stealsData from './stats/steals.json';
import { getPositionByNickname, getSalaryByNickname } from './salaryUtils';

/**
 * Estimates statistical projection using only "Over" odds and a whole-number line.
 * @param {number} line - The whole number line (e.g., 5)
 * @param {number} overOdds - American odds for the Over (e.g., 150)
 * @returns {object} Statistical projection and the estimated chance of a Push
 */
function getStatisticalProjection(line, overOdds) {
    // 1. Calculate Implied Probability of the Over
    const impliedOver = overOdds > 0 
        ? 100 / (overOdds + 100) 
        : Math.abs(overOdds) / (Math.abs(overOdds) + 100);

    // 2. Estimate Fair Probability
    // On player props, sportsbooks usually bake in a ~5% - 7% margin.
    // We "de-vig" by assuming the Over is slightly overpriced.
    const estimatedMargin = 0.10; 
    const fairProbOver = impliedOver / (1 + estimatedMargin);

    // 3. Poisson Helper Functions
    function factorial(n) {
        let res = 1;
        for (let i = 2; i <= n; i++) res *= i;
        return res;
    }

    function getOverWinRate(lambda, targetLine) {
        const pUnder = [...Array(targetLine).keys()].reduce((sum, i) => 
            sum + (Math.exp(-lambda) * Math.pow(lambda, i)) / factorial(i), 0);
        
        const pExactly = (Math.exp(-lambda) * Math.pow(lambda, targetLine)) / factorial(targetLine);
        const pOver = 1 - (pUnder + pExactly);
        
        // Return conditional probability: Chance of winning given it's not a push
        return pOver / (pOver + pUnder);
    }

    // 4. Binary Search for the Mean (Lambda)
    let low = 0, high = line * 2, iterations = 30;
    for (let i = 0; i < iterations; i++) {
        let mid = (low + high) / 2;
        if (getOverWinRate(mid, line) < fairProbOver) low = mid;
        else high = mid;
    }

    const finalMean = (low + high) / 2;
    const pushProb = (Math.exp(-finalMean) * Math.pow(finalMean, line)) / factorial(line);

    return {
        projectedMean: finalMean.toFixed(2),
        chanceOfPush: (pushProb * 100).toFixed(2) + "%",
        fairWinProbability: (fairProbOver * 100).toFixed(2) + "%"
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
      const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.5 * assistsVal + 3 * blocksVal + 3 * stealsVal;
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

// Deduplicate assists by id, keep odds closest to -110
function getBestAssistsMap(selections) {
  const assistsMap = new Map();
  selections && selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const oddsValue = parseAmericanOdds(odds);
    const assists = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!assistsMap.has(p.id)) {
        assistsMap.set(p.id, { assists, oddsValue, oddsStr: odds });
      } else {
        const existing = assistsMap.get(p.id);
        if (Math.abs(oddsValue + 110) < Math.abs(existing.oddsValue + 110)) {
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
    const oddsValue = parseAmericanOdds(odds);
    const blocks = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!blocksMap.has(p.id)) {
        blocksMap.set(p.id, { blocks, oddsValue, oddsStr: odds });
      } else {
        const existing = blocksMap.get(p.id);
        if (Math.abs(oddsValue + 110) < Math.abs(existing.oddsValue + 110)) {
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
    const oddsValue = parseAmericanOdds(odds);
    const steals = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!stealsMap.has(p.id)) {
        stealsMap.set(p.id, { steals, oddsValue, oddsStr: odds });
      } else {
        const existing = stealsMap.get(p.id);
        if (Math.abs(oddsValue + 110) < Math.abs(existing.oddsValue + 110)) {
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

function getUniqueParticipantsWithBestOdds(selections) {
  const participantMap = new Map();
  selections.forEach(sel => {
    const odds = sel.displayOdds && sel.displayOdds.american;
    if (!odds) return;
    const oddsValue = parseAmericanOdds(odds);
    const points = sel.label ? sel.label.replace('+', '') : '';
    (sel.participants || []).forEach(p => {
      if (!participantMap.has(p.id)) {
        participantMap.set(p.id, { ...p, oddsValue, oddsStr: odds, points });
      } else {
        const existing = participantMap.get(p.id);
        // Compare which odds is closer to -110
        if (Math.abs(oddsValue + 110) < Math.abs(existing.oddsValue + 110)) {
          participantMap.set(p.id, { ...p, oddsValue, oddsStr: odds, points });
        }
      }
    });
  });
  // Return array of {id, name, oddsStr, points}
  return Array.from(participantMap.values());
}

function App() {
  const participants = pointsData.selections
    ? getUniqueParticipantsWithBestOdds(pointsData.selections)
    : [];

  // Build a map of id -> best rebounds label (same logic as points)
  function getBestReboundsMap(selections) {
    const reboundsMap = new Map();
    selections && selections.forEach(sel => {
      const odds = sel.displayOdds && sel.displayOdds.american;
      if (!odds) return;
      const oddsValue = parseAmericanOdds(odds);
      const rebounds = sel.label ? sel.label.replace('+', '') : '';
      (sel.participants || []).forEach(p => {
        if (!reboundsMap.has(p.id)) {
          reboundsMap.set(p.id, { rebounds, oddsValue, oddsStr: odds });
        } else {
          const existing = reboundsMap.get(p.id);
          if (Math.abs(oddsValue + 110) < Math.abs(existing.oddsValue + 110)) {
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
              const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.5 * assistsVal + 3 * blocksVal + 3 * stealsVal;
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

      <h2>Optimal Lineup</h2>
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
        // Pad to 9 rows if needed
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
                <tr key="aggregate" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                  <td>Total</td>
                  <td></td>
                  <td>{totalSalary}</td>
                  <td>{totalFantasyPoints.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <h2>Next Best Lineup</h2>
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
                <tr key="aggregate2" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
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
    </div>
  );
}

export default App;
