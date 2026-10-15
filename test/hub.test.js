// -----------------------------------------------------------------------------
// The hub end to end, on the SDK's fake Gladys and fake monitors: discovery,
// states, reachability, persistence, settings, the configuration actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeMonitor, fixture } from './helpers/fakeAirGradient.js';
import { create, createWorld, cycle, discovered, featureId } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const keysOf = (device) => device.features.map((feature) => feature.external_id.split(':').pop());

test('the monitors announced over mDNS are in the Discovery list, measurements only', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices.length, 5);
  const one = discovered(w, '192.0.2.10');
  assert.equal(one.name, 'AirGradient ONE 0002');
  assert.equal(one.external_id, 'ext:test-integration:monitor:02c0ffee0002');
  assert.deepEqual(keysOf(one), [
    'pm01',
    'pm25',
    'pm10',
    'co2',
    'temperature',
    'humidity',
    'tvoc_index',
    'nox_index',
    'pm003_count',
    'wifi',
  ]);
  assert.deepEqual(one.params, [
    { name: 'HOST', value: '192.0.2.10' },
    { name: 'SERIAL', value: '02c0ffee0002' },
    { name: 'MODEL', value: 'I-9PSL' },
    { name: 'FIRMWARE', value: '3.1.21' },
  ]);
  // No CO₂ sensor on an O-1PPT, no TVOC sensor on an 0-1PS.
  assert.ok(!keysOf(discovered(w, '192.0.2.11')).includes('co2'));
  assert.ok(!keysOf(discovered(w, '192.0.2.12')).includes('tvoc_index'));
  assert.ok(keysOf(discovered(w, '192.0.2.14')).includes('battery'));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing is published for a device the user has not created.
  assert.equal(w.fake.states.length, 0);
});

test('without mDNS, the typed addresses are read; the bad ones are reported', async (t) => {
  const w = await world(t, {
    announced: null,
    config: { hosts: '192.0.2.10, 300.0.0.1' },
  });
  assert.equal(w.fake.discoveredDevices.length, 1);
  const report = await w.fake.action('search', {});
  assert.match(report.data.message.en, /1 monitor\(s\), 1 answering: AirGradient ONE 0002/);
  assert.match(report.data.message.en, /mDNS\) through Gladys is unavailable/);
  assert.match(report.data.message.fr, /Adresses ignorées : 300\.0\.0\.1\./);
});

test('nothing found: the configuration screen says so', async (t) => {
  const w = await world(t, { monitors: {} });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /No AirGradient monitor found/);
  const report = await w.fake.action('search', {});
  assert.match(report.data.message.de, /Kein AirGradient-Messgerät gefunden/);
});

test('a created device gets its states at once, then only what changed', async (t) => {
  const w = await world(t);
  const device = await create(w, '192.0.2.10');
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566);
  assert.equal(w.fake.lastState(featureId(device, 'pm25')), 6.8);
  assert.equal(w.fake.lastState(featureId(device, 'temperature')), 20.4);
  assert.equal(w.fake.lastState(featureId(device, 'wifi')), -40);
  const first = w.fake.states.length;
  assert.equal(first, 10);

  await cycle(w);
  assert.equal(w.fake.states.length, first, 'nothing changed, nothing sent');

  w.monitors['192.0.2.10'].set({ rco2: 812, atmpCompensated: 20.37 });
  await cycle(w);
  // 20.37 rounds to 20.4: unchanged. Only the CO₂ moved.
  assert.deepEqual(
    w.fake.states.slice(first).map((state) => [state.device_feature_external_id, state.state]),
    [[featureId(device, 'co2'), 812]],
  );
  assert.deepEqual(w.fake.transports, [
    { device_external_id: device.external_id, transport: 'local' },
  ]);
});

test('a stable value is sent again every 12 hours (heartbeat)', async (t) => {
  // The SDK dates what it published with Date.now().
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  const w = await world(t, { clock: null });
  const device = await create(w, '192.0.2.10');
  const count = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === featureId(device, 'co2'))
      .length;
  assert.equal(count(), 1);
  t.mock.timers.tick(6 * 60 * 60_000);
  await w.hub.runCycle();
  assert.equal(count(), 1);
  t.mock.timers.tick(6 * 60 * 60_000);
  await w.hub.runCycle();
  assert.equal(count(), 2);
});

