'use strict';

const Homey = require('homey');
const { AristonApi } = require('../../lib/AristonApi');

class LydosHybridDriver extends Homey.Driver {

  async onInit() {
    this.homey.flow.getActionCard('set_mode')
      .registerRunListener(({ device, mode }) => device.triggerCapabilityListener('lydos_mode', mode));

    this.homey.flow.getConditionCard('mode_is')
      .registerRunListener(({ device, mode }) => device.getCapabilityValue('lydos_mode') === mode);

    this.homey.flow.getConditionCard('is_heating')
      .registerRunListener(({ device }) => device.getCapabilityValue('lydos_heating') === true);
  }

  async onPair(session) {
    // Only the credentials are kept between the two views; list_devices builds its
    // own client, so it does not depend on the login handler having run first.
    let credentials = null;

    session.setHandler('login', async ({ username, password }) => {
      this.log('Pair: checking credentials');
      const api = new AristonApi({ username, password, log: this.log.bind(this) });
      if (!await api.testCredentials()) {
        this.log('Pair: credentials rejected by the Ariston cloud');
        return false;
      }
      this.log('Pair: credentials accepted');
      credentials = { username, password };
      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('Pair: listing devices');
      if (!credentials) {
        this.error('Pair: list_devices called before a successful login');
        throw new Error(this.homey.__('errors.not_logged_in'));
      }

      const api = new AristonApi({ ...credentials, log: this.log.bind(this) });
      const plants = await api.getVelisPlants();
      this.log(`Found ${plants.length} Velis plant(s):`, plants.map(p => `${p.gw} sys=${p.sys} wheType=${p.wheType}`));

      const devices = plants
        .filter(plant => AristonApi.isLydosHybrid(plant))
        .map(plant => ({
          name: plant.name || `Lydos Hybrid ${plant.gw}`,
          data: { id: plant.gw },
          store: { ...credentials },
        }));

      if (devices.length === 0 && plants.length > 0) {
        this.error('Pair: water heaters found, but none matched sys=4 wheType=2');
      }
      return devices;
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const api = new AristonApi({ username, password, log: this.log.bind(this) });
      if (!await api.testCredentials()) return false;
      await device.updateCredentials({ username, password });
      return true;
    });
  }

}

module.exports = LydosHybridDriver;
