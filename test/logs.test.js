// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle (a
// monitor lost or back, one line per user action), never one line per reading
// cycle; a failure that repeats at every cycle is logged once, plus one line
// when it is over; nothing secret, even at debug.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMonitor, fixture } from './helpers/fakeAirGradient.js';
import { captureLogs, create, createWorld, cycle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const cycles = async (w, count) => {
  for (let i = 0; i < count; i += 1) {
    await cycle(w);
  }
};

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

test('a normal reading cycle writes nothing at info', async (t) => {
  const w = await world(t);
  await create(w, '192.0.2.10');
  await create(w, '192.0.2.11');
  const lines = captureLogs(t, 'info');
  w.monitors['192.0.2.10'].set({ rco2: 950 });
  await cycles(w, 5);
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the reading cycles', async (t) => {
  const w = await world(t);
  await create(w, '192.0.2.10');
  const lines = captureLogs(t, 'debug');
  await cycles(w, 2);
  assert.equal(lines.filter((line) => /Reading cycle: 1 monitor/.test(line.text)).length, 2);
});

test('a monitor lost and back is one info line each', async (t) => {
  const w = await world(t);
  await create(w, '192.0.2.10');
  const lines = captureLogs(t, 'info');
  w.monitors['192.0.2.10'].online = false;
  await cycles(w, 6);
  w.monitors['192.0.2.10'].online = true;
  await cycles(w, 3);
  assert.deepEqual(lines.map(strip), [
    '[INFO] [airgradient] AirGradient ONE 0002 does not answer (192.0.2.10)',
    '[INFO] [airgradient] AirGradient ONE 0002 answers again',
  ]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const w = await world(t);
  await create(w, '192.0.2.10');
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 4; i += 1) {
    w.monitors['192.0.2.10'].set({ rco2: 600 + i });
    await cycle(w);
  }
  assert.ok(publish.mock.callCount() >= 4);
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[airgradient] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await cycles(w, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[1].text, /\[INFO\].*Publishing the states works again/);
});

test('an unavailable mDNS scan is logged once', async (t) => {
  const lines = captureLogs(t, 'info');
  const w = await world(t, { announced: null, config: { hosts: '192.0.2.10' } });
  await w.fake.scanRequest();
  await w.fake.scanRequest();
  const warnings = lines.filter((line) => /mDNS scan through Gladys unavailable/.test(line.text));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, 'warn');
});

test('a user action is one info line', async (t) => {
  const w = await world(t, { config: { device_settings: 'on' } });
  const one = await create(w, '192.0.2.10');
  const lines = captureLogs(t, 'info');
  await w.fake.action('search', {});
  const brightness = one.features.find((f) => f.external_id.endsWith(':display_brightness'));
  await w.fake.setValue(one, brightness, 20);
  assert.deepEqual(lines.map(strip), [
    '[INFO] [airgradient-app] Action search',
    '[INFO] [airgradient] AirGradient ONE 0002: displayBrightness set to 20',
  ]);
});

test('nothing secret reaches the logs, even at debug', async (t) => {
  const secret = 's3cr3t-Pa55';
  const config = {
    ...fixture('config-one-local.json'),
    mqttBrokerUrl: `mqtt://gladys:${secret}@192.0.2.50:1883`,
    httpDomain: `user:${secret}@example.org`,
  };
  const monitors = {
    '192.0.2.10': new FakeMonitor({ measures: fixture('one-3.1.1.json'), config }),
  };
  const lines = captureLogs(t, 'debug');
  const w = await world(t, {
    monitors,
    config: { device_settings: 'on', co2_calibration: 'on', hosts: '192.0.2.10' },
  });
  const one = await create(w, '192.0.2.10');
  await cycles(w, 2);
  const mode = one.features.find((f) => f.external_id.endsWith(':led_bar_mode'));
  await w.fake.setValue(one, mode, 'pm');
  await w.fake.setValue(one, mode, 'nope');
  await w.fake.sceneAction('calibrate_co2', { device: one.external_id });
  await w.fake.action('use_local_settings', { device: one.external_id });
  monitors['192.0.2.10'].online = false;
  await cycles(w, 4);
  assert.ok(lines.length > 10, 'the debug lines were captured');
  const leaked = lines.filter((line) => line.text.includes(secret) || /mqtt:\/\//.test(line.text));
  assert.deepEqual(leaked, []);
});
