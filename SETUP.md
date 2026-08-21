# QuickBooks → GitHub Pages sync — one-time setup

Everything lives in your existing dashboard repo. After this setup you never
touch secrets again: the workflow rotates and re-saves the Intuit token
itself, and the daily run keeps it alive indefinitely.

## What goes where in your dashboard repo

```
index.html                                (replace with the new version)
.github/workflows/quickbooks-sync.yml     (new)
scripts/fetch-quickbooks.js               (new)
scripts/reportMapper.js                   (new)
data/reports.json                         (created automatically by the workflow)
```

Note: `.github` starts with a dot. When creating it via GitHub's web UI, use
**Add file → Create new file** and type the full path
`.github/workflows/quickbooks-sync.yml` as the filename — GitHub creates the
folders for you. Then paste the file's contents.

## Step 1 — Get a refresh token and realm ID (OAuth Playground)

This replaces the whole "backend + redirect" dance with a one-time browser flow.

1. Go to https://developer.intuit.com/app/developer/playground
2. At the top, select **your app** from the dropdown.
3. Check the scope **com.intuit.quickbooks.accounting**.
4. Click **Get authorization code** — a QuickBooks consent screen opens;
   choose your **sandbox company** and approve.
5. Back in the playground, click through **Get tokens** (it exchanges the
   code for you).
6. Copy two values and keep them handy for Step 3:
   - the **refresh_token** (a long string)
   - the **realm ID** (a number — shown in the playground, sometimes labeled
     "Company ID")

## Step 2 — Create a GitHub token so the workflow can update its own secret

The workflow needs permission to write the rotated refresh token back into
the repo's secrets. GitHub's built-in workflow token can't do that, so:

1. GitHub → your profile picture → **Settings** → **Developer settings**
   (bottom of the left sidebar) → **Personal access tokens** →
   **Tokens (classic)** → **Generate new token (classic)**.
2. Name it (e.g. "qb-sync"), set **Expiration: No expiration** (this is what
   makes the setup maintenance-free; a fine-grained token would be more
   locked-down but expires within a year and you'd have to redo it), and
   check the single scope **repo**.
3. Generate, and copy the token (starts with `ghp_`). You'll only see it once.

## Step 3 — Add the five secrets to the dashboard repo

Dashboard repo → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**, five times:

| Name | Value |
|---|---|
| `QB_CLIENT_ID` | from Intuit Keys & credentials |
| `QB_CLIENT_SECRET` | from Intuit Keys & credentials |
| `QB_REFRESH_TOKEN` | from Step 1 |
| `QB_REALM_ID` | from Step 1 |
| `GH_PAT` | from Step 2 |

Secrets are encrypted and are NOT visible to visitors even though the repo
is public — that's the whole point of Actions secrets.

## Step 4 — Edit one line in index.html

Near the top of the `<script>` tag, set the Actions link to your repo:

```js
const QB_SYNC_URL = "https://github.com/YOURUSERNAME/YOURREPO/actions/workflows/quickbooks-sync.yml";
```

## Step 5 — First run

1. Repo → **Actions** tab → **Sync QuickBooks data** in the left list →
   **Run workflow** button → **Run workflow**.
2. Watch it go green (~30–60 seconds). It will have committed
   `data/reports.json` to the repo.
3. Open your dashboard, click **Load QuickBooks Data** — the sandbox
   company's numbers appear, with the snapshot time shown.

## Day-to-day use

- **See latest synced data**: click "Load QuickBooks Data" on the dashboard.
- **Pull fresh from QuickBooks right now** (e.g. after entering a new
  invoice in the sandbox): click the "Pull fresh from QuickBooks" link on
  the dashboard (or go to the Actions tab) → Run workflow → wait for green →
  reload the dashboard and click the button again.
- **Otherwise**: it re-syncs itself daily at 11:17 UTC automatically.

## One caveat to know

`data/reports.json` is committed to a **public** repo, so the snapshot's
numbers are publicly visible. For sandbox/fake data that's a non-issue. If
this ever pointed at a real company's books, this architecture would need to
change (private repo + different hosting) — worth remembering, not worth
solving today.

## Cleanup from the Render attempt

You can delete the Render web service (Render dashboard → the service →
Settings → Delete) and the separate backend repo if you like — nothing in
this setup uses them. Keep the code if you want the "live connection"
reference for later; the two approaches can coexist harmlessly.
