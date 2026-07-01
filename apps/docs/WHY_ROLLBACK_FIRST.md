# Why Rollback-First

Rollback-first means designing a dangerous product action from the beginning as something that can
be previewed, audited and undone when undo is safe.

It does not mean every action must be reversible. It means the product should be honest about
reversibility before mutation happens.

## The Problem It Solves

Most destructive product actions start small:

```text
click button -> call server handler -> update database
```

Then requirements arrive later:

- show a better warning;
- make retries safe;
- keep an audit trail;
- let an admin undo the action;
- block undo if the target changed;
- explain irreversible side effects.

At that point the original mutation handler is usually too thin. It does not have a preview model,
snapshot boundary, idempotency key, side-effect record or undo contract.

RollbackKit makes those parts explicit up front.

## What Changes

Without rollback-first, safety logic is scattered:

- confirmation copy lives in UI code;
- permissions live in route handlers;
- mutation logic lives in services;
- audit records live in logs;
- undo is a separate bespoke endpoint;
- side effects are forgotten after they happen.

With rollback-first, the product operation has one lifecycle:

```text
preview
  explain expected impact before mutation

execute
  mutate state, save snapshots and record side effects

audit
  keep a durable action run with actor, target, timestamps, result and errors

undo
  restore state only if the modeled undo path is still valid
```

## Safety Principles

RollbackKit follows four rules:

- explicit undo beats magical rollback;
- refusing unsafe undo is correct behavior;
- side effects must be recorded honestly;
- audit history is product state, not just logs.

If an email was sent, a webhook delivered or a payment captured, RollbackKit should not pretend that
the whole operation can be undone. The action can be `partial`, `compensating` or `irreversible`
instead.

## When To Use It

Use RollbackKit for product actions where users or operators need confidence before and after a
mutation:

- admin tools;
- workspace and permission management;
- project or document archival;
- bulk imports;
- operations with customer-visible side effects;
- actions where audit history matters.

Do not use it as a database backup system, event sourcing framework, workflow engine or distributed
transaction coordinator.
