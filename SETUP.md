# Setup — one time, about 30 minutes

Three separate things. Do them in this order; each one works on its own, so if you
stop halfway nothing is broken.

1. [Get the code on GitHub](#1-github) — so Garrett can make changes
2. [Point Netlify at GitHub](#2-netlify) — so pushing publishes automatically
3. [Switch on file uploads](#3-file-attachments-firebase-storage) — so notes can hold PDFs and decks

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

## 3. File attachments (Firebase Storage)

**What this gets you:** files on notes. Until this is done the app runs normally and the
attachment box says it isn't switched on.

There is nothing to configure in the code — attachments use the Firebase project you
already have.

1. **Turn on Storage.** [Firebase console](https://console.firebase.google.com) → your
   `goal-tracker-v1` project → Build → **Storage** → Get started.

2. **It will ask you to upgrade to the Blaze plan.** This is Google's doing, not a
   change of heart on my part — since late 2024 Firebase requires a billing account for
   Storage even though the first **5 GB is free**. You add a card; for a few PDFs a week
   you will not be billed.

   I'm not going to enter card details for you — that's yours to do.

3. **Set a budget alert while you're there** so "should stay at zero" is something you
   can verify rather than trust. In the Google Cloud console → Billing → Budgets &
   alerts → Create budget → $1 → email yourself. Two minutes, and it means a runaway
   never surprises you.

4. **Publish the rules.** Firebase console → Storage → **Rules** tab → replace what's
   there with the contents of `storage.rules` from the repo → **Publish**.

   Skip this and uploads are refused — which is the intended behaviour, since the
   default rules lock everything out.

That's it. Reload the site and the attachment box appears on the note form.

### What the rules do

Only the three allowed accounts can read or write, nothing outside `notes/` is
reachable at all, and a single file is capped at 50 MB so a hand-crafted request can't
dump something enormous into the bucket.

### One thing to know about download links

A file's link carries a long random token. `storage.rules` decides who can *get* a link,
but once a link exists it works for anyone holding it and doesn't expire. For call notes
between the two of you that's a reasonable trade. If a particular file ever needs to be
locked down, Firebase console → Storage → the file → **Revoke access token** kills every
link to it immediately.

---

## Things that will bite you

**Adding a fourth person** means editing the allow list in **three** places, not one:

- `MEMBERS` at the top of `js/goals.js`
- `firestore.rules`
- `storage.rules`

Change only the first and they'll sign in successfully to a board that refuses every
save. And **neither rules file deploys when you push** — both are published by hand from
the Firebase console, under Firestore → Rules and Storage → Rules.

**Before pushing anything structural,** run the tests:

```
cd tests
npm install
sh run.sh
```

They never touch the real database or real storage.
