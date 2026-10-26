'use strict';

const Homey = require('homey');
const {
    SIGNAL_ID,
    ADDRESS_LENGTH,
    POWER,
    FAN,
    FLAME,
    sameAddress,
    isRepeatReception,
    commandToCapability,
} = require('./rc300-protocol');

class Rc300Device extends Homey.Device {
    // This method is called when the Device is initiated
    async onInit() {
        this.rc300Signal = this.homey.rf.getSignal433(SIGNAL_ID);

        // The last reception acted on, for collapsing repeats of one press.
        this.lastRx = null;

        // The address is learned from the user's own remote during pairing. There
        // is no default: transmitting an address we guessed would drive whichever
        // fireplace happens to answer to it, so a device without one stays
        // unavailable until it is added again.
        this.address = this.getStoreValue('address');
        if (!Array.isArray(this.address) || this.address.length !== ADDRESS_LENGTH) {
            this.error('no address stored; the device must be added again');
            await this.setUnavailable(this.homey.__('errors.not_paired'));
            return;
        }
        this.log(`initialised; address ${this.address.join('')}`);

        // Register the callback to handle state changes
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerCapabilityListener('fan_level', this.onCapabilityFanLevel.bind(this));
        this.registerCapabilityListener('flame_level', this.onCapabilityFlameLevel.bind(this));

        // Follow the physical remote, so Homey doesn't show stale state (and so
        // the fan/flame guard below knows whether the fireplace is really on).
        // Failing here must not stop the device from transmitting.
        this.onRX = this.onRX.bind(this);
        try {
            await this.driver.registerRXListener(this.onRX);
        } catch (err) {
            this.error('could not listen for the remote; state may go stale:', err.message);
        }
    }

    async onUninit() {
        await this.driver.unregisterRXListener(this.onRX).catch(() => {});
    }

    // Called for every RC300 frame Homey receives, from any remote.
    onRX(frame, isFirst) {
        // Each press is transmitted repeatedly; only act on it once.
        if (isFirst === false) return;

        // Ignore other fireplaces, and our own address only.
        if (!sameAddress(frame.address, this.address)) return;

        const now = Date.now();
        if (isRepeatReception(frame.command, now, this.lastRx)) return;
        this.lastRx = { command: frame.command, at: now };

        const update = commandToCapability(frame.command);
        if (update === null) return;

        // setCapabilityValue, not triggerCapabilityListener: this reflects a
        // change that already happened, and must not transmit it back.
        if (update.capability === 'onoff') {
            // onoff is Homey's own capability, so Homey fires its Flow cards
            // itself whenever the value changes.
            this.setCapabilityValue('onoff', update.value).catch(this.error);
        } else {
            // Nothing generates Flow cards for a custom capability, so
            // setLevel fires the hand-written trigger as well.
            this.setLevel(update.capability, update.value).catch(this.error);
        }

        this.log(`rx ${frame.command} from the remote`);
    }

    // Prefixes a command with this fireplace's address and transmits it.
    async send(name, command) {
        // An unknown enum value would otherwise spread `undefined` into the
        // payload and fail deep inside tx() with nothing to point at.
        if (!Array.isArray(command)) {
            this.error(`tx ${name}: no such command`);
            throw new Error(`Unknown command: ${name}`);
        }

        const payload = [...this.address, ...command];
        const startedAt = Date.now();

        try {
            // tx() resolves once Homey has queued the transmission, not once the
            // repetitions have finished going out, so this time is call latency
            // rather than airtime.
            await this.rc300Signal.tx(payload);
            this.log(`tx ${name} ok (queued in ${Date.now() - startedAt}ms)`);
        } catch (err) {
            this.error(`tx ${name} failed after ${Date.now() - startedAt}ms:`, err.message);
            this.error(`  payload was [${payload.join(',')}]`);
            throw err;
        }
    }

    // Reflects a new fan or flame level, and fires the Flow trigger for it.
    // Homey generates neither for a custom capability, so both routes to a new
    // value come through here: a press we heard on RX, and a change made from
    // Homey. A value that did not actually change fires nothing, which is also
    // what keeps one change from triggering twice should we ever hear our own
    // transmission back.
    async setLevel(capability, value) {
        if (this.getCapabilityValue(capability) === value) return;

        await this.setCapabilityValue(capability, value);

        // Not awaited: a Flow trigger that fails must not make a change the
        // fireplace has already acted on look like it failed.
        this.homey.flow.getDeviceTriggerCard(`${capability}_changed`)
            .trigger(this, {}, { value })
            .catch(this.error);
    }

    async onCapabilityOnOff(value) {
        await this.send(value ? 'power.on' : 'power.off', value ? POWER.on : POWER.off);
    }

    async onCapabilityFanLevel(value) {
        this.assertOn('fan speed');
        await this.send(`fan.${value}`, FAN[value]);
        await this.setLevel('fan_level', value);
    }

    async onCapabilityFlameLevel(value) {
        this.assertOn('flame level');
        await this.send(`flame.${value}`, FLAME[value]);
        await this.setLevel('flame_level', value);
    }

    // Just like the physical remote, the fan and flame can't be changed while
    // the fireplace is off.
    assertOn(what) {
        if (!this.getCapabilityValue('onoff')) {
            this.log(`refused to change ${what}: fireplace is off`);
            throw new Error(this.homey.__('errors.fireplace_off'));
        }
    }
}

module.exports = Rc300Device;
