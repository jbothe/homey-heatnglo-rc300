# RC300 / Intellifire Plus 433MHz RF Protocol

This documents what's currently known about the RF protocol used by the Heat N Glo RC300
(Intellifire Plus) remote, reverse-engineered from the `ON`/`OFF` commands already implemented in
[`drivers/rc300/device.js`](drivers/rc300/device.js) plus 3 captured fan-speed commands
(`LOW`/`MED`/`HIGH`) and 5 captured flame-level commands (`1`–`5`), none of the latter 8 wired up
yet. It's a working hypothesis based on comparing 10 payloads, not a datasheet — treat the
"structure" section as a guide for reverse-engineering more commands, not as a specification
handed down from the manufacturer.

## Receiving: two things Homey requires

Transmitting worked from the start; receiving took a long time to get working, and needed **two
independent** changes. Either one missing produces exactly the same symptom — `enableRX()`
resolves successfully and then no `payload` event ever fires — so they cannot be diagnosed one at
a time.

**1. The driver must declare itself an RF receiver.** In
[`driver.compose.json`](drivers/rc300/driver.compose.json):

```json
"rf433": { "satelliteMode": true }
```

Without this Homey never routes any received frame to the driver at all — not even to a
deliberately permissive signal definition. This is documented only in the README of
[homey-rfdriver](https://github.com/athombv/node-homey-rfdriver), under the *transmitter* (learn
from a remote) case.

**2. The signal definition must omit `eof`.** Homey will not match an incoming frame against a
definition that declares an `eof` unless it observes that eof on air. The RC300's frames are
followed by a silence longer than the 32767us an `eof` value can express, so no eof we can write
is ever satisfied. Verified by holding everything else constant and varying only the eof:
`[5000,5000]`, `[5000]`, `[1000]` and `[32767]` all received nothing, while omitting the property
received the frame immediately.

`txOnly` must also be absent (it defaults to **false**), since it would disable receiving. Note it
never needed removing to *enable* receiving on its own — that was a red herring early on.

### One definition serves both directions

`eof` was the only property whose correct value differed between transmitting and receiving, and
it is now omitted for both. Everything else that differs affects one direction only, so a single
`rc300` definition covers both:

| Property | Affects | Value | Why |
|---|---|---|---|
| `repetitions` | transmit | `10` | matches the remote; 30 made the fireplace beep twice |
| `interval` | transmit | `18000` | gap between repetitions |
| `sensitivity` | receive | `0.3` | matching tolerance; real frames arrive at ~0.009 deviation |
| `rxTimeout` | receive | `255` | frame is 70.5ms, far longer than the 10ms default |

The signal id lives in [`rc300-protocol.js`](drivers/rc300/rc300-protocol.js) as `SIGNAL_ID` so
the driver and device reference one place.

## Transmit timing

A single frame is 70.5ms (5875us of SOF plus 64650us of payload). Two properties of the transmit
definition were originally set higher than the real remote uses, and both have been corrected:

**`repetitions` was 30, now 10.** At 30 the app transmitted for 2.94 seconds per command, and the
fireplace **beeped twice** — its receiver re-triggers if it keeps hearing the same command, so one
Homey command registered as two button presses. The remote's own captures contain 10-11 frames per
press, so 10 matches the hardware's behaviour. Commands now take 0.87s, 3.4x shorter.

**`eof` was `[5000, 5000]`, now omitted.** That transmitted a 5ms carrier burst followed by 5ms of
silence after every frame — something the real remote never sends: no value anywhere near 5000us
appears in any of the 5775 captured values, where frames simply end and are followed by silence.
Removing it makes the transmission faithful to the remote and saves 10ms per repetition.

Repetitions are separated by `interval` (18000us) regardless, so dropping the eof does not run
frames together.

Note that `Signal#tx()` resolves once Homey has **queued** the transmission, not once the
repetitions have finished going out — observed call times are 10-40ms against ~870ms of actual
airtime. So the duration in the app's `tx ... (queued in Nms)` log lines is call latency, and is
not a measure of how long the radio was busy.

Incidentally, the `payload` event's third argument is a deviation figure: real RC300 frames
arrive at ~0.009, while noise matched against a loose definition sits around 0.28. That confirms
`sensitivity` (max 0.5) was never the obstacle it looked like.

## Physical layer

