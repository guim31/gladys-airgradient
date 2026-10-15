// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (Gladys stores them as typed); the
// normalized config holds numbers and booleans.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two readings of every monitor. The container reads them
// itself (src/hub.js): the monitors average their sensors over about a
// minute, so reading faster only repeats the same values.
export const REFRESH_INTERVALS = ['30', '60', '120', '300'];

export const SWITCHES = ['off', 'on'];

export const DEFAULT_CONFIG = {
  hosts: '',
  refresh_interval: '60',
  device_settings: 'off',
  co2_calibration: 'off',
  language: 'fr',
};

// A host is an IPv4 address or a DNS name, with an optional port. mDNS names
// (`airgradient_xxxx.local`) do not resolve inside the integration container:
// the documentation asks for IP addresses, but a resolvable name is accepted.
const HOST_PATTERN =
  /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d{1,5})?$/;
export const MAX_HOSTS = 32;

/**
 * Parse the manual host list (commas, semicolons, spaces or new lines).
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    // Users paste URLs copied from the browser: keep the host part only.
    const host = entry
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!host) {
      continue;
    }
    if (!isValidHost(host)) {
      invalid.push(entry.trim());
    } else if (!hosts.includes(host) && hosts.length < MAX_HOSTS) {
      hosts.push(host);
    }
  }
  return { hosts, invalid };
}

function isValidHost(host) {
  const ipv4 = host.match(IPV4_PATTERN);
  if (ipv4) {
    return ipv4.slice(1, 5).every((part) => Number(part) <= 255) && validPort(ipv4[5]);
  }
  // A dotted string made of digits only is a mistyped address, not a name.
  if (/^[\d.]+(:\d+)?$/.test(host)) {
    return false;
  }
  return HOST_PATTERN.test(host) && validPort(host.match(/:(\d+)$/)?.[0]);
}

function validPort(suffix) {
  if (!suffix) {
    return true;
  }
  const port = Number(suffix.slice(1));
  return port >= 1 && port <= 65535;
}

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? String(value) : fallback;

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    hosts,
    invalidHosts: invalid,
    refreshSeconds: Number(
      pick(source.refresh_interval, REFRESH_INTERVALS, DEFAULT_CONFIG.refresh_interval),
    ),
    deviceSettings: pick(source.device_settings, SWITCHES, DEFAULT_CONFIG.device_settings) === 'on',
    co2Calibration: pick(source.co2_calibration, SWITCHES, DEFAULT_CONFIG.co2_calibration) === 'on',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
