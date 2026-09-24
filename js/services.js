/* ============================ shared services ============================
   One Firebase connection, one identity, one router, shared by both apps.
   Each app keeps its own IIFE and its own state; they meet only here. */
(function(){
"use strict";

var MEMBERS = {"samuelgibby89@gmail.com": "samuel", "garrettwoodhouse@gmail.com": "garrett", "toothfairysandbox@gmail.com": "team"};
var COLORS = {samuel:"#5B3E96", garrett:"#1F8A5F", team:"#B9781A"};
var NAMES  = {samuel:"Samuel", garrett:"Garrett", team:"Team"};

var _db = null, _me = null;
var section = "goals";

/* Firestore wearing the artifact db's clothes, so Garrett's calls and ours both
   work unchanged. Adds add/where/orderBy/limit on top of the original shim. */
function fsShim(FB){
  function wrapDoc(s){
    return { id:s.id, exists:(typeof s.exists==="function"? s.exists() : !!s.exists),
             data:function(){ return s.data(); } };
  }
  function wrapQuery(s){
    var docs=[]; s.forEach(function(d){ docs.push(wrapDoc(d)); });
    return { docs:docs, size:docs.length, empty:docs.length===0 };
  }
  function query(path, clauses){
    function build(){
      var args = [FB.colRef(path)];
      for(var i=0;i<clauses.length;i++){
        var c = clauses[i];
        if(c.k==="where") args.push(FB.where(c.f, c.op, c.v));
        else if(c.k==="orderBy") args.push(FB.orderBy(c.f, c.dir||"asc"));
        else if(c.k==="limit") args.push(FB.limit(c.n));
      }
      return FB.query.apply(null, args);
    }
    var api = {
      where:function(f,op,v){ return query(path, clauses.concat([{k:"where",f:f,op:op,v:v}])); },
      orderBy:function(f,dir){ return query(path, clauses.concat([{k:"orderBy",f:f,dir:dir}])); },
      limit:function(n){ return query(path, clauses.concat([{k:"limit",n:n}])); },
      get:function(){ return FB.getDocs(build()).then(wrapQuery); },
      onSnapshot:function(next, err){
        return FB.onSnapshot(build(), function(s){ next(wrapQuery(s)); }, err||function(){});
      },
      add:function(data){
        return FB.addDoc(FB.colRef(path), data).then(function(ref){ return {id:ref.id}; });
      },
      doc:function(id){ return docRef(path + "/" + id); }
    };
    return api;
  }
  function docRef(path){
    var ref = FB.docRef(path);
    return {
      id: path.split("/").pop(),
      get:function(){ return FB.getDoc(ref).then(wrapDoc); },
      set:function(data){ return FB.setDoc(ref, data); },
      update:function(data){ return FB.updateDoc(ref, data); },
      "delete":function(){ return FB.deleteDoc(ref); },
      onSnapshot:function(next, err){
        return FB.onSnapshot(ref, function(s){ next(wrapDoc(s)); }, err||function(){});
      },
      collection:function(sub){ return query(path + "/" + sub, []); }
    };
  }
  return { collection:function(p){ return query(p, []); }, doc:function(p){ return docRef(p); } };
}

function setActive(){
  var gs = document.querySelectorAll("#goals-nav [data-gnav]");
  for(var i=0;i<gs.length;i++){
    gs[i].classList.toggle("active", section==="goals" &&
      window.__GOALS && gs[i].getAttribute("data-gnav")===window.__GOALS.view());
  }
}

var SVC = {
  db: function(){ return _db; },
  me: function(){ return _me; },
  openShell: function(){
    var s = document.getElementById("shell");
    if(s) s.hidden = false;
  },
  closeShell: function(){
    var s = document.getElementById("shell");
    if(s) s.hidden = true;
  },
  /* Which half is on screen. The two apps re-render on their own schedule —
     a Firestore push can redraw the contacts side while you're looking at
     goals — so anything that writes to shared chrome has to ask first. */
  section: function(){ return section; },
  /* An app telling the shell where it just went. */
  syncNav: function(sec, view){
    if(sec === "goals"){
      setActive();
      var t = document.getElementById("page-title");
      var LBL = {samuel:"Samuel", garrett:"Garrett", both:"Side by side",
                 notes:"Notes", build:"Build night"};
      if(t && section === "goals") t.textContent = LBL[view] || "Goal setting";
    }
    if(sec === "contacts" && section === "contacts"){
      var items = document.querySelectorAll("[data-nav]");
      for(var i=0;i<items.length;i++){
        items[i].classList.toggle("active", items[i].getAttribute("data-nav")===view);
      }
    }
  },
  show: function(sec, view){
    section = sec;
    var goalsRoot = document.getElementById("goals-root");
    var viewRoot = document.getElementById("view-root");
    var newBtn = document.getElementById("newContactBtn");
    var searchWrap = document.getElementById("global-search-wrap");
    if(sec === "goals"){
      if(goalsRoot) goalsRoot.hidden = false;
      if(viewRoot) viewRoot.hidden = true;
      if(newBtn) newBtn.hidden = true;
      if(searchWrap) searchWrap.hidden = true;
      if(view && window.__GOALS) window.__GOALS.setView(view);
      var t = document.getElementById("page-title");
      var LBL = {samuel:"Samuel", garrett:"Garrett", both:"Side by side", notes:"Notes", build:"Build night"};
      if(t) t.textContent = LBL[view || (window.__GOALS && window.__GOALS.view())] || "Goal setting";
      setActive();
      var navs = document.querySelectorAll("[data-nav]");
      for(var j=0;j<navs.length;j++) navs[j].classList.remove("active");
    } else {
      if(goalsRoot) goalsRoot.hidden = true;
      if(viewRoot) viewRoot.hidden = false;
      if(newBtn) newBtn.hidden = false;
      if(window.__CONTACTS) window.__CONTACTS.go(view || "home");
      var gs = document.querySelectorAll("#goals-nav [data-gnav]");
      for(var k=0;k<gs.length;k++) gs[k].classList.remove("active");
    }
    try{ localStorage.setItem("tf.section", sec); }catch(e){}
  }
};
window.__SVC = SVC;

/* The sidebar is the only navigation: goal views and contact views both. */
document.addEventListener("click", function(e){
  var g = e.target.closest ? e.target.closest("[data-gnav]") : null;
  if(g){ SVC.show("goals", g.getAttribute("data-gnav")); return; }
  var c = e.target.closest ? e.target.closest("[data-nav]") : null;
  if(c){ SVC.show("contacts", c.getAttribute("data-nav")); return; }
  var b = e.target.closest ? e.target.closest('[data-action="go-home"]') : null;
  if(b){ SVC.show("contacts", "home"); }
});

/* Identity arrives from the goal app's Google sign-in; both apps use it. */
window.addEventListener("tf-signed-in", function(ev){
  var d = ev.detail || {};
  _db = d.db;
  _me = {
    id: d.id,
    name: (d.profile && d.profile.displayName) || NAMES[d.id] || d.id,
    email: d.email || "",
    avatarUrl: (d.profile && d.profile.photoURL) || "",
    color: COLORS[d.id] || "#5B3E96"
  };
  if(window.__CONTACTS) window.__CONTACTS.boot();
  var start = "goals";
  try{ start = localStorage.getItem("tf.section") || "goals"; }catch(e){}
  SVC.show(start, start === "goals"
    ? (window.__GOALS ? window.__GOALS.view() : "both")
    : "home");
});
window.addEventListener("tf-signed-out", function(){
  _db = null; _me = null;
  SVC.closeShell();
});
window.__SVC.fsShim = fsShim;
})();
