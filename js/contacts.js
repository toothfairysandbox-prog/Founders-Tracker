/* ===================== contacts ===================== */

(function(){
'use strict';

var STAGE_LABEL = {contacted:"Contacted", connected:"Connected"};
var CALL_TYPE_LABEL = {call:"Call", video:"Video meeting", in_person:"In person", other:"Other"};

var state = {
  me: null,
  route: {view:"home"},
  previewId: null,
  contactTab: "overview",
  sidebarCollapsed: false,
  mobileOpen: false,
  contacts: [],
  industries: [],
  positions: [],
  expandedIndustryId: null,
  reminders: [],
  events: [],
  activity: [],
  notes: [],
  calls: [],
  peers: [],
  search: "",
  industryFilter: "",
  sortBy: "name",
  contactsView: "list",
  calMonth: (function(){ var d=new Date(); d.setDate(1); return d; })(),
  calSelected: null,
  profileCache: {},
  editingContact: null,
  completingReminderId: null,
  showNextStepAfter: null
};

var db = null, roomApi = null, userApi = null;
var notesUnsub = null, callsUnsub = null;
var renderQueued = false;

function $(sel, root){ return (root||document).querySelector(sel); }
function esc(s){
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function fmtDate(iso){
  if(!iso) return "—";
  var d = new Date(iso);
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
}
function fmtDateTime(iso){
  if(!iso) return "—";
  var d = new Date(iso);
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"}) + " · " + d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}
function fmtTime(iso){
  var d = new Date(iso);
  return d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}
function toLocalInputValue(iso){
  var d = iso ? new Date(iso) : new Date();
  var pad = function(n){ return String(n).padStart(2,"0"); };
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
}
function fromLocalInputValue(v){
  if(!v) return new Date().toISOString();
  var d = new Date(v);
  return d.toISOString();
}
function plusHoursISO(h){
  return new Date(Date.now()+h*3600*1000).toISOString();
}
function initialsOf(name){
  if(!name) return "?";
  var parts = name.trim().split(/\s+/);
  return ((parts[0]||"")[0]||"") + ((parts[1]||"")[0]||"");
}
function timeAgo(iso){
  var diff = Date.now() - new Date(iso).getTime();
  var m = Math.round(diff/60000);
  if(m < 1) return "just now";
  if(m < 60) return m+"m ago";
  var h = Math.round(m/60);
  if(h < 24) return h+"h ago";
  var d = Math.round(h/24);
  if(d < 7) return d+"d ago";
  return fmtDate(iso);
}
function toast(msg, isError){
  var old = document.getElementById("ct-toast");
  if(old) old.remove();
  var el = document.createElement("div");
  el.id = "ct-toast";
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:"+(isError?"var(--danger)":"var(--text)")+";color:#fff;padding:11px 18px;border-radius:10px;font-size:13px;font-weight:700;z-index:100;box-shadow:var(--shadow-md);max-width:min(420px,90vw);text-align:center;";
  document.body.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.remove(); }, 5000);
}
function friendlyDbError(e){
  var code = e && e.code;
  if(code === "invalid_argument") return "That didn't save. Either a field is invalid, or you don't have edit access to this workspace yet (ask the owner to share it with \"Can interact\" or higher).";
  if(code === "resource_exhausted") return "Too many changes at once — wait a moment and try again.";
  if(code === "quota_exceeded") return "This workspace's storage is full. Archive or remove some old records first.";
  if(code === "unavailable") return "Connection hiccup — please try again.";
  if(code === "revoked") return "Your access to this workspace changed. Reload the artifact.";
  if(code === "not_granted" || code === "capability_disabled" || code === "capability_removed") return "The shared database isn't available in this view. Reopen the artifact from claude.ai.";
  return (e && e.message) ? e.message : "Something went wrong saving that. Please try again.";
}
function debounce(fn, ms){
  var t;
  return function(){
    var args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function(){ fn.apply(ctx, args); }, ms);
  };
}

// ---------- rich note formatting ----------
var RICH_ALLOWED_TAGS = {B:1,STRONG:1,I:1,EM:1,U:1,SPAN:1,DIV:1,BR:1,P:1};
var RICH_ALLOWED_ATTRS = {SPAN:["style"], DIV:["style"], P:["style"]};
var RICH_ALLOWED_STYLE_PROPS = {"font-size":1, "text-align":1};
function sanitizeNoteHtml(html){
  var tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  (function walk(node){
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function(child){
      if(child.nodeType === 1){
        walk(child);
        var tag = child.tagName;
        if(!RICH_ALLOWED_TAGS[tag]){
          while(child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        var allowedAttrs = RICH_ALLOWED_ATTRS[tag] || [];
        Array.prototype.slice.call(child.attributes).forEach(function(attr){
          if(allowedAttrs.indexOf(attr.name) === -1){
            child.removeAttribute(attr.name);
          } else if(attr.name === "style"){
            var decl = child.style;
            var keep = {};
            for(var i=0;i<decl.length;i++){
              var prop = decl[i];
              if(RICH_ALLOWED_STYLE_PROPS[prop]) keep[prop] = decl.getPropertyValue(prop);
            }
            child.removeAttribute("style");
            Object.keys(keep).forEach(function(p){ child.style.setProperty(p, keep[p]); });
          }
        });
      } else if(child.nodeType !== 3){
        node.removeChild(child);
      }
    });
  })(tmp);
  return tmp.innerHTML;
}
var RICH_SIZE_SCALE = [11,12,13.5,15,17,19,22,26,31,37];
function applyFontSizeStep(editor, delta){
  var sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || sel.isCollapsed || !editor.contains(sel.anchorNode)){
    toast("Select some text in the note first.", true);
    return;
  }
  var range = sel.getRangeAt(0);
  var container = range.startContainer.nodeType===3 ? range.startContainer.parentElement : range.startContainer;
  var current = parseFloat(getComputedStyle(container).fontSize) || 13.5;
  var idx = 0, best = Infinity;
  RICH_SIZE_SCALE.forEach(function(v,i){ var d=Math.abs(v-current); if(d<best){best=d; idx=i;} });
  var newIdx = Math.max(0, Math.min(RICH_SIZE_SCALE.length-1, idx+delta));
  var span = document.createElement("span");
  span.style.fontSize = RICH_SIZE_SCALE[newIdx]+"px";
  var frag = range.extractContents();
  span.appendChild(frag);
  range.insertNode(span);
  sel.removeAllRanges();
  var newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.addRange(newRange);
}
document.addEventListener("mousedown", function(e){
  var btn = e.target.closest("[data-richcmd]");
  if(!btn) return;
  e.preventDefault();
  var toolbar = btn.closest(".rich-toolbar");
  var editor = toolbar && toolbar.nextElementSibling;
  if(!editor || !editor.classList.contains("rich-editor")) return;
  var cmd = btn.getAttribute("data-richcmd");
  if(cmd === "size-up") applyFontSizeStep(editor, 1);
  else if(cmd === "size-down") applyFontSizeStep(editor, -1);
  else if(cmd === "clear") document.execCommand("removeFormat");
  else document.execCommand(cmd);
});
document.addEventListener("selectionchange", function(){
  var sel = window.getSelection();
  if(!sel || sel.rangeCount===0) return;
  var node = sel.anchorNode;
  var el = node && (node.nodeType===1 ? node : node.parentElement);
  var editorEl = el && el.closest && el.closest(".rich-editor");
  if(!editorEl) return;
  var toolbar = editorEl.previousElementSibling;
  if(!toolbar || !toolbar.classList.contains("rich-toolbar")) return;
  ["bold","italic","underline"].forEach(function(cmd){
    var b = toolbar.querySelector('[data-richcmd="'+cmd+'"]');
    if(b){ try{ b.classList.toggle("active", document.queryCommandState(cmd)); }catch(e){} }
  });
});
document.addEventListener("keydown", function(e){
  var editorEl = e.target.closest && e.target.closest(".rich-editor");
  if(!editorEl) return;
  var mod = e.metaKey || e.ctrlKey;
  if(!mod) return;
  var k = e.key.toLowerCase();
  if(k==="b"){ e.preventDefault(); document.execCommand("bold"); }
  else if(k==="i"){ e.preventDefault(); document.execCommand("italic"); }
  else if(k==="u"){ e.preventDefault(); document.execCommand("underline"); }
});

function scheduleRender(){
  if(renderQueued) return;
  renderQueued = true;
  setTimeout(function(){ renderQueued = false; render(); }, 0);
}

// ---------- boot / access gate ----------
function setBoot(title, msg, showSpinner){
  $("#boot-title").textContent = title;
  $("#boot-msg").textContent = msg;
  var chip = $("#boot .chip");
  if(chip) chip.style.display = showSpinner ? "" : "none";
}

async function boot(){
  var svc = window.__SVC;
  if(!svc){ setBoot("Loading", "Starting up\u2026", true); return; }
  var me = svc.me();
  if(!me){ return; }                       // the shell's gate is still up
  state.me = me;
  state.profileCache[me.id] = {name: me.name, email: me.email, avatarUrl: me.avatarUrl, color: me.color, id: me.id};
  db = svc.db();
  if(!db){ setBoot("Storage unavailable", "Can't reach the shared database right now.", false); return; }
  roomApi = null;                          // presence needs the Claude runtime; degrade quietly
  showApp();
  subscribeAll();
}

function showApp(){ /* the shell controls visibility */ }

function onSubError(label){
  return function(e){ toast("Live sync for "+label+" stopped ("+friendlyDbError(e)+")", true); };
}
function subscribeAll(){
  db.collection("contacts").onSnapshot(function(snap){
    state.contacts = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("contacts"));
  db.collection("industries").onSnapshot(function(snap){
    state.industries = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("industries"));
  db.collection("positions").onSnapshot(function(snap){
    state.positions = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("positions"));
  db.collection("reminders").onSnapshot(function(snap){
    state.reminders = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("reminders"));
  db.collection("events").onSnapshot(function(snap){
    state.events = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("events"));
  db.collection("activity").orderBy("createdAt","desc").limit(200).onSnapshot(function(snap){
    state.activity = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    scheduleRender();
  }, onSubError("activity"));
}

function subscribeContactChildren(contactId){
  if(notesUnsub) notesUnsub();
  if(callsUnsub) callsUnsub();
  notesUnsub = db.collection("notes").where("contactId","==",contactId).onSnapshot(function(snap){
    state.notes = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); }).sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); });
    scheduleRender();
  }, function(){});
  callsUnsub = db.collection("calls").where("contactId","==",contactId).onSnapshot(function(snap){
    state.calls = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); }).sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); });
    scheduleRender();
  }, function(){});
}
function unsubscribeContactChildren(){
  if(notesUnsub){ notesUnsub(); notesUnsub = null; }
  if(callsUnsub){ callsUnsub(); callsUnsub = null; }
  state.notes = []; state.calls = [];
}

