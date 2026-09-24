/* File attachments for notes — backed by Firebase Storage.
 *
 * There is nothing to configure here. Uploads use the same Firebase project as
 * the rest of the app, so the only setup is switching Storage on in the Firebase
 * console and publishing storage.rules. If Storage isn't enabled yet, the app
 * still runs and the attachment box says so instead of failing.
 *
 * ── On download links ────────────────────────────────────────────────────
 * Firebase hands out a long-lived URL carrying an unguessable token. Who can
 * *get* that URL is controlled by storage.rules — only the three allowed
 * accounts — but once a URL exists, anyone holding it can open the file without
 * signing in, and it doesn't expire on its own.
 *
 * For call notes between two founders that's a fair trade. If a file ever needs
 * to be locked down harder, Firebase console → Storage → the file → "Revoke
 * access token" kills every link to it instantly.
 */

/* Firebase Storage accepts far larger, but a note attachment that won't finish
   uploading on a hotel wifi isn't much use to anyone. */
const MAX_BYTES = 50 * 1024 * 1024;

/* What you can attach. Deliberately broad — decks, sheets, docs, PDFs,
   images, archives, plain text, audio and video. Anything executable is
   refused, which is the only category worth blocking. */
const KINDS = [
  { kind: "pdf",   label: "PDF",         ext: ["pdf"] },
  { kind: "image", label: "Image",       ext: ["png","jpg","jpeg","gif","webp","avif","bmp","tif","tiff","heic","heif","svg"] },
  { kind: "slide", label: "Slides",      ext: ["ppt","pptx","pptm","odp","key"] },
  { kind: "sheet", label: "Spreadsheet", ext: ["xls","xlsx","xlsm","xlsb","ods","csv","tsv","numbers"] },
  { kind: "doc",   label: "Document",    ext: ["doc","docx","docm","odt","rtf","pages"] },
  { kind: "text",  label: "Text",        ext: ["txt","md","markdown","json","xml","yml","yaml","log"] },
  { kind: "zip",   label: "Archive",     ext: ["zip","gz","tgz","tar","7z","rar"] },
  { kind: "av",    label: "Media",       ext: ["mp3","wav","m4a","aac","ogg","flac","mp4","mov","m4v","webm","avi","mkv"] }
];
const BLOCKED = ["exe","msi","bat","cmd","com","scr","dll","app","dmg","pkg","deb","rpm",
                 "sh","ps1","vbs","js","jar","apk"];

function extOf(name){
  var m = /\.([A-Za-z0-9]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}
function kindOf(name){
  var e = extOf(name);
  for (var i = 0; i < KINDS.length; i++){
    if (KINDS[i].ext.indexOf(e) !== -1) return KINDS[i];
  }
  return { kind: "file", label: "File", ext: [] };
}
function humanSize(n){
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
}
/* Keeps the original name readable in the storage path without letting a
   filename escape its folder or smuggle in characters the API dislikes. */
function slug(name){
  return (name || "file")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(-80) || "file";
}
function newFileId(){
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function store(){
  return (window.__FB && window.__FB.storage) ? window.__FB.storage : null;
}
const configured = () => !!store();

/* Anything that reaches the user as a sentence lives here, so the wording is in
   one place and the call sites stay readable. */
function explain(err){
  var code = (err && (err.code || err.message)) || "";
  if (/unauthorized|permission/i.test(code))
    return "Storage refused that. Usually it means storage.rules hasn't been published yet, " +
           "or this account isn't on the list inside it.";
  if (/unauthenticated/i.test(code))  return "Sign in again to upload files.";
  if (/quota|exceeded/i.test(code))   return "The project's storage quota is full.";
  if (/retry-limit|network|timeout/i.test(code))
    return "Upload timed out — check your connection and try again.";
  if (/object-not-found/i.test(code)) return "That file is no longer in storage.";
  if (/canceled/i.test(code))         return "Upload cancelled.";
  if (/bucket-not-found|no default bucket/i.test(code))
    return "Storage isn't switched on for this Firebase project yet.";
  return "Upload failed." + (code ? " (" + String(code).slice(0, 80) + ")" : "");
}

/* ---------------------------------------------------------------------- */

function check(file){
  if (!file) return "No file.";
  if (BLOCKED.indexOf(extOf(file.name)) !== -1)
    return "Programs can't be attached — " + extOf(file.name).toUpperCase() + " files are blocked.";
  if (file.size > MAX_BYTES)
    return '"' + file.name + '" is ' + humanSize(file.size) + ". The limit is " + humanSize(MAX_BYTES) + ".";
  if (file.size === 0) return '"' + file.name + '" is empty.';
  return null;
}

function upload(file, noteId, onProgress){
  var problem = check(file);
  if (problem) return Promise.reject(new Error(problem));
  var s = store();
  if (!s) return Promise.reject(new Error("File storage isn't switched on yet."));

  var id   = newFileId();
  var path = "notes/" + noteId + "/" + id + "-" + slug(file.name);
  var kind = kindOf(file.name).kind;

  /* The stored path has an id bolted onto the front, so without this the user
     would download "fmuft7op-Pitch_deck.pptx". Content-Disposition is set at
     upload time because a Firebase download URL can't override it later.
     Things a browser can render stay inline; everything else downloads. */
  var inline = ["pdf", "image", "text", "av"].indexOf(kind) !== -1;
  var meta = {
    contentType: file.type || "application/octet-stream",
    contentDisposition: (inline ? "inline" : "attachment") +
                        '; filename="' + file.name.replace(/["\\]/g, "") + '"'
  };

  return s.upload(path, file, onProgress, meta).then(function(){
    return {
      id: id,
      name: file.name,
      size: file.size,
      type: file.type || "",
      kind: kind,
      path: path,
      at: Date.now()
    };
  }, function(err){
    throw new Error(explain(err));
  });
}

/* Resolved per click rather than stored on the note, so revoking a file's token
   in the Firebase console actually takes effect. */
function link(path){
  var s = store();
  if (!s) return Promise.reject(new Error("File storage isn't switched on yet."));
  return s.url(path).catch(function(err){ throw new Error(explain(err)); });
}

/* Best-effort: a file left behind costs a few KB, a thrown error costs the user
   their delete. Callers don't wait on this. */
function remove(paths){
  var s = store();
  if (!s || !paths || !paths.length) return Promise.resolve();
  return Promise.all(paths.map(function(p){
    return s.remove(p).catch(function(){});
  }));
}

window.__ATT = {
  configured: configured,
  upload: upload,
  link: link,
  remove: remove,
  check: check,
  kindOf: kindOf,
  humanSize: humanSize,
  maxBytes: MAX_BYTES,
  /* Feeds the file picker's accept="" so the OS dialog greys out the rest. */
  accept: KINDS.reduce(function(a, k){
    return a.concat(k.ext.map(function(e){ return "." + e; }));
  }, []).join(",")
};
window.dispatchEvent(new Event("att-ready"));
