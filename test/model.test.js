// -----------------------------------------------------------------------------
// What the integration reads in the answers of real monitors (fixtures of
// python-airgradient and Home Assistant, see test/fixtures/airgradient).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API,
  modelInfo,
  normalizeSerial,
  parseConfig,
  parseMeasures,
} from '../src/airgradient/model.js';
import { fixture } from './helpers/fakeAirGradient.js';

test('a ONE on firmware 3.1.1: every reading, the compensated ones preferred', () => {
  const measures = parseMeasures(fixture('one-3.1.1.json'));
  assert.equal(measures.serial, '02c0ffee0001');
  assert.equal(measures.model, 'I-9PSL');
  assert.equal(measures.firmware, '3.1.1');
  assert.equal(measures.boot, 4);
  assert.deepEqual(measures.values, {
    pm01: 22,
    pm25: 34,
    pm10: 41,
    co2: 778,
    // atmpCompensated / rhumCompensated, not the raw 23.1 / 32.
    temperature: 22.2,
    humidity: 47,
    tvoc_index: 99,
    nox_index: 1,
    pm003_count: 270,
    wifi: -52,
  });
});

test('a ONE on firmware 3.1.21: pm02Compensated wins over pm02, values are rounded', () => {
  const { values, boot } = parseMeasures(fixture('one-3.1.21.json'));
  assert.equal(values.pm25, 6.8);
  assert.equal(values.temperature, 20.4);
  assert.equal(values.humidity, 33);
  assert.equal(values.pm003_count, 256);
  assert.equal(values.tvoc_index, 138);
  // `boot` first, `bootCount` (deprecated) only without it.
  assert.equal(boot, 309);
});

test('a compensated value of 0 is a reading, like the Python library takes it', () => {
  const { values } = parseMeasures(fixture('one-zero-compensated-3.1.1.json'));
  assert.equal(values.pm25, 0);
  assert.equal(values.temperature, 0);
  assert.equal(values.humidity, 0);
});

test('right after a boot the monitor sends no reading: none is invented', () => {
  const measures = parseMeasures(fixture('one-after-boot-3.0.8.json'));
  assert.deepEqual(measures.values, { wifi: -59 });
  assert.equal(measures.boot, 0);
  const countOnly = parseMeasures(fixture('one-boot-count-only-3.1.1.json'));
  assert.equal(countOnly.boot, 4);
});

test('an old Open Air firmware reports its PM sensors under channels only', () => {
  const { model, values } = parseMeasures(fixture('open-air-o-1ppt-channels-3.1.1.json'));
  assert.equal(model, 'O-1PPT');
  assert.equal(values.pm25, 5);
  assert.equal(values.pm10, 5);
  assert.equal(values.temperature, 17.1);
  assert.equal(values.humidity, 92);
  assert.equal(values.tvoc_index, 49);
  assert.equal(values.co2, undefined);
});

test('an Open Air with two PM sensors: the averaged top-level values', () => {
  const { values } = parseMeasures(fixture('open-air-o-1ppt-3.3.9.json'));
  assert.equal(values.pm25, 3.1);
  assert.equal(values.temperature, 8);
  assert.equal(values.pm003_count, 612);
});

test('negative temperatures are kept, negative concentrations are not', () => {
  const { values } = parseMeasures(fixture('open-air-0-1ps-3.3.9.json'));
  assert.equal(values.temperature, -4.1);
  const invalid = parseMeasures({ ...fixture('one-3.1.1.json'), rco2: -1, pm02: -1 });
  assert.equal(invalid.values.co2, undefined);
  assert.equal(invalid.values.pm25, undefined);
});

test('the v1 API of the AirGradient Go', () => {
  const measures = parseMeasures(fixture('go-v1-full.json'), API.V1);
  assert.equal(measures.serial, '02c0ffee0005');
  assert.equal(measures.model, 'P-1PSG');
  assert.deepEqual(measures.values, {
    pm01: 1.3,
    pm25: 2.5,
    pm10: 3.8,
    co2: 612,
    temperature: 21.5,
    humidity: 48,
    tvoc_index: 101,
    nox_index: 2,
    pm003_count: 100,
    battery: 87,
    wifi: -57,
  });
  assert.deepEqual(parseMeasures(fixture('go-v1-minimal.json'), API.V1).values, {});
  // 0 dBm is "not associated", not a signal.
  assert.equal(parseMeasures(fixture('go-v1-zero.json'), API.V1).values.wifi, undefined);
});

test('a document without serial number is refused', () => {
  assert.throws(() => parseMeasures({ model: 'I-9PSL' }), /serial/);
  assert.throws(() => parseMeasures([]), /JSON object/);
  assert.throws(() => parseMeasures(fixture('go-v1-full.json'), API.LEGACY), /serial/);
  assert.equal(normalizeSerial(' 02C0FFEE0001 '), '02c0ffee0001');
  assert.equal(normalizeSerial('x'), null);
  assert.equal(normalizeSerial('../etc'), null);
});

test('the families and what they are expected to measure', () => {
  assert.equal(modelInfo('I-9PSL').family, 'one');
  assert.equal(modelInfo('I-9PSL-DE').family, 'one');
  assert.ok(modelInfo('I-9PSL').settings.includes('led_bar_mode'));
  assert.ok(modelInfo('O-1PST').expected.includes('co2'));
  assert.ok(modelInfo('O-1PST').expected.includes('nox_index'));
  assert.ok(!modelInfo('O-1PPT').expected.includes('co2'));
  assert.ok(!modelInfo('O-1PP').expected.includes('tvoc_index'));
  // The firmware spells this one with a zero.
  assert.ok(modelInfo('0-1PS').expected.includes('co2'));
  assert.deepEqual(modelInfo('O-1PS').settings, []);
  assert.equal(modelInfo('P-1PSG').family, 'go');
  assert.equal(modelInfo('DIY-PRO-I-4.2PS').family, 'diy');
  assert.deepEqual(modelInfo('DIY-BASIC-I-4.0PS').expected, []);
  assert.equal(modelInfo(null).family, 'unknown');
});

test('the settings read in /config', () => {
  assert.deepEqual(parseConfig(fixture('config-one-both.json')), {
    control: 'both',
    values: {
      display_brightness: 0,
      led_bar_brightness: 100,
      led_bar_mode: 'co2',
      temperature_unit: 'c',
    },
  });
  assert.equal(parseConfig(fixture('config-one-cloud.json')).control, 'cloud');
  assert.deepEqual(
    parseConfig({ ledBarMode: 'iaqs', temperatureUnit: 'F', displayBrightness: 300 }),
    {
      control: null,
      values: { temperature_unit: 'f' },
    },
  );
  assert.deepEqual(parseConfig(null), { control: null, values: {} });
});
