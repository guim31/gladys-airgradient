#!/usr/bin/env node
// -----------------------------------------------------------------------------
// A fake AirGradient monitor on the loopback, for trying the integration (or
// scripts/probe.mjs) without the hardware:
//
//   node scripts/fake-airgradient.mjs [fixture] [port]
//   node scripts/probe.mjs 127.0.0.1:8080
//
// `fixture` is a file of test/fixtures/airgradient (default: one-3.1.21.json).
// The CO₂ and PM2.5 drift a little at every request.
// -----------------------------------------------------------------------------

import { FakeMonitor, fixture, startFakeServer } from '../test/helpers/fakeAirGradient.js';

const [name = 'one-3.1.21.json', port = '8080'] = process.argv.slice(2);
const measures = fixture(name);
const v1 = 'serialNumber' in measures;
const monitor = new FakeMonitor({
  measures,
  config: fixture(v1 ? 'config-go-v1.json' : 'config-one-local.json'),
  api: v1 ? 'v1' : 'legacy',
});

const handle = monitor.handle.bind(monitor);
monitor.handle = (method, path, body) => {
  const drift = () => Math.round((Math.random() - 0.5) * 40);
  const co2 = v1 ? 'co2' : 'rco2';
  if (typeof monitor.measures[co2] === 'number') {
    monitor.measures[co2] = Math.max(400, monitor.measures[co2] + drift());
  }
  return handle(method, path, body);
};

const { host } = await startFakeServer(monitor, { port: Number(port) });
console.log(`Fake ${measures.model} (${name}) listening on http://${host}`);
