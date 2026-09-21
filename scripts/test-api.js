'use strict';

// Test the Ariston/Atag cloud connection without Homey.
//
//   node scripts/test-api.js                 read devices, state and settings
//   node scripts/test-api.js --set-temp 50   also change the target temperature
//
// Credentials are asked interactively (password hidden), or taken from the
// ARISTON_USERNAME / ARISTON_PASSWORD environment variables.

const readline = require('readline');
const { AristonApi } = require('../lib/AristonApi');

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = text => {
        if (text.includes(question)) rl.output.write(text);
      };
    }
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function parseArgs() {
  const i = process.argv.indexOf('--set-temp');
  if (i === -1) return {};
  const setTemp = Number(process.argv[i + 1]);
  if (!Number.isFinite(setTemp)) throw new Error('--set-temp needs a number, e.g. --set-temp 50');
  return { setTemp };
}

async function main() {
  const { setTemp } = parseArgs();
  const username = process.env.ARISTON_USERNAME || await ask('Atag/Ariston e-mail: ');
  const password = process.env.ARISTON_PASSWORD || await ask('Password: ', true);

  const api = new AristonApi({ username, password, log: console.log });

  console.log('\nLogging in...');
  if (!await api.testCredentials()) {
    console.error('Login failed: check e-mail and password (the same as in the Atag app).');
    process.exitCode = 1;
    return;
  }
  console.log('Login OK');

  const plants = await api.getVelisPlants();
  console.log(`\nFound ${plants.length} water heater(s):`);
  for (const p of plants) {
    console.log(`  - gw=${p.gw} name="${p.name}" sys=${p.sys} wheType=${p.wheType} wheModelType=${p.wheModelType} lydosHybrid=${AristonApi.isLydosHybrid(p)}`);
  }

  const plant = plants.find(p => AristonApi.isLydosHybrid(p)) || plants[0];
  if (!plant) return;

  console.log(`\nPlant data for ${plant.gw}:`);
  const data = await api.getPlantData(plant.gw);
  console.log(JSON.stringify(data, null, 2));
  if (data) console.log(`Mode: ${AristonApi.modeToId(data.mode) || data.mode}`);

  console.log(`\nPlant settings for ${plant.gw}:`);
  console.log(JSON.stringify(await api.getPlantSettings(plant.gw), null, 2));

  if (setTemp !== undefined) {
    console.log(`\nSetting target temperature to ${setTemp} °C...`);
    await api.setTemperature(plant.gw, setTemp);
    const after = await api.getPlantData(plant.gw);
    console.log(`reqTemp is now ${after && after.reqTemp} °C (the boiler may need a moment to report the new value)`);
  }
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});
