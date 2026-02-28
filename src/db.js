const fs = require("fs");

const DB_PATH = "./db.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return { users: {}, requests: {} };
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { users: {}, requests: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

module.exports = { loadDB, saveDB };
