import salaries from './salaries.json';

// Build maps from Nickname to fields for fast lookup
const salaryMap = new Map();
const positionMap = new Map();

salaries.forEach((row) => {
  const nickname = row["Nickname"];
  if (!nickname) return;
  if (row["Salary"]) salaryMap.set(nickname, row["Salary"]);
  if (row["Position"]) positionMap.set(nickname, row["Position"]);
});

function stripSuffix(name) {
  return name.replace(/\s+(Jr\.|Sr\.)$/, '').trim();
}

function getByNickname(lookupMap, nickname) {
  if (!nickname) return '';
  const trimmed = nickname.trim();
  // Try exact match first
  let value = lookupMap.get(trimmed);
  if (value) return value;
  // Try stripping Jr. or Sr. suffix
  const stripped = stripSuffix(trimmed);
  if (stripped !== trimmed) {
    value = lookupMap.get(stripped);
    if (value) return value;
  }
  // Try matching ignoring suffix in the map
  for (const [mapName, mapValue] of lookupMap.entries()) {
    if (stripSuffix(mapName) === stripped) {
      return mapValue;
    }
  }
  return '';
}

export function getSalaryByNickname(nickname) {
  return getByNickname(salaryMap, nickname);
}

export function getPositionByNickname(nickname) {
  return getByNickname(positionMap, nickname);
}
