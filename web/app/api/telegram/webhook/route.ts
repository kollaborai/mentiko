import { NextRequest } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import {
  getSessionByChatId,
  updateLastHistoryEntry,
  escalationDir,
  replyFile,
} from "@/lib/system/peer-escalations";
import { sendMessage } from "@/lib/notifications/telegram";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string };
  chat: { id: number };
  text?: string;
  reply_to_message?: { message_id: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  // verify webhook secret. fail closed: if TELEGRAM_WEBHOOK_SECRET is unset,
  // the webhook is disabled — never accept unauthenticated requests.
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    throw new Unauthorized("Telegram webhook not configured");
  }
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== configuredSecret) {
    throw new Unauthorized("Invalid webhook secret");
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    throw new BadRequest("invalid json");
  }

  const message = update.message;
  if (!message?.text) return apiSuccess({ ok: true });

  const chat_id = String(message.chat.id);
  const session_id = getSessionByChatId(chat_id);
  if (!session_id) return apiSuccess({ ok: true });

  // strip leading /reply command prefix if present
  const text = message.text.replace(/^\/reply\s*/i, "").trim();
  if (!text) return apiSuccess({ ok: true });

  // write reply.txt — bash polls for this
  const dir = escalationDir(session_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(replyFile(session_id), text);

  // update history
  updateLastHistoryEntry(session_id, {
    human_reply: text,
    replied_at: new Date().toISOString(),
  });

  // ack to user
  await sendMessage(
    chat_id,
    `got it. injecting guidance into session ${session_id.slice(0, 12)}...`
  );

  return apiSuccess({ ok: true });
});
