# ADR 0001: Library-first monorepo

## Status

Accepted

## Context

RollbackKit is intended to become an open-source TypeScript framework.

The project will include multiple packages and apps:

- core lifecycle package;
- PostgreSQL adapter;
- CLI;
- demo application;
- documentation site;
- future React package;
- future Next.js helpers;
- future testkit.

A single-package repository would be simpler initially, but would make boundaries harder to enforce later.

## Decision

Use a library-first monorepo.

Initial structure:

```text
apps/
  demo-next/
  docs/

packages/
  core/
  postgres/
  cli/
```

The repository uses:

- pnpm workspaces;
- Turborepo;
- TypeScript;
- Vitest;
- Biome;
- Changesets.

## Consequences

Positive:

- package boundaries are explicit;
- internal packages can depend on each other through workspace protocol;
- release flow can be managed with Changesets;
- demo and docs can evolve with the framework;
- future packages can be added without restructuring the repository.

Negative:

- initial tooling is more complex;
- CI must understand package graph;
- dependency management needs discipline;
- changesets introduce pending release files.

## Notes

The monorepo should not become an excuse to create empty packages too early.

Only packages needed for the current development phase should exist.
