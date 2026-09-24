# Setup — one time, about 30 minutes

Three separate things. Do them in this order; each one works on its own, so if you
stop halfway nothing is broken.

1. [Get the code on GitHub](#1-github) — so Garrett can make changes
2. [Point Netlify at GitHub](#2-netlify) — so pushing publishes automatically
3. [Switch on file uploads](#3-supabase) — so notes can hold PDFs and decks

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

## 3. Supabase

**What this gets you:** attachments on notes. Until this is done the app runs normally
and the attachment box just says it isn't set up.

1. **Sign up** at [supabase.com](https://supabase.com) with **toothfairysandbox@gmail.com**.
   No card needed.

2. **Create a project.** Any name. Pick a **US region** — `us-east-1` or `us-west-1`;
   those qualify for the larger free allowance. It takes a couple of minutes to build.

3. **Connect it to your Google sign-in.**
   Authentication → Sign In / Providers → **Third Party Auth** → Add integration →
   **Firebase**.
   Firebase project ID: `goal-tracker-v1-c9541`

   This is the step that makes uploads know who you are. Skip it and everything else
   still fails.

4. **Run the policies.** SQL Editor → New query → paste the whole of
   `supabase-policies.sql` from the repo → **Run**. It should finish without errors.

5. **Send me two values.** Settings → API:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **Publishable key** (may be labelled `anon` `public`) — a long string starting `eyJ`

   Both are safe to paste in chat; they're public by design, the same as the Firebase
   config already in the repo. **Do not send the `service_role` key** — that one bypasses
   every policy. I'll never ask for it, and anything that does is a red flag.

I'll put them into `js/attachments.js`, you commit and push, and uploads are live.

> You can also do step 5 yourself — the two values go at the top of
> `js/attachments.js`, in the empty quotes next to `url:` and `key:`.

---

## Things that will bite you

**Adding a fourth person** means editing the allow list in **three** places, not one:

- `MEMBERS` at the top of `js/goals.js`
- `firestore.rules`
- `supabase-policies.sql`

Change only the first and they'll sign in successfully to a board that refuses every
save. And neither rules file deploys with a push — `firestore.rules` gets published from
the Firebase console, `supabase-policies.sql` gets re-run in the Supabase SQL editor.

**Supabase free projects pause after a week with no activity.** You're in this app
weekly, so it shouldn't come up — but if attachments suddenly 404 after a quiet stretch,
open the Supabase dashboard and resume the project.

**Before pushing anything structural,** run the tests:

```
cd tests
npm install
sh run.sh
```

They never touch the real database or real storage.
