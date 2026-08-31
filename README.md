# Heat & Glo — IntelliFire Plus RC300

Control a Heat & Glo gas fireplace from Homey, by emulating the IntelliFire Plus RC300 433 MHz
remote. Heat & Glo is the manufacturer; the IntelliFire Plus RC300 is the specific remote/receiver
this app speaks to.

What works:

* Fireplace on/off.
* Fan speed (low / medium / high).
* Flame level (1–5).
* Flow actions for setting fan speed and flame level.
* Pairing learns your own remote's address, so the app controls *your* fireplace.
* Homey follows the physical remote: using the handset updates Homey's state.

Like the physical remote, the fan and flame can only be changed while the fireplace is on.

Not supported:

* The remote's **AUX1** and **AUX2** buttons. They aren't wired to anything on the fireplace this
  was built against, so no RF was captured for them — see [RF_PROTOCOL.md](RF_PROTOCOL.md) for
  what's known and what adding them would involve.

## Pairing

Homey learns which fireplace to talk to by listening to your existing remote. When adding the
device, hold the RC300 near Homey and press its **ON** or **OFF** button. Homey captures the
remote's address and transmits as that remote from then on.

It has to be ON or OFF specifically — pairing ignores the fan and flame buttons, which are
ambiguous to press and only do anything while the fireplace is already lit. A device that has no
address stays unavailable until it's added again; the app never guesses one, since transmitting a
guessed address would drive whichever fireplace happened to answer to it.

## Protocol

The 433 MHz protocol was reverse-engineered from captures made with Homey's built-in RF signal
recorder. See [RF_PROTOCOL.md](RF_PROTOCOL.md) for the frame layout, the decoded payloads, and how
to capture and decode additional commands.
