# Purrlor

## Roadmap and model split

The newest plan is the Claude Docs doc "Purrlor: WATCH and AUDIO" (2026-10-19), ON HOLD since 2026-10-19 (nothing built yet, start it only when asked): a YouTube-style WATCH and a Spotify-style AUDIO on the rail, built from profile pages. Live streaming is paused (its notes are in the doc). It builds on the `rail-sections` branch (Home, Feed and Chat on the rail; pushed, not merged into `master`, also on hold):
https://claude.ai/code/artifact/e757fa66-41eb-42c7-964e-037b3ca376df

The previous plan is the Claude Docs doc "Purrlor: link embeds for messages and posts" (2026-10-04):
https://claude.ai/code/artifact/be32ec17-9535-4319-a37b-3904b785d48c

Its "Work split" table assigns each task a model and has a Status column. "start sonnet work" / "start opus work" means: read that doc first (the Model dropdowns, checks, open questions and Verify first results may have changed), then do every task assigned to that model, on a new branch off `master`. Opus's tasks write `docs/embeds.md`, the contract the Sonnet client tasks build on: read it (and `docs/posts.md`, `docs/federation.md`, `docs/public-web.md`) first. All eight tasks are done and merged into `master` (2026-10-04); what's left are its "Verify first" checks against real sites from the live server.

The previous plan, "Purrlor: federated social features", is done (2026-10-04): tasks 2 to 9 merged 2026-10-03, and task 10, a run between purr.meowops.net and a real second server, works:
https://claude.ai/code/artifact/9f3b850d-5c06-452f-b318-70d72b63b9c4

"Purrlor: gaps and missing features" (2026-10-03) is paused; its operations gaps are done:
https://claude.ai/code/artifact/3ec0d888-2a76-4969-86fc-58e87fe84b26

Earlier plans, done apart from their open questions: "Purrlor: profile pages and what comes after"
(https://claude.ai/code/artifact/160c8b88-75c8-47c1-a433-1151d29bbfda), "Purrlor: what's next"
(https://claude.ai/code/artifact/277fec85-bdab-431f-bcf6-cbdf368db48b), and "Purrlor review & roadmap",
the record of everything built before them (https://claude.ai/code/artifact/8f290dcd-d140-46e7-9ab5-994d822de800).

Branches as of 2026-10-03:
- `master`: everything. The profile pages plan's branches (`profile-pages`, `sonnet-work-2`, `opus-work-2`, `sonnet-work-3`), the later feature branches and `opus-federation` (federation, 2026-10-03) are fully merged into it. The live server is small and treated as a beta, so `master` deploys straight to it.
- `sonnet/gif`: GIF search via Klipy. On hold, do not merge. Klipy's terms forbid the server proxy, re-hosting and caching this branch does unless Klipy approves it in writing.

## Checks

In `apps/web`: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx vite build`, and the end-to-end tests: `npm run e2e:homeserver` (Docker), then `npm run e2e` (see `apps/web/e2e/README.md`). The services (`services/token-server`, `services/push-gateway`) each have their own lint, typecheck and test scripts.

If the repo is on a network share (Windows), git may need `-c safe.directory='*'`, and vitest and vite may fail on native rollup binaries. Run them from a local copy of `apps/web` instead (see README).
