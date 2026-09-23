'use strict';

const https = require('https');

// Atag is part of the Ariston group; Atag Lydos water heaters use the Ariston NET cloud.
// Endpoints follow the reverse-engineered python-ariston-api library (github.com/fustom/python-ariston-api).
const API_URL = 'https://www.ariston-net.remotethermo.com/api/v2/';
const USER_AGENT = 'RestSharp/106.11.7.0';
const PLANT_DATA = 'sePlantData';
const REQUEST_TIMEOUT = 30 * 1000;

const SYSTEM_TYPE_VELIS = 4;
const WHE_TYPE_LYDOS_HYBRID = 2;

// Lydos Hybrid operating modes as used by the cloud API
const MODES = {
  imemory: 1,
  green: 2,
  program: 6,
  boost: 7,
};

// Plant settings keys for the Lydos Hybrid (sePlantData)
const SETTINGS = {
  MAX_SETPOINT: 'SeMaxSetpointTemperature',
  MAX_GREEN_SETPOINT: 'SeMaxGreenSetpointTemperature',
};

class AristonApiError extends Error {

  constructor(message, statusCode, code) {
    super(message);
    this.name = 'AristonApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

}

function isClientError(statusCode) {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

class AristonApi {

  constructor({ username, password, log = () => {} }) {
    this.username = username;
    this.password = password;
    this.log = log;
    this.token = null;
  }

  static modeToId(mode) {
    return Object.keys(MODES).find(id => MODES[id] === mode) || null;
  }

  static idToMode(id) {
    if (!(id in MODES)) throw new Error(`Unknown mode: ${id}`);
    return MODES[id];
  }

  static isLydosHybrid(plant) {
    return plant.sys === SYSTEM_TYPE_VELIS && plant.wheType === WHE_TYPE_LYDOS_HYBRID;
  }

  // Concurrent callers (poll + a Flow action) share one login request instead of each logging in
  login() {
    if (!this.loginPromise) {
      this.loginPromise = this._login().finally(() => { this.loginPromise = null; });
    }
    return this.loginPromise;
  }

  async _login() {
    this.token = null;
    let res;
    try {
      res = await this._request('POST', 'accounts/login', { usr: this.username, pwd: this.password });
    } catch (err) {
      if (isClientError(err.statusCode)) throw new AristonApiError('Login failed: check e-mail and password', err.statusCode, 'AUTH_FAILED');
      throw err;
    }
    if (!res || !res.token) throw new AristonApiError('Login failed: no token received', 401, 'AUTH_FAILED');
    this.token = res.token;
  }

  // Returns true/false for valid/invalid credentials, throws on other errors (network, rate limit)
  async testCredentials() {
    try {
      await this.login();
      return true;
    } catch (err) {
      if (err.code === 'AUTH_FAILED') return false;
      throw err;
    }
  }

  async getVelisPlants() {
    const plants = await this._call('GET', 'velis/plants');
    return Array.isArray(plants) ? plants : [];
  }

  async getPlantData(gw) {
    return this._call('GET', `velis/${PLANT_DATA}/${encodeURIComponent(gw)}`);
  }

  async getPlantSettings(gw) {
    return this._call('GET', `velis/${PLANT_DATA}/${encodeURIComponent(gw)}/plantSettings`);
  }

  async setTemperature(gw, temperature) {
    await this._call('POST', `velis/${PLANT_DATA}/${encodeURIComponent(gw)}/temperature`, { new: temperature });
  }

  async setMode(gw, modeId) {
    await this._call('POST', `velis/${PLANT_DATA}/${encodeURIComponent(gw)}/mode`, { new: AristonApi.idToMode(modeId) });
  }

  async setPower(gw, on) {
    await this._call('POST', `velis/${PLANT_DATA}/${encodeURIComponent(gw)}/switch`, !!on);
  }

  // Authenticated call; logs in when needed and retries once when the token has expired
  async _call(method, path, body) {
    if (!this.token) await this.login();
    try {
      return await this._request(method, path, body);
    } catch (err) {
      // The Ariston cloud answers 405 on an expired token
      if (![401, 403, 405].includes(err.statusCode)) throw err;
      this.log('Token expired, logging in again');
      await this.login();
      return this._request(method, path, body);
    }
  }

  _request(method, path, body) {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    };
    if (this.token) headers['ar.authToken'] = this.token;
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(new URL(path, API_URL), { method, headers, timeout: REQUEST_TIMEOUT }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 429) {
            reject(new AristonApiError('Too many requests to the Ariston cloud, try again later', 429, 'RATE_LIMITED'));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new AristonApiError(`Ariston cloud returned HTTP ${res.statusCode} for ${method} ${path}`, res.statusCode));
            return;
          }
          if (!text) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new AristonApiError(`Invalid JSON from Ariston cloud for ${method} ${path}`, res.statusCode));
          }
        });
      });
      req.on('timeout', () => req.destroy(new AristonApiError(`Timeout for ${method} ${path}`)));
      req.on('error', reject);
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

}

module.exports = {
  AristonApi,
  AristonApiError,
  MODES,
  SETTINGS,
};
