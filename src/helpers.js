function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("uk-UA"); } catch { return iso; }
}

function parseNumber(text) {
  const raw = String(text || "").trim();
  const num = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(num) ? num : null;
}

function truncate(s, n = 450) {
  s = String(s || "").trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function tgUserLink(userId, username) {
  if (username) return `https://t.me/${username}`;
  return `tg://user?id=${userId}`;
}

module.exports = { fmtDate, parseNumber, truncate, tgUserLink };
