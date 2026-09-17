# Running DECORDA natively on a Vega Virtual Device

This document exists because "it runs on a TV" is a claim that should be
checkable. It is the exact procedure used to build the DECORDA Release package,
run it on a local Vega Virtual Device at 1920x1080, drive the real product with
real input, and capture native framebuffer evidence — including the routes that
do **not** work in this environment, so the procedure does not have to be
rediscovered.

It requires **no AWS access**. Do not authenticate AWS in order to use it.

Fact labels used throughout:

- `OBSERVED` — executed successfully during release qualification; safe to reuse
  as written.
- `NOT PRESERVED` — the exact syntax was not retained; recover it rather than
  guessing.

## 1. Observed environment

Everything below was observed on macOS on Apple silicon. The load-bearing facts
are the toolchain versions and the device, not the host:

| Item | Observed value |
|---|---|
| Node / npm | v20.20.0 / 10.8.2 |
| Vega CLI | `1.3.4` |
| Active Vega SDK | `0.24.9914` |
| Vega OS target | `1.2` (min `1.2`) |
| Virtual device | `VirtualDevice : tv - aarch64` |
| Logical canvas | 1920 x 1080 |
| Build mode | Release |
| Build result | PASS (`vega vtbuild` exit 0, manifest validation 0 errors) |
| Session mode | Local fixture, process-lifetime persistence, zero network requests |
| AWS resources used | 0 for the native path |

## 2. Preconditions

- Vega CLI on `PATH`:

  ```bash
  export PATH="$HOME/vega/bin:$PATH"
  ```

- An active Vega SDK. The observed procedure used exactly `0.24.9914`.
- The Release package must be the one you built from this tree. A package hash
  is only meaningful against the build that produced it.
- Host permissions: macOS **Screen Recording** and **Accessibility** were **not**
  granted to the capturing process. This is not a blocker — input is injected
  inside the guest and capture is taken inside the guest (sections 7 and 8).
- No AWS credentials required.

## 3. Build the Release package

```bash
npm run build:release
```

`OBSERVED` — expands to `react-native build-vega --build-type Release`; result
PASS. Release packages land under gitignored `build/` and are not committed. The
aarch64 package is the one that runs on the `tv - aarch64` virtual device:

```text
build/private/kepler/@amazon-devices/decorda/undefined/vega/aarch64/Release/@amazon-devices/decorda_aarch64.vpkg
```

## 4. Start the local Vega Virtual Device

```bash
vega virtual-device start --gui --display-res "1920,1080"
```

`OBSERVED`. The same command with `--timeout 300` was also observed, for a
longer boot wait. `vega virtual-device status` and `vega virtual-device list`
were observed working for verification. The console prints readiness when the
device is up.

Under the hood the virtual device is a QEMU guest. An emulator console is
reachable on TCP `127.0.0.1:5554` — its auth token lives at
`~/.emulator_console_auth_token`; read it at runtime and never copy its value
anywhere. A QMP unix socket exists at `/tmp/qmp-socket-5554.sock`. Both were
observed; only the console path is useful (section 8). QMP capture and
injection are ineffective here (section 10).

## 5. Install and launch DECORDA

From the repository root:

```bash
vega run-app "build/private/kepler/@amazon-devices/decorda/undefined/vega/aarch64/Release/@amazon-devices/decorda_aarch64.vpkg" com.agentisstudio.decorda.main
```

`OBSERVED` — the second argument is the component id
`com.agentisstudio.decorda.main` (the package id is `com.agentisstudio.decorda`).
`vega run-app <packageFile> [appId]` installs and launches onto the device. This
is the exact form that was recorded as working; do not add or omit arguments
beyond what is written here.

## 6. Native control and capture facilities

What was established on the device before driving the app:

- The guest exposes on-device binaries including `inputd` and `inputd-cli`.
  `OBSERVED`.
- Guest command surface: `vega device run-cmd --command '<guest command>'`.
  `OBSERVED`.
- `inputd-cli --help` describes itself as "dev-mode inputd cli" with subcommands
  `start`, `series`, `button_press`, `send_text`, `touch`, `swipe`,
  `gesture_swipe_down/up/left/right`, `mouse_move`, `mouse_click`,
  `mouse_button_press`, `get_camera_cover_open_close`, `get_mic_state`.
  `OBSERVED` (help text). Also observed working: `get_screen_size` (returned
  `1920 x 1080`) and `list_devices`.
- The emulator console offers `help` per facility. Observed facilities include
  `screenrecord` (`start`, `stop`, `screenshot`, `webrtc`) and `event`
  (`event send`, `event types`, `event codes`, `event text`, `event mouse`).
  Only `screenrecord screenshot` proved useful (section 8); `event send` is
  ineffective (section 10).
- Host-side window scraping and host synthetic keystrokes were ruled out by the
  absent macOS permissions above. `OBSERVED`.

## 7. Proven input path — `inputd-cli`

All input is injected **inside the guest** via `vega device run-cmd`. Each
invocation prints an `Injecting ...` line per action, which is how success was
counted.

Directional navigation and activation (keys `OBSERVED` working):

```bash
vega device run-cmd --command 'inputd-cli button_press KEY_SELECT'
vega device run-cmd --command 'inputd-cli button_press KEY_RIGHT'
vega device run-cmd --command 'inputd-cli button_press KEY_LEFT'
```

Other key names were `NOT PRESERVED`; do not guess button codes.

Touch activation (`OBSERVED`, coordinates on the 1920 x 1080 canvas; `858 220`
is the recorded example, and the touch helper also drove `820 466`, `1436 466`,
`1436 694`):

```bash
vega device run-cmd --command 'inputd-cli touch 858 220 short'
```

