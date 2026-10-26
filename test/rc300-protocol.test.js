'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ADDRESS_LENGTH,
    COMMAND_LENGTH,
    FRAME_LENGTH,
    POWER,
    FAN,
    FLAME,
    identifyFrame,
    isPowerCommand,
    sameAddress,
} = require('../drivers/rc300/rc300-protocol');

// A stand-in for a per-unit address. No real remote's address is published
// (it identifies one household's receiver), and the protocol treats the
// leading 24 symbols as opaque, so any plausible pattern will do: 2/3 symbols
// throughout, with the long-pulse markers that sit at positions 7, 15 and 23.
const ADDRESS = [
    2, 3, 2, 2, 3, 3, 2, 1,
    3, 2, 2, 3, 2, 3, 3, 0,
    2, 2, 3, 3, 2, 2, 3, 1,
];

// A second address, for checking that frames are matched against the right one.
const OTHER_ADDRESS = [
    3, 2, 3, 3, 2, 2, 3, 1,
    2, 3, 3, 2, 3, 2, 2, 0,
    3, 3, 2, 2, 3, 3, 2, 1,
];

// Every command the app knows, paired with the name identifyFrame gives it.
const ALL_COMMANDS = [
    ...Object.entries(POWER).map(([name, command]) => ({ name: `power.${name}`, command })),
    ...Object.entries(FAN).map(([name, command]) => ({ name: `fan.${name}`, command })),
    ...Object.entries(FLAME).map(([name, command]) => ({ name: `flame.${name}`, command })),
];

const POWER_COMMANDS = Object.values(POWER);
const NON_POWER_COMMANDS = [...Object.values(FAN), ...Object.values(FLAME)];

// What a remote puts on air: the unit's address followed by the button's suffix.
const frameFor = (command, address = ADDRESS) => [...address, ...command];

test('frame layout', async (t) => {
    await t.test('an address plus a command is exactly one frame', () => {
        assert.equal(ADDRESS_LENGTH, 24);
        assert.equal(COMMAND_LENGTH, 23);
        assert.equal(FRAME_LENGTH, 47);
        assert.equal(ADDRESS_LENGTH + COMMAND_LENGTH, FRAME_LENGTH);
    });

    await t.test('the test addresses are the length the protocol expects', () => {
        assert.equal(ADDRESS.length, ADDRESS_LENGTH);
        assert.equal(OTHER_ADDRESS.length, ADDRESS_LENGTH);
    });
});

test('command tables', async (t) => {
    await t.test('every command is one command-suffix long', () => {
        for (const { name, command } of ALL_COMMANDS) {
            assert.equal(command.length, COMMAND_LENGTH, `${name} is the wrong length`);
        }
    });

    await t.test('the tables cover exactly the buttons the app exposes', () => {
        assert.deepEqual(Object.keys(POWER), ['off', 'on']);
        assert.deepEqual(Object.keys(FAN), ['low', 'med', 'high']);
        assert.deepEqual(Object.keys(FLAME), ['1', '2', '3', '4', '5']);
    });

    await t.test('no two commands share a symbol pattern', () => {
        // RF_PROTOCOL.md: the command code space is shared between families --
        // ON and FAN LOW carry an identical code, as do OFF and FAN MED -- and
        // is disambiguated only by the family flag. The full suffixes must
        // still differ, or a received frame could be read as the wrong button.
        const seen = new Map();
        for (const { name, command } of ALL_COMMANDS) {
            const pattern = command.join(',');
            assert.equal(seen.has(pattern), false, `${name} collides with ${seen.get(pattern)}`);
            seen.set(pattern, name);
        }
    });
});

