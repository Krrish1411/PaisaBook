# PaisaBook

Offline-first personal & household finance for India — a private ledger that treats your money data like a vault, not a feed.

## What it does

- **Ledger** — entries across bank / cash / wallet / credit-card accounts, with Indian number formatting (L/Cr grouping), transfers, and UPI-ref search.
- **Reserved funds** — money held for someone, borrowed from someone, or given out to someone; each handled correctly in net-worth and "available to spend".
- **Funds & plans** — a planned-bills timeline with recurrence, SVG-ring budget envelopes with rollover, and savings goals with contribution history.
- **Reports** — 7D / 30D / 3M / 1Y / custom periods at day-week-month granularity, category donut with trends, budget-vs-actual, plan execution, top merchants, a spending heat-grid and a 16-ratio health wall (savings rate, runway, liquidity, debt-to-income…).
- **Multi-currency** — per-account currencies (INR, USD, EUR, GBP, AED…) with editable rates; every aggregate converts to INR.
- **Privacy mode** — an eye button masks every number app-wide instantly; un-masking requires the vault passphrase. One-tap instant lock re-seals the whole app.

## Security model (zero-knowledge)

- **Vault Lock (mandatory).** The entire local database is AES-256-GCM ciphertext under a key derived from your passphrase (PBKDF2-SHA256, 600k rounds). Locked = IndexedDB holds nothing but the blob; every ledger table reads zero rows.
- **Live storage inspector.** Settings show the actual per-table row counts and lock state in real time, so the claim is verifiable, not just stated.
- **Google Drive sync (optional, E2EE).** Only the sealed vault blob is uploaded — to Drive's hidden `appDataFolder`, under the narrowest `drive.appdata` scope, using *your own* OAuth client (no third-party token custody). Google sees ciphertext and a filename. Tokens live in memory for one hour, never persisted. Pulling on a second device requires the vault passphrase.
- **No network by default.** The app never dials out unless you connect Drive. No telemetry, no analytics.
- The one plaintext path is the explicitly-labelled plain-JSON export.

## Stack

React 18 + TypeScript + Vite · Dexie (IndexedDB) · Yjs-grade determinism in plain merge logic · WebCrypto + libsodium primitives · Recharts · Tailwind CSS v4 · Bricolage Grotesque / IBM Plex type system · 8 hand-tuned themes (4 light, 4 dark).

## Run it

```bash
npm install
npm run dev      # local dev
npm run build    # production build → dist/
```

## Sync between two devices

1. Settings → **Google Drive sync** → follow the ~3-minute Google Cloud setup (enable Drive API → consent screen + test user → Web OAuth client → authorize this app's origin).
2. Paste the Client ID, sign in, **Push now**.
3. On the second device, connect with the same Client ID and **Pull & restore** — enter the vault passphrase to decrypt.

Auto-sync keeps pushing a fresh sealed snapshot shortly after changes while the app is open and online.

## Publishing

A ready GitHub Pages workflow ships in `.github/workflows/deploy.yml`. If the
one-click publish button fails, see **[PUBLISHING.md](PUBLISHING.md)** for the
diagnosis checklist and a 2-minute manual-push fallback.
