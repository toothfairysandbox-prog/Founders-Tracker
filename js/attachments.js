/* File attachments for notes — backed by Supabase Storage.
 *
 * ── Where the settings go ────────────────────────────────────────────────
 * Fill in url and key below from your Supabase project (Settings → API).
 * Leave them blank and nothing breaks: the app still runs, attachments just
 * show a "not set up yet" message instead of an upload button.
 *
 * ── Why this is safe to have in a public file ────────────────────────────
 * The key below is the *publishable* key. On its own it opens nothing. Every
 * request also carries your Firebase login, and the bucket's policies (see
 * supabase-policies.sql) only accept the three allowed accounts. Downloads go
 * through short-lived signed links, so a file URL can't be passed around and
 * still work an hour later.
 *
 * Never put the service_role key in here. That one is a real secret and it
 * bypasses every policy.
 */
const SUPABASE = {
  url:    "",              // e.g. "https://abcdefghijkl.supabase.co"  (no trailing slash)
  key:    "",              // the publishable / anon key
  bucket: "attachments"
};

/* Supabase's free plan caps a single upload at 50 MB. */
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

const configured = () => !!(SUPABASE.url && SUPABASE.key);
const api = (p) => SUPABASE.url.replace(/\/+$/, "") + "/storage/v1" + p;

async function authHeaders(){
  var token = window.__FB && window.__FB.idToken ? await window.__FB.idToken() : null;
  if (!token) throw new Error("not-signed-in");
  return { "Authorization": "Bearer " + token, "apikey": SUPABASE.key };
}

/* Anything that reaches the user as a sentence lives here, so the wording is
   in one place and the call sites stay readable. */
function explain(status, body){
  if (status === 0)   return "Upload failed — check your connection and try again.";
  if (status === 401 || status === 403)
    return "Storage refused that. Usually it means the Supabase policies haven't been " +
           "applied yet, or your Firebase project isn't linked in Supabase's Third-Party Auth.";
  if (status === 404) return "The '" + SUPABASE.bucket + "' bucket doesn't exist yet in Supabase.";
  if (status === 409) return "A file with that name is already there.";
  if (status === 413) return "That file is too big for the storage plan.";
  return "Upload failed (" + status + ")." + (body ? " " + String(body).slice(0, 120) : "");
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

/* XHR rather than fetch, because fetch can't report upload progress and a
   40 MB deck on a slow connection needs a bar rather than a frozen button. */
function upload(file, noteId, onProgress){
  var problem = check(file);
  if (problem) return Promise.reject(new Error(problem));
  if (!configured()) return Promise.reject(new Error("File storage isn't set up yet."));

  var id   = newFileId();
  var path = "notes/" + noteId + "/" + id + "-" + slug(file.name);

  return authHeaders().then(function(h){
    return new Promise(function(resolve, reject){
      var xhr = new XMLHttpRequest();
      xhr.open("POST", api("/object/" + SUPABASE.bucket + "/" + path), true);
      xhr.setRequestHeader("Authorization", h.Authorization);
      xhr.setRequestHeader("apikey", h.apikey);
      xhr.setRequestHeader("x-upsert", "false");
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = function(e){
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = function(){
        if (xhr.status >= 200 && xhr.status < 300){
          resolve({
            id: id,
            name: file.name,
            size: file.size,
            type: file.type || "",
            kind: kindOf(file.name).kind,
            path: path,
            at: Date.now()
          });
        } else {
          reject(new Error(explain(xhr.status, xhr.responseText)));
        }
      };
      xhr.onerror = function(){ reject(new Error(explain(0))); };
      xhr.send(file);
    });
  }).catch(function(e){
    if (e && e.message === "not-signed-in") throw new Error("Sign in again to upload files.");
    throw e;
  });
}

/* Signed links expire, so we mint one per click rather than storing URLs. */
async function link(path, download){
  if (!configured()) throw new Error("File storage isn't set up yet.");
  var h = await authHeaders();
  var res = await fetch(api("/object/sign/" + SUPABASE.bucket + "/" + path), {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, h),
    body: JSON.stringify({ expiresIn: 3600 })
  });
  if (!res.ok) throw new Error(explain(res.status, await res.text().catch(function(){ return ""; })));
  var data = await res.json();
  var signed = data.signedURL || data.signedUrl || "";
  if (!signed) throw new Error("Storage didn't return a link.");
  return SUPABASE.url.replace(/\/+$/, "") + "/storage/v1" + signed +
         (download ? "&download=" + encodeURIComponent(download) : "");
}

/* Best-effort: a file left behind costs a few KB, a thrown error costs the
   user their delete. Callers don't wait on this. */
async function remove(paths){
  if (!configured() || !paths || !paths.length) return;
  var h;
  try { h = await authHeaders(); } catch(e){ return; }
  await Promise.all(paths.map(function(p){
    return fetch(api("/object/" + SUPABASE.bucket + "/" + p), { method: "DELETE", headers: h })
      .catch(function(){});
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
