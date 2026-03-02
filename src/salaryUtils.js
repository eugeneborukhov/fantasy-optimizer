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
  return name.replace(/\s+(Jr\.|Sr\.|II|III|II\.|III\.)$/, '').trim();
}

function getByNickname(lookupMap, nickname) {
  if (!nickname) return '';
  const trimmed = nickname.trim();
  const strippedTrimmed = stripSuffix(trimmed);

  // Special-case aliases where the salaries Nickname differs from the source name.
  // Example: "Ron Holland II" should match "Ronald Holland".
  const aliasByStrippedName = {
    'Ron Holland': 'Ronald Holland'
  };
  const alias = aliasByStrippedName[strippedTrimmed] || '';

  // Try exact match first
  let value = lookupMap.get(trimmed);
  if (value) return value;

  // Try alias match
  if (alias) {
    value = lookupMap.get(alias);
    if (value) return value;
  }

  // Try stripping Jr. or Sr. suffix
  const stripped = strippedTrimmed;
  if (stripped !== trimmed) {
    value = lookupMap.get(stripped);
    if (value) return value;
  }

  // Try alias again after stripping
  if (alias) {
    value = lookupMap.get(alias);
    if (value) return value;
  }

  // Try matching ignoring suffix in the map
  for (const [mapName, mapValue] of lookupMap.entries()) {
    const strippedMapName = stripSuffix(mapName);
    if (strippedMapName === stripped || (alias && strippedMapName === alias)) {
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
