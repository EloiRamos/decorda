# Decision runtime

Decorda has two selectable decision-session compositions with the same bounded application semantics.

## Local fixture mode

Local fixture mode is the default startup mode. It uses deterministic synthetic inputs and an in-memory store. It performs zero network requests. State survives leaving and reopening inside the same application process, but an application-process restart resets it. This mode is local verification, not live DynamoDB qualification.

The user must choose **Open shared decision** first. A missing decision is not created automatically; **Start new fixture decision** performs the explicit conditional create.

## Durable HTTPS mode

An authorized launcher may set `globalThis.__DECORDA_RUNTIME_CONFIG__` before the App component is evaluated:

```js
globalThis.__DECORDA_RUNTIME_CONFIG__ = {
  mode: 'durable_https',
  endpoint: 'https://replace-at-launch.example/decision',
  expiresAtEpochSeconds: 0, // replace with the authorized bounded session expiry
  clientId: 'bounded-public-client-id',
};
```

The configuration is consumed through the real App composition path. The endpoint must use HTTPS. Missing or invalid durable configuration is shown as unavailable and never falls back to memory. Keep actual endpoint values outside tracked files and logs. TV configuration contains no AWS credentials, table names, account identifiers, or raw service errors.

The HTTPS route accepts only bounded decision commands. The server derives mutations through application/domain transitions. It does not accept arbitrary snapshots. The server-side composition owns the existing DynamoDB adapter and constructs its SDK client with `maxAttempts: 1`; application code does not automatically retry mutations.

## Bounded session behavior

- Canonical refresh checks use a fixed 2000 ms interval while the decision is active and foregrounded.
- At most one refresh is in flight. Mutation, reopen, background state, leave, expiry, error, and the automatic-read ceiling suppress or stop checks.
- The client reserves command/read capacity by capping automatic checks below the persistence contract's 300-poll ceiling.
- Successful, replayed, stale, and conflicting commands hydrate the returned canonical state without a redundant read.
- Decision-store CAS version and confirmed-plan version are displayed separately.

## Offline backend preparation

From an existing reviewed installation, run:

```sh
node scripts/package-decision-backend.mjs
```

The script uses the installed TypeScript compiler and Node built-ins, writes only ignored `.tmp/decision-backend/` output, loads the produced server entry with an injected test client, and exits. It does not install, fetch, deploy, provision, or modify root configuration.

Live Lambda/DynamoDB execution, real endpoint injection, native Vega/VVD capture and Release packaging are separate, explicitly authorized operations — not part of ordinary development. No continuously hosted judging endpoint is promised.

## Accessibility observations

The source uses readable state text, accessible button names/roles/states, polite/assertive status announcements where supported, and non-color focus/state cues. WCAG relative-luminance measurements for the changed palette are: white/card 15.68:1, secondary text/screen 13.47:1, blue heading/screen 12.25:1, warning/card 10.88:1, confirmed green/confirmed card 7.17:1, card boundary/card 4.16:1, focus border/focused control 4.84:1, and white/enabled control 10.23:1. Disabled controls no longer apply whole-control opacity; they retain the 15.68:1 white/card text contrast, 4.16:1 boundary contrast, and add a visible `UNAVAILABLE` cue.

The native Release qualification has since been carried out, on a Vega Virtual Device at 1920×1080 running the Release package. It established the layout-fit and scroll-origin results recorded in `VERIFICATION.md`; the contrast figures above are computed from the shipped palette. Platform assistive-technology announcement behavior and human ten-foot legibility at 1920×1080 were not independently verified, and no accessibility certification is claimed.
