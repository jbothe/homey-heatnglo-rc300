# IntelliFire Plus RC300 433MHz RF Protocol

Reverse-engineered from 10 commands captured off a single Heat & Glo IntelliFire Plus RC300
handset with Homey's built-in RF signal recorder. All 10 are implemented and verified working on
real hardware, in both directions.

This is a working hypothesis, not a manufacturer specification. Treat the structure section as a
guide for decoding further commands.

## Frame layout

Every frame is 47 symbols, and splits in two:

```
[ 0..23 ]  address   identifies the remote/receiver pair, same for every button
[ 24..46 ] command   which button was pressed
```

The app stores one address per paired device and prepends it to a fixed 23-symbol command suffix.
Both live in [`rc300-protocol.js`](drivers/rc300/rc300-protocol.js).

## Signal definition

[`.homeycompose/signals/433/rc300.json`](.homeycompose/signals/433/rc300.json), compiled into
`app.json` as `signals.433.rc300`. One definition serves both transmit and receive.

| Property | Value | Notes |
|---|---|---|
| `sof` | `800,425,375,425,900,425,400,1225,900` | preamble, raw pulse/gap durations in us |
| `words` | see below | symbol alphabet |
| `interval` | `18000` | gap between repetitions (transmit) |
| `repetitions` | `10` | transmit only |
| `sensitivity` | `0.3` | match tolerance (receive) |
| `rxTimeout` | `255` | receive only; a frame is 70.5ms, well past the 10ms default |
| `minimalLength` / `maximalLength` | `47` | every payload is exactly 47 symbols |

There is deliberately **no `eof`** and no `txOnly`. See below.

### Symbol alphabet

Payload elements are indices into a 4-entry table, not raw bits. Each entry is a
`[pulse, gap]` pair in microseconds:

| Symbol | Pulse | Gap |
|---|---|---|
| `0` | 1500 (long) | 400 (short) |
| `1` | 1500 (long) | 900 (long) |
| `2` | 675 (short) | 400 (short) |
| `3` | 675 (short) | 900 (long) |

Short-pulse symbols (`2`, `3`) carry the data. Long-pulse symbols (`0`, `1`) appear only at five
fixed positions and act as field markers.

## Receiving: two Homey requirements

Transmitting worked immediately. Receiving needed two independent changes. Either one missing
gives the identical symptom, `enableRX()` resolving successfully while no `payload` event ever
fires, so they cannot be diagnosed separately.

**1. The driver must declare itself an RF receiver**, in
[`driver.compose.json`](drivers/rc300/driver.compose.json):

```json
"rf433": { "satelliteMode": true }
```

