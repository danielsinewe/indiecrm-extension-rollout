# IndieCRM Connect release automation

This repository contains only the Chrome Web Store release controller and its
tests. It contains no IndieCRM application source, CRM data, extension ZIPs,
Google passwords, API keys or service-account private keys.

Standard public GitHub Actions runners run the controller without consuming the
private application repository's Actions allowance. Google authentication uses
short-lived GitHub workload identity, restricted to this repository's numeric
identity and the release workflow on `main`.

The original tested 1.2.1 ZIP and progress receipt live in a private Google Cloud
Storage bucket. Every upload verifies its pinned SHA-256 and manifest. The
controller preserves pending reviews, resumes acknowledged progress and stops
the scheduled watcher only after Google confirms 1.2.1 published at 100%.

The controller has no CRM or LinkedIn access and does not run lead searches or
modify any workspace data. Publication and installed-browser
verification remain separate steps.

`review-timer.yml` requests a scheduled check at minutes 08, 23, 38 and 53 UTC.
It dispatches `store.yml` with `review-timer-<parent run ID>` as its correlation.
The timer's first successful `schedule` event and the matching publisher result
must be verified separately from manual `workflow_dispatch` runs. The retired
`watch.yml` registration is disabled and removed.

Run tests with `node --test src/*.test.mjs`. There are no package dependencies.
