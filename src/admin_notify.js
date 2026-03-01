const crypto = require("crypto");
const { supabase } = require("./supabase");

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function getSubjects(teacherId) {
  const tid = String(teacherId);

  // 1) many-to-many
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", tid)
    .order("subject", { ascending: true });

  if (!error) {
    const subs = (data || []).map(r => String(r.subject || "").trim()).filter(Boolean);
    if (subs.length) return subs;
  }

  // 2) fallback старого subject (если вдруг)
  const { data: prof } = await supabase
    .from("teacher_profiles")
    .select("subject")
    .eq("telegram_id", tid)
    .maybeSingle();

  const one = String(prof?.subject || "").trim();
  return one ? [one] : [];
}

function isCompleted(profile, subjects) {
  const priceOk = profile?.price != null;
  const bioOk = String(profile?.bio || "").trim().length > 0;
  const subjOk = Array.isArray(subjects) && subjects.length > 0;
  return priceOk && bioOk && subjOk;
}

function makeProfileHash(profile, subjects) {
  const payload = {
    subjects: (subjects || []).slice().sort(),
    price: profile?.price ?? null,
    bio: String(profile?.bio || "").trim(),
    photo: profile?.photo_file_id ? "1" : "0",
  };
  return sha256(JSON.stringify(payload));
}

function fmtSubjects(subjects) {
  if (!subjects?.length) return "—";
  return subjects.join(", ");
}

async function sendAdmin(bot, adminId, text) {
  if (!adminId) return;
  try { await bot.telegram.sendMessage(adminId, text); } catch (e) {}
}

async function loadSnapshot(store, teacherId) {
  const tid = String(teacherId);
  const profile = await store.getTeacherProfile(tid);
  const user = await store.getUserMeta(tid);
  const subjects = await getSubjects(tid);
  return { tid, profile, user, subjects };
}

async function markState(teacherId, hash) {
  const tid = String(teacherId);
  await supabase.from("teacher_profiles").update({
    admin_notified: true,
    admin_profile_hash: hash,
    admin_last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("telegram_id", tid);
}

async function updateHashOnly(teacherId, hash) {
  const tid = String(teacherId);
  await supabase.from("teacher_profiles").update({
    admin_profile_hash: hash,
    admin_last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("telegram_id", tid);
}

function wrapStoreWithAdminNotifications({ store, bot, adminId }) {
  if (!adminId) return;

  const origUpdate = store.updateTeacherProfile.bind(store);
  const origDelete = store.deleteTeacherProfile.bind(store);

  store.updateTeacherProfile = async (teacherId, patch) => {
    const before = await loadSnapshot(store, teacherId);
    const beforeHash = before.profile?.admin_profile_hash || "";
    const beforeNotified = !!before.profile?.admin_notified;

    await origUpdate(teacherId, patch);

    const after = await loadSnapshot(store, teacherId);
    if (!after.profile) return;

    const completed = isCompleted(after.profile, after.subjects);
    const afterHash = makeProfileHash(after.profile, after.subjects);

    // ✅ CREATE (один раз)
    if (completed && !beforeNotified) {
      const uname = after.user?.username ? `@${after.user.username}` : "—";
      await sendAdmin(
        bot,
        adminId,
        `🆕 Створено анкету (Вчитель)\n` +
        `ID: ${after.tid}\n` +
        `Ім'я: ${after.user?.first_name || "—"}\n` +
        `Username: ${uname}\n` +
        `Предмети: ${fmtSubjects(after.subjects)}\n` +
        `Ціна: ${after.profile.price} грн`
      );
      await markState(after.tid, afterHash);
      return;
    }

    // ✅ EDIT (каждый раз когда реально изменилось содержание анкеты)
    if (completed && beforeNotified) {
      const storedHash = beforeHash || after.profile.admin_profile_hash || "";
      if (afterHash && afterHash !== storedHash) {
        const uname = after.user?.username ? `@${after.user.username}` : "—";
        await sendAdmin(
          bot,
          adminId,
          `✏️ Оновлено анкету (Вчитель)\n` +
          `ID: ${after.tid}\n` +
          `Ім'я: ${after.user?.first_name || "—"}\n` +
          `Username: ${uname}\n` +
          `Предмети: ${fmtSubjects(after.subjects)}\n` +
          `Ціна: ${after.profile.price} грн`
        );
        await updateHashOnly(after.tid, afterHash);
      }
    }
  };

  store.deleteTeacherProfile = async (teacherId) => {
    const snap = await loadSnapshot(store, teacherId);
    await origDelete(teacherId);

    const uname = snap.user?.username ? `@${snap.user.username}` : "—";
    const price = snap.profile?.price != null ? `${snap.profile.price} грн` : "—";

    await sendAdmin(
      bot,
      adminId,
      `🗑️ Видалено анкету (Вчитель)\n` +
      `ID: ${snap.tid}\n` +
      `Ім'я: ${snap.user?.first_name || "—"}\n` +
      `Username: ${uname}\n` +
      `Предмети: ${fmtSubjects(snap.subjects)}\n` +
      `Ціна: ${price}`
    );
  };
}

module.exports = { wrapStoreWithAdminNotifications };
