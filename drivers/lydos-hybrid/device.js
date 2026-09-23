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
// Backoff after HTTP 429: 5, 10, 20, 40, 60 minutes
const RATE_LIMIT_BACKOFF_START = 5 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MAX = 60 * 60 * 1000;
// A Flow may set mode and temperature at the same time; give the mode change a moment
const PENDING_MODE_WAIT = 3 * 1000;

class LydosHybridDevice extends Homey.Device {

  async onInit() {
    this.gw = this.getData().id;
    this.plantSettings = {};
    this.settingsFetchedAt = 0;
    this.failures = 0;
    this.lastData = null;
    this.pendingMode = null;
    this.rateLimitedUntil = 0;
    this.rateLimitBackoff = 0;
    this.createApi();

    this.registerCapabilityListener('target_temperature', value => this.setTargetTemperature(value));
    this.registerCapabilityListener('lydos_mode', value => this.setMode(value));
    this.registerCapabilityListener('onoff', value => this.setPower(value));

    this.startPolling(this.getSetting('poll_interval'));
    this.poll();
  }

  onDeleted() {
    this.stopTimers();
  }

  onUninit() {
    this.stopTimers();
  }

  stopTimers() {
    this.homey.clearInterval(this.pollInterval);
    this.homey.clearTimeout(this.refreshTimeout);
    this.pollInterval = null;
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
    this.failures = 0;
    this.startPolling(this.getSetting('poll_interval'));
    this.poll();
  }

  startPolling(minutes = DEFAULT_POLL_INTERVAL_MINUTES) {
    this.homey.clearInterval(this.pollInterval);
    this.pollInterval = this.homey.setInterval(() => this.poll(), minutes * 60 * 1000);
  }

  // Poll again shortly after a change, so Homey shows the value the boiler actually accepted
  scheduleRefresh() {
    this.homey.clearTimeout(this.refreshTimeout);
    this.refreshTimeout = this.homey.setTimeout(() => {
      this.pendingMode = null;
      this.poll();
    }, REFRESH_AFTER_CHANGE_DELAY);
  }

  async poll() {
    if (Date.now() < this.rateLimitedUntil) return;
    try {
      if (Date.now() - this.settingsFetchedAt > SETTINGS_REFRESH_INTERVAL) {
        this.plantSettings = await this.api.getPlantSettings(this.gw) || {};
        this.settingsFetchedAt = Date.now();
        await this.updateTemperatureRange();
      }

      const data = await this.api.getPlantData(this.gw);
      if (!data) throw new Error(this.homey.__('errors.no_data'));
      this.lastData = data;
      await this.updateCapabilities(data);

      this.failures = 0;
      this.rateLimitBackoff = 0;
      if (!this.getAvailable()) await this.setAvailable();
      await this.unsetWarning().catch(this.error);
    } catch (err) {
      await this.handleError(err);
    }
  }

  async handleError(err) {
    this.failures++;
    this.error(`Poll failed (${this.failures}x):`, err.message);
    if (err.code === 'AUTH_FAILED') {
      // Keep trying with wrong credentials and the Ariston account gets locked: stop until repaired
      this.stopTimers();
      await this.setUnavailable(this.homey.__('errors.auth_failed')).catch(this.error);
      return;
    }
    if (err.code === 'RATE_LIMITED') {
      this.rateLimitBackoff = Math.min(RATE_LIMIT_BACKOFF_MAX, (this.rateLimitBackoff * 2) || RATE_LIMIT_BACKOFF_START);
      this.rateLimitedUntil = Date.now() + this.rateLimitBackoff;
      const minutes = Math.round(this.rateLimitBackoff / 60000);
      this.log(`Rate limited, pausing ${minutes} min`);
      await this.setWarning(this.homey.__('errors.rate_limited', { minutes })).catch(this.error);
      return;
    }
    if (this.failures >= FAILURES_BEFORE_UNAVAILABLE) {
      await this.setUnavailable(err.message).catch(this.error);
    }
  }

