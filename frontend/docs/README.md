# KumoriTV docs

One page per topic, all of them operational: what was built, how to run it, how
to turn it off, and what could not be verified.

| Document | What it covers |
|---|---|
| [ads-adcash.md](ads-adcash.md) | **Advertising.** The Adcash Autotag, its env vars, how to enable/disable it, the Monetag removal log and why `public/sw.js` is a self-removing stub until 2027-01-14. |
| [ani-provider.md](ani-provider.md) | The project's own streaming API, tried before Anivexa; download links. |
| [anivexa-notes.md](anivexa-notes.md) | AniVexa API notes. |
| [background.md](background.md) | Background work and in-process chaining. |
| [community.md](community.md) | Community: enabling it, running the SQL, what is gated. |
| [community-plan.md](community-plan.md) | Prompt 38A - the community plan. |
| [cron.md](cron.md) | Cron jobs, budgets, `/api/cron/status`. |
| [database.md](database.md) | Tables, views and the ranked sitemap view. |
| [local-store.md](local-store.md) | Local playback store. |
| [migration-notes.md](migration-notes.md) | Firestore -> Supabase migration notes. |
| [prompt-9-audit.md](prompt-9-audit.md) | Prompt 9 audit of the migration. |
| [proxy.md](proxy.md) | The signed stream proxy. |
| [push.md](push.md) | Push notifications (OneSignal): what is wired and the owner checklist. |
| [sitemap-cloudflare.md](sitemap-cloudflare.md) | The Cloudflare cache rule for the sitemaps. |
| [watch-api.md](watch-api.md) | The watch resolver API. |
| [watch-notes.md](watch-notes.md) | Watch resolver notes. |
| [sql/](sql/) | Hand-run SQL, each file with a matching `*.rollback.sql` (sitemaps, community, profiles). |

Run order for the SQL files that need it is written at the top of the file
itself; `docs/sql/sitemap-chunks.sql` before `docs/sql/sitemap-refresh-fix.sql`.
