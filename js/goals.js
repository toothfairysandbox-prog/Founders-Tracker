/* ===================== goal setting ===================== */

(function(){
"use strict";

/* ============================ config ============================ */

/* ============================ who may sign in ============================
   Map each GOOGLE ACCOUNT EMAIL to an identity. The two founders own the two
   columns; "team" is a shared account with full access and no column of its
   own. This same list is repeated in firestore.rules — change both together. */
var MEMBERS = {
  "samuelgibby89@gmail.com":    "samuel",
  "garrettwoodhouse@gmail.com": "garrett",
  "toothfairysandbox@gmail.com":"team"
};

var PEOPLE = [
  {id:"samuel", name:"Samuel", initials:"S"},
  {id:"garrett", name:"Garrett", initials:"G"}
];
/* Build night: one evening of shipping software together. Tasks are shared —
   no per-person columns — and each is either a must-ship or a stretch. */
var TIERS = [{id:"must", label:"Must ship"}, {id:"stretch", label:"Stretch"}];
var CLAIM_ORDER = ["", "samuel", "garrett", "both"];
function tierLabel(id){ return id==="stretch" ? "Stretch" : "Must ship"; }

/* Who was in the room for a note. */
var WHO = [
  {id:"founders", label:"Founders",       chip:"Founders"},
  {id:"owners",   label:"Business owners",chip:"Business owners"},
  {id:"us",       label:"Just us",        chip:"Just us"}
];
function whoLabel(id){
  for(var i=0;i<WHO.length;i++){ if(WHO[i].id===id) return WHO[i].chip; }
  return WHO[1].chip;
}
var DEFAULT_CATEGORIES = ["Product","Engineering","Fundraising","GTM","Hiring","Ops","Personal"];
var CATEGORIES = DEFAULT_CATEGORIES.slice();
var DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
var STATUS_LABEL = {red:"Not complete", yellow:"Partially complete", green:"Complete"};
/* Priority is a forcing function, not a label: exactly one Critical goal per
   person per week. Promoting a second demotes the first. */
var PRIOS = [
  {v:1, name:"Critical", chip:"Critical"},
  {v:2, name:"High",     chip:"High"},
  {v:3, name:"Normal",   chip:""}
];
function prioOf(g){ var p = parseInt(g.priority,10); return (p===1||p===2) ? p : 3; }

/* A shared account that can see and edit everything but has no column of its
   own — the board is two founders wide by design. Its display name comes from
   whatever Google name the account signs in with; "Team" until it first does. */
var TEAM = {id:"team", name:"Team", initials:"T"};
var ROSTER = PEOPLE.concat([TEAM]);

function initialsOf(name){
  var parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return "T";
  if(parts.length === 1) return parts[0].slice(0,1).toUpperCase();
  return (parts[0].slice(0,1) + parts[parts.length-1].slice(0,1)).toUpperCase();
}
function personById(id){
  for(var i=0;i<PEOPLE.length;i++){ if(PEOPLE[i].id===id) return PEOPLE[i]; }
  if(id === TEAM.id){
    var nm = (state.profiles[TEAM.id] || {}).displayName || TEAM.name;
    return {id:TEAM.id, name:nm, initials:initialsOf(nm)};
  }
  return PEOPLE[0];
}
function otherOf(id){ return id===PEOPLE[0].id ? PEOPLE[1] : PEOPLE[0]; }

/* ============================ dates ============================ */
function mondayOf(d){
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d,n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function pad(n){ return n<10 ? "0"+n : ""+n; }
function keyOf(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function isoWeek(d){
  var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay()+6)%7));
  var firstThu = new Date(t.getFullYear(),0,4);
  firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay()+6)%7));
  return 1 + Math.round((t - firstThu)/604800000);
}
var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function rangeLabel(mon){
  var sun = addDays(mon,6);
  var a = MONTHS[mon.getMonth()]+" "+mon.getDate();
  var b = (mon.getMonth()===sun.getMonth() ? "" : MONTHS[sun.getMonth()]+" ") + sun.getDate();
  return a+" – "+b;
}
function parseISO(s){
  if(!s || typeof s!=="string") return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(!m) return null;
  return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
}
function todayStart(){ var n=new Date(); return new Date(n.getFullYear(),n.getMonth(),n.getDate()); }
/* A goal's due date: the stored ISO date, or a legacy day-of-week index
   resolved against the week it lives in. */
function dueDateOf(g, weekMon){
  if(g.dueDate) return parseISO(g.dueDate);
  if(g.dueDay!==null && g.dueDay!==undefined && g.dueDay!=="") return addDays(weekMon, g.dueDay);
  return null;
}
function dueISOof(g, weekMon){
  var d = dueDateOf(g, weekMon);
  return d ? keyOf(d) : "";
}
function dueLabel(d, weekMon){
  var sameWeek = d >= weekMon && d <= addDays(weekMon,6);
  var dow = DAYS[(d.getDay()+6)%7];
  return sameWeek ? dow : dow+" "+MONTHS[d.getMonth()]+" "+d.getDate();
}
function timeLabel(ts){
  var d = new Date(ts), now = new Date();
  var sameDay = d.toDateString()===now.toDateString();
  var hh = d.getHours()%12 || 12, mm = pad(d.getMinutes());
  var ampm = d.getHours()<12 ? "am" : "pm";
  if(sameDay) return hh+":"+mm+ampm;
  return DAYS[(d.getDay()+6)%7]+" "+hh+":"+mm+ampm;
}

/* ============================ state ============================ */
var state = {
  week: mondayOf(new Date()),
  view: "both",
  me: null,
  goals: [],
  open: {},          // goalId -> true
  drafts: {},        // draftKey -> string
  adding: {},        // personId -> true
  newCat: {},        // personId -> category chosen in the composer
  newDate: {},       // personId -> ISO date chosen in the composer
  newPrio: {},       // personId -> priority chosen in the composer
  profiles: {},      // personId -> {photoURL, displayName} shared via the database
  builds: [],        // build-night sessions, newest first
  buildSel: null,    // selected session id
  buildTasks: [],    // tasks for the selected session
  openTasks: {},     // taskId -> true
  addingTask: false,
  sessionForm: null, // "new", a session id, or null
  newTier: "must",
  notes: [],         // call notes and findings, newest first
  openNotes: {},     // noteId -> true (details expanded)
  editingNote: null, // "new", a note id, or null
  noteWho: "owners",
  noteDate: "",
  noteId: null,      // id of the note being edited — assigned up front so a file
                     // uploaded before the first save already has a home
  noteFiles: [],     // attachments on the note being edited (metadata only)
  noteAdded: [],     // paths uploaded during THIS edit, so Cancel can clean up
  noteRemoved: [],   // paths dropped during THIS edit, deleted only once you Save
  uploads: {},       // tempId -> {name, size, pct, error} while in flight
  attErr: "",
  cloud: false,
  loaded: false
};
try{
  var savedMe = localStorage.getItem("flw.me");
  if(savedMe) state.me = savedMe;
  var savedView = localStorage.getItem("flw.view");
  if(savedView) state.view = savedView;
}catch(e){}

/* ============================ storage ============================ */
/* One document per goal at weeks/<mondayKey>/goals/<goalId>.
   Falls back to this browser's local storage when the shared store
   is not available to this viewer. */
var db = null, unsub = null;
var LKEY = "flw.goals.v1";
var storageOk = true;   // false once this browser refuses to keep local data
var lastError = null;   // last failed write, surfaced in the banner

function localAll(){
  try{ return JSON.parse(localStorage.getItem(LKEY)||"{}") || {}; }
  catch(e){ storageOk=false; return {}; }
}
function localSave(o){
  try{ localStorage.setItem(LKEY, JSON.stringify(o)); return true; }
  catch(e){ storageOk=false; noteError("storage_full"); return false; }
}
/* Every write is mirrored here, even when the shared store is live, so a
   second copy of the board always exists in this browser. */
function localPut(wk, body){
  var all=localAll(); if(!all[wk]) all[wk]={};
  all[wk][body.id]=body; return localSave(all);
}
function localDel(wk, id){
  var all=localAll(); if(all[wk]) delete all[wk][id];
  return localSave(all);
}
function localWeek(wk){
  var all=localAll(), bucket=all[wk]||{}, arr=[];
  for(var k in bucket){ if(Object.prototype.hasOwnProperty.call(bucket,k)) arr.push(bucket[k]); }
  return arr;
}

function noteError(code){ lastError = code || "unknown"; renderStatusline(); }
function clearError(){ if(lastError){ lastError=null; renderStatusline(); } }
function onWriteFail(e){ noteError(e && e.code ? e.code : "unknown"); }

function goalsPath(wk){ return "weeks/"+wk+"/goals"; }

function loadWeek(){
  var wk = keyOf(state.week);
  if(unsub){ try{unsub();}catch(e){} unsub=null; }
  if(db){
    unsub = db.collection(goalsPath(wk)).onSnapshot(function(snap){
      var out=[], seen={};
      for(var i=0;i<snap.docs.length;i++){
        var d=snap.docs[i]; if(!d.exists) continue;
        var body=d.data()||{}; body.id=d.id; seen[d.id]=true; out.push(body);
      }
      // Anything this browser holds that the shared store hasn't accepted yet
      // stays on screen rather than vanishing.
      var mine = localWeek(wk);
      for(var j=0;j<mine.length;j++){ if(!seen[mine[j].id]) out.push(mine[j]); }
      state.goals = out; state.loaded = true; clearError(); render();
    }, function(e){
      noteError(e && e.code ? e.code : "unavailable");
      state.goals = localWeek(wk); render();
    });
  } else {
    state.goals = localWeek(wk); state.loaded = true; render();
  }
}
function readWeekOnce(wk){
  if(db){
    return db.collection(goalsPath(wk)).get().then(function(snap){
      var out=[];
      for(var i=0;i<snap.docs.length;i++){ var b=snap.docs[i].data()||{}; b.id=snap.docs[i].id; out.push(b); }
      return out;
    }).catch(function(e){ onWriteFail(e); return localWeek(wk); });
  }
  return Promise.resolve(localWeek(wk));
}
function writeGoal(wk, goal){
  var body = {
    id:goal.id,
    owner:goal.owner, title:goal.title, category:goal.category,
    description:goal.description||"",
    dueDate:goal.dueDate||null,
    dueDay:(goal.dueDay===null||goal.dueDay===undefined)?null:goal.dueDay,
    priority: prioOf(goal),
    status:goal.status||null, reflection:goal.reflection||"",
    comments:goal.comments||[], createdAt:goal.createdAt||Date.now(),
    sort:goal.sort||goal.createdAt||Date.now()
  };
  localPut(wk, body);                       // always keep the local copy
  if(db) return db.doc(goalsPath(wk)+"/"+goal.id).set(body).then(clearError, onWriteFail);
  loadWeek(); return Promise.resolve();
}
function removeGoal(wk, id){
  localDel(wk, id);
  if(db) return db.doc(goalsPath(wk)+"/"+id).delete().then(clearError, onWriteFail);
  loadWeek(); return Promise.resolve();
}
/* Push every locally-held goal the shared store doesn't have yet. Runs on
   every connect, across all weeks — not just the one on screen. */
