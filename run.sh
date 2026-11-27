#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "dev" ]; then
  echo "Starting Wrytrove dev server on 0.0.0.0:5173..."
  exec npx vite --host 0.0.0.0 --port 5173
fi

echo "==> 1/4 Running unit & fixture tests (npm test)..."
npm test

echo "==> 2/4 Running TypeScript typecheck & production build (npm run build)..."
npm run build

echo "==> 3/4 Running static security audit (npm run audit:static)..."
npm run audit:static

echo "==> 4/4 Validating roadmap manifest (node scripts/validate-roadmap.js)..."
node scripts/validate-roadmap.js

echo ""
echo "All checks passed! Run './run.sh dev' to start the app."
