'use strict';

const Homey = require('homey');
const { SIGNAL_ID, identifyFrame, isPowerCommand } = require('./rc300-protocol');

// How long to listen for a button press before giving up, in milliseconds.
const LEARN_TIMEOUT = 30000;

class Rc300Driver extends Homey.Driver {
    async onInit() {
        this.learnAttempts = 0;

        // RX is shared: every paired device listens so it can follow the physical
        // remote, and pairing listens to learn a new address. Homey's enableRX is
        // per-signal rather than per-listener, so it is reference counted here —
        // otherwise pairing finishing would switch RX off for every device.
        this.rxListeners = new Set();
        this.signal = this.homey.rf.getSignal433(SIGNAL_ID);
        this.signal.on('payload', this.onPayload.bind(this));

        this.homey.flow.getActionCard('set_fan_speed')
            .registerRunListener(async (args) => {
                await args.device.triggerCapabilityListener('fan_level', args.speed);
            });

        this.homey.flow.getActionCard('set_flame_level')
            .registerRunListener(async (args) => {
                await args.device.triggerCapabilityListener('flame_level', args.level);
            });
    }

    onPayload(payload, isFirst) {
        const frame = identifyFrame(payload);
        if (frame === null) {
            // Something else on 433 MHz that happens to fit our timings.
            return;
        }

        for (const listener of this.rxListeners) {
            try {
                listener(frame, isFirst);
            } catch (err) {
                this.error('RX listener failed:', err.message);
            }
        }
    }

    async registerRXListener(listener) {
        if (this.rxListeners.has(listener)) return;
        this.rxListeners.add(listener);

        if (this.rxListeners.size === 1) {
            await this.signal.enableRX();
            this.log('RX enabled');
        }
    }

    async unregisterRXListener(listener) {
        if (!this.rxListeners.delete(listener)) return;

        if (this.rxListeners.size === 0) {
            await this.signal.disableRX();
            this.log('RX disabled');
        }
    }

    async onPair(session) {
        // The address learned from the remote in this pairing session.
        let address = null;

        session.setHandler('learn', async () => {
            address = null;
            address = await this.learnAddress(session);
        });

        session.setHandler('list_devices', async () => {
            if (address === null) {
                this.log('[pair] list_devices called with no learned address');
                return [];
            }

            return [
                {
                    // Take the name from the driver manifest so it stays in step
                    // with it, and in the user's language.
                    name: this.homey.__(this.manifest.name),
                    // The address makes this stable across re-pairs, and unique
                    // if a household has more than one fireplace.
                    data: { id: `rc300-${address.join('')}` },
                    store: { address },
                },
            ];
        });
    }

    // Listens for an on/off frame from a physical RC300 remote and returns the
    // address it carries, so this Homey device can transmit as that remote.
    async learnAddress(session) {
        const attempt = ++this.learnAttempts;
        const log = (...args) => this.log(`[pair #${attempt}]`, ...args);
        let heard = 0;

        log('listening for an on/off press');

        let listener = null;
        const stop = async () => {
            if (listener !== null) {
                await this.unregisterRXListener(listener).catch(() => {});
                listener = null;
            }
        };

        try {
            return await new Promise((resolve, reject) => {
                let timer = null;

                const settle = (fn, arg) => {
                    if (timer !== null) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    stop().then(() => fn(arg));
                };

                listener = (frame, isFirst) => {
                    // Each press is transmitted repeatedly; only count it once.
                    if (isFirst === false) return;

                    heard += 1;
                    log(`heard #${heard}: ${frame.command}`);
                    session.emit('rx', { heard, command: frame.command }).catch(() => {});

                    // Only on/off: they're unambiguous to press, and they work
                    // whatever state the fireplace is in.
                    if (!isPowerCommand(frame.command)) return;

                    log(`matched ${frame.command}; address:`, JSON.stringify(frame.address));
                    settle(resolve, frame.address);
                };

                timer = setTimeout(() => {
                    log(`timed out after ${LEARN_TIMEOUT}ms; ${heard} frame(s) heard`);
                    settle(reject, new Error(this.homey.__('pair.timeout')));
                }, LEARN_TIMEOUT);

                this.registerRXListener(listener).catch(err => {
                    log('could not enable RX:', err.message);
                    settle(reject, err);
                });
            });
        } finally {
            await stop();
        }
    }
}

module.exports = Rc300Driver;