  async updateCapabilities(data) {
    const showersBefore = this.getCapabilityValue('lydos_showers');
    const heatingBefore = this.getCapabilityValue('lydos_heating');

    await this.setValue('measure_temperature', data.temp);
    await this.setValue('target_temperature', data.reqTemp);
    await this.setValue('onoff', data.on);
    await this.setValue('lydos_mode', AristonApi.modeToId(data.mode));
    await this.setValue('lydos_heating', data.heatReq);
    await this.setValue('lydos_showers', data.avShw);

    await this.triggerShowersBelow(showersBefore, data.avShw);
    await this.triggerHeatingChanged(heatingBefore, data.heatReq);
  }

  // Only fires on the poll where the count actually drops, so a Flow does not
  // run again on every poll while the shower count stays low.
  async triggerShowersBelow(previous, current) {
    if (typeof previous !== 'number' || typeof current !== 'number') return;
    if (current >= previous) return;
    await this.driver.showersBelowTrigger
      .trigger(this, { showers: current }, { previous, current })
      .catch(this.error);
  }

  async triggerHeatingChanged(previous, current) {
    if (typeof previous !== 'boolean' || typeof current !== 'boolean' || previous === current) return;
    const trigger = current ? this.driver.heatingStartedTrigger : this.driver.heatingStoppedTrigger;
    await trigger.trigger(this, { temperature: this.getCapabilityValue('measure_temperature') || 0 })
      .catch(this.error);
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

  // Mode that will be active once pending changes are processed
  currentMode() {
    return this.pendingMode || this.getCapabilityValue('lydos_mode');
  }

  async setTargetTemperature(value) {
    const temperature = Math.round(value);
    const maxGreen = this.plantSettings[SETTINGS.MAX_GREEN_SETPOINT] || DEFAULT_MAX_GREEN_TEMPERATURE;
    if (this.currentMode() === 'green' && temperature > maxGreen) {
      // A Flow that sets "Boost" and a high temperature together: wait for the mode change
      await new Promise(resolve => this.homey.setTimeout(resolve, PENDING_MODE_WAIT));
      if (this.currentMode() === 'green') {
        throw new Error(this.homey.__('errors.green_max', { max: maxGreen }));
      }
    }
    if (this.lastData && this.lastData.reqTemp === temperature && !this.pendingMode) {
      this.log(`Target temperature already ${temperature} °C, not sending`);
      return;
    }
    this.log(`Setting target temperature to ${temperature} °C`);
    await this.call(() => this.api.setTemperature(this.gw, temperature));
    if (this.lastData) this.lastData.reqTemp = temperature;
    this.scheduleRefresh();
  }

  async setMode(mode) {
    if (this.lastData && AristonApi.modeToId(this.lastData.mode) === mode && !this.pendingMode) {
      this.log(`Mode already ${mode}, not sending`);
      return;
    }
    this.log(`Setting mode to ${mode}`);
    this.pendingMode = mode;
    try {
      await this.call(() => this.api.setMode(this.gw, mode));
    } catch (err) {
      this.pendingMode = null;
      throw err;
    }
    this.scheduleRefresh();
  }

  async setPower(on) {
    if (this.lastData && this.lastData.on === on) {
      this.log(`Already ${on ? 'on' : 'off'}, not sending`);
      return;
    }
    this.log(`Turning ${on ? 'on' : 'off'}`);
    await this.call(() => this.api.setPower(this.gw, on));
    if (this.lastData) this.lastData.on = on;
    this.scheduleRefresh();
  }

  // Commands respect the rate-limit pause as well
  async call(fn) {
    if (Date.now() < this.rateLimitedUntil) {
      const minutes = Math.ceil((this.rateLimitedUntil - Date.now()) / 60000);
      throw new Error(this.homey.__('errors.rate_limited', { minutes }));
    }
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'RATE_LIMITED' || err.code === 'AUTH_FAILED') await this.handleError(err);
      throw err;
    }
  }

}

module.exports = LydosHybridDevice;
