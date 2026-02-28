const { supabase } = require("./supabase");

function isoNow() { return new Date().toISOString(); }

async function ensureTeacherProfile(telegramIdRaw) {
  const tid = String(telegramIdRaw);
  // upsert чтобы профиль точно существовал
  const { error } = await supabase
    .from("teacher_profiles")
    .upsert({ telegram_id: tid, is_active: false, points: 0 }, { onConflict: "telegram_id" });

  if (error) console.error("ensureTeacherProfile error:", error.message);
}

async function incrementTeacherPoints(telegramIdRaw, deltaRaw) {
  const tid = String(telegramIdRaw);
  const delta = Number.isFinite(deltaRaw) ? deltaRaw : parseInt(deltaRaw, 10);

  await ensureTeacherProfile(tid);

  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("points")
    .eq("telegram_id", tid)
    .maybeSingle();

  if (error) {
    console.error("incrementTeacherPoints select error:", error.message);
    return null;
  }

  const cur = Number.isFinite(data?.points) ? data.points : 0;
  const next = cur + (Number.isFinite(delta) ? delta : 0);

  const { error: updErr } = await supabase
    .from("teacher_profiles")
    .update({ points: next, updated_at: isoNow() })
    .eq("telegram_id", tid);

  if (updErr) {
    console.error("incrementTeacherPoints update error:", updErr.message);
    return null;
  }

  return next;
}

/**
 * Обновляет статус заявки ТОЛЬКО если:
 * - id совпадает
 * - actorField (teacher_id или student_id) совпадает с actorId
 * - текущий status равен fromStatus
 */
async function updateRequestStatusGuard(reqId, actorField, actorId, fromStatus, toStatus) {
  const { data, error } = await supabase
    .from("requests")
    .update({ status: toStatus, updated_at: isoNow() })
    .eq("id", reqId)
    .eq(actorField, String(actorId))
    .eq("status", fromStatus)
    .select("id, teacher_id, student_id, subject, status")
    .maybeSingle();

  if (error) {
    console.error("updateRequestStatusGuard error:", error.message);
    return null;
  }
  return data || null;
}

module.exports = { incrementTeacherPoints, updateRequestStatusGuard };