function syncUp(){
  if(!db) return Promise.resolve(0);
  var all = localAll(), weeks = [], moved = 0;
  for(var wk in all){ if(all.hasOwnProperty(wk)) weeks.push(wk); }
  var chain = Promise.resolve();
  weeks.forEach(function(wk){
    chain = chain.then(function(){
      return db.collection(goalsPath(wk)).get().then(function(snap){
        var have = {};
        for(var i=0;i<snap.docs.length;i++) have[snap.docs[i].id] = true;
        var bucket = all[wk], ops = [];
        for(var gid in bucket){
          if(bucket.hasOwnProperty(gid) && !have[gid]){
            ops.push(db.doc(goalsPath(wk)+"/"+gid).set(bucket[gid]));
          }
        }
        moved += ops.length;
        return Promise.all(ops);
      });
    }).catch(function(e){ onWriteFail(e); });
  });
  chain = chain.then(function(){
    return db.collection("notes").get().then(function(snap){
      var have = {};
      for(var i=0;i<snap.docs.length;i++) have[snap.docs[i].id] = true;
      var mine = localNotes(), ops = [];
      for(var nid in mine){
        if(Object.prototype.hasOwnProperty.call(mine,nid) && !have[nid]){
          ops.push(db.doc("notes/"+nid).set(mine[nid]));
        }
      }
      moved += ops.length;
      return Promise.all(ops);
    });
  }).catch(function(e){ onWriteFail(e); });
  return chain.then(function(){ return moved; });
}
function newId(){ return "g"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function newNoteId(){ return "n"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

/* ---- build nights ----
   A session is one evening; its tasks hang under it. Shared, not per-person. */
var BSKEY = "flw.buildsessions.v1", BTKEY = "flw.buildtasks.v1";
var unsubBuilds = null, unsubBuildTasks = null;
function newSessionId(){ return "b"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function newTaskId(){ return "t"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function readLS(key){
  try{ return JSON.parse(localStorage.getItem(key)||"{}") || {}; }
  catch(e){ storageOk=false; return {}; }
}
function writeLS(key, o){
  try{ localStorage.setItem(key, JSON.stringify(o)); return true; }
  catch(e){ storageOk=false; noteError("storage_full"); return false; }
}
function byDateDesc(x, y){
  var dx=x.date||"", dy=y.date||"";
  if(dx!==dy) return dx < dy ? 1 : -1;
  return (y.createdAt||0)-(x.createdAt||0);
}
function sessionsList(){
  var o = readLS(BSKEY), a = [];
  for(var k in o){ if(Object.prototype.hasOwnProperty.call(o,k)) a.push(o[k]); }
  return a.sort(byDateDesc);
}
function tasksFor(sid){
  var all = readLS(BTKEY), b = all[sid] || {}, a = [];
  for(var k in b){ if(Object.prototype.hasOwnProperty.call(b,k)) a.push(b[k]); }
  return a;
}
function sortTasks(a){
  a.sort(function(x,y){
    var tx = (x.tier==="stretch")?1:0, ty = (y.tier==="stretch")?1:0;
    if(tx!==ty) return tx-ty;
    return (x.sort||0)-(y.sort||0);
  });
  return a;
}
function pickSession(){
  if(state.buildSel){
    for(var i=0;i<state.builds.length;i++){ if(state.builds[i].id===state.buildSel) return; }
  }
  state.buildSel = state.builds.length ? state.builds[0].id : null;
}
function loadBuilds(){
  if(unsubBuilds){ try{unsubBuilds();}catch(e){} unsubBuilds=null; }
  function settle(list){ state.builds = list; pickSession(); loadBuildTasks(); render(); }
  if(db){
    unsubBuilds = db.collection("buildnights").onSnapshot(function(snap){
      var out=[], seen={};
      for(var i=0;i<snap.docs.length;i++){
        var d=snap.docs[i]; if(!d.exists) continue;
        var body=d.data()||{}; body.id=d.id; seen[d.id]=true; out.push(body);
      }
      var mine = sessionsList();
      for(var j=0;j<mine.length;j++){ if(!seen[mine[j].id]) out.push(mine[j]); }
      clearError(); settle(out.sort(byDateDesc));
    }, function(e){ noteError(e && e.code ? e.code : "unavailable"); settle(sessionsList()); });
  } else {
    settle(sessionsList());
  }
}
function loadBuildTasks(){
  if(unsubBuildTasks){ try{unsubBuildTasks();}catch(e){} unsubBuildTasks=null; }
  var sid = state.buildSel;
  if(!sid){ state.buildTasks = []; return; }
  if(db){
    unsubBuildTasks = db.collection("buildnights/"+sid+"/tasks").onSnapshot(function(snap){
      var out=[], seen={};
      for(var i=0;i<snap.docs.length;i++){
        var d=snap.docs[i]; if(!d.exists) continue;
        var body=d.data()||{}; body.id=d.id; seen[d.id]=true; out.push(body);
      }
      var mine = tasksFor(sid);
      for(var j=0;j<mine.length;j++){ if(!seen[mine[j].id]) out.push(mine[j]); }
      state.buildTasks = sortTasks(out); clearError(); render();
    }, function(e){
      noteError(e && e.code ? e.code : "unavailable");
      state.buildTasks = sortTasks(tasksFor(sid)); render();
    });
  } else {
    state.buildTasks = sortTasks(tasksFor(sid));
  }
}
function writeSession(s){
  var body = {
    id:s.id, date:s.date||keyOf(todayStart()), label:s.label||"",
    createdAt:s.createdAt||Date.now(), updatedAt:Date.now()
  };
  var all = readLS(BSKEY); all[body.id] = body; writeLS(BSKEY, all);
  if(db) return db.doc("buildnights/"+body.id).set(body).then(clearError, onWriteFail);
  loadBuilds(); return Promise.resolve();
}
function removeSession(id){
  var all = readLS(BSKEY); delete all[id]; writeLS(BSKEY, all);
  var lt = readLS(BTKEY); delete lt[id]; writeLS(BTKEY, lt);
  if(db){
    // Tasks hang under the session doc — clear them so none are left orphaned.
    var kill = state.buildTasks.map(function(x){
      return db.doc("buildnights/"+id+"/tasks/"+x.id).delete().catch(function(){});
    });
    return Promise.all(kill).then(function(){
      return db.doc("buildnights/"+id).delete().then(clearError, onWriteFail);
    });
  }
  loadBuilds(); return Promise.resolve();
}
function writeTask(sid, t){
  var body = {
    id:t.id, title:t.title||"", description:t.description||"",
    tier:t.tier||"must", claim:t.claim||"", status:t.status||null,
    createdAt:t.createdAt||Date.now(), sort:t.sort||t.createdAt||Date.now()
  };
  var all = readLS(BTKEY); if(!all[sid]) all[sid]={};
  all[sid][body.id] = body; writeLS(BTKEY, all);
  if(db) return db.doc("buildnights/"+sid+"/tasks/"+body.id).set(body).then(clearError, onWriteFail);
  loadBuildTasks(); return Promise.resolve();
}
function removeTask(sid, id){
  var all = readLS(BTKEY); if(all[sid]) delete all[sid][id]; writeLS(BTKEY, all);
  if(db) return db.doc("buildnights/"+sid+"/tasks/"+id).delete().then(clearError, onWriteFail);
  loadBuildTasks(); return Promise.resolve();
}
function findTask(id){
  for(var i=0;i<state.buildTasks.length;i++){ if(state.buildTasks[i].id===id) return state.buildTasks[i]; }
  return null;
}
function currentSession(){
  for(var i=0;i<state.builds.length;i++){ if(state.builds[i].id===state.buildSel) return state.builds[i]; }
  return null;
}

/* ---- notes ----
   Notes are NOT week-scoped. What you learn on a call outlives the week it
   happened in, so they live in one flat collection, newest first, each
   stamped with its own date. */
var NKEY = "flw.notes.v1";
var unsubNotes = null;
function localNotes(){
  try{ return JSON.parse(localStorage.getItem(NKEY)||"{}") || {}; }
  catch(e){ storageOk=false; return {}; }
}
function localNotesSave(o){
  try{ localStorage.setItem(NKEY, JSON.stringify(o)); return true; }
  catch(e){ storageOk=false; noteError("storage_full"); return false; }
}
function localNotesList(){
  var o = localNotes(), a = [];
  for(var k in o){ if(Object.prototype.hasOwnProperty.call(o,k)) a.push(o[k]); }
  return a;
}
function sortNotes(a){
  a.sort(function(x,y){
    var dx = x.date||"0000-00-00", dy = y.date||"0000-00-00";
    if(dx !== dy) return dx < dy ? 1 : -1;          // newest date first
    return (y.createdAt||0) - (x.createdAt||0);
  });
  return a;
}
function loadNotes(){
  if(unsubNotes){ try{unsubNotes();}catch(e){} unsubNotes=null; }
  if(db){
    unsubNotes = db.collection("notes").onSnapshot(function(snap){
      var out=[], seen={};
      for(var i=0;i<snap.docs.length;i++){
        var d=snap.docs[i]; if(!d.exists) continue;
        var body=d.data()||{}; body.id=d.id; seen[d.id]=true; out.push(body);
      }
      var mine = localNotesList();
      for(var j=0;j<mine.length;j++){ if(!seen[mine[j].id]) out.push(mine[j]); }
      state.notes = sortNotes(out); clearError(); render();
    }, function(e){
      noteError(e && e.code ? e.code : "unavailable");
      state.notes = sortNotes(localNotesList()); render();
    });
  } else {
    state.notes = sortNotes(localNotesList()); render();
  }
}
function findNote(id){
  for(var i=0;i<state.notes.length;i++){ if(state.notes[i].id===id) return state.notes[i]; }
  return null;
}
function writeNote(n){
  var body = {
    id:n.id,
    title:n.title||"", who:n.who||"owners", people:n.people||"",
    takeaways:n.takeaways||"", details:n.details||"",
    files:n.files||[],
    date:n.date||keyOf(todayStart()),
    author:n.author||state.me||"samuel",
    createdAt:n.createdAt||Date.now(), updatedAt:Date.now()
  };
  var all = localNotes(); all[body.id] = body; localNotesSave(all);
  if(db) return db.doc("notes/"+body.id).set(body).then(clearError, onWriteFail);
  loadNotes(); return Promise.resolve();
}
function removeNote(id){
  var all = localNotes(); delete all[id]; localNotesSave(all);
  if(db) return db.doc("notes/"+id).delete().then(clearError, onWriteFail);
  loadNotes(); return Promise.resolve();
}

/* ---- shared profiles (Google name + picture, one doc per founder) ----
   Each founder writes their own on sign-in; both read both, so Samuel sees
   Garrett's picture once Garrett has signed in at least once. */
var unsubProfiles = null;
function loadProfiles(){
  if(!db) return;
  if(unsubProfiles){ try{unsubProfiles();}catch(e){} unsubProfiles=null; }
  unsubProfiles = db.collection("profiles").onSnapshot(function(snap){
    var out = {};
    for(var i=0;i<snap.docs.length;i++){
      var d = snap.docs[i];
      if(d.exists) out[d.id] = d.data() || {};
    }
    state.profiles = out;
    render();
  }, function(){});
}
function saveProfile(pid, photoURL, displayName){
  if(!db) return;
  var cur = state.profiles[pid] || {};
  if(cur.photoURL === (photoURL||"") && cur.displayName === (displayName||"")) return;
  db.doc("profiles/"+pid).set({
    photoURL: photoURL || "",
    displayName: displayName || "",
    updatedAt: Date.now()
  }).catch(function(){});
}

/* ---- shared settings (category list) ---- */
var SKEY = "flw.settings.v1";
var unsubSettings = null;
function applySettings(obj){
  if(obj && Object.prototype.toString.call(obj.categories)==="[object Array]" && obj.categories.length){
    CATEGORIES = obj.categories.slice();
  }
}
function loadSettings(){
  if(db){
    if(unsubSettings){ try{unsubSettings();}catch(e){} }
    unsubSettings = db.doc("settings/app").onSnapshot(function(snap){
      if(snap.exists){ applySettings(snap.data()); render(); }
    }, function(){});
  } else {
    try{ applySettings(JSON.parse(localStorage.getItem(SKEY)||"null")); }catch(e){}
  }
}
function saveSettings(){
  var body = {categories:CATEGORIES.slice(), updatedAt:Date.now()};
  if(db) return db.doc("settings/app").set(body).catch(function(){});
  try{ localStorage.setItem(SKEY, JSON.stringify(body)); }catch(e){}
  return Promise.resolve();
}

/* ============================ helpers ============================ */
function esc(s){
  return String(s===null||s===undefined?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
/* Ranked: priority first, then the nearest target date, then entry order. */
/* An avatar is the founder's Google picture when we have one, their initials
   otherwise — and it falls back to initials if the image fails to load. */
function avatarHtml(pid, base){
  var p = personById(pid), prof = state.profiles[pid] || {};
  var cls = base || "avatar";
  if(prof.photoURL){
    return '<span class="'+cls+' has-photo" title="'+esc(prof.displayName||p.name)+'">'+
             '<img src="'+esc(prof.photoURL)+'" alt="" referrerpolicy="no-referrer" '+
             'data-fallback="'+esc(p.initials)+'">'+
           '</span>';
  }
  return '<span class="'+cls+'">'+esc(p.initials)+'</span>';
}
document.addEventListener("error", function(e){
  var t = e.target;
  if(t && t.tagName === "IMG" && t.getAttribute("data-fallback") !== null){
    var holder = t.parentNode;
    if(holder){
      holder.textContent = t.getAttribute("data-fallback");
      holder.classList.remove("has-photo");
    }
  }
}, true);

function goalsFor(pid){
  var out = state.goals.filter(function(g){ return g.owner===pid; });
  out.sort(function(a,b){
    var pa = prioOf(a), pb = prioOf(b);
    if(pa!==pb) return pa-pb;
    var da = dueISOof(a, state.week) || "9999-99-99";
    var dbb = dueISOof(b, state.week) || "9999-99-99";
    if(da!==dbb) return da < dbb ? -1 : 1;
    return (a.sort||0)-(b.sort||0);
  });
  return out;
}
function criticalFor(pid){
  var list = state.goals;
  for(var i=0;i<list.length;i++){
    if(list[i].owner===pid && prioOf(list[i])===1) return list[i];
  }
  return null;
}
/* Setting a Critical goal demotes whatever held the slot. */
function setPriority(g, p){
  var wk = keyOf(state.week), demoted = null;
  if(p===1){
    var held = criticalFor(g.owner);
    if(held && held.id!==g.id){ held.priority = 2; demoted = held; writeGoal(wk, held); }
  }
  g.priority = p;
  writeGoal(wk, g);
  render();
  if(demoted) flash('Only one critical goal a week — "'+demoted.title.slice(0,40)+'" moved to High.');
}
function tally(list){
  var t={green:0,yellow:0,red:0,none:0,total:list.length};
  for(var i=0;i<list.length;i++){
    var s=list[i].status;
    if(s==="green") t.green++; else if(s==="yellow") t.yellow++;
    else if(s==="red") t.red++; else t.none++;
  }
  t.pct = t.total ? Math.round(((t.green + t.yellow*0.5)/t.total)*100) : 0;
  return t;
}
function findGoal(id){
  for(var i=0;i<state.goals.length;i++){ if(state.goals[i].id===id) return state.goals[i]; }
  return null;
}

/* ============================ render ============================ */
var boardEl = document.getElementById("board");
var scoreEl = document.getElementById("scorecard");

function render(){
  renderHeader();
  renderScorecard();
  renderBoard();
  renderStatusline();
  restoreDrafts();
}

function renderHeader(){
  var notesView = state.view === "notes";
  var buildView = state.view === "build";
  var offBoard = notesView || buildView;
  /* The week stepper and the category manager belong to the goal board; on the
     other tabs they'd be controls for nothing. */
  document.getElementById("prevWeek").hidden = offBoard;
  document.getElementById("nextWeek").hidden = offBoard;
  document.getElementById("catBtn").hidden = offBoard;

  if(offBoard){
    document.getElementById("weekNum").textContent = notesView ? "NOTES" : "BUILD NIGHT";
    document.getElementById("weekRange").textContent = notesView ? "Calls & findings" : "Ship it tonight";
    document.getElementById("todayBtn").hidden = true;
  } else {
    document.getElementById("weekNum").textContent =
      "W" + isoWeek(state.week) + " · " + state.week.getFullYear();
    document.getElementById("weekRange").textContent = rangeLabel(state.week);
    var thisWk = keyOf(mondayOf(new Date()));
    document.getElementById("todayBtn").hidden = (keyOf(state.week)===thisWk);
  }

  var me = state.me ? personById(state.me) : null;
  document.getElementById("idchip").innerHTML = me
    ? '<span class="avatar">'+esc(me.initials)+'</span>Signed in as <strong>'+esc(me.name)+'</strong>'+
      '<button id="switchMe" type="button">'+(authMode==="firebase"?"Sign out":"Switch")+'</button>'
    : '';
  var sw = document.getElementById("switchMe");
  if(sw) sw.addEventListener("click", function(){
    if(authMode==="firebase" && window.__FB){ window.__FB.signOut(); }
    else { askIdentity(true); }
  });
}

/* The single most important line on the page: is the one thing that had to
   happen this week actually happening? */
function criticalLine(pid){
  var g = criticalFor(pid);
  if(!g){
    return '<div class="crit empty"><span class="lab">◆ Critical</span>'+
           '<span class="val">Nothing named yet this week</span></div>';
  }
  var s = g.status || "none";
  var word = s==="green" ? "Complete" : s==="yellow" ? "Partial" : s==="red" ? "Missed" : "Unmarked";
  return '<div class="crit"><span class="lab">◆ Critical</span>'+
         '<span class="val" title="'+esc(g.title)+'">'+esc(g.title)+'</span>'+
         '<span class="st '+s+'">'+word+'</span></div>';
}
function renderScorecard(){
  if(state.view === "notes" || state.view === "build"){ scoreEl.innerHTML = ""; return; }
  var people = state.view==="both" ? PEOPLE : [personById(state.view)];
  var html = "";
  for(var i=0;i<people.length;i++){
    var p = people[i], t = tally(goalsFor(p.id));
    var seg = "";
    if(t.total===0){
      seg = '<span class="n" style="flex:1"></span>';
    } else {
      if(t.green) seg += '<span class="g" style="flex:'+t.green+'"></span>';
      if(t.yellow) seg += '<span class="y" style="flex:'+t.yellow+'"></span>';
      if(t.red) seg += '<span class="r" style="flex:'+t.red+'"></span>';
      if(t.none) seg += '<span class="n" style="flex:'+t.none+'"></span>';
    }
    html +=
      '<div class="score">'+
        '<div class="score-head">'+
          avatarHtml(p.id)+
          '<span class="name">'+esc(p.name)+'</span>'+
          '<span class="pct">'+t.pct+'%</span>'+
        '</div>'+
        '<div class="bar">'+seg+'</div>'+
        '<div class="legend">'+
          '<span><i style="background:var(--green)"></i>'+t.green+' complete</span>'+
          '<span><i style="background:var(--amber)"></i>'+t.yellow+' partial</span>'+
          '<span><i style="background:var(--red)"></i>'+t.red+' missed</span>'+
          '<span><i style="background:var(--line-2)"></i>'+t.none+' unmarked</span>'+
        '</div>'+
        criticalLine(p.id)+
      '</div>';
  }
  scoreEl.innerHTML = html;
}

function statusButtons(g, act){
  var order = ["red","yellow","green"], out = "";
  act = act || "status";
  for(var i=0;i<order.length;i++){
    var s = order[i], on = g.status===s;
    out += '<button class="light" data-s="'+s+'" data-act="'+act+'" data-id="'+esc(g.id)+'" '+
           'aria-pressed="'+(on?"true":"false")+'" '+
           'title="'+STATUS_LABEL[s]+(on?" (click to clear)":"")+'" '+
           'aria-label="'+STATUS_LABEL[s]+'"><span class="dot"></span></button>';
  }
  return out;
}

function commentsHtml(g){
  var cs = g.comments||[], out = "";
  for(var i=0;i<cs.length;i++){
    var c = cs[i], who = personById(c.author);
    out +=
      '<div class="comment">'+
        avatarHtml(c.author, "av")+
        '<div class="comment-body">'+
          '<div class="comment-head">'+
            '<span class="who">'+esc(who.name)+'</span>'+
            '<span class="when">'+esc(timeLabel(c.ts))+'</span>'+
            (state.me===c.author ? '<button class="del" data-act="delcomment" data-id="'+esc(g.id)+'" data-cid="'+esc(c.id)+'">Delete</button>' : '')+
          '</div>'+
          '<p>'+esc(c.text)+'</p>'+
        '</div>'+
      '</div>';
  }
  return out;
}

function goalHtml(g){
  var isOpen = !!state.open[g.id];
  var count = (g.comments||[]).length;
  var mine = state.me===g.owner;
  var due = "", d = dueDateOf(g, state.week);
  if(d){
    var overdue = g.status!=="green" && d < todayStart();
    due = '<span class="due'+(overdue?" past":"")+'">Due '+esc(dueLabel(d, state.week))+'</span>';
  }
  var p = prioOf(g), pchip = "";
  if(p===1) pchip = '<button class="prio p1" data-act="cycleprio" data-id="'+esc(g.id)+'" title="Critical — click to lower">'+
                    '<span class="mk">◆</span>Critical</button>';
  else if(p===2) pchip = '<button class="prio p2" data-act="cycleprio" data-id="'+esc(g.id)+'" title="High — click to lower">High</button>';
  var desc = (g.description||"").trim();
  var html =
    '<li class="goal'+(isOpen?" open":"")+'" data-status="'+esc(g.status||"none")+'" data-prio="'+p+'">'+
      '<span class="rail"></span>'+
      '<div class="goal-row">'+
        '<div class="goal-main">'+
          '<button class="goal-title" data-act="toggle" data-id="'+esc(g.id)+'" aria-expanded="'+(isOpen?"true":"false")+'">'+esc(g.title)+'</button>'+
          (desc ? '<p class="goal-desc">'+esc(desc)+'</p>' : '')+
          '<div class="goal-meta">'+
            pchip +
            '<span class="cat">'+esc(g.category)+'</span>'+ due +
            '<button class="chatbtn'+(count?" has":"")+'" data-act="toggle" data-id="'+esc(g.id)+'" aria-expanded="'+(isOpen?"true":"false")+'">'+
              '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-5a8.4 8.4 0 0 1-.8-3.6 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.5 7.5z"/></svg>'+
              (count ? count+(count===1?" comment":" comments") : "Comment")+
            '</button>'+
          '</div>'+
        '</div>'+
        '<div class="lights">'+statusButtons(g)+'</div>'+
      '</div>';

  if(isOpen){
    var otherName = otherOf(g.owner).name;
    var ph = mine
      ? "Add a note for yourself…"
      : "Feedback or encouragement for "+personById(g.owner).name+"…";
    html +=
      '<div class="detail">'+
        '<div class="field">'+
          '<label>Priority</label>'+
          prioSet(g.id, prioOf(g))+
        '</div>'+
        '<div class="field">'+
          '<label for="ref-'+esc(g.id)+'">End-of-week reflection</label>'+
          '<textarea id="ref-'+esc(g.id)+'" data-draft="ref:'+esc(g.id)+'" data-act="reflection" data-id="'+esc(g.id)+'" '+
            'placeholder="What actually happened? What got in the way?">'+esc(g.reflection||"")+'</textarea>'+
        '</div>'+
        '<div class="field">'+
          '<label>Feedback thread</label>'+
          '<div class="thread">'+
            (commentsHtml(g) || '<div class="due" style="padding:2px 0">No comments yet.</div>')+
            '<div class="composer">'+
              '<textarea data-draft="cmt:'+esc(g.id)+'" placeholder="'+esc(ph)+'" style="min-height:52px"></textarea>'+
              '<div class="row">'+
                '<button class="btn" data-act="comment" data-id="'+esc(g.id)+'">Post comment</button>'+
                '<span class="due">Posting as '+esc(state.me?personById(state.me).name:"—")+'</span>'+
              '</div>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div class="detail-actions">'+
          '<button class="btn ghost" data-act="edit" data-id="'+esc(g.id)+'">Edit goal</button>'+
          '<span class="spacer"></span>'+
          '<button class="btn danger" data-act="delete" data-id="'+esc(g.id)+'">Delete</button>'+
        '</div>'+
      '</div>';
  }
  html += '</li>';
  return html;
}

function categoryOptions(sel){
  var list = CATEGORIES.slice();
  if(sel && list.indexOf(sel)===-1) list.push(sel); // keep a retired label selectable
  var out="";
  for(var i=0;i<list.length;i++){
    out += '<option value="'+esc(list[i])+'"'+(list[i]===sel?" selected":"")+'>'+esc(list[i])+'</option>';
  }
  return out;
}
/* Three-way priority control. `scope` is a goal id, or "new:<person>". */
function prioSet(scope, cur){
  var out = '<div class="prioset" role="group" aria-label="Priority">';
  for(var i=0;i<PRIOS.length;i++){
    var p = PRIOS[i];
    out += '<button type="button" data-act="setprio" data-scope="'+esc(scope)+'" data-prio="'+p.v+'" '+
           'aria-pressed="'+(cur===p.v?"true":"false")+'">'+p.name+'</button>';
  }
  return out+'</div>';
}
/* Date input + one-click chips for the days of the displayed week. */
function dateField(scope, iso){
  var chips = "";
  for(var i=0;i<DAYS.length;i++){
    var d = addDays(state.week,i), v = keyOf(d);
    chips += '<button type="button" data-act="setday" data-scope="'+esc(scope)+'" data-date="'+v+'" '+
             'aria-pressed="'+(iso===v?"true":"false")+'">'+DAYS[i]+'</button>';
  }
  chips += '<button type="button" class="clear" data-act="setday" data-scope="'+esc(scope)+'" data-date="">No date</button>';
  return '<div class="datefield">'+
    '<input type="date" data-date="'+esc(scope)+'" value="'+esc(iso||"")+'" aria-label="Target date">'+
    '<div class="daychips">'+chips+'</div>'+
  '</div>';
}

function addRowHtml(p){
  if(!state.adding[p.id]){
    return '<div class="addrow"><button class="add-open" data-act="openadd" data-p="'+esc(p.id)+'">'+
             '<span class="plus">+</span> Add a goal for '+esc(p.name)+'</button></div>';
  }
  return '<div class="addrow"><div class="addform">'+
    '<input type="text" data-draft="new:'+esc(p.id)+'" data-p="'+esc(p.id)+'" placeholder="What will '+esc(p.name)+' get done this week?">'+
    '<textarea data-draft="newdesc:'+esc(p.id)+'" style="min-height:54px" '+
      'placeholder="Detail (optional) — context, what done looks like, links"></textarea>'+
    '<select data-newcat="'+esc(p.id)+'">'+categoryOptions(state.newCat[p.id]||CATEGORIES[0])+'</select>'+
    prioSet("new:"+p.id, state.newPrio[p.id]||3)+
    dateField("new:"+p.id, state.newDate[p.id]||"")+
    '<div class="row">'+
      '<button class="btn" data-act="createconfirm" data-p="'+esc(p.id)+'">Add goal</button>'+
      '<button class="btn ghost" data-act="canceladd" data-p="'+esc(p.id)+'">Cancel</button>'+
    '</div>'+
  '</div></div>';
}

function emptyHtml(p){
  return '<div class="empty">'+
    '<p class="blurb">No goals logged for '+esc(p.name)+' this week yet. Three to six is the sweet spot — specific enough that Friday\'s red / yellow / green is obvious.</p>'+
    '<span class="tagline">Example</span>'+
    '<div class="ghost"><span class="gt">Ship the v2 onboarding flow to 10% of users</span><span class="gd"><i style="background:var(--red)"></i><i style="background:var(--amber)"></i><i style="background:var(--green)"></i></span></div>'+
    '<div class="ghost"><span class="gt">Five intro calls with seed funds on the target list</span><span class="gd"><i style="background:var(--red)"></i><i style="background:var(--amber)"></i><i style="background:var(--green)"></i></span></div>'+
    '<div class="ghost"><span class="gt">Close the senior backend req — offer out by Thursday</span><span class="gd"><i style="background:var(--red)"></i><i style="background:var(--amber)"></i><i style="background:var(--green)"></i></span></div>'+
  '</div>';
}

function columnHtml(p){
  var list = goalsFor(p.id);
  var body = list.length
    ? '<ul class="goals">'+list.map(goalHtml).join("")+'</ul>'
    : emptyHtml(p);
  var mine = state.me===p.id;
  return '<section class="col">'+
    '<div class="col-head">'+
      avatarHtml(p.id)+
      '<span class="name">'+esc(p.name)+'</span>'+
      '<span class="tag">'+(mine?"You":"Co-founder")+'</span>'+
      '<button class="carry" data-act="carry" data-p="'+esc(p.id)+'">Carry over unfinished</button>'+
    '</div>'+
    body +
    addRowHtml(p)+
  '</section>';
}

/* ---------- build night ---------- */
function longDate(iso){
  var d = parseISO(iso);
  if(!d) return "";
  return DAYS[(d.getDay()+6)%7]+" · "+MONTHS[d.getMonth()]+" "+d.getDate()+
         (d.getFullYear()!==new Date().getFullYear() ? ", "+d.getFullYear() : "");
}
function claimHtml(t){
  var c = t.claim || "";
  if(c === "both"){
    return '<button class="claim" data-act="cycleclaim" data-id="'+esc(t.id)+'" title="Both — click to change">'+
             '<span class="pair">'+avatarHtml("samuel")+avatarHtml("garrett")+'</span>Both</button>';
  }
  if(c === "samuel" || c === "garrett"){
    var p = personById(c);
    return '<button class="claim" data-act="cycleclaim" data-id="'+esc(t.id)+'" title="'+esc(p.name)+' — click to change">'+
             avatarHtml(c)+esc(p.name)+'</button>';
  }
  return '<button class="claim none" data-act="cycleclaim" data-id="'+esc(t.id)+'" title="Unclaimed — click to claim">Unclaimed</button>';
}
function taskHtml(t){
  var isOpen = !!state.openTasks[t.id];
  var desc = (t.description||"").trim();
  var tier = t.tier === "stretch" ? "stretch" : "must";
  var html =
    '<li class="goal'+(isOpen?" open":"")+'" data-status="'+esc(t.status||"none")+'" data-prio="'+(tier==="must"?"1":"3")+'">'+
      '<span class="rail"></span>'+
      '<div class="goal-row">'+
        '<div class="goal-main">'+
          '<button class="goal-title" data-act="togtask" data-id="'+esc(t.id)+'" aria-expanded="'+(isOpen?"true":"false")+'">'+
            esc(t.title)+'</button>'+
          (desc ? '<p class="goal-desc">'+esc(desc)+'</p>' : '')+
          '<div class="goal-meta">'+
            '<button class="tier tier-'+tier+'" data-act="cycletier" data-id="'+esc(t.id)+'" '+
              'title="'+esc(tierLabel(tier))+' — click to change">'+esc(tierLabel(tier))+'</button>'+
            claimHtml(t)+
          '</div>'+
        '</div>'+
        '<div class="lights">'+statusButtons(t, "tstatus")+'</div>'+
      '</div>';
  if(isOpen){
    html +=
      '<div class="detail">'+
        '<div class="field">'+
          '<label for="td-'+esc(t.id)+'">Detail</label>'+
          '<textarea id="td-'+esc(t.id)+'" data-draft="td:'+esc(t.id)+'" data-act="taskdesc" data-id="'+esc(t.id)+'" '+
            'placeholder="What does done look like? Anything blocking it?">'+esc(t.description||"")+'</textarea>'+
        '</div>'+
        '<div class="detail-actions">'+
          '<button class="btn ghost" data-act="renametask" data-id="'+esc(t.id)+'">Rename</button>'+
          '<span class="spacer"></span>'+
          '<button class="btn danger" data-act="deltask" data-id="'+esc(t.id)+'">Delete</button>'+
        '</div>'+
      '</div>';
  }
  return html + '</li>';
}
function sessionFormHtml(s){
  s = s || {};
  return '<div class="session-form">'+
    '<div class="grid">'+
      '<div><label class="tiny">Date</label>'+
        '<input type="date" id="sf-date" value="'+esc(state.sessionDate||keyOf(todayStart()))+'"></div>'+
      '<div><label class="tiny">Name (optional)</label>'+
        '<input type="text" data-draft="sf-label" placeholder="e.g. Auth + billing night"></div>'+
    '</div>'+
    '<div class="row" style="display:flex;gap:8px">'+
      '<button class="btn" data-act="savesession">'+(s.id?"Save":"Start build night")+'</button>'+
      '<button class="btn ghost" data-act="cancelsession">Cancel</button>'+
    '</div>'+
  '</div>';
}
function renderBuild(){
  boardEl.className = "build-wrap";
  var sel = currentSession();

  var opts = state.builds.map(function(s){
    var lbl = longDate(s.date) + (s.label ? " · "+s.label : "");
    return '<option value="'+esc(s.id)+'"'+(s.id===state.buildSel?" selected":"")+'>'+esc(lbl)+'</option>';
  }).join("");

  var html = '<div class="build-bar">'+
    (state.builds.length ? '<select id="buildSel" aria-label="Build night">'+opts+'</select>' : '')+
    (state.sessionForm ? '' : '<button class="btn'+(state.builds.length?" ghost":"")+'" data-act="newsession">New build night</button>')+
    (sel && !state.sessionForm ? '<span class="spacer"></span>'+
      '<button class="btn danger" data-act="delsession" data-id="'+esc(sel.id)+'">Delete night</button>' : '')+
  '</div>';

  if(state.sessionForm) html += sessionFormHtml(state.sessionForm==="new" ? null : sel);

  if(!sel){
    if(!state.sessionForm){
      html += '<div class="col"><div class="build-empty">'+
        'No build night yet. Start one, then list what the two of you are shipping tonight — '+
        'must-ships first, stretch goals after. Same red / yellow / green as the weekly board, '+
        'but one shared list instead of two columns.</div></div>';
    }
    boardEl.innerHTML = html;
    return;
  }

  var t = tally(state.buildTasks);
  var seg = "";
  if(!t.total){ seg = '<span class="n" style="flex:1"></span>'; }
  else {
    if(t.green) seg += '<span class="g" style="flex:'+t.green+'"></span>';
    if(t.yellow) seg += '<span class="y" style="flex:'+t.yellow+'"></span>';
    if(t.red) seg += '<span class="r" style="flex:'+t.red+'"></span>';
    if(t.none) seg += '<span class="n" style="flex:'+t.none+'"></span>';
  }
  var mustLeft = state.buildTasks.filter(function(x){
    return (x.tier||"must")!=="stretch" && x.status!=="green";
  }).length;

  html += '<section class="col">'+
    '<div class="build-head">'+
      '<span class="when">'+esc(longDate(sel.date))+'</span>'+
      (sel.label ? '<span class="label">'+esc(sel.label)+'</span>' : '')+
      '<span class="pct">'+t.pct+'%</span>'+
    '</div>'+
    '<div class="build-prog">'+
      '<div class="bar">'+seg+'</div>'+
      '<div class="legend">'+
        '<span><i style="background:var(--green)"></i>'+t.green+' shipped</span>'+
        '<span><i style="background:var(--amber)"></i>'+t.yellow+' partial</span>'+
        '<span><i style="background:var(--red)"></i>'+t.red+' stuck</span>'+
        '<span><i style="background:var(--line-2)"></i>'+t.none+' not started</span>'+
        (mustLeft ? '<span style="color:var(--accent)">'+mustLeft+' must-ship left</span>' : '')+
      '</div>'+
    '</div>'+
    (state.buildTasks.length
      ? '<ul class="goals">'+state.buildTasks.map(taskHtml).join("")+'</ul>'
      : '<div class="build-empty">Nothing on the list yet. What are you shipping tonight?</div>')+
    '<div class="addrow">'+
      (state.addingTask
        ? '<div class="addform">'+
            '<input type="text" data-draft="bt-title" placeholder="What are we building?">'+
            '<textarea data-draft="bt-desc" style="min-height:52px" placeholder="Detail (optional)"></textarea>'+
            '<div class="tierset" role="group" aria-label="Tier">'+
              TIERS.map(function(x){
                return '<button type="button" data-act="settier" data-t="'+x.id+'" '+
                       'aria-pressed="'+(state.newTier===x.id?"true":"false")+'">'+esc(x.label)+'</button>';
              }).join("")+
            '</div>'+
            '<div class="row">'+
              '<button class="btn" data-act="addtask">Add</button>'+
              '<button class="btn ghost" data-act="canceltask">Cancel</button>'+
            '</div>'+
          '</div>'
        : '<button class="add-open" data-act="opentask"><span class="plus">+</span> Add something to build</button>')+
    '</div>'+
  '</section>';

  boardEl.innerHTML = html;
  var selEl = document.getElementById("buildSel");
  if(selEl) selEl.addEventListener("change", function(){
    state.buildSel = this.value; state.openTasks = {}; loadBuildTasks(); render();
  });
}

/* ---- attachments on notes ----
   Metadata (name, size, path) rides along on the note document in Firestore.
   The bytes themselves live in Firebase Storage. A note therefore stays small
   and loads fast whether it has no files or nine. */
/* The extension itself is the icon. Tried glyphs first; at this size a PDF, a
   spreadsheet and a deck all looked like the same little box. */
function attTag(f){
  var m = /\.([A-Za-z0-9]{1,5})$/.exec(f.name || "");
  return (m ? m[1] : "file").toUpperCase().slice(0, 4);
}
function att(){ return window.__ATT || null; }

function findFileMeta(fid){
  for(var i=0;i<state.noteFiles.length;i++){
    if(state.noteFiles[i].fid === fid) return state.noteFiles[i];
  }
  for(var j=0;j<state.notes.length;j++){
    var fl = state.notes[j].files || [];
    for(var k=0;k<fl.length;k++){ if(fl[k].fid === fid) return fl[k]; }
  }
  return null;
}

function attachEditorHtml(){
  var A = att();
  if(!A || !A.configured()){
    return '<div class="att-off">Attachments need the shared database, and this board is '+
           'running offline right now. Files can be added once it reconnects \u2014 the dot '+
           'at the bottom of the page shows which mode you\u2019re in.</div>';
  }
  var html = '<div class="att-drop" id="attDrop">'+
      '<button type="button" class="btn ghost" data-act="attpick">Choose files</button>'+
      '<span class="att-hint">or drop them here · up to '+esc(A.humanSize(A.maxBytes))+' each</span>'+
      '<input type="file" id="attInput" multiple accept="'+esc(A.accept)+'" hidden>'+
    '</div>';
  /* Only worth saying once there's something to say. The ceiling is shared with
     everything else in the database, so it's better seen coming than hit. */
  var use = A.usage(state.notes, state.noteFiles);
  if(use.bytes > 0){
    var nearFull = use.bytes > use.cap * 0.8;
    html += '<div class="att-use'+(nearFull?" warn":"")+'">'+
      esc(A.humanSize(use.bytes))+' of '+esc(A.humanSize(use.cap))+' used across all notes'+
      (nearFull ? ' \u2014 getting full' : '')+'</div>';
  }
  if(state.attErr) html += '<div class="att-err">'+esc(state.attErr)+'</div>';

  html += '<div class="att-list">';
  for(var k in state.uploads){
    if(!Object.prototype.hasOwnProperty.call(state.uploads,k)) continue;
    var u = state.uploads[k];
    html += '<div class="att-row pending" data-up="'+esc(k)+'">'+
        '<span class="att-ico">'+Math.round((u.pct||0)*100)+'%</span>'+
        '<span class="att-name">'+esc(u.name)+'</span>'+
        '<span class="att-bar"><i style="width:'+Math.round((u.pct||0)*100)+'%"></i></span>'+
      '</div>';
  }
  for(var i=0;i<state.noteFiles.length;i++) html += attRowHtml(state.noteFiles[i], true);
  html += '</div>';
  return html;
}

function attRowHtml(f, editable){
  var A = att();
  return '<div class="att-row">'+
    '<span class="att-ico att-'+esc(f.kind||"file")+'">'+esc(attTag(f))+'</span>'+
    '<button type="button" class="att-name" data-act="attopen" '+
      'data-fid="'+esc(f.fid||f.id)+'" data-fn="'+esc(f.name)+'" '+
      'data-kind="'+esc(f.kind||"file")+'">'+esc(f.name)+'</button>'+
    '<span class="att-size">'+esc(A ? A.humanSize(f.size) : "")+'</span>'+
    (editable
      ? '<button type="button" class="att-x" data-act="attdel" data-fid="'+esc(f.id)+'" '+
        'title="Remove" aria-label="Remove '+esc(f.name)+'">×</button>'
      : '')+
  '</div>';
}

/* Read-only strip under a saved note. */
function attStripHtml(n){
  var files = n.files || [];
  if(!files.length) return '';
  var html = '<div class="att-strip">';
  for(var i=0;i<files.length;i++) html += attRowHtml(files[i], false);
  return html + '</div>';
}

function attStartUploads(fileList){
  var A = att(); if(!A) return;
  state.attErr = "";
  var noteId = state.noteId || (state.noteId = newNoteId());
  var list = Array.prototype.slice.call(fileList || []);

  list.forEach(function(file){
    var problem = A.check(file);
    if(problem){ state.attErr = problem; render(); return; }

    var tmp = "u" + Math.random().toString(36).slice(2, 9);
    state.uploads[tmp] = { name: file.name, size: file.size, pct: 0 };
    render();

    A.upload(file, noteId, function(pct){
      var u = state.uploads[tmp]; if(!u) return;
      u.pct = pct;
      /* Patch the one bar rather than re-rendering — a full render on every
         progress event would blow away focus and make typing impossible. */
      var row = document.querySelector('[data-up="'+tmp+'"]');
      if(!row) return;
      var bar = row.querySelector(".att-bar i");
      if(bar) bar.style.width = Math.round(pct*100) + "%";
      var tag = row.querySelector(".att-ico");
      if(tag) tag.textContent = Math.round(pct*100) + "%";
    }).then(function(meta){
      delete state.uploads[tmp];
      state.noteFiles = state.noteFiles.concat([meta]);
      state.noteAdded = state.noteAdded.concat([meta]);
      render();
    }, function(err){
      delete state.uploads[tmp];
      state.attErr = (err && err.message) || "Upload failed.";
      render();
    });
  });
}

function noteFormHtml(n){
  n = n || {};
  return '<div class="note"><div class="noteform">'+
    '<input type="text" data-draft="nf-title" placeholder="What was this? e.g. Call with Dr. Gibby">'+
    '<div class="field">'+
      '<label>Who was involved</label>'+
      '<div class="whoset" role="group" aria-label="Who was involved">'+
        WHO.map(function(w){
          return '<button type="button" data-act="setwho" data-w="'+w.id+'" '+
                 'aria-pressed="'+(state.noteWho===w.id?"true":"false")+'">'+esc(w.label)+'</button>';
        }).join("")+
      '</div>'+
      '<input type="text" data-draft="nf-people" placeholder="Names (optional)" style="margin-top:8px">'+
    '</div>'+
    '<div class="field"><label>Main takeaways</label>'+
      '<textarea data-draft="nf-takeaways" style="min-height:100px" '+
      'placeholder="What did we learn? What needs did they describe?"></textarea></div>'+
    '<div class="field"><label>Additional details</label>'+
      '<textarea data-draft="nf-details" style="min-height:90px" '+
      'placeholder="Anything else worth keeping — quotes, numbers, follow-ups"></textarea></div>'+
    '<div class="field"><label>Attachments</label>'+ attachEditorHtml() +'</div>'+
    '<div class="field"><label>Date</label>'+
      '<input type="date" id="nf-date" value="'+esc(state.noteDate||keyOf(todayStart()))+'" style="max-width:220px"></div>'+
    '<div class="row">'+
      '<button class="btn" data-act="savenote">'+(n.id ? "Save changes" : "Add note")+'</button>'+
      '<button class="btn ghost" data-act="cancelnote">Cancel</button>'+
    '</div>'+
  '</div></div>';
}

function noteHtml(n){
  var isOpen = !!state.openNotes[n.id];
  var d = parseISO(n.date);
  var dateLabel = d ? (MONTHS[d.getMonth()]+" "+d.getDate()+(d.getFullYear()!==new Date().getFullYear()?", "+d.getFullYear():"")) : "";
  var by = personById(n.author||"samuel");
  var details = (n.details||"").trim();
  var takeaways = (n.takeaways||"").trim();
  return '<article class="note'+(isOpen?" open":"")+'">'+
    '<div class="note-head">'+
      '<button class="note-title" data-act="tognote" data-id="'+esc(n.id)+'" aria-expanded="'+(isOpen?"true":"false")+'">'+
        esc(n.title||"Untitled note")+'</button>'+
      '<span class="note-date">'+esc(dateLabel)+'</span>'+
    '</div>'+
    '<div class="note-meta">'+
      '<span class="who who-'+esc(n.who||"owners")+'">'+esc(whoLabel(n.who))+'</span>'+
      (n.people ? '<span class="note-people">'+esc(n.people)+'</span>' : '')+
      '<span class="note-by">'+avatarHtml(by.id)+esc(by.name)+'</span>'+
    '</div>'+
    (takeaways
      ? '<div class="note-sec clamp"><label>Main takeaways</label><p>'+esc(takeaways)+'</p></div>'
      : '')+
    (isOpen && details
      ? '<div class="note-sec"><label>Additional details</label><p>'+esc(details)+'</p></div>'
      : '')+
    attStripHtml(n)+
    (!isOpen && (details || (takeaways.length > 180))
      ? '<button class="note-more" data-act="tognote" data-id="'+esc(n.id)+'">Read more'+(details?" · details":"")+'</button>'
      : '')+
    (isOpen
      ? '<div class="note-actions">'+
          '<button class="btn ghost" data-act="editnote" data-id="'+esc(n.id)+'">Edit</button>'+
          '<span class="spacer"></span>'+
          '<button class="btn danger" data-act="delnote" data-id="'+esc(n.id)+'">Delete</button>'+
        '</div>'
      : '')+
  '</article>';
}

function renderNotes(){
  boardEl.className = "notes-wrap";
  var n = state.notes.length;
  var html = '<div class="notes-bar">'+
      '<span class="count">'+n+' note'+(n===1?"":"s")+'</span>'+
      (state.editingNote ? '' : '<button class="btn" data-act="newnote">New note</button>')+
    '</div>';

  if(state.editingNote === "new") html += noteFormHtml(null);

  if(!n && !state.editingNote){
    html += '<div class="notes-empty">'+
      '<p>Nothing logged yet. This is where calls go — what a business owner told you, '+
      'the need they described, what you\'d want to remember three months from now.</p>'+
      '<p style="color:var(--ink-3)">Each note takes a title, who was in the room, the main '+
      'takeaways, and any extra detail.</p></div>';
  }

  for(var i=0;i<state.notes.length;i++){
    var note = state.notes[i];
    html += (state.editingNote === note.id) ? noteFormHtml(note) : noteHtml(note);
  }
  boardEl.innerHTML = html;
}

function renderBoard(){
  if(state.view === "notes"){ renderNotes(); return; }
  if(state.view === "build"){ renderBuild(); return; }
  var people = state.view==="both" ? PEOPLE : [personById(state.view)];
  boardEl.className = "board " + (people.length===2 ? "two" : "one");
  boardEl.innerHTML = people.map(columnHtml).join("");
}

var ERR_TEXT = {
  storage_full: "This browser refused to store the board locally.",
  invalid_argument: "The shared store rejected the write.",
  quota_exceeded: "The shared store is full.",
  resource_exhausted: "Too many writes at once — slow down and retry.",
  revoked: "Access to the shared store was withdrawn.",
  not_granted: "The shared store was not granted to this view.",
  unavailable: "The database is unreachable right now.",
  "permission-denied": "This account isn't allowed to write to this board.",
  unauthenticated: "You're signed out. Sign in again to save.",
  "failed-precondition": "The database rejected the write.",
  "not-found": "The database or document is missing.",
  "resource-exhausted": "Daily database quota reached — it resets overnight."
};
function renderStatusline(){
  document.getElementById("statusline").innerHTML = state.cloud
    ? '<span class="dot"></span> Shared workspace — saved to the shared store and mirrored in this browser.'
    : '<span class="dot local"></span> Saved in this browser only — the shared workspace is not available on this view.';
  renderBanner();
}
function renderBanner(){
  var el = document.getElementById("banner"), html = "", bad = false;
  if(authMode === "pending" || signedOut){
    el.hidden = true; el.innerHTML = ""; return;
  }
  if(lastError){
    bad = true;
    html = '<div class="btxt"><b>A save just failed.</b>'+
           '<span class="sub">'+esc(ERR_TEXT[lastError] || ("Error: "+lastError))+
           ' Your goals are still on screen. Back them up before closing this tab.</span></div>'+
           '<button class="bact" data-act="backup">Back up</button>';
  } else if(!state.cloud && state.loaded){
    html = '<div class="btxt"><b>This board is saved in your browser only.</b>'+
           '<span class="sub">Nothing here reaches Garrett yet. If you are signed in, the database is '+
           'unreachable right now — your work is safe locally and syncs on its own once it reconnects.</span></div>'+
           '<button class="bact" data-act="backup">Back up</button>';
  }
  el.innerHTML = html;
  el.className = "banner" + (bad ? " bad" : "");
  el.hidden = !html;
}

/* ---- backup / restore ---- */
function openData(){
  var payload = JSON.stringify({
    app:"founders-week-ledger", version:2, exportedAt:new Date().toISOString(),
    categories:CATEGORIES, weeks:localAll(), notes:localNotes()
  }, null, 1);
  var count = 0, all = localAll();
  for(var w in all){ if(all.hasOwnProperty(w)) count += Object.keys(all[w]).length; }
  var noteCount = Object.keys(localNotes()).length;

  var scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true" aria-label="Back up or restore">'+
    '<h2>Backup</h2>'+
    '<p>'+count+' goal'+(count===1?"":"s")+' and '+noteCount+' note'+(noteCount===1?"":"s")+
    ' held in this browser. Copy this text somewhere safe, '+
    'or paste a previous backup in and restore it.</p>'+
    '<textarea class="data" id="dataBox" spellcheck="false">'+esc(payload)+'</textarea>'+
    '<div class="modal-foot" style="margin-top:12px">'+
      '<button class="btn" id="dataCopy">Copy</button>'+
      '<button class="btn ghost" id="dataRestore">Restore from text</button>'+
      '<button class="btn ghost" id="dataClose">Close</button>'+
      '<span class="hint" id="dataNote"></span>'+
    '</div>'+
  '</div>';
  (document.getElementById("goals-overlays")||document.body).appendChild(scrim);
  var box = scrim.querySelector("#dataBox"), note = scrim.querySelector("#dataNote");
  box.focus(); box.select();

  scrim.querySelector("#dataCopy").addEventListener("click", function(){
    box.focus(); box.select();
    var ok = false;
    try{ ok = document.execCommand("copy"); }catch(e){}
    note.textContent = ok ? "Copied." : "Press Ctrl/Cmd+C to copy.";
  });
  scrim.querySelector("#dataClose").addEventListener("click", function(){ scrim.remove(); });
  scrim.addEventListener("click", function(e){ if(e.target===scrim) scrim.remove(); });
  scrim.querySelector("#dataRestore").addEventListener("click", function(){
    var parsed;
    try{ parsed = JSON.parse(box.value); }
    catch(e){ note.textContent = "That isn't valid backup text."; return; }
    if(!parsed || !parsed.weeks){ note.textContent = "No weeks found in that backup."; return; }
    var all = localAll(), added = 0;
    for(var wk in parsed.weeks){
      if(!parsed.weeks.hasOwnProperty(wk)) continue;
      if(!all[wk]) all[wk] = {};
      var bucket = parsed.weeks[wk];
      for(var gid in bucket){
        if(bucket.hasOwnProperty(gid) && !all[wk][gid]){ all[wk][gid] = bucket[gid]; added++; }
      }
    }
    localSave(all);
    if(parsed.notes){
      var an = localNotes(), addedN = 0;
      for(var nid in parsed.notes){
        if(Object.prototype.hasOwnProperty.call(parsed.notes,nid) && !an[nid]){ an[nid]=parsed.notes[nid]; addedN++; }
      }
      localNotesSave(an); added += addedN;
    }
    if(parsed.categories && parsed.categories.length){ CATEGORIES = parsed.categories.slice(); saveSettings(); }
    syncUp().then(function(){ loadWeek(); loadNotes(); });
    scrim.remove();
    flash("Restored "+added+" goal"+(added===1?"":"s")+".");
  });
}
document.getElementById("dataBtn").addEventListener("click", openData);

/* draft text survives re-renders */
function restoreDrafts(){
  var nodes = document.querySelectorAll("[data-draft]");
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i], k=n.getAttribute("data-draft");
    if(state.drafts[k] !== undefined && n.value !== state.drafts[k]) n.value = state.drafts[k];
  }
  if(focusKey){
    var t = document.querySelector('[data-draft="'+focusKey+'"]');
    if(t){ t.focus(); if(t.setSelectionRange) try{ t.setSelectionRange(t.value.length,t.value.length); }catch(e){} }
  }
}
var focusKey = null;
/* Reflections save as you type (debounced), not only when you click away —
   otherwise typing one and closing the tab would lose it. */
var reflTimer = null, reflPending = null;
function scheduleReflection(id, value){
  reflPending = {id:id, value:value};
  if(reflTimer) clearTimeout(reflTimer);
  reflTimer = setTimeout(flushReflection, 700);
}
function flushReflection(){
  if(reflTimer){ clearTimeout(reflTimer); reflTimer = null; }
  var pend = reflPending; reflPending = null;
  if(!pend) return;
  var g = findGoal(pend.id);
  if(g && (g.reflection||"") !== pend.value){
    g.reflection = pend.value;
    writeGoal(keyOf(state.week), g);
    markSaved(pend.id);
  }
}
function markSaved(id){
  var lab = document.querySelector('label[for="ref-'+id+'"]');
  if(!lab || lab.dataset.busy) return;
  var original = lab.textContent;
  lab.dataset.busy = "1";
  lab.textContent = original + " · Saved";
  setTimeout(function(){
    if(lab.isConnected) lab.textContent = original;
    delete lab.dataset.busy;
  }, 1600);
}
window.addEventListener("pagehide", flushReflection);
document.addEventListener("visibilitychange", function(){
  if(document.hidden) flushReflection();
});

document.addEventListener("input", function(e){
  var k = e.target.getAttribute && e.target.getAttribute("data-draft");
  if(k) state.drafts[k] = e.target.value;
  if(e.target.getAttribute && e.target.getAttribute("data-act")==="reflection"){
    scheduleReflection(e.target.getAttribute("data-id"), e.target.value);
  }
});
document.addEventListener("change", function(e){
  var t = e.target;
  if(!t.getAttribute) return;
  var scope = t.getAttribute("data-date");
  if(scope && t.type==="date"){
    if(scope.indexOf("new:")===0){
      state.newDate[scope.slice(4)] = t.value;
      syncDayChips(scope, t.value);
    }
    return;
  }
  if(t.id === "attInput"){
    attStartUploads(t.files);
    t.value = "";           /* so picking the same file twice still fires */
    return;
  }
  if(t.id === "nf-date"){ state.noteDate = t.value; return; }
  if(t.id === "sf-date"){ state.sessionDate = t.value; return; }
  var newcat = t.getAttribute("data-newcat");
  if(newcat) state.newCat[newcat] = t.value;
});
/* Keep the quick-pick chips in step with the date input without a full re-render,
   so the open composer never loses what's already typed in it. */
function syncDayChips(scope, iso){
  var chips = document.querySelectorAll('[data-act="setday"][data-scope="'+scope+'"]');
  for(var i=0;i<chips.length;i++){
    var v = chips[i].getAttribute("data-date");
    chips[i].setAttribute("aria-pressed", (v && v===iso) ? "true" : "false");
  }
}
/* Drag-and-drop onto the note form.
   The document-level preventDefault matters: without it, a file dropped an inch
   off target makes the browser navigate to it, and the half-written note is
   gone. So while a note form is open we swallow drops everywhere and only act
   on the ones that land in the box. */
function attDropZone(e){
  if(state.editingNote === null) return null;
  var t = e.target;
  return (t && t.closest) ? t.closest("#attDrop") : null;
}
document.addEventListener("dragover", function(e){
  if(state.editingNote === null) return;
  e.preventDefault();
  var zone = attDropZone(e);
  var box = document.getElementById("attDrop");
  if(box) box.classList.toggle("over", !!zone);
});
document.addEventListener("dragleave", function(e){
  if(!e.relatedTarget){
    var box = document.getElementById("attDrop");
    if(box) box.classList.remove("over");
  }
});
document.addEventListener("drop", function(e){
  if(state.editingNote === null) return;
  e.preventDefault();
  var box = document.getElementById("attDrop");
  if(box) box.classList.remove("over");
  if(!attDropZone(e)) return;
  if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
    attStartUploads(e.dataTransfer.files);
  }
});

document.addEventListener("focusin", function(e){
  var k = e.target.getAttribute && e.target.getAttribute("data-draft");
  focusKey = k || null;
});
document.addEventListener("focusout", function(e){
  if(e.target.getAttribute && e.target.getAttribute("data-act")==="reflection"){
    scheduleReflection(e.target.getAttribute("data-id"), e.target.value);
    flushReflection();
  }
  if(e.target.getAttribute && e.target.getAttribute("data-act")==="taskdesc"){
    var tdT = findTask(e.target.getAttribute("data-id"));
    if(tdT && (tdT.description||"") !== e.target.value){
      tdT.description = e.target.value;
      writeTask(state.buildSel, tdT);
    }
  }
  setTimeout(function(){ if(document.activeElement===document.body) focusKey=null; },0);
});

/* ============================ actions ============================ */
document.addEventListener("click", function(e){
  var btn = e.target.closest ? e.target.closest("[data-act]") : null;
  if(!btn) return;
  var act = btn.getAttribute("data-act");
  var id = btn.getAttribute("data-id");
  var pid = btn.getAttribute("data-p");
  var wk = keyOf(state.week);

  if(act==="status"){
    var g = findGoal(id); if(!g) return;
    var s = btn.getAttribute("data-s");
    g.status = (g.status===s) ? null : s;
    writeGoal(wk, g); render();
    return;
  }
  if(act==="toggle"){
    if(state.open[id]) delete state.open[id]; else state.open[id]=true;
    render(); return;
  }
  if(act==="comment"){
    if(!state.me){ askIdentity(false); return; }
    var g2 = findGoal(id); if(!g2) return;
    var key = "cmt:"+id, text = (state.drafts[key]||"").trim();
    if(!text) return;
    g2.comments = (g2.comments||[]).concat([{
      id:"c"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
      author:state.me, text:text, ts:Date.now()
    }]);
    delete state.drafts[key];
    focusKey = null;
    writeGoal(wk, g2); render();
    return;
  }
  if(act==="delcomment"){
    var g3 = findGoal(id); if(!g3) return;
    var cid = btn.getAttribute("data-cid");
    g3.comments = (g3.comments||[]).filter(function(c){ return c.id!==cid; });
    writeGoal(wk, g3); render();
    return;
  }
  if(act==="delete"){
    var g4 = findGoal(id); if(!g4) return;
    if(btn.getAttribute("data-armed")==="1"){
      delete state.open[id];
      removeGoal(wk, id).then(function(){ if(!db) return; });
      state.goals = state.goals.filter(function(x){ return x.id!==id; });
      render();
    } else {
      btn.setAttribute("data-armed","1");
      btn.textContent = "Click again to delete";
    }
    return;
  }
  if(act==="edit"){
    var g5 = findGoal(id); if(!g5) return;
    openEditor(g5);
    return;
  }
  if(act==="setprio"){
    var pscope = btn.getAttribute("data-scope"), pv = parseInt(btn.getAttribute("data-prio"),10);
    if(pscope.indexOf("new:")===0){
      state.newPrio[pscope.slice(4)] = pv;
      var set = btn.parentNode.children;
      for(var q=0;q<set.length;q++){
        set[q].setAttribute("aria-pressed", set[q]===btn ? "true":"false");
      }
      return;
    }
    var pg = findGoal(pscope);
    if(pg) setPriority(pg, pv);
    return;
  }
  if(act==="cycleprio"){
    var cg = findGoal(id); if(!cg) return;
    var cur = prioOf(cg);
    setPriority(cg, cur===1 ? 2 : (cur===2 ? 3 : 1));
    return;
  }
  if(act==="setday"){
    var scope = btn.getAttribute("data-scope"), iso = btn.getAttribute("data-date");
    var input = document.querySelector('input[type="date"][data-date="'+scope+'"]');
    if(input) input.value = iso;
    if(scope.indexOf("new:")===0) state.newDate[scope.slice(4)] = iso;
    syncDayChips(scope, iso);
    return;
  }
  if(act==="openadd"){ state.adding[pid]=true; focusKey="new:"+pid; render(); return; }
  if(act==="canceladd"){
    delete state.adding[pid]; delete state.drafts["new:"+pid]; delete state.drafts["newdesc:"+pid];
    delete state.newDate[pid]; delete state.newCat[pid]; delete state.newPrio[pid];
    focusKey=null; render(); return;
  }
  if(act==="createconfirm"){
    var title = (state.drafts["new:"+pid]||"").trim();
    if(!title){ var inp=document.querySelector('[data-draft="new:'+pid+'"]'); if(inp) inp.focus(); return; }
    var catEl = document.querySelector('[data-newcat="'+pid+'"]');
    var dateEl = document.querySelector('input[type="date"][data-date="new:'+pid+'"]');
    var wantPrio = state.newPrio[pid] || 3;
    var goal = {
      id:newId(), owner:pid, title:title,
      category: catEl ? catEl.value : CATEGORIES[0],
      description: (state.drafts["newdesc:"+pid]||"").trim(),
      dueDate: (dateEl && dateEl.value) ? dateEl.value : null,
      dueDay: null, priority: wantPrio,
      status:null, reflection:"", comments:[],
      createdAt:Date.now(), sort:Date.now()
    };
    var bumped = null;
    if(wantPrio===1){
      var holder = criticalFor(pid);
      if(holder){ holder.priority = 2; bumped = holder; writeGoal(wk, holder); }
    }
    delete state.drafts["new:"+pid];
    delete state.drafts["newdesc:"+pid];
    state.newCat[pid] = goal.category;   // keep the category for the next goal
    delete state.newDate[pid];           // but not the date
    state.newPrio[pid] = 3;              // and never repeat a critical
    focusKey = "new:"+pid;
    if(bumped) setTimeout(function(){
      flash('Only one critical goal a week — "'+bumped.title.slice(0,40)+'" moved to High.');
    }, 60);
    if(!db){ writeGoal(wk, goal); }
    else { state.goals = state.goals.concat([goal]); writeGoal(wk, goal); render(); }
    return;
  }
  if(act==="carry"){
    carryOver(pid);
    return;
  }
  if(act==="backup"){ openData(); return; }

  /* ---- build night ---- */
  if(act==="newsession"){
    state.sessionForm = "new";
    state.sessionDate = keyOf(todayStart());
    state.drafts["sf-label"] = "";
    focusKey = "sf-label";
    render(); return;
  }
  if(act==="cancelsession"){
    state.sessionForm = null; delete state.drafts["sf-label"]; focusKey = null;
    render(); return;
  }
  if(act==="savesession"){
    var sdEl = document.getElementById("sf-date");
    var sess = {
      id: newSessionId(),
      date: (sdEl && sdEl.value) ? sdEl.value : keyOf(todayStart()),
      label: (state.drafts["sf-label"]||"").trim(),
      createdAt: Date.now()
    };
    state.builds = state.builds.concat([sess]).sort(byDateDesc);
    state.buildSel = sess.id;
    state.buildTasks = [];
    state.sessionForm = null; delete state.drafts["sf-label"];
    state.addingTask = true; focusKey = "bt-title";
    writeSession(sess);
    if(db) loadBuildTasks();
    render();
    return;
  }
  if(act==="delsession"){
    if(btn.getAttribute("data-armed")==="1"){
      var gone = id;
      removeSession(gone);
      state.builds = state.builds.filter(function(x){ return x.id!==gone; });
      state.buildSel = null; state.buildTasks = []; state.openTasks = {};
      pickSession(); loadBuildTasks(); render();
    } else {
      btn.setAttribute("data-armed","1");
      btn.textContent = "Click again to delete";
    }
    return;
  }
  if(act==="opentask"){ state.addingTask = true; focusKey = "bt-title"; render(); return; }
  if(act==="canceltask"){
    state.addingTask = false;
    delete state.drafts["bt-title"]; delete state.drafts["bt-desc"];
    focusKey = null; render(); return;
  }
  if(act==="settier"){
    state.newTier = btn.getAttribute("data-t");
    var ts = btn.parentNode.children;
    for(var z=0;z<ts.length;z++) ts[z].setAttribute("aria-pressed", ts[z]===btn ? "true":"false");
    return;
  }
  if(act==="addtask"){
    var ttl = (state.drafts["bt-title"]||"").trim();
    if(!ttl){ var bi=document.querySelector('[data-draft="bt-title"]'); if(bi) bi.focus(); return; }
    if(!state.buildSel) return;
    var task = {
      id:newTaskId(), title:ttl,
      description:(state.drafts["bt-desc"]||"").trim(),
      tier:state.newTier||"must", claim:"", status:null,
      createdAt:Date.now(), sort:Date.now()
    };
    delete state.drafts["bt-title"]; delete state.drafts["bt-desc"];
    focusKey = "bt-title";
    state.buildTasks = sortTasks(state.buildTasks.concat([task]));
    writeTask(state.buildSel, task);
    render();
    return;
  }
  if(act==="tstatus"){
    var tk = findTask(id); if(!tk) return;
    var ss = btn.getAttribute("data-s");
    tk.status = (tk.status===ss) ? null : ss;
    writeTask(state.buildSel, tk); render(); return;
  }
  if(act==="togtask"){
    if(state.openTasks[id]) delete state.openTasks[id]; else state.openTasks[id]=true;
    render(); return;
  }
  if(act==="cycletier"){
    var tt = findTask(id); if(!tt) return;
    tt.tier = (tt.tier==="stretch") ? "must" : "stretch";
    state.buildTasks = sortTasks(state.buildTasks);
    writeTask(state.buildSel, tt); render(); return;
  }
  if(act==="cycleclaim"){
    var tc = findTask(id); if(!tc) return;
    var at = CLAIM_ORDER.indexOf(tc.claim || "");
    tc.claim = CLAIM_ORDER[(at+1) % CLAIM_ORDER.length];
    writeTask(state.buildSel, tc); render(); return;
  }
  if(act==="renametask"){
    var tr = findTask(id); if(!tr) return;
    openTaskRename(tr); return;
  }
  if(act==="deltask"){
    if(btn.getAttribute("data-armed")==="1"){
      delete state.openTasks[id];
      state.buildTasks = state.buildTasks.filter(function(x){ return x.id!==id; });
      removeTask(state.buildSel, id); render();
    } else {
      btn.setAttribute("data-armed","1");
      btn.textContent = "Click again to delete";
    }
    return;
  }

  /* ---- notes ---- */
  if(act==="newnote"){ openNoteForm(null); return; }
  if(act==="editnote"){ openNoteForm(findNote(id)); return; }
  if(act==="cancelnote"){ closeNoteForm(true); render(); return; }
  if(act==="attpick"){
    var pick = document.getElementById("attInput");
    if(pick) pick.click();
    return;
  }
  if(act==="attdel"){
    var fid = btn.getAttribute("data-fid");
    var gone = null;
    state.noteFiles = state.noteFiles.filter(function(f){
      if(f.id === fid){ gone = f; return false; }
      return true;
    });
    if(gone){
      var i = -1;
      for(var z=0; z<state.noteAdded.length; z++){
        if(state.noteAdded[z].fid === gone.fid){ i = z; break; }
      }
      if(i !== -1){
        /* Added and removed without ever saving — nothing references it, so
           take it out of the database now. */
        state.noteAdded.splice(i, 1);
        if(att()) att().remove([gone]);
      } else {
        /* Already saved on the note. Hold the deletion until they commit, so
           Cancel really does undo it. */
        state.noteRemoved = state.noteRemoved.concat([gone]);
      }
    }
    state.attErr = "";
    render();
    return;
  }
  if(act==="attopen"){
    var fid = btn.getAttribute("data-fid");
    var kind = btn.getAttribute("data-kind") || "file";
    var fname = btn.getAttribute("data-fn") || "";
    var meta = findFileMeta(fid);
    if(!att() || !meta) return;
    /* Things a browser can show; everything else is a download. */
    var inline = ["pdf","image","text","av"].indexOf(kind) !== -1;
    /* The tab has to be claimed inside the click itself. Reassembling the file
       takes a round trip per chunk, and a window.open() after that has lost the
       user gesture — every popup blocker eats it. */
    var win = null;
    if(inline){
      win = window.open("about:blank", "_blank");
      if(win) try{ win.opener = null; }catch(e){}
    }
    var was = btn.textContent;
    btn.textContent = "Opening\u2026";
    att().link(meta).then(function(url){
      btn.textContent = was;
      if(inline){
        if(win) win.location = url;
        else window.location.href = url;   /* popup blocked — use this tab */
      } else {
        var a = document.createElement("a");
        a.href = url; a.download = fname; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      }
      /* Blob URLs pin the whole file in memory until they're released. Give the
         tab or the download a moment to take hold of it, then let it go. */
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 60000);
    }, function(err){
      btn.textContent = was;
      if(win) try{ win.close(); }catch(e){}
      state.attErr = (err && err.message) || "Couldn\u2019t open that file.";
      render();
    });
    return;
  }
  if(act==="tognote"){
    if(state.openNotes[id]) delete state.openNotes[id]; else state.openNotes[id]=true;
    render(); return;
  }
  if(act==="savenote"){
    var title = (state.drafts["nf-title"]||"").trim();
    if(!title){
      var ti = document.querySelector('[data-draft="nf-title"]');
      if(ti) ti.focus();
      return;
    }
    var dEl = document.getElementById("nf-date");
    var existing = state.editingNote !== "new" ? findNote(state.editingNote) : null;
    var note = {
      id: existing ? existing.id : (state.noteId || newNoteId()),
      title: title,
      files: state.noteFiles.slice(),
      who: state.noteWho,
      people: (state.drafts["nf-people"]||"").trim(),
      takeaways: (state.drafts["nf-takeaways"]||"").trim(),
      details: (state.drafts["nf-details"]||"").trim(),
      date: (dEl && dEl.value) ? dEl.value : (state.noteDate || keyOf(todayStart())),
      author: existing ? existing.author : (state.me || "samuel"),
      createdAt: existing ? existing.createdAt : Date.now()
    };
    if(!existing){
      state.notes = sortNotes(state.notes.concat([note]));
    } else {
      for(var q=0;q<state.notes.length;q++){ if(state.notes[q].id===note.id) state.notes[q]=note; }
      state.notes = sortNotes(state.notes);
    }
    if(state.noteRemoved.length && att()) att().remove(state.noteRemoved);
    closeNoteForm();
    writeNote(note);
    render();
    return;
  }
  if(act==="delnote"){
    if(btn.getAttribute("data-armed")==="1"){
      var doomed = findNote(id);
      if(doomed && doomed.files && doomed.files.length && att()){
        att().remove(doomed.files);
      }
      delete state.openNotes[id];
      state.notes = state.notes.filter(function(x){ return x.id!==id; });
      removeNote(id);
      render();
    } else {
      btn.setAttribute("data-armed","1");
      btn.textContent = "Click again to delete";
    }
    return;
  }
});

function openEditor(g){
  var row = document.querySelector('[data-act="edit"][data-id="'+g.id+'"]');
  if(!row) return;
  var host = row.closest(".detail");
  var box = document.createElement("div");
  box.className = "field";
  box.innerHTML =
    '<label>Edit goal</label>'+
    '<input type="text" id="e-title" value="'+esc(g.title)+'">'+
    '<textarea id="e-desc" style="margin-top:8px;min-height:64px" '+
      'placeholder="Detail (optional) — context, what done looks like, links">'+esc(g.description||"")+'</textarea>'+
    '<div style="margin-top:8px"><select id="e-cat">'+categoryOptions(g.category)+'</select></div>'+
    '<div style="margin-top:8px">'+dateField("edit:"+g.id, dueISOof(g, state.week))+'</div>'+
    '<div class="row" style="display:flex;gap:8px;margin-top:10px">'+
      '<button class="btn" id="e-save">Save changes</button>'+
      '<button class="btn ghost" id="e-cancel">Cancel</button>'+
    '</div>';
  host.insertBefore(box, host.firstChild);
  var t = box.querySelector("#e-title"); t.focus();
  box.querySelector("#e-cancel").addEventListener("click", function(){ render(); });
  box.querySelector("#e-save").addEventListener("click", function(){
    var dEl = box.querySelector('input[type="date"][data-date="edit:'+g.id+'"]');
    g.title = t.value.trim() || g.title;
    g.description = box.querySelector("#e-desc").value.trim();
    g.category = box.querySelector("#e-cat").value;
    g.dueDate = (dEl && dEl.value) ? dEl.value : null;
    g.dueDay = null;
    writeGoal(keyOf(state.week), g);
    render();
  });
}

function carryOver(pid){
  var prevKey = keyOf(addDays(state.week,-7));
  var wk = keyOf(state.week);
  readWeekOnce(prevKey).then(function(prev){
    var open = prev.filter(function(g){ return g.owner===pid && g.status!=="green"; });
    if(!open.length){
      flash("Nothing unfinished to carry over from last week.");
      return;
    }
    var existing = {};
    goalsFor(pid).forEach(function(g){ existing[g.title.toLowerCase()] = true; });
    var made = 0, base = Date.now();
    open.forEach(function(g,i){
      if(existing[g.title.toLowerCase()]) return;
      made++;
      // A carried-over target date shifts a week forward with the goal.
      var prevDue = dueDateOf(g, addDays(state.week,-7));
      var copy = {
        id:newId(), owner:pid, title:g.title, category:g.category,
        description: g.description||"",
        dueDate: prevDue ? keyOf(addDays(prevDue,7)) : null,
        dueDay:null, priority: prioOf(g), status:null,
        reflection:"", comments:[], createdAt:base+i, sort:base+i
      };
      if(db) state.goals = state.goals.concat([copy]);
      writeGoal(wk, copy);
    });
    if(db) render();
    flash(made ? made+" goal"+(made===1?"":"s")+" carried over." : "Those are already on this week.");
  });
}

var flashTimer = null;
function flash(msg){
  var el = document.getElementById("statusline");
  el.innerHTML = '<span class="dot"></span> '+esc(msg);
  if(flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(renderStatusline, 4000);
}

/* ============================ chrome wiring ============================ */
document.getElementById("prevWeek").addEventListener("click", function(){
  state.week = addDays(state.week,-7); state.open={}; state.adding={}; loadWeek();
});
document.getElementById("nextWeek").addEventListener("click", function(){
  state.week = addDays(state.week,7); state.open={}; state.adding={}; loadWeek();
});
document.getElementById("todayBtn").addEventListener("click", function(){
  state.week = mondayOf(new Date()); state.open={}; state.adding={}; loadWeek();
});
function setGoalView(v){
  state.view = v;
  try{ localStorage.setItem("flw.view", v); }catch(err){}
  if(window.__SVC) window.__SVC.syncNav("goals", v);
  render();
}
window.__GOALS = {
  setView: setGoalView,
  view: function(){ return state.view; },
  render: render
};
document.addEventListener("keydown", function(e){
  if(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if(e.key==="ArrowLeft"){ document.getElementById("prevWeek").click(); }
  if(e.key==="ArrowRight"){ document.getElementById("nextWeek").click(); }
});

/* ============================ categories ============================ */
function categoryUse(name){
  var n=0;
  for(var i=0;i<state.goals.length;i++){ if(state.goals[i].category===name) n++; }
  return n;
}
function openTaskRename(t){
  var row = document.querySelector('[data-act="renametask"][data-id="'+t.id+'"]');
  if(!row) return;
  var host = row.closest(".detail");
  var box = document.createElement("div");
  box.className = "field";
  box.innerHTML =
    '<label>Rename</label>'+
    '<input type="text" id="tr-title" value="'+esc(t.title)+'">'+
    '<div class="row" style="display:flex;gap:8px;margin-top:8px">'+
      '<button class="btn" id="tr-save">Save</button>'+
      '<button class="btn ghost" id="tr-cancel">Cancel</button>'+
    '</div>';
  host.insertBefore(box, host.firstChild);
  var inp = box.querySelector("#tr-title"); inp.focus();
  box.querySelector("#tr-cancel").addEventListener("click", function(){ render(); });
  box.querySelector("#tr-save").addEventListener("click", function(){
    t.title = inp.value.trim() || t.title;
    writeTask(state.buildSel, t); render();
  });
}

/* The note form renders from state.drafts, so a live snapshot arriving mid-typing
   re-renders the form without wiping what's in it. */
function openNoteForm(n){
  state.editingNote = n ? n.id : "new";
  /* The id is settled now, not at save time, so a file dropped on a brand-new
     note already knows which folder it belongs in. */
  state.noteId = n ? n.id : newNoteId();
  state.noteFiles = (n && n.files) ? n.files.slice() : [];
  state.noteAdded = [];
  state.noteRemoved = [];
  state.uploads = {};
  state.attErr = "";
  state.noteWho = (n && n.who) || "owners";
  state.noteDate = (n && n.date) || keyOf(todayStart());
  state.drafts["nf-title"] = (n && n.title) || "";
  state.drafts["nf-people"] = (n && n.people) || "";
  state.drafts["nf-takeaways"] = (n && n.takeaways) || "";
  state.drafts["nf-details"] = (n && n.details) || "";
  focusKey = "nf-title";
  render();
}
/* discardUploads: true when the user backed out, so files they added during
   this edit shouldn't be left sitting in storage paying rent forever. */
function closeNoteForm(discardUploads){
  if(discardUploads && state.noteAdded.length && att()) att().remove(state.noteAdded);
  state.editingNote = null;
  state.noteId = null;
  state.noteFiles = [];
  state.noteAdded = [];
  state.noteRemoved = [];
  state.uploads = {};
  state.attErr = "";
  delete state.drafts["nf-title"];
  delete state.drafts["nf-people"];
  delete state.drafts["nf-takeaways"];
  delete state.drafts["nf-details"];
  focusKey = null;
}

function openCategories(){
  var draft = CATEGORIES.slice();
  var scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true" aria-label="Manage categories">'+
    '<h2>Categories</h2>'+
    '<p>Rename, reorder, or remove the areas you file goals under. Shared with Garrett.</p>'+
    '<div class="catlist" id="catlist"></div>'+
    '<div class="catadd">'+
      '<input type="text" id="catnew" placeholder="Add a category…" maxlength="24">'+
      '<button class="btn ghost" id="catadd">Add</button>'+
    '</div>'+
    '<div class="modal-foot">'+
      '<button class="btn" id="catsave">Save</button>'+
      '<button class="btn ghost" id="catcancel">Cancel</button>'+
      '<span class="hint" id="catnote"></span>'+
    '</div>'+
  '</div>';
  (document.getElementById("goals-overlays")||document.body).appendChild(scrim);

  var listEl = scrim.querySelector("#catlist");
  var noteEl = scrim.querySelector("#catnote");

  function paint(){
    var html = "";
    for(var i=0;i<draft.length;i++){
      var used = categoryUse(draft[i]);
      html += '<div class="catrow" data-i="'+i+'">'+
        '<input type="text" value="'+esc(draft[i])+'" maxlength="24" aria-label="Category name">'+
        (used ? '<span class="use">'+used+' this week</span>' : '')+
        '<button class="iconbtn" data-move="-1" aria-label="Move up"'+(i===0?' disabled style="opacity:.3"':'')+'>'+
          '<svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></button>'+
        '<button class="iconbtn" data-move="1" aria-label="Move down"'+(i===draft.length-1?' disabled style="opacity:.3"':'')+'>'+
          '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>'+
        '<button class="iconbtn rm" data-rm="1" aria-label="Remove category">'+
          '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'+
      '</div>';
    }
    listEl.innerHTML = html;
  }
  function readInputs(){
    var rows = listEl.querySelectorAll(".catrow");
    for(var i=0;i<rows.length;i++){
      var v = rows[i].querySelector("input").value.trim();
      if(v) draft[i] = v;
    }
  }
  paint();

  listEl.addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    var row = b.closest(".catrow"); if(!row) return;
    var i = parseInt(row.getAttribute("data-i"),10);
    readInputs();
    if(b.getAttribute("data-rm")){
      var used = categoryUse(draft[i]);
      noteEl.textContent = used
        ? "Removed. "+used+" goal"+(used===1?"":"s")+" this week keep the old label."
        : "";
      draft.splice(i,1);
    } else {
      var dir = parseInt(b.getAttribute("data-move"),10);
      var j = i+dir;
      if(j<0 || j>=draft.length) return;
      var tmp = draft[i]; draft[i] = draft[j]; draft[j] = tmp;
    }
    paint();
  });
  scrim.querySelector("#catadd").addEventListener("click", function(){
    var inp = scrim.querySelector("#catnew"), v = inp.value.trim();
    if(!v) return;
    readInputs();
    if(draft.indexOf(v)!==-1){ noteEl.textContent = "Already on the list."; return; }
    draft.push(v); inp.value = ""; noteEl.textContent = ""; paint(); inp.focus();
  });
  scrim.querySelector("#catnew").addEventListener("keydown", function(e){
    if(e.key==="Enter"){ e.preventDefault(); scrim.querySelector("#catadd").click(); }
  });
  scrim.querySelector("#catcancel").addEventListener("click", function(){ scrim.remove(); });
  scrim.querySelector("#catsave").addEventListener("click", function(){
    readInputs();
    var seen = {}, clean = [];
    for(var i=0;i<draft.length;i++){
      var v = draft[i].trim();
      if(v && !seen[v.toLowerCase()]){ seen[v.toLowerCase()] = true; clean.push(v); }
    }
    if(!clean.length){ noteEl.textContent = "Keep at least one category."; return; }
    CATEGORIES = clean;
    saveSettings();
    scrim.remove();
    render();
    flash("Categories updated.");
  });
  scrim.addEventListener("click", function(e){ if(e.target===scrim) scrim.remove(); });
  scrim.querySelector("#catnew").focus();
}
document.getElementById("catBtn").addEventListener("click", openCategories);

/* ============================ the gate ============================
   While the gate is up the board is not in the document at all — no goal
   titles, no counts, nothing to read over the shoulder of the sign-in. */
var gateEl = document.getElementById("gate");
var appEl = document.getElementById("goals-root");

function showGate(html){
  document.getElementById("gateBody").innerHTML = html;
  gateEl.hidden = false;
  if(window.__SVC) window.__SVC.closeShell();
}
function openApp(){
  gateEl.hidden = true;
  if(window.__SVC) window.__SVC.openShell();
}
function gateLoading(msg){
  showGate('<div class="gate-loading"><span class="gate-spinner"></span>'+
           '<p class="gate-msg">'+esc(msg||"Checking your access…")+'</p></div>');
}

/* Local mode only (no sign-in available): pick which founder you are. */
function askIdentity(canDismiss){
  showGate(
    '<p class="gate-msg">Sign-in isn&rsquo;t available on this view. Choose which founder you are — '+
    'this tags your comments and marks your column.</p>'+
    '<div class="gate-choices">'+
      ROSTER.map(function(p){
        return '<button class="gate-btn" data-pick="'+p.id+'">'+
               '<span class="g">'+esc(p.initials)+'</span>'+esc(p.name)+'</button>';
      }).join("")+
    '</div>'+
    (canDismiss ? '<button class="gate-btn" data-gate-cancel="1" style="font-weight:500">Back to the board</button>' : '')+
    '<p class="gate-foot">This board is saved in this browser only.</p>'
  );
}
gateEl.addEventListener("click", function(e){
  var b = e.target.closest ? e.target.closest("[data-pick]") : null;
  if(b){
    state.me = b.getAttribute("data-pick");
    try{ localStorage.setItem("flw.me", state.me); }catch(err){}
    openApp(); render(); return;
  }
  if(e.target.closest && e.target.closest("[data-gate-cancel]")){ openApp(); render(); }
});

/* ============================ boot ============================ */
var authMode = "pending";   // pending -> firebase | local
gateLoading("Starting up…");
loadSettings();
render();
loadWeek();
loadNotes();
loadBuilds();

/* ============================ Firebase backend ============================
   The module script below this one loads Firebase and hands over `window.__FB`.
   Everything above talks to a small shim with the same shape the app already
   used, so only this block knows Firebase exists. If the SDK never loads, the
   board keeps working against local storage and says so in the banner. */

function fsShim(FB){
  function wrapDoc(s){
    return { id:s.id, exists:(typeof s.exists==="function"? s.exists() : !!s.exists),
             data:function(){ return s.data(); } };
  }
  function wrapQuery(s){
    var docs=[]; s.forEach(function(d){ docs.push(wrapDoc(d)); });
    return { docs:docs, size:docs.length, empty:docs.length===0 };
  }
  return {
    collection:function(path){
      var ref = FB.colRef(path);
      return {
        get:function(){ return FB.getDocs(ref).then(wrapQuery); },
        onSnapshot:function(next, err){
          return FB.onSnapshot(ref, function(s){ next(wrapQuery(s)); }, err||function(){});
        }
      };
    },
    doc:function(path){
      var ref = FB.docRef(path);
      return {
        get:function(){ return FB.getDoc(ref).then(wrapDoc); },
        set:function(data){ return FB.setDoc(ref, data); },
        "delete":function(){ return FB.deleteDoc(ref); },
        onSnapshot:function(next, err){
          return FB.onSnapshot(ref, function(s){ next(wrapDoc(s)); }, err||function(){});
        }
      };
    }
  };
}

var signedOut = true;
function showSignIn(reason, bad){
  signedOut = true;
  showGate(
    '<p class="gate-msg'+(bad?" bad":"")+'">'+
      esc(reason || "Sign in with the Google account you and your co-founder agreed on.")+
    '</p>'+
    '<button class="gate-btn" id="gsi"><span class="g">G</span>Sign in with Google</button>'+
    '<p class="gate-foot">Only approved accounts can open this board.</p>'
  );
  document.getElementById("gsi").addEventListener("click", function(){
    gateLoading("Waiting for Google…");
    window.__FB.signIn().catch(function(e){
      var code = (e && e.code) || "unknown";
      if(code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"){
        showSignIn(null, false);
      } else if(code === "auth/popup-blocked"){
        showSignIn("Your browser blocked the sign-in popup. Allow popups for this site, then try again.", true);
      } else if(code === "auth/unauthorized-domain"){
        showSignIn("This web address is not authorized in Firebase yet.", true);
      } else {
        showSignIn("Sign-in failed (" + code + "). Try again.", true);
      }
    });
  });
}
function hideSignIn(){ signedOut = false; }

function bindFirebase(){
  var FB = window.__FB;
  if(!FB || authMode==="firebase") return;
  authMode = "firebase";
  gateLoading("Checking your access…");

  FB.onAuth(function(user){
    if(!user){
      db = null; state.cloud = false; state.me = null;
      if(unsub){ try{unsub();}catch(e){} unsub=null; }
      if(unsubSettings){ try{unsubSettings();}catch(e){} unsubSettings=null; }
      if(unsubProfiles){ try{unsubProfiles();}catch(e){} unsubProfiles=null; }
      if(unsubNotes){ try{unsubNotes();}catch(e){} unsubNotes=null; }
      if(unsubBuilds){ try{unsubBuilds();}catch(e){} unsubBuilds=null; }
      if(unsubBuildTasks){ try{unsubBuildTasks();}catch(e){} unsubBuildTasks=null; }
      state.goals = []; state.profiles = {}; state.notes = [];
      window.dispatchEvent(new Event("tf-signed-out"));
      state.builds = []; state.buildTasks = []; state.buildSel = null;
      showSignIn(null, false);
      return;
    }
    var email = (user.email||"").toLowerCase();
    var who = MEMBERS[email];
    if(!who){
      db = null; state.cloud = false; state.me = null; state.goals = [];
      showSignIn("Signed in as " + email + ", which isn't on this board's access list. "
                 + "Sign out of that Google account, or switch accounts, and try again.", true);
      return;
    }
    hideSignIn();
    openApp();
    state.me = who;
    try{ localStorage.setItem("flw.me", who); }catch(e){}
    db = fsShim(FB); state.cloud = true;
    loadSettings();
    loadProfiles();
    loadWeek();
    loadNotes();
    loadBuilds();
    saveProfile(who, user.photoURL, user.displayName);
    window.dispatchEvent(new CustomEvent("tf-signed-in", {detail:{
      id: who,
      email: email,
      profile: {displayName: user.displayName || "", photoURL: user.photoURL || ""},
      db: (window.__SVC && window.__SVC.fsShim) ? window.__SVC.fsShim(FB) : null
    }}));
    syncUp().then(function(moved){
      if(moved) flash(moved+" goal"+(moved===1?"":"s")+" synced up from this browser.");
      renderStatusline();
    });
    render();
  });
}

if(window.__FB) bindFirebase();
else window.addEventListener("fb-ready", bindFirebase);

/* If Firebase never arrives (offline, blocked, misconfigured), fall back to
   the local board rather than leaving the page stuck behind a sign-in wall. */
setTimeout(function(){
  if(authMode!=="pending") return;
  authMode = "local";
  renderStatusline();
  if(state.me) openApp(); else askIdentity(false);
}, 7000);
})();
