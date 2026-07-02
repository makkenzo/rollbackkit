# Security Baseline

RollbackKit handles dangerous product actions, so its security model must be explicit.

This page documents the v0 baseline. It is not a complete security audit, but it defines the
minimum posture expected from RollbackKit integrations before production use.

## Responsibility Boundary

RollbackKit provides lifecycle contracts, storage hooks, audit history, snapshots, undo locking and
fail-safe undo behavior.

The application still owns:

- authentication;
- session handling;
- actor resolution;
- tenant resolution;
- authorization policy;
- data classification;
- snapshot redaction;
- network and deployment security.

RollbackKit does not replace application-level authorization. Treat `actor`, `tenantId`, `input`,
`target` and `metadata` as trusted only after your server has derived or validated them.

## Core Principles

### Actor Identity Is Required

Every preview, execute and undo request requires an actor.

In production, do not accept `actor` directly from a client payload. Derive it from the authenticated
server session, API token, service account or background job identity. If the actor is spoofable,
the audit trail is not trustworthy.

### Tenant Isolation Is Server-Side

Pass `tenantId` for multi-tenant applications and verify that it matches the input target.

Tenant checks must happen on the server before reads, writes, snapshots and undo. UI filters are not
a security boundary. If a request can supply `workspaceId`, `projectId`, `memberId` or another tenant
scoped identifier, the action must reject mismatches instead of querying across tenants.

### Permission Checks Run Per Phase

Use action-level authorization for all phases that touch protected data:

- `preview`, because it can reveal impact and target metadata;
- `execute`, because it mutates product state;
- `undo`, because it can restore privileged state or recreate access.

Undo permission is not automatically the same as execute permission. Decide whether the undo actor
must be the original actor, a workspace admin, a support operator, or a service account.

### Snapshots Are Sensitive

Snapshots can contain deleted records, previous permissions, email addresses, ownership links and
other data that the current UI may no longer show.

Store only the minimum data required for undo. Redact or omit:

- passwords;
- API keys;
- access tokens;
- refresh tokens;
- session identifiers;
- payment secrets;
- private keys;
- unnecessary customer data.

Snapshots must stay server-side by default. Do not expose raw snapshots to frontend components,
logs, analytics, support tools or public APIs unless they are explicitly redacted and authorized.

### Audit History Is Append-Or-Update Lifecycle Data

Action history is a security record. Normal product APIs should not expose arbitrary mutation of
`rollbackkit_action_runs`, snapshots, side effects or conflicts.

The storage adapter updates action runs through lifecycle transitions such as `running`,
`completed`, `failed`, `undo_running`, `undone` and `undo_failed`. If your application needs admin or
support tooling around audit records, expose narrow, authorized operations rather than raw table
writes.

### Unsafe Undo Must Fail Closed

Undo must prefer refusal over risky rollback.

Before undoing, verify that:

- the action exists;
- the action completed successfully;
- the undo window is still open;
- the action has not already been undone;
- the requested `tenantId` matches the action run tenant;
- the undo actor is authorized;
- required snapshots exist;
- the current target state still matches the expected state;
- irreversible side effects are not being silently reversed.

When a conflict is detected, record the reason and stop. RollbackKit refuses undo after conflict
records are created, even if the conflict check does not throw. Do not partially restore state after
a failed conflict check.

## Lightweight Threat Model

### Actor Spoofing

Risk: a caller supplies another user's actor id and creates misleading history or performs undo as
someone else.

Baseline:

- derive actors from server-side auth;
- never trust client-provided actor ids;
- keep actor id, actor type and display metadata in action history.

### Tenant Isolation Bypass

Risk: an action runs against a target in a different workspace, organization or customer account.

Baseline:

- pass `tenantId` for tenant-scoped actions;
- validate target ownership before preview, execute and undo;
- scope history queries by tenant before showing them to users;
- reject requests where `tenantId` and input ownership disagree.

### Permission Bypass

Risk: preview leaks protected data, execute mutates data without permission, or undo restores access
after permissions changed.

