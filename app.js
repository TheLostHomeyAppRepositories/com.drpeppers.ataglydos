'use strict';

const Homey = require('homey');

class AtagLydosApp extends Homey.App {

  async onInit() {
    this.log('Atag Lydos app has been initialized');
  }

}

module.exports = AtagLydosApp;
