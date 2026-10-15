#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real AirGradient monitor, through the integration's own
// HTTP client and parser:
//
//   node scripts/probe.mjs <ip[:port]>          what the integration would read
//   node scripts/probe.mjs <ip[:port]> --raw    the raw answers, anonymized, to
//                                               turn into test fixtures
//
// Only GET requests: /measures/current (or /api/v1/measures) and /config. The
// serial number is shortened, and the fields of /config that may hold
// credentials (MQTT broker URL, HTTP domain) are never printed.
// -----------------------------------------------------------------------------

import { AirGradientClient } from '../src/airgradient/client.js';
import { modelInfo, parseConfig } from '../src/airgradient/model.js';

const [host, flag] = process.argv.slice(2);
if (!host || host.startsWith('-')) {
  console.error('Usage: node scripts/probe.mjs <ip[:port]> [--raw]');
  process.exit(2);
}

const HIDDEN = ['mqttBrokerUrl', 'httpDomain'];
const mask = (serial) => (serial ? `…${String(serial).slice(-4)}` : '(none)');

function anonymize(document) {
  const copy = structuredClone(document);
  for (const key of ['serialno', 'serialNumber']) {
    if (typeof copy[key] === 'string') {
      copy[key] = `02c0ffee${copy[key].slice(-4)}`;
    }
  }
  for (const key of HIDDEN) {
    if (key in copy) {
      copy[key] = copy[key] ? '<hidden>' : '';
    }
  }
  return copy;
}

const client = new AirGradientClient(host);
try {
  const started = Date.now();
  const measures = await client.getMeasures();
  console.log(`Monitor at ${host}: answered in ${Date.now() - started} ms`);
  console.log(`  API format : ${measures.api}`);
  console.log(`  model      : ${measures.model} (${modelInfo(measures.model).name})`);
  console.log(`  firmware   : ${measures.firmware}`);
  console.log(`  serial     : ${mask(measures.serial)}`);
  console.log(`  boot count : ${measures.boot}`);
  console.log('  readings   :');
  for (const [key, value] of Object.entries(measures.values)) {
    console.log(`    ${key.padEnd(12)} ${value}`);
  }
  const expected = modelInfo(measures.model).expected.filter((key) => !(key in measures.values));
  if (expected.length > 0) {
    console.log(`  expected but missing now: ${expected.join(', ')}`);
  }

  let config = null;
  try {
    config = await client.getConfig();
    const { control, values } = parseConfig(config);
    console.log(`  settings   : configurationControl=${control}`);
    for (const [key, value] of Object.entries(values)) {
      console.log(`    ${key.padEnd(20)} ${value}`);
    }
  } catch (err) {
    console.log(`  settings   : not readable (${err.message})`);
  }

  if (flag === '--raw') {
    const route = measures.api === 'v1' ? '/api/v1/measures' : '/measures/current';
    console.log(`\n--- ${route}`);
    console.log(JSON.stringify(anonymize(await client.getJson(route)), null, 2));
    if (config) {
      console.log(`\n--- ${measures.api === 'v1' ? '/api/v1/config' : '/config'}`);
      console.log(JSON.stringify(anonymize(config), null, 2));
    }
  }
} catch (err) {
  console.error(`No AirGradient answer from ${host}: ${err.message}`);
  process.exit(1);
}
