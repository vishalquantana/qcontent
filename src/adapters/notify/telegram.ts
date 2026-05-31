export interface TelegramCreds {
  botToken: string;
  chatId: string;
}

export interface NotifyResult {
  sent: boolean;
  skipped: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegram(
  creds: TelegramCreds | null | undefined,
  html: string,
): Promise<NotifyResult> {
  if (!creds || !creds.botToken || !creds.chatId) return { sent: false, skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: creds.chatId, text: html, parse_mode: "HTML", disable_web_page_preview: false }),
    });
    return { sent: res.ok, skipped: false };
  } catch {
    return { sent: false, skipped: false };
  }
}

export function notifyPublished(
  creds: TelegramCreds | null | undefined,
  p: { title: string; url: string; type: string },
): Promise<NotifyResult> {
  const msg = `✅ <b>Published</b> (${escapeHtml(p.type)})\n${escapeHtml(p.title)}\n${escapeHtml(p.url)}`;
  return sendTelegram(creds, msg);
}

export function notifyFailure(
  creds: TelegramCreds | null | undefined,
  p: { site: string; jobType: string; error: string },
): Promise<NotifyResult> {
  const msg = `❌ <b>${escapeHtml(p.jobType)} failed</b> — ${escapeHtml(p.site)}\n${escapeHtml(p.error)}`;
  return sendTelegram(creds, msg);
}
