'use strict';

// RC300 frame layout. See RF_PROTOCOL.md for how this was reverse-engineered.
//
// Every frame is 47 symbols and splits cleanly in two:
//
//   [ 0..23 ] address  - identifies the remote/receiver pair, identical across
//                        every command from a given remote
//   [ 24..46 ] command - which button was pressed, identical across every remote
//                        (as far as we can tell from a single unit)
//
// A device therefore stores its own address once at pair time, and transmits
// `address + command` for each action.

// One signal definition serves both directions: the properties that differ
// between transmitting and receiving (repetitions, sensitivity, rxTimeout) only
// affect one direction each, so there is no need to split them.
const SIGNAL_ID = 'rc300';

const ADDRESS_LENGTH = 24;
const COMMAND_LENGTH = 23;
const FRAME_LENGTH = ADDRESS_LENGTH + COMMAND_LENGTH;

// The address of the unit this app was originally developed against. Devices
// that were paired before pairing learned the address per-unit have nothing in
// their store, and fall back to this so they keep working.
const LEGACY_ADDRESS = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0];

const POWER = {
    off: [2, 2, 2, 2, 2, 3, 2, 1, 3, 3, 2, 3, 3, 3, 2, 0, 2, 2, 3, 2, 2, 2, 3],
    on:  [2, 2, 2, 2, 2, 2, 3, 1, 3, 3, 2, 3, 3, 2, 3, 0, 2, 2, 3, 2, 2, 3, 2],
};

// Keyed by the `fan_level` capability value.
const FAN = {
    low:  [3, 2, 2, 2, 2, 2, 3, 0, 2, 3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 2, 2, 3, 2],
    med:  [3, 2, 2, 2, 2, 3, 2, 0, 2, 3, 2, 3, 3, 3, 2, 1, 3, 2, 3, 2, 2, 2, 3],
    high: [3, 2, 2, 2, 2, 3, 3, 0, 2, 3, 2, 3, 3, 3, 3, 1, 3, 2, 3, 2, 2, 2, 2],
};

// Keyed by the `flame_level` capability value.
const FLAME = {
    1: [2, 3, 3, 2, 2, 2, 3, 0, 2, 2, 3, 3, 3, 2, 3, 1, 3, 3, 2, 2, 2, 3, 2],
    2: [2, 3, 3, 2, 2, 3, 2, 0, 2, 2, 3, 3, 3, 3, 2, 1, 3, 3, 2, 2, 2, 2, 3],
    3: [2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 3, 3, 3, 3, 3, 1, 3, 3, 2, 2, 2, 2, 2],
    4: [2, 3, 3, 2, 3, 2, 2, 0, 2, 3, 2, 2, 2, 2, 2, 1, 3, 2, 3, 3, 3, 3, 3],
    5: [2, 3, 3, 2, 3, 2, 3, 0, 2, 3, 2, 2, 2, 2, 3, 1, 3, 2, 3, 3, 3, 3, 2],
};

// Every known command, keyed by its symbols, so a received frame can be named.
const COMMAND_BY_SUFFIX = new Map();
for (const [name, command] of Object.entries(POWER)) {
    COMMAND_BY_SUFFIX.set(command.join(','), `power.${name}`);
}
for (const [name, command] of Object.entries(FAN)) {
    COMMAND_BY_SUFFIX.set(command.join(','), `fan.${name}`);
}
for (const [name, command] of Object.entries(FLAME)) {
    COMMAND_BY_SUFFIX.set(command.join(','), `flame.${name}`);
}

// Identifies a received frame. Returns { command, address } when the frame is
// the right length and ends in a command we recognise, otherwise null. Used
// during pairing so we only learn from an actual RC300 remote, rather than from
// an unrelated 433 MHz device that happens to be in range.
function identifyFrame(payload) {
    if (!Array.isArray(payload) || payload.length !== FRAME_LENGTH) {
        return null;
    }

    const command = COMMAND_BY_SUFFIX.get(payload.slice(ADDRESS_LENGTH).join(','));
    if (command === undefined) {
        return null;
    }

    return { command, address: payload.slice(0, ADDRESS_LENGTH) };
}

// Pairing listens for the on/off buttons specifically: they're unambiguous to
// press, and unlike fan/flame they work regardless of the fireplace's state.
function isPowerCommand(command) {
    return typeof command === 'string' && command.startsWith('power.');
}

// Whether a received frame belongs to a given fireplace, so one household's
// remote can't drive another's device.
function sameAddress(a, b) {
    return Array.isArray(a)
        && Array.isArray(b)
        && a.length === b.length
        && a.every((symbol, i) => symbol === b[i]);
}

module.exports = {
    SIGNAL_ID,
    ADDRESS_LENGTH,
    COMMAND_LENGTH,
    FRAME_LENGTH,
    LEGACY_ADDRESS,
    POWER,
    FAN,
    FLAME,
    identifyFrame,
    isPowerCommand,
    sameAddress,
};
