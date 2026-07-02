# Demo App

RollbackKit includes a Next.js demo application in `apps/demo-next`.

The demo is a small SaaS-style workspace that shows how dangerous product actions can be made previewable, auditable and reversible.

The app is a fixture demo. It is not a production auth or request-boundary template. Runtime requests use seeded demo data with a hard-coded workspace `workspace_acme`, tenant `workspace_acme` and actor `member_ada` (`Ada Lovelace`). A real product must resolve tenant, workspace, actor and permissions from its authenticated request boundary before invoking RollbackKit actions.

## Product scenario

The demo workspace contains:

- projects;
- members;
- documents;
- action preview;
- audit history;
- undo policy.

The main product loop is:

```text
preview -> execute -> audit -> undo
```

A user should be able to understand:

* what action is about to happen;
* what target is affected;
* what impact the action has;
* whether the action can be undone;
* how long undo is available;
* what is stored in audit history;
* why unsafe undo can be refused.

## Visual direction

The selected visual direction is Linear/Vercel-like:

* clean developer-tool interface;
* neutral background;
* compact cards;
* thin borders;
* restrained typography;
* minimal decoration;
* polished product feel.

The demo should look like a real product surface, not an internal development page.

## Domain model

Demo product entities:

```text
workspace
member
project
document
```

Demo product tables:

```text
demo_workspaces
demo_members
demo_projects
demo_documents
```

These tables represent fake SaaS product state.

RollbackKit lifecycle storage is separate.

## RollbackKit storage

RollbackKit stores action lifecycle data in its own PostgreSQL tables:

```text
rollbackkit_action_runs
rollbackkit_snapshots
rollbackkit_side_effects
rollbackkit_conflicts
rollbackkit_schema_migrations
```

The demo uses both layers:

* demo domain tables for product state;
* RollbackKit tables for action lifecycle, snapshots, side effects, conflicts and audit history.

## Local setup

For repeated local commands, copy the demo env example:

```bash
cp apps/demo-next/.env.example apps/demo-next/.env
```

Then edit `apps/demo-next/.env` with your local `ROLLBACKKIT_DEMO_DATABASE_URL`.

The demo runtime and database scripts require `ROLLBACKKIT_DEMO_DATABASE_URL` and intentionally do not fall back to a generic `DATABASE_URL`. Use a disposable local database because `db:migrate`, `db:seed` and `db:reset` can change demo data.

Prepare the demo database:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next db:reset
```

Run the demo app:

```bash
ROLLBACKKIT_DEMO_DATABASE_URL="postgres://user:password@localhost:5432/rollbackkit_test" \
pnpm --filter @rollbackkit/demo-next dev
```

Open:

```text
http://localhost:3000
```

## Verification

Run demo checks:

```bash
pnpm --filter @rollbackkit/demo-next lint
pnpm --filter @rollbackkit/demo-next typecheck
pnpm --filter @rollbackkit/demo-next build
```

Run repository checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Related Pages

- [Getting Started](./GETTING_STARTED.md)
- [PostgreSQL Setup](./POSTGRESQL_SETUP.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Security Baseline](./SECURITY.md)
