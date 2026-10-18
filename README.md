# IndieCRM Connect release automation

Google Cloud Scheduler calls the IAM-protected Cloud Run controller every
15 minutes, independently of Codex, the Mac and Google browser sessions.

[The real scheduled run is verified](docs/native-clock-verification.md):
at 15:13 Berlin on 18 October 2026 it returned HTTP 200, confirmed 1.2.2
published at 100%, saved matching private progress and paused itself.
The timer is intentionally PAUSED after this completed rollout.

The clock uses Google-managed identity and short-lived publisher tokens.
The service has zero idle instances, a single-instance maximum, request billing,
0.08 CPU, 256 MiB and a 180-second request limit. No paid plan or Actions budget
increase was added; this bounded workload uses Google Cloud free allowances.

The legacy GitHub review timer is disabled. store.yml remains available for
the existing on-demand CLI with its repository-scoped workload identity.

The original 1.2.1 and 1.2.2 ZIPs and per-version generation-protected receipts
remain in the private release bucket. Exact checksum, manifest, publisher and
item guards preserve reviews and prevent unchecked replacement or duplication.
DEFAULT_PUBLISH lets Google publish each approved submission automatically.

This repository contains release-controller code, tests and operational evidence.
It contains no private application source, extension ZIPs, CRM data, LinkedIn
credentials, Google passwords or service-account private keys. The controller
has no CRM access and does not change workspace permissions or lead data.

Run checks with node --test src/*.test.mjs. There are no package dependencies.
