#!/bin/sh
# Rebuilds backend/ui/staff-carbon.html: the Carbon Design System slice used by the staff Reports dashboard,
# with IBM Plex Sans embedded (no CDN). Installs Carbon and Sass into a temporary folder, never into this
# project, with install scripts switched off (Carbon's package includes a telemetry script).
#   sh tools/carbon/build.sh            (set CARBON_WORK=/some/folder to reuse an earlier install)
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${CARBON_WORK:-$(mktemp -d)}"
CARBON_VERSION=1.116.0
SASS_VERSION=1.105.1

if [ ! -d "$WORK/node_modules/@carbon/styles" ]; then
  (cd "$WORK" && echo '{"private":true}' > package.json &&
    npm install --ignore-scripts --no-audit --no-fund "@carbon/styles@$CARBON_VERSION" "sass@$SASS_VERSION")
fi
"$WORK/node_modules/.bin/sass" --load-path="$WORK/node_modules" --style=compressed --no-source-map --quiet-deps \
  "$ROOT/tools/carbon/dashboard.scss" "$WORK/carbon.css"
node "$ROOT/tools/carbon/embed.js" "$WORK" "$ROOT/backend/ui/staff-carbon.html"
mkdir -p "$ROOT/tools/carbon/licenses"
cp "$WORK/node_modules/@carbon/styles/LICENSE" "$ROOT/tools/carbon/licenses/carbon-LICENSE.txt"
cp "$WORK/node_modules/@ibm/plex-sans/LICENSE.txt" "$ROOT/tools/carbon/licenses/plex-LICENSE.txt" 2>/dev/null ||
  cp "$WORK/node_modules/@ibm/plex-sans/LICENSE" "$ROOT/tools/carbon/licenses/plex-LICENSE.txt"
echo "Wrote backend/ui/staff-carbon.html"
