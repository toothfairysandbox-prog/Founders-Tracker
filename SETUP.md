# Setup — one time, about 30 minutes

Three separate things. Do them in this order; each one works on its own, so if you
stop halfway nothing is broken.

1. [Get the code on GitHub](#1-github) — so Garrett can make changes
2. [Point Netlify at GitHub](#2-netlify) — so pushing publishes automatically
3. [File attachments](#3-file-attachments) — already working, nothing to do

---

## 1. GitHub

**What this gets you:** one shared copy of the code, a record of every change, and the
ability for either of you to work on it without emailing files around.

1. **Unzip the folder** somewhere you'll keep it — `Documents\tooth-fairy` is fine.
   Not Downloads; you don't want to accidentally clean it out.

2. **Make a GitHub account** at [github.com/signup](https://github.com/signup) using
   **toothfairysandbox@gmail.com**. Username can be anything — `toothfairysandbox`
   works. It'll email you a code to confirm.

3. **Install GitHub Desktop** from [desktop.github.com](https://desktop.github.com).
   Sign in with the account from step 2 when it asks.

4. **Add the folder.** File → Add local repository → Choose → pick your `tooth-fairy`
   folder → Add repository.

   It should say **"Tooth Fairy: goals + contacts in one app"** as the latest commit.
   If instead it offers to *create* a repository, the `.git` folder didn't survive the
   unzip — that's fine, click create and carry on.

5. **Publish it.** Click **Publish repository** at the top.
   - Name: `tooth-fairy`
   - **Untick "Keep this code private"** only if you want it public. Private is the
     better default — tick stays on.
   - Click Publish.

6. **Add Garrett.** On github.com, open the repo → Settings → Collaborators →
   Add people → his GitHub username. He gets an email; once he accepts he can clone it
   and push.

### From then on

Either of you: edit a file, open GitHub Desktop, type a line describing what you
changed, **Commit to main**, then **Push origin**. That's the whole loop.

Before pushing, pull first (GitHub Desktop shows a **Pull origin** button when the
other person has pushed something). Two people editing the same file at the same time
is the one thing Git can't sort out by itself.

---

## 2. Netlify

**What this gets you:** no more dragging a folder onto Netlify. Push to GitHub, the
site updates within about a minute.

1. Log into Netlify and open your existing site (the one on
   `delicate-duckanoo-43e1cf.netlify.app`).
2. **Site configuration → Build & deploy → Continuous deployment → Link repository**
3. Choose GitHub, authorise it, pick `tooth-fairy`.
4. Branch `main`. Leave the build command and publish directory alone — `netlify.toml`
   in the repo already sets them.
5. Deploy.

Your URL doesn't change, so nothing Garrett has saved breaks.

**How to tell it worked:** the bottom of the sidebar shows `build` followed by seven
characters. That's the commit that's live. If it doesn't match your latest commit,
the deploy hasn't finished or you're looking at a cached page — Ctrl+Shift+R.

---

## 3. File attachments

Nothing to do. They work as soon as the site is up.

Files are stored in the database you already have, so there's no second service,
no billing account and no extra rules to publish. Notes take PDFs, images,
PowerPoint, Excel, Word, CSV, text and media up to **10 MB each**, with about
750 MB to share across everything. The note form shows total usage once you've
attached something.

Anything bigger than 10 MB belongs in Drive with the link pasted into the note —
the form will tell you so if you try.

> **Why not Firebase Storage, the obvious answer?** Google started requiring a
> billing account for it in late 2024, even for the free 5 GB. This keeps the
> whole app on the free tier. If you ever do add billing, swapping to Storage
> means changing one file.

---

## Things that will bite you

**Adding a fourth person** means editing the allow list in **three** places, not one:

- `MEMBERS` at the top of `js/goals.js`
- `firestore.rules` — which also covers attachments

Change only the first and they'll sign in successfully to a board that refuses every
save. And **`firestore.rules` does not deploy when you push** — publish it by hand from
the Firebase console, under Firestore → Rules.

**Before pushing anything structural,** run the tests:

```
cd tests
npm install
sh run.sh
```

They never touch the real database or real storage.
