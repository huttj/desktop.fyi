# desktop.fyi

## Always check for Quickdraw updates first

The canvas is Quickdraw, vendored unmodified from the sibling checkout at `../quickdraw` (a git repo
the user develops in parallel). Anything the board needs from the engine goes upstream there, never
into the vendored copy. At the start of every session, and before any deploy, compare the vendored
commit with that checkout and pull it in if it moved:

```sh
git -C ../quickdraw rev-parse HEAD; cat vendor/quickdraw/UPSTREAM_COMMIT
```

If they differ, re-vendor from the committed tree (never the working tree: another session may be mid-change there):

```sh
rm -rf vendor/quickdraw/packages && mkdir -p vendor/quickdraw/packages && git -C ../quickdraw archive HEAD packages/core packages/react | tar -x -C vendor/quickdraw/
rm -rf vendor/quickdraw/packages/core/test vendor/quickdraw/packages/*/README.md
git -C ../quickdraw rev-parse HEAD > vendor/quickdraw/UPSTREAM_COMMIT
npm run check && npm test
```

Then look at what changed (`git -C ../quickdraw log --oneline <old>..HEAD -- packages`) and adjust
anything in `client/` that the new UI touches (the top bar and minimap share the top edge of the board).

## Ship

`npm run check && npm test && npm run build`, then `npm run db:migrate:remote` (if a migration was added)
and `npm run deploy`. Pushes to `main` also deploy through GitHub Actions.

## Where things are

- Decay rules: `shared/freshness.ts`; the daily pass: `shared/decay.ts` (pure, tested).
- One Durable Object per desktop: `worker/BoardDurableObject.ts` (layers, authorship, freshness, alarm).
- People, sessions, follows: D1 via `worker/db.ts`; migrations in `migrations/`.
- Local dev never sends email; sign-in links print to the wrangler console.
