/* The rules the scanner's writes go through, kept apart from Firebase so they
   can be tested on their own (tests/ttodo-logic.mjs).

   The scanner (a scheduled Claude task) reads Slack, Gmail and Claude chats and
   writes a changes file:

     {
       "scannedThrough": "2026-10-02T21:00:00-06:00",   // next scan starts here
       "add":      [{ "text", "owner", "priority", "due", "source": {...} }],
       "update":   [{ "id", "source"?, "text"?, "owner"?, "priority"?, "due"? }],
       "complete": [{ "id", "note"?, "source"? }]
     }

   A source is { kind: slack|gmail|claude|aspen, label, quote, url, at, ref }.
   `ref` is the stable id of the message it came from (Slack ts, Gmail message
   id, chat session id + line) and is what stops the same message making the
   same task twice.

   planChanges() turns that into the writes to make, refusing anything that
   would break the promises on the To-do page:
     · a deleted task never comes back
     · a field a person changed is never overwritten
     · a task a person unchecked is never re-checked
     · the same message never adds a second copy */

export const OWNERS = ["garrett", "samuel", "both"];
export const PRIORITIES = ["high", "normal", "low"];
export const KINDS = ["slack", "gmail", "claude", "aspen"];
const KIND_LABEL = { slack: "Slack", gmail: "Gmail", claude: "Claude chat", aspen: "Aspen" };
const EDITABLE = ["text", "owner", "priority", "due"];

export function normText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanSource(s) {
  if (!s || typeof s !== "object") return null;
  const kind = KINDS.includes(s.kind) ? s.kind : null;
  if (!kind) return null;
  return {
    kind,
    label: String(s.label || "").slice(0, 120),
    quote: s.quote ? String(s.quote).slice(0, 280) : null,
    url: /^https?:\/\//i.test(s.url || "") ? String(s.url) : null,
    at: s.at && !isNaN(Date.parse(s.at)) ? new Date(s.at).toISOString() : null,
    ref: s.ref ? String(s.ref).slice(0, 200) : null
  };
}
function cleanDue(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function planChanges(existing, changes, nowIso = new Date().toISOString()) {
  const writes = [];
  const skipped = [];
  const byId = new Map(existing.map(t => [t.id, t]));
  const refOwner = new Map();          // source ref -> todo id (any status)
  for (const t of existing) for (const s of t.sources || []) if (s.ref) refOwner.set(s.ref, t.id);
  const textOwner = new Map();         // normalized text -> todo (any status)
  for (const t of existing) textOwner.set(normText(t.text), t);
  /* Sources added during this plan, so two updates in one run don't both add it. */
  const pendingSources = new Map();

  function sourcesOf(t) {
    return pendingSources.get(t.id) || (t.sources || []).slice();
  }
  function attach(t, src, data) {
    if (!src) return;
    const list = sourcesOf(t);
    if (src.ref && list.some(s => s.ref === src.ref)) return;
    list.push(src);
    pendingSources.set(t.id, list);
    if (src.ref) refOwner.set(src.ref, t.id);
    data.sources = list;
  }

  for (const a of changes.add || []) {
    const text = String(a.text || "").trim().slice(0, 300);
    const src = cleanSource(a.source);
    if (!text) { skipped.push({ reason: "empty text", item: a }); continue; }
    if (!src) { skipped.push({ reason: "missing or unknown source", item: a }); continue; }
    if (src.ref && refOwner.has(src.ref)) {
      skipped.push({ reason: "message already tracked", item: a, id: refOwner.get(src.ref) });
      continue;
    }
    const same = textOwner.get(normText(text));
    if (same && same.pending) {
      /* Twice in this same scan: one new task with both sources. */
      if (!same.pending.data.sources.some(s => src.ref && s.ref === src.ref)) same.pending.data.sources.push(src);
      if (src.ref) refOwner.set(src.ref, same.id);
      skipped.push({ reason: "merged into new task", item: a });
      continue;
    }
    if (same) {
      if (same.status === "deleted") { skipped.push({ reason: "deleted before", item: a, id: same.id }); continue; }
      /* Same task from another place: one task, two sources. */
      const data = {};
      attach(same, src, data);
      if (data.sources) writes.push({ op: "update", id: same.id, data: { ...data, updatedAt: nowIso, updatedBy: "scanner" } });
      skipped.push({ reason: "merged into existing", item: a, id: same.id });
      continue;
    }
    const doc = {
      text,
      owner: OWNERS.includes(a.owner) ? a.owner : "both",
      priority: PRIORITIES.includes(a.priority) ? a.priority : "normal",
      due: cleanDue(a.due),
      status: "open",
      sources: [src],
      locked: {},
      createdAt: nowIso,
      createdBy: "scanner",
      updatedAt: nowIso,
      updatedBy: "scanner"
    };
    const write = { op: "add", data: doc };
    writes.push(write);
    /* Later items in this same batch should see it. */
    const placeholder = { id: "__new" + writes.length, ...doc, pending: write };
    textOwner.set(normText(text), placeholder);
    if (src.ref) refOwner.set(src.ref, placeholder.id);
  }

  for (const u of changes.update || []) {
    const t = byId.get(u.id);
    if (!t) { skipped.push({ reason: "no such task", item: u }); continue; }
    if (t.status === "deleted") { skipped.push({ reason: "deleted", item: u }); continue; }
    const locked = t.locked || {};
    const data = {};
    for (const f of EDITABLE) {
      if (!(f in u)) continue;
      if (locked[f]) { skipped.push({ reason: "edited by a person: " + f, item: u }); continue; }
      let v = u[f];
      if (f === "text") { v = String(v || "").trim().slice(0, 300); if (!v) continue; }
      if (f === "owner" && !OWNERS.includes(v)) continue;
      if (f === "priority" && !PRIORITIES.includes(v)) continue;
      if (f === "due") v = cleanDue(v);
      if (t[f] !== v) data[f] = v;
    }
    attach(t, cleanSource(u.source), data);
    if (Object.keys(data).length) writes.push({ op: "update", id: t.id, data: { ...data, updatedAt: nowIso, updatedBy: "scanner" } });
  }

  for (const c of changes.complete || []) {
    const t = byId.get(c.id);
    if (!t) { skipped.push({ reason: "no such task", item: c }); continue; }
    if (t.status !== "open") { skipped.push({ reason: "not open (" + t.status + ")", item: c }); continue; }
    if ((t.locked || {}).status) { skipped.push({ reason: "a person reopened it", item: c }); continue; }
    const src = cleanSource(c.source);
    const note = c.note ? String(c.note).slice(0, 160)
      : "done per " + (src ? KIND_LABEL[src.kind] : "scan") + ", " + shortDate((src && src.at) || nowIso);
    const data = { status: "done", doneAt: nowIso, doneBy: "scanner", doneNote: note, updatedAt: nowIso, updatedBy: "scanner" };
    attach(t, src, data);
    writes.push({ op: "update", id: t.id, data });
  }

  const added = writes.filter(w => w.op === "add").length;
  const done = writes.filter(w => w.data.status === "done").length;
  const summary = [added + " added", done + " checked off"].join(", ");
  return { writes, skipped, summary };
}
