/* File attachments for notes — stored in Firestore itself.
 *
 * ── Why this way ─────────────────────────────────────────────────────────
 * Firebase Storage would be the obvious home for files, but since late 2024 it
 * requires a billing account even to use its free allowance. This keeps the whole
 * app on the free tier with no second service and nothing to configure: a file is
 * split into pieces small enough to be Firestore documents, and reassembled in the
 * browser when you open it.
 *
 * ── What that costs ──────────────────────────────────────────────────────
 * Firestore caps a single document at 1 MB, and base64 makes bytes about a third
 * bigger, so files arrive in ~500 KB slices. The practical limits:
 *
 *   · 10 MB per file          — a 40 MB video is the wrong thing to put here
 *   · ~750 MB in total        — the free tier's 1 GB, minus base64 overhead
 *   · a file's chunks are only read when you open it, never when a note renders
 *
 * If you outgrow this, Firebase Storage is a drop-in replacement for this file —
 * the rest of the app talks to it through window.__ATT and doesn't care.
 */

const MAX_BYTES = 10 * 1024 * 1024;

/* 525,000 bytes → 700,000 base64 characters, comfortably inside Firestore's
   1 MB document ceiling with room for field names and overhead. Divisible by 3
   so each slice encodes cleanly on its own, with no padding mid-file. */
const CHUNK_BYTES = 525000;

/* What you can attach. Deliberately broad — decks, sheets, docs, PDFs, images,
   archives, plain text, audio and video. Anything executable is refused, which
   is the only category worth blocking. */
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
function newFileId(){
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* String.fromCharCode.apply blows the stack past ~100k arguments, so walk the
   bytes in blocks rather than spreading the whole slice in one call. */
function toBase64(bytes){
  var out = "", BLOCK = 0x8000;
  for (var i = 0; i < bytes.length; i += BLOCK){
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(out);
}
function fromBase64(str){
  var bin = atob(str), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function db(){
  return (window.__SVC && window.__SVC.db) ? window.__SVC.db() : null;
}
const configured = () => !!db();

function explain(err){
  var code = (err && (err.code || err.message)) || "";
  if (/permission|unauthorized/i.test(code))
    return "The database refused that. Check this account is listed in firestore.rules.";
  if (/unavailable|network|offline/i.test(code))
    return "Lost the connection partway through. Try again when you're back online.";
  if (/quota|resource-exhausted/i.test(code))
    return "The database has hit its daily write limit. Try again tomorrow.";
  if (/invalid-argument|too large/i.test(code))
    return "One of the pieces came out too big for the database — tell Claude, that's a bug.";
  return "Upload failed." + (code ? " (" + String(code).slice(0, 80) + ")" : "");
}

/* ---------------------------------------------------------------------- */

function check(file){
  if (!file) return "No file.";
  if (BLOCKED.indexOf(extOf(file.name)) !== -1)
    return "Programs can't be attached — " + extOf(file.name).toUpperCase() + " files are blocked.";
  if (file.size > MAX_BYTES)
    return '"' + file.name + '" is ' + humanSize(file.size) + ". The limit is " +
           humanSize(MAX_BYTES) + " — put bigger files in Drive and paste the link into the note.";
  if (file.size === 0) return '"' + file.name + '" is empty.';
  return null;
}

async function upload(file, noteId, onProgress){
  var problem = check(file);
  if (problem) throw new Error(problem);
  var d = db();
  if (!d) throw new Error("Attachments need the shared database, and this board is offline.");

  var fid   = newFileId();
  var bytes = new Uint8Array(await file.arrayBuffer());
  var total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));

  try {
    /* Sequential rather than parallel: a 10 MB file is 20 documents, and firing
       them all at once is how you trip the database's rate limiting. */
    for (var i = 0; i < total; i++){
      var slice = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      await d.doc("filechunks/" + fid + "_" + i).set({ b: toBase64(slice) });
      if (onProgress) onProgress((i + 1) / total);
    }
  } catch (err) {
    /* Don't leave half a file behind taking up the quota. */
    remove([{ fid: fid, chunks: total }]);
    throw new Error(explain(err));
  }

  return {
    id: fid,
    fid: fid,
    name: file.name,
    size: file.size,
    type: file.type || "",
    kind: kindOf(file.name).kind,
    chunks: total,
    at: Date.now()
  };
}

/* Reassembles the file and hands back a blob: URL. Same-origin, so unlike a
   storage link the download attribute works and the user gets their own
   filename back rather than an internal id. */
async function link(meta){
  var d = db();
  if (!d) throw new Error("Attachments need the shared database, and this board is offline.");
  var parts = [];
  for (var i = 0; i < (meta.chunks || 1); i++){
    var snap = await d.doc("filechunks/" + meta.fid + "_" + i).get();
    /* The shim hands back exists as a plain boolean; the raw Firestore SDK
       makes it a method. Accept either so this works against both. */
    var there = (typeof snap.exists === "function") ? snap.exists() : snap.exists;
    if (!there || !snap.data() || typeof snap.data().b !== "string"){
      throw new Error("Part " + (i + 1) + " of this file is missing — it may not have " +
                      "finished uploading.");
    }
    parts.push(fromBase64(snap.data().b));
  }
  return URL.createObjectURL(new Blob(parts, { type: meta.type || "application/octet-stream" }));
}

/* Best-effort: a chunk left behind costs a little quota, a thrown error costs
   the user their delete. Callers don't wait on this. */
function remove(metas){
  var d = db();
  if (!d || !metas || !metas.length) return Promise.resolve();
  var jobs = [];
  metas.forEach(function(m){
    for (var i = 0; i < (m.chunks || 1); i++){
      jobs.push(d.doc("filechunks/" + m.fid + "_" + i).delete().catch(function(){}));
    }
  });
  return Promise.all(jobs);
}

/* Everything attached across every note, so the ceiling is visible before you
   hit it rather than after. `extra` is the note being edited right now, whose
   files aren't saved yet — without it the meter ignores what you just added,
   which is exactly when you want to see it move. */
function usage(notes, extra){
  var seen = {}, n = 0;
  function add(f){
    var k = f.fid || f.id;
    if (!k || seen[k]) return;
    seen[k] = true;
    n += (f.size || 0);
  }
  (extra || []).forEach(add);
  (notes || []).forEach(function(note){ (note.files || []).forEach(add); });
  return { bytes: n, cap: 750 * 1024 * 1024 };
}

window.__ATT = {
  configured: configured,
  upload: upload,
  link: link,
  remove: remove,
  check: check,
  kindOf: kindOf,
  humanSize: humanSize,
  usage: usage,
  maxBytes: MAX_BYTES,
  /* Feeds the file picker's accept="" so the OS dialog greys out the rest. */
  accept: KINDS.reduce(function(a, k){
    return a.concat(k.ext.map(function(e){ return "." + e; }));
  }, []).join(",")
};
window.dispatchEvent(new Event("att-ready"));