Defined in [`.homeycompose/signals/433/rc300.json`](.homeycompose/signals/433/rc300.json)
(compiled into `app.json`'s `signals.433.rc300`):

| Property | Value | Meaning |
|---|---|---|
| Frequency | 433 MHz (`homey:wireless:433` permission) | |
| `txOnly` | `true` | The app only transmits; it never listens for the remote's own signals |
| `interval` | 18000 µs | Minimum time between repeated frames |
| `repetitions` | 30 | Each `tx()` call repeats the frame 30× for reliability |
| `sensitivity` | 0.5 | Timing tolerance used if RX were enabled |
| `minimalLength` / `maximalLength` | 47 | Every payload is exactly 47 symbols long |

### Start-of-frame (SOF) and end-of-frame (EOF)

Every frame is preceded by a fixed preamble and followed by a fixed trailer, both given as
raw pulse/gap durations in microseconds:

```
sof: 800, 425, 375, 425, 900, 425, 400, 1225, 900
eof: 5000, 5000
```

### Symbol alphabet (`words`)

The payload itself is not raw bits — each element of the transmitted array is an index (0–3)
into a 4-entry symbol table, where each symbol is a `[pulseLength, gapLength]` pair (µs):

| Symbol value | Pulse | Gap |
|---|---|---|
| `0` | 1500 (long) | 400 (short) |
| `1` | 1500 (long) | 900 (long) |
| `2` | 675 (short) | 400 (short) |
| `3` | 675 (short) | 900 (long) |

Put another way, each symbol encodes 2 bits: a "pulse" bit (long = `0`/`1`, short = `2`/`3`) and
a "gap" bit (short gap = `0`/`2`, long gap = `1`/`3`). In every known payload, symbols `2` and
`3` (short pulse) dominate, with `0` and `1` (long pulse) appearing only at a few fixed positions
— see below.

## Known payloads

```js
const RC300_OFF      = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 2, 2, 2, 3, 2, 1, 3, 3, 2, 3, 3, 3, 2, 0, 2, 2, 3, 2, 2, 2, 3];
const RC300_ON       = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 2, 2, 2, 2, 3, 1, 3, 3, 2, 3, 3, 2, 3, 0, 2, 2, 3, 2, 2, 3, 2];
const RC300_FAN_LOW  = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 2, 3, 0, 2, 3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 2, 2, 3, 2];
const RC300_FAN_MED  = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 3, 2, 0, 2, 3, 2, 3, 3, 3, 2, 1, 3, 2, 3, 2, 2, 2, 3];
const RC300_FAN_HIGH = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 3, 3, 0, 2, 3, 2, 3, 3, 3, 3, 1, 3, 2, 3, 2, 2, 2, 2];
```

```js
const RC300_FLAME_1 = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 2, 3, 0, 2, 2, 3, 3, 3, 2, 3, 1, 3, 3, 2, 2, 2, 3, 2];
const RC300_FLAME_2 = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 2, 0, 2, 2, 3, 3, 3, 3, 2, 1, 3, 3, 2, 2, 2, 2, 3];
const RC300_FLAME_3 = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 3, 3, 3, 3, 3, 1, 3, 3, 2, 2, 2, 2, 2];
const RC300_FLAME_4 = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 3, 2, 2, 0, 2, 3, 2, 2, 2, 2, 2, 1, 3, 2, 3, 3, 3, 3, 3];
const RC300_FLAME_5 = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 3, 2, 3, 0, 2, 3, 2, 2, 2, 2, 3, 1, 3, 2, 3, 3, 3, 3, 2];
```

All 8 were captured with Homey's built-in RF signal recorder (one button press each), which
recorded 10–11 repeated raw pulse trains per press. Each repeat was decoded independently
against the `words` table and cross-checked against the others in the same capture:

| Command | Repeats that agreed | Command | Repeats that agreed |
|---|---|---|---|
| FAN LOW | 9/11 | FLAME 1 | 5/11 |
| FAN MED | 9–10/11 | FLAME 2 | 6/11 |
| FAN HIGH | 9/10 | FLAME 3 | 5/11 |
| | | FLAME 4 | 8/11 |
| | | FLAME 5 | 4/11 |

In every case, **zero disagreement** among the repeats that did decode cleanly (the rest were
partial/glitched captures, safely discarded). The fan captures were very clean; the flame
captures had a noisier session (more garbled/truncated preambles), so the sample counts are
thinner — still zero contradictions, but if you want extra confidence before relying on these,
one more clean press per flame level would help. I wouldn't block on it though.

### Observed structure

The long-pulse symbols (`0` or `1`) occur at exactly the same 5 positions in all 10 known
payloads: indices **7, 15, 23, 31, 39**. That splits the 47-symbol frame into six 7-symbol
fields, each terminated by one of these long-pulse symbols (the final field, indices 40–46, has
no trailing marker — it's simply the end of the frame):

```
field 0: [0..6]    (7 symbols)   marker @7  = 1
field 1: [8..14]   (7 symbols)   marker @15 = 0
field 2: [16..22]  (7 symbols)   marker @23 = 0
field 3: [24..30]  (7 symbols)   marker @31 = varies (see below)
field 4: [32..38]  (7 symbols)   marker @39 = varies (see below)
field 5: [40..46]  (7 symbols)   — end of frame, no marker
```

Comparing all 10 payloads position-by-position:

| Region | Positions | Behavior |
|---|---|---|
| Address | 0–23 | **Identical across all 10 commands.** Identifies the remote/receiver pair, unaffected by which button is pressed — see "Addressing and pairing" below. |
| Family flag | 24, 25, 26, 31, 32, 39, 40 | Constant *within* a command family, different *between* families — see table below. |
| Command code | 28, 29, 30, 36/37/38, 44/45/46 | The button-specific value, 2 or 3 bits depending on family — see below. |
| Remaining | 27, 33, 34, 35, 41, 42, 43 | 27 is always `2`. The rest move in lockstep with the flame family's command code (see "open question" below) but aren't otherwise understood. |

**Family flag.** Three families are known so far, each with a unique 7-symbol fingerprint at the
positions above:

| Family | 24 | 25 | 26 | 31 | 32 | 39 | 40 |
|---|---|---|---|---|---|---|---|
| POWER (ON/OFF) | 2 | 2 | 2 | 1 | 3 | 0 | 2 |
| FAN (LOW/MED/HIGH) | 3 | 2 | 2 | 0 | 2 | 1 | 3 |
| FLAME (1–5) | 2 | 3 | 3 | 0 | 2 | 1 | 3 |

**Command code.** For POWER and FAN, the command lives entirely in a 2-symbol code repeated 3×
at local offset 5–6 of fields 3, 4, and 5 (positions 29-30 / 37-38 / 45-46), with the 3rd copy
being the **bitwise complement** of the first two (every `2` becomes `3` and vice versa):

| Command | Field 3 (29,30) | Field 4 (37,38) | Field 5 (45,46) |
|---|---|---|---|
| OFF | `3, 2` | `3, 2` | `2, 3` |
| ON | `2, 3` | `2, 3` | `3, 2` |
| FAN LOW | `2, 3` | `2, 3` | `3, 2` |
| FAN MED | `3, 2` | `3, 2` | `2, 3` |
| FAN HIGH | `3, 3` | `3, 3` | `2, 2` |

Note the code space is **shared between families**, disambiguated only by the family flag: `ON`
and `FAN LOW` carry the identical code, as do `OFF` and `FAN MED`.

**FLAME needs a 3rd bit, and it's a clean binary counter.** 5 flame levels don't fit in a 2-symbol
(4-value) code, and indeed FLAME uses one more bit than POWER/FAN: position 28 (mirrored,
complemented, at 36; mirrored again, uncomplemented, at 44). Treating symbol `2` as bit `0` and
`3` as bit `1`, and reading `(pos28, pos29, pos30)` as a 3-bit number:

| Level | pos28 | pos29 | pos30 | binary | value |
|---|---|---|---|---|---|
| FLAME 1 | 2 (0) | 2 (0) | 3 (1) | `001` | 1 |
| FLAME 2 | 2 (0) | 3 (1) | 2 (0) | `010` | 2 |
| FLAME 3 | 2 (0) | 3 (1) | 3 (1) | `011` | 3 |
| FLAME 4 | 3 (1) | 2 (0) | 2 (0) | `100` | 4 |
| FLAME 5 | 3 (1) | 2 (0) | 3 (1) | `101` | 5 |

That's an exact match to the level number in binary — a strong, clean confirmation this is a
genuine 3-bit "level" field, not coincidence. The same 3 bits are repeated (with the field-4 copy
complemented, field-5 copy not) at `(36,37,38)` and `(44,45,46)`, consistent with the
duplicate+complement checksum pattern already established for POWER/FAN.

**Open question.** Positions 33–35 and 41–43 also change between the two flame level groupings
seen (`{1,2,3}` vs `{4,5}`, matching bit `pos28`), but not in a way that fits a simple
duplicate/complement of anything already identified. They're very likely more copies of the same
group bit (cheap remotes often pad frames with redundant bits for noise immunity), but this isn't
verified — treat them as "known to move, meaning unconfirmed" rather than filler.

**Confidence:** high for the family-flag and command-code patterns (10 independent commands,
each internally consistent across several repeats with zero decode disagreement) and for the
3-bit flame-level encoding (it reproduces 1–5 exactly). Lower for the leftover positions in the
"open question" above. None of this is verified against a spec.

## Addressing and pairing

Heat & Glo remotes are paired to a specific fireplace receiver, so each unit must be
distinguishable on air. Positions 0–23 are the only part of the frame that never changes with
the button pressed, which makes them the obvious candidate for that per-unit address:

```
address (24 symbols): 2,2,3,2,2,2,3,1,3,2,3,2,2,3,3,0,2,3,3,2,2,3,3,0
```

Every frame is therefore `address (24) + command (23)`, and the app stores one address per paired
device and prepends it to the fixed command suffixes in
[`drivers/rc300/rc300-protocol.js`](drivers/rc300/rc300-protocol.js).

**This is an inference, not a measurement.** All 10 captures come from a *single* remote, so the
data alone cannot distinguish "unique per unit" from "constant across every RC300 ever made" —
both look identical with a sample size of one. What makes the address reading much more likely is
the product itself: pairing a remote to a receiver is only meaningful if the receiver learns to
recognise one specific transmitter, which a universal shared code would make pointless.

The same caveat applies in reverse to the command region (24–46): it is only verified against one
unit, so if any of it also varies per-unit we would have no way to see that here. Confirming
either way needs captures from a second, independently-paired RC300.

Because of this, the app **learns the address from the user's own remote at pair time** rather
than hardcoding one (see [`drivers/rc300/driver.js`](drivers/rc300/driver.js)). It listens on 433
MHz, waits for a frame whose trailing 23 symbols match a known command, and keeps the leading 24
as that device's address. Matching on a known command suffix is what stops it from pairing to an
unrelated 433 MHz device that happens to transmit while the user is pressing their remote.

Note this clones an existing remote rather than inventing a new address and teaching it to the
receiver. Cloning only requires the remote the user already has; the alternative would require
physical access to the receiver module and a "learn" procedure we have no evidence of.

## Unmapped remote functions: AUX1 and AUX2

The RC300 handset also carries **AUX1** and **AUX2** buttons, which this app does not implement.
Neither is wired to anything on the fireplace they were reverse-engineered against, so no RF has
been captured for them and there was no way to confirm what a capture would even do.

From how they behave on the handset:

| Button | Behaviour | Likely encoding |
|---|---|---|
| AUX1 | multi-level, like flame height | a level field, plausibly the same 3-bit counter FLAME uses |
| AUX2 | binary, on/off | a 2-symbol code, like POWER and FAN |

Both are **predictions from the button behaviour, not from captured data.** They do fit the
protocol's shape though: the frame layout has room for them, and there is already known unused
code space — the POWER/FAN 2-symbol field has a fourth value (`2,2`) that no known command uses,
and the FLAME 3-bit field leaves `000`, `110` and `111` free. Whether AUX1/AUX2 occupy that space
or introduce their own family flags is unknown.

Adding them is a future task, and only worth doing on a unit where the buttons actually control
something — otherwise there is no way to tell a working implementation from a broken one. The
capture and decode procedure below applies unchanged.

## Adding a new command

1. **Capture a real transmission.** The app itself is `txOnly`, so it can't record the remote's
   signal, but this doesn't require touching the app at all:
   - **Homey's built-in RF signal recorder** (Homey app → device settings → "RF signal recorder",
     or similar, depending on firmware) — this is what produced the `LOW`/`MED`/`HIGH` captures
     above. Press the remote button once; it records the raw pulse/gap durations (in µs) for
     every repeated frame it heard during the press.
   - Alternatively, an SDR (e.g. RTL-SDR) with [`rtl_433`](https://github.com/merbanan/rtl_433)
     or the [Universal Radio Hacker](https://github.com/jopohl/urh) works independently of Homey.
2. **Decode the raw capture** into a 47-symbol array: locate the 9-value SOF pattern, then read
   the rest 2 values (pulse, gap) at a time, mapping each pair to the nearest entry in the
   `words` table. A capture usually contains several repeated frames separated by a very long
   gap (Homey's recorder reports this as `65535`, its overflow value) — decode each repeat
   separately and cross-check them against each other the way `LOW`/`MED`/`HIGH`/`FLAME 1-5` were:
   if most repeats agree exactly, the capture is clean; if they don't, get another sample. Some
   captures have a noisy/glitchy run of values before the real SOF starts (the flame captures
   did) — search for the SOF pattern rather than assuming it's the first 9 values, and discard
   any repeat where it can't be found cleanly.
3. **Check it against the structure above** (fixed preamble, family flag, command code with the
   3rd copy complemented). If a new capture doesn't fit, the hypothesis needs revising — document
   what actually changed rather than forcing it into the existing model.
4. **Add the constant** next to `RC300_ON`/`RC300_OFF` in
   [`drivers/rc300/device.js`](drivers/rc300/device.js) and wire it up to whatever capability or
   flow card makes sense (e.g. flame height, fan speed — see the `Todo` list in
   [`README.md`](README.md)).
5. Update this document with the new payload and any changes to the structural hypothesis.
