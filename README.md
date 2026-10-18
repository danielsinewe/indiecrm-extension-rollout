# IndieCRM Connect release automation

This repository contains only the Chrome Web Store release controller and its
tests. It contains no IndieCRM application source, CRM data, extension ZIPs,
Google passwords, API keys or service-account private keys.

Standard public GitHub Actions runners run the controller without consuming the
private application repository's Actions allowance. Google authentication uses
short-lived GitHub workload identity, restricted to this repository's numeric
identity and the release workflow on `main`.

The original tested 1.2.1 and 1.2.2 ZIPs and separate progress receipts live in a
private Google Cloud Storage bucket. Every upload verifies its pinned SHA-256
and manifest. The controller preserves the pending 1.2.1 review, then submits the
exact 1.2.2 ZIP when Google permits it. An approved staged 1.2.1 is published
before advancing. Submissions use DEFAULT_PUBLISH so Google publishes each
approved release automatically.

The hosted watcher checks every 15 minutes, resumes acknowledged progress and
stops only after Google confirms 1.2.2 published at 100%. GitHub may delay timer
events; configuration and a manual commissioning run do not prove a scheduled
run occurred. No Mac, Codex session or browser login is needed. Unknown upload
outcomes, rejection and policy warnings stop writes for inspection. Existing
audience, rollout and identity stay unchanged.

The controller has no CRM or LinkedIn access and does not run lead searches or
modify any workspace data. Publication and installed-browser
verification remain separate steps.

Run tests with `node --test src/*.test.mjs`. There are no package dependencies.