Batching (`OBSERVED`): multiple statements joined with `; ` inside ONE
`run-cmd` invocation all inject, and a small batch measured about 1.5 s total
wall time:

```bash
vega device run-cmd --command 'inputd-cli button_press KEY_LEFT; inputd-cli button_press KEY_RIGHT'
```

**Mutation-related focus loss** (`OBSERVED`): a button press that causes a state
mutation can drop product focus. Where this happens, switch to direct touch
activation on the real controls instead of relying on D-pad focus across a
mutation.

`inputd-cli series` and `send_text` exist per the help text but were not
exercised; their exact mapping is `NOT PRESERVED`.

In practice, commands were wrapped in `timeout` guards with filtered output
(for example `timeout 250 vega device run-cmd --command '...' 2>&1 | tail -n`);
the unadorned forms above are the proven core commands.

## 8. Proven native screenshot path

Guest-side capture through the emulator console on `127.0.0.1:5554`. Open a TCP
socket to the console, read the auth token from
`~/.emulator_console_auth_token`, send `auth <token>`, then send the capture
command. The token value itself never leaves the runtime.

Console commands (`OBSERVED`):

```text
auth <token-from-~/.emulator_console_auth_token>
screenrecord screenshot <output-directory>
```

`screenrecord screenshot` with an output directory writes the capture as PNG
file(s) into that directory; allow roughly 2.5 s for the command, then list the
directory for the new file. Output is the full 1920 x 1080 native guest
framebuffer — no scaling, no stitching, no crop, no HTML substitute. All release
frames, including the four screenshots in the project README, were captured this
way.

Host macOS Screen Recording was unavailable in the observed environment;
guest-side capture worked and is the preferred path regardless.

## 9. Driving the lifecycle efficiently

1. Build once (section 3), start one virtual device (section 4), launch the
   Release package once (section 5).
2. Reach the product's controls with the proven `inputd-cli` forms only. Confirm
   each step by hashing the captured frame — comparing PNG hashes between steps
   proves a state change actually happened rather than assuming it.
3. Prefer direct touch activation on real controls around mutations (section 7).
4. Batch independent key presses into one `run-cmd`; keep batches small.
5. The 10-minute fixture window is the clock on everything (section 11). Know
   the sequence before the fixture starts, drive it promptly, capture as you go.

## 10. Known ineffective paths

Environment-specific observations — not universal claims. Do not retry them by
default unless the environment materially differs:

- `QMP screendump` (via `/tmp/qmp-socket-5554.sock`) returned a black frame; the
  guest framebuffer is GL-accelerated. `OBSERVED`.
- Emulator console `event send EV_KEY:<name>:1/:0` did not reach the Vega
  compositor (silent no-op). `OBSERVED`.
- QMP `send-key` (qcode) keyboard injection was ignored. `OBSERVED`.
- macOS `CGEventPost` synthetic host input was unavailable without Accessibility
  permission; one attempt also activated the wrong application. `OBSERVED`.
- Guest `screenshooter` produced zero-byte output. Treat guest-side
  `screenrecord screenshot` as the only proven capture path.

## 11. The 10-minute fixture constraint

`OBSERVED` (`src/infrastructure/runtime/decisionRuntimeConfig.ts`): local fixture
sessions are bounded to **10 minutes**. An expired session correctly refuses to
mutate:

```text
EXPIRED - This bounded decision session has expired. No action was saved.
```

Operating rule: once the input mapping is known, launch a fresh fixture, execute
the known lifecycle promptly, and do not research alternative input paths while
the fixture is live. On expiry, relaunch a fresh fixture and reuse the proven
sequence. Do not modify the product merely to extend capture lifetime.

## 12. What makes a frame count as evidence

Every claim-bearing frame must be:

- one native product viewport at the full 1920 x 1080 guest framebuffer;
- no stitching, no scrolled composite, no HTML substitute;
- no crop hiding boundaries, no upscaling;
- reached through real product controls only — no disabled-state injection, no
  prop forcing, no test hooks;
- hashed or otherwise identified, so a state change is provably a new frame.

## 13. Teardown

```bash
vega virtual-device stop
ps aux | grep -i 'vega-virtual-device' | grep -v grep | wc -l
```

The stop command was `OBSERVED`; the process count must report `0`. Verify the
absence — do not assume a stop succeeded.

## 14. Troubleshooting

- `inputd-cli list_devices` may report "No input devices found" while
  `button_press` injection works ("Injecting Button Press As Driver ...").
  `OBSERVED`. Do not treat it as a blocker.
- **Screenshot did not appear:** wait a few seconds and re-list the output
  directory; allow ~2.5 s for `screenrecord screenshot`. Confirm console `auth`
  succeeded first.
- **Black capture:** you used QMP `screendump` — expected black under the
  GL-accelerated display. Switch to console `screenrecord screenshot`
  (section 8).
- **Keystrokes do nothing:** you used console `event send` or QMP `send-key` —
  both ineffective here. Switch to `inputd-cli` (section 7).
- **Focus lost after an activation:** mutation-related focus drop; use direct
  touch on the real control (section 7).
- **Mutations refused with EXPIRED:** the 10-minute fixture window closed.
  Relaunch a fresh fixture and rerun the proven sequence (section 11).

## 15. When the local path is not enough

Use the local virtual device for native UI regression, focus and navigation
evidence, visual fit, native Release package execution, and screenshots. A real
cloud boundary — real HTTPS, real Lambda, real DynamoDB — is the only thing it
cannot stand in for; that is what the durable qualification described in
[VERIFICATION.md](VERIFICATION.md) covers. This section is descriptive guidance
only; anything touching a cloud account needs its own explicit authorization.

Raw execution evidence from the release qualification is retained privately. The
results it supports are summarized in [VERIFICATION.md](VERIFICATION.md).
