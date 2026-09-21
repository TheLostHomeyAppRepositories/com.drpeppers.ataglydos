'use strict';

const Homey = require('homey');
const { AristonApi, SETTINGS } = require('../../lib/AristonApi');

const MIN_TEMPERATURE = 40;
const DEFAULT_MAX_TEMPERATURE = 70;
// In GREEN mode only the heat pump heats, which reaches at most 53 °C
const DEFAULT_MAX_GREEN_TEMPERATURE = 53;
const DEFAULT_POLL_INTERVAL_MINUTES = 5;
const SETTINGS_REFRESH_INTERVAL = 60 * 60 * 1000;
const REFRESH_AFTER_CHANGE_DELAY = 15 * 1000;
const FAILURES_BEFORE_UNAVAILABLE = 3;

class LydosHybridDevice extends Homey.Device {

  async onInit() {
    this.gw = this.getData().id;
    this.plantSettings = {};
    this.settingsFetchedAt = 0;
    this.failures = 0;
    this.createApi();

    this.registerCapabilityListener('target_temperature', value => this.setTargetTemperature(value));
    this.registerCapabilityListener('lydos_mode', value => this.setMode(value));
    this.registerCapabilityListener('onoff', value => this.setPower(value));

    this.startPolling(this.getSetting('poll_interval'));
    this.poll();
  }

  onDeleted() {
    this.homey.clearInterval(this.pollInterval);
    this.homey.clearTimeout(this.refreshTimeout);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('poll_interval')) this.startPolling(newSettings.poll_interval);
  }

  createApi() {
    const { username, password } = this.getStore();
    this.api = new AristonApi({ username, password, log: this.log.bind(this) });
  }

  async updateCredentials({ username, password }) {
    await this.setStoreValue('username', username);
    await this.setStoreValue('password', password);
    this.createApi();
    this.poll();
  }

  startPolling(minutes = DEFAULT_POLL_INTERVAL_MINUTES) {
    this.homey.clearInterval(this.pollInterval);
    this.pollInterval = this.homey.setInterval(() => this.poll(), minutes * 60 * 1000);
  }

  // Poll again shortly after a change, so Homey shows the value the boiler actually accepted
  scheduleRefresh() {
    this.homey.clearTimeout(this.refreshTimeout);
    this.refreshTimeout = this.homey.setTimeout(() => this.poll(), REFRESH_AFTER_CHANGE_DELAY);
  }

  async poll() {
    try {
      if (Date.now() - this.settingsFetchedAt > SETTINGS_REFRESH_INTERVAL) {
        this.plantSettings = await this.api.getPlantSettings(this.gw) || {};
        this.settingsFetchedAt = Date.now();
        await this.updateTemperatureRange();
      }

      const data = await this.api.getPlantData(this.gw);
      if (!data) throw new Error(this.homey.__('errors.no_data'));
      await this.updateCapabilities(data);

      this.failures = 0;
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      this.failures++;
      this.error(`Poll failed (${this.failures}x):`, err.message);
      if (err.code === 'AUTH_FAILED') {
        await this.setUnavailable(this.homey.__('errors.auth_failed')).catch(this.error);
      } else if (this.failures >= FAILURES_BEFORE_UNAVAILABLE) {
        await this.setUnavailable(err.message).catch(this.error);
      }
    }
  }

  async updateCapabilities(data) {
    await this.setValue('measure_temperature', data.temp);
    await this.setValue('target_temperature', data.reqTemp);
    await this.setValue('onoff', data.on);
    await this.setValue('lydos_mode', AristonApi.modeToId(data.mode));
    await this.setValue('lydos_heating', data.heatReq);
    await this.setValue('lydos_showers', data.avShw);
  }

  async setValue(capability, value) {
    if (value === undefined || value === null) return;
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  // The maximum setpoint is configurable on the boiler (installer parameter, 65-75 °C)
  async updateTemperatureRange() {
    const max = this.plantSettings[SETTINGS.MAX_SETPOINT] || DEFAULT_MAX_TEMPERATURE;
    const options = this.getCapabilityOptions('target_temperature') || {};
    if (options.max === max) return;
    this.log(`Target temperature range: ${MIN_TEMPERATURE}-${max} °C`);
    await this.setCapabilityOptions('target_temperature', {
      ...options, min: MIN_TEMPERATURE, max, step: 1, decimals: 0,
    });
  }

  async setTargetTemperature(value) {
    const temperature = Math.round(value);
    const maxGreen = this.plantSettings[SETTINGS.MAX_GREEN_SETPOINT] || DEFAULT_MAX_GREEN_TEMPERATURE;
    if (this.getCapabilityValue('lydos_mode') === 'green' && temperature > maxGreen) {
      throw new Error(this.homey.__('errors.green_max', { max: maxGreen }));
    }
    this.log(`Setting target temperature to ${temperature} °C`);
    await this.api.setTemperature(this.gw, temperature);
    this.scheduleRefresh();
  }

  async setMode(mode) {
    this.log(`Setting mode to ${mode}`);
    await this.api.setMode(this.gw, mode);
    this.scheduleRefresh();
  }

  async setPower(on) {
    this.log(`Turning ${on ? 'on' : 'off'}`);
    await this.api.setPower(this.gw, on);
    this.scheduleRefresh();
  }

}

module.exports = LydosHybridDevice;
