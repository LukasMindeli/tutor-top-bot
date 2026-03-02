function fmt(u) {
  if (u?.username) return `@${u.username}`;
  if (u?.first_name) return u.first_name;
  if (u?.telegram_id) return String(u.telegram_id);
  return "—";
}

function isNumericChatId(x) {
  return /^-?\d+$/.test(String(x || "").trim());
}

function wrapStoreRequestNotifications({ store, bot }) {
  const groupIdRaw = String(process.env.ADMIN_REQUESTS_CHAT_ID || "").trim();
  const adminIdRaw = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

  const targetChatId =
    isNumericChatId(groupIdRaw) ? groupIdRaw :
    (isNumericChatId(adminIdRaw) ? adminIdRaw : "");

  if (!targetChatId) {
    console.warn("ADMIN notify disabled: no valid ADMIN_REQUESTS_CHAT_ID / ADMIN_TELEGRAM_ID");
    return;
  }

  // ✅ Главный путь: createRequestOnce (возвращает {id, created})
  if (typeof store.createRequestOnce === "function") {
    const orig = store.createRequestOnce.bind(store);

    store.createRequestOnce = async (teacherId, studentId, subject) => {
      const r = await orig(teacherId, studentId, subject);
      if (!r || !r.id) return r;

      // уведомляем только если реально создана новая заявка (created=true)
      if (r.created) {
        try {
          const teacher = await store.getUserMeta(teacherId);
          const student = await store.getUserMeta(studentId);
          const msg = `${fmt(student)} послал запрос ${fmt(teacher)} по ${subject || "—"}.`;
          await bot.telegram.sendMessage(targetChatId, msg);
        } catch (e) {
          console.error("ADMIN request notify failed:", e?.response?.description || e?.message || e);
        }
      }

      return r;
    };

    return;
  }

  // fallback: createRequest (если нет createRequestOnce)
  if (typeof store.createRequest === "function") {
    const origCreateRequest = store.createRequest.bind(store);

    store.createRequest = async (teacherId, studentId, subject) => {
      const reqId = await origCreateRequest(teacherId, studentId, subject);
      if (!reqId) return reqId;

      try {
        const teacher = await store.getUserMeta(teacherId);
        const student = await store.getUserMeta(studentId);
        const msg = `${fmt(student)} послал запрос ${fmt(teacher)} по ${subject || "—"}.`;
        await bot.telegram.sendMessage(targetChatId, msg);
      } catch (e) {
        console.error("ADMIN request notify failed:", e?.response?.description || e?.message || e);
      }

      return reqId;
    };
  }
}

module.exports = { wrapStoreRequestNotifications };
