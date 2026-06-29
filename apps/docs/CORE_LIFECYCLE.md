# Core Lifecycle

RollbackKit models dangerous product operations as explicit product actions.

A product action has five lifecycle phases:

```text
preview -> execute -> audit -> undo -> expire
```

Not every action is undoable. RollbackKit must be honest about reversibility.

## Lifecycle phases

### 1. Preview

Preview is a read-oriented phase.

Its goal is to explain what will happen before the application mutates state.

Preview should answer:

- what target will be affected;
- what records may change;
- whether the action is reversible;
- how long undo will be available;
- what side effects may happen;
- what warnings should be shown to the user.

Preview must not mutate product state.

Preview output should be suitable for UI.

### 2. Execute

Execute is the mutation phase.

Its goal is to perform the product action safely and record enough information for audit and possible undo.

Execute should:

- validate input;
- check permissions;
- resolve actor and tenant;
- create an action run record;
- create snapshots when needed;
- perform the product mutation;
- record side effects;
- store the result;
- mark the action as completed or failed.

Execute should be idempotent when an idempotency key is provided.

### 3. Audit

Audit is not a separate API call. It is a guarantee of the lifecycle.

Every executed action should leave a durable record containing:

- action name;
- actor id;
- actor type;
- tenant id;
- target type;
- target id;
- input;
- status;
- reversibility type;
- timestamps;
- undo availability;
- result;
- error, if any;
- metadata.

Audit history should not be silently mutable through normal application APIs.

### 4. Undo

Undo is the reverse or compensating phase.

Its goal is to safely restore state when possible.

Undo should:

- check that the action exists;
- check that the action completed successfully;
- check that undo has not expired;
- check that the action has not already been undone;
- check permissions for the undo actor;
- check conflicts;
- read required snapshots;
- execute the undo handler;
- record undo status and timestamps.

Undo must fail safely.

If RollbackKit cannot prove that undo is safe, it should refuse to undo.

### 5. Expire

Expire makes an action unavailable for undo after its undo window ends.

Expire should:

- preserve audit history;
- prevent future undo;
- optionally allow snapshot pruning later.

Expiration is not the same as deleting history.

## Reversibility model

### Fully reversible

The action can be safely undone.

Example:

- change member role from `viewer` to `admin`;
- archive a project using soft delete;
- rename a workspace.

### Partially reversible

The main product state can be restored, but some side effects cannot be undone.

Example:

- archive a document and send an email notification;
- undo can restore the document;
- undo cannot unsend the email.

### Compensating

The original operation cannot be literally undone, but a compensating action can be created.

Example:

- issue an invoice;
- later issue a correction invoice.

### Irreversible

The operation cannot be safely undone.

Example:

- hard delete without snapshot;
- external payment capture;
- webhook delivery without compensation;
- physical shipment.

## Fail-safe principle

RollbackKit must prefer refusing unsafe undo over performing risky rollback.

Unsafe conditions include:

- target no longer exists;
- target state differs from expected state;
- action already undone;
- undo window expired;
- required snapshot missing;
- side effect is irreversible;
- permission check fails;
- concurrent undo attempt detected.
