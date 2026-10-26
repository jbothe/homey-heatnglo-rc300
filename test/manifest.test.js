'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SIGNAL_ID,
    FRAME_LENGTH,
    FAN,
    FLAME,
} = require('../drivers/rc300/rc300-protocol');

// The generated manifest, which is what Homey actually loads. Asserting against
// it rather than the `.homeycompose/` sources covers the merged result, cards
// and capabilities included.
const manifest = require('../app.json');

// Each level capability, the command table that has to back it, and the Flow
// cards that offer its values in a dropdown. Naming the cards here means this
// also fails if one is renamed or dropped.
const LEVELS = [
    {
        capability: 'fan_level',
        commands: FAN,
        arg: 'speed',
        cards: {
            triggers: 'fan_level_changed',
            conditions: 'fan_level_is',
            actions: 'set_fan_speed',
        },
    },
    {
        capability: 'flame_level',
        commands: FLAME,
        arg: 'level',
        cards: {
            triggers: 'flame_level_changed',
            conditions: 'flame_level_is',
            actions: 'set_flame_level',
        },
    },
];

const dropdownValues = (kind, cardId, argName) => {
    const card = (manifest.flow?.[kind] ?? []).find(c => c.id === cardId);
    assert.ok(card, `no ${kind} card \`${cardId}\` in the manifest`);

    const arg = (card.args ?? []).find(a => a.name === argName);
    assert.ok(arg, `card \`${cardId}\` has no arg \`${argName}\``);
    assert.equal(arg.type, 'dropdown', `arg \`${argName}\` of \`${cardId}\` is not a dropdown`);

    return arg.values.map(v => v.id);
};

test('capabilities match the command tables', async (t) => {
    for (const { capability, commands } of LEVELS) {
        await t.test(`${capability} offers exactly the values it can transmit`, () => {
            // A value in the picker with no command behind it reaches
            // device.send() as `undefined` and throws `Unknown command`; a
            // command with no value is simply unreachable. Either way the two
            // lists have to be identical, in the same order the picker shows.
            const capabilityValues = manifest.capabilities?.[capability]?.values;
            assert.ok(capabilityValues, `no capability \`${capability}\` in the manifest`);

            assert.deepEqual(capabilityValues.map(v => v.id), Object.keys(commands));
        });
    }
});

test('flow cards match the command tables', async (t) => {
    for (const { capability, commands, arg, cards } of LEVELS) {
        for (const [kind, cardId] of Object.entries(cards)) {
            await t.test(`${kind} \`${cardId}\` offers the ${capability} values`, () => {
                // These dropdowns are hand-written -- Homey only generates cards
                // for its own capabilities -- so nothing but this keeps them in
                // step with the capability and the RF commands.
                assert.deepEqual(dropdownValues(kind, cardId, arg), Object.keys(commands));
            });
        }
    }
});

test('the signal definition matches the frame layout', async (t) => {
    const signal = manifest.signals?.['433']?.[SIGNAL_ID];

    await t.test(`the 433 MHz signal is registered as \`${SIGNAL_ID}\``, () => {
        assert.ok(signal, `no 433 MHz signal \`${SIGNAL_ID}\` in the manifest`);
    });

    await t.test('it accepts frames of exactly one frame length', () => {
        // RF_PROTOCOL.md: every payload is exactly FRAME_LENGTH symbols. Widen
        // these and Homey hands up payloads identifyFrame rejects; narrow them
        // and it stops matching real frames at all.
        assert.equal(signal.minimalLength, FRAME_LENGTH);
        assert.equal(signal.maximalLength, FRAME_LENGTH);
    });
});
