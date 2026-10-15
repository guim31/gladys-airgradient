// -----------------------------------------------------------------------------
// The container reads the monitors itself (GladysAssistant/Gladys#3198: the
// core does not poll an external device reliably). These tests run the hub's
// real timers, mocked, and never call onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create, createWorld, featureId } from './helpers/world.js';

async function timedWorld(t, config = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  const w = await createWorld({ timers: true, clock: null, config });
  t.after(() => w.app.stop());
  return w;
}

// Let the cycle started by a timer finish (the fake network answers at once).
async function settle(w) {
  for (let i = 0; i < 5; i += 1) {
    await w.hub.running;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const polls = (w) => w.fake.wsMessages.filter((message) => /poll/.test(message.type ?? '')).length;

test('the states follow the monitor with the internal timer alone, no onPoll', async (t) => {
  const w = await timedWorld(t);
  const device = await create(w, '192.0.2.10');
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566);

  w.monitors['192.0.2.10'].set({ rco2: 901 });
  t.mock.timers.tick(59_000);
  await settle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566, 'not before the period');
  t.mock.timers.tick(1_000);
  await settle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 901);

  w.monitors['192.0.2.10'].set({ rco2: 1105 });
  t.mock.timers.tick(60_000);
  await settle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 1105);
  assert.equal(polls(w), 0, 'Gladys never polled');
});

test('the configured interval is followed (5 minutes)', async (t) => {
  const w = await timedWorld(t, { refresh_interval: '300' });
  const device = await create(w, '192.0.2.10');
  w.monitors['192.0.2.10'].set({ rco2: 777 });
  t.mock.timers.tick(240_000);
  await settle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 566);
  t.mock.timers.tick(60_000);
  await settle(w);
  assert.equal(w.fake.lastState(featureId(device, 'co2')), 777);
});

test('a monitor not created in Gladys is not read by the timer', async (t) => {
  const w = await timedWorld(t);
  await create(w, '192.0.2.10');
  const before = w.network.requests.filter((r) => r.host === '192.0.2.11').length;
  t.mock.timers.tick(180_000);
  await settle(w);
  assert.equal(w.network.requests.filter((r) => r.host === '192.0.2.11').length, before);
});
