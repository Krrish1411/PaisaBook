# Publishing PaisaBook to GitHub

## If "Publish to GitHub" says `GitHub API error: Validation Failed`

`Validation Failed` is GitHub's 422 response — the *request* was rejected. The
app code itself is never the cause (the tree is 25 small text files). Work
through this list in order:

### 1. A repo with that name already exists (most common)

An earlier failed attempt usually creates the repo before dying. The retry then
collides with it and GitHub returns 422 `already_exists`.

**Fix:** either pick a **new name** in the publish dialog (e.g.
`paisabook-ledger-2`), or delete the stale repo:
`github.com → Your repositories → <repo> → Settings → Danger zone → Delete`.

### 2. The name is invalid

GitHub repo names must be lowercase with no spaces (use `-`), must not start
with `.` and must not be reserved words. `My PaisaBook App` fails;
`paisabook-app` works.

### 3. GitHub isn't connected with the right scope

Re-run the platform's GitHub connection and grant the **`repo`** scope
(private repos) or at least **`public_repo`**. Read-only tokens fail the
create-repo call with a 422.

### 4. The payload included build junk

This project's `.gitignore` now excludes `node_modules/` and `dist/`. If the
platform cached an old file list from before that, publish once more so it
rescans.

---

## Bulletproof fallback: push it yourself (2 minutes)

The button is a convenience — the repo doesn't care how it arrives.

1. **Create an empty repo** on [github.com/new](https://github.com/new)
   (any name, no README/license — it must be empty).
2. **Get the project files** (use the platform's download/export option if
   available, or copy the tree below).
3. From the project folder:

```bash
git init
git branch -M main
git add .
git commit -m "PaisaBook — offline-first personal finance"
git remote add origin https://github.com/<YOU>/<REPO>.git
git push -u origin main
```

4. The included **`.github/workflows/deploy.yml`** runs automatically.
5. One-time: `repo → Settings → Pages → Source → "GitHub Actions"`, and
   `Settings → Actions → Workflow permissions → Read and write`.
6. Live at `https://<YOU>.github.io/<REPO>/` (also shown in the workflow run).

## What gets published

```
index.html  package.json  package-lock.json  tsconfig.json  vite.config.js
.github/workflows/deploy.yml   .gitignore   README.md   PUBLISHING.md
src/  (App, 5 screens, UI kit, db, vault, gdrive, compute, core)
```

Nothing else — no `node_modules`, no `dist`, no secrets (there are none in
source; all keys are derived on-device at runtime).