// ---------- profiles ----------
async function resolveProfiles(ids){
  var need = [];
  ids.forEach(function(id){ if(id && !state.profileCache[id]) need.push(id); });
  if(need.length && userApi){
    try {
      var res = await userApi.profiles(need);
      Object.keys(res).forEach(function(id){ state.profileCache[id] = res[id]; });
    } catch(e){}
  }
  var out = {};
  ids.forEach(function(id){
    out[id] = state.profileCache[id] || {id:id, name:"", email:null, avatarUrl:"", color:"#999"};
  });
  return out;
}
function profileName(id, cache){
  if(!id) return "Unassigned";
  var p = (cache && cache[id]) || state.profileCache[id];
  var nm = p && p.name;
  if(state.me && id === state.me.id) return (nm || "You") + (nm ? " (you)" : "");
  return nm || "Teammate";
}

// ---------- mutations ----------
async function logActivity(action, opts){
  opts = opts || {};
  try{
    await db.collection("activity").add({
      action: action,
      entityType: opts.entityType || "contact",
      entityId: opts.entityId || null,
      contactId: opts.contactId || null,
      contactName: opts.contactName || null,
      summary: opts.summary || "",
      actorId: state.me.id,
      createdAt: new Date().toISOString()
    });
  }catch(e){}
}

async function createContact(data){
  var now = new Date().toISOString();
  var ref = await db.collection("contacts").add({
    name: data.name, title: data.title||"", company: data.company||"",
    phone: data.phone||"", email: data.email||"", linkedin: data.linkedin||"",
    industryId: data.industryId || null, positionId: data.positionId || null, ownerId: data.ownerId || null,
    stage: data.stage || "contacted", archived: false,
    createdBy: state.me.id, createdAt: now, updatedBy: state.me.id, updatedAt: now
  });
  await db.collection("reminders").add({
    contactId: ref.id, text: data.nextStep, dueAt: data.dueAt,
    assigneeId: data.assigneeId || state.me.id, status: "scheduled",
    createdBy: state.me.id, createdAt: now
  });
  await logActivity("created", {contactId:ref.id, contactName:data.name, entityId:ref.id,
    summary: "added "+data.name+" with a follow-up due "+fmtDateTime(data.dueAt)});
  return ref.id;
}

async function updateContact(id, patch, contactName, summary){
  await db.collection("contacts").doc(id).update(Object.assign({}, patch, {updatedBy: state.me.id, updatedAt: new Date().toISOString()}));
  await logActivity("updated", {contactId:id, contactName:contactName, entityId:id, summary: summary || ("updated "+contactName)});
}

async function changeStage(contact, newStage){
  if(contact.stage === newStage) return;
  await db.collection("contacts").doc(contact.id).update({stage:newStage, updatedBy:state.me.id, updatedAt:new Date().toISOString()});
  await logActivity("stage_changed", {contactId:contact.id, contactName:contact.name, entityId:contact.id,
    summary: "moved "+contact.name+" to "+STAGE_LABEL[newStage]});
}

async function archiveContact(contact){
  await db.collection("contacts").doc(contact.id).update({archived:true, archivedBy:state.me.id, archivedAt:new Date().toISOString(), updatedBy:state.me.id, updatedAt:new Date().toISOString()});
  var openReminders = state.reminders.filter(function(r){ return r.contactId===contact.id && r.status==="scheduled"; });
  await Promise.all(openReminders.map(function(r){
    return db.collection("reminders").doc(r.id).update({status:"cancelled", completedBy:state.me.id, completedAt:new Date().toISOString()});
  }));
  await logActivity("deleted", {contactId:contact.id, contactName:contact.name, entityId:contact.id, summary:"deleted "+contact.name});
}

async function addNote(contactId, contactName, title, bodyHtml){
  await db.collection("notes").add({
    contactId:contactId, title:title, body: sanitizeNoteHtml(bodyHtml), rich:true,
    authorId:state.me.id, createdAt:new Date().toISOString()
  });
  await logActivity("note_added", {contactId:contactId, contactName:contactName, entityId:contactId, summary:'added a note ("'+title+'") on '+contactName});
}

async function logCall(contact, data){
  await db.collection("calls").add({
    contactId: contact.id, type: data.type, occurredAt: data.occurredAt,
    durationMinutes: Number(data.durationMinutes)||0, notes: data.notes||"",
    createdBy: state.me.id, createdAt: new Date().toISOString()
  });
  if(contact.stage !== "connected"){
    await db.collection("contacts").doc(contact.id).update({stage:"connected", updatedBy:state.me.id, updatedAt:new Date().toISOString()});
  }
  await logActivity("call_logged", {contactId:contact.id, contactName:contact.name, entityId:contact.id,
    summary: "logged a "+CALL_TYPE_LABEL[data.type]+" with "+contact.name});
}

async function createReminder(contact, data){
  await db.collection("reminders").add({
    contactId: contact.id, text: data.text, dueAt: data.dueAt,
    assigneeId: data.assigneeId || state.me.id, status:"scheduled",
    createdBy: state.me.id, createdAt: new Date().toISOString()
  });
  await logActivity("reminder_created", {contactId:contact.id, contactName:contact.name, entityId:contact.id,
    summary: "scheduled a follow-up for "+contact.name});
}

async function completeReminder(reminder, contactName){
  await db.collection("reminders").doc(reminder.id).update({status:"completed", completedBy:state.me.id, completedAt:new Date().toISOString()});
  await logActivity("reminder_completed", {contactId:reminder.contactId, contactName:contactName, entityId:reminder.id,
    summary: "completed a follow-up for "+contactName});
}

async function addIndustry(name){
  var trimmed = name.trim();
  if(!trimmed) return null;
  var dup = state.industries.some(function(i){ return i.name.toLowerCase() === trimmed.toLowerCase(); });
  if(dup) return "dup";
  var ref = await db.collection("industries").add({name:trimmed, createdBy:state.me.id, createdAt:new Date().toISOString()});
  await logActivity("industry_added", {entityType:"industry", entityId:ref.id, summary:"added industry "+trimmed});
  return ref.id;
}

async function deleteIndustry(ind){
  var affected = state.contacts.filter(function(c){ return c.industryId === ind.id; });
  await Promise.all(affected.map(function(c){
    return db.collection("contacts").doc(c.id).update({industryId:null, positionId:null, updatedBy:state.me.id, updatedAt:new Date().toISOString()});
  }));
  var relatedPositions = state.positions.filter(function(p){ return p.industryId === ind.id; });
  await Promise.all(relatedPositions.map(function(p){ return db.collection("positions").doc(p.id).delete(); }));
  await db.collection("industries").doc(ind.id).delete();
  await logActivity("industry_deleted", {entityType:"industry", entityId:ind.id, summary:"deleted industry "+ind.name});
}

async function addPosition(industryId, name){
  var trimmed = (name||"").trim();
  if(!trimmed || !industryId) return null;
  var dup = state.positions.some(function(p){ return p.industryId===industryId && p.name.toLowerCase()===trimmed.toLowerCase(); });
  if(dup) return "dup";
  var ref = await db.collection("positions").add({industryId:industryId, name:trimmed, createdBy:state.me.id, createdAt:new Date().toISOString()});
  await logActivity("position_added", {entityType:"position", entityId:ref.id, summary:"added position "+trimmed+" under "+industryName(industryId)});
  return ref.id;
}

async function deletePosition(pos){
  var affected = state.contacts.filter(function(c){ return c.positionId === pos.id; });
  await Promise.all(affected.map(function(c){
    return db.collection("contacts").doc(c.id).update({positionId:null, updatedBy:state.me.id, updatedAt:new Date().toISOString()});
  }));
  await db.collection("positions").doc(pos.id).delete();
  await logActivity("position_deleted", {entityType:"position", entityId:pos.id, summary:"deleted position "+pos.name});
}

async function createEvent(data){
  var contact = state.contacts.find(function(c){ return c.id === data.contactId; });
  await db.collection("events").add({
    contactId: data.contactId, type: data.type, title: data.title||"",
    startsAt: data.startsAt, durationMinutes: Number(data.durationMinutes)||30,
    location: data.location||"", notes: data.notes||"",
    createdBy: state.me.id, createdAt: new Date().toISOString()
  });
  await logActivity("event_scheduled", {contactId:data.contactId, contactName: contact?contact.name:"", entityId:data.contactId,
    summary: "scheduled a "+CALL_TYPE_LABEL[data.type]+" with "+(contact?contact.name:"a contact")+" on "+fmtDateTime(data.startsAt)});
}

async function deleteEvent(ev){
  await db.collection("events").doc(ev.id).delete();
}

