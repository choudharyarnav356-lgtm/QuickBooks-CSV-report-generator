// reportMapper.js
//
// QuickBooks' Report API returns deeply nested JSON (Rows containing Rows,
// each with a Header/Summary/ColData). The dashboard's existing code expects
// a much simpler shape — the same {meta, rows, totals} object the CSV parser
// produces, where "rows" is a flat list of [label, value] pairs and any
// "Total for X" line is duplicated into a totals lookup.
//
// This file's whole job is translating one shape into the other, so nothing
// downstream (extractMetrics, the charts, the detail modals) has to know or
// care whether the data came from a CSV or from the live API.

function toNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = parseFloat(String(raw).replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

// Walk a QBO report's Row array recursively, flattening it into [label, value]
// pairs — mirroring exactly what parseQbReport() builds from a CSV.
function flattenRows(rowArray, out) {
  if (!rowArray) return;
  for (const row of rowArray) {
    if (row.Header && row.Header.ColData && row.Header.ColData.length) {
      // A section header, e.g. "Bank Accounts" — no amount of its own.
      out.push([row.Header.ColData[0].value, null]);
    } else if (row.ColData && row.ColData.length) {
      // A plain data line, e.g. ["Checking", "1201.00"]
      const label = row.ColData[0].value;
      const value = toNumber(row.ColData[row.ColData.length - 1].value);
      out.push([label, value]);
    }

    if (row.Rows && row.Rows.Row) flattenRows(row.Rows.Row, out);

    if (row.Summary && row.Summary.ColData) {
      // The closing "Total for X" line QuickBooks always prints after a section.
      const name = row.Summary.ColData[0].value.replace(/^Total for\s+/i, "").trim()
        || (row.Header ? row.Header.ColData[0].value : "");
      const value = toNumber(row.Summary.ColData[row.Summary.ColData.length - 1].value);
      out.push([`Total for ${name}`, value]);
    }
  }
}

// Converts a BalanceSheet or ProfitAndLoss report JSON into {meta, rows, totals} —
// the exact shape parseQbReport() produces from a CSV.
function mapFinancialReport(reportJson, companyName) {
  const header = reportJson.Header || {};
  const meta = {
    company: companyName || "",
    report: header.ReportName || "",
    period: header.StartPeriod ? `${header.StartPeriod} to ${header.EndPeriod}` : (header.Time || "")
  };

  const rows = [];
  flattenRows(reportJson.Rows && reportJson.Rows.Row, rows);

  const totals = {};
  for (const [label, value] of rows) {
    const m = label.match(/^total for (.+)$/i);
    if (m && value != null) totals[m[1].trim()] = value;
  }
  return { meta, rows, totals };
}

// Converts an AgedReceivables / AgedPayables report JSON into the same
// {meta, buckets, total, entities} shape parseAgingReport() produces from a CSV.
function mapAgingReport(reportJson, companyName) {
  const header = reportJson.Header || {};
  const meta = {
    company: companyName || "",
    report: header.ReportName || "",
    period: header.Time || ""
  };

  // Column order tells us which index is Current / 1-30 / ... / Total.
  const colTitles = ((reportJson.Columns && reportJson.Columns.Column) || []).map(c => c.ColTitle);
  const bucketNames = ["Current", "1 - 30", "31 - 60", "61 - 90", "91 and over"];

  const entities = [];
  let buckets = null;

  function walk(rowArray) {
    if (!rowArray) return;
    for (const row of rowArray) {
      if (row.ColData && row.ColData.length && row.type !== "Section") {
        const name = row.ColData[0].value;
        const total = toNumber(row.ColData[row.ColData.length - 1].value);
        const current = toNumber(row.ColData[1] ? row.ColData[1].value : null) || 0;
        if (name && total) entities.push([name, total, total - current]);
      }
      if (row.Rows && row.Rows.Row) walk(row.Rows.Row);
      if (row.Summary && row.Summary.ColData && row.Summary.ColData[0].value.toUpperCase().includes("TOTAL")) {
        const cd = row.Summary.ColData;
        buckets = bucketNames.map((name, i) => [name, toNumber(cd[i + 1] ? cd[i + 1].value : null) || 0]);
      }
    }
  }
  walk(reportJson.Rows && reportJson.Rows.Row);

  const total = buckets ? buckets.reduce((s, [, v]) => s + v, 0) : 0;
  return { meta, buckets, total, entities };
}

module.exports = { mapFinancialReport, mapAgingReport, toNumber };
