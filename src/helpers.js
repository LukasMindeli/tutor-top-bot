function tgUserLink(id, username) {
  const u = (username || "").toString().trim().replace(/^@/, "");
  if (u) return `https://t.me/${u}`;
  return `tg://user?id=${id}`;
}

module.exports = { tgUserLink };