// ---------- derived data ----------
function activeReminderFor(contactId){
  var list = state.reminders.filter(function(r){ return r.contactId === contactId && r.status === "scheduled"; });
  list.sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); });
  return list[0] || null;
}
function reminderStatusPill(dueAt){
  var due = new Date(dueAt).getTime();
  var now = Date.now();
  var soon = due - now < 24*3600*1000;
  if(due < now) return '<span class="pill pill-overdue">Overdue</span>';
  if(soon) return '<span class="pill pill-soon">Due soon</span>';
  return '<span class="pill pill-later">Upcoming</span>';
}
function visibleContacts(){
  var list = state.contacts.filter(function(c){ return !c.archived; });
  if(state.industryFilter){
    list = list.filter(function(c){ return c.industryId === state.industryFilter; });
  }
  if(state.search){
    var q = state.search.toLowerCase();
    list = list.filter(function(c){
      return (c.name||"").toLowerCase().indexOf(q)>-1 ||
        (c.company||"").toLowerCase().indexOf(q)>-1 ||
        (c.email||"").toLowerCase().indexOf(q)>-1 ||
        (c.title||"").toLowerCase().indexOf(q)>-1;
    });
  }
  list = list.slice().sort(function(a,b){
    if(state.sortBy === "name") return (a.name||"").localeCompare(b.name||"");
    if(state.sortBy === "recent") return new Date(b.createdAt)-new Date(a.createdAt);
    if(state.sortBy === "company") return (a.company||"").localeCompare(b.company||"");
    return 0;
  });
  return list;
}
function industryName(id){
  if(!id) return "Uncategorized";
  var i = state.industries.find(function(x){ return x.id===id; });
  return i ? i.name : "Uncategorized";
}
function positionName(id){
  if(!id) return null;
  var p = state.positions.find(function(x){ return x.id===id; });
  return p ? p.name : null;
}
function positionOptionsMarkup(industryId, selectedId){
  if(!industryId) return '<option value="">Choose an industry first</option>';
  var opts = state.positions.filter(function(p){ return p.industryId===industryId; }).sort(function(a,b){ return a.name.localeCompare(b.name); });
  return '<option value="">No position set</option>' + opts.map(function(p){
    return '<option value="'+p.id+'" '+(selectedId===p.id?"selected":"")+'>'+esc(p.name)+'</option>';
  }).join("");
}
function positionFieldHtml(selectId, industryFieldId, industryId, selectedId){
  return '<div class="field">' +
    '<label>Position</label>' +
    '<div style="display:flex;gap:6px;">' +
      '<select id="'+selectId+'" style="flex:1;" '+(industryId?"":"disabled")+'>'+positionOptionsMarkup(industryId, selectedId)+'</select>' +
      '<button type="button" class="btn btn-sm" data-action="toggle-add-position" data-select="'+selectId+'" '+(industryId?"":"disabled")+'>+ New</button>' +
    '</div>' +
    '<div class="position-add-row" id="'+selectId+'-addrow" hidden>' +
      '<input type="text" id="'+selectId+'-newval" placeholder="e.g. Receptionist">' +
      '<button type="button" class="btn btn-sm btn-primary" data-action="confirm-add-position" data-select="'+selectId+'" data-industry-field="'+industryFieldId+'">Add</button>' +
    '</div>' +
    '<div class="hint">Positions group contacts within an industry — e.g. Dentist, Receptionist, DSO Manager.</div>' +
  '</div>';
}
// ---------- rendering: shell ----------
async function render(){
  if(!state.me){ return; }
  renderSidebar();
  if(window.__SVC) window.__SVC.syncNav("contacts", state.route.view);
  var root = $("#view-root");
  var title = "Home";
  var v = state.route.view;
  if(v==="home") title="Home";
  else if(v==="contacts") title="Contacts";
  else if(v==="reminders") title="Reminders";
  else if(v==="calendar") title="Calendar";
  else if(v==="activity") title="Activity";
  else if(v==="industries") title="Industries";
  else if(v==="contact") title = (state.contacts.find(function(c){return c.id===state.route.id;})||{}).name || "Contact";
  /* Only touch the shared topbar when this half is actually on screen —
     otherwise a background data push relabels the goals page "Home". */
  if(!window.__SVC || window.__SVC.section() === "contacts"){
    $("#page-title").textContent = title;
    $("#global-search-wrap").hidden = (v !== "contacts");
  }

  var noteDraft = null;
  if(v==="contact" && state.contactTab==="notes"){
    var teBefore = document.getElementById("note-title-"+state.route.id);
    var beBefore = document.getElementById("note-body-"+state.route.id);
    if(teBefore || beBefore){
      noteDraft = {
        id: state.route.id,
        title: teBefore ? teBefore.value : "",
        bodyHtml: beBefore ? beBefore.innerHTML : "",
        focus: document.activeElement===teBefore ? "title" : (document.activeElement===beBefore ? "body" : null)
      };
    }
  }

  var industriesDraft = null;
  if(v==="industries"){
    var iiBefore = document.getElementById("new-industry-input");
    var piBefore = state.expandedIndustryId ? document.getElementById("new-position-input-"+state.expandedIndustryId) : null;
    if(iiBefore || piBefore){
      industriesDraft = {
        expandedId: state.expandedIndustryId,
        industryVal: iiBefore ? iiBefore.value : "",
        positionVal: piBefore ? piBefore.value : "",
        focus: document.activeElement===iiBefore ? "industry" : (document.activeElement===piBefore ? "position" : null)
      };
    }
  }

  var html = "";
  if(v==="home") html = await renderHome();
  else if(v==="contacts") html = await renderContacts();
  else if(v==="reminders") html = await renderReminders();
  else if(v==="calendar") html = await renderCalendar();
  else if(v==="activity") html = await renderActivity();
  else if(v==="industries") html = await renderIndustries();
  else if(v==="contact") html = await renderContactFull(state.route.id);
  root.innerHTML = html;

  if(industriesDraft){
    var iiAfter = document.getElementById("new-industry-input");
    var piAfter = industriesDraft.expandedId ? document.getElementById("new-position-input-"+industriesDraft.expandedId) : null;
    if(iiAfter && industriesDraft.industryVal) iiAfter.value = industriesDraft.industryVal;
    if(piAfter && industriesDraft.positionVal) piAfter.value = industriesDraft.positionVal;
    if(industriesDraft.focus==="industry" && iiAfter) iiAfter.focus();
    else if(industriesDraft.focus==="position" && piAfter) piAfter.focus();
  }

  if(noteDraft){
    var teAfter = document.getElementById("note-title-"+noteDraft.id);
    var beAfter = document.getElementById("note-body-"+noteDraft.id);
    if(teAfter && noteDraft.title) teAfter.value = noteDraft.title;
    if(beAfter && noteDraft.bodyHtml) beAfter.innerHTML = noteDraft.bodyHtml;
    if(noteDraft.focus==="title" && teAfter) teAfter.focus();
    else if(noteDraft.focus==="body" && beAfter) beAfter.focus();
  }

  renderModal();
  wireDynamic();
}

function renderSidebar(){
  var sb = $("#sidebar");
  sb.classList.toggle("collapsed", state.sidebarCollapsed);
  sb.classList.toggle("mobile-open", state.mobileOpen);
  document.querySelectorAll(".navitem").forEach(function(btn){
    btn.classList.toggle("active", btn.dataset.nav === state.route.view);
  });
  var openReminders = state.reminders.filter(function(r){ return r.status==="scheduled"; }).length;
  $("#nav-count-contacts").textContent = visibleContacts().length || "";
  $("#nav-count-reminders").textContent = openReminders || "";

  var me = state.me;
  $("#me-row").innerHTML =
    (me.avatarUrl
      ? '<img class="avatar" src="'+esc(me.avatarUrl)+'" alt="">'
      : '<span class="avatar" style="display:grid;place-items:center;background:'+esc(me.color||"#5B3E96")+
        ';color:#fff;font-size:11px;font-weight:600;">'+esc(initialsOf(me.name||"?"))+'</span>') +
    '<div><div style="font-weight:700;">'+esc(me.name||"You")+'</div><div style="font-size:11px;color:var(--text-faint);">'+esc(me.email||"")+'</div></div>';

  var others = state.peers.filter(function(p){ return !p.isMe && p.kind==="viewer"; });
  var seen = {}; var uniq = [];
  others.forEach(function(p){ if(p.by && !seen[p.by]){ seen[p.by]=1; uniq.push(p); } else if(!p.by){ uniq.push(p); } });
  if(uniq.length===0){
    $("#presence-box").innerHTML = '<div class="presence-row"><span class="dot off"></span> Just you right now</div>';
  } else {
    var rows = uniq.map(function(p){
      var nm = p.by ? profileName(p.by) : "Teammate";
      return '<div class="presence-row"><span class="dot"></span> '+esc(nm)+' is here</div>';
    }).join("");
    $("#presence-box").innerHTML = rows;
  }
}

function pageHeader(){ return ""; }

// ---------- Home ----------
async function renderHome(){
  var list = visibleContacts();
  var weekAgo = Date.now() - 7*24*3600*1000;
  var newThisWeek = list.filter(function(c){ return new Date(c.createdAt).getTime() >= weekAgo; }).length;
  var globalCallsThisWeek = state.activity.filter(function(a){ return a.action==="call_logged" && new Date(a.createdAt).getTime() >= weekAgo; }).length;
  var openFollowUps = state.reminders.filter(function(r){ return r.status==="scheduled"; }).length;

  var ids = [];
  list.slice(0,5).forEach(function(c){ if(c.createdBy) ids.push(c.createdBy); });
  var profiles = await resolveProfiles(ids);

  var recent = list.slice().sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); }).slice(0,5);
  var recentHtml = recent.length ? '<div class="row-list">' + recent.map(function(c){
    return '<div class="list-row" data-action="open-preview" data-id="'+c.id+'">' +
      '<div class="contact-avatar">'+esc(initialsOf(c.name))+'</div>' +
      '<div class="meta"><div class="nm">'+esc(c.name)+'</div><div class="sub">'+esc(c.company||industryName(c.industryId))+' · added by '+esc(profileName(c.createdBy, profiles))+'</div></div>' +
      '<div class="right">'+timeAgo(c.createdAt)+'</div>' +
    '</div>';
  }).join("") + '</div>' : '<div class="panel empty">No contacts yet — add your first one.</div>';

  var dueReminders = state.reminders.filter(function(r){ return r.status==="scheduled"; })
    .sort(function(a,b){ return new Date(a.dueAt)-new Date(b.dueAt); }).slice(0,5);
  var remHtml = dueReminders.length ? '<div class="row-list">' + dueReminders.map(function(r){
    var c = state.contacts.find(function(x){return x.id===r.contactId;});
    return '<div class="list-row" data-action="open-preview" data-id="'+r.contactId+'">' +
      '<div class="contact-avatar">'+esc(initialsOf(c?c.name:"?"))+'</div>' +
      '<div class="meta"><div class="nm">'+esc(c?c.name:"Unknown contact")+'</div><div class="sub">'+esc(r.text)+'</div></div>' +
      '<div class="right">'+reminderStatusPill(r.dueAt)+'</div>' +
    '</div>';
  }).join("") + '</div>' : '<div class="panel empty">No open follow-ups. Nice and caught up.</div>';

  var contacted = list.filter(function(c){return c.stage==="contacted";}).length;
  var connected = list.filter(function(c){return c.stage==="connected";}).length;
  var total = contacted+connected || 1;

  return (
    '<div class="grid-cards">' +
      statCard(list.length, "Total contacts", "contacts") +
      statCard(newThisWeek, "Added past 7 days", "contacts") +
      statCard(globalCallsThisWeek, "Conversations, past 7 days", "activity") +
      statCard(openFollowUps, "Open follow-ups", "reminders") +
    '</div>' +
    '<div class="section">' +
      '<div class="section-head"><h3>Pipeline</h3><a class="link" data-nav="contacts" data-contacts-view="board">View board</a></div>' +
      '<div class="panel" style="padding:16px 18px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-muted);margin-bottom:6px;"><span>Contacted '+contacted+'</span><span>Connected '+connected+'</span></div>' +
        '<div style="height:8px;border-radius:999px;background:var(--warning-soft);overflow:hidden;display:flex;">' +
          '<div style="width:'+(contacted/total*100)+'%;background:var(--warning);"></div>' +
          '<div style="width:'+(connected/total*100)+'%;background:var(--success);"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="section">' +
      '<div class="section-head"><h3>Recent contacts</h3><a class="link" data-nav="contacts">See all</a></div>' + recentHtml +
    '</div>' +
    '<div class="section">' +
      '<div class="section-head"><h3>Follow-ups due</h3><a class="link" data-nav="reminders">See all</a></div>' + remHtml +
    '</div>'
  );
}
function statCard(big, lbl){
  return '<div class="stat-card"><div class="big num">'+big+'</div><div class="lbl">'+esc(lbl)+'</div></div>';
}

