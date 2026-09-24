# Tooth Fairy — Goals & Contacts

Weekly goal tracking and contact tracking for Samuel and Garrett, in one app.
Sign in with Google; only three accounts are allowed in.

**Live:** https://delicate-duckanoo-43e1cf.netlify.app

---

## How to change something

There is no build step. The repo *is* the site.

```
git clone https://github.com/<account>/tooth-fairy.git
cd tooth-fairy
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
| `js/attachments.js` | File uploads on notes. **Settings go at the top of this file.** |
| `css/goals.css` | Styling for the goals half. |
| `css/contacts.css` | Styling for the contacts half. |
| `css/shell.css` | Sidebar and topbar. |
| `firestore.rules` | Who can read and write the database. |
| `supabase-policies.sql` | Who can read and write uploaded files. |

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

1. `firestore.rules` — the database
2. `supabase-policies.sql` — uploaded files
3. `MEMBERS` at the top of `js/goals.js` — the app itself

Changing only the app is the classic mistake: the person gets in, then every
save silently fails.

After editing `firestore.rules`, publish it in the Firebase console
(Firestore → Rules → Publish). After editing `supabase-policies.sql`, re-run it
in the Supabase SQL editor. Neither deploys with a push.

## File attachments

Notes take PDFs, images, PowerPoint, Excel, Word, CSV, text, archives, audio
and video — up to 50 MB each. Executables are refused.

The files live in Supabase Storage in a private bucket. Downloads go through
links that expire after an hour, so a URL can't be shared and still work later.
The note itself only stores the filename, size and path, so notes stay small
however many files hang off them.

To switch it on, fill in `url` and `key` at the top of `js/attachments.js` from
Supabase (Settings → API), then run `supabase-policies.sql` once in the Supabase
SQL editor. Until then the app runs fine and the attachment box just says it
isn't set up yet.

The key in that file is the *publishable* key and is meant to be public. The
`service_role` key is not — it bypasses every policy, so it must never go in
this repo.

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