Baseline:

- define explicit authorization policy per action;
- run permission checks before preview, execute and undo;
- treat undo as a privileged operation with its own permission decision.

### Snapshot Leakage

Risk: snapshots expose deleted records, prior permissions, emails or sensitive customer data.

Baseline:

- store minimal undo state;
- redact secrets before calling `snapshots.save`;
- keep snapshot reads on the server;
- expose only derived, authorized summaries to UI.

### Audit History Tampering

Risk: action runs, conflicts or snapshots are modified outside the lifecycle and the audit trail can
no longer be trusted.

Baseline:

- keep RollbackKit tables behind server-side storage adapters;
- do not add ordinary product endpoints that mutate audit rows directly;
- restrict database write access for operational users;
- prefer narrow lifecycle operations over raw admin writes.

### Unsafe Undo After Concurrent Changes

Risk: undo restores stale data after another actor changed the same target.

Baseline:

- save the state required to prove undo safety;
- implement `checkConflicts` for actions where current state matters;
- record conflicts before throwing;
- refuse undo when the current state no longer matches the expected state.

### Secrets In Snapshots Or Metadata

Risk: secrets are stored in durable JSON columns, logs, support exports or UI history.

Baseline:

- never store tokens, passwords, API keys or private keys in snapshots;
- treat action `metadata`, side-effect payloads and error details as persistent records;
- redact before persistence, not only before rendering.

### Client Bundle Leakage

Risk: database URLs, service credentials or server-only helpers end up in frontend JavaScript.

Baseline:

- keep database clients, RollbackKit storage and action definitions in server-only modules;
- do not use client-exposed environment variable names for secrets;
- keep browser components limited to invoking authorized server endpoints or server actions.

### SQL Injection

Risk: action input is interpolated into SQL and changes query semantics.

Baseline:

- validate input at runtime;
- use parameterized queries through your database client;
- avoid constructing SQL from unchecked user strings.

## Demo App Posture

`apps/demo-next` demonstrates server-side RollbackKit integration, not production authentication.

The demo currently:

- keeps database access and action definitions under `lib/server`;
- imports `server-only` in server modules;
- validates action input before database access;
- checks that demo `tenantId` matches `workspaceId`;
- stores snapshots server-side;
- records conflicts when undo would be unsafe.

The demo also uses a fixed actor and tenant from `getDemoRequestContext()`. That is correct for a
local demo only. A production Next.js application must replace that function with real session,
tenant and permission resolution.

## Operational Baseline

Before production use:

- run RollbackKit on the server, not from browser-only code;
- store database URLs and credentials in server-side environment variables;
- apply RollbackKit PostgreSQL migrations before serving traffic;
- use least-privilege database users for application runtime where possible;
- configure security headers and CSP at the application or hosting layer;
- keep private vulnerability reporting available for the repository;
- use branch protection and required CI checks for release branches;
- use least-privilege GitHub Actions permissions;
- enable dependency update monitoring;
- use npm provenance for published packages when release automation is in place.

## Production Checklist

- [ ] Actor is derived from authenticated server context.
- [ ] Tenant id is present for tenant-scoped actions.
- [ ] Target ownership is checked before preview, execute and undo.
- [ ] Authorization policy is defined per action and phase.
- [ ] Undo permission is explicitly decided.
- [ ] Snapshots contain only required undo state.
- [ ] Snapshots and metadata are redacted before persistence.
- [ ] Raw snapshots are not exposed to the frontend.
- [ ] Action history endpoints are read-only or narrowly controlled.
- [ ] Conflict checks exist for stale-state-sensitive undo flows.
- [ ] Irreversible side effects are declared honestly.
- [ ] Database credentials are never client-exposed.

## Related Pages

- [Core Lifecycle](./CORE_LIFECYCLE.md)
- [Architecture](./ARCHITECTURE.md)
- [PostgreSQL Setup](./POSTGRESQL_SETUP.md)
- [Conflict Detection](./recipes/CONFLICT_DETECTION.md)