// ---------- Contacts ----------
async function renderContacts(){
  var list = visibleContacts();
  var ids = [];
  list.forEach(function(c){ if(c.ownerId) ids.push(c.ownerId); if(c.createdBy) ids.push(c.createdBy); });
  var profiles = await resolveProfiles(ids);

  var indOpts = '<option value="">All industries</option>' + state.industries.map(function(i){
    return '<option value="'+i.id+'" '+(state.industryFilter===i.id?"selected":"")+'>'+esc(i.name)+'</option>';
  }).join("");

  var toolbar =
    '<div class="toolbar">' +
      '<select id="industry-filter">'+indOpts+'</select>' +
      '<select id="sort-by">' +
        '<option value="name" '+(state.sortBy==="name"?"selected":"")+'>Sort: Name</option>' +
        '<option value="recent" '+(state.sortBy==="recent"?"selected":"")+'>Sort: Newest</option>' +
        '<option value="company" '+(state.sortBy==="company"?"selected":"")+'>Sort: Company</option>' +
      '</select>' +
      '<div class="seg">' +
        '<button data-cview="list" class="'+(state.contactsView==="list"?"active":"")+'">List</button>' +
        '<button data-cview="board" class="'+(state.contactsView==="board"?"active":"")+'">Pipeline</button>' +
      '</div>' +
      '<span style="margin-left:auto;font-size:12.5px;color:var(--text-faint);">'+list.length+' contact'+(list.length===1?"":"s")+'</span>' +
    '</div>';

  if(list.length === 0){
    return toolbar + '<div class="panel empty"><div class="big-ico">◆</div>No contacts match yet. Try clearing filters or add a new contact.</div>';
  }

  if(state.contactsView === "board"){
    var contacted = list.filter(function(c){return c.stage==="contacted";});
    var connected = list.filter(function(c){return c.stage==="connected";});
    var col = function(title, items, stage){
      return '<div class="board-col" data-drop-stage="'+stage+'"><h4>'+title+' <span class="count" style="background:var(--surface);padding:1px 7px;border-radius:999px;">'+items.length+'</span></h4>' +
        items.map(function(c){
          return '<div class="board-card" data-action="open-preview" data-id="'+c.id+'">' +
            '<div class="nm">'+esc(c.name)+'</div><div class="sub">'+esc(c.company||industryName(c.industryId))+'</div>' +
            '<div class="mv">' + (stage==="contacted"
              ? '<button class="btn btn-sm" data-action="move-stage" data-id="'+c.id+'" data-stage="connected">Mark connected →</button>'
              : '<button class="btn btn-sm btn-ghost" data-action="move-stage" data-id="'+c.id+'" data-stage="contacted">← Back to contacted</button>') +
            '</div>' +
          '</div>';
        }).join("") +
      '</div>';
    };
    return toolbar + '<div class="board">' + col("Contacted", contacted, "contacted") + col("Connected", connected, "connected") + '</div>';
  }

  if(state.industryFilter){
    var indPositions = state.positions.filter(function(p){ return p.industryId===state.industryFilter; }).sort(function(a,b){ return a.name.localeCompare(b.name); });
    var groups = indPositions.map(function(p){
      return {name: p.name, items: list.filter(function(c){ return c.positionId===p.id; })};
    });
    var knownPosIds = indPositions.map(function(p){return p.id;});
    var noPosItems = list.filter(function(c){ return !c.positionId || knownPosIds.indexOf(c.positionId)===-1; });
    groups.push({name:"No position set", items:noPosItems});
    var visible = groups.filter(function(g){ return g.items.length; });
    var groupsHtml = visible.map(function(g, idx){
      return '<div class="pos-group-head"'+(idx===0?' style="margin-top:0;"':'')+'>'+esc(g.name)+' · '+g.items.length+'</div>' +
        '<div class="panel row-list">' + g.items.map(function(c){ return contactRowHtml(c, profiles, false); }).join("") + '</div>';
    }).join("");
    return toolbar + groupsHtml;
  }

  var rows = list.map(function(c){ return contactRowHtml(c, profiles, true); }).join("");
  return toolbar + '<div class="panel row-list">' + rows + '</div>';
}
function contactRowHtml(c, profiles, showPositionPill){
  var rem = activeReminderFor(c.id);
  var posName = positionName(c.positionId);
  return '<div class="list-row" data-action="open-preview" data-id="'+c.id+'">' +
    '<div class="contact-avatar">'+esc(initialsOf(c.name))+'</div>' +
    '<div class="meta"><div class="nm">'+esc(c.name)+'</div><div class="sub">'+esc([c.title,c.company].filter(Boolean).join(" · ")||industryName(c.industryId))+'</div></div>' +
    '<div class="right">' +
      '<span class="pill '+(c.stage==="connected"?"pill-connected":"pill-contacted")+'">'+STAGE_LABEL[c.stage]+'</span>' +
      (showPositionPill && posName ? '<span class="pill pill-neutral">'+esc(posName)+'</span>' : "") +
      (rem ? reminderStatusPill(rem.dueAt) : "") +
      '<span>'+esc(profileName(c.ownerId, profiles))+'</span>' +
    '</div>' +
  '</div>';
}

// ---------- Reminders ----------
async function renderReminders(){
  var open = state.reminders.filter(function(r){return r.status==="scheduled";}).sort(function(a,b){return new Date(a.dueAt)-new Date(b.dueAt);});
  var done = state.reminders.filter(function(r){return r.status==="completed";}).sort(function(a,b){return new Date(b.completedAt)-new Date(a.completedAt);}).slice(0,20);
  var ids = []; open.concat(done).forEach(function(r){ if(r.assigneeId) ids.push(r.assigneeId); });
  var profiles = await resolveProfiles(ids);

  function row(r, isDone){
    var c = state.contacts.find(function(x){return x.id===r.contactId;});
    return '<div class="list-row">' +
      '<div class="contact-avatar" style="cursor:pointer;" data-action="open-preview" data-id="'+r.contactId+'">'+esc(initialsOf(c?c.name:"?"))+'</div>' +
      '<div class="meta" style="cursor:pointer;" data-action="open-preview" data-id="'+r.contactId+'">' +
        '<div class="nm">'+esc(c?c.name:"Unknown contact")+'</div>' +
        '<div class="sub">'+esc(r.text)+' · '+fmtDateTime(r.dueAt)+' · '+esc(profileName(r.assigneeId, profiles))+'</div>' +
      '</div>' +
      '<div class="right">' +
        (isDone ? '<span class="pill pill-done">Done</span>' : reminderStatusPill(r.dueAt) + '<button class="btn btn-sm btn-primary" data-action="complete-reminder" data-id="'+r.id+'" data-cid="'+r.contactId+'">Complete</button>') +
      '</div>' +
    '</div>';
  }

  var openHtml = open.length ? '<div class="panel row-list">' + open.map(function(r){return row(r,false);}).join("") + '</div>' : '<div class="panel empty">No open follow-ups.</div>';
  var doneHtml = done.length ? '<div class="panel row-list">' + done.map(function(r){return row(r,true);}).join("") + '</div>' : '<div class="panel empty">Nothing completed yet.</div>';

  return (
    '<div class="section"><div class="section-head"><h3>Open ('+open.length+')</h3></div>'+openHtml+'</div>' +
    '<div class="section"><div class="section-head"><h3>Recently completed</h3></div>'+doneHtml+'</div>'
  );
}

// ---------- Calendar ----------
async function renderCalendar(){
  var month = state.calMonth;
  var y = month.getFullYear(), m = month.getMonth();
  var first = new Date(y,m,1);
  var startOffset = first.getDay();
  var daysInMonth = new Date(y,m+1,0).getDate();
  var prevDays = new Date(y,m,0).getDate();
  var todayStr = new Date().toDateString();

  var evByDay = {};
  state.events.forEach(function(e){
    var d = new Date(e.startsAt);
    var key = d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate();
    (evByDay[key] = evByDay[key]||[]).push(e);
  });

  var cells = "";
  for(var i=0;i<startOffset;i++){
    var pd = prevDays-startOffset+i+1;
    cells += '<div class="cal-day out"><div class="d">'+pd+'</div></div>';
  }
  for(var d=1; d<=daysInMonth; d++){
    var dt = new Date(y,m,d);
    var key = y+"-"+m+"-"+d;
    var evs = evByDay[key]||[];
    var isToday = dt.toDateString()===todayStr;
    cells += '<div class="cal-day'+(isToday?" today":"")+'" data-action="open-day" data-date="'+dt.toISOString()+'"><div class="d">'+d+'</div>' +
      evs.slice(0,3).map(function(){return '<span class="evdot"></span>';}).join("") + '</div>';
  }
  var totalCells = startOffset+daysInMonth;
  var trail = (7-(totalCells%7))%7;
  for(var t=1;t<=trail;t++){ cells += '<div class="cal-day out"><div class="d">'+t+'</div></div>'; }

  var dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(function(x){return '<div class="cal-dow">'+x+'</div>';}).join("");

  var upcoming = state.events.filter(function(e){ return new Date(e.startsAt).getTime() >= Date.now()-3600000; })
    .sort(function(a,b){ return new Date(a.startsAt)-new Date(b.startsAt); }).slice(0,8);
  var upHtml = upcoming.length ? '<div class="row-list">' + upcoming.map(function(e){
    var c = state.contacts.find(function(x){return x.id===e.contactId;});
    return '<div class="list-row">' +
      '<div class="contact-avatar" style="cursor:pointer;" data-action="open-preview" data-id="'+e.contactId+'">'+esc(initialsOf(c?c.name:"?"))+'</div>' +
      '<div class="meta"><div class="nm">'+esc(e.title || (CALL_TYPE_LABEL[e.type]+" with "+(c?c.name:"contact")))+'</div><div class="sub">'+fmtDateTime(e.startsAt)+(e.location?" · "+esc(e.location):"")+'</div></div>' +
      '<div class="right"><button class="iconbtn" data-action="delete-event" data-id="'+e.id+'" title="Remove">✕</button></div>' +
    '</div>';
  }).join("") + '</div>' : '<div class="panel empty">No upcoming events scheduled.</div>';

  return (
    '<div class="toolbar">' +
      '<button class="btn btn-sm" data-action="cal-prev">← Prev</button>' +
      '<div style="font-weight:700;font-family:var(--font-display);font-size:15px;">'+month.toLocaleDateString(undefined,{month:"long",year:"numeric"})+'</div>' +
      '<button class="btn btn-sm" data-action="cal-next">Next →</button>' +
      '<button class="btn btn-primary btn-sm" style="margin-left:auto;" data-action="new-event">+ Schedule event</button>' +
    '</div>' +
    '<div class="panel" style="padding:14px;"><div class="cal-grid">'+dows+cells+'</div></div>' +
    '<div class="section" style="margin-top:22px;"><div class="section-head"><h3>Upcoming</h3></div>'+upHtml+'</div>'
  );
}

