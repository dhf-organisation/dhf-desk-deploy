#!/usr/bin/env bash
#
# DHF Desk — deploy to Netlify (production)
# ------------------------------------------------------------------
# Usage:
#   ./deploy.sh                 # deploys the current folder (".")
#   ./deploy.sh dist            # deploys ./dist
#
# One-time setup (pick ONE auth method):
#   A) Interactive:  npx netlify-cli login   then   npx netlify-cli link
#   B) CI / token:   export NETLIFY_AUTH_TOKEN=xxxx
#                    export NETLIFY_SITE_ID=your-site-id   (if folder not linked)
#
# If your Netlify site is connected to a Git repo, you usually DON'T need this
# script — just `git push` to your production branch and Netlify auto-builds.
# Use this script for manual/direct deploys of a single-file or static build.
# ------------------------------------------------------------------

set -euo pipefail

PUBLISH_DIR="${1:-.}"

echo "▶ DHF Desk deploy"
echo "  publish dir : ${PUBLISH_DIR}"

# --- checks --------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "✖ Node.js not found. Install Node 18+ and retry." >&2
  exit 1
fi

if [ ! -e "${PUBLISH_DIR}" ]; then
  echo "✖ Publish dir '${PUBLISH_DIR}' does not exist." >&2
  exit 1
fi

# Warn (don't fail) if the folder isn't linked and no site id is set.
if [ ! -f ".netlify/state.json" ] && [ -z "${NETLIFY_SITE_ID:-}" ]; then
  echo "ℹ No linked site detected." >&2
  echo "  Run 'npx netlify-cli link' once, or set NETLIFY_SITE_ID." >&2
fi

# --- optional: quick sanity check that index.html has the theme init ---
if [ -f "${PUBLISH_DIR}/index.html" ]; then
  if ! grep -q "dhf-theme" "${PUBLISH_DIR}/index.html"; then
    echo "⚠ Warning: index.html has no 'dhf-theme' init script." >&2
    echo "  Dark-mode toggle/persistence may not be wired up yet." >&2
    # Not fatal — continue.
  fi
fi

# --- deploy --------------------------------------------------------
# npx --yes avoids a global install; pins to netlify-cli.
echo "▶ Deploying to production…"
npx --yes netlify-cli deploy \
  --prod \
  --dir "${PUBLISH_DIR}" \
  ${NETLIFY_SITE_ID:+--site "${NETLIFY_SITE_ID}"}

echo "✔ Deploy complete."
