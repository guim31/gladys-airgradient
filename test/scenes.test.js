// -----------------------------------------------------------------------------
// The scene action `calibrate_co2`, off by default: a calibration indoors
// spoils every later reading of the monitor.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMonitor, fixture } from './helpers/fakeAirGradient.js';
import { create, createWorld } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('the calibration is refused while the configuration does not allow it', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  const one = await create(w, '192.0.2.10');
  const result = await w.fake.sceneAction('calibrate_co2', { device: one.external_id });
  assert.equal(result.success, false);
  assert.match(result.error, /La calibration du CO₂ est désactivée/);
  assert.equal(w.monitors['192.0.2.10'].calibrations, 0);
});

test('allowed, it starts the calibration of a legacy firmware and of a v1 one', async (t) => {
  const w = await world(t, { config: { co2_calibration: 'on' } });
  const one = await create(w, '192.0.2.10');
  const go = await create(w, '192.0.2.14');
  assert.deepEqual(await w.fake.sceneAction('calibrate_co2', { device: one.external_id }), {
    success: true,
    data: { outputs: {} },
  });
  assert.equal(w.monitors['192.0.2.10'].calibrations, 1);
  assert.equal(
    (await w.fake.sceneAction('calibrate_co2', { device: go.external_id })).success,
    true,
  );
  assert.equal(w.monitors['192.0.2.14'].calibrations, 1);
});

test('a monitor without CO₂ sensor, a cloud-locked or a silent one: a clear error', async (t) => {
  const monitors = {
    '192.0.2.11': new FakeMonitor({ measures: fixture('open-air-o-1ppt-3.3.9.json') }),
    '192.0.2.10': new FakeMonitor({
      measures: fixture('one-3.1.1.json'),
      config: fixture('config-one-cloud.json'),
    }),
  };
  const w = await world(t, { monitors, config: { co2_calibration: 'on', language: 'en' } });
  const openAir = await create(w, '192.0.2.11');
  const one = await create(w, '192.0.2.10');
  const noSensor = await w.fake.sceneAction('calibrate_co2', { device: openAir.external_id });
  assert.match(noSensor.error, /has no CO₂ sensor/);
  const locked = await w.fake.sceneAction('calibrate_co2', { device: one.external_id });
  assert.match(locked.error, /only accepts settings from the AirGradient cloud/);
  monitors['192.0.2.10'].online = false;
  const silent = await w.fake.sceneAction('calibrate_co2', { device: one.external_id });
  assert.match(silent.error, /does not answer/);
  const unknown = await w.fake.sceneAction('calibrate_co2', { device: 'nope' });
  assert.match(unknown.error, /Unknown AirGradient monitor/);
  assert.equal(monitors['192.0.2.10'].calibrations, 0);
});