// ---------- Activity ----------
async function renderActivity(){
  var ids = []; state.activity.forEach(function(a){ if(a.actorId) ids.push(a.actorId); });
  var profiles = await resolveProfiles(ids);
  if(state.activity.length===0) return '<div class="panel empty">No activity yet — actions your team takes will show up here.</div>';
  var items = state.activity.map(function(a){
    return '<div class="activity-item"><span class="dot2"></span><div class="txt">' +
      '<span><b>'+esc(profileName(a.actorId, profiles))+'</b> '+esc(a.summary)+'</span>' +
      '<div class="when">'+fmtDateTime(a.createdAt)+'</div>' +
    '</div></div>';
  }).join("");
  return '<div class="panel" style="padding:6px 18px;">' + items + '</div>';
}

// ---------- Industries ----------
async function renderIndustries(){
  var sorted = state.industries.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var groupsHtml = sorted.map(function(i){
    var count = state.contacts.filter(function(c){return !c.archived && c.industryId===i.id;}).length;
    var positions = state.positions.filter(function(p){return p.industryId===i.id;}).sort(function(a,b){return a.name.localeCompare(b.name);});
    var expanded = state.expandedIndustryId === i.id;
    var posRows = positions.map(function(p){
      var pc = state.contacts.filter(function(c){return !c.archived && c.positionId===p.id;}).length;
      return '<div class="position-pill-row"><span style="flex:1;">'+esc(p.name)+'</span>' +
        '<span style="font-size:11px;color:var(--text-faint);">'+pc+' contact'+(pc===1?"":"s")+'</span>' +
        '<button class="iconbtn" data-action="delete-position" data-id="'+p.id+'" data-name="'+esc(p.name)+'" title="Delete position">🗑</button></div>';
    }).join("");
    var positionsPanel = !expanded ? "" : (
      '<div class="industry-positions">' +
        (posRows || '<div class="hint" style="margin:0 0 4px;">No positions yet for this industry.</div>') +
        '<div class="position-add-row">' +
          '<input type="text" id="new-position-input-'+i.id+'" placeholder="e.g. Dentist, Receptionist, DSO Manager">' +
          '<button class="btn btn-sm btn-primary" data-action="add-position" data-id="'+i.id+'">Add</button>' +
        '</div>' +
      '</div>'
    );
    return '<div class="industry-group">' +
      '<div class="industry-row" data-action="toggle-industry-expand" data-id="'+i.id+'" style="cursor:pointer;">' +
        '<span style="width:14px;text-align:center;color:var(--text-faint);font-size:11px;">'+(expanded?"▾":"▸")+'</span>' +
        '<span class="swatch"></span>' +
        '<div style="flex:1;font-weight:600;font-size:13.5px;">'+esc(i.name)+'</div>' +
        '<span style="font-size:12px;color:var(--text-faint);">'+count+' contact'+(count===1?"":"s")+' · '+positions.length+' position'+(positions.length===1?"":"s")+'</span>' +
        '<button class="iconbtn" data-action="delete-industry" data-id="'+i.id+'" data-name="'+esc(i.name)+'" title="Delete industry">🗑</button>' +
      '</div>' +
      positionsPanel +
    '</div>';
  }).join("");
  var uncategorized = state.contacts.filter(function(c){return !c.archived && !c.industryId;}).length;

  return (
    '<div class="section">' +
      '<div class="panel" style="padding:16px 18px;">' +
        '<div class="field" style="margin:0;display:flex;gap:8px;align-items:flex-end;">' +
          '<div style="flex:1;"><label>Add an industry</label><input type="text" id="new-industry-input" placeholder="e.g. Renewable energy"></div>' +
          '<button class="btn btn-primary" data-action="add-industry">Add</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="section">' +
      '<div class="section-head"><h3>All industries</h3></div>' +
      (groupsHtml ? '<div class="panel">'+groupsHtml+'</div>' : '<div class="panel empty">No industries yet. Add your first one above.</div>') +
      '<div class="hint" style="margin-top:8px;">Uncategorized: '+uncategorized+' contact'+(uncategorized===1?"":"s")+'. Click an industry to manage its positions (e.g. Dentist, Receptionist, DSO Manager) — contacts filtered to one industry group by position automatically. Deleting an industry or a position keeps its contacts; they just lose that label.</div>' +
    '</div>'
  );
}

// ---------- Contact full view ----------
async function renderContactFull(id){
  var c = state.contacts.find(function(x){return x.id===id;});
  if(!c) return '<div class="panel empty">This contact could not be found.</div>';
  if(notesUnsub===null || state._lastOpen!==id){ state._lastOpen=id; subscribeContactChildren(id); }

  var ids = [c.createdBy, c.updatedBy, c.ownerId].filter(Boolean);
  state.notes.forEach(function(n){ if(n.authorId) ids.push(n.authorId); });
  state.calls.forEach(function(cl){ if(cl.createdBy) ids.push(cl.createdBy); });
  var contactReminders = state.reminders.filter(function(r){return r.contactId===id;});
  contactReminders.forEach(function(r){ if(r.assigneeId) ids.push(r.assigneeId); });
  var contactActivity = state.activity.filter(function(a){return a.contactId===id;});
  contactActivity.forEach(function(a){ if(a.actorId) ids.push(a.actorId); });
  var profiles = await resolveProfiles(ids);

  var hero =
    '<div class="contact-hero">' +
      '<div class="contact-avatar" style="width:52px;height:52px;font-size:18px;">'+esc(initialsOf(c.name))+'</div>' +
      '<div class="info" style="flex:1;">' +
        '<h3>'+esc(c.name)+'</h3>' +
        '<div class="role">'+esc([c.title,c.company].filter(Boolean).join(" at ")||"—")+'</div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<span class="pill '+(c.stage==="connected"?"pill-connected":"pill-contacted")+'">'+STAGE_LABEL[c.stage]+'</span>' +
          '<span class="pill pill-neutral">'+esc(industryName(c.industryId))+'</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="btn btn-sm" data-action="edit-contact" data-id="'+c.id+'">Edit</button>' +
        '<button class="btn btn-sm btn-danger" data-action="delete-contact" data-id="'+c.id+'" data-name="'+esc(c.name)+'">Delete</button>' +
      '</div>' +
    '</div>' +
    '<div class="actions-row">' +
      (c.phone ? '<a class="btn btn-sm" href="tel:'+esc(c.phone)+'">📞 '+esc(c.phone)+'</a>' : '') +
      (c.email ? '<a class="btn btn-sm" href="mailto:'+esc(c.email)+'">✉ '+esc(c.email)+'</a>' : '') +
      (c.linkedin ? '<a class="btn btn-sm" href="'+esc(c.linkedin)+'" target="_blank" rel="noopener">in LinkedIn</a>' : '') +
      '<button class="btn btn-sm '+(c.stage==="contacted"?"btn-primary":"")+'" data-action="move-stage" data-id="'+c.id+'" data-stage="'+(c.stage==="contacted"?"connected":"contacted")+'">' +
        (c.stage==="contacted"?"Mark as connected":"Move back to contacted") +
      '</button>' +
    '</div>' +
    '<div class="kv-grid">' +
      kv("Owner", esc(profileName(c.ownerId, profiles))) +
      kv("Created", esc(profileName(c.createdBy, profiles))+' · '+fmtDate(c.createdAt)) +
      kv("Last updated", esc(profileName(c.updatedBy, profiles))+' · '+timeAgo(c.updatedAt)) +
      kv("Industry", esc(industryName(c.industryId))) +
      kv("Position", esc(positionName(c.positionId) || "—")) +
    '</div>';

  var tabs = ["overview","notes","calls","reminders","activity"];
  var tabLabels = {overview:"Next step", notes:"Notes ("+state.notes.length+")", calls:"Calls ("+state.calls.length+")", reminders:"Reminders ("+contactReminders.length+")", activity:"Activity ("+contactActivity.length+")"};
  var tabsHtml = '<div class="tabs">' + tabs.map(function(t){
    return '<div class="tab '+(state.contactTab===t?"active":"")+'" data-action="set-contact-tab" data-tab="'+t+'">'+tabLabels[t]+'</div>';
  }).join("") + '</div>';

  var body = "";
  if(state.contactTab==="overview"){
    var active = activeReminderFor(c.id);
    if(active){
      body = '<div class="panel" style="padding:18px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
          '<div><div style="font-weight:700;font-size:14.5px;">'+esc(active.text)+'</div>' +
          '<div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">Due '+fmtDateTime(active.dueAt)+' · assigned to '+esc(profileName(active.assigneeId, profiles))+'</div></div>' +
          reminderStatusPill(active.dueAt) +
        '</div>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:14px;" data-action="complete-reminder" data-id="'+active.id+'" data-cid="'+c.id+'">Mark complete</button>' +
      '</div>';
    } else {
      body = '<div class="panel empty">No active next step.</div>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:12px;" data-action="new-reminder-form" data-id="'+c.id+'">+ Schedule a follow-up</button>';
    }
    if(state.showNextStepAfter === c.id){
      body += newReminderInlineForm(c.id, profiles);
    }
  } else if(state.contactTab==="notes"){
    var notesHtml = state.notes.length ? state.notes.map(function(n){
      var bodyHtml = n.rich ? sanitizeNoteHtml(n.body) : esc(n.body).replace(/\n/g,"<br>");
      return '<div class="note-item">' +
        '<div class="ttl">'+esc(n.title || "Untitled note")+'</div>' +
        '<div class="head">'+esc(profileName(n.authorId, profiles))+' · '+timeAgo(n.createdAt)+'</div>' +
        '<div class="body">'+bodyHtml+'</div>' +
      '</div>';
    }).join("") : '<div class="empty">No notes yet — log what happened in each interaction here.</div>';
    body = '<div class="panel" style="padding:6px 18px;">'+notesHtml+'</div>' + noteComposerHtml(c.id);
  } else if(state.contactTab==="calls"){
    var callsHtml = state.calls.length ? state.calls.map(function(cl){
      return '<div class="note-item"><div class="head"><span class="pill pill-neutral">'+CALL_TYPE_LABEL[cl.type]+'</span> '+fmtDateTime(cl.occurredAt)+' · '+cl.durationMinutes+' min · logged by '+esc(profileName(cl.createdBy, profiles))+'</div>' +
        (cl.notes?'<div class="body">'+esc(cl.notes)+'</div>':'')+'</div>';
    }).join("") : '<div class="empty">No conversations logged yet.</div>';
    body = '<div class="panel" style="padding:6px 18px;">'+callsHtml+'</div>' +
      '<button class="btn btn-primary btn-sm" style="margin-top:12px;" data-action="log-call-form" data-id="'+c.id+'">+ Log a conversation</button>' +
      (state.route.showCallForm ? logCallForm(c.id) : "");
  } else if(state.contactTab==="reminders"){
    contactReminders.sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt);});
    var remHtml = contactReminders.length ? contactReminders.map(function(r){
      return '<div class="list-row" style="cursor:default;"><div class="meta"><div class="nm">'+esc(r.text)+'</div><div class="sub">Due '+fmtDateTime(r.dueAt)+' · '+esc(profileName(r.assigneeId, profiles))+'</div></div>' +
        '<div class="right">' + (r.status==="completed" ? '<span class="pill pill-done">Completed '+fmtDate(r.completedAt)+'</span>' : reminderStatusPill(r.dueAt)+'<button class="btn btn-sm btn-primary" data-action="complete-reminder" data-id="'+r.id+'" data-cid="'+c.id+'">Complete</button>') + '</div></div>';
    }).join("") : '<div class="empty">No follow-up history yet.</div>';
    body = '<div class="panel row-list">'+remHtml+'</div>' +
      '<button class="btn btn-sm" style="margin-top:12px;" data-action="new-reminder-form" data-id="'+c.id+'">+ Schedule another follow-up</button>' +
      (state.showNextStepAfter === c.id ? newReminderInlineForm(c.id, profiles) : "");
  } else if(state.contactTab==="activity"){
    body = contactActivity.length ? '<div class="panel" style="padding:6px 18px;">' + contactActivity.map(function(a){
      return '<div class="activity-item"><span class="dot2"></span><div class="txt"><span><b>'+esc(profileName(a.actorId, profiles))+'</b> '+esc(a.summary)+'</span><div class="when">'+fmtDateTime(a.createdAt)+'</div></div></div>';
    }).join("") + '</div>' : '<div class="panel empty">No activity recorded for this contact.</div>';
  }

  return '<div class="panel">' + hero + tabsHtml + '<div class="tab-body">' + body + '</div></div>';
}
function kv(k,v){ return '<div><div class="k">'+esc(k)+'</div><div class="v">'+v+'</div></div>'; }

