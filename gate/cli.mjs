#!/usr/bin/env node
/**
 * The developer's channel. `gate intent "..."` is typed by a human in a
 * terminal the agent does not control, and lands OUTSIDE the repository, so
 * nothing the agent reads or writes can put words in the developer's mouth.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { HOME, REPO, readIntent, writeIntent, readLog, sources } from "./core.mjs";

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
  const g = JSON.parse(execSync(`gh api graphql -f query=@- -F owner=${JSON.stringify(owner)} -F name=${JSON.stringify(name)} -F n=${Number(num)}`, { encoding: "utf8", input: q })).data.repository[kind];
  const rec = { url: g.url, number: g.number, title: g.title, body: g.body, author: g.author?.login, authorAssociation: g.authorAssociation };
  mkdirSync(join(REPO, ".gate", "issues"), { recursive: true });
  writeFileSync(join(REPO, ".gate", "issues", `${repo.replace("/", "__")}-${num}.json`), JSON.stringify(rec, null, 2));
  console.log(`recorded ${rec.url}\n  author ${rec.author} (${rec.authorAssociation})${["OWNER","MEMBER","COLLABORATOR"].includes(rec.authorAssociation) ? ": a maintainer; statements in it carry the maintainer grant" : ": not a maintainer; statements in it carry nothing"}`); }
else if (cmd === "status") { const s = sources(); console.log(JSON.stringify({ intent: s.intent, policy: s.policy, untrustedFilesScanned: s.untrusted.length }, null, 2)); }
else if (cmd === "log") { for (const e of readLog(Number(rest[0]) || 20)) console.log(`${e.at}  ${e.allowed ? "ALLOW " : "REFUSE"}  ${e.action} ${JSON.stringify(e.args)}`); }
else { console.log(`usage:\n  gate intent "<what you want done>" [--for 30m|2h]   signed, time-bound (default 1h)\n  gate intent --clear\n  gate intent                                       show current intent\n  gate issue owner/repo#N | <url>                   record a GitHub issue/PR with its author association\n  gate status                                       what the gate treats as established\n  gate log [n]                                      last decisions`); }
