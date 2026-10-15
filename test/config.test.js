import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('the defaults: one minute, measurements only, no calibration, French names', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    refreshSeconds: 60,
    deviceSettings: false,
    co2Calibration: false,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
});

test('values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    refresh_interval: '7',
    device_settings: 'yes',
    co2_calibration: true,
    language: 'it',
  });
  assert.equal(config.refreshSeconds, 60);
  assert.equal(config.deviceSettings, false);
  assert.equal(config.co2Calibration, false);
  assert.equal(config.language, 'fr');
  const chosen = normalizeConfig({
    refresh_interval: '300',
    device_settings: 'on',
    co2_calibration: 'on',
    language: 'de',
  });
  assert.equal(chosen.refreshSeconds, 300);
  assert.equal(chosen.deviceSettings, true);
  assert.equal(chosen.co2Calibration, true);
  assert.equal(chosen.language, 'de');
});

test('the typed addresses: separators, pasted URLs, ports, mistakes', () => {
  assert.deepEqual(
    parseHosts('192.0.2.10, http://192.0.2.11/measures/current;192.0.2.12:8080\n192.0.2.10'),
    { hosts: ['192.0.2.10', '192.0.2.11', '192.0.2.12:8080'], invalid: [] },
  );
  assert.deepEqual(parseHosts('300.1.1.1 192.0.2 sensor.lan 192.0.2.9:99999'), {
    hosts: ['sensor.lan'],
    invalid: ['300.1.1.1', '192.0.2', '192.0.2.9:99999'],
  });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
  assert.equal(
    parseHosts(Array.from({ length: 40 }, (_, i) => `192.0.2.${i}`).join(',')).hosts.length,
    32,
  );
});