function newReminderInlineForm(contactId){
  return '<div class="panel" style="padding:16px;margin-top:10px;">' +
    '<div class="field"><label>Next step</label><input type="text" id="rem-text-'+contactId+'" placeholder="What\'s next?"></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Due</label><input type="datetime-local" id="rem-due-'+contactId+'" value="'+toLocalInputValue(plusHoursISO(48))+'"></div>' +
      '<div class="field"><label>Assign to</label>' + peoplePickerHtml("rem-assignee-"+contactId, state.me.id) + '</div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" data-action="save-reminder" data-id="'+contactId+'">Save follow-up</button>' +
  '</div>';
}
function noteComposerHtml(contactId){
  return '<div class="note-composer">' +
    '<input type="text" class="note-title-input" id="note-title-'+contactId+'" placeholder="Note title — e.g. “Intro call”, “Follow-up email”" maxlength="120">' +
    '<div class="rich-toolbar">' +
      '<button type="button" data-richcmd="bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button>' +
      '<button type="button" data-richcmd="italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button>' +
      '<button type="button" data-richcmd="underline" title="Underline (Ctrl/Cmd+U)"><u>U</u></button>' +
      '<span class="rich-sep"></span>' +
      '<button type="button" data-richcmd="size-down" title="Smaller text (select text first)">A−</button>' +
      '<button type="button" data-richcmd="size-up" title="Bigger text (select text first)">A+</button>' +
      '<span class="rich-sep"></span>' +
      '<button type="button" data-richcmd="justifyLeft" title="Align left">⟸</button>' +
      '<button type="button" data-richcmd="justifyCenter" title="Align center">≡</button>' +
      '<button type="button" data-richcmd="justifyRight" title="Align right">⟹</button>' +
      '<span class="rich-sep"></span>' +
      '<button type="button" data-richcmd="clear" title="Clear formatting">Clear</button>' +
    '</div>' +
    '<div class="rich-editor" id="note-body-'+contactId+'" contenteditable="true" data-placeholder="Write what happened, what was discussed, and any next steps…"></div>' +
    '<div id="note-error-'+contactId+'" class="hint" style="color:var(--danger);"></div>' +
    '<div class="foot-row"><button class="btn btn-primary btn-sm" data-action="add-note" data-id="'+contactId+'">Save note</button></div>' +
  '</div>';
}
function logCallForm(contactId){
  return '<div class="panel" style="padding:16px;margin-top:10px;">' +
    '<div class="field-row">' +
      '<div class="field"><label>Type</label><select id="call-type-'+contactId+'"><option value="call">Call</option><option value="video">Video meeting</option><option value="in_person">In person</option><option value="other">Other</option></select></div>' +
      '<div class="field"><label>Duration (min)</label><input type="number" id="call-dur-'+contactId+'" value="15" min="0"></div>' +
    '</div>' +
    '<div class="field"><label>When</label><input type="datetime-local" id="call-when-'+contactId+'" value="'+toLocalInputValue(new Date().toISOString())+'"></div>' +
    '<div class="field"><label>Notes</label><textarea id="call-notes-'+contactId+'" rows="2" placeholder="What did you cover?"></textarea></div>' +
    '<button class="btn btn-primary btn-sm" data-action="save-call" data-id="'+contactId+'">Save conversation</button>' +
  '</div>';
}

function peoplePickerHtml(fieldId, selectedId){
  var nm = selectedId ? profileName(selectedId) : "Unassigned";
  return '<div class="people-pick" data-field="'+fieldId+'">' +
    '<input type="text" class="people-input" id="'+fieldId+'" data-selected="'+(selectedId||"")+'" value="'+esc(nm)+'" autocomplete="off" placeholder="Type a name…">' +
  '</div>';
}

// ---------- Modals ----------
function renderModal(){
  var root = $("#modal-root");
  var formOpen = state.route.modal === "new-contact" || state.route.modal === "new-event" || state.editingContact;
  if(!formOpen) root.removeAttribute("data-open");
  if(state.previewId){
    var c = state.contacts.find(function(x){return x.id===state.previewId;});
    if(!c){ root.innerHTML=""; return; }
    var rem = activeReminderFor(c.id);
    root.innerHTML =
      '<div class="overlay" data-overlay="1">' +
        '<div class="modal">' +
          '<div class="modal-head"><h3>'+esc(c.name)+'</h3><button class="iconbtn" data-action="close-modal">✕</button></div>' +
          '<div class="modal-body">' +
            '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;">' +
              '<div class="contact-avatar" style="width:48px;height:48px;">'+esc(initialsOf(c.name))+'</div>' +
              '<div><div style="font-weight:700;">'+esc([c.title,c.company].filter(Boolean).join(" at ")||"—")+'</div>' +
              '<span class="pill '+(c.stage==="connected"?"pill-connected":"pill-contacted")+'">'+STAGE_LABEL[c.stage]+'</span>' +
              (positionName(c.positionId) ? ' <span class="pill pill-neutral">'+esc(positionName(c.positionId))+'</span>' : '') +
              '</div>' +
            '</div>' +
            (c.email?'<div style="font-size:13px;margin-bottom:4px;">✉ <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a></div>':'') +
            (c.phone?'<div style="font-size:13px;margin-bottom:4px;">📞 <a href="tel:'+esc(c.phone)+'">'+esc(c.phone)+'</a></div>':'') +
            (c.linkedin?'<div style="font-size:13px;margin-bottom:4px;">in <a href="'+esc(c.linkedin)+'" target="_blank" rel="noopener">LinkedIn profile</a></div>':'') +
            (rem ? '<div class="hint" style="margin-top:10px;">Next: '+esc(rem.text)+' — '+fmtDateTime(rem.dueAt)+'</div>' : '') +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn" data-action="close-modal">Close</button>' +
            '<button class="btn" data-action="edit-contact" data-id="'+c.id+'">Edit</button>' +
            '<button class="btn btn-primary" data-action="open-full" data-id="'+c.id+'">Open full screen</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    return;
  }
  if(state.route.modal === "new-contact"){
    if(root.getAttribute("data-open") !== "new-contact"){ root.innerHTML = newContactModalHtml(); root.setAttribute("data-open","new-contact"); }
    return;
  }
  if(state.route.modal === "new-event"){
    if(root.getAttribute("data-open") !== "new-event"){ root.innerHTML = newEventModalHtml(); root.setAttribute("data-open","new-event"); }
    return;
  }
  if(state.editingContact){
    var ek = "edit-"+state.editingContact.id;
    if(root.getAttribute("data-open") !== ek){ root.innerHTML = editContactModalHtml(state.editingContact); root.setAttribute("data-open",ek); }
    return;
  }
  if(state.route.confirmDelete){
    var cd = state.route.confirmDelete;
    root.innerHTML =
      '<div class="overlay" data-overlay="1"><div class="modal">' +
        '<div class="modal-head"><h3>Delete '+esc(cd.name)+'?</h3></div>' +
        '<div class="modal-body"><p style="font-size:13.5px;color:var(--text-muted);">This removes '+esc(cd.name)+' from active views. Notes, calls and history are kept for the record, and this action is logged in Activity.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-danger" data-action="confirm-delete-contact" data-id="'+cd.id+'">Delete contact</button></div>' +
      '</div></div>';
    return;
  }
  if(state.route.confirmDeleteIndustry){
    var ci = state.route.confirmDeleteIndustry;
    root.innerHTML =
      '<div class="overlay" data-overlay="1"><div class="modal">' +
        '<div class="modal-head"><h3>Delete "'+esc(ci.name)+'"?</h3></div>' +
        '<div class="modal-body"><p style="font-size:13.5px;color:var(--text-muted);">Contacts in this industry become Uncategorized. Nothing else is deleted.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-danger" data-action="confirm-delete-industry" data-id="'+ci.id+'">Delete industry</button></div>' +
      '</div></div>';
    return;
  }
  if(state.route.confirmDeletePosition){
    var cp = state.route.confirmDeletePosition;
    root.innerHTML =
      '<div class="overlay" data-overlay="1"><div class="modal">' +
        '<div class="modal-head"><h3>Delete "'+esc(cp.name)+'"?</h3></div>' +
        '<div class="modal-body"><p style="font-size:13.5px;color:var(--text-muted);">Contacts with this position keep everything else and just lose this position label.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-danger" data-action="confirm-delete-position" data-id="'+cp.id+'">Delete position</button></div>' +
      '</div></div>';
    return;
  }
  root.innerHTML = "";
}

function industrySelectHtml(id, selected){
  var opts = '<option value="">Uncategorized</option>' + state.industries.map(function(i){
    return '<option value="'+i.id+'" '+(selected===i.id?"selected":"")+'>'+esc(i.name)+'</option>';
  }).join("");
  return '<select id="'+id+'">'+opts+'</select>';
}

