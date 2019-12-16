'use strict';

const Homey = require('homey'),
    devicesLib = require('../../lib/devices'),
    temperatureLib = require('../../lib/temperature'),
    Controller = require('node-pid-controller');

class PIDVThermoDevice extends Homey.Device {

    async onInit() {
        this.log('virtual device initialized');

        this._turnedOnTrigger = new Homey.FlowCardTriggerDevice('vt_onoff_true');
        this._turnedOnTrigger
            .register();

        this._turnedOffTrigger = new Homey.FlowCardTriggerDevice('vt_onoff_false');
        this._turnedOffTrigger
            .register();


        this._heatingHistory = [];

        new Homey.FlowCardCondition('vt_onoff_is_on')
            .register()
            .registerRunListener((args, state) => args.device.getCapabilityValue('vt_onoff'));

        if (this.hasCapability('onoff')) {
            this.registerCapabilityListener('onoff', async (value, opts) => {
                this.clearHistory();
                return this.checkTemp({onoff: value});
            });
        }

        this.registerCapabilityListener('target_temperature', async (value, opts) => {
            return this.checkTemp({target_temperature: value});
        });

        this.checkAvailable();
        this.checkTemp();
    }

    async onAdded() {
        this.log('virtual device added:', this.getData().id);
        await this.setCapabilityValue('onoff', true);
    }

    onDeleted() {
        this.clearCheckAvailable();
        this.clearCheckTime();
        this.log('virtual device deleted');
    }

    clearCheckAvailable() {
        if (this.curCheckAvailableTimeout) {
            clearTimeout(this.curCheckAvailableTimeout);
            this.curCheckAvailableTimeout = undefined;
        }
    }

    scheduleCheckAvailable() {
        this.clearCheckAvailable();
        this.curCheckAvailableTimeout = setTimeout(this.checkAvailable.bind(this), 180000);
    }

    async checkAvailable() {
        if (this.getAvailable() !== true) {
            this.log(`checkAvailable: ${this.getAvailable()}`);
        }
        await this.setAvailable();
        this.scheduleCheckAvailable();
    }

    clearCheckTime() {
        if (this.curTimeout) {
            clearTimeout(this.curTimeout);
            this.curTimeout = undefined;
        }
    }

    scheduleCheckTemp(seconds = 60) {
        this.clearCheckTime();
        this.log(`Checking temp in ${seconds} seconds`);
        this.curTimeout = setTimeout(this.checkTemp.bind(this), seconds * 1000);
    }

    addOnOffToHeatingHistory(onOff) {
        this._heatingHistory.push(onOff);

        if(this._heatingHistory.length > 60) {
            this._heatingHistory = this._heatingHistory.slice(1);
        }

        this.log('_heatingHistory length:', this._heatingHistory.length);
    }

    heatingAllowed(allowedMinsOfHeatingPerHour) {
        allowedMinsOfHeatingPerHour = allowedMinsOfHeatingPerHour < 1 ? 0 : allowedMinsOfHeatingPerHour;
        const minsOfHeatingPastHour = this._heatingHistory.filter(Boolean).length;

        const result = minsOfHeatingPastHour < allowedMinsOfHeatingPerHour;

        return result;
    }

    checkControllerState() {
        const settings = this.getSettings();

        if(!this._ctr || this._prev_k_d !== settings.k_d || this._prev_k_i !== settings.k_i || this._prev_k_p !== settings.k_p) {
            this._prev_k_p = settings.k_p;
            this._prev_k_i = settings.k_i;
            this._prev_k_d = settings.k_d;

            this._ctr = new Controller({
                k_p: settings.k_p,
                k_i: settings.k_i,
                k_d: settings.k_d,
                i_max: 60,
                dt: 60
            });
        }
    }

    clearHistory() {
        this.log('Reset history and controller');

        this._heatingHistory = [];
        this._ctr = null;
    }

    async checkTemp(opts) {
        this.clearCheckTime();

        this.checkControllerState();

        let devices = await devicesLib.getDevices(this);
        if (!devices) {
            this.scheduleCheckTemp();
            return Promise.resolve();
        }

        let device = devicesLib.getDeviceByDeviceId(this.getData().id, devices);
        if (!device) {
            this.scheduleCheckTemp();
            return Promise.resolve();
        }
        let zoneId = device.zone;

        let targetTemp = temperatureLib.findTargetTemperature(this, opts);
        if (targetTemp === undefined || targetTemp === null) {
            this.scheduleCheckTemp();
            return Promise.resolve();
        }

        let temperature = await temperatureLib.findTemperature(this, zoneId, devices);
        if (temperature === undefined || temperature === null) {
            this.scheduleCheckTemp();
            return Promise.resolve();
        }

        let contactAlarm = temperatureLib.hasContactAlarm(this, zoneId, devices, this.getSettings());
        let onoff = await temperatureLib.resolveOnoff(this, temperature, targetTemp, this.getSettings(), opts, contactAlarm);

        console.log('Debugging: would have turned on or off device: ' + (onoff ? 'on': 'off'));

        this.addOnOffToHeatingHistory(onoff);

        await temperatureLib.switchHeaterDevices(this, zoneId, devices, onoff);

        this.scheduleCheckTemp();
        return Promise.resolve();
    }

}

module.exports = PIDVThermoDevice;
