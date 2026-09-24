# Tooth Fairy — Goals & Contacts

Weekly goal tracking and contact tracking for Samuel and Garrett, in one app.
Sign in with Google; only three accounts are allowed in.

**Live:** https://delicate-duckanoo-43e1cf.netlify.app

First time here, or setting this up from scratch? See **[SETUP.md](SETUP.md)**.

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
| `js/attachments.js` | File uploads on notes. Size cap and allowed types live here. |
| `css/goals.css` | Styling for the goals half. |
| `css/contacts.css` | Styling for the contacts half. |
| `css/shell.css` | Sidebar and topbar. |
| `firestore.rules` | Who can read and write the database. |
| `storage.rules` | Who can read and write uploaded files. |

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
2. `storage.rules` — uploaded files
3. `MEMBERS` at the top of `js/goals.js` — the app itself

Changing only the app is the classic mistake: the person gets in, then every
save silently fails.

Both rules files are published from the Firebase console — Firestore → Rules and
Storage → Rules. **Neither deploys when you push.**

## File attachments

Notes take PDFs, images, PowerPoint, Excel, Word, CSV, text, archives, audio
and video — up to 50 MB each. Executables are refused.

The files live in Firebase Storage, in the same project as everything else, so
there is no second service and nothing to configure in the code. The note itself
stores only the filename, size and path, so notes stay small however many files
hang off them.

Download links carry an unguessable token. Who can *obtain* a link is controlled
by `storage.rules` — the three allowed accounts — but a link, once it exists,
works for anyone holding it and doesn't expire. To kill one: Firebase console →
Storage → the file → Revoke access token.

Firebase requires the pay-as-you-go plan for Storage, with 5 GB free. For a
handful of attachments a week the bill stays at zero; set a budget alert if you
want to be certain.

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
