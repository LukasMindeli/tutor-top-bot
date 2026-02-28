const { supabase } = require("./supabase");
const { LEAD_POINTS_REWARD } = require("./constants");

function isoNow() { return new Date().toISOString(); }

async function upsertUserMeta(telegramId, firstName, username) {
  const row = {
    telegram_id: String(telegramId),
    first_name: firstName || null,
    username: username || null,
    updated_at: isoNow(),
  };

  const { error } = await supabase
    .from("users")
    .upsert(row, { onConflict: "telegram_id" });

  if (error) console.error("upsertUserMeta error:", error.message);
}

async function setLastMode(telegramId, mode) {
  const { error } = await supabase
    .from("users")
    .upsert(
      { telegram_id: String(telegramId), last_mode: mode, updated_at: isoNow() },
      { onConflict: "telegram_id" }
    );

  if (error) console.error("setLastMode error:", error.message);
}

async function getUserMeta(telegramId) {
  const { data, error } = await supabase
    .from("users")
    .select("telegram_id, first_name, username, last_mode")
    .eq("telegram_id", String(telegramId))
    .maybeSingle();

  if (error) console.error("getUserMeta error:", error.message);
  return data || null;
}

async function ensureTeacherProfile(telegramId) {
  const tid = String(telegramId);

  const { error } = await supabase
    .from("teacher_profiles")
    .upsert(
      { telegram_id: tid, is_active: false, points: 0, paid_students_count: 0 },
      { onConflict: "telegram_id" }
    );

  if (error) console.error("ensureTeacherProfile error:", error.message);
}

async function getTeacherProfile(telegramId) {
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("telegram_id, subject, price, bio, is_active, photo_file_id, points, paid_students_count")
    .eq("telegram_id", String(telegramId))
    .maybeSingle();

  if (error) console.error("getTeacherProfile error:", error.message);
  return data || null;
}

async function updateTeacherProfile(telegramId, patch) {
  await ensureTeacherProfile(telegramId);

  const row = { ...patch, updated_at: isoNow() };

  const { error } = await supabase
    .from("teacher_profiles")
    .update(row)
    .eq("telegram_id", String(telegramId));

  if (error) console.error("updateTeacherProfile error:", error.message);
}

async function deleteTeacherProfile(telegramId) {
  const tid = String(telegramId);

  await supabase.from("teacher_promos").delete().eq("telegram_id", tid);
  await supabase.from("requests").delete().eq("teacher_id", tid);

  const { error } = await supabase.from("teacher_profiles").delete().eq("telegram_id", tid);
  if (error) console.error("deleteTeacherProfile error:", error.message);
}

async function addPromo(telegramId, subject, expiresAt, chargeId) {
  const { error } = await supabase.from("teacher_promos").insert({
    telegram_id: String(telegramId),
    subject,
    expires_at: expiresAt,
    charge_id: chargeId || null,
  });
  if (error) console.error("addPromo error:", error.message);
}

async function getActivePromoForTeacher(telegramId, subject) {
  const now = isoNow();
  const { data, error } = await supabase
    .from("teacher_promos")
    .select("expires_at")
    .eq("telegram_id", String(telegramId))
    .eq("subject", subject)
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) console.error("getActivePromoForTeacher error:", error.message);
  return data?.expires_at || null;
}

