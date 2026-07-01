# Security Policy

RollbackKit is in early v0. Report security issues privately and avoid publishing exploit details
before maintainers have had time to investigate.

For the product-level security model around actors, tenants, snapshots, audit history and undo, see
[Security Baseline](./apps/docs/SECURITY.md).

## Supported Versions

Only the current `master` branch and the latest published v0 package line are supported.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not
available, open a minimal public issue asking for a private security contact and do not include
exploit details, credentials, customer data or proof-of-concept payloads.

Please include:

- affected package or app;
- affected version or commit;
- impact summary;
- reproduction steps;
- whether the issue is already public.

## Scope

In scope:

- authorization bypasses in RollbackKit lifecycle flows;
- unsafe undo behavior that can corrupt product data;
- leakage of snapshots, audit records or database credentials;
- migration behavior that can destroy or expose application data.

Out of scope:

- vulnerabilities that require write access to the repository;
- reports only about missing security headers in local demo development;
- dependency issues without an exploitable RollbackKit path.
