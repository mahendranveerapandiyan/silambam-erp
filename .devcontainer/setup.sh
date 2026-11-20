#!/usr/bin/env bash
# Runs once when the codespace is created: installs packages, writes
# .env.local, creates the schema and loads demo data (first time only).
set -euo pipefail

npm ci

if [ ! -f .env.local ]; then
  {
    echo "DATABASE_URL=postgres://postgres:postgres@localhost:5432/silambam"
    echo "SESSION_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  } > .env.local
  echo "Created .env.local"
fi
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/silambam

echo "Waiting for PostgreSQL..."
for i in $(seq 1 60); do
  node -e "require('postgres')(process.env.DATABASE_URL)\`select 1\`.then(()=>process.exit(0),()=>process.exit(1))" && break
  sleep 1
done

npm run db:migrate
# Loads demo branches/students only into an empty database.
node scripts/seed.mjs --demo || echo "Database already has data - skipping demo seed."

echo
npm run build
echo "Ready. Start the app with:  npm start   (then open port 3000 in the PORTS tab)"
echo "Logins: admin/admin123 · incharge1/pass123 · parent1/pass123"
