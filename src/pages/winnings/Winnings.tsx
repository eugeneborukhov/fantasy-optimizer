import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import "./Winnings.css";

type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

const csvFiles = import.meta.glob("./*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function parseCsv(content: string): ParsedCsv {
  const cells: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(value);
      cells.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  cells.push(row);

  const nonEmptyRows = cells.filter((currentRow) =>
    currentRow.some((cell) => cell.trim().length > 0),
  );

  if (nonEmptyRows.length === 0) {
    return { headers: [], rows: [] };
  }

  return {
    headers: nonEmptyRows[0],
    rows: nonEmptyRows.slice(1),
  };
}

function mergeCsvFiles(files: Record<string, string>): ParsedCsv {
  const sortedEntries = Object.entries(files).sort(([pathA], [pathB]) =>
    pathA.localeCompare(pathB),
  );

  let mergedHeaders: string[] = [];
  const mergedRows: string[][] = [];

  sortedEntries.forEach(([, content]) => {
    const { headers, rows } = parseCsv(content);

    if (headers.length === 0) {
      return;
    }

    if (mergedHeaders.length === 0) {
      mergedHeaders = headers;
    }

    rows.forEach((sourceRow) => {
      const sourceByHeader = headers.reduce<Record<string, string>>(
        (acc, header, index) => {
          acc[header] = sourceRow[index] ?? "";
          return acc;
        },
        {},
      );

      mergedRows.push(
        mergedHeaders.map((header) => sourceByHeader[header] ?? ""),
      );
    });
  });

  return {
    headers: mergedHeaders,
    rows: mergedRows,
  };
}

const mergedData = mergeCsvFiles(csvFiles);

