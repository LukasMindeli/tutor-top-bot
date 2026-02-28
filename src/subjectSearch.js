function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// повертає масив { idx, label, score }
function searchSubjects(labels, query) {
  const q = norm(query);
  if (!q) return [];
  const res = [];

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const n = norm(label);

    let score = 0;
    if (n.startsWith(q)) score = 2;
    else if (n.includes(q)) score = 1;

    if (score > 0) res.push({ idx: i, label, score });
  }

  res.sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, "uk"));
  return res;
}

module.exports = { searchSubjects };
