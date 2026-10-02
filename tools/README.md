# To-do scanner

The To-do tab fills itself. Twice a day a scheduled task in the Claude desktop
app on Garrett's Mac:

1. asks `todo-sync.mjs` when the last scan reached and what's already on the list
2. reads everything since then in the Tooth Fairy **Slack** (channels and DMs),
   **Gmail** (Tooth Fairy mail only) and **Claude chats** (via `chat-digest.mjs`,
   which includes the Aspen check-ins)
3. writes a changes file of new tasks and finished ones
4. hands it to `todo-sync.mjs apply`, which enforces the rules below and writes
   to Firestore. The page updates live.

The schedule is 7:00 AM and 9:00 PM local time. It only runs while the Claude
app is open; a run that was missed happens the next time the app opens, and
because each scan starts where the last one stopped, nothing is skipped.

## The rules (in `todo-logic.mjs`, tested in `tests/ttodo-logic.mjs`)

- A deleted task never comes back, from the same message or a new one.
- A field someone changed on the page (text, owner, priority, due) is never
  overwritten.
- A task someone unchecked is never re-checked.
- The same message never makes a second copy; the same task from two places
  becomes one task with two sources.

## One-time setup: the Firebase key

The website only lets three Google accounts in. The scanner isn't one of them,
so it uses a service-account key instead. **The key can read and write the whole
database. It lives only on this Mac and must never be committed.**

1. Open the Firebase console for this project, signed in with the account that
   owns it:
   https://console.firebase.google.com/project/goal-tracker-v1-c9541/settings/serviceaccounts/adminsdk
2. Under **Firebase Admin SDK**, click **Generate new private key**, then
   **Generate key**. A `.json` file downloads.
3. Move it into place:
   ```
   mkdir -p ~/.config/tooth-fairy
   mv ~/Downloads/goal-tracker-v1-c9541-firebase-adminsdk-*.json ~/.config/tooth-fairy/firebase-admin.json
   chmod 600 ~/.config/tooth-fairy/firebase-admin.json
   ```
4. Check it:
   ```
   cd tools && npm install
   node todo-sync.mjs check
   ```
   It should print `OK: N tasks; last scan never`.

If the key ever leaks, delete it in the same console page (Service accounts →
Manage service account permissions → Keys) and generate a new one.

## Commands

```
node tools/todo-sync.mjs check                  key works, database reachable
node tools/todo-sync.mjs list                   every task as JSON, deleted included
node tools/todo-sync.mjs since                  where the last scan reached
node tools/todo-sync.mjs apply changes.json     write; add --dry-run to preview
node tools/chat-digest.mjs --since <ISO>        recent Tooth Fairy chat text
```

The changes file format is documented at the top of `todo-logic.mjs`.
