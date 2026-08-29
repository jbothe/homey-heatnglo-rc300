'use strict';

const Homey = require('homey');

const RC300_OFF = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 2, 2, 2, 3, 2, 1, 3, 3, 2, 3, 3, 3, 2, 0, 2, 2, 3, 2, 2, 2, 3];
const RC300_ON = [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 2, 2, 2, 2, 3, 1, 3, 3, 2, 3, 3, 2, 3, 0, 2, 2, 3, 2, 2, 3, 2];

// Keyed by the `fan_level` capability value (an enum id: "low" / "med" / "high").
const RC300_FAN_LEVEL = {
    low:  [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 2, 3, 0, 2, 3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 2, 2, 3, 2],
    med:  [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 3, 2, 0, 2, 3, 2, 3, 3, 3, 2, 1, 3, 2, 3, 2, 2, 2, 3],
    high: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 3, 2, 2, 2, 2, 3, 3, 0, 2, 3, 2, 3, 3, 3, 3, 1, 3, 2, 3, 2, 2, 2, 2],
};

// Keyed by the `flame_level` capability value (an enum id: "1".."5").
const RC300_FLAME_LEVEL = {
    1: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 2, 3, 0, 2, 2, 3, 3, 3, 2, 3, 1, 3, 3, 2, 2, 2, 3, 2],
    2: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 2, 0, 2, 2, 3, 3, 3, 3, 2, 1, 3, 3, 2, 2, 2, 2, 3],
    3: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 2, 3, 3, 3, 3, 3, 1, 3, 3, 2, 2, 2, 2, 2],
    4: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 3, 2, 2, 0, 2, 3, 2, 2, 2, 2, 2, 1, 3, 2, 3, 3, 3, 3, 3],
    5: [2, 2, 3, 2, 2, 2, 3, 1, 3, 2, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 2, 3, 3, 0, 2, 3, 3, 2, 3, 2, 3, 0, 2, 3, 2, 2, 2, 2, 3, 1, 3, 2, 3, 3, 3, 3, 2],
};

class Rc300Device extends Homey.Device {
    // This method is called when the Device is initiated
    async onInit() {
        this.rc300Signal = this.homey.rf.getSignal433('rc300');

        // Register the callback to handle state changes
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerCapabilityListener('fan_level', this.onCapabilityFanLevel.bind(this));
        this.registerCapabilityListener('flame_level', this.onCapabilityFlameLevel.bind(this));
    }

    async onCapabilityOnOff(value) {
        await this.rc300Signal.tx(value ? RC300_ON : RC300_OFF);
    }

    async onCapabilityFanLevel(value) {
        // Just like the physical remote, fan speed can't be changed while the fireplace is off.
        if (!this.getCapabilityValue('onoff')) {
            throw new Error(this.homey.__('errors.fireplace_off'));
        }
        await this.rc300Signal.tx(RC300_FAN_LEVEL[value]);
    }

    async onCapabilityFlameLevel(value) {
        // Just like the physical remote, flame level can't be changed while the fireplace is off.
        if (!this.getCapabilityValue('onoff')) {
            throw new Error(this.homey.__('errors.fireplace_off'));
        }
        await this.rc300Signal.tx(RC300_FLAME_LEVEL[value]);
    }
}

module.exports = Rc300Device;