function parseCurrencyValue(rawValue: string): number {
  const cleaned = rawValue.replace(/\$/g, "").replace(/,/g, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(rawValue: string): number {
  const normalized = rawValue.trim().replace(/\//g, "-");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  return headers.reduce<Record<string, string>>((acc, header, index) => {
    acc[header] = row[index] ?? "";
    return acc;
  }, {});
}

function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentValue(value: number): string {
  return `${value.toFixed(2)}%`;
}

type MonthlyTotalsRow = {
  monthKey: string;
  entryTotal: number;
  winningsTotal: number;
  entriesCount: number;
};

type YearlyTotalsRow = {
  yearKey: string;
  entryTotal: number;
  winningsTotal: number;
  entriesCount: number;
};

export default function Winnings() {
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");

  const hasActiveFilters =
    sportFilter !== "all" ||
    startDateFilter.length > 0 ||
    endDateFilter.length > 0;

  const headerIndexByName = useMemo(() => {
    return mergedData.headers.reduce<Record<string, number>>(
      (acc, header, index) => {
        acc[header.toLowerCase()] = index;
        return acc;
      },
      {},
    );
  }, []);

  const sportColumnIndex = headerIndexByName.sport ?? -1;
  const dateColumnIndex = headerIndexByName.date ?? -1;
  const entryColumnIndex = headerIndexByName["entry ($)"] ?? -1;
  const winningsColumnIndex = headerIndexByName["winnings ($)"] ?? -1;

  const sportOptions = useMemo(() => {
    if (sportColumnIndex < 0) {
      return [];
    }

    const uniqueSports = new Set<string>();
    mergedData.rows.forEach((row) => {
      const value = (row[sportColumnIndex] ?? "").trim();
      if (value.length > 0) {
        uniqueSports.add(value);
      }
    });

    return Array.from(uniqueSports).sort((a, b) => a.localeCompare(b));
  }, [sportColumnIndex]);

  const filteredAndSortedRows = useMemo(() => {
    const startMs = startDateFilter
      ? Date.parse(startDateFilter)
      : Number.NEGATIVE_INFINITY;
    const endMs = endDateFilter
      ? Date.parse(`${endDateFilter}T23:59:59.999`)
      : Number.POSITIVE_INFINITY;

    return [...mergedData.rows]
      .filter((row) => {
        if (sportColumnIndex >= 0 && sportFilter !== "all") {
          const rowSport = (row[sportColumnIndex] ?? "").trim().toLowerCase();
          if (rowSport !== sportFilter.toLowerCase()) {
            return false;
          }
        }

        if (dateColumnIndex >= 0) {
          const rowDateMs = parseDateValue(row[dateColumnIndex] ?? "");
          if (rowDateMs < startMs || rowDateMs > endMs) {
            return false;
          }
        }

        return true;
      })
      .sort((rowA, rowB) => {
        if (dateColumnIndex < 0) {
          return 0;
        }

        return (
          parseDateValue(rowB[dateColumnIndex] ?? "") -
          parseDateValue(rowA[dateColumnIndex] ?? "")
        );
      });
  }, [
    dateColumnIndex,
    endDateFilter,
    sportColumnIndex,
    sportFilter,
    startDateFilter,
  ]);

  const totals = useMemo(() => {
    return filteredAndSortedRows.reduce(
      (acc, row) => {
        if (entryColumnIndex >= 0) {
          acc.totalEntry += parseCurrencyValue(row[entryColumnIndex] ?? "");
        }

        if (winningsColumnIndex >= 0) {
          acc.totalWinnings += parseCurrencyValue(
            row[winningsColumnIndex] ?? "",
          );
        }

        return acc;
      },
      {
        totalEntry: 0,
        totalWinnings: 0,
      },
    );
  }, [entryColumnIndex, filteredAndSortedRows, winningsColumnIndex]);

  const totalsByHeader = useMemo(() => {
    const byHeader: Record<string, string> = {};

    if (entryColumnIndex >= 0) {
      byHeader[mergedData.headers[entryColumnIndex]] = formatCurrencyValue(
        totals.totalEntry,
      );
    }

    if (winningsColumnIndex >= 0) {
      byHeader[mergedData.headers[winningsColumnIndex]] = formatCurrencyValue(
        totals.totalWinnings,
      );
    }

    return byHeader;
  }, [
    entryColumnIndex,
    totals.totalEntry,
    totals.totalWinnings,
    winningsColumnIndex,
  ]);

  const monthlyTotals = useMemo(() => {
    if (dateColumnIndex < 0) {
      return [] as MonthlyTotalsRow[];
    }

    const monthlyMap = new Map<string, MonthlyTotalsRow>();

    filteredAndSortedRows.forEach((row) => {
      const rawDate = (row[dateColumnIndex] ?? "").trim();
      const normalized = rawDate.replace(/\//g, "-");
      const parsedDate = new Date(normalized);

      if (Number.isNaN(parsedDate.getTime())) {
        return;
      }

      const year = parsedDate.getUTCFullYear();
      const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${month}`;

      const existing = monthlyMap.get(monthKey) ?? {
        monthKey,
        entryTotal: 0,
        winningsTotal: 0,
        entriesCount: 0,
      };

      if (entryColumnIndex >= 0) {
        existing.entryTotal += parseCurrencyValue(row[entryColumnIndex] ?? "");
      }

      if (winningsColumnIndex >= 0) {
        existing.winningsTotal += parseCurrencyValue(
          row[winningsColumnIndex] ?? "",
        );
      }

      existing.entriesCount += 1;
      monthlyMap.set(monthKey, existing);
    });

    return Array.from(monthlyMap.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey),
    );
  }, [
    dateColumnIndex,
    entryColumnIndex,
    filteredAndSortedRows,
    winningsColumnIndex,
  ]);

  const yearlyTotals = useMemo(() => {
    if (dateColumnIndex < 0) {
      return [] as YearlyTotalsRow[];
    }

    const yearlyMap = new Map<string, YearlyTotalsRow>();

    filteredAndSortedRows.forEach((row) => {
      const rawDate = (row[dateColumnIndex] ?? "").trim();
      const normalized = rawDate.replace(/\//g, "-");
      const parsedDate = new Date(normalized);

      if (Number.isNaN(parsedDate.getTime())) {
        return;
      }

      const yearKey = String(parsedDate.getUTCFullYear());

      const existing = yearlyMap.get(yearKey) ?? {
        yearKey,
        entryTotal: 0,
        winningsTotal: 0,
        entriesCount: 0,
      };

      if (entryColumnIndex >= 0) {
        existing.entryTotal += parseCurrencyValue(row[entryColumnIndex] ?? "");
      }

      if (winningsColumnIndex >= 0) {
        existing.winningsTotal += parseCurrencyValue(
          row[winningsColumnIndex] ?? "",
        );
      }

      existing.entriesCount += 1;
      yearlyMap.set(yearKey, existing);
    });

    return Array.from(yearlyMap.values()).sort((a, b) =>
      b.yearKey.localeCompare(a.yearKey),
    );
  }, [
    dateColumnIndex,
    entryColumnIndex,
    filteredAndSortedRows,
    winningsColumnIndex,
  ]);

  function clearFilters() {
    setSportFilter("all");
    setStartDateFilter("");
    setEndDateFilter("");
  }

  return (
    <div className="winningsPage">
      <header className="winningsHeader">
        <h1>Winnings</h1>
        <Link className="winningsHomeLink" to="/">
          Back to Home
        </Link>
      </header>

      <main className="winningsMain">
        {mergedData.headers.length === 0 ? (
          <p>No winnings CSV files were found.</p>
        ) : (
          <>
            <div className="winningsFilters" aria-label="Winnings filters">
              <label className="winningsFilterField">
                <span>Sport</span>
                <select
                  value={sportFilter}
                  onChange={(event) => setSportFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  {sportOptions.map((sport) => (
                    <option key={sport} value={sport}>
                      {sport}
                    </option>
                  ))}
                </select>
              </label>

              <label className="winningsFilterField">
                <span>From</span>
                <input
                  type="date"
                  value={startDateFilter}
                  onChange={(event) => setStartDateFilter(event.target.value)}
                />
              </label>

              <label className="winningsFilterField">
                <span>To</span>
                <input
                  type="date"
                  value={endDateFilter}
                  onChange={(event) => setEndDateFilter(event.target.value)}
                />
              </label>

              <div className="winningsFilterActions">
                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                >
                  Clear Filters
                </button>
              </div>
            </div>

            <p className="winningsSummary">
              Showing {filteredAndSortedRows.length} of {mergedData.rows.length}{" "}
              entries from {Object.keys(csvFiles).length} CSV file(s)
            </p>

            <div className="winningsTableWrap">
              <table className="winningsTable">
                <thead>
                  <tr>
                    {mergedData.headers.map((header) => (
                      <th key={header} scope="col">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedRows.map((row, rowIndex) => {
                    const rowObject = rowToObject(mergedData.headers, row);

                    return (
                      <tr key={`${row.join("|")}:${rowIndex}`}>
                        {row.map((value, columnIndex) => (
                          <td key={`${rowIndex}:${columnIndex}`}>
                            {rowObject[mergedData.headers[columnIndex]] ??
                              value}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    {mergedData.headers.map((header, index) => {
                      if (index === 0) {
                        return (
                          <th key={header} scope="row">
                            Totals
                          </th>
                        );
                      }

                      return (
                        <td key={header}>{totalsByHeader[header] ?? ""}</td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            <section
              className="winningsMonthlySection"
              aria-label="Monthly totals"
            >
              <h2>Monthly Totals</h2>
              <div className="winningsTableWrap">
                <table className="winningsTable winningsMonthlyTable">
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Entries</th>
                      <th scope="col">Entry Total</th>
                      <th scope="col">Winnings Total</th>
                      <th scope="col">ROI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyTotals.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No monthly totals to display.</td>
                      </tr>
                    ) : (
                      monthlyTotals.map((monthRow) => {
                        const roiPercent =
                          monthRow.entryTotal > 0
                            ? ((monthRow.winningsTotal - monthRow.entryTotal) /
                                monthRow.entryTotal) *
                              100
                            : null;

                        return (
                          <tr key={monthRow.monthKey}>
                            <th scope="row">{monthRow.monthKey}</th>
                            <td>{monthRow.entriesCount}</td>
                            <td>{formatCurrencyValue(monthRow.entryTotal)}</td>
                            <td>
                              {formatCurrencyValue(monthRow.winningsTotal)}
                            </td>
                            <td>
                              {roiPercent === null
                                ? "N/A"
                                : formatPercentValue(roiPercent)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="winningsYearlySection"
              aria-label="Yearly totals"
            >
              <h2>Yearly Totals</h2>
              <div className="winningsTableWrap">
                <table className="winningsTable winningsYearlyTable">
                  <thead>
                    <tr>
                      <th scope="col">Year</th>
                      <th scope="col">Entries</th>
                      <th scope="col">Entry Total</th>
                      <th scope="col">Winnings Total</th>
                      <th scope="col">ROI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyTotals.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No yearly totals to display.</td>
                      </tr>
                    ) : (
                      yearlyTotals.map((yearRow) => {
                        const roiPercent =
                          yearRow.entryTotal > 0
                            ? ((yearRow.winningsTotal - yearRow.entryTotal) /
                                yearRow.entryTotal) *
                              100
                            : null;

                        return (
                          <tr key={yearRow.yearKey}>
                            <th scope="row">{yearRow.yearKey}</th>
                            <td>{yearRow.entriesCount}</td>
                            <td>{formatCurrencyValue(yearRow.entryTotal)}</td>
                            <td>
                              {formatCurrencyValue(yearRow.winningsTotal)}
                            </td>
                            <td>
                              {roiPercent === null
                                ? "N/A"
                                : formatPercentValue(roiPercent)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
