# Friction log — building DECORDA on Vega

**What this is.** Six things that cost us real time while building and
qualifying a Vega TV app, written up so the next person does not have to
rediscover them. Each entry states what we tried, what we expected, what
actually happened, the workaround we used, and what would have prevented it.

**How to read the severity.** `Important` means it blocked a necessary
workflow until we found a workaround. `Nice-to-have` means it cost time or
confidence but had an obvious route around it. Nothing here was a blocker we
could not solve.

**Scope.** Everything was observed on one host configuration, listed below.
These are environment-specific observations, not claims about the platform in
general. Where a route did not work for us we say so without asserting it can
never work.

```text
macOS / Apple silicon
Vega CLI 1.3.4
Vega SDK 0.24.9914
Vega Virtual Device tv - aarch64
1920x1080
```

### FL-01 — No documented way to capture the Virtual Device framebuffer

- **Task attempted.** Capture full-resolution screenshots of our app running on
  the Vega Virtual Device, for use as evidence and as demo footage.
- **Steps taken.** Searched the CLI surface for a capture command; tried QMP
  `screendump` via the QEMU monitor socket; tried the guest `screenshooter`
  binary; finally found `screenrecord` on the emulator console after
  enumerating console facilities by hand.
- **Expected result.** A documented, first-class way to capture the device
  screen — the thing every TV developer needs for store assets and demos.
- **Actual result.** QMP `screendump` returned an all-black frame (the guest
  framebuffer is GL-accelerated). The guest `screenshooter` produced a
  zero-byte file. Neither failed loudly; both produced plausible-looking output
  that was simply wrong. The route that works — the emulator console's
  `screenrecord` facility — we found only by manual enumeration.
- **Severity.** Important.
- **Workaround used.** Open a TCP socket to the emulator console, authenticate
  with the token from the user-level auth-token file, then issue
  `screenrecord screenshot <output-directory>` for stills, or
  `screenrecord start --size 1920x1080 --fps 25 --bit-rate 16M <file.webm>` /
  `screenrecord stop` for motion. Both produce true full-resolution guest
  output; allow a couple of seconds before listing the output directory.
- **Actionable suggestion.** Publish one short page — "capturing and recording
  a Vega Virtual Device" — naming the console `screenrecord` facility as the
  supported route, with the auth-token step spelled out. Better still, surface
  it as `vega virtual-device screenshot` / `record` so developers never touch
  the console directly. Failing that, make `screendump` and `screenshooter`
  fail loudly on this target rather than returning black or empty output.

### FL-02 — Scripted input: the working path is undocumented and the key vocabulary is unknown

- **Task attempted.** Drive our app through its own on-screen controls
  programmatically, so a demo sequence is reproducible rather than
  hand-performed.
- **Steps taken.** Tried the emulator console's `event send`; tried QMP
  `send-key`; then found the guest-side `inputd-cli` binary by listing the
  guest `PATH`, and read its `--help`.
- **Expected result.** A documented input-injection path for the Virtual
  Device.
- **Actual result.** `event send` was accepted by the console but never reached
  the compositor — a silent no-op. QMP `send-key` was ignored. `inputd-cli`
  does work and is the right tool, but we found it by exploration. Its help
  lists subcommands (`button_press`, `touch`, `swipe`, `gesture_swipe_*`,
  `series`, `send_text`) but **not the accepted button-code vocabulary**, so an
  unrecognised key name is indistinguishable from a key that did nothing. We
  established the working directional and select codes empirically, by hashing
  captured frames before and after each injection to see whether anything
  actually changed. A related rough edge: `inputd-cli list_devices` reported
  "No input devices found" while injection was demonstrably working.
- **Severity.** Important.
- **Workaround used.** `vega device run-cmd --command 'inputd-cli button_press
  <CODE>'`; several statements can be joined with `;` in one invocation
  (a small batch took roughly 1.5 s). Verify each step by comparing captured
  frames rather than trusting the injection.
- **Actionable suggestion.** Document `inputd-cli` as the supported input path
  and publish the accepted button-code list. Make an unrecognised code return a
  non-zero exit with a clear message instead of silently injecting nothing, and
  make `list_devices` agree with what injection can actually reach.

