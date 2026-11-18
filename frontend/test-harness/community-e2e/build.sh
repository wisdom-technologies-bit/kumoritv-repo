#!/usr/bin/env bash
# The e2e servers need NEXT_PUBLIC_* values BAKED IN at build time (Next inlines
# them), so a build made without them has no browser Supabase client and every
# visitor looks signed out. Run this before `npx playwright test -c ...`.
set -euo pipefail
cd "$(dirname "$0")/../.."
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${STUB_PORT:-54329}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="standin-anon-key"
export SUPABASE_SERVICE_ROLE_KEY="standin-service-key"
export ANILIST_API_URL="http://127.0.0.1:${STUB_PORT:-54329}/"
export PROXY_SIGNING_SECRET="standin-proxy-secret"
export COMMUNITY_ENABLED="1"
npx next build
