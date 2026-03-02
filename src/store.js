const { supabase } = require("./supabase");
const { LEAD_POINTS_REWARD } = require("./constants");

function isoNow() { return new Date().toISOString(); }

// =====================
// USERS
// =====================
async function upsertUserMeta(telegramId, firstName, username) {
  const row = {
    telegram_id: String(telegramId),
    first_name: firstName || null,
    username: username || null,
    updated_at: isoNow(),
  };
  const { error } = await supabase.from("users").upsert(row, { onConflict: "telegram_id" });
  if (error) console.error("upsertUserMeta error:", error.message);
}

async function setLastMode(telegramId, mode) {
  const { error } = await supabase
    .from("users")
    .upsert({ telegram_id: String(telegramId), last_mode: mode, updated_at: isoNow() }, { onConflict: "telegram_id" });
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

// =====================
// TEACHER SUBJECTS (multi)
// =====================
async function addTeacherSubject(teacherId, subject) {
  const tid = String(teacherId);
  const subj = String(subject || "").trim();
  if (!subj) return;

  const { error } = await supabase
    .from("teacher_subjects")
    .upsert({ teacher_id: tid, subject: subj }, { onConflict: "teacher_id,subject" });

  if (error) console.error("addTeacherSubject error:", error.message);
}

async function removeTeacherSubject(teacherId, subject) {
  const tid = String(teacherId);
  const subj = String(subject || "").trim();
  if (!subj) return;

  const { error } = await supabase
    .from("teacher_subjects")
    .delete()
    .eq("teacher_id", tid)
    .eq("subject", subj);

  if (error) console.error("removeTeacherSubject error:", error.message);
}

async function listTeacherSubjects(teacherId) {
  const tid = String(teacherId);
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", tid)
    .order("subject", { ascending: true });

  if (error) {
    console.error("listTeacherSubjects error:", error.message);
    return [];
  }
  return (data || []).map(r => r.subject).filter(Boolean);
}

// =====================
// TEACHER PROFILE
// =====================
async function ensureTeacherProfile(telegramId) {
  const tid = String(telegramId);
  const { error } = await supabase
    .from("teacher_profiles")
    .upsert(
      { telegram_id: tid, is_active: false, points: 0, paid_students_count: 0, admin_notified: false },
      { onConflict: "telegram_id" }
    );
  if (error) console.error("ensureTeacherProfile error:", error.message);
}

async function getTeacherProfile(telegramId) {
  const tid = String(telegramId);
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("telegram_id, subject, price, bio, is_active, photo_file_id, points, paid_students_count, admin_notified")
    .eq("telegram_id", tid)
    .maybeSingle();
  if (error) console.error("getTeacherProfile error:", error.message);
  return data || null;
}

async function updateTeacherProfile(telegramId, patch) {
  await ensureTeacherProfile(telegramId);
  const tid = String(telegramId);

  // если пришел patch.subject — добавим в teacher_subjects (multi)
  if (patch && patch.subject) {
    try { await addTeacherSubject(tid, patch.subject); } catch {}
  }

  const row = { ...patch, updated_at: isoNow() };
  const { error } = await supabase.from("teacher_profiles").update(row).eq("telegram_id", tid);
  if (error) console.error("updateTeacherProfile error:", error.message);

  // авто-активация: как только заполнены ключевые поля
  if (patch && typeof patch.is_active === "undefined") {
    const prof = await getTeacherProfile(tid);
    // ВАЖНО: subject legacy может быть пустой — тогда активируем по multi-subject + price + bio
    const subjList = await listTeacherSubjects(tid);
    const hasSubj = (prof?.subject && String(prof.subject).trim()) || subjList.length > 0;
    const completed = !!(hasSubj && (prof?.price ?? null) !== null && prof?.bio);
    if (completed && prof?.is_active === false) {
      const { error: actErr } = await supabase
        .from("teacher_profiles")
        .update({ is_active: true, updated_at: isoNow() })
        .eq("telegram_id", tid);
      if (actErr) console.error("auto-activate error:", actErr.message);
    }
  }
}

async function deleteTeacherProfile(telegramId) {
  const tid = String(telegramId);

  await supabase.from("teacher_promos").delete().eq("telegram_id", tid);
  await supabase.from("payment_proofs").delete().eq("teacher_id", tid);
  await supabase.from("requests").delete().eq("teacher_id", tid);
  await supabase.from("teacher_subjects").delete().eq("teacher_id", tid);

  const { error } = await supabase.from("teacher_profiles").delete().eq("telegram_id", tid);
  if (error) console.error("deleteTeacherProfile error:", error.message);
}

// =====================
// TOP PROMOS
// =====================
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

async function listActivePromosForTeacher(teacherId) {
  const now = isoNow();
  const { data, error } = await supabase
    .from("teacher_promos")
    .select("subject, expires_at")
    .eq("telegram_id", String(teacherId))
    .gt("expires_at", now);

  if (error) {
    console.error("listActivePromosForTeacher error:", error.message);
    return {};
  }

  const map = {};
  for (const r of data || []) {
    const subj = String(r.subject || "").trim();
    const exp = r.expires_at;
    if (!subj || !exp) continue;
    if (!map[subj] || new Date(exp).getTime() > new Date(map[subj]).getTime()) map[subj] = exp;
  }
  return map;
}

// =====================
// SEARCH TEACHERS BY SUBJECT (multi-subject)
// =====================
async function listTeachersBySubject(subjectLabel) {
  // 1) ids by subject
  const { data: ts, error: tsErr } = await supabase
    .from("teacher_subjects")
    .select("teacher_id")
    .eq("subject", subjectLabel);

  if (tsErr) {
    console.error("teacher_subjects lookup error:", tsErr.message);
    return [];
  }

  const ids = (ts || []).map(x => String(x.teacher_id));
  if (!ids.length) return [];

  // 2) profiles
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("telegram_id, subject, price, bio, is_active, photo_file_id, points, paid_students_count, users:users!teacher_profiles_telegram_id_fkey(first_name, username)")
    .in("telegram_id", ids)
    .eq("is_active", true);

  if (error) {
    console.error("teacher_profiles list error:", error.message);
    return [];
  }

  const profiles = (data || []).filter(p => p.price != null && p.bio != null);

  // 3) TOP map for this subject
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
    const paidCnt = Number.isFinite(p.paid_students_count) ? p.paid_students_count : 0;
    const name = (p.users?.first_name || "").toLowerCase();
    const topUntil = topMap.get(tid) || null;

    return {
      telegram_id: tid,
      first_name: p.users?.first_name || null,
      username: p.users?.username || null,
      subject: subjectLabel, // показываем выбранный предмет
      price: p.price,
      bio: p.bio,
      photo_file_id: p.photo_file_id || null,
      points,
      paid_students_count: paidCnt,
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

// =====================
// REQUESTS / ANTI-SPAM
// =====================
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

async function findPendingRequestId(teacherId, studentId, subject) {
  let q = supabase
    .from("requests")
    .select("id")
    .eq("teacher_id", String(teacherId))
    .eq("student_id", String(studentId))
    .eq("status", "pending")
    .limit(1);

  if (subject == null) q = q.is("subject", null);
  else q = q.eq("subject", subject);

  const { data, error } = await q.maybeSingle();
  if (error) console.error("findPendingRequestId error:", error.message);
  return data?.id || null;
}

// returns { id, created }
async function createRequestOnce(teacherId, studentId, subject) {
  // 1) already exists?
  const existing = await findPendingRequestId(teacherId, studentId, subject);
  if (existing) return { id: existing, created: false };

  // 2) try insert
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
    // 23505 = unique violation (наш idx_requests_unique_pending)
    const code = error.code || "";
    const msg = error.message || "";
    if (String(code) === "23505" || msg.toLowerCase().includes("duplicate")) {
      const id2 = await findPendingRequestId(teacherId, studentId, subject);
      if (id2) return { id: id2, created: false };
    }
    console.error("createRequestOnce error:", msg);
    return null;
  }

  return { id: data?.id || null, created: true };
}

// old API (kept)
async function createRequest(teacherId, studentId, subject) {
  const r = await createRequestOnce(teacherId, studentId, subject);
  return r?.id || null;
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

// =====================
// LEAD PAID -> points + paid_students_count
// =====================
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

  const nextPts = curPts + (Number.isFinite(LEAD_POINTS_REWARD) ? LEAD_POINTS_REWARD : 10);
  const nextCnt = curCnt + 1;

  await supabase
    .from("teacher_profiles")
    .update({ points: nextPts, paid_students_count: nextCnt, updated_at: isoNow() })
    .eq("telegram_id", tid);

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

  addTeacherSubject,
  removeTeacherSubject,
  listTeacherSubjects,

  addPromo,
  getActivePromoForTeacher,
  listActivePromosForTeacher,

  listTeachersBySubject,

  countStudentRequestsLastHour,
  findPendingRequestId,
  createRequestOnce,
  createRequest,
  getRequestById,
  updateRequestStatus,

  markLeadPaid,
};
