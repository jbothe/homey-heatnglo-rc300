'use strict';

// Must come first: it answers the `require('homey')` that driver.js makes at
// load, which would otherwise throw outside the Homey runtime.
const { FakeSignal } = require('./helpers/homey-stub');

const test = require('node:test');
const assert = require('node:assert/strict');

const Rc300Driver = require('../drivers/rc300/driver');
const { POWER, FAN, FLAME } = require('../drivers/rc300/rc300-protocol');

// How long pairing listens for a press. Mirrors LEARN_TIMEOUT in driver.js,
// which isn't exported. It is user-facing -- the time someone has to reach for
// the remote -- so changing it should be deliberate enough to update this too.
const LEARN_TIMEOUT = 30_000;

// A stand-in per-unit address; see rc300-protocol.test.js.
const ADDRESS = [
    2, 3, 2, 2, 3, 3, 2, 1,
    3, 2, 2, 3, 2, 3, 3, 0,
    2, 2, 3, 3, 2, 2, 3, 1,
];

const frameFor = (command, address = ADDRESS) => [...address, ...command];

// Lets pending promise callbacks run. setImmediate rather than setTimeout, so it
// still works in the tests that mock timers.
const flush = () => new Promise(resolve => setImmediate(resolve));

// Marks when a promise settles, so a test can assert that it hasn't yet.
const track = (promise) => {
    const state = { settled: false };
    promise.then(() => { state.settled = true; }, () => { state.settled = true; });
    return state;
};

async function initDriver() {
    const driver = new Rc300Driver();
    await driver.onInit();
    return driver;
}

// The pairing session Homey hands to onPair: records what the driver shows the
// user, and can be made to fail.
class FakeSession {
    constructor() {
        this.emitted = [];
    }

    async emit(event, data) {
        this.emitted.push({ event, data });
    }
}

const failEnableRX = (driver) => {
    driver.signal.enableRX = async () => {
        driver.signal.enableCount += 1;
        throw new Error('radio busy');
    };
};

const restoreEnableRX = (driver) => {
    driver.signal.enableRX = FakeSignal.prototype.enableRX;
};

test('RX listener reference counting', async (t) => {
    // Homey's enableRX is per-signal, not per-listener, while paired devices and
    // pairing each need RX on independently. The driver counts listeners so the
    // signal is on exactly while at least one of them wants it.

    await t.test('enables RX for the first listener only', async () => {
        const driver = await initDriver();
        await driver.registerRXListener(() => {});
        await driver.registerRXListener(() => {});

        assert.equal(driver.signal.rxEnabled, true);
        assert.equal(driver.signal.enableCount, 1);
    });

    await t.test('disables RX only when the last listener goes', async () => {
        const driver = await initDriver();
        const a = () => {};
        const b = () => {};
        await driver.registerRXListener(a);
        await driver.registerRXListener(b);

        await driver.unregisterRXListener(a);
        assert.equal(driver.signal.rxEnabled, true);
        assert.equal(driver.signal.disableCount, 0);

        await driver.unregisterRXListener(b);
        assert.equal(driver.signal.rxEnabled, false);
        assert.equal(driver.signal.disableCount, 1);
    });

    await t.test('counts a listener registered twice only once', async () => {
        const driver = await initDriver();
        const calls = [];
        const listener = (frame) => calls.push(frame.command);
        await driver.registerRXListener(listener);
        await driver.registerRXListener(listener);

        driver.signal.receive(frameFor(POWER.on));
        assert.deepEqual(calls, ['power.on'], 'delivered more than once');

        // Had it been counted twice, one unregister would leave RX on.
        await driver.unregisterRXListener(listener);
        assert.equal(driver.signal.rxEnabled, false);
        assert.equal(driver.signal.enableCount, 1);
    });

    await t.test('ignores unregistering a listener it does not have', async () => {
        const driver = await initDriver();

        // With none registered, it must not switch off a signal it never enabled.
        await driver.unregisterRXListener(() => {});
        assert.equal(driver.signal.disableCount, 0);

        const listener = () => {};
        await driver.registerRXListener(listener);
        await driver.unregisterRXListener(() => {});
        assert.equal(driver.signal.rxEnabled, true);
        assert.equal(driver.signal.disableCount, 0);
    });

    await t.test('disables RX once, however many times a listener is removed', async () => {
        const driver = await initDriver();
        const listener = () => {};
        await driver.registerRXListener(listener);

        await driver.unregisterRXListener(listener);
        await driver.unregisterRXListener(listener);
        assert.equal(driver.signal.disableCount, 1);
    });

    await t.test('enables RX again after dropping to no listeners', async () => {
        const driver = await initDriver();
        const a = () => {};
        await driver.registerRXListener(a);
        await driver.unregisterRXListener(a);

        await driver.registerRXListener(() => {});
        assert.equal(driver.signal.rxEnabled, true);
        assert.equal(driver.signal.enableCount, 2);
    });

    await t.test('pairing finishing leaves RX on for a paired device', async () => {
        // The case the reference count exists for (see driver.js onInit).
        const driver = await initDriver();
        const heard = [];
        await driver.registerRXListener((frame) => heard.push(frame.command));

        const pairing = () => {};
        await driver.registerRXListener(pairing);
        await driver.unregisterRXListener(pairing);

        assert.equal(driver.signal.rxEnabled, true);
        assert.equal(driver.signal.disableCount, 0);

        driver.signal.receive(frameFor(FAN.med));
        assert.deepEqual(heard, ['fan.med']);
    });

    await t.test('a failure to enable RX does not stop the next listener enabling it', async () => {
        // device.js onInit catches this failure and carries on, so whatever
        // registers next has to get a fresh attempt at turning RX on -- not
        // find itself counted second behind a listener that was never served.
        const driver = await initDriver();
        failEnableRX(driver);
        await assert.rejects(driver.registerRXListener(() => {}), /radio busy/);
        assert.equal(driver.signal.rxEnabled, false);

        restoreEnableRX(driver);
        await driver.registerRXListener(() => {});
        assert.equal(driver.signal.rxEnabled, true, 'RX left off for every later listener');
    });
});

