# Actual scheduled run verified

Google Cloud Scheduler fired naturally at **15:13 Berlin on 18 October 2026**
(2026-10-18T13:13:00.866748Z). Cloud Run returned **HTTP 200** and saved matching
execution metadata in the private release receipt.

- Latest version: **1.2.2 PUBLISHED at 100%**; 1.2.1 was published earlier.
- Runtime revision: indiecrm-chrome-review-00003-cr9.
- The runtime service account paused the timer automatically after completion.
- No forced Scheduler run was used for this proof.
- [Source validation: 36 passing tests](https://github.com/danielsinewe/indiecrm-extension-rollout/actions/runs/39130262609).
- [Machine-readable proof](native-clock-verification.json).

The Google execution log records AttemptStarted and AttemptFinished with HTTP
200, and the Cloud Run completion log matches the receipt timestamp. The
scheduler is now intentionally PAUSED because this rollout is complete.

GitHub cron emitted no scheduled events and was retired. Initial native calls
exposed Google's short job-name header; the corrected guard accepts only the
exact job or equivalent canonical identities behind dedicated invoker IAM.
Earlier failed attempts remain in execution logs.

The clock and controller are hosted entirely by Google. Credentials are minted
at execution time; no local callback, browser login or long-lived private key is
needed. Original artifacts and conditional-generation progress remain private.
No CRM or LinkedIn credentials or workspace data were accessed.

No paid plan was added. The zero-idle, single-instance service has 0.08 CPU,
256 MiB and a 180-second request limit. The single job and bounded polling use
the [Scheduler](https://cloud.google.com/scheduler/pricing) and
[Cloud Run](https://cloud.google.com/run/pricing) free allowances; quotas apply.

For another pinned release, deploy its tested controller image and resume the
existing native job. Its configured cadence is 13, 28, 43 and 58 minutes UTC.

Private immutable proof:
gs://indiec-507107-chrome-releases/releases/1.2.2/native-timer-verification-20261018.json.
