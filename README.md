# desktop.fyi

Your desktop, on the web. Paste anything onto an infinite canvas. Friends can add to it. Everything fades unless somebody keeps it alive.

- **One Cloudflare Worker** serves the React app and the API. Wrangler deploys it to `desktop.fyi`.
- **The canvas is [Quickdraw](https://github.com/huttj/quickdraw)**, vendored unmodified in `vendor/quickdraw` (see `UPSTREAM_COMMIT`). The app hides and fades shapes through Quickdraw's `shapeFilter` and `shapeAlpha` hooks, and locks other people's things with `shapeLocked`.
- **Every person has a desktop**, at `/@handle`, backed by a SQLite Durable Object (`worker/BoardDurableObject.ts`). Quickdraw records are stored whole, last-writer-wins, and relayed live over a websocket. The room stamps each record's bookkeeping itself (layer, author, freshness); nothing about that is trusted from clients.
- **Layers.** The owner's things are on the desktop itself. A visitor's additions go on that visitor's layer. The layer picker shows everyone, the desktop alone, or one person's layer. Copy and paste works between any views (Quickdraw's clipboard payload is plain JSON).
- **Decay.** Each item has an age in days. Fresh under 1, fading from 1 to 3, hidden at 3 (only its author can see and revive it, with the "show my hidden things" toggle), archived at 7, deleted 30 days after that. Between daily passes everyone sees a provisional age. The rules and the daily pass are pure functions in `shared/freshness.ts` and `shared/decay.ts`, with tests:
  - editing is a large bump (2 d); moving barely counts (0.1 d), since people move things to make space; capped at 3 d/day together
  - adding something next to an item is a medium bump (1 d), inverse square by distance
  - moving next to newer things is a medium bump
  - whatever an item earns spreads to its neighbours, so comments keep their subject alive and the reverse
- **People.** Sign in with an emailed link; a first sign-in makes the account. Follow is one-way. `/feed` shows what the people you follow made this week and what is about to vanish (yours, hidden ones included).
- **Everyone.** `/everyone` is the public room: the newest five hundred things across every desktop, laid out at true size on one Quickdraw board, newest in the middle, each leading to its desktop. Things touched this week arrive with whatever they physically touch (a highlight brings the words under it), no further; highlighter strokes alone are left out. `/api/everyone` fans out to every board and is cached for a minute per edge location.
- **Data request:** `/api/me/export` (linked from Settings) returns everything, archive included.
- **Email** goes out through Cloudflare Email Sending. Local dev never sends: the link is printed to the wrangler console.
- **Images** are uploaded to R2 (named by content hash) before they sync; the document only ever holds the upload URL.

## API keys and MCP

Under **Profile → API keys** anyone can mint a personal access key. It acts as them: reads everything they can see, writes only to their own desktop and account (never admin, never another desktop's board). As an MCP server for Claude, paste `https://desktop.fyi/mcp?token=<key>` as a custom connector with no sign-in (Claude Code: `claude mcp add --transport http desktop-fyi "https://desktop.fyi/mcp?token=<key>"`). For scripts, send it as `Authorization: Bearer dfyi_…` on any `/api` call; `/mcp` accepts that header too, for clients that would rather keep the key out of the URL. The MCP server (`worker/mcp.ts`, plain JSON-RPC over HTTP) gives an agent the person's own desktop in hand: `my_desktop`, `put_items`, `update_items` (move, turn, restack, merge props), `remove_items`, `keep_items`, `freshen_items`, `put_image`, `update_profile`, plus `desktop`, `everyone`, `feed`, `whoami`, `record_reference` and `dev_setup`, which explains the next section.

## Develop

```sh
npm install
npm run db:migrate:local
npm run dev
```

`npm test` runs the decay engine tests; `npm run check` type-checks.

To work on the client against the real site (real data, acting as you, writing only to your own desktop):

```sh
DFYI_UPSTREAM=https://desktop.fyi DFYI_TOKEN=dfyi_… npm run dev
```

## Deploy

Pushes to `main` deploy via GitHub Actions (secret: `CLOUDFLARE_API_TOKEN`, from the **Edit Cloudflare Workers** template plus **D1 Edit** and **Zone → DNS → Edit** on `desktop.fyi`). Manual:

```sh
npm run db:migrate:remote
npm run deploy
```

One-time setup in the Cloudflare dashboard: add `desktop.fyi` as a zone, and enable **Email Sending** for it so `hello@desktop.fyi` can send the sign-in links.
