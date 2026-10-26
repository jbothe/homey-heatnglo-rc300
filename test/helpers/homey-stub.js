'use strict';

// `homey` is supplied by the Homey runtime, not installed from npm, so
// `require('homey')` throws anywhere else. Both driver.js and device.js require
// it at module load, which puts every line in them out of reach of a test until
// that request can be answered.
//
// Rather than take on a dependency, this answers the one request for `homey`
// from the module loader with the fakes below -- the technique `proxyquire` and
// `mock-require` use. `node:test` has its own `mock.module()`, but that needs
// --experimental-test-module-mocks.
//
// Requiring this file installs the interception, so it must come before the
// first require of anything under drivers/.

const Module = require('node:module');

// The 433 MHz signal Homey hands the driver. Records what the driver asked of
// it, so tests can assert on enable/disable rather than on internal state.
class FakeSignal {
    constructor() {
        this.enableCount = 0;
        this.disableCount = 0;
        this.rxEnabled = false;
        this.payloadHandler = null;
    }

    on(event, handler) {
        if (event === 'payload') this.payloadHandler = handler;
    }

    async enableRX() {
        this.enableCount += 1;
        this.rxEnabled = true;
    }

    async disableRX() {
        this.disableCount += 1;
        this.rxEnabled = false;
    }

    // Stands in for a frame arriving on air.
    receive(payload, isFirst = true) {
        if (this.payloadHandler === null) throw new Error('nothing is listening for payloads');
        this.payloadHandler(payload, isFirst);
    }
}

// A Flow card. The driver only registers run listeners on these, so tests can
// reach a card's listener and call it the way Homey would.
class FakeFlowCard {
    constructor(id) {
        this.id = id;
        this.runListener = null;
    }

    registerRunListener(fn) {
        this.runListener = fn;
        return this;
    }
}

// The `this.homey` object: just the corners the driver actually touches.
class FakeHomey {
    constructor() {
        this.signal = new FakeSignal();
        this.cards = new Map();

        this.rf = {
            getSignal433: () => this.signal,
        };

        const card = (id) => {
            if (!this.cards.has(id)) this.cards.set(id, new FakeFlowCard(id));
            return this.cards.get(id);
        };

        this.flow = {
            getActionCard: card,
            getDeviceTriggerCard: card,
            getConditionCard: card,
        };
    }

    // Homey's translator. Returning the key keeps assertions readable.
    __(key) {
        return key;
    }
}

// Stands in for Homey.Driver / Homey.Device. Real ones carry far more, but the
// driver only uses log and error, plus the homey and manifest it is given.
class FakeBase {
    constructor() {
        this.homey = new FakeHomey();
        this.manifest = { name: 'Heat & Glo' };
        this.logs = [];
        this.errors = [];
    }

    log(...args) {
        this.logs.push(args.join(' '));
    }

    error(...args) {
        this.errors.push(args.join(' '));
    }
}

const homeyModule = {
    Driver: FakeBase,
    Device: FakeBase,
    App: FakeBase,
};

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'homey') return homeyModule;
    return load.call(this, request, ...rest);
};

module.exports = { FakeSignal, FakeFlowCard, FakeHomey, homeyModule };
