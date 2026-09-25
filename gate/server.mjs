#!/usr/bin/env node
/**
 * Inbin Gate as an MCP server for IBM Bob.
 *
 * Bob, in the "Gated Agent" mode, can change the world only through these
 * tools. Each one asks the gate before acting. When the gate refuses, the tool
 * returns the refusal as its result so Bob can read the reason, stop, and ask
 * the developer, instead of retrying with a rephrasing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { gate, readLog, sources, REPO } from "./core.mjs";

const server = new McpServer({ name: "inbin-gate", version: "0.1.0" });
const text = (s) => ({ content: [{ type: "text", text: s }] });
const sh = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }); }
  catch (e) { return `exit ${e.status}\n${e.stdout || ""}${e.stderr || ""}`; }
};

server.tool("run_command",
  "Run a shell command in the repository. Executes only if the command is established by the developer's stated intent or by repository policy (package.json scripts, .gate/policy.json). Otherwise returns a refusal with the reason; do not retry with a rephrasing, ask the developer.",
  { cmd: z.string() },
  async ({ cmd }) => {
    const d = gate("run_command", { cmd });
    if (!d.allowed) return text(d.reason);
    return text(`ALLOWED (${d.reason})\n$ ${cmd}\n${sh(cmd)}`);
  });

server.tool("add_dependency",
  "Add an npm dependency. Executes only if the package name is established by the developer's intent or already present in the repository. Otherwise returns a refusal; ask the developer.",
  { name: z.string(), version: z.string().optional(), dev: z.boolean().optional() },
  async ({ name, version, dev }) => {
    const d = gate("add_dependency", { name });
    if (!d.allowed) return text(d.reason);
    const spec = version ? `${name}@${version}` : name;
    return text(`ALLOWED (${d.reason})\n${sh(`npm install ${dev ? "-D " : ""}${spec} --no-audit --no-fund`)}`);
  });

server.tool("edit_protected_file",
  "Write a protected file (CI, deploy, package.json, .env, .gate). Executes only if the developer's intent names the path or policy lists it as editable. Ordinary source files do not need this tool.",
  { path: z.string(), content: z.string() },
  async ({ path, content }) => {
    // containment is checked before the gate is consulted (security review W2)
    const p = resolve(REPO, path);
    if (!p.startsWith(REPO + "/")) return text("REFUSED by Inbin Gate: path escapes the repository");
    const d = gate("edit_protected_file", { path });
    if (!d.allowed) return text(d.reason);
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
    return text(`ALLOWED (${d.reason})\nwrote ${path} (${content.length} bytes)`);
  });

server.tool("git_commit_push",
  "Commit all changes and push to a branch. The branch must be established by the developer's intent or repository policy. Commit message is free text. Set INBIN_GATE_PUSH=0 to commit without pushing.",
  { branch: z.string(), message: z.string() },
  async ({ branch, message }) => {
    const d = gate("git_commit_push", { branch, message });
    if (!d.allowed) return text(d.reason);
    const out = [sh(`git checkout -B ${JSON.stringify(branch)}`), sh("git add -A"), sh(`git commit -m ${JSON.stringify(message)} --allow-empty`)];
    if (process.env.INBIN_GATE_PUSH !== "0") out.push(sh(`git push -u origin ${JSON.stringify(branch)}`));
    return text(`ALLOWED (${d.reason})\n${out.join("\n")}`);
  });

server.tool("gate_status",
  "Show what the gate currently treats as established: the developer's stated intent and the repository policy. Read this before proposing an action you are unsure about.",
  {},
  async () => {
    const s = sources();
    return text(JSON.stringify({ repo: REPO, developerIntent: s.intent, repositoryPolicy: { commands: s.policy.commands, dependencies: s.policy.dependencies, branches: s.policy.branches } }, null, 2));
  });

server.tool("gate_explain",
  "Show the last decisions the gate made, with the derivation trace for each operand. Use it to explain a refusal to the developer.",
  { last: z.number().int().min(1).max(50).optional() },
  async ({ last }) => text(JSON.stringify(readLog(last ?? 5).map((e) => ({ at: e.at, action: e.action, args: e.args, allowed: e.allowed, reason: e.reason, operands: e.operands })), null, 2)));

const transport = new StdioServerTransport();
await server.connect(transport);
