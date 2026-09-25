#!/usr/bin/env node
/**
 * The developer's channel. `gate intent "..."` is typed by a human in a
 * terminal the agent does not control, and lands OUTSIDE the repository, so
 * nothing the agent reads or writes can put words in the developer's mouth.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HOME, readIntent, readLog, sources } from "./core.mjs";

const [cmd, ...rest] = process.argv.slice(2);
mkdirSync(HOME, { recursive: true });
if (cmd === "intent" && rest[0] === "--clear") { rmSync(join(HOME, "intent.json"), { force: true }); console.log("intent cleared"); }
else if (cmd === "intent" && rest.length) { const text = rest.join(" "); writeFileSync(join(HOME, "intent.json"), JSON.stringify({ text, at: new Date().toISOString() }, null, 2)); console.log(`developer intent recorded:\n  "${text}"`); }
else if (cmd === "intent") { const i = readIntent(); console.log(i ? `"${i.text}" (${i.at})` : "no intent recorded"); }
else if (cmd === "status") { const s = sources(); console.log(JSON.stringify({ intent: s.intent, policy: s.policy, untrustedFilesScanned: s.untrusted.length }, null, 2)); }
else if (cmd === "log") { for (const e of readLog(Number(rest[0]) || 20)) console.log(`${e.at}  ${e.allowed ? "ALLOW " : "REFUSE"}  ${e.action} ${JSON.stringify(e.args)}`); }
else { console.log(`usage:\n  gate intent "<what you want done, in your own words>"\n  gate intent --clear\n  gate intent            show current intent\n  gate status            what the gate treats as established\n  gate log [n]           last decisions`); }