test('RX listener reference counting: known gap', async (t) => {
    // The rollback above covers a listener whose own enable fails. It does not
    // cover a second listener that registers while the first's enable is still
    // in flight: that one sees itself counted second, returns at once, and is
    // never told the enable failed -- so it stays counted with RX off, and the
    // original problem returns. Kept here as a todo so the gap is on record and
    // starts passing, visibly, once it is fixed.
    await t.test('a listener registering while RX is being enabled hears if that fails', {
        todo: 'needs the in-flight enable tracked; see the commit fixing the rollback',
    }, async () => {
        const driver = await initDriver();
        let rejectEnable;
        driver.signal.enableRX = () => new Promise((resolve, reject) => {
            rejectEnable = reject;
        });

        const first = driver.registerRXListener(() => {});
        const second = driver.registerRXListener(() => {});
        rejectEnable(new Error('radio busy'));

        await assert.rejects(first, /radio busy/);
        await assert.rejects(second, /radio busy/, 'second listener told nothing');

        restoreEnableRX(driver);
        await driver.registerRXListener(() => {});
        assert.equal(driver.signal.rxEnabled, true, 'RX left off for every later listener');
    });
});

test('onPayload', async (t) => {
    await t.test('hands every RC300 frame to every listener, with isFirst', async () => {
        const driver = await initDriver();
        const seen = [];
        await driver.registerRXListener((frame, isFirst) => seen.push(['a', frame, isFirst]));
        await driver.registerRXListener((frame, isFirst) => seen.push(['b', frame, isFirst]));

        driver.signal.receive(frameFor(FLAME[3]), false);

        const frame = { command: 'flame.3', address: ADDRESS };
        assert.deepEqual(seen, [['a', frame, false], ['b', frame, false]]);
    });

    await t.test('drops anything that is not an RC300 frame', async () => {
        // Another 433 MHz device that happens to fit the signal's timings.
        const driver = await initDriver();
        const seen = [];
        await driver.registerRXListener((frame) => seen.push(frame));

        driver.signal.receive(new Array(47).fill(2));
        driver.signal.receive([]);
        assert.deepEqual(seen, []);
    });

    await t.test('keeps delivering when one listener throws', async () => {
        // One device's bug must not deafen every other fireplace.
        const driver = await initDriver();
        const seen = [];
        await driver.registerRXListener(() => {
            throw new Error('boom');
        });
        await driver.registerRXListener((frame) => seen.push(frame.command));

        driver.signal.receive(frameFor(POWER.off));

        assert.deepEqual(seen, ['power.off']);
        assert.deepEqual(driver.errors, ['RX listener failed: boom']);
    });
});

