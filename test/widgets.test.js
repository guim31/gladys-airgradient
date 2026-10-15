// -----------------------------------------------------------------------------
// The `air_quality` widget: rendered exactly as sent (validateWidgetContent of
// the SDK), bound only to features the created device has, coloured with the
// AirGradient thresholds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildContent, TEXT } from '../src/widgets.js';
import { levelOf, worstLevel } from '../src/levels.js';
import { create, createWorld, cycle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const content = async (w, settings, language = 'en') => {
  const ack = await w.fake.widgetGet('air_quality', { settings, language });
  assert.equal(ack.success, true);
  return ack.data.content;
};

test('the levels follow the AirGradient LED bar', () => {
  assert.equal(levelOf('co2', 420), 'good');
  assert.equal(levelOf('co2', 800), 'good');
  assert.equal(levelOf('co2', 801), 'moderate');
  assert.equal(levelOf('co2', 1400), 'poor');
  assert.equal(levelOf('co2', 2600), 'very_poor');
  assert.equal(levelOf('pm25', 9), 'good');
  assert.equal(levelOf('pm25', 15), 'moderate');
  assert.equal(levelOf('pm25', 40), 'poor');
  assert.equal(levelOf('pm25', 120), 'very_poor');
  assert.equal(levelOf('temperature', 20), null);
  assert.equal(levelOf('co2', undefined), null);
  assert.equal(worstLevel(['good', null, 'poor']), 'poor');
  assert.equal(worstLevel([null]), null);
});

test('every monitor of the home renders as sent, bound to its own features', async (t) => {
  const w = await world(t);
  for (const host of Object.keys(w.monitors)) {
    const device = await create(w, host);
    for (const language of ['en', 'fr', 'de', 'es']) {
      const widget = await content(w, { device: device.external_id }, language);
      assert.deepEqual(validateWidgetContent(widget), [], `${host} ${language}`);
      const features = new Set(device.features.map((feature) => feature.external_id));
      for (const component of widget.components.filter((c) => c.device_feature)) {
        assert.ok(features.has(component.device_feature), `${host}: ${component.device_feature}`);
      }
    }
  }
});

test('a ONE: four live tiles and the levels, the worst one first', async (t) => {
  const w = await world(t);
  const one = await create(w, '192.0.2.10');
  w.monitors['192.0.2.10'].set({ rco2: 1320, pm02Compensated: 4 });
  await cycle(w);
  const widget = await content(w, { device: one.external_id }, 'fr');
  assert.deepEqual(widget.components[0], { type: 'text', variant: 'heading', text: one.name });
  assert.deepEqual(
    widget.components.filter((c) => c.type === 'value').map((c) => c.label),
    ['CO₂', 'PM2,5', 'Température', 'Humidité'],
  );
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items, [
    { label: "Qualité de l'air", value: 'Mauvaise', color: 'danger' },
    { label: 'CO₂', value: '1\u202f320 ppm · Mauvaise', color: 'danger' },
    { label: 'PM2,5', value: '4 µg/m³ · Bonne', color: 'success' },
  ]);
});

test('an Open Air without CO₂ sensor: no CO₂ tile, PM2.5 alone decides', async (t) => {
  const w = await world(t);
  const openAir = await create(w, '192.0.2.11');
  const widget = await content(w, { device: openAir.external_id });
  assert.ok(!widget.components.some((c) => c.device_feature?.endsWith(':co2')));
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Air quality', 'PM2.5'],
  );
});

test('a level that changes asks for a refresh; a silent monitor gets a caption', async (t) => {
  const w = await world(t);
  const one = await create(w, '192.0.2.10');
  const refreshes = () => w.fake.widgetRefreshes.length;
  const before = refreshes();
  w.monitors['192.0.2.10'].set({ rco2: 570 });
  await cycle(w);
  assert.equal(refreshes(), before, 'same level, no refresh');
  w.monitors['192.0.2.10'].set({ rco2: 1600 });
  await cycle(w);
  assert.equal(refreshes(), before + 1);

  w.monitors['192.0.2.10'].online = false;
  for (let i = 0; i < 3; i += 1) {
    await cycle(w);
  }
  const widget = await content(w, { device: one.external_id }, 'de');
  assert.deepEqual(widget.components.at(-1), {
    type: 'text',
    variant: 'caption',
    text: TEXT.unreachable.de,
  });
});

test('no monitor chosen, or one no longer in Gladys: a sentence, not an error', async (t) => {
  const w = await world(t);
  assert.equal((await content(w, {}, 'es')).components[0].text, TEXT.pick.es);
  assert.equal(
    (await content(w, { device: 'ext:test-integration:monitor:02c0ffee0002' })).components[0].text,
    TEXT.unknown.en,
    'discovered but not created',
  );
});

test('a monitor without any reading yet says so', () => {
  const widget = buildContent(
    { name: 'Office', deviceId: 'ext:x:monitor:1', reachable: null, values: {}, keys: ['co2'] },
    'en',
  );
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.deepEqual(widget.components.find((c) => c.type === 'status').items, [
    { label: 'Air quality', value: 'No reading yet', color: 'neutral' },
  ]);
});
