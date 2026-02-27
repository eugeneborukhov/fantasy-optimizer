import React, { useEffect, useState } from 'react';
import './App.css';
import pointsData from './stats/points.json';
import reboundsData from './stats/rebounds.json';
import assistsData from './stats/assists.json';
import { getSalaryByNickname } from './salaryUtils';

// Returns an array of up to 9 players maximizing fantasy points with total salary <= 50,000
function getOptimalLineup(players, reboundsMap, assistsMap, getSalaryByNickname, maxCount = 9, maxSalary = 50000) {
  // Build player objects with name, salary, fantasyPoints
  const playerObjs = players.map((p) => {
    const reboundsObj = reboundsMap.get(p.id) || {};
    const assistsObj = assistsMap.get(p.id) || {};
    const reboundsVal = Number(reboundsObj.rebounds || 0);
    const pointsVal = Number(p.points || 0);
    const assistsVal = Number(assistsObj.assists || 0);
    const salary = Number(getSalaryByNickname(p.name)) || 0;
    const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.5 * assistsVal;
    return {
      name: p.name,
      salary,
      fantasyPoints,
      id: p.id
    };
  }).filter(p => p.salary > 0);

  if (playerObjs.length < maxCount) return [];

  // For small N, use combinatorial search
  if (playerObjs.length <= 30) {
    let bestLineup = [];
    let bestPoints = -Infinity;
    function* combinations(arr, k, start = 0, prefix = []) {
      if (prefix.length === k) {
        yield prefix;
        return;
      }
      for (let i = start; i < arr.length; ++i) {
        yield* combinations(arr, k, i + 1, [...prefix, arr[i]]);
      }
    }
    for (const combo of combinations(playerObjs, maxCount)) {
      const totalSalary = combo.reduce((sum, p) => sum + p.salary, 0);
      if (totalSalary <= maxSalary) {
        const totalPoints = combo.reduce((sum, p) => sum + p.fantasyPoints, 0);
        if (totalPoints > bestPoints) {
          bestPoints = totalPoints;
          bestLineup = combo;
        }
      }
    }
    return bestLineup.length === maxCount ? bestLineup : [];
  }

  // For large N, use DP knapsack (with player count constraint)
  // dp[i][s][k] = max points using first i players, salary s, k players
  const n = playerObjs.length;
  const dp = Array.from({ length: n + 1 }, () =>
    Array.from({ length: maxSalary + 1 }, () =>
      Array(maxCount + 1).fill(-Infinity)
    )
  );
  const choice = Array.from({ length: n + 1 }, () =>
    Array.from({ length: maxSalary + 1 }, () =>
      Array(maxCount + 1).fill(false)
    )
  );
  dp[0][0][0] = 0;
  for (let i = 0; i < n; ++i) {
    const { salary, fantasyPoints } = playerObjs[i];
    for (let s = 0; s <= maxSalary; ++s) {
      for (let k = 0; k <= maxCount; ++k) {
        if (dp[i][s][k] > -Infinity) {
          // Don't take
          if (dp[i][s][k] > dp[i + 1][s][k]) {
            dp[i + 1][s][k] = dp[i][s][k];
            choice[i + 1][s][k] = false;
          }
          // Take
          if (k + 1 <= maxCount && s + salary <= maxSalary) {
            const newPoints = dp[i][s][k] + fantasyPoints;
            if (newPoints > dp[i + 1][s + salary][k + 1]) {
              dp[i + 1][s + salary][k + 1] = newPoints;
              choice[i + 1][s + salary][k + 1] = true;
            }
          }
        }
      }
    }
  }
  // Find best total points for exactly maxCount players
  let bestS = -1;
  let bestScore = -Infinity;
  for (let s = 0; s <= maxSalary; ++s) {
    if (dp[n][s][maxCount] > bestScore) {
      bestScore = dp[n][s][maxCount];
      bestS = s;
    }
  }
  if (bestScore === -Infinity) return [];
  // Reconstruct lineup
  let res = [];
  let i = n, s = bestS, k = maxCount;
  while (k > 0) {
    if (choice[i][s][k]) {
      res.push(playerObjs[i - 1]);
      s -= playerObjs[i - 1].salary;
      k--;
    }
    i--;
  }
  return res.reverse();
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



function parseAmericanOdds(oddsStr) {
  // Remove any non-numeric characters except minus sign
  const cleaned = oddsStr.replace(/[^\d-]/g, '');
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



  return (
    <div className="App">
      <h1>Names Table</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Points</th>
            <th>Points Odds</th>
            <th>Rebounds</th>
            <th>Rebounds Odds</th>
            <th>Assists</th>
            <th>Assists Odds</th>
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
              const reboundsVal = Number(reboundsObj.rebounds || 0);
              const pointsVal = Number(p.points || 0);
              const assistsVal = Number(assistsObj.assists || 0);
              const salary = getSalaryByNickname(p.name);
              const fantasyPoints = pointsVal + 1.2 * reboundsVal + 1.5 * assistsVal;
              const value = salary && Number(salary) > 0 ? (fantasyPoints / Number(salary)) * 1000 : 0;
              return {
                p,
                reboundsObj,
                assistsObj,
                salary,
                fantasyPoints,
                value
              };
            })
            .sort((a, b) => b.value - a.value)
            .map(({ p, reboundsObj, assistsObj, salary, fantasyPoints, value }) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.points}</td>
                <td>{p.oddsStr}</td>
                <td>{reboundsObj.rebounds || ''}</td>
                <td>{reboundsObj.oddsStr || ''}</td>
                <td>{assistsObj.assists || ''}</td>
                <td>{assistsObj.oddsStr || ''}</td>
                <td>{salary}</td>
                <td>{fantasyPoints.toFixed(2)}</td>
                <td>{salary && Number(salary) > 0 ? value.toFixed(2) : ''}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <h2>Optimal Lineup</h2>
      {(() => {
        const lineup = getOptimalLineup(participants, reboundsMap, assistsMap, getSalaryByNickname, 9, 50000);
        const isEmpty = lineup.length === 0;
        const totalSalary = lineup.reduce((sum, row) => sum + row.salary, 0);
        const totalFantasyPoints = lineup.reduce((sum, row) => sum + row.fantasyPoints, 0);
        // Pad to 9 rows if needed
        const paddedLineup = [...lineup];
        while (paddedLineup.length < 9) {
          paddedLineup.push({ name: '', salary: '', fantasyPoints: '' });
        }
        return (
          <>
            {isEmpty && (
              <div style={{ color: 'red', marginBottom: '8px' }}>
                No valid 9-player lineup exists under the $50,000 salary cap.
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Salary</th>
                  <th>Fantasy Points</th>
                </tr>
              </thead>
              <tbody>
                {paddedLineup.map(({ name, salary, fantasyPoints }, idx) => (
                  <tr key={idx}>
                    <td>{name}</td>
                    <td>{salary}</td>
                    <td>{fantasyPoints !== '' ? Number(fantasyPoints).toFixed(2) : ''}</td>
                  </tr>
                ))}
                <tr key="aggregate" style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
                  <td>Total</td>
                  <td>{totalSalary}</td>
                  <td>{totalFantasyPoints.toFixed(2)}</td>
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
