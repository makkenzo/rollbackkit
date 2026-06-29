# ADR 0002: Core is storage-agnostic

## Status

Accepted

## Context

RollbackKit needs persistent storage for action history, snapshots, side effects, conflicts, idempotency, and undo locks.

PostgreSQL is the first official storage target because it provides:

- transactions;
- JSONB;
- indexes;
- advisory locks;
- mature operational model;
- broad SaaS adoption.

However, putting PostgreSQL logic directly into the core package would make RollbackKit harder to test, harder to reuse, and harder to extend.

## Decision

`@rollbackkit/core` must be storage-agnostic.

The core package defines lifecycle contracts and talks to storage through an adapter interface.

`@rollbackkit/postgres` implements the first official persistent storage adapter.

## Consequences

Positive:

- core stays small and portable;
- lifecycle logic can be tested without PostgreSQL;
- PostgreSQL-specific code stays isolated;
- future adapters remain possible;
- demo app can validate the public adapter boundary.

Negative:

- adapter interface must be designed carefully;
- some lifecycle operations need transaction semantics;
- safe undo requires storage capabilities such as locks or equivalent mechanisms.

## Rules

`@rollbackkit/core` must not import:

- `pg`;
- database clients;
- Node.js-only APIs;
- ORM libraries;
- framework-specific request or response types.

`@rollbackkit/postgres` may import:

- `@rollbackkit/core`;
- `pg`;
- Node.js types.

The core lifecycle should be testable with an in-memory adapter.
