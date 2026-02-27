import salaries from './salaries.json';

// Build a map from Nickname to Salary for fast lookup
const salaryMap = new Map();

salaries.forEach(row => {
  if (row["Nickname"] && row["Salary"]) {
    salaryMap.set(row["Nickname"], row["Salary"]);
  }
});

function stripSuffix(name) {
  return name.replace(/\s+(Jr\.|Sr\.)$/, '').trim();
}

export function getSalaryByNickname(nickname) {
  if (!nickname) return '';
  // Try exact match first
  let salary = salaryMap.get(nickname);
  if (salary) return salary;
  // Try stripping Jr. or Sr. suffix
  const stripped = stripSuffix(nickname);
  if (stripped !== nickname) {
    salary = salaryMap.get(stripped);
    if (salary) return salary;
  }
  // Try matching ignoring suffix in the map
  for (const [mapName, mapSalary] of salaryMap.entries()) {
    if (stripSuffix(mapName) === stripped) {
      return mapSalary;
    }
  }
  return '';
}
