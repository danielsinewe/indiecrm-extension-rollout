# IndieCRM Connect release automation

The current target is **1.3.3**, pinned to the exact tested GitHub release ZIP
with SHA-256 `d4184019682d5c1ee6d80910ad4d64faf2f2778808b0ff6429536d46b239f354`.
The existing GitHub `review-timer.yml` workflow uses the `chrome-review-delay`
environment's 15-minute wait timer, then dispatches the keyless publisher and
exactly one successor check. GitHub holds the delay before allocating a runner;
it needs no Mac, Codex, cron event, Google browser session or extra credential.
The commissioned generation is pinned in `CHROME_REVIEW_CLOCK_ID`; disabling
publication or changing that generation stops stale queued checks. It waits for pending
reviews, submits the target once the preceding review clears, and disables only
its own timer after fresh Google proof that 1.3.3 is published at 100%.
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

## Completing the local Store handoff

The release queue targets 1.3.3 and submits with DEFAULT_PUBLISH, so Google publishes it on approval. A staged approved predecessor is completed before the exact target is submitted. Only fresh Google proof that the target is PUBLISHED at 100% stops the release timer. No naturally scheduled GitHub run appeared, so the current clock uses GitHub's environment wait timer and a guarded successor dispatch instead. Commissioning and actual successor execution are recorded separately; no cron execution is claimed.

Changing a local unpacked installation to the Store installation is a separate browser operation. Daniel explicitly requested installing the current public Store version now, even while it is 1.2.3, so Chrome can update it to 1.3.3 independently. Replace only the matching development installation through the normal Store flow, re-pair the same CRM scope if needed, and verify normal installation source plus the Google update URL before deleting the retained unpacked fallback. Do not infer a Store installation from the shared extension ID or Store page button. The available browser tools cannot operate the native installation confirmation, and macOS accessibility control is unavailable; that remaining browser action is separate from cloud publishing and the hosted LinkedIn worker.

GitHub documents [environment wait timers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer)
and [workflow dispatch from the repository token](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
