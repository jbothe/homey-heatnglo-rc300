'use strict';

const Homey = require('homey');
const { SIGNAL_ID, LEGACY_ADDRESS, POWER, FAN, FLAME, sameAddress } = require('./rc300-protocol');

// One press of the remote can reach us as two or three separate receptions: the
// `isFirst` flag only groups frames Homey heard as a single burst, and reception
// dropping briefly mid-transmission starts a new one. Collapsing repeats of the
// same command within this window is safe because every RC300 command is
// absolute ("set flame to 3"), never relative ("flame up"), so a suppressed
// duplicate can never lose information.
const RX_REPEAT_WINDOW = 2000;

class Rc300Device extends Homey.Device {
    // This method is called when the Device is initiated
    async onInit() {
        this.rc300Signal = this.homey.rf.getSignal433(SIGNAL_ID);

        // Devices paired before the app learned addresses per-unit have nothing
        // stored, so fall back to the address this app shipped with.
        const learned = this.getStoreValue('address');
        this.address = learned || LEGACY_ADDRESS;
        this.log(`initialised; address ${this.address.join('')}`,
            learned ? '(learned at pairing)' : '(fallback: paired before addresses were learned)');

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
        if (frame.command === this.lastRxCommand && now - this.lastRxAt < RX_REPEAT_WINDOW) {
            return;
        }
        this.lastRxCommand = frame.command;
        this.lastRxAt = now;

        const [family, value] = frame.command.split('.');

        // setCapabilityValue, not triggerCapabilityListener: this reflects a
        // change that already happened, and must not transmit it back.
        switch (family) {
            case 'power':
                this.setCapabilityValue('onoff', value === 'on').catch(this.error);
                break;
            case 'fan':
                this.setCapabilityValue('fan_level', value).catch(this.error);
                break;
            case 'flame':
                this.setCapabilityValue('flame_level', value).catch(this.error);
                break;
            default:
                return;
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

    async onCapabilityOnOff(value) {
        await this.send(value ? 'power.on' : 'power.off', value ? POWER.on : POWER.off);
    }

    async onCapabilityFanLevel(value) {
        this.assertOn('fan speed');
        await this.send(`fan.${value}`, FAN[value]);
    }

    async onCapabilityFlameLevel(value) {
        this.assertOn('flame level');
        await this.send(`flame.${value}`, FLAME[value]);
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
