# @rollbackkit/cli

Command-line tools for RollbackKit PostgreSQL migrations and diagnostics.

## Install

```bash
pnpm add -D @rollbackkit/cli
```

## Usage

Apply migrations:

```bash
ROLLBACKKIT_DATABASE_URL="$DATABASE_URL" \
pnpm exec rollbackkit migrate
```

Check migration status:

```bash
ROLLBACKKIT_DATABASE_URL="$DATABASE_URL" \
pnpm exec rollbackkit doctor
```

Prefer `ROLLBACKKIT_DATABASE_URL` for credential-bearing connection strings. You can also pass a
non-secret local database URL directly when needed:

```bash
pnpm exec rollbackkit doctor --database-url "postgres://localhost:5432/app_database"
```

`rollbackkit migrate` and `rollbackkit doctor` intentionally ignore generic `DATABASE_URL`.
Use `ROLLBACKKIT_DATABASE_URL` or `--database-url` so RollbackKit never connects to an
ambient application database by accident.

Fail CI when RollbackKit migrations are pending:

```bash
ROLLBACKKIT_DATABASE_URL="$DATABASE_URL" \
pnpm exec rollbackkit doctor --fail-on-pending
```

The CLI exits with `0` on success and `1` on failure. Use `--verbose` to print stack traces and
nested causes for debugging.

For common setup errors, see [Troubleshooting](../../apps/docs/TROUBLESHOOTING.md).
