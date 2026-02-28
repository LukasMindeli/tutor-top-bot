const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "subjects_ua.txt");

function loadSubjectLabels() {
  const raw = fs.readFileSync(filePath, "utf8");
  const items = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // дедуп по нижньому регістру
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  return unique;
}

const SUBJECT_LABELS = loadSubjectLabels();

module.exports = { SUBJECT_LABELS };
