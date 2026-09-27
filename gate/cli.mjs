#!/usr/bin/env node
/**
 * The developer's channel. `gate intent "..."` is typed by a human in a
 * terminal the agent does not control, and lands OUTSIDE the repository, so
 * nothing the agent reads or writes can put words in the developer's mouth.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { HOME, REPO, readIntent, writeIntent, writeApproval, readApprovals, readLog, sources } from "./core.mjs";
import { tg, telegramConfig, saveTelegramConfig, clearTelegramConfig } from "./telegram.mjs";

const [cmd, ...rest] = process.argv.slice(2);
mkdirSync(HOME, { recursive: true });
if (cmd === "intent" && rest[0] === "--clear") { rmSync(join(HOME, "intent.json"), { force: true }); console.log("intent cleared"); }
else if (cmd === "intent" && rest.length) {
  let forMs = 60 * 60 * 1000; const i = rest.indexOf("--for");
  if (i !== -1) { const m = /^(\d+)(m|h)$/.exec(rest[i + 1] || ""); if (!m) { console.error("usage: --for 30m | --for 2h"); process.exit(1); } forMs = Number(m[1]) * (m[2] === "h" ? 3600e3 : 60e3); rest.splice(i, 2); }
  const o = writeIntent(rest.join(" "), forMs); console.log(`developer intent recorded, signed, valid until ${o.expiresAt}:\n  "${o.text}"`); }
else if (cmd === "intent") { const i = readIntent(); console.log(!i ? "no intent recorded" : i.invalid ? `intent present but NOT a grant (${i.invalid})` : `"${i.text}" (since ${i.at}, until ${i.expiresAt})`); }
else if (cmd === "issue" && rest[0]) {
  // record a real GitHub issue or PR with its author association, an attribute GitHub authenticates
  const m = /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)[\/#](?:issues\/|pull\/)?(\d+)$/.exec(rest[0]);
  if (!m) { console.error("usage: gate issue owner/repo#123 | <github issue or PR url>"); process.exit(1); }
  const [_, repo, num] = m;
  const isPr = rest[0].includes("/pull/");
  // authorAssociation is only exposed through GraphQL: it is GitHub's own statement of the author's standing in the repository
  const [owner, name] = repo.split("/"); const kind = isPr ? "pullRequest" : "issue";
  const q = `query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ ${kind}(number:$n){ number title body url authorAssociation author{ login } } } }`;
  // the query goes in on stdin (@-) so the shell never sees the $variables
  const qf = join(HOME, "query.graphql"); mkdirSync(HOME, { recursive: true }); writeFileSync(qf, q);
  const g = JSON.parse(execSync(`gh api graphql -F query=@${JSON.stringify(qf)} -F owner=${JSON.stringify(owner)} -F name=${JSON.stringify(name)} -F n=${Number(num)}`, { encoding: "utf8" })).data.repository[kind];
  const rec = { url: g.url, number: g.number, title: g.title, body: g.body, author: g.author?.login, authorAssociation: g.authorAssociation };
  mkdirSync(join(REPO, ".gate", "issues"), { recursive: true });
  writeFileSync(join(REPO, ".gate", "issues", `${repo.replace("/", "__")}-${num}.json`), JSON.stringify(rec, null, 2));
  console.log(`recorded ${rec.url}\n  author ${rec.author} (${rec.authorAssociation})${["OWNER","MEMBER","COLLABORATOR"].includes(rec.authorAssociation) ? ": a maintainer; statements in it carry the maintainer grant" : ": not a maintainer; statements in it carry nothing"}`); }
else if (cmd === "approve" && rest.length) {
  // the developer's answer to one refusal, from the terminal: exact value, one use, ten minutes
  const o = writeApproval("run_command", rest.join(" "), { by: "developer (terminal)" });
  console.log(`approved once, until ${o.expiresAt}:\n  ${o.value}`); }
else if (cmd === "approvals") { for (const o of readApprovals()) console.log(`${o.action}  ${o.value}  (by ${o.by}, until ${o.expiresAt})`); }
else if (cmd === "telegram" && rest[0] === "--off") { clearTelegramConfig(); console.log("telegram disconnected"); }
else if (cmd === "telegram" && rest[0] === "--test") {
  const c = telegramConfig(); if (!c) { console.error("not connected: gate telegram <bot token>"); process.exit(1); }
  await tg(c.token, "sendMessage", { chat_id: c.chatId, text: "Inbin Gate: test message. Refusals will be sent here with Approve once / Deny buttons." });
  console.log(`sent to chat ${c.chatId} (${c.name || ""})`); }
else if (cmd === "telegram" && rest[0]) {
  // connect: the token comes from @BotFather; the chat id is found from the message the developer
  // sent to the bot first. Stored in the gate's home (0600), never in the repository.
  const token = existsSync(rest[0]) ? readFileSync(rest[0], "utf8").trim() : rest[0];
  const updates = await tg(token, "getUpdates", { allowed_updates: ["message"] });
  const m = [...updates].reverse().map((u) => u.message).find((x) => x && x.chat && x.chat.type === "private");
  if (!m) { console.error("send any message to your bot in Telegram first, then run this again"); process.exit(1); }
  const cfg = { token, chatId: m.chat.id, name: m.from?.username ? `@${m.from.username}` : (m.from?.first_name || ""), connectedAt: new Date().toISOString() };
  saveTelegramConfig(cfg);
  await tg(token, "sendMessage", { chat_id: cfg.chatId, text: "Inbin Gate connected. When the gate refuses something the agent proposed, you will be asked here." });
  console.log(`connected to ${cfg.name} (chat ${cfg.chatId}); config in ${HOME}/telegram.json`); }
else if (cmd === "status") { const s = sources(); console.log(JSON.stringify({ intent: s.intent, policy: s.policy, untrustedFilesScanned: s.untrusted.length }, null, 2)); }
else if (cmd === "log") { for (const e of readLog(Number(rest[0]) || 20)) console.log(`${e.at}  ${e.allowed ? "ALLOW " : "REFUSE"}  ${e.action} ${JSON.stringify(e.args)}`); }
else { console.log(`usage:\n  gate intent "<what you want done>" [--for 30m|2h]   signed, time-bound (default 1h)\n  gate intent --clear\n  gate intent                                       show current intent\n  gate issue owner/repo#N | <url>                   record a GitHub issue/PR with its author association\n  gate status                                       what the gate treats as established\n  gate log [n]                                      last decisions`); }
