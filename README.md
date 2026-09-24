# desktop.fyi

Your desktop, on the web. Paste anything onto an infinite canvas. Friends can add to it. Everything fades unless somebody keeps it alive.

- **One Cloudflare Worker** serves the React app and the API. Wrangler deploys it to `desktop.fyi`.
- **The canvas is [Quickdraw](https://github.com/huttj/quickdraw)**, vendored in `vendor/quickdraw` (see `UPSTREAM_COMMIT`) with one small addition: `editor.shapeFilter` and `editor.shapeAlpha` hooks so the app can hide and fade shapes.
- **Every person has a desktop**, at `/@handle`, backed by a SQLite Durable Object (`worker/BoardDurableObject.ts`). Quickdraw records are stored whole, last-writer-wins, and relayed live over a websocket. The room stamps each record's bookkeeping itself (layer, author, freshness); nothing about that is trusted from clients.
- **Layers.** The owner's things are on the desktop itself. A visitor's additions go on that visitor's layer. The layer picker shows everyone, the desktop alone, or one person's layer. Copy and paste works between any views (Quickdraw's clipboard payload is plain JSON).
- **Decay.** Each item has an age in days. Fresh under 1, fading from 1 to 3, hidden at 3 (only its author can see and revive it, with the "show my hidden things" toggle), archived at 7, deleted 30 days after that. Between daily passes everyone sees a provisional age. The rules and the daily pass are pure functions in `shared/freshness.ts` and `shared/decay.ts`, with tests:
  - moving is a small bump (0.5 d), editing a large one (2 d), capped at 3 d/day together
  - adding something next to an item is a medium bump (1 d), inverse square by distance
  - moving next to newer things is a medium bump
  - whatever an item earns spreads to its neighbours, so comments keep their subject alive and the reverse
- **People.** Sign in with an emailed link; a first sign-in makes the account. Follow is one-way. `/feed` shows what the people you follow made this week and what is about to vanish (yours, hidden ones included).
- **Data request:** `/api/me/export` (linked from Settings) returns everything, archive included.
- **Email** goes out through Cloudflare Email Sending. Local dev never sends: the link is printed to the wrangler console.
- **Images** are uploaded to R2 (named by content hash) before they sync; the document only ever holds the upload URL.

## Develop

```sh
npm install
npm run db:migrate:local
npm run dev
```

`npm test` runs the decay engine tests; `npm run check` type-checks.

## Deploy

Pushes to `main` deploy via GitHub Actions (secret: `CLOUDFLARE_API_TOKEN`, from the **Edit Cloudflare Workers** template plus **D1 Edit** and **Zone → DNS → Edit** on `desktop.fyi`). Manual:

```sh
npm run db:migrate:remote
npm run deploy
```

One-time setup in the Cloudflare dashboard: add `desktop.fyi` as a zone, and enable **Email Sending** for it so `hello@desktop.fyi` can send the sign-in links.
