# Every successful change in the web app refreshes every cached read

The web app reads through TanStack Query and used to decide, at each of 17 write sites, which reads to refresh afterwards; three of those lists missed reads the server derives (expenses feed tax and analytics, earnings and stop labels feed goals and progress, settings fed nothing), so figures went stale (2026-11-09). We now send every write through one path (`useChange`) and the QueryClient's `MutationCache.onSuccess` invalidates every cached read after any successful change; reads named by the write are set from its answer and not fetched again. We chose blanket invalidation over per-write lists because the server derives many figures from many tables and the app is one driver on a home server, where a few extra reads cost nothing and a stale tax figure costs trust.

## Consequences

- No page decides what to refresh; adding a server-derived figure needs no web change.
- Pages with many visible reads refetch them all after a save; acceptable at this scale, revisit if a page ever shows dozens of reads.
- Failed changes invalidate nothing.