test('learnAddress', async (t) => {
    await t.test('returns the address carried by an on/off press', async () => {
        for (const command of [POWER.on, POWER.off]) {
            const driver = await initDriver();
            const learning = driver.learnAddress(new FakeSession());
            await flush();

            driver.signal.receive(frameFor(command));
            assert.deepEqual(await learning, ADDRESS);
        }
    });

    await t.test('switches RX off again once it has the address', async () => {
        const driver = await initDriver();
        const learning = driver.learnAddress(new FakeSession());
        await flush();
        assert.equal(driver.signal.rxEnabled, true);

        driver.signal.receive(frameFor(POWER.on));
        await learning;
        assert.equal(driver.signal.rxEnabled, false);
        assert.equal(driver.signal.disableCount, 1);
    });

    await t.test('ignores fan and flame presses, but shows them to the user', async () => {
        // Only on/off is learned from -- unambiguous to press, and it works in
        // any fireplace state -- but every press is echoed to the pairing view
        // so the user can see their remote is being heard.
        const driver = await initDriver();
        const session = new FakeSession();
        const learning = driver.learnAddress(session);
        const state = track(learning);
        await flush();

        driver.signal.receive(frameFor(FAN.low));
        driver.signal.receive(frameFor(FLAME[2]));
        await flush();
        assert.equal(state.settled, false, 'learned from a fan or flame press');

        driver.signal.receive(frameFor(POWER.off));
        assert.deepEqual(await learning, ADDRESS);

        assert.deepEqual(session.emitted, [
            { event: 'rx', data: { heard: 1, command: 'fan.low' } },
            { event: 'rx', data: { heard: 2, command: 'flame.2' } },
            { event: 'rx', data: { heard: 3, command: 'power.off' } },
        ]);
    });

    await t.test('counts a press once, however many times it repeats', async () => {
        const driver = await initDriver();
        const session = new FakeSession();
        const learning = driver.learnAddress(session);
        const state = track(learning);
        await flush();

        // A held button: one frame flagged first, then the repeats.
        driver.signal.receive(frameFor(FAN.high), true);
        driver.signal.receive(frameFor(FAN.high), false);
        driver.signal.receive(frameFor(FAN.high), false);

        // Repeats of a power press are not a press either.
        driver.signal.receive(frameFor(POWER.on), false);
        await flush();
        assert.equal(state.settled, false, 'learned from a repeat frame');

        assert.deepEqual(session.emitted, [
            { event: 'rx', data: { heard: 1, command: 'fan.high' } },
        ]);

        driver.signal.receive(frameFor(POWER.on), true);
        await learning;
    });

    await t.test('gives up after LEARN_TIMEOUT', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const driver = await initDriver();
        const learning = driver.learnAddress(new FakeSession());
        const state = track(learning);
        await flush();

        t.mock.timers.tick(LEARN_TIMEOUT - 1);
        await flush();
        assert.equal(state.settled, false, 'gave up early');

        t.mock.timers.tick(1);
        await assert.rejects(learning, { message: 'pair.timeout' });
        assert.equal(driver.signal.rxEnabled, false);
    });

    await t.test('cancels the timeout once it has the address', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const driver = await initDriver();
        const learning = driver.learnAddress(new FakeSession());
        await flush();

        driver.signal.receive(frameFor(POWER.on));
        await learning;

        // A timer left running would fire later and log a timeout for a
        // pairing that succeeded.
        t.mock.timers.tick(LEARN_TIMEOUT * 2);
        await flush();
        assert.equal(driver.logs.some(line => line.includes('timed out')), false);
        assert.equal(driver.signal.disableCount, 1);
    });

    await t.test('fails at once, and cleanly, if RX cannot be enabled', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const driver = await initDriver();
        failEnableRX(driver);
        await assert.rejects(driver.learnAddress(new FakeSession()), /radio busy/);

        // No timer left behind to report a timeout later...
        t.mock.timers.tick(LEARN_TIMEOUT * 2);
        await flush();
        assert.equal(driver.logs.some(line => line.includes('timed out')), false);

        // ...and nothing left registered to block the next attempt.
        restoreEnableRX(driver);
        await driver.registerRXListener(() => {});
        assert.equal(driver.signal.rxEnabled, true);
    });

    await t.test('keeps listening if the pairing view cannot be updated', async () => {
        // The view may have closed under us; learning must not depend on it.
        const driver = await initDriver();
        const session = new FakeSession();
        session.emit = async () => {
            throw new Error('view closed');
        };

        const learning = driver.learnAddress(session);
        await flush();
        driver.signal.receive(frameFor(FAN.low));
        driver.signal.receive(frameFor(POWER.on));
        assert.deepEqual(await learning, ADDRESS);
    });

    await t.test('a paired device keeps hearing the remote through a pairing session', async () => {
        const driver = await initDriver();
        const heard = [];
        await driver.registerRXListener((frame) => heard.push(frame.command));

        const learning = driver.learnAddress(new FakeSession());
        await flush();
        driver.signal.receive(frameFor(POWER.on));
        await learning;

        assert.equal(driver.signal.rxEnabled, true, 'pairing switched RX off for the device');
        driver.signal.receive(frameFor(FLAME[1]));
        assert.deepEqual(heard, ['power.on', 'flame.1']);
    });
});
