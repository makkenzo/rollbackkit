# @rollbackkit/cli

Command-line tools for RollbackKit PostgreSQL migrations and diagnostics.

## Install

```bash
pnpm add -D @rollbackkit/cli
```

## Usage

Apply migrations:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm exec rollbackkit migrate
```

Check migration status:

```bash
ROLLBACKKIT_DATABASE_URL="postgres://user:password@localhost:5432/app_database" \
pnpm exec rollbackkit doctor
```

You can also pass the database URL directly:

```bash
pnpm exec rollbackkit doctor --database-url "postgres://user:password@localhost:5432/app_database"
```

The CLI exits with `0` on success and `1` on failure. Use `--verbose` to print stack traces and
nested causes for debugging.
