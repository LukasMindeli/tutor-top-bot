function tgUserLink(id, username) {
  const u = (username || "").toString().trim().replace(/^@/, "");
  if (u) return `https://t.me/${u}`;
  return `tg://user?id=${id}`;
}

function parseNumber(text) {
  const raw = String(text || "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function truncate(text, max = 200) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString("uk-UA", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

module.exports = { tgUserLink, parseNumber, truncate, fmtDate };
