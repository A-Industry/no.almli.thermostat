'use strict';

const Homey = require('homey');

class PIDVThermoApp extends Homey.App {

    async onInit() {
        this.log('PID VThermo is running...');
    }

}

module.exports = PIDVThermoApp;
