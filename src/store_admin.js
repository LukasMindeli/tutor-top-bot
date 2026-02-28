const { supabase } = require("./supabase");

async function findUserIdByUsername(usernameRaw) {
  const username = String(usernameRaw || "").replace(/^@/, "").trim();
  if (!username) return null;

  const { data, error } = await supabase
    .from("users")
    .select("telegram_id")
    .ilike("username", username)
    .maybeSingle();

  if (error) {
    console.error("findUserIdByUsername error:", error.message);
    return null;
  }
  return data?.telegram_id || null;
}

async function deleteUser(telegramIdRaw) {
  const telegramId = String(telegramIdRaw || "").trim();
  if (!telegramId) return false;

  // cascade удалит teacher_profiles, promos, requests
  const { error } = await supabase
    .from("users")
    .delete()
    .eq("telegram_id", telegramId);

  if (error) {
    console.error("deleteUser error:", error.message);
    return false;
  }
  return true;
}

module.exports = { findUserIdByUsername, deleteUser };
