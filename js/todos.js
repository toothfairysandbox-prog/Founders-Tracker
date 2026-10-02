/* ============================ To-do ============================
   Tasks found in Slack, Gmail and Claude chats, kept in Firestore under
   todos/{id}. Most of them are written by the scanner (tools/todo-sync.mjs,
   run twice a day from Garrett's Mac); this page is where you and Sam check
   them off, fix them, or throw away the ones it got wrong.

   A todo looks like:
     text, owner ("garrett" | "samuel" | "both"), priority ("high" | "normal" | "low"),
     due ("YYYY-MM-DD" or null), status ("open" | "done" | "deleted"),
     sources [{kind, label, quote, url, at, ref}],
     locked {text, owner, priority, due, status}  ← set when a person changes it,
                                                    so the scanner leaves it alone
     createdAt, createdBy, doneAt, doneBy, doneNote, deletedAt, deletedBy, updatedAt

   Deleting only sets status "deleted". The record stays so the scanner can see
   it already found that task and never adds it back. */
(function(){
"use strict";

var OWNERS = [
  { id:"garrett", label:"Garrett" },
  { id:"samuel",  label:"Sam" },
  { id:"both",    label:"Both" }
];
var OWNER_LABEL = {}; OWNERS.forEach(function(o){ OWNER_LABEL[o.id] = o.label; });
var PRIORITIES = [
  { id:"high",   label:"High" },
  { id:"normal", label:"Normal" },
  { id:"low",    label:"Low" }
];
var PRIORITY_RANK = { high:0, normal:1, low:2 };
var SOURCE_LABEL = { slack:"Slack", gmail:"Gmail", claude:"Claude chat", aspen:"Aspen", manual:"Added by hand" };
/* Finished tasks stay in the main list this long, then live only under Done. */
var RECENT_DONE_DAYS = 14;

var state = {
  booted: false,
  todos: [],
  scanner: null,          // settings/todoScanner — when it last ran
  who: "all",             // all | garrett | samuel
  show: "open",           // open | done
  editingId: null,
  dirty: false            // a push arrived mid-edit; redraw once the edit ends
};
var db = null;

function $(id){ return document.getElementById(id); }
function esc(s){
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function me(){ return window.__SVC && window.__SVC.me(); }
function nowIso(){ return new Date().toISOString(); }
function todayStr(){
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function fmtDay(ymd){
  if(!ymd) return "";
  var p = ymd.split("-");
  var d = new Date(+p[0], +p[1]-1, +p[2]);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}
function fmtShort(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month:"short", day:"numeric" });
}
function fmtWhen(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
}
function isOverdue(t){ return t.status === "open" && t.due && t.due < todayStr(); }
function safeUrl(u){ return /^https?:\/\//i.test(u || "") ? u : ""; }

function toast(msg, undo){
  var old = $("todo-toast"); if(old) old.remove();
  var el = document.createElement("div");
  el.id = "todo-toast";
  el.className = "team-toast";
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button">Undo</button>' : '');
  document.body.appendChild(el);
  if(undo) el.querySelector("button").onclick = function(){ el.remove(); undo(); };
  setTimeout(function(){ if(el.parentNode) el.remove(); }, 6000);
}
function fail(err){
  var code = (err && (err.code || err.message)) || "";
  toast(/permission/i.test(code) ? "The database refused that. Is this account on the allow list?"
                                 : "Couldn't save that. " + String(code).slice(0, 80));
}

/* ---------- data ---------- */

function boot(){
  if(state.booted) return;
  var svc = window.__SVC; if(!svc) return;
  db = svc.db(); if(!db) return;
  state.booted = true;
  db.collection("todos").onSnapshot(function(snap){
    state.todos = snap.docs.map(function(d){ return Object.assign({ id:d.id }, d.data()); });
    changed();
  }, function(){ toast("Live sync for to-dos stopped. Reload the page."); });
  db.doc("settings/todoScanner").onSnapshot(function(s){
    state.scanner = s.exists ? s.data() : null;
    changed();
  });
}
/* Deferred, so a save made from inside an event handler never redraws the
   list underneath the handler that's still running. */
var queued = false;
function changed(){
  if(queued) return;
  queued = true;
  setTimeout(function(){
    queued = false;
    updateCount();
    if(state.editingId){ state.dirty = true; return; }
    if(window.__SVC && window.__SVC.section() === "todo") render();
  }, 0);
}
function updateCount(){
  var n = state.todos.filter(function(t){ return t.status === "open"; }).length;
  var c = $("nav-count-todo"); if(c) c.textContent = n || "";
}

/* Every change a person makes goes through here, and marks the field as
   theirs so the next scan doesn't put back what the scanner thought. */
function patch(id, fields, lockKeys){
  var m = me();
  var data = Object.assign({}, fields, { updatedAt: nowIso(), updatedBy: m ? m.id : "" });
  (lockKeys || []).forEach(function(k){ data["locked." + k] = true; });
  return db.collection("todos").doc(id).update(data).catch(fail);
}

function setDone(t, done){
  var m = me();
  if(done){
    return patch(t.id, { status:"done", doneAt: nowIso(), doneBy: m ? m.id : "", doneNote: "" });
  }
  /* Unchecking says "not actually done", so the scanner stops deciding. */
  return patch(t.id, { status:"open", doneAt: null, doneBy: null, doneNote: null }, ["status"]);
}
function remove(t){
  var m = me();
  var prev = t.status;
  return patch(t.id, { status:"deleted", deletedAt: nowIso(), deletedBy: m ? m.id : "" }).then(function(){
    toast("Deleted. The scanner won't add it again.", function(){
      patch(t.id, { status: prev, deletedAt: null, deletedBy: null });
    });
  });
}

/* ---------- view ---------- */

function sortOpen(a, b){
  var oa = isOverdue(a) ? 0 : 1, ob = isOverdue(b) ? 0 : 1;
  if(oa !== ob) return oa - ob;
  var pa = PRIORITY_RANK[a.priority] ?? 1, pb = PRIORITY_RANK[b.priority] ?? 1;
  if(pa !== pb) return pa - pb;
  if((a.due || "") !== (b.due || "")){
    if(!a.due) return 1; if(!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return (b.createdAt || "") < (a.createdAt || "") ? -1 : 1;
}
function byWho(t){
  if(state.who === "all") return true;
  return t.owner === state.who || t.owner === "both";
}

function sourceHtml(s){
  var kind = SOURCE_LABEL[s.kind] || "Source";
  var label = esc(kind) + (s.label ? " · " + esc(s.label) : "") + (s.at ? " · " + esc(fmtShort(s.at)) : "");
  var url = safeUrl(s.url);
  return '<div class="todo-src">' +
    '<span class="src-k src-' + esc(s.kind || "x") + '">' + esc(kind.charAt(0)) + '</span>' +
    (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + label + '</a>' : '<span>' + label + '</span>') +
    (s.quote ? '<q>' + esc(s.quote) + '</q>' : '') +
  '</div>';
}

function rowHtml(t){
  var done = t.status === "done";
  var editing = state.editingId === t.id;
  var who = t.doneBy === "scanner" ? null : t.doneBy;
  var doneLine = done
    ? '<div class="todo-done">✓ ' + (t.doneNote ? esc(t.doneNote)
        : "checked" + (who ? " by " + esc(who === "samuel" ? "Sam" : who.charAt(0).toUpperCase() + who.slice(1)) : "") +
          (t.doneAt ? ", " + esc(fmtShort(t.doneAt)) : "")) + '</div>'
    : '';
  var srcs = (t.sources || []);
  return '<div class="todo-row' + (done ? ' is-done' : '') + (isOverdue(t) ? ' is-overdue' : '') + '" data-id="' + esc(t.id) + '">' +
    '<input type="checkbox" class="todo-check" data-tact="toggle" aria-label="Done"' + (done ? ' checked' : '') + '>' +
    '<div class="todo-body">' +
      (editing
        ? '<textarea class="todo-edit" id="todo-edit-' + esc(t.id) + '" rows="2">' + esc(t.text) + '</textarea>' +
          '<div class="todo-edit-actions"><button class="btn btn-sm btn-primary" data-tact="save">Save</button>' +
          '<button class="btn btn-sm btn-ghost" data-tact="cancel">Cancel</button></div>'
        : '<button class="todo-text" data-tact="edit" title="Click to edit">' + esc(t.text) + '</button>') +
      '<div class="todo-meta">' +
        '<select class="todo-sel owner-' + esc(t.owner || "both") + '" data-tact="owner" aria-label="Owner">' +
          OWNERS.map(function(o){ return '<option value="' + o.id + '"' + (o.id === (t.owner || "both") ? ' selected' : '') + '>' + o.label + '</option>'; }).join("") +
        '</select>' +
        '<select class="todo-sel pri-' + esc(t.priority || "normal") + '" data-tact="priority" aria-label="Priority">' +
          PRIORITIES.map(function(p){ return '<option value="' + p.id + '"' + (p.id === (t.priority || "normal") ? ' selected' : '') + '>' + p.label + '</option>'; }).join("") +
        '</select>' +
        '<label class="todo-due' + (isOverdue(t) ? ' overdue' : '') + '" title="Due date">' +
          (t.due ? '<span>' + (isOverdue(t) ? 'Overdue · ' : 'Due ') + esc(fmtDay(t.due)) + '</span>' : '<span class="dim">No due date</span>') +
          '<input type="date" data-tact="due" value="' + esc(t.due || "") + '" aria-label="Due date">' +
        '</label>' +
      '</div>' +
      srcs.map(sourceHtml).join("") +
      doneLine +
    '</div>' +
    '<button class="iconbtn todo-del" data-tact="delete" title="Delete — wrong or not a task" aria-label="Delete">✕</button>' +
  '</div>';
}

function render(){
  var root = $("todo-root"); if(!root) return;
  var list = state.todos.filter(byWho);
  var open = list.filter(function(t){ return t.status === "open"; }).sort(sortOpen);
  var doneAll = list.filter(function(t){ return t.status === "done"; })
    .sort(function(a, b){ return (b.doneAt || "") < (a.doneAt || "") ? -1 : 1; });
  var cutoff = new Date(Date.now() - RECENT_DONE_DAYS * 86400000).toISOString();
  var doneRecent = doneAll.filter(function(t){ return (t.doneAt || "") >= cutoff; });

  var sc = state.scanner;
  var scanLine = sc && sc.lastRunAt
    ? 'Last scan ' + esc(fmtWhen(sc.lastRunAt)) + (sc.lastSummary ? ' · ' + esc(sc.lastSummary) : '')
    : 'Not scanned yet';

  var toolbar =
    '<div class="toolbar">' +
      '<div class="seg">' +
        ['all','garrett','samuel'].map(function(k){
          return '<button data-tact="who" data-v="' + k + '" class="' + (state.who === k ? 'active' : '') + '">' +
            ({ all:"Everyone", garrett:"Garrett", samuel:"Sam" })[k] + '</button>';
        }).join("") +
      '</div>' +
      '<div class="seg">' +
        '<button data-tact="show" data-v="open" class="' + (state.show === "open" ? 'active' : '') + '">Open <span class="gcount">' + open.length + '</span></button>' +
        '<button data-tact="show" data-v="done" class="' + (state.show === "done" ? 'active' : '') + '">Done <span class="gcount">' + doneAll.length + '</span></button>' +
      '</div>' +
      '<span class="todo-scan" title="Scans Slack, Gmail and Claude chats at 7 AM and 9 PM">' + scanLine + '</span>' +
    '</div>';

  var body = "";
  if(state.show === "open"){
    var overdue = open.filter(isOverdue), rest = open.filter(function(t){ return !isOverdue(t); });
    if(overdue.length) body += section("Overdue", overdue, "bad");
    if(rest.length) body += section("Open", rest, "");
    if(!open.length) body += '<div class="panel empty"><div class="big-ico">☑</div>Nothing open' +
      (state.who === "all" ? "" : " for " + (state.who === "samuel" ? "Sam" : "Garrett")) + '.</div>';
    if(doneRecent.length) body += section("Done in the last " + RECENT_DONE_DAYS + " days", doneRecent, "dim");
  } else {
    body = doneAll.length ? section("Done", doneAll, "dim")
                          : '<div class="panel empty"><div class="big-ico">✓</div>Nothing checked off yet.</div>';
  }
  root.innerHTML = '<div class="team-wrap">' + toolbar + body + '</div>';

  if(state.editingId){
    var ta = $("todo-edit-" + state.editingId);
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
}
function section(title, items, tone){
  return '<div class="section todo-group ' + tone + '">' +
    '<div class="section-head"><h3>' + esc(title) + ' <span class="gcount">' + items.length + '</span></h3></div>' +
    '<div class="panel">' + items.map(rowHtml).join("") + '</div></div>';
}

/* ---------- events ---------- */

function find(el){
  var row = el.closest(".todo-row");
  if(!row) return null;
  var id = row.getAttribute("data-id");
  return state.todos.find(function(t){ return t.id === id; }) || null;
}
function endEdit(){
  state.editingId = null;
  state.dirty = false;
  render();
}
function saveEdit(t){
  var ta = $("todo-edit-" + t.id);
  var text = ta ? ta.value.trim() : "";
  if(!text || text === t.text){ endEdit(); return; }
  t.text = text;               // show it now rather than flicker back to the old text
  endEdit();
  patch(t.id, { text: text }, ["text"]);
}

document.addEventListener("click", function(e){
  var root = $("todo-root");
  if(!root || !root.contains(e.target)) return;
  var el = e.target.closest("[data-tact]");
  if(!el) return;
  var act = el.getAttribute("data-tact");
  if(act === "who"){ state.who = el.getAttribute("data-v"); return render(); }
  if(act === "show"){ state.show = el.getAttribute("data-v"); return render(); }
  var t = find(el); if(!t) return;
  if(act === "edit"){ state.editingId = t.id; return render(); }
  if(act === "cancel") return endEdit();
  if(act === "save") return saveEdit(t);
  if(act === "delete") return remove(t);
});
document.addEventListener("change", function(e){
  var root = $("todo-root");
  if(!root || !root.contains(e.target)) return;
  var el = e.target.closest("[data-tact]"); if(!el) return;
  var t = find(el); if(!t) return;
  var act = el.getAttribute("data-tact");
  if(act === "toggle") return setDone(t, el.checked);
  if(act === "owner") return patch(t.id, { owner: el.value }, ["owner"]);
  if(act === "priority") return patch(t.id, { priority: el.value }, ["priority"]);
  if(act === "due") return patch(t.id, { due: el.value || null }, ["due"]);
});
document.addEventListener("keydown", function(e){
  if(!state.editingId || !e.target.classList || !e.target.classList.contains("todo-edit")) return;
  var t = state.todos.find(function(x){ return x.id === state.editingId; });
  if(e.key === "Escape"){ e.preventDefault(); endEdit(); }
  else if(e.key === "Enter" && !e.shiftKey && t){ e.preventDefault(); saveEdit(t); }
});

window.__TODOS = {
  boot: boot,
  show: function(){ boot(); render(); },
  /* For tests and the console: what's on the board right now. */
  all: function(){ return state.todos.slice(); }
};
})();
