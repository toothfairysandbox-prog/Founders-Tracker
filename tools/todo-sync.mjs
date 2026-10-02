#!/usr/bin/env node
/* todo-sync: how the twice-a-day scanner reads and writes the To-do tab.

   Runs on Garrett's Mac with a Firebase service-account key, which skips the
   sign-in the website needs. The key never goes in this repo:

     ~/.config/tooth-fairy/firebase-admin.json   (or set TF_FIREBASE_KEY)

   Commands:
     node tools/todo-sync.mjs check                  key works, database reachable
     node tools/todo-sync.mjs list                   every task as JSON, deleted ones included
     node tools/todo-sync.mjs since                  when the last scan reached (ISO), or nothing
     node tools/todo-sync.mjs apply changes.json     make the writes; --dry-run to only show them

   The rules about what may change live in todo-logic.mjs. */
import fs from "fs";
import os from "os";
import path from "path";
import { planChanges } from "./todo-logic.mjs";

const KEY = process.env.TF_FIREBASE_KEY || path.join(os.homedir(), ".config/tooth-fairy/firebase-admin.json");

async function connect() {
  if (!fs.existsSync(KEY)) {
    console.error("No Firebase key at " + KEY + ".\nSee tools/README.md for the two-minute setup.");
    process.exit(2);
  }
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const creds = JSON.parse(fs.readFileSync(KEY, "utf8"));
  initializeApp({ credential: cert(creds), projectId: creds.project_id });
  return getFirestore();
}

async function readTodos(db) {
  const snap = await db.collection("todos").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

const [cmd, arg, ...flags] = process.argv.slice(2);

if (cmd === "check") {
  const db = await connect();
  const todos = await readTodos(db);
  const st = (await db.doc("settings/todoScanner").get()).data() || {};
  console.log("OK: " + todos.length + " tasks; last scan " + (st.lastRunAt || "never"));
} else if (cmd === "list") {
  const db = await connect();
  const todos = await readTodos(db);
  /* Trimmed to what the scanner needs to decide: what exists, what's been
     deleted, what a person has taken over, and which messages are covered. */
  const out = todos.map(t => ({
    id: t.id, text: t.text, owner: t.owner, priority: t.priority, due: t.due || null,
    status: t.status, locked: Object.keys(t.locked || {}).filter(k => t.locked[k]),
    refs: (t.sources || []).map(s => s.ref).filter(Boolean),
    from: (t.sources || []).map(s => s.kind + ": " + (s.label || "")).join(" | ")
  }));
  console.log(JSON.stringify(out, null, 1));
} else if (cmd === "since") {
  const db = await connect();
  const st = (await db.doc("settings/todoScanner").get()).data() || {};
  console.log(st.lastRunAt || "");
} else if (cmd === "apply") {
  if (!arg) { console.error("usage: todo-sync.mjs apply changes.json [--dry-run]"); process.exit(1); }
  const changes = JSON.parse(fs.readFileSync(arg, "utf8"));
  const dry = flags.includes("--dry-run");
  const db = await connect();
  const existing = await readTodos(db);
  const plan = planChanges(existing, changes);
  if (dry) {
    console.log(JSON.stringify(plan, null, 1));
    process.exit(0);
  }
  const batch = db.batch();
  for (const w of plan.writes) {
    if (w.op === "add") batch.set(db.collection("todos").doc(), w.data);
    else batch.update(db.collection("todos").doc(w.id), w.data);
  }
  const now = new Date().toISOString();
  const through = changes.scannedThrough && !isNaN(Date.parse(changes.scannedThrough))
    ? new Date(changes.scannedThrough).toISOString() : now;
  batch.set(db.doc("settings/todoScanner"), { lastRunAt: through, lastAppliedAt: now, lastSummary: plan.summary }, { merge: true });
  await batch.commit();
  console.log(plan.summary + "; " + plan.skipped.length + " skipped");
  for (const s of plan.skipped) console.log("  skipped (" + s.reason + "): " + (s.item.text || s.item.id || ""));
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(cmd ? 1 : 0);
}