Without it Homey routes no received frame to the driver at all, not even for a deliberately
permissive signal definition. Documented only in the
[homey-rfdriver](https://github.com/athombv/node-homey-rfdriver) README, under the transmitter
(learn from a remote) case.

**2. The signal must omit `eof`.** Homey will not match an incoming frame against a definition
declaring an `eof` unless it observes that eof on air. RC300 frames are followed by a silence
longer than the 32767us an `eof` can express, so no value can ever be satisfied. Verified by
holding everything else constant and varying only the eof: `[5000,5000]`, `[5000]`, `[1000]` and
`[32767]` all received nothing, while omitting the property received immediately.

`txOnly` must also stay absent. It defaults to `false`, so it never needed removing to enable
receiving, but setting it would disable receiving.

## Transmit notes

A frame is 70.5ms (5875us of SOF plus 64650us of payload). At 10 repetitions a command occupies
roughly 0.87s of airtime.

`repetitions` was originally 30, which transmitted for 2.94s and made the fireplace **beep
twice**: its receiver re-triggers if it keeps hearing the same command, so one Homey command
registered as two presses. The handset sends 10 to 11 frames per press, so 10 matches it.

`Signal#tx()` resolves once Homey has queued the transmission, not once the repetitions have gone
out. Observed call times are 10 to 40ms against ~870ms of airtime, so the duration in the app's
`tx ... (queued in Nms)` log lines is call latency, not radio time.

The `payload` event's third argument is a deviation figure. Real frames arrive at ~0.009, noise
matched against a loose definition at ~0.28.

## Commands

The 23-symbol suffixes, as implemented:

| Command | Suffix |
|---|---|
| `POWER.off` | `2,2,2,2,2,3,2,1,3,3,2,3,3,3,2,0,2,2,3,2,2,2,3` |
| `POWER.on` | `2,2,2,2,2,2,3,1,3,3,2,3,3,2,3,0,2,2,3,2,2,3,2` |
| `FAN.low` | `3,2,2,2,2,2,3,0,2,3,2,3,3,2,3,1,3,2,3,2,2,3,2` |
| `FAN.med` | `3,2,2,2,2,3,2,0,2,3,2,3,3,3,2,1,3,2,3,2,2,2,3` |
| `FAN.high` | `3,2,2,2,2,3,3,0,2,3,2,3,3,3,3,1,3,2,3,2,2,2,2` |
| `FLAME[1]` | `2,3,3,2,2,2,3,0,2,2,3,3,3,2,3,1,3,3,2,2,2,3,2` |
| `FLAME[2]` | `2,3,3,2,2,3,2,0,2,2,3,3,3,3,2,1,3,3,2,2,2,2,3` |
| `FLAME[3]` | `2,3,3,2,2,3,3,0,2,2,3,3,3,3,3,1,3,3,2,2,2,2,2` |
| `FLAME[4]` | `2,3,3,2,3,2,2,0,2,3,2,2,2,2,2,1,3,2,3,3,3,3,3` |
| `FLAME[5]` | `2,3,3,2,3,2,3,0,2,3,2,2,2,2,3,1,3,2,3,3,3,3,2` |

Each was captured from one button press, which the recorder saw as 10 to 11 repeated frames.
Every repeat that decoded cleanly agreed exactly; 4 to 9 clean repeats per command, the rest
partial or glitched and discarded.

## Frame structure

Positions below are absolute within the 47-symbol frame. Subtract 24 for the index into a command
suffix.

Long-pulse markers sit at **7, 15, 23, 31, 39**, splitting the frame into six 7-symbol fields.

| Region | Positions | Behaviour |
|---|---|---|
| Address | 0-23 | Identical across all 10 commands |
| Family flag | 24, 25, 26, 31, 32, 39, 40 | Constant within a family, differs between families |
| Command code | 28, 29, 30, then 36-38 and 44-46 | The button-specific value |
| Unexplained | 27, 33, 34, 35, 41, 42, 43 | 27 is always `2`. The rest track the flame group bit |

### Family flag

| Family | 24 | 25 | 26 | 31 | 32 | 39 | 40 |
|---|---|---|---|---|---|---|---|
| POWER | 2 | 2 | 2 | 1 | 3 | 0 | 2 |
| FAN | 3 | 2 | 2 | 0 | 2 | 1 | 3 |
| FLAME | 2 | 3 | 3 | 0 | 2 | 1 | 3 |

### Command code

POWER and FAN use a 2-symbol code repeated three times, at positions 29-30, 37-38 and 45-46. The
third copy is the bitwise complement of the first two (`2` and `3` swap).

| Command | 29,30 | 37,38 | 45,46 |
|---|---|---|---|
| OFF | `3,2` | `3,2` | `2,3` |
| ON | `2,3` | `2,3` | `3,2` |
| FAN LOW | `2,3` | `2,3` | `3,2` |
| FAN MED | `3,2` | `3,2` | `2,3` |
| FAN HIGH | `3,3` | `3,3` | `2,2` |

The code space is shared between families and disambiguated only by the family flag: ON and FAN
LOW carry an identical code, as do OFF and FAN MED.

FLAME needs a third bit, since 5 levels do not fit in 4 values, and it reads as a plain binary
counter. Taking symbol `2` as bit 0 and `3` as bit 1, positions (28, 29, 30) give the level
number exactly:

| Level | 28 | 29 | 30 | Binary |
|---|---|---|---|---|
| 1 | 2 | 2 | 3 | `001` |
| 2 | 2 | 3 | 2 | `010` |
| 3 | 2 | 3 | 3 | `011` |
| 4 | 3 | 2 | 2 | `100` |
| 5 | 3 | 2 | 3 | `101` |

The same 3 bits repeat at (36, 37, 38) complemented and (44, 45, 46) uncomplemented, matching the
POWER/FAN pattern.

Positions 33-35 and 41-43 also move between flame groups `{1,2,3}` and `{4,5}`, tracking bit 28,
but not as a clean duplicate or complement of anything identified. Likely further redundant
copies, unconfirmed.

## Addressing and pairing

Positions 0-23 never change with the button pressed, which makes them the per-unit address. Heat
& Glo remotes are paired to a specific receiver, so units must be distinguishable on air.

The app therefore **learns the address from the user's own remote at pair time** rather than
shipping one (see [`driver.js`](drivers/rc300/driver.js)). It listens on 433MHz, waits for a frame
whose trailing 23 symbols match a known command, and keeps the leading 24. Matching on a known
suffix is what prevents pairing to an unrelated 433MHz device transmitting nearby. Pairing accepts
ON and OFF only, since those work regardless of the fireplace's state.

This clones an existing remote rather than inventing an address and teaching it to the receiver.
Cloning needs only the handset the user already has.

**Caveat.** All captures come from one remote, so the data cannot distinguish "unique per unit"
from "identical on every RC300 ever made". The product's pairing behaviour makes the address
reading far more likely, since a receiver learning one specific transmitter is the only thing that
makes pairing meaningful. The same limit applies to the command region: if any of it also varies
per unit, a single sample cannot show it. Settling either needs captures from a second,
independently paired RC300.

## AUX1 and AUX2

The handset carries AUX1 and AUX2 buttons, not implemented here. Neither is wired to anything on
the fireplace this was built against, so nothing was captured.

| Button | Behaviour on the handset | Likely encoding |
|---|---|---|
| AUX1 | multi-level, like flame | a level field, perhaps the same 3-bit counter |
| AUX2 | binary | a 2-symbol code, like POWER and FAN |

These are predictions from button behaviour, not captured data. They do fit the available space:
the POWER/FAN 2-symbol field has an unused fourth value (`2,2`), and the FLAME 3-bit field leaves
`000`, `110` and `111` free. Whether AUX uses that space or its own family flag is unknown.

Only worth implementing on a unit where the buttons actually do something, otherwise a working
implementation is indistinguishable from a broken one.

## Adding a command

1. **Capture it.** Use Homey's built-in RF signal recorder in Developer Tools, which is what
   produced everything above: press the button once and it records raw pulse/gap durations in us
   for every repeated frame. An SDR with [`rtl_433`](https://github.com/merbanan/rtl_433) or
   [Universal Radio Hacker](https://github.com/jopohl/urh) works too.
2. **Decode to 47 symbols.** Find the 9-value SOF, then read pairs of values (pulse, gap) and map
   each to the nearest `words` entry. A capture holds several repeats separated by a long gap,
   which the recorder reports as its overflow value `65535`. Decode each repeat separately and
   compare: agreement means a clean capture, disagreement means take another. Some captures begin
   with a glitchy run before the real SOF, so search for the SOF rather than assuming it starts at
   the first value.
3. **Check it against the structure above.** If it does not fit, document what actually differs
   rather than forcing it into the model.
4. **Add the 23-symbol suffix** to the relevant table in
   [`rc300-protocol.js`](drivers/rc300/rc300-protocol.js), which also registers it for receive via
   `identifyFrame`, then wire it to a capability or flow card.
5. **Update this document.**
