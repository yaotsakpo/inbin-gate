/**
 * The developer's phone as a channel. When the gate refuses something, the hook can ask the
 * developer on Telegram and wait. The message is written by the gate from its own classification,
 * never by the agent: the exact value, the plain consequence, two buttons. "Approve once" becomes a
 * signed one-shot approval on the developer's machine (core.mjs), scoped to that exact value; the
 * hook then lets the call through and the approval is consumed. Deny, or no answer, keeps the
 * refusal. The bot polls Telegram from this machine: no inbound port, and only the configured chat
 * id is listened to. Configuration (token, chat id) lives in the gate's home, which the agent can
 * neither read nor write.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { HOME } from "./core.mjs";

const CFG = () => join(HOME, "telegram.json");
export function telegramConfig() { try { return JSON.parse(readFileSync(CFG(), "utf8")); } catch { return null; } }
export function saveTelegramConfig(cfg) { mkdirSync(HOME, { recursive: true, mode: 0o700 }); writeFileSync(CFG(), JSON.stringify(cfg, null, 2), { mode: 0o600 }); }
export function clearTelegramConfig() { rmSync(CFG(), { force: true }); }

export async function tg(token, method, body, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description || "failed"}`);
  return j.result;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The request, written by the gate: what, the plain consequence, where the value came from. */
export function approvalText({ action, args, decision }) {
  const x = decision.operands?.[0] || {}; const value = x.value ?? JSON.stringify(args);
  const reason = String(decision.reason || "").replace(/^REFUSED by Inbin Gate: this would /, "").split(". Only the developer")[0];
  const from = x.foundInUntrusted?.length ? `\nThe value appears in ${x.foundInUntrusted.join(", ")}: content the agent read.` : "";
  return `<b>Inbin Gate</b>: the agent wants to ${esc(reason)}\n\n<code>${esc(action)}  ${esc(value)}</code>${esc(from)}\n\n<b>Approve once</b> runs exactly this, now. <b>Deny</b> keeps it refused.`;
}

/**
 * Ask and wait. Returns { outcome: "approved" | "denied" | "timeout" | "unconfigured", by }.
 * `deps` lets tests inject fetch, config and the clock.
 */
export async function requestApproval(req, { timeoutMs = 240_000, fetchImpl = fetch, cfg = telegramConfig(), now = Date.now } = {}) {
  if (!cfg?.token || !cfg?.chatId) return { outcome: "unconfigured" };
  const id = randomBytes(4).toString("hex"); const text = approvalText(req);
  const msg = await tg(cfg.token, "sendMessage", { chat_id: cfg.chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Approve once", callback_data: `approve:${id}` }, { text: "Deny", callback_data: `deny:${id}` }]] } }, fetchImpl);
  const finish = (line) => tg(cfg.token, "editMessageText", { chat_id: cfg.chatId, message_id: msg.message_id, text: `${text}\n\n${line}`, parse_mode: "HTML" }, fetchImpl).catch(() => {});
  let offset; const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const wait = Math.max(1, Math.min(20, Math.ceil((deadline - now()) / 1000)));
    const updates = await tg(cfg.token, "getUpdates", { offset, timeout: wait, allowed_updates: ["callback_query"] }, fetchImpl);
    for (const u of updates) {
      offset = u.update_id + 1; const cq = u.callback_query; if (!cq) continue;
      const fromChat = String(cq.message?.chat?.id ?? ""); const fromUser = String(cq.from?.id ?? "");
      if (fromChat !== String(cfg.chatId) && fromUser !== String(cfg.chatId)) continue;   // only the configured chat can answer
      const [verb, rid] = String(cq.data || "").split(":"); if (rid !== id) continue;
      const by = cq.from?.username ? `@${cq.from.username}` : (cq.from?.first_name || "telegram");
      await tg(cfg.token, "answerCallbackQuery", { callback_query_id: cq.id, text: verb === "approve" ? "Approved" : "Denied" }, fetchImpl).catch(() => {});
      await finish(verb === "approve" ? `✅ Approved once by ${esc(by)}` : `⛔ Denied by ${esc(by)}`);
      return { outcome: verb === "approve" ? "approved" : "denied", by, id };
    }
  }
  await finish("⌛ No answer in time; refused.");
  return { outcome: "timeout", id };
}
