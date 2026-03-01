function tgLink(user) {
  if (user?.username) return `https://t.me/${user.username}`;
  if (user?.telegram_id) return `tg://user?id=${user.telegram_id}`;
  return "—";
}

function fmtUser(user) {
  const name = user?.first_name || "—";
  const uname = user?.username ? `@${user.username}` : "";
  return `${name} ${uname}`.trim();
}

function wrapStoreRequestNotifications({ store, bot }) {
  const chatId = String(process.env.ADMIN_REQUESTS_CHAT_ID || process.env.ADMIN_TELEGRAM_ID || "").trim();
  if (!chatId) return;

  const origCreateRequest = store.createRequest?.bind(store);
  if (!origCreateRequest) return;

  store.createRequest = async (teacherId, studentId, subject) => {
    const reqId = await origCreateRequest(teacherId, studentId, subject);
    if (!reqId) return reqId;

    try {
      const teacher = await store.getUserMeta(teacherId);
      const student = await store.getUserMeta(studentId);

      const text =
        `📩 Нова заявка\n` +
        `Учень: ${fmtUser(student)}\n` +
        `Контакт учня: ${tgLink(student)}\n\n` +
        `Вчитель: ${fmtUser(teacher)}\n` +
        `Контакт вчителя: ${tgLink(teacher)}\n\n` +
        `Предмет: ${subject || "—"}\n` +
        `RequestID: ${reqId}`;

      await bot.telegram.sendMessage(chatId, text);
    } catch (e) {
      // молча, чтобы не ломать поток
    }

    return reqId;
  };
}

module.exports = { wrapStoreRequestNotifications };
