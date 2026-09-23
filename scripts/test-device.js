'use strict';

// Offline test of the device logic with a simulated Homey:  node scripts/test-device.js
const assert = require('assert');
const Module = require('module');

class FakeDevice {
  constructor() {
    this.caps = { lydos_mode: 'green', target_temperature: 45, onoff: true, lydos_heating: false };
    this.available = true;
    const timers = new Set();
    this.homey = {
      __: (key, vars) => `${key}${vars ? JSON.stringify(vars) : ''}`,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
      clearTimeout: clearTimeout,
      setInterval: (fn, ms) => { const t = setInterval(fn, 1e9); timers.add(t); return t; },
      clearInterval: (t) => { clearInterval(t); timers.delete(t); },
      timers,
    };
  }
  log() {}
  error() {}
  getData() { return { id: 'GW1' }; }
  getStore() { return { username: 'u', password: 'p' }; }
  getSetting() { return 5; }
  registerCapabilityListener() {}
  getCapabilityValue(c) { return this.caps[c]; }
  async setCapabilityValue(c, v) { this.caps[c] = v; }
  hasCapability() { return true; }
  getAvailable() { return this.available; }
  async setAvailable() { this.available = true; }
  async setUnavailable() { this.available = false; }
  async setWarning(w) { this.warning = w; }
  async unsetWarning() { this.warning = null; }
  getCapabilityOptions() { return {}; }
  async setCapabilityOptions() {}
}

const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'homey') return { Device: FakeDevice };
  return origLoad.call(this, request, ...rest);
};
const Device = require('../drivers/lydos-hybrid/device');

function makeDevice(apiOverrides = {}) {
  const d = new Device();
  d.driver = { showersBelowTrigger: { trigger: async () => {} },
    heatingStartedTrigger: { trigger: async () => { d.started = (d.started || 0) + 1; } },
    heatingStoppedTrigger: { trigger: async () => {} } };
  d.sent = [];
  d.startPolling = function start() { this.pollInterval = this.homey.setInterval(() => {}, 1); };
  d.poll = async () => {};
  d.onInit();
  Object.assign(d.api, {
    getPlantSettings: async () => ({}),
    getPlantData: async () => ({ temp: 44, reqTemp: 45, mode: 2, on: true, heatReq: false, avShw: 3 }),
    setTemperature: async (gw, t) => d.sent.push(['temp', t]),
    setMode: async (gw, m) => d.sent.push(['mode', m]),
    setPower: async (gw, on) => d.sent.push(['power', on]),
    ...apiOverrides,
  });
  delete d.poll; // use the real poll from here on
  return d;
}

(async () => {
  // skip unchanged
  let d = makeDevice();
  await d.poll();
  await d.setTargetTemperature(45);
  assert.deepStrictEqual(d.sent, [], 'same temperature is not sent');
  await d.setTargetTemperature(50);
  assert.deepStrictEqual(d.sent, [['temp', 50]], 'new temperature is sent');

  // Boost + 60 °C in one Flow: temperature first, mode shortly after
  d = makeDevice();
  await d.poll();
  const temp = d.setTargetTemperature(60);
  await d.setMode('boost');
  await temp;
  assert.deepStrictEqual(d.sent, [['mode', 'boost'], ['temp', 60]], 'temperature waits for pending mode');

  // Green stays limited
  d = makeDevice();
  await d.poll();
  await assert.rejects(d.setTargetTemperature(60), /green_max/, 'green max still enforced');

  // heating started trigger
  d = makeDevice();
  await d.poll();
  d.api.getPlantData = async () => ({ temp: 44, reqTemp: 45, mode: 2, on: true, heatReq: true, avShw: 3 });
  await d.poll();
  assert.strictEqual(d.started, 1, 'heating started trigger fired once');

  // auth failure stops polling
  d = makeDevice({ getPlantData: async () => { const e = new Error('auth'); e.code = 'AUTH_FAILED'; throw e; } });
  await d.poll();
  assert.strictEqual(d.available, false, 'unavailable after auth failure');
  assert.strictEqual(d.pollInterval, null, 'polling stopped after auth failure');

  // rate limit backoff doubles and blocks commands
  d = makeDevice({ getPlantData: async () => { const e = new Error('429'); e.code = 'RATE_LIMITED'; throw e; } });
  await d.poll();
  assert.strictEqual(d.rateLimitBackoff, 5 * 60 * 1000, 'first backoff 5 min');
  d.rateLimitedUntil = 0;
  await d.poll();
  assert.strictEqual(d.rateLimitBackoff, 10 * 60 * 1000, 'second backoff 10 min');
  await assert.rejects(d.setTargetTemperature(50), /rate_limited/, 'commands blocked during backoff');

  console.log('device tests ok');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
