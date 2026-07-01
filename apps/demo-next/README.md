
# RollbackKit Demo

A Next.js demo application for RollbackKit.

RollbackKit helps TypeScript teams model dangerous SaaS actions as explicit product operations with preview, audit history and undo.

This demo shows a small workspace with projects, members and documents. It is designed to demonstrate how actions such as archiving a project, changing a member role or removing a member can be made safer through RollbackKit.

## Local setup

Create a local environment file:

```bash
cp apps/demo-next/.env.example apps/demo-next/.env
```

Edit `apps/demo-next/.env` and set the demo database URL:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test"
```

Prepare the demo database:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

Start the demo app:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next dev
```

Open:

```text
http://localhost:3000
```

## Scripts

```bash
pnpm --filter @rollbackkit/demo-next dev
pnpm --filter @rollbackkit/demo-next build
pnpm --filter @rollbackkit/demo-next typecheck
pnpm --filter @rollbackkit/demo-next lint
pnpm --filter @rollbackkit/demo-next db:migrate
pnpm --filter @rollbackkit/demo-next db:seed
pnpm --filter @rollbackkit/demo-next db:reset
```

## Database

The demo app uses PostgreSQL for product data.

Demo domain tables:

```text
demo_workspaces
demo_members
demo_projects
demo_documents
```

RollbackKit lifecycle tables are managed separately by the RollbackKit PostgreSQL adapter:

```text
rollbackkit_action_runs
rollbackkit_snapshots
rollbackkit_side_effects
rollbackkit_conflicts
rollbackkit_schema_migrations
```

The demo keeps product state and RollbackKit lifecycle state separate:

* product tables store workspace, members, projects and documents;
* RollbackKit tables store action runs, snapshots, side effects, conflicts and audit history.

## Troubleshooting

See [Troubleshooting](../docs/TROUBLESHOOTING.md) for database URL, migration checksum, workspace
build, idempotency and undo errors.
