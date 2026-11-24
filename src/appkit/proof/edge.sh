#!/usr/bin/env bash
# The both-address-shapes proof against the REAL Edge of a running stack (`make up`), not the dev
# platform: the template's app, built and started by Dock from the kit's template, opened at
#   PW_PATH_URL  http://localhost:<edge port>/<org>/<division>/<project>/<app>/
#   PW_HOST_URL  http://<org>.localhost:<edge port>/<division>/<project>/<app>/
# The app must be public (anyone may read; writing needs a sign-in). PW_MEMBER_EMAIL is a member
# with a role on it, signed in through the edge's own sign-in page with the development sign-in —
# on the subdomain that sign-in happens on the platform's host and returns through the hand-off.
#
# `make e2e-stack` sets all three up and runs this after its own suite.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${PW_PATH_URL:?PW_PATH_URL is required (the app's path-form address)}"
: "${PW_HOST_URL:?PW_HOST_URL is required (the app's organisation-subdomain address)}"
: "${PW_MEMBER_EMAIL:?PW_MEMBER_EMAIL is required (a member with a role on the app)}"
cd "$HERE"
npm ci --no-audit --no-fund > /dev/null
CI=1 PW_EDGE=1 PW_PATH_URL="$PW_PATH_URL" PW_HOST_URL="$PW_HOST_URL" PW_MEMBER_EMAIL="$PW_MEMBER_EMAIL" npx playwright test