### FL-03 — Focus can be lost across a state mutation

- **Task attempted.** Navigate with the D-pad through a multi-step flow in
  which each step changes application state.
- **Steps taken.** Moved focus with `button_press`, activated a control that
  mutates state, then continued navigating with further directional presses.
- **Expected result.** Focus to remain on a predictable element after a state
  change, as it would with a TV remote in a viewer's hand.
- **Actual result.** After some mutations, focus was no longer where the
  sequence assumed. A scripted run that had been correct up to that point then
  acted on the wrong control, and the failure was silent — the presses were
  injected successfully, they simply landed somewhere else.
- **Severity.** Important.
- **Workaround used.** Around any mutating control, activate by coordinate
  (`inputd-cli touch <x> <y> short`) rather than relying on a counted D-pad
  path, and re-verify the resulting frame before continuing.
- **Actionable suggestion.** Document the expected focus behaviour across state
  changes for React Native for Vega, including where focus lands after a list
  or stage re-render, and offer a supported way to query the currently focused
  element so automation can re-synchronise instead of guessing.

### FL-04 — Directional traversal moves by control, not by row

- **Task attempted.** Return D-pad focus to a specific option row after
  visiting the rows below it.
- **Steps taken.** Counted the number of downward presses used to descend, then
  issued the same number of upward presses to return.
- **Expected result.** Symmetric traversal — N down then N up returns to the
  starting row.
- **Actual result.** Focus traverses individual focusable controls, and rows in
  our layout contain more than one control, so the counted return landed on a
  different row. The resulting activation hit the wrong option. Nothing errored.
- **Severity.** Nice-to-have.
- **Workaround used.** Do not count presses across rows with multiple controls;
  activate the intended control by coordinate, or re-anchor by over-pressing
  toward a known boundary before descending.
- **Actionable suggestion.** Note explicitly in the TV navigation guidance that
  directional traversal is per focusable control rather than per visual row,
  with a short example of a multi-control row. It is obvious in hindsight and
  costly to discover by experiment.

### FL-06 — `vega --version` prints nothing

- **Task attempted.** Confirm the installed CLI version before starting a
  build.
- **Steps taken.** Ran `vega --version`.
- **Expected result.** A version string.
- **Actual result.** Empty output, no error, success exit. The version is
  available from `vega -v` (which prints both the CLI and the active SDK
  version) and from `vega version sdk`.
- **Severity.** Nice-to-have.
- **Workaround used.** Use `vega -v`.
- **Actionable suggestion.** Make `--version` an alias of `-v`. It is the first
  thing most developers type, and silent empty output reads as a broken
  install.

### FL-07 — Generated package metadata needs manual reconciliation before release

- **Task attempted.** Audit `manifest.toml` against the packaging tool's field
  documentation before freezing a release package.
- **Steps taken.** Built the Release package, then read every manifest field
  against the documented meaning of that field.
- **Expected result.** Generated package metadata that is release-appropriate,
  or at least valid, by default.
- **Actual result.** Two fields needed reconciliation. `title` was still the
  generator's own sentence describing the project rather than a user-facing
  display name. `build-number` was absent from the generated manifest, so the
  packaged value defaulted to `0` — a value the packaging tool itself warns
  about, since it documents the field as a monotonically increasing integer
  from 1 upward. Neither blocked the build (manifest validation reported zero
  errors across all three architectures), so both are easy to ship without
  noticing.
- **Severity.** Nice-to-have.
- **Workaround used.** Set `title` to the app's display name, matching
  `app.json` and the package configuration, and set an explicit
  `build-number = 1`. Zero behaviour change; both are display and update
  metadata.
- **Actionable suggestion.** Have the project generator emit `build-number = 1`
  and use the app display name as `title`, so a freshly generated project
  produces metadata the toolchain does not warn about.

### Deliberately not filed

- **Release build and packaging** — `vega vtbuild` produced armv7, aarch64 and
  x86_64 packages first time with zero manifest validation errors. Apart from
  the metadata defaults in FL-07, no friction to report.
- **`vega run-app` install and launch** — worked as documented.
- **React Native for Vega development ergonomics** — existing React knowledge
  transferred directly; nothing to report beyond the focus items above.
