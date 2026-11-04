# Background work

Work that should outlive the response (`/api/watch` database writes, discovery and cron jobs, episode-SEO imports) goes through `runInBackground` in `app/lib/background.ts`. It never throws and never rejects; failures are logged as `[background] <label> failed:`.

On Vercel the task is handed to `waitUntil`, which keeps the invocation alive. On Render and Railway there is no `waitUntil`, so the task runs detached and is tracked; a `SIGTERM`/`SIGINT` handler drains it before the process exits.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_MANUAL_SIG_HANDLE` | unset | Must be `"true"` in the `start` command. Next.js installs its own `SIGTERM` handler that calls `process.exit(0)` immediately, which would kill the drain. The npm `start` script already sets it; if a Render or Railway service overrides the start command, add `NEXT_MANUAL_SIG_HANDLE=true` there too. Startup logs a warning when it is missing. |
| `BACKGROUND_DRAIN_TIMEOUT_MS` | `10000` | How long shutdown waits for in-flight work before exiting anyway (with a warning). |

## Start command

The drain lives in the Next server process, so the signal has to reach it. Start the server directly instead of through a wrapper: a `npm start` chain (`npm` -> `sh -c` -> server) leaves the server unsignalled, because npm exits on `SIGTERM` and orphans it. On Render set the start command to `npm start` only if the platform signals the whole process group; otherwise use a direct command such as `NEXT_SHARP_PATH=/tmp/node_modules/sharp NEXT_MANUAL_SIG_HANDLE=true npx next start -H 0.0.0.0 -p $PORT`, or `exec` it from a shell script.

## Limits

Railway destroys the old container once `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (default 10) elapses after `SIGTERM`, so set it to at least the drain window, plus a second or two and the reverse proxy's own grace period. Render's default stop timeout is 30 seconds.

The drain is best effort: a cron run may use its whole 200s start budget (`START_BUDGET_MS`), and a redeploy will still cut it off after the drain limit. Long jobs should stay re-runnable, which is why cron runs go through `cron_runs` and the chained self-invocation.
