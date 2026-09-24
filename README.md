# Tooth Fairy — Goals & Contacts

Weekly goal tracking and contact tracking for Samuel and Garrett, in one app.
Sign in with Google; only three accounts are allowed in.

**Live:** https://delicate-duckanoo-43e1cf.netlify.app

First time here, or setting this up from scratch? See **[SETUP.md](SETUP.md)**.

---

## How to change something

There is no build step. The repo *is* the site.

```
git clone https://github.com/toothfairysandbox-prog/Founders-Tracker.git
cd Founders-Tracker
python3 -m http.server 8000     # then open http://localhost:8000
```

Edit a file, reload the browser. When it looks right, commit and push — Netlify
publishes within a minute. Check the build stamp at the bottom of the sidebar to
confirm you're looking at your version and not a cached one.

## Where things are

| File | What's in it |
|---|---|
| `index.html` | The page skeleton — sidebar, nav, topbar. Add a nav item here. |
| `js/goals.js` | Goals, notes, build night. The whole left-hand half of the app. |
| `js/contacts.js` | Contacts, reminders, calendar, industries, activity. |
| `js/services.js` | The bit in the middle: which half is on screen, shared helpers. |
| `js/firebase.js` | Sign-in and the database connection. |
| `js/attachments.js` | File uploads on notes. Size cap and allowed types live here. |
| `css/goals.css` | Styling for the goals half. |
| `css/contacts.css` | Styling for the contacts half. |
| `css/shell.css` | Sidebar and topbar. |
| `firestore.rules` | Who can read and write the database. |


### Two things worth knowing before you edit

**CSS selectors in `goals.css` are written twice.** Once under `#goals-root`
(the board) and once under `#goals-overlays` (modals and the sign-in screen,
which live at the bottom of the page rather than inside the board). If a rule
only works in one place, that's why — add the second selector.

**Each JS file runs inside its own closure.** The two halves of the app came
from two separate codebases and both use short names like `state` and `render`.
Keeping them wrapped is what stops them from overwriting each other. Anything
one half needs to expose to the other goes on `window`.

## Who's allowed in

Three accounts. The list appears in **three** places and all three must agree:

1. `firestore.rules` — the database (covers attachments too)
3. `MEMBERS` at the top of `js/goals.js` — the app itself

Changing only the app is the classic mistake: the person gets in, then every
save silently fails.

`firestore.rules` is published from the Firebase console — Firestore → Rules.
**It does not deploy when you push.**

## File attachments

Notes take PDFs, images, PowerPoint, Excel, Word, CSV, text, archives, audio and
video — up to 10 MB each. Executables are refused.

There is nothing to set up. Files are split into ~500 KB pieces and stored as
Firestore documents in a `filechunks` collection, then reassembled in the browser
when you open one. That keeps the whole app on Firebase's free tier: Storage
would be the obvious home for files, but since late 2024 it demands a billing
account even to use its free allowance.

The note itself holds only the filename, size and chunk count, and a file's
chunks are read only when someone opens it — so a note with nine attachments
renders exactly as fast as one with none.

What this costs: 10 MB per file, and about 750 MB across everything (the free
tier's 1 GB, less base64 overhead). The form shows total usage once you have
files. For anything bigger, put it in Drive and paste the link into the note.

If you outgrow it, `js/attachments.js` is the only file that would change —
the rest of the app talks to it through `window.__ATT`.

## Tests

```
cd tests
npm install
sh run.sh
```

Two suites. The first drives the whole app — sign in, both halves, every view,
writing a goal and an industry, and checking the modals land centred instead of
at the foot of the page. The second covers attachments end to end: uploading a
mixed batch, refusing oversize files and executables, signed links, and making
sure cancelling an edit doesn't leave orphaned files in storage.

Both run against fakes, so they never touch the real database or real storage.

## Backups

The Backup button on the goals board exports everything — goals, notes,
categories — as JSON you can paste back in. It does **not** include the uploaded
files themselves, only the references to them.
