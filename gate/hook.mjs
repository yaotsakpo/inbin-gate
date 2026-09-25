#!/usr/bin/env node
/**
 * Inbin Gate as a Bob PreToolUse hook.
 *
 * Bob calls this before running one of its OWN tools (terminal, file writes)
 * and passes the tool name and arguments on stdin. Exit 2 blocks the call and
 * the reason on stderr is what Bob sees. So the gate governs Bob's native
 * tools in every mode, with auto-approve on, and nothing has to be taken away
 * from Bob. Registered in .bob/settings.json (project) under hooks.PreToolUse.
 *
 * Mapping of Bob tools to gate actions:
 *   execute_command                       -> run_command  { cmd }
 *   write_file | apply_diff |
 *   search_and_replace | insert_content   -> edit_protected_file { path }, only when the
 *                                            path matches the policy's protected patterns;
 *                                            ordinary source edits pass untouched
 *   anything else (reads, MCP tools)      -> allowed; our MCP tools gate themselves
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { relative, resolve, isAbsolute, join } from "node:path";
import { execSync } from "node:child_process";
import { gate, readPolicy, REPO, HOME } from "./core.mjs";
import { pathState } from "./consequences.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const event = payload.hook_event_name ?? payload.event ?? "PreToolUse";
const tool = payload.tool_name ?? payload.tool ?? "";
const input = payload.tool_input ?? payload.input ?? {};

/**
 * The developer's work in progress: files that were already modified or untracked when the
 * session started. Recorded by the SessionStart hook. A write to one of these needs the developer's
 * word, because it may hold the only copy of what they were doing; a file Bob creates or changes
 * during the session is Bob's own and stays free. Clean tracked files are recoverable from git.
 */
const BASELINE = join(HOME, "session-baseline.json");
function recordBaseline() {
  let paths = [];
  try { paths = execSync("git status --porcelain --untracked-files=all", { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.slice(3).trim().replace(/^"|"$/g, "")); } catch {}
  mkdirSync(HOME, { recursive: true }); writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), paths }, null, 2));
}
function baselinePaths() { try { return new Set(JSON.parse(readFileSync(BASELINE, "utf8")).paths); } catch { return new Set(); } }
if (event === "SessionStart") { recordBaseline(); try { writeFileSync(join(HOME, "refused.json"), "{}"); } catch {} process.exit(0); }
if (!existsSync(BASELINE)) recordBaseline(); // first tool call of a session that had no SessionStart hook

function refuse(reason) { process.stderr.write(reason + "\n"); process.exit(2); }

const WORKSPACE = process.env.INBIN_GATE_WORKSPACE || process.cwd();
function protectedPath(p) {
  if (!p) return false;
  const abs = isAbsolute(p) ? p : resolve(REPO, p);
  // the gate's own files and Bob's configuration, wherever the workspace root is
  const relWs = relative(WORKSPACE, abs);
  if (/^(\.bob\/|\.bobmodes$|\.bobignore$|gate\/|\.gate\/)/.test(relWs) || /(^|\/)\.bob\//.test(abs) || /(^|\/)gate\/(hook|decide|core|consequences)\.mjs$/.test(abs)) return true;
  const rel = relative(REPO, abs);
  if (rel.startsWith("..")) return true; // outside the repository is always protected
  const globs = readPolicy().protectedFiles || [];
  return globs.some((g) => {
    const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(rel) || re.test(rel.split("/").pop());
  });
}

if (tool === "execute_command") {
  const cmd = String(input.command ?? input.cmd ?? "");
  const d = await gate("run_command", { cmd });
  if (!d.allowed) refuse(d.reason);
} else if (["write_file", "write_to_file", "apply_diff", "search_and_replace", "insert_content", "edit_file"].includes(tool)) {
  const p = String(input.path ?? input.file_path ?? "");
  const rel = isAbsolute(p) ? relative(REPO, p) : p;
  if (protectedPath(p)) {
    const d = await gate("edit_protected_file", { path: rel });
    if (!d.allowed) refuse(d.reason);
  } else if (baselinePaths().has(rel) && ["modified", "untracked"].includes(pathState(rel, REPO))) {
    const d = await gate("edit_uncommitted_file", { path: rel });
    if (!d.allowed) refuse(d.reason);
  }
}
process.exit(0);
