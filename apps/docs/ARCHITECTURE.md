# Architecture

RollbackKit is an open-source TypeScript framework for building reversible product actions with preview, audit and undo.

The core idea:

> Dangerous product operations should be modeled as explicit lifecycle-managed actions.

RollbackKit is not a database backup tool, workflow engine, event sourcing framework, or distributed transaction system.

It provides a structured layer for product-level safety.

## Design goals

### Explicit over magic

RollbackKit does not infer how to undo arbitrary mutations.

Developers explicitly define:

- preview;
- execute;
- undo;
- snapshots;
- conflict checks;
- reversibility;
- side effects.

### Safety-first

Unsafe undo must fail.

The framework should not perform rollback when required state is missing, expired, conflicting, or unverifiable.

### Storage-agnostic core

The core package owns lifecycle contracts but does not own a database implementation.

Persistence is implemented through storage adapters.

The first official storage adapter is PostgreSQL.

### Framework first

The first version is an open-source framework.

A hosted dashboard or paid layer may be designed later, but must not be required for the open-source core to be useful.

## Core entities

### Action definition

An action definition describes a product operation.

Conceptual fields:

- name;
- input schema or input validator;
- target resolver;
- permission hooks;
- preview handler;
- execute handler;
- undo handler;
- reversibility type;
- undo window;
- metadata;
- side effects declaration.

### Action run

An action run is one execution of an action.

Conceptual fields:

- id;
- action name;
- actor id;
- actor type;
- tenant id;
- target type;
- target id;
- input;
- status;
- reversibility;
- created at;
- executed at;
- undo expires at;
- undone at;
- undone by;
- result;
- error;
- metadata.

### Snapshot

A snapshot stores state required for undo.

Examples:

- previous member role;
- deleted project data;
- previous document state;
- list of records created by bulk import;
- previous permissions.

Snapshots must not automatically be exposed to the frontend.

### Side effect

A side effect records an external or non-local effect of an action.

Examples:

- email sent;
- webhook delivered;
- notification created;
- file removed;
- billing provider updated.

Side effects can be:

- reversible;
- partially reversible;
- compensating;
- irreversible.

### Conflict

A conflict explains why undo is unsafe.

Examples:

- expected state does not match actual state;
- target was changed after the original action;
- target was deleted;
- required snapshot is missing;
- action was already undone.

## High-level flow

### Preview flow

```text
user request
  -> validate input
  -> check permission
  -> resolve target
  -> call preview handler
  -> return preview result
```

Preview must not mutate product state.

### Execute flow

```text
user request
  -> validate input
  -> check permission
  -> resolve target
  -> create action run
  -> create snapshots
  -> execute mutation
  -> record side effects
  -> mark completed
  -> return result
```

Execute is idempotent when an idempotency key is provided. The idempotency scope
is action name, actor type/id, tenant and key; reusing the same key with
different input is rejected.

### Undo flow

```text
undo request
  -> load action run
  -> check permission
  -> acquire lock
  -> check status
  -> check undo window
  -> check conflicts
  -> load snapshots
  -> execute undo handler
  -> mark undone
  -> return undo result
```

Undo must be protected from double execution.

## Storage adapter

The core package talks to persistence through a storage adapter.

The storage adapter should support:

- create action run;
- update action run status;
- get action run by id;
- save snapshot;
- read snapshots by action id;
- record side effect;
- record conflict;
- query action history;
- enforce idempotency;
- run transactional execution sections;
- run locked undo section.

The exact TypeScript interface will be defined in `@rollbackkit/core`.

For setup instructions, migration commands and local development examples, see [PostgreSQL Setup](./POSTGRESQL_SETUP.md).

## MVP scope

MVP includes:

- action registry;
- preview;
- execute;
- undo;
- snapshots;
- undo expiration;
- action history;
- basic conflict prevention;
- PostgreSQL adapter;
- CLI migration command;
- demo app.

MVP does not include:

- hosted dashboard;
- visual workflow builder;
- event sourcing;
- distributed transactions;
- generic job queue;
- multi-language SDKs;
- many database adapters;
- AI features.

For demo application setup and product direction, see [Demo App](./DEMO_APP.md).
