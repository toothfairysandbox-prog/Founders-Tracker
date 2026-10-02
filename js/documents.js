/* ============================ Documents ============================
   Shared files — BAAs, agreements, anything both of you need to find again.
   The bytes are stored exactly like note attachments (js/attachments.js:
   chunked into Firestore, 10 MB a file), so there's no second service and the
   same sign-in protects them. This file only keeps the list:

     documents/{id}     name, categoryId (or null), file {fid,name,size,type,kind,chunks},
                        uploadedBy, uploadedAt, updatedAt
     doccategories/{id} name, order

   Don't put patient records here. A BAA is fine; PHI is not. */
(function(){
"use strict";

/* Created once, the first time anyone opens Documents. After that they're
   ordinary categories — rename or delete them like any other. */
var DEFAULT_CATEGORIES = [
  { id:"legal",     name:"Legal & compliance", order:0 },
  { id:"customers", name:"Customers",          order:1 },
  { id:"vendors",   name:"Vendors",            order:2 }
];

var state = {
  booted: false,
  docs: [],
  cats: [],
  filter: "all",          // all | uncategorized | category id
  search: "",
  uploads: [],            // [{name, pct, error}] in flight right now
  renamingId: null,
  managing: false,        // category editor open
  editingCatId: null,
  dirty: false
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
function att(){ return window.__ATT; }
function nowIso(){ return new Date().toISOString(); }
function fmtShort(iso){
  return iso ? new Date(iso).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }) : "";
}
var NAMES = { garrett:"Garrett", samuel:"Sam", team:"Team" };

function toast(msg){
  var old = $("docs-toast"); if(old) old.remove();
  var el = document.createElement("div");
  el.id = "docs-toast"; el.className = "team-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.remove(); }, 6000);
}
function fail(err){
  var code = (err && (err.code || err.message)) || "";
  toast(/permission/i.test(code) ? "The database refused that. Is this account on the allow list?"
                                 : String(code || "Something went wrong.").slice(0, 160));
}

/* ---------- data ---------- */

function boot(){
  if(state.booted) return;
  var svc = window.__SVC; if(!svc) return;
  db = svc.db(); if(!db) return;
  state.booted = true;
  db.collection("documents").onSnapshot(function(snap){
    state.docs = snap.docs.map(function(d){ return Object.assign({ id:d.id }, d.data()); });
    changed();
  }, function(){ toast("Live sync for documents stopped. Reload the page."); });
  db.collection("doccategories").onSnapshot(function(snap){
    state.cats = snap.docs.map(function(d){ return Object.assign({ id:d.id }, d.data()); })
      .sort(function(a, b){ return (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name); });
    changed();
  });
  seedCategories();
}
/* A settings flag rather than "the collection is empty", so deleting every
   category doesn't bring the defaults back. Fixed ids make it harmless if you
   and Sam open the page at the same moment. */
function seedCategories(){
  var flag = db.doc("settings/documents");
  flag.get().then(function(s){
    if(s.exists && s.data() && s.data().seeded) return;
    return Promise.all(DEFAULT_CATEGORIES.map(function(c){
      return db.doc("doccategories/" + c.id).set({ name:c.name, order:c.order });
    })).then(function(){ return flag.set({ seeded:true }); });
  }).catch(function(){});
}
/* Deferred, so a save made from inside an event handler never redraws the
   list underneath the handler that's still running. */
var queued = false;
function changed(){
  if(queued) return;
  queued = true;
  setTimeout(function(){
    queued = false;
    if(state.renamingId || state.editingCatId){ state.dirty = true; return; }
    if(window.__SVC && window.__SVC.section() === "docs") render();
  }, 0);
}
function catName(id){
  var c = state.cats.find(function(x){ return x.id === id; });
  return c ? c.name : "Uncategorized";
}

async function uploadFiles(files, categoryId){
  var A = att();
  if(!A || !A.configured()){ toast("Uploads need the shared database, and it isn't connected."); return; }
  var list = Array.prototype.slice.call(files || []);
  for(var i = 0; i < list.length; i++){
    var f = list[i];
    var problem = A.check(f);
    if(problem){ toast(problem); continue; }
    var job = { name: f.name, pct: 0 };
    state.uploads.push(job); render();
    try{
      var meta = await A.upload(f, null, function(p){ job.pct = p; paintProgress(); });
      var m = me();
      await db.collection("documents").add({
        name: f.name,
        categoryId: categoryId || null,
        file: { fid: meta.fid, name: meta.name, size: meta.size, type: meta.type, kind: meta.kind, chunks: meta.chunks },
        uploadedBy: m ? m.id : "",
        uploadedAt: nowIso(),
        updatedAt: nowIso()
      });
    }catch(err){
      fail(err);
    }
    state.uploads.splice(state.uploads.indexOf(job), 1);
    render();
  }
}
function paintProgress(){
  var box = $("docs-uploads"); if(!box) return render();
  box.innerHTML = state.uploads.map(function(u){
    return '<div class="doc-up"><span>' + esc(u.name) + '</span><span class="bar"><i style="width:' +
      Math.round(u.pct * 100) + '%"></i></span></div>';
  }).join("");
}

async function openDoc(d, download){
  var A = att(); if(!A) return;
  /* Open the tab now, while we still have the click — browsers block a
     window opened after the file has finished loading. */
  var w = download ? null : window.open("", "_blank");
  try{
    var url = await A.link(d.file);
    if(w){ w.location.href = url; }
    else {
      var a = document.createElement("a");
      a.href = url; a.download = d.name || d.file.name || "document";
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }catch(err){
    if(w) w.close();
    fail(err);
  }
}
function removeDoc(d){
  if(!confirm('Delete "' + d.name + '"? This removes the file for both of you and can\'t be undone.')) return;
  db.collection("documents").doc(d.id).delete().then(function(){
    var A = att(); if(A && d.file) A.remove([d.file]);
    toast("Deleted " + d.name);
  }, fail);
}
function rename(d, name){
  name = (name || "").trim();
  if(!name || name === d.name) return;
  /* Keep the extension so the download still opens in the right app. */
  var ext = /\.[A-Za-z0-9]+$/.exec(d.name || "");
  if(ext && !/\.[A-Za-z0-9]+$/.test(name)) name += ext[0];
  d.name = name;
  db.collection("documents").doc(d.id).update({ name: name, updatedAt: nowIso() }).catch(fail);
}
function addCategory(name){
  name = (name || "").trim(); if(!name) return;
  var order = state.cats.reduce(function(m, c){ return Math.max(m, c.order ?? 0); }, -1) + 1;
  db.collection("doccategories").add({ name: name, order: order }).catch(fail);
}
function deleteCategory(c){
  var inIt = state.docs.filter(function(d){ return d.categoryId === c.id; });
  if(!confirm('Delete the "' + c.name + '" category?' +
     (inIt.length ? " Its " + inIt.length + " document" + (inIt.length > 1 ? "s" : "") + " will move to Uncategorized." : ""))) return;
  Promise.all(inIt.map(function(d){
    return db.collection("documents").doc(d.id).update({ categoryId: null, updatedAt: nowIso() });
  })).then(function(){
    if(state.filter === c.id) state.filter = "all";
    return db.collection("doccategories").doc(c.id).delete();
  }).catch(fail);
}

/* ---------- view ---------- */

function render(){
  var root = $("docs-root"); if(!root) return;
  var A = att();
  var q = state.search.toLowerCase();
  var shown = state.docs.filter(function(d){
    if(state.filter === "uncategorized" && d.categoryId && state.cats.some(function(c){ return c.id === d.categoryId; })) return false;
    if(state.filter !== "all" && state.filter !== "uncategorized" && d.categoryId !== state.filter) return false;
    return !q || (d.name || "").toLowerCase().indexOf(q) !== -1;
  }).sort(function(a, b){ return (b.uploadedAt || "") < (a.uploadedAt || "") ? -1 : 1; });

  var hasUncat = state.docs.some(function(d){ return !d.categoryId || !state.cats.some(function(c){ return c.id === d.categoryId; }); });
  var chips = [{ id:"all", name:"All", n: state.docs.length }]
    .concat(state.cats.map(function(c){ return { id:c.id, name:c.name, n: state.docs.filter(function(d){ return d.categoryId === c.id; }).length }; }))
    .concat(hasUncat ? [{ id:"uncategorized", name:"Uncategorized", n: state.docs.filter(function(d){ return !d.categoryId || !state.cats.some(function(c){ return c.id === d.categoryId; }); }).length }] : []);

  var defaultCat = (state.filter !== "all" && state.filter !== "uncategorized") ? state.filter : (state.cats[0] ? state.cats[0].id : "");
  var used = state.docs.reduce(function(n, d){ return n + ((d.file && d.file.size) || 0); }, 0);

  var upload =
    '<div class="panel doc-drop" id="docs-drop">' +
      '<div class="doc-drop-main">' +
        '<strong>Add documents</strong>' +
        '<span class="hint">Drop files here or choose them. PDF, Word, Excel, images. Up to ' + esc(A ? A.humanSize(A.maxBytes) : "10 MB") + ' each. No patient records.</span>' +
      '</div>' +
      '<div class="doc-drop-ctrl">' +
        '<select id="docs-upcat" aria-label="Category for new uploads">' +
          state.cats.map(function(c){ return '<option value="' + esc(c.id) + '"' + (c.id === defaultCat ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join("") +
          '<option value=""' + (defaultCat ? '' : ' selected') + '>Uncategorized</option>' +
        '</select>' +
        '<label class="btn btn-sm btn-primary">Choose files<input type="file" id="docs-input" multiple hidden accept="' + esc(A ? A.accept : "") + '"></label>' +
      '</div>' +
      '<div id="docs-uploads"></div>' +
    '</div>';

  var toolbar =
    '<div class="doc-chips">' +
      chips.map(function(c){
        return '<button class="doc-chip' + (state.filter === c.id ? ' active' : '') + '" data-dact="filter" data-v="' + esc(c.id) + '">' +
          esc(c.name) + ' <span class="gcount">' + c.n + '</span></button>';
      }).join("") +
      '<button class="doc-chip ghost" data-dact="manage">' + (state.managing ? 'Done editing' : 'Edit categories') + '</button>' +
    '</div>' +
    '<div class="toolbar">' +
      '<input type="text" id="docs-search" placeholder="Search documents…" value="' + esc(state.search) + '">' +
      '<span class="todo-scan">' + esc(A ? A.humanSize(used) : "") + ' of documents · shares ~750 MB with note attachments</span>' +
    '</div>';

  var manage = state.managing
    ? '<div class="panel doc-cats">' +
        state.cats.map(function(c){
          return '<div class="doc-cat-row" data-cid="' + esc(c.id) + '">' +
            (state.editingCatId === c.id
              ? '<input type="text" class="doc-cat-input" id="doc-cat-' + esc(c.id) + '" value="' + esc(c.name) + '">' +
                '<button class="btn btn-sm btn-primary" data-dact="cat-save">Save</button>'
              : '<span class="nm">' + esc(c.name) + '</span>' +
                '<button class="btn btn-sm btn-ghost" data-dact="cat-edit">Rename</button>') +
            '<button class="btn btn-sm btn-danger" data-dact="cat-delete">Delete</button>' +
          '</div>';
        }).join("") +
        '<div class="doc-cat-row"><input type="text" id="doc-cat-new" placeholder="New category, e.g. Investors">' +
          '<button class="btn btn-sm" data-dact="cat-add">Add</button></div>' +
      '</div>'
    : '';

  var rows = shown.map(function(d){
    var kind = A && d.file ? A.kindOf(d.file.name || d.name).label : "File";
    return '<div class="doc-row" data-id="' + esc(d.id) + '">' +
      '<span class="doc-kind k-' + esc((d.file && d.file.kind) || "file") + '">' + esc(kind) + '</span>' +
      '<div class="doc-main">' +
        (state.renamingId === d.id
          ? '<input type="text" class="doc-rename" id="doc-rename-' + esc(d.id) + '" value="' + esc(d.name) + '">'
          : '<button class="doc-name" data-dact="open" title="Open">' + esc(d.name) + '</button>') +
        '<div class="doc-sub">' + esc(A && d.file ? A.humanSize(d.file.size) : "") +
          ' · ' + esc(NAMES[d.uploadedBy] || d.uploadedBy || "") + ' · ' + esc(fmtShort(d.uploadedAt)) + '</div>' +
      '</div>' +
      '<select class="doc-cat" data-dact="category" aria-label="Category">' +
        state.cats.map(function(c){ return '<option value="' + esc(c.id) + '"' + (c.id === d.categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join("") +
        '<option value=""' + (state.cats.some(function(c){ return c.id === d.categoryId; }) ? '' : ' selected') + '>Uncategorized</option>' +
      '</select>' +
      '<div class="doc-acts">' +
        '<button class="btn btn-sm" data-dact="download">Download</button>' +
        '<button class="btn btn-sm btn-ghost" data-dact="rename">Rename</button>' +
        '<button class="iconbtn" data-dact="delete" title="Delete" aria-label="Delete">✕</button>' +
      '</div>' +
    '</div>';
  }).join("");

  var list = shown.length
    ? '<div class="panel">' + rows + '</div>'
    : '<div class="panel empty"><div class="big-ico">▣</div>' +
        (state.docs.length ? 'Nothing matches.' : 'No documents yet. Your BAA would go well here.') + '</div>';

  root.innerHTML = '<div class="team-wrap">' + upload + toolbar + manage + list + '</div>';
  if(state.uploads.length) paintProgress();

  var focusId = state.renamingId ? "doc-rename-" + state.renamingId : (state.editingCatId ? "doc-cat-" + state.editingCatId : null);
  if(focusId && $(focusId)){ $(focusId).focus(); $(focusId).select(); }
}

/* ---------- events ---------- */

function rowDoc(el){
  var row = el.closest(".doc-row"); if(!row) return null;
  var id = row.getAttribute("data-id");
  return state.docs.find(function(d){ return d.id === id; }) || null;
}
function rowCat(el){
  var row = el.closest(".doc-cat-row"); if(!row) return null;
  var id = row.getAttribute("data-cid");
  return state.cats.find(function(c){ return c.id === id; }) || null;
}
function finishRename(commit){
  var d = state.docs.find(function(x){ return x.id === state.renamingId; });
  var inp = d && $("doc-rename-" + d.id);
  if(commit && d && inp) rename(d, inp.value);
  state.renamingId = null; state.dirty = false;
  render();
}
function finishCat(commit){
  var c = state.cats.find(function(x){ return x.id === state.editingCatId; });
  var inp = c && $("doc-cat-" + c.id);
  var name = inp ? inp.value.trim() : "";
  if(commit && c && name && name !== c.name){
    c.name = name;
    db.collection("doccategories").doc(c.id).update({ name: name }).catch(fail);
  }
  state.editingCatId = null; state.dirty = false;
  render();
}

function inRoot(e){ var r = $("docs-root"); return r && r.contains(e.target); }

document.addEventListener("click", function(e){
  if(!inRoot(e)) return;
  var el = e.target.closest("[data-dact]"); if(!el) return;
  var act = el.getAttribute("data-dact");
  if(act === "filter"){ state.filter = el.getAttribute("data-v"); return render(); }
  if(act === "manage"){ state.managing = !state.managing; state.editingCatId = null; return render(); }
  if(act === "cat-add"){ var n = $("doc-cat-new"); addCategory(n && n.value); return; }
  var c = rowCat(el);
  if(act === "cat-edit" && c){ state.editingCatId = c.id; return render(); }
  if(act === "cat-save") return finishCat(true);
  if(act === "cat-delete" && c) return deleteCategory(c);
  var d = rowDoc(el); if(!d) return;
  if(act === "open") return openDoc(d, false);
  if(act === "download") return openDoc(d, true);
  if(act === "rename"){ state.renamingId = d.id; return render(); }
  if(act === "delete") return removeDoc(d);
});
document.addEventListener("change", function(e){
  if(!inRoot(e)) return;
  if(e.target.id === "docs-input"){
    var cat = $("docs-upcat") ? $("docs-upcat").value : "";
    var files = e.target.files;
    uploadFiles(files, cat);
    return;
  }
  var el = e.target.closest("[data-dact]"); if(!el) return;
  if(el.getAttribute("data-dact") === "category"){
    var d = rowDoc(el); if(!d) return;
    db.collection("documents").doc(d.id).update({ categoryId: el.value || null, updatedAt: nowIso() }).catch(fail);
  }
});
document.addEventListener("input", function(e){
  if(e.target.id !== "docs-search") return;
  state.search = e.target.value;
  var pos = e.target.selectionStart;
  render();
  var s = $("docs-search"); if(s){ s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener("keydown", function(e){
  if(!inRoot(e)) return;
  if(e.target.classList.contains("doc-rename")){
    if(e.key === "Enter"){ e.preventDefault(); finishRename(true); }
    else if(e.key === "Escape"){ e.preventDefault(); finishRename(false); }
  } else if(e.target.classList.contains("doc-cat-input")){
    if(e.key === "Enter"){ e.preventDefault(); finishCat(true); }
    else if(e.key === "Escape"){ e.preventDefault(); finishCat(false); }
  } else if(e.target.id === "doc-cat-new" && e.key === "Enter"){
    e.preventDefault(); addCategory(e.target.value);
  }
});
document.addEventListener("focusout", function(e){
  if(!inRoot(e)) return;
  /* Clicking away saves, like a spreadsheet cell. Commit straight from the
     input — the click that caused this may be about to redraw the list. */
  if(e.target.classList && e.target.classList.contains("doc-rename")){
    var id = e.target.id.slice("doc-rename-".length);
    if(state.renamingId !== id) return;      // Enter or Escape already finished it
    state.renamingId = null; state.dirty = false;
    var d = state.docs.find(function(x){ return x.id === id; });
    if(d) rename(d, e.target.value);
    setTimeout(render, 0);
  }
});
["dragover","dragenter"].forEach(function(t){
  document.addEventListener(t, function(e){
    var drop = e.target.closest && e.target.closest("#docs-drop");
    if(!drop) return;
    e.preventDefault(); drop.classList.add("over");
  });
});
document.addEventListener("dragleave", function(e){
  var drop = e.target.closest && e.target.closest("#docs-drop");
  if(drop && !drop.contains(e.relatedTarget)) drop.classList.remove("over");
});
document.addEventListener("drop", function(e){
  var drop = e.target.closest && e.target.closest("#docs-drop");
  if(!drop) return;
  e.preventDefault(); drop.classList.remove("over");
  var cat = $("docs-upcat") ? $("docs-upcat").value : "";
  uploadFiles(e.dataTransfer && e.dataTransfer.files, cat);
});

window.__DOCS = {
  boot: boot,
  show: function(){ boot(); render(); }
};
})();