function newContactModalHtml(){
  return '<div class="overlay" data-overlay="1"><div class="modal wide">' +
    '<div class="modal-head"><h3>New contact</h3><button class="iconbtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="field"><label>Full name *</label><input type="text" id="nc-name" placeholder="Jordan Kim"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Job title</label><input type="text" id="nc-title"></div>' +
        '<div class="field"><label>Company</label><input type="text" id="nc-company"></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Phone</label><input type="tel" id="nc-phone"></div>' +
        '<div class="field"><label>Email</label><input type="email" id="nc-email"></div>' +
      '</div>' +
      '<div class="field"><label>LinkedIn URL</label><input type="url" id="nc-linkedin" placeholder="https://linkedin.com/in/…"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Industry</label>'+industrySelectHtml("nc-industry","")+'</div>' +
        '<div class="field"><label>Owner</label>'+peoplePickerHtml("nc-owner", state.me.id)+'</div>' +
      '</div>' +
      positionFieldHtml("nc-position","nc-industry","",null) +
      '<div class="field"><label>Pipeline stage</label><div class="radio-row">' +
        '<div class="radio-chip active" data-radio="nc-stage" data-value="contacted">Contacted</div>' +
        '<div class="radio-chip" data-radio="nc-stage" data-value="connected">Connected</div>' +
      '</div><input type="hidden" id="nc-stage" value="contacted"></div>' +
      '<div class="field"><label>Next step *</label><input type="text" id="nc-nextstep" placeholder="e.g. Send proposal"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Reminder due</label><input type="datetime-local" id="nc-due" value="'+toLocalInputValue(plusHoursISO(48))+'"><div class="hint">Defaults to 48 hours from now</div></div>' +
        '<div class="field"><label>Remind</label>'+peoplePickerHtml("nc-assignee", state.me.id)+'</div>' +
      '</div>' +
      '<div id="nc-error" class="hint" style="color:var(--danger);"></div>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-new-contact">Add contact</button></div>' +
  '</div></div>';
}

function editContactModalHtml(c){
  return '<div class="overlay" data-overlay="1"><div class="modal wide">' +
    '<div class="modal-head"><h3>Edit contact</h3><button class="iconbtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="field"><label>Full name *</label><input type="text" id="ec-name" value="'+esc(c.name)+'"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Job title</label><input type="text" id="ec-title" value="'+esc(c.title)+'"></div>' +
        '<div class="field"><label>Company</label><input type="text" id="ec-company" value="'+esc(c.company)+'"></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Phone</label><input type="tel" id="ec-phone" value="'+esc(c.phone)+'"></div>' +
        '<div class="field"><label>Email</label><input type="email" id="ec-email" value="'+esc(c.email)+'"></div>' +
      '</div>' +
      '<div class="field"><label>LinkedIn URL</label><input type="url" id="ec-linkedin" value="'+esc(c.linkedin)+'"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Industry</label>'+industrySelectHtml("ec-industry", c.industryId)+'</div>' +
        '<div class="field"><label>Owner</label>'+peoplePickerHtml("ec-owner", c.ownerId)+'</div>' +
      '</div>' +
      positionFieldHtml("ec-position","ec-industry", c.industryId||null, c.positionId||null) +
      '<div id="ec-error" class="hint" style="color:var(--danger);"></div>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-edit-contact" data-id="'+c.id+'">Save changes</button></div>' +
  '</div></div>';
}

function newEventModalHtml(){
  var opts = state.contacts.filter(function(c){return !c.archived;}).sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(c){
    return '<option value="'+c.id+'">'+esc(c.name)+'</option>';
  }).join("");
  var d = state.calSelected || new Date();
  return '<div class="overlay" data-overlay="1"><div class="modal">' +
    '<div class="modal-head"><h3>Schedule event</h3><button class="iconbtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="field"><label>Contact *</label><select id="ev-contact"><option value="">Select a contact…</option>'+opts+'</select></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Type</label><select id="ev-type"><option value="call">Call</option><option value="video">Video meeting</option><option value="in_person">In person</option><option value="other">Other</option></select></div>' +
        '<div class="field"><label>Duration (min)</label><input type="number" id="ev-dur" value="30" min="0"></div>' +
      '</div>' +
      '<div class="field"><label>Title</label><input type="text" id="ev-title" placeholder="e.g. Quarterly check-in"></div>' +
      '<div class="field"><label>Date &amp; time *</label><input type="datetime-local" id="ev-when" value="'+toLocalInputValue(d.toISOString())+'"></div>' +
      '<div class="field"><label>Location or link</label><input type="text" id="ev-loc" placeholder="Zoom link or address"></div>' +
      '<div class="field"><label>Notes</label><textarea id="ev-notes" rows="2"></textarea></div>' +
      '<div id="ev-error" class="hint" style="color:var(--danger);"></div>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-event">Schedule</button></div>' +
  '</div></div>';
}

// ---------- People picker wiring ----------
function wirePeoplePicker(input){
  if(input.getAttribute("data-wired")) return;
  input.setAttribute("data-wired","1");
  var wrap = input.closest(".people-pick");
  var openMenu = async function(q){
    var results = await (userApi ? userApi.search(q||"") : Promise.resolve([]));
    var menu = wrap.querySelector(".people-menu");
    if(menu) menu.remove();
    menu = document.createElement("div");
    menu.className = "people-menu";
    var optsHtml = '<div class="people-opt" data-pick="">Unassigned</div>' +
      '<div class="people-opt" data-pick="'+state.me.id+'">'+esc(state.me.name||"You")+' (you)</div>' +
      results.filter(function(p){return p.id!==state.me.id;}).map(function(p){
        state.profileCache[p.id] = p;
        return '<div class="people-opt" data-pick="'+p.id+'">'+esc(p.name||"Someone")+'</div>';
      }).join("");
    menu.innerHTML = optsHtml;
    wrap.appendChild(menu);
    menu.querySelectorAll("[data-pick]").forEach(function(opt){
      opt.addEventListener("mousedown", function(e){
        e.preventDefault();
        var id = opt.getAttribute("data-pick");
        input.value = id ? profileName(id) : "Unassigned";
        input.setAttribute("data-selected", id);
        menu.remove();
      });
    });
  };
  input.addEventListener("focus", function(){ openMenu(""); });
  input.addEventListener("input", debounce(function(){ openMenu(input.value); }, 220));
  input.addEventListener("blur", function(){ setTimeout(function(){ var m=wrap.querySelector(".people-menu"); if(m) m.remove(); }, 150); });
}

// ---------- event wiring ----------
function wireIndustryPositionLink(industryFieldId, positionSelectId){
  var indEl = document.getElementById(industryFieldId);
  if(!indEl || indEl.getAttribute("data-wired-pos")) return;
  indEl.setAttribute("data-wired-pos","1");
  indEl.addEventListener("change", function(){
    var posSel = document.getElementById(positionSelectId);
    if(!posSel) return;
    posSel.innerHTML = positionOptionsMarkup(indEl.value || null, null);
    posSel.disabled = !indEl.value;
    var addBtn = document.querySelector('[data-action="toggle-add-position"][data-select="'+positionSelectId+'"]');
    if(addBtn) addBtn.disabled = !indEl.value;
    var addRow = document.getElementById(positionSelectId+"-addrow");
    if(addRow) addRow.hidden = true;
  });
}
function wireDynamic(){
  document.querySelectorAll(".people-input").forEach(wirePeoplePicker);
  var gi = $("#industry-filter");
  if(gi) gi.addEventListener("change", function(){ state.industryFilter = gi.value; render(); });
  var sb = $("#sort-by");
  if(sb) sb.addEventListener("change", function(){ state.sortBy = sb.value; render(); });
  document.querySelectorAll("[data-cview]").forEach(function(b){
    b.addEventListener("click", function(){ state.contactsView = b.getAttribute("data-cview"); render(); });
  });
  document.querySelectorAll("[data-radio]").forEach(function(el){
    if(el.getAttribute("data-wired")) return;
    el.setAttribute("data-wired","1");
    el.addEventListener("click", function(){
      var group = el.getAttribute("data-radio");
      document.querySelectorAll('[data-radio="'+group+'"]').forEach(function(x){x.classList.remove("active");});
      el.classList.add("active");
      $("#"+group).value = el.getAttribute("data-value");
    });
  });
  wireIndustryPositionLink("nc-industry","nc-position");
  wireIndustryPositionLink("ec-industry","ec-position");
}

var gsearch = $("#global-search");
if(gsearch){
  gsearch.addEventListener("input", debounce(function(){ state.search = gsearch.value; render(); }, 180));
}

