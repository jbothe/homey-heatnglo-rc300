# Heat & Glo — IntelliFire Plus RC300

Control a Heat & Glo gas fireplace from Homey, by emulating the IntelliFire Plus RC300 433 MHz
remote. The Heat & Glo IntelliFire Plus RC300 is the specific remote/receiver this app speaks to.

What works:

* Fireplace on/off.
* Fan speed (low / medium / high).
* Flame level (1–5).
* Flow actions for setting fan speed and flame level.
* Pairing learns your own remote's address, so the app controls only *your* fireplace.
* Homey follows the physical remote, using it updates Homey's state.

Like the physical remote, the fan and flame can only be changed while the fireplace is on.

Not supported:

* The remote's **AUX1** and **AUX2** buttons. They aren't wired to anything on the fireplace this
  was built against, so no RF was captured for them.

## Pairing

Homey learns which fireplace to talk to by listening to your existing remote. When adding the
device, hold the RC300 near Homey and press its **ON** or **OFF** button. Homey captures the
remote's address and transmits as that remote from then on.

## Protocol

The 433 MHz protocol was reverse-engineered from captures made with Homey's built-in RF signal
recorder. See [RF_PROTOCOL.md](RF_PROTOCOL.md) for the frame layout, the decoded payloads, and how
to capture and decode additional commands.
