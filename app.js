'use strict';

const Homey = require('homey');

class Rc300App extends Homey.App {
    async onInit() {
        this.log('RC300 is running...');
    }
}

module.exports = Rc300App;