// ---------- clicks ----------
document.addEventListener("click", function(e){
  if(e.target.hasAttribute && e.target.hasAttribute("data-overlay")){
    state.route = Object.assign({}, state.route, {modal:null, confirmDelete:null, confirmDeleteIndustry:null, confirmDeletePosition:null});
    state.previewId = null; state.editingContact = null; state.calSelected=null;
    return render();
  }
  var el = e.target.closest("[data-action],[data-nav]");
  if(!el) return;
  var nav = el.getAttribute("data-nav");
  if(nav){
    state.route = {view: nav};
    state.mobileOpen = false;
    if(el.hasAttribute("data-contacts-view")) state.contactsView = el.getAttribute("data-contacts-view");
    if(roomApi) roomApi.presence({view: nav});
    return render();
  }
  var action = el.getAttribute("data-action");
  if(!action) return;
  var id = el.getAttribute("data-id");
  switch(action){
    case "toggle-sidebar":
      if(window.innerWidth <= 760){ state.mobileOpen = !state.mobileOpen; } else { state.sidebarCollapsed = !state.sidebarCollapsed; }
      return render();
    case "go-home":
      state.route = {view:"home"}; return render();
    case "new-contact":
      state.route = Object.assign({}, state.route, {modal:"new-contact"}); return render();
    case "new-event":
      state.calSelected = null;
      state.route = Object.assign({}, state.route, {modal:"new-event"}); return render();
    case "open-day":
      state.calSelected = new Date(el.getAttribute("data-date"));
      state.route = Object.assign({}, state.route, {modal:"new-event"}); return render();
    case "close-modal":
      state.route = Object.assign({}, state.route, {modal:null, confirmDelete:null, confirmDeleteIndustry:null, confirmDeletePosition:null});
      state.previewId = null; state.editingContact = null; state.calSelected=null;
      return render();
    case "open-preview":
      state.previewId = id; return render();
    case "open-full":
      state.previewId = null;
      state.contactTab = "overview";
      state.route = {view:"contact", id: id};
      unsubscribeContactChildren();
      return render();
    case "edit-contact":
      var c1 = state.contacts.find(function(x){return x.id===id;});
      state.editingContact = c1; state.previewId = null; return render();
    case "save-edit-contact": return saveEditContact(id);
    case "delete-contact":
      state.route = Object.assign({}, state.route, {confirmDelete:{id:id, name: el.getAttribute("data-name")}});
      return render();
    case "confirm-delete-contact": return doDeleteContact(id);
    case "move-stage": return doMoveStage(id, el.getAttribute("data-stage"));
    case "save-new-contact": return saveNewContact();
    case "set-contact-tab":
      state.contactTab = el.getAttribute("data-tab");
      state.route = Object.assign({}, state.route, {showCallForm:false});
      return render();
    case "add-note": return doAddNote(id);
    case "log-call-form":
      state.route = Object.assign({}, state.route, {showCallForm:true}); return render();
    case "save-call": return doSaveCall(id);
    case "new-reminder-form":
      state.showNextStepAfter = id; return render();
    case "save-reminder": return doSaveReminder(id);
    case "complete-reminder": return doCompleteReminder(id, el.getAttribute("data-cid"));
    case "add-industry": return doAddIndustry();
    case "delete-industry":
      state.route = Object.assign({}, state.route, {confirmDeleteIndustry:{id:id, name: el.getAttribute("data-name")}});
      return render();
    case "confirm-delete-industry": return doDeleteIndustryConfirm(id);
    case "toggle-industry-expand":
      state.expandedIndustryId = (state.expandedIndustryId === id) ? null : id;
      return render();
    case "add-position": return doAddPosition(id);
    case "delete-position":
      state.route = Object.assign({}, state.route, {confirmDeletePosition:{id:id, name: el.getAttribute("data-name")}});
      return render();
    case "confirm-delete-position": return doDeletePositionConfirm(id);
    case "toggle-add-position":
      var selId = el.getAttribute("data-select");
      var addRow = document.getElementById(selId+"-addrow");
      if(addRow){
        addRow.hidden = !addRow.hidden;
        if(!addRow.hidden){ var newInp = document.getElementById(selId+"-newval"); if(newInp) newInp.focus(); }
      }
      return;
    case "confirm-add-position": return doConfirmAddPosition(el.getAttribute("data-select"), el.getAttribute("data-industry-field"));
    case "save-event": return doSaveEvent();
    case "delete-event": return doDeleteEvent(id);
    case "cal-prev":
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth()-1, 1); return render();
    case "cal-next":
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth()+1, 1); return render();
  }
});

function selectedPeople(id){
  var el = document.getElementById(id);
  return el ? (el.getAttribute("data-selected") || null) : null;
}

async function saveNewContact(){
  var nameEl = $("#nc-name"), stepEl = $("#nc-nextstep");
  var name = nameEl.value.trim();
  var nextStep = stepEl.value.trim();
  var err = $("#nc-error");
  nameEl.style.borderColor = ""; stepEl.style.borderColor = "";
  if(!name || !nextStep){
    err.style.fontWeight = "700"; err.style.fontSize = "13px";
    err.textContent = (!name && !nextStep) ? "Name and next step are both required."
      : (!name ? "Name is required." : "Next step is required — it becomes the 48-hour follow-up reminder.");
    var bad = !name ? nameEl : stepEl;
    bad.style.borderColor = "var(--danger)";
    bad.focus();
    bad.scrollIntoView({block:"center"});
    return;
  }
  err.textContent = "";
  var btn = document.querySelector('[data-action="save-new-contact"]');
  if(btn){ btn.disabled = true; btn.textContent = "Saving…"; }
  try{
    await createContact({
      name: name, title: $("#nc-title").value.trim(), company: $("#nc-company").value.trim(),
      phone: $("#nc-phone").value.trim(), email: $("#nc-email").value.trim(), linkedin: $("#nc-linkedin").value.trim(),
      industryId: $("#nc-industry").value || null, positionId: $("#nc-position").value || null, ownerId: selectedPeople("nc-owner"),
      stage: $("#nc-stage").value, nextStep: nextStep,
      dueAt: fromLocalInputValue($("#nc-due").value), assigneeId: selectedPeople("nc-assignee")
    });
    state.route = Object.assign({}, state.route, {modal:null});
    toast(name+" was added.");
    render();
  }catch(e){
    err.textContent = friendlyDbError(e);
    if(btn){ btn.disabled = false; btn.textContent = "Add contact"; }
  }
}

async function saveEditContact(id){
  var name = $("#ec-name").value.trim();
  var err = $("#ec-error");
  if(!name){ err.style.fontWeight="700"; err.textContent = "Name is required."; $("#ec-name").focus(); return; }
  err.textContent = "";
  try{
    await updateContact(id, {
      name:name, title:$("#ec-title").value.trim(), company:$("#ec-company").value.trim(),
      phone:$("#ec-phone").value.trim(), email:$("#ec-email").value.trim(), linkedin:$("#ec-linkedin").value.trim(),
      industryId: $("#ec-industry").value || null, positionId: $("#ec-position").value || null, ownerId: selectedPeople("ec-owner")
    }, name, "updated "+name+"'s details");
    state.editingContact = null;
    render();
  }catch(e){ err.textContent = friendlyDbError(e); }
}

async function doDeleteContact(id){
  var c = state.contacts.find(function(x){return x.id===id;});
  try{
    if(c) await archiveContact(c);
    state.route = {view:"contacts"};
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doMoveStage(id, stage){
  var c = state.contacts.find(function(x){return x.id===id;});
  try{ if(c) await changeStage(c, stage); render(); }
  catch(e){ toast(friendlyDbError(e), true); }
}
async function doAddNote(contactId){
  var titleEl = $("#note-title-"+contactId);
  var editor = $("#note-body-"+contactId);
  var err = $("#note-error-"+contactId);
  var title = titleEl.value.trim();
  var bodyText = editor.textContent.trim();
  titleEl.style.borderColor = ""; editor.style.borderColor = "";
  if(!title || !bodyText){
    if(err){ err.style.fontWeight = "700"; err.textContent = (!title && !bodyText) ? "Give the note a title and write what happened."
      : (!title ? "Give this note a title." : "Write something before saving."); }
    var bad = !title ? titleEl : editor;
    bad.style.borderColor = "var(--danger)";
    bad.focus();
    return;
  }
  if(err) err.textContent = "";
  var c = state.contacts.find(function(x){return x.id===contactId;});
  try{
    await addNote(contactId, c?c.name:"", title, editor.innerHTML);
    render();
  }catch(e){ if(err) err.textContent = friendlyDbError(e); else toast(friendlyDbError(e), true); }
}
async function doSaveCall(contactId){
  var c = state.contacts.find(function(x){return x.id===contactId;});
  try{
    await logCall(c, {
      type: $("#call-type-"+contactId).value,
      occurredAt: fromLocalInputValue($("#call-when-"+contactId).value),
      durationMinutes: $("#call-dur-"+contactId).value,
      notes: $("#call-notes-"+contactId).value.trim()
    });
    state.route = Object.assign({}, state.route, {showCallForm:false});
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doSaveReminder(contactId){
  var text = $("#rem-text-"+contactId).value.trim();
  if(!text) return;
  var c = state.contacts.find(function(x){return x.id===contactId;});
  try{
    await createReminder(c, {
      text:text, dueAt: fromLocalInputValue($("#rem-due-"+contactId).value),
      assigneeId: selectedPeople("rem-assignee-"+contactId)
    });
    state.showNextStepAfter = null;
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doCompleteReminder(id, contactId){
  var r = state.reminders.find(function(x){return x.id===id;});
  var c = state.contacts.find(function(x){return x.id===contactId;});
  try{
    if(r) await completeReminder(r, c?c.name:"");
    state.showNextStepAfter = contactId;
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doAddIndustry(){
  var input = $("#new-industry-input");
  var v = input.value;
  input.style.borderColor = "";
  try{
    var res = await addIndustry(v);
    if(res === "dup"){ input.style.borderColor = "var(--danger)"; toast("That industry already exists.", true); return; }
    if(res === null){ return; }
    input.value = "";
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doDeleteIndustryConfirm(id){
  var ind = state.industries.find(function(x){return x.id===id;});
  try{
    if(ind) await deleteIndustry(ind);
    state.route = Object.assign({}, state.route, {confirmDeleteIndustry:null});
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doAddPosition(industryId){
  var input = document.getElementById("new-position-input-"+industryId);
  if(!input) return;
  var v = input.value;
  input.style.borderColor = "";
  try{
    var res = await addPosition(industryId, v);
    if(res === "dup"){ input.style.borderColor = "var(--danger)"; toast("That position already exists for this industry.", true); return; }
    if(res === null) return;
    input.value = "";
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doDeletePositionConfirm(id){
  var pos = state.positions.find(function(x){return x.id===id;});
  try{
    if(pos) await deletePosition(pos);
    state.route = Object.assign({}, state.route, {confirmDeletePosition:null});
    render();
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doConfirmAddPosition(selectId, industryFieldId){
  var indEl = document.getElementById(industryFieldId);
  var industryId = indEl ? indEl.value : "";
  if(!industryId) return;
  var inputEl = document.getElementById(selectId+"-newval");
  var val = inputEl ? inputEl.value : "";
  try{
    var res = await addPosition(industryId, val);
    if(res === "dup"){ toast("That position already exists for this industry.", true); return; }
    if(res === null) return;
    var sel = document.getElementById(selectId);
    if(sel) sel.innerHTML = positionOptionsMarkup(industryId, res);
    var row = document.getElementById(selectId+"-addrow");
    if(row) row.hidden = true;
    if(inputEl) inputEl.value = "";
  }catch(e){ toast(friendlyDbError(e), true); }
}
async function doSaveEvent(){
  var contactId = $("#ev-contact").value;
  var err = $("#ev-error");
  if(!contactId){ err.style.fontWeight="700"; err.textContent = "Choose a contact."; return; }
  err.textContent = "";
  try{
    await createEvent({
      contactId:contactId, type:$("#ev-type").value, title:$("#ev-title").value.trim(),
      startsAt: fromLocalInputValue($("#ev-when").value), durationMinutes:$("#ev-dur").value,
      location:$("#ev-loc").value.trim(), notes:$("#ev-notes").value.trim()
    });
    state.route = Object.assign({}, state.route, {modal:null});
    render();
  }catch(e){ err.textContent = friendlyDbError(e); }
}
async function doDeleteEvent(id){
  var ev = state.events.find(function(x){return x.id===id;});
  try{ if(ev) await deleteEvent(ev); render(); }
  catch(e){ toast(friendlyDbError(e), true); }
}

boot();

// ---- shell bridge ----
window.__CONTACTS = {
  boot: boot,
  go: function(view){ state.route = {view: view}; render(); },
  render: function(){ scheduleRender(); },
  view: function(){ return state.route.view; }
};

})();
