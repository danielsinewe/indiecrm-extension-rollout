# IndieCRM Connect release automation

The current target is **1.3.2**, pinned to the exact tested GitHub release ZIP
with SHA-256 `1196cd86d3d30e1ea39f40a07fd010a0d209235eae99985ec2487ce83a904fb8`.
The existing GitHub `review-timer.yml` workflow checks every 15 minutes and
dispatches the keyless publisher on free public runners. It waits for pending
reviews, submits the target once the preceding review clears, and disables only
its own timer after fresh Google proof that 1.3.2 is published at 100%.
It runs independently of Codex, the Mac and Google browser sessions.

The artifact is staged in the existing private Google Storage bucket with
generation-zero creation and checksum readback. The signed single-asset download
URL is removed from GitHub secrets after staging. Application code and ZIP bytes
are never committed to this public repository. Conditional per-release receipts
preserve acknowledged uploads across restarts. Approved pinned predecessors can
be published without another upload; unknown revisions remain held.

Google's native Cloud Scheduler and IAM-protected Cloud Run controller previously
completed the 1.2.2 rollout. They remain the historical native deployment; updating
those resources currently requires renewal of the Google admin CLI session.
The existing GitHub timer provides the current cloud follow-up without that
admin session. No new service or paid plan is needed.

[The real scheduled run is verified](docs/native-clock-verification.md):
at 15:13 Berlin on 18 October 2026 it returned HTTP 200, confirmed 1.2.2
published at 100%, saved matching private progress and paused itself.
The native timer paused itself after this completed rollout.

The clock uses Google-managed identity and short-lived publisher tokens.
The service has zero idle instances, a single-instance maximum, request billing,
0.08 CPU, 256 MiB and a 180-second request limit. No paid plan or Actions budget
increase was added; this bounded workload uses Google Cloud free allowances.

`store.yml` handles the current timer and on-demand CLI with its
repository-scoped workload identity. The native controller image must be updated
and its paused timer resumed before it can own the new release instead.

The original 1.2.1 and 1.2.2 ZIPs and per-version generation-protected receipts
remain in the private release bucket. Exact checksum, manifest, publisher and
item guards preserve reviews and prevent unchecked replacement or duplication.
DEFAULT_PUBLISH lets Google publish each approved submission automatically.

This repository contains release-controller code, tests and operational evidence.
It contains no private application source, extension ZIPs, CRM data, LinkedIn
credentials, Google passwords or service-account private keys. The controller
has no CRM access and does not change workspace permissions or lead data.

Run checks with node --test src/*.test.mjs. There are no package dependencies.
