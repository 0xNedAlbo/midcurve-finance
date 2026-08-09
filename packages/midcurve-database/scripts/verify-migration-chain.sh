#!/usr/bin/env sh
#
# Verify that the checked-in migration chain reproduces schema.prisma from empty.
#
# Applies every migration in prisma/migrations to a throwaway database, then
# diffs the result against the datamodel. Exits 0 if they match, 2 if they have
# drifted apart, 1 on error.
#
# Run it after creating a migration, and before applying the chain to an empty
# database. See docs/architecture.md, "Verifying the migration chain".
#
# Requires psql and a DATABASE_URL whose role may CREATE DATABASE. The throwaway
# database is created and dropped by this script; DATABASE_URL is only read.

set -eu

cd "$(dirname "$0")/.."

# The package .env is a symlink to the repo root .env. Neither npm nor pnpm loads
# it, and Prisma loads it too late to help — CLI flags are expanded by the shell
# before Prisma runs. So it has to be sourced here.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is not set — see .env.example}"

SHADOW_NAME="${SHADOW_DATABASE_NAME:-midcurve_migration_check}"
SHADOW_URL=$(printf '%s' "$DATABASE_URL" | sed -E "s|/[^/?]+(\?.*)?\$|/${SHADOW_NAME}\1|")

if [ "$SHADOW_URL" = "$DATABASE_URL" ]; then
  echo "Refusing to run: could not derive a throwaway database URL from DATABASE_URL." >&2
  exit 1
fi

drop_shadow() {
  psql "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$SHADOW_NAME\";" >/dev/null 2>&1
}
trap drop_shadow EXIT

drop_shadow
psql "$DATABASE_URL" -q -c "CREATE DATABASE \"$SHADOW_NAME\";" >/dev/null

echo "Applying the migration chain to a throwaway database ($SHADOW_NAME)…"

# --exit-code makes Prisma report 0 for "no difference" and 2 for "differs".
# Capture it directly: after a failed `if` with no `else`, $? is the status of
# the `if` statement itself (0), not of the command that failed.
set +e
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_URL" \
  --exit-code
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "✓ The migration chain reproduces schema.prisma exactly."
  exit 0
fi

if [ "$status" -eq 2 ]; then
  echo ""
  echo "✗ Drift: applying the migration chain to an empty database does not"
  echo "  produce schema.prisma. A fresh deploy would land on the wrong schema."
  echo ""
  echo "  To see the difference, re-run the diff with --script:"
  echo ""
  echo "    npx prisma migrate diff \\"
  echo "      --from-migrations ./prisma/migrations \\"
  echo "      --to-schema-datamodel ./prisma/schema.prisma \\"
  echo "      --shadow-database-url \"\$SHADOW_URL\" --script"
  echo ""
fi
exit "$status"
