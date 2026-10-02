#!/usr/bin/env node
/* chat-digest: the readable part of Garrett's recent Claude chats, for the
   To-do scanner. Reads only files already on this Mac and prints to stdout;
   nothing is sent anywhere.

     node tools/chat-digest.mjs --since 2026-10-01T21:00:00Z

   For each chat with activity since then: its title, folder and session id,
   under a "=== CHAT:" line, followed by what Garrett typed, what he picked in question prompts, and
   Claude's written replies. Tool calls, file contents and thinking are
   skipped. Every line carries a ref (session:uuid) to use as the to-do's
   source ref.

   Which chats: those in a Sandbox folder (the Tooth Fairy work) and the
   app's scratch chats (where Aspen runs). The scanner decides from the title
   and content whether a scratch chat is Tooth Fairy work; this only narrows
   the pile. */
import fs from "fs";
import os from "os";
import path from "path";

const HOME = os.homedir();
const META = path.join(HOME, "Library/Application Support/Claude/claude-code-sessions");
const PROJECTS = path.join(HOME, ".claude/projects");
const MAX_CHARS = 1500;
/* Runs of the scanner itself, so it doesn't find its own instructions. */
const SCANNER_MARK = "TODO-SCANNER-RUN";

const sinceArg = process.argv.indexOf("--since");
const since = sinceArg > -1 && process.argv[sinceArg + 1]
  ? Date.parse(process.argv[sinceArg + 1])
  : Date.now() - 14 * 86400000;
if (isNaN(since)) { console.error("--since needs an ISO date"); process.exit(1); }

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/^local_.*\.json$/.test(e.name)) out.push(p);
  }
  return out;
}
function inScope(cwd) {
  return /\/ComputerScience\/Sandbox(\/|$)/.test(cwd) || /\/Claude\/scratch-workspaces\//.test(cwd);
}
function findTranscript(cliId) {
  if (!cliId || !fs.existsSync(PROJECTS)) return null;
  for (const d of fs.readdirSync(PROJECTS)) {
    const p = path.join(PROJECTS, d, cliId + ".jsonl");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function clip(s) {
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + " …[cut]" : s;
}
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(c => c && c.type === "text").map(c => c.text).join("\n");
}

const sessions = walk(META).map(f => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}).filter(s => s && s.lastActivityAt >= since && inScope(s.cwd || ""))
  .sort((a, b) => a.lastActivityAt - b.lastActivityAt);

let printed = 0;
for (const s of sessions) {
  const file = findTranscript(s.cliSessionId);
  if (!file) continue;
  const lines = [];
  let isScanner = false;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    let d; try { d = JSON.parse(raw); } catch { continue; }
    if (d.isSidechain) continue;
    const at = Date.parse(d.timestamp || "");
    const m = d.message || {};
    let who = null, text = "";
    if (d.type === "user" && typeof m.content === "string") { who = "Garrett"; text = m.content; }
    else if (d.type === "user" && Array.isArray(m.content)) {
      /* Answers to question prompts are tool results; nothing else there is his. */
      const r = m.content.find(c => c && c.type === "tool_result");
      const t = r ? textOf(r.content) || (typeof r.content === "string" ? r.content : "") : "";
      if (/^(The user answered|Your questions have been answered|User has answered)/.test(t)) { who = "Garrett (picked)"; text = t; }
    }
    else if (d.type === "assistant") { who = "Claude"; text = textOf(m.content); }
    if (!who || !text.trim()) continue;
    if (text.includes(SCANNER_MARK)) { isScanner = true; break; }
    if (/^Base directory for this skill:/.test(text)) continue;
    if (isNaN(at) || at < since) continue;
    lines.push("[" + new Date(at).toISOString() + "] ref=claude:" + s.sessionId + ":" + (d.uuid || "") + "\n" + who + ": " + clip(text));
  }
  if (isScanner || !lines.length) continue;
  const folder = (s.cwd || "").includes("scratch-workspaces") ? "scratch chat" : (s.cwd || "").replace(HOME, "~");
  console.log("\n=== CHAT: " + (s.title || "Untitled") + "  (" + folder + ", session " + s.sessionId + ")\n");
  console.log(lines.join("\n\n"));
  printed++;
}
if (!printed) console.log("No chat activity since " + new Date(since).toISOString());
