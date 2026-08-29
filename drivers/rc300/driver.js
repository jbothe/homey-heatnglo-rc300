'use strict';

const Homey = require('homey');

class Rc300Driver extends Homey.Driver {
    async onInit() {
        this.homey.flow.getActionCard('set_fan_speed')
            .registerRunListener(async (args) => {
                await args.device.triggerCapabilityListener('fan_level', args.speed);
            });

        this.homey.flow.getActionCard('set_flame_level')
            .registerRunListener(async (args) => {
                await args.device.triggerCapabilityListener('flame_level', args.level);
            });
    }

    async onPairListDevices() {
        return [
            {
                name: 'Heat N Glo RC300',
                data: {
                    id: 'rc300'
                }
            }
        ];
    }
}

module.exports = Rc300Driver;
