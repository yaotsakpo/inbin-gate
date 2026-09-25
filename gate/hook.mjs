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
import { readFileSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";
import { gate, readPolicy, REPO } from "./core.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const tool = payload.tool_name ?? payload.tool ?? "";
const input = payload.tool_input ?? payload.input ?? {};

function refuse(reason) { process.stderr.write(reason + "\n"); process.exit(2); }

function protectedPath(p) {
  if (!p) return false;
  const rel = isAbsolute(p) ? relative(REPO, p) : p;
  if (rel.startsWith("..")) return true; // outside the repository is always protected
  const globs = readPolicy().protectedFiles || [];
  return globs.some((g) => {
    const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(rel) || re.test(rel.split("/").pop());
  });
}

if (tool === "execute_command") {
  const cmd = String(input.command ?? input.cmd ?? "");
  const d = gate("run_command", { cmd });
  if (!d.allowed) refuse(d.reason);
} else if (["write_file", "write_to_file", "apply_diff", "search_and_replace", "insert_content", "edit_file"].includes(tool)) {
  const p = String(input.path ?? input.file_path ?? "");
  if (protectedPath(p)) {
    const d = gate("edit_protected_file", { path: isAbsolute(p) ? relative(REPO, p) : p });
    if (!d.allowed) refuse(d.reason);
  }
}
process.exit(0);
