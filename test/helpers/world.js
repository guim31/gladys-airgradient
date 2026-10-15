// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake AirGradient monitors on an
// in-memory network, the mDNS results the core would relay, a manual clock, a
// temporary /data, and the integration wired on top through registerHandlers.
// Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeMonitor, createFakeNetwork, fixture, mdnsResult } from './fakeAirGradient.js';

process.env.LOG_LEVEL ??= 'silent';

/** The usual home: a ONE, two Open Air, a DIY kit and a Go, all announced over mDNS. */
export function createHome() {
  return {
    '192.0.2.10': new FakeMonitor({ measures: fixture('one-3.1.21.json') }),
    '192.0.2.11': new FakeMonitor({ measures: fixture('open-air-o-1ppt-3.3.9.json') }),
    '192.0.2.12': new FakeMonitor({ measures: fixture('open-air-0-1ps-3.3.9.json') }),
    '192.0.2.13': new FakeMonitor({ measures: fixture('diy-basic-3.3.9.json') }),
    '192.0.2.14': new FakeMonitor({
      measures: fixture('go-v1-full.json'),
      config: fixture('config-go-v1.json'),
      api: 'v1',
    }),
  };
}

/** A manual clock. */
export function createClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.monitors] `{ host: FakeMonitor }` (default: createHome())
 * @param {string[]|null} [options.announced] hosts announced over mDNS (default: all), null: no capture
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/airgradient.json before the start
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the hub's own timers run (mock them)
 * @param {object} [options.clock] from createClock, or null for Date.now
 */
export async function createWorld({
  config = {},
  monitors = createHome(),
  announced,
  devices = [],
  saved,
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-airgradient-')),
} = {}) {
  const network = createFakeNetwork(monitors);
  const mdnsHosts = announced === undefined ? Object.keys(monitors) : announced;
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults:
      mdnsHosts === null ? {} : { mdns: mdnsHosts.map((host) => mdnsResult(host, monitors[host])) },
  });
  if (mdnsHosts === null) {
    // An older core, or the capture refused.
    gladys.scanNetwork = async () => {
      throw new Error('403 network_discovery not declared');
    };
  }
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const app = registerHandlers(gladys, {
    store,
    fetch: network.fetch,
    timers,
    now: clock ? clock.now : undefined,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    network,
    monitors,
    clock,
    store,
    dataDir,
  };
}

/** The discovered device of a monitor, by its host. */
export function discovered(world, host) {
  const serial = world.monitors[host].serial;
  return world.fake.discoveredDevices.find((device) => device.external_id.endsWith(`:${serial}`));
}

/** Create the device of a monitor in Gladys, as the user would. */
export async function create(world, host) {
  const device = discovered(world, host);
  if (!device) {
    throw new Error(`${host} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) => `${device.external_id}:${key}`;

/** One reading cycle, the clock moved by one period first. */
export async function cycle(world, ms = 60_000) {
  world.clock?.advance(ms);
  await world.hub.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
