"use strict";

const fs = require("fs");

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

class CsvWriter {
  constructor(filePath, columns) {
    this.columns = columns;
    fs.mkdirSync(require("path").dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { encoding: "utf8" });
    this.stream.write(columns.map(csvEscape).join(",") + "\n");
  }

  writeRow(rowObj) {
    const line = this.columns.map((col) => csvEscape(rowObj[col])).join(",");
    this.stream.write(line + "\n");
  }

  close() {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

module.exports = { CsvWriter, csvEscape };