async function listTeachersBySubject(subjectLabel) {
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("telegram_id, subject, price, bio, is_active, photo_file_id, points, paid_students_count, users:users!teacher_profiles_telegram_id_fkey(first_name, username)")
    .eq("is_active", true)
    .eq("subject", subjectLabel);

  if (error) {
    console.error("listTeachersBySubject error:", error.message);
    return [];
  }

  const profiles = (data || []).filter((x) => x.price != null && x.bio != null);

  const now = isoNow();
  const { data: promos, error: promoErr } = await supabase
    .from("teacher_promos")
    .select("telegram_id, expires_at")
    .eq("subject", subjectLabel)
    .gt("expires_at", now);

  if (promoErr) console.error("promos load error:", promoErr.message);

  const topMap = new Map();
  for (const p of promos || []) {
    const tid = String(p.telegram_id);
    const prev = topMap.get(tid);
    if (!prev || new Date(p.expires_at).getTime() > new Date(prev).getTime()) topMap.set(tid, p.expires_at);
  }

  const items = profiles.map((p) => {
    const tid = String(p.telegram_id);
    const points = Number.isFinite(p.points) ? p.points : 0;
    const paidCount = Number.isFinite(p.paid_students_count) ? p.paid_students_count : 0;
    const name = (p.users?.first_name || "").toLowerCase();
    const topUntil = topMap.get(tid) || null;

    return {
      telegram_id: tid,
      first_name: p.users?.first_name || null,
      username: p.users?.username || null,
      subject: p.subject,
      price: p.price,
      bio: p.bio,
      photo_file_id: p.photo_file_id || null,
      points,
      paid_students_count: paidCount,
      is_top: !!topUntil,
      top_until: topUntil,
      _name: name,
    };
  });

  items.sort((a, b) =>
    (b.is_top - a.is_top) ||
    (b.points - a.points) ||
    a._name.localeCompare(b._name, "uk")
  );

  return items;
}

async function countStudentRequestsLastHour(studentId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("requests")
    .select("id", { count: "exact", head: true })
    .eq("student_id", String(studentId))
    .gte("created_at", oneHourAgo);

  if (error) console.error("countStudentRequestsLastHour error:", error.message);
  return count || 0;
}

async function createRequest(teacherId, studentId, subject) {
  const { data, error } = await supabase
    .from("requests")
    .insert({
      teacher_id: String(teacherId),
      student_id: String(studentId),
      subject: subject || null,
      status: "pending",
      lead_paid: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createRequest error:", error.message);
    return null;
  }
  return data?.id || null;
}

async function getRequestById(reqId) {
  const { data, error } = await supabase
    .from("requests")
    .select("id, teacher_id, student_id, subject, status, lead_paid, lead_paid_at")
    .eq("id", reqId)
    .maybeSingle();

  if (error) console.error("getRequestById error:", error.message);
  return data || null;
}

async function updateRequestStatus(reqId, teacherId, status) {
  const { data, error } = await supabase
    .from("requests")
    .update({ status, updated_at: isoNow() })
    .eq("id", reqId)
    .eq("teacher_id", String(teacherId))
    .eq("status", "pending")
    .select("id, teacher_id, student_id, subject, status")
    .maybeSingle();

  if (error) console.error("updateRequestStatus error:", error.message);
  return data || null;
}

// отмечаем лид оплаченным 1 раз + начисляем points + paid_students_count
async function markLeadPaid(reqId, teacherId, method, chargeId) {
  const tid = String(teacherId);

  const { data: req, error: reqErr } = await supabase
    .from("requests")
    .update({
      lead_paid: true,
      lead_paid_at: isoNow(),
      lead_charge_id: chargeId || null,
      lead_pay_method: method || null,
      updated_at: isoNow(),
    })
    .eq("id", reqId)
    .eq("teacher_id", tid)
    .eq("lead_paid", false)
    .select("id, teacher_id, student_id, subject, status, lead_paid")
    .maybeSingle();

  if (reqErr) {
    console.error("markLeadPaid request update error:", reqErr.message);
    return null;
  }
  if (!req) return null;

  await ensureTeacherProfile(tid);
  const prof = await getTeacherProfile(tid);

  const curPts = Number.isFinite(prof?.points) ? prof.points : 0;
  const curCnt = Number.isFinite(prof?.paid_students_count) ? prof.paid_students_count : 0;

  const nextPts = curPts + LEAD_POINTS_REWARD;
  const nextCnt = curCnt + 1;

  await updateTeacherProfile(tid, { points: nextPts, paid_students_count: nextCnt });

  return { nextPts, nextCnt, req };
}

module.exports = {
  upsertUserMeta,
  setLastMode,
  getUserMeta,

  ensureTeacherProfile,
  getTeacherProfile,
  updateTeacherProfile,
  deleteTeacherProfile,

  addPromo,
  getActivePromoForTeacher,
  listTeachersBySubject,

  countStudentRequestsLastHour,
  createRequest,
  getRequestById,
  updateRequestStatus,

  markLeadPaid,
};