test('a monitor unplugged: unreachable after three readings, the trigger fires once', async (t) => {
  const w = await world(t);
  const device = await create(w, '192.0.2.10');
  w.monitors['192.0.2.10'].online = false;
  await cycle(w);
  await cycle(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'two failures are not enough');
  await cycle(w);
  await cycle(w);
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.deepEqual(w.fake.sceneEvents[0], {
    key: 'monitor_unreachable',
    data: { device: device.external_id, name: device.name, address: '192.0.2.10' },
  });
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  // The other monitors are not created: the only one created does not answer.
  assert.equal(w.fake.connectionStatus.connected, true);

  w.monitors['192.0.2.10'].online = true;
  w.monitors['192.0.2.10'].set({ rco2: 700 });
  await cycle(w);
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 700);
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('every monitor silent: the connection status says no monitor answers', async (t) => {
  const monitors = { '192.0.2.10': new FakeMonitor({ measures: fixture('one-3.1.1.json') }) };
  const w = await world(t, { monitors });
  await create(w, '192.0.2.10');
  monitors['192.0.2.10'].online = false;
  for (let i = 0; i < 3; i += 1) {
    await cycle(w);
  }
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Aucun capteur AirGradient ne répond/);
});

test('a monitor that moved to another address (DHCP) is found again by mDNS', async (t) => {
  const monitors = { '192.0.2.10': new FakeMonitor({ measures: fixture('one-3.1.1.json') }) };
  const w = await world(t, { monitors });
  const device = await create(w, '192.0.2.10');
  // The monitor now answers at .20, and mDNS announces it there.
  w.network.hosts['192.0.2.20'] = monitors['192.0.2.10'];
  delete w.network.hosts['192.0.2.10'];
  w.fake.scanResults.mdns[0].addresses = ['192.0.2.20'];
  // Three silent readings, more than 5 minutes after the last scan.
  for (let i = 0; i < 3; i += 1) {
    await cycle(w, 2 * 60_000);
  }
  // The unreachable monitor asked for a new scan, in the background.
  assert.ok(w.hub.rescan);
  await w.hub.rescan;
  assert.equal(w.hub.monitors.get('02c0ffee0001').host, '192.0.2.20');
  const republished = w.fake.discoveredDevices.find((d) => d.external_id === device.external_id);
  assert.deepEqual(republished.params[0], { name: 'HOST', value: '192.0.2.20' });
  monitors['192.0.2.10'].set({ rco2: 640 });
  await cycle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 640);
});

test('a monitor read right after a boot keeps the features of its family', async (t) => {
  const monitors = {
    '192.0.2.10': new FakeMonitor({ measures: fixture('one-after-boot-3.0.8.json') }),
  };
  const w = await world(t, { monitors });
  const device = discovered(w, '192.0.2.10');
  assert.equal(device.features.length, 10);
  assert.ok(keysOf(device).includes('co2'));
});

test('a DIY kit gets the features it reports, and new ones when they appear', async (t) => {
  const monitors = {
    '192.0.2.13': new FakeMonitor({ measures: fixture('diy-basic-3.3.9.json') }),
  };
  const w = await world(t, { monitors });
  assert.ok(!keysOf(discovered(w, '192.0.2.13')).includes('tvoc_index'));
  // A TVOC/NOx sensor added to the kit: the device grows, never shrinks.
  monitors['192.0.2.13'].set({ tvocIndex: 100, noxIndex: 1 });
  await w.fake.scanRequest();
  assert.ok(keysOf(discovered(w, '192.0.2.13')).includes('tvoc_index'));
  delete monitors['192.0.2.13'].measures.tvocIndex;
  await w.fake.scanRequest();
  assert.ok(keysOf(discovered(w, '192.0.2.13')).includes('tvoc_index'));
});

test('a restart knows the monitors from /data, even when they are off', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'airgradient.json'), 'utf8'));
  assert.equal(Object.keys(saved.monitors).length, 5);
  assert.equal(saved.monitors['02c0ffee0005'].api, 'v1');
  assert.ok(!JSON.stringify(saved).includes('Brightness'), 'no monitor settings stored');

  const w = await world(t, { monitors: {}, announced: [], saved });
  assert.equal(w.fake.discoveredDevices.length, 5);
});

test('a device whose /data entry is lost is rebuilt from its parameters', async (t) => {
  const seed = await createWorld();
  const device = discovered(seed, '192.0.2.10');
  await seed.app.stop();
  const w = await world(t, { announced: [], devices: [device] });
  assert.ok(w.hub.monitors.has('02c0ffee0002'));
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566);
});

test('the core poll is a fallback: skipped while the timer has just read', async (t) => {
  const w = await world(t);
  const device = await create(w, '192.0.2.10');
  const reads = () =>
    w.network.requests.filter((r) => r.host === '192.0.2.10' && r.path === '/measures/current')
      .length;
  const before = reads();
  w.clock.advance(30_000);
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(reads(), before);
  w.clock.advance(30_000);
  await w.fake.poll(device);
  assert.equal(reads(), before + 1);
});

test('a reconnection publishes everything again', async (t) => {
  const w = await world(t);
  const device = await create(w, '192.0.2.10');
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length, count + 10);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566);
});