test('identifyFrame', async (t) => {
    await t.test('names every known command and hands back the address', () => {
        for (const { name, command } of ALL_COMMANDS) {
            assert.deepEqual(identifyFrame(frameFor(command)), { command: name, address: ADDRESS });
        }
    });

    await t.test('takes the address from the frame it was given', () => {
        const frame = identifyFrame(frameFor(POWER.on, OTHER_ADDRESS));
        assert.deepEqual(frame.address, OTHER_ADDRESS);
        assert.equal(frame.command, 'power.on');
    });

    await t.test('copies the address out, rather than aliasing the frame', () => {
        const frame = frameFor(POWER.on);
        const { address } = identifyFrame(frame);
        address[0] = 9;
        assert.equal(frame[0], ADDRESS[0]);
    });

    await t.test('rejects a frame of the wrong length', () => {
        const frame = frameFor(POWER.on);
        const wrongLength = [
            [],
            frame.slice(0, -1),
            frame.slice(1),
            [...frame, 2],
            [...ADDRESS],
            [...POWER.on],
        ];
        for (const payload of wrongLength) {
            assert.equal(identifyFrame(payload), null, `accepted ${payload.length} symbols`);
        }
    });

    await t.test('rejects a full-length frame whose command is unknown', () => {
        // An unrelated 433 MHz device that happens to transmit 47 symbols.
        assert.equal(identifyFrame([...ADDRESS, ...new Array(COMMAND_LENGTH).fill(2)]), null);
    });

    await t.test('rejects a command that is one symbol off a real one', () => {
        for (const { name, command } of ALL_COMMANDS) {
            for (let i = 0; i < COMMAND_LENGTH; i++) {
                const corrupted = [...command];
                corrupted[i] = corrupted[i] === 2 ? 3 : 2;
                if (corrupted[i] === command[i]) continue;
                assert.equal(
                    identifyFrame(frameFor(corrupted)),
                    null,
                    `accepted ${name} corrupted at symbol ${i}`,
                );
            }
        }
    });

    await t.test('rejects anything that is not an array', () => {
        const notArrays = [null, undefined, 0, 47, '', 'x'.repeat(FRAME_LENGTH), {}, { length: FRAME_LENGTH }, true];
        for (const payload of notArrays) {
            assert.equal(identifyFrame(payload), null, `accepted ${JSON.stringify(payload)}`);
        }
    });
});

test('isPowerCommand', async (t) => {
    // Pairing listens for on/off specifically (driver.js), so this has to agree
    // with the names identifyFrame produces -- not with hand-written strings.
    await t.test('accepts the names identifyFrame gives power frames', () => {
        for (const command of POWER_COMMANDS) {
            const { command: name } = identifyFrame(frameFor(command));
            assert.equal(isPowerCommand(name), true, `rejected ${name}`);
        }
    });

    await t.test('rejects the names it gives fan and flame frames', () => {
        for (const command of NON_POWER_COMMANDS) {
            const { command: name } = identifyFrame(frameFor(command));
            assert.equal(isPowerCommand(name), false, `accepted ${name}`);
        }
    });

    await t.test('requires the family separator, not just the prefix', () => {
        assert.equal(isPowerCommand('power'), false);
        assert.equal(isPowerCommand('powerful'), false);
        assert.equal(isPowerCommand('power_on'), false);
        assert.equal(isPowerCommand('flame.power.on'), false);
    });

    await t.test('rejects anything that is not a string', () => {
        for (const value of [null, undefined, 0, {}, ['power.on'], true]) {
            assert.equal(isPowerCommand(value), false, `accepted ${JSON.stringify(value)}`);
        }
    });
});

test('sameAddress', async (t) => {
    await t.test('matches an address against an equal one', () => {
        assert.equal(sameAddress(ADDRESS, [...ADDRESS]), true);
    });

    await t.test('rejects a different address', () => {
        assert.equal(sameAddress(ADDRESS, OTHER_ADDRESS), false);
    });

    await t.test('rejects an address differing at any single symbol', () => {
        // One household's remote must not drive another's fireplace, so every
        // position has to count -- a truncated comparison would pass here.
        for (let i = 0; i < ADDRESS_LENGTH; i++) {
            const other = [...ADDRESS];
            other[i] = other[i] === 2 ? 3 : 2;
            assert.notEqual(other[i], ADDRESS[i]);
            assert.equal(sameAddress(ADDRESS, other), false, `ignored symbol ${i}`);
        }
    });

    await t.test('rejects addresses of different lengths', () => {
        assert.equal(sameAddress(ADDRESS, ADDRESS.slice(0, -1)), false);
        assert.equal(sameAddress(ADDRESS.slice(0, -1), ADDRESS), false);
        assert.equal(sameAddress(ADDRESS, [...ADDRESS, 2]), false);
    });

    await t.test('compares symbols strictly, so "2" is not 2', () => {
        assert.equal(sameAddress([2, 3], ['2', '3']), false);
    });

    await t.test('rejects anything that is not an array', () => {
        for (const value of [null, undefined, 0, 'x', {}, { length: ADDRESS_LENGTH }]) {
            assert.equal(sameAddress(ADDRESS, value), false, `accepted ${JSON.stringify(value)}`);
            assert.equal(sameAddress(value, ADDRESS), false, `accepted ${JSON.stringify(value)}`);
        }
    });

    await t.test('treats two empty arrays as equal', () => {
        // Current behaviour, recorded rather than endorsed: an empty address is
        // not a real one. device.js checks the stored address against
        // ADDRESS_LENGTH before it ever gets here, so this cannot be reached
        // through the driver.
        assert.equal(sameAddress([], []), true);
    });
});