test('device_settings adds the settings of a ONE; they read and write /config', async (t) => {
  const w = await world(t, { config: { device_settings: 'on', language: 'en' } });
  const one = discovered(w, '192.0.2.10');
  const settings = one.features.filter((feature) => !feature.read_only);
  assert.deepEqual(
    settings.map((f) => [f.name, f.category, f.type]),
    [
      ['Display brightness', 'switch', 'dimmer'],
      ['LED bar brightness', 'switch', 'dimmer'],
      ['LED bar mode', 'text', 'select'],
      ['Display temperature unit', 'text', 'select'],
    ],
  );
  assert.deepEqual(
    settings[2].supported_options.map((o) => o.value),
    ['off', 'co2', 'pm'],
  );
  // Only the ONE and the DIY kits have settings.
  assert.equal(discovered(w, '192.0.2.11').features.filter((f) => !f.read_only).length, 0);
  assert.equal(discovered(w, '192.0.2.13').features.filter((f) => !f.read_only).length, 2);
  assert.equal(discovered(w, '192.0.2.14').features.filter((f) => !f.read_only).length, 0);

  await create(w, '192.0.2.10');
  assert.equal(w.fake.lastState(featureId(one, 'display_brightness')), 0);
  const modeState = w.fake.states.findLast(
    (state) => state.device_feature_external_id === featureId(one, 'led_bar_mode'),
  );
  assert.equal(modeState.text, 'co2');

  const feature = (key) => one.features.find((f) => f.external_id === featureId(one, key));
  assert.equal((await w.fake.setValue(one, feature('display_brightness'), 35)).success, true);
  assert.equal(w.monitors['192.0.2.10'].config.displayBrightness, 35);
  assert.equal(w.fake.lastState(featureId(one, 'display_brightness')), 35);
  assert.equal((await w.fake.setValue(one, feature('led_bar_mode'), 'pm')).success, true);
  assert.equal(w.monitors['192.0.2.10'].config.ledBarMode, 'pm');
  const refused = await w.fake.setValue(one, feature('led_bar_mode'), 'disco');
  assert.equal(refused.success, false);
  assert.match(refused.error, /"disco" is not a valid value/);
  const measure = await w.fake.setValue(one, feature('co2'), 400);
  assert.equal(measure.success, false);
});

test('a monitor locked to the cloud: the setting is refused, "Use local settings" unlocks it', async (t) => {
  const monitors = {
    '192.0.2.10': new FakeMonitor({
      measures: fixture('one-3.1.1.json'),
      config: fixture('config-one-cloud.json'),
    }),
  };
  const w = await world(t, { monitors, config: { device_settings: 'on', language: 'fr' } });
  const one = await create(w, '192.0.2.10');
  const brightness = one.features.find(
    (f) => f.external_id === featureId(one, 'display_brightness'),
  );
  const refused = await w.fake.setValue(one, brightness, 50);
  assert.equal(refused.success, false);
  assert.match(refused.error, /n'accepte que les réglages du cloud AirGradient/);

  const done = await w.fake.action('use_local_settings', { device: one.external_id });
  assert.match(done.data.message.en, /now takes its settings from the local network only/);
  assert.equal(monitors['192.0.2.10'].config.configurationControl, 'local');
  const again = await w.fake.action('use_local_settings', { device: one.external_id });
  assert.match(again.data.message.es, /ya solo acepta los ajustes de la red local/);

  assert.equal((await w.fake.setValue(one, brightness, 50)).success, true);
  assert.equal(monitors['192.0.2.10'].config.displayBrightness, 50);

  const unknown = await w.fake.action('use_local_settings', { device: 'ext:test-integration:x' });
  assert.match(unknown.data.message.de, /Unbekanntes AirGradient-Messgerät/);
});

test('switching the settings on later adds the features: Gladys offers "Update"', async (t) => {
  const w = await world(t);
  await create(w, '192.0.2.10');
  assert.equal(discovered(w, '192.0.2.10').features.length, 10);
  await w.fake.configUpdated({ device_settings: 'on' });
  assert.equal(discovered(w, '192.0.2.10').features.length, 14);
  // Until the user updates the device, /config is not read.
  assert.ok(!w.network.requests.some((r) => r.path === '/config'));
});

test('a monitor answering with another serial number is not taken for the first one', async (t) => {
  const monitors = { '192.0.2.10': new FakeMonitor({ measures: fixture('one-3.1.1.json') }) };
  const w = await world(t, { monitors, announced: [], config: { hosts: '192.0.2.10' } });
  const device = await create(w, '192.0.2.10');
  w.network.hosts['192.0.2.10'] = new FakeMonitor({ measures: fixture('one-3.1.21.json') });
  await cycle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 778, 'not the other monitor’s 566');
});
