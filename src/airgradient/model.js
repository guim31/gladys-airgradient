// -----------------------------------------------------------------------------
// What an AirGradient monitor says, in the integration's own words.
//
// Two wire formats exist on the local API:
//   - `legacy`: GET /measures/current and /config, firmware 3.x of the ONE,
//     the Open Air and the DIY kits (`serialno`, `rco2`, `pm02`, `atmp`...);
//   - `v1`: GET /api/v1/measures and /api/v1/config, newer firmwares such as
//     the AirGradient Go (`serialNumber`, `co2`, `pm25`, `temperature`...).
// Both are reduced here to `{ serial, model, firmware, values }`, `values`
// holding only the readings the monitor actually sent: the firmware leaves out
// a sensor that is missing or whose reading is invalid (right after a boot).
//
// The corrected values (`pm02Compensated`, `atmpCompensated`,
// `rhumCompensated`) are preferred when the firmware sends them, like the
// `airgradient` Python library does: they apply the correction chosen on the
// monitor (EPA for PM2.5 outdoors, the Open Air's temperature/humidity
// correction). An old Open Air firmware only reports its two PM sensors under
// `channels`: their average is taken then, as newer firmwares do themselves.
// -----------------------------------------------------------------------------

export const API = { LEGACY: 'legacy', V1: 'v1' };

/** Measurement keys, the suffix of the feature external ids: never renamed. */
export const MEASURES = {
  PM01: 'pm01',
  PM25: 'pm25',
  PM10: 'pm10',
  CO2: 'co2',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  TVOC_INDEX: 'tvoc_index',
  NOX_INDEX: 'nox_index',
  PM003_COUNT: 'pm003_count',
  BATTERY: 'battery',
  WIFI: 'wifi',
};

/** Setting keys (features added with `device_settings`): never renamed. */
export const SETTINGS = {
  DISPLAY_BRIGHTNESS: 'display_brightness',
  LED_BAR_BRIGHTNESS: 'led_bar_brightness',
  LED_BAR_MODE: 'led_bar_mode',
  TEMPERATURE_UNIT: 'temperature_unit',
};

export const LED_BAR_MODES = ['off', 'co2', 'pm'];
export const TEMPERATURE_UNITS = ['c', 'f'];

// Wire name of each setting in the legacy /config document.
export const SETTING_FIELDS = {
  [SETTINGS.DISPLAY_BRIGHTNESS]: 'displayBrightness',
  [SETTINGS.LED_BAR_BRIGHTNESS]: 'ledBarBrightness',
  [SETTINGS.LED_BAR_MODE]: 'ledBarMode',
  [SETTINGS.TEMPERATURE_UNIT]: 'temperatureUnit',
};

// Legacy wire keys, preferred first.
const LEGACY_KEYS = {
  [MEASURES.PM01]: ['pm01'],
  [MEASURES.PM25]: ['pm02Compensated', 'pm02'],
  [MEASURES.PM10]: ['pm10'],
  [MEASURES.CO2]: ['rco2'],
  [MEASURES.TEMPERATURE]: ['atmpCompensated', 'atmp'],
  [MEASURES.HUMIDITY]: ['rhumCompensated', 'rhum'],
  [MEASURES.TVOC_INDEX]: ['tvocIndex'],
  [MEASURES.NOX_INDEX]: ['noxIndex'],
  [MEASURES.PM003_COUNT]: ['pm003Count'],
  [MEASURES.WIFI]: ['wifi'],
};

const V1_KEYS = {
  [MEASURES.PM01]: ['pm01'],
  [MEASURES.PM25]: ['pm25'],
  [MEASURES.PM10]: ['pm10'],
  [MEASURES.CO2]: ['co2'],
  [MEASURES.TEMPERATURE]: ['temperature'],
  [MEASURES.HUMIDITY]: ['humidity'],
  [MEASURES.TVOC_INDEX]: ['tvocIndex'],
  [MEASURES.NOX_INDEX]: ['noxIndex'],
  [MEASURES.PM003_COUNT]: ['pm003Count'],
  [MEASURES.BATTERY]: ['battPercent'],
  [MEASURES.WIFI]: ['wifiRssi'],
};

// Published precision: the sensors resolve far below what they can measure,
// and every change is a state (300 a minute at most) and a scene evaluation.
const DECIMALS = {
  [MEASURES.PM01]: 1,
  [MEASURES.PM25]: 1,
  [MEASURES.PM10]: 1,
  [MEASURES.CO2]: 0,
  [MEASURES.TEMPERATURE]: 1,
  [MEASURES.HUMIDITY]: 0,
  [MEASURES.TVOC_INDEX]: 0,
  [MEASURES.NOX_INDEX]: 0,
  [MEASURES.PM003_COUNT]: 0,
  [MEASURES.BATTERY]: 0,
  [MEASURES.WIFI]: 0,
};

// A temperature may be negative outdoors; nothing else can.
const SIGNED = new Set([MEASURES.TEMPERATURE, MEASURES.WIFI]);

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const numberOf = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function readKey(document, keys) {
  for (const key of keys) {
    const value = numberOf(document?.[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** The average of the PM channels of an old Open Air firmware (`channels`). */
function readChannels(document, keys) {
  const channels = document?.channels;
  if (!channels || typeof channels !== 'object') {
    return null;
  }
  const values = Object.values(channels)
    .map((channel) => readKey(channel, keys))
    .filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The serial number: the stable identity of a monitor (lowercase hex, its MAC address). */
export function normalizeSerial(value) {
  const serial = text(value)?.toLowerCase();
  return serial && /^[0-9a-z_-]{4,40}$/.test(serial) ? serial : null;
}

/**
 * @param {object} document the parsed JSON of the measures route
 * @param {string} api API.LEGACY or API.V1
 * @returns {{ serial: string, model: string|null, firmware: string|null, boot: number|null,
 *   values: Record<string, number> }}
 */
export function parseMeasures(document, api = API.LEGACY) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('the measures are not a JSON object');
  }
  const v1 = api === API.V1;
  const serial = normalizeSerial(v1 ? document.serialNumber : document.serialno);
  if (!serial) {
    throw new Error('the measures carry no serial number');
  }
  const keys = v1 ? V1_KEYS : LEGACY_KEYS;
  const values = {};
  for (const [key, wire] of Object.entries(keys)) {
    let value = readKey(document, wire);
    if (value === null && !v1) {
      value = readChannels(document, wire);
    }
    if (value === null || (value < 0 && !SIGNED.has(key))) {
      continue;
    }
    values[key] = round(value, DECIMALS[key]);
  }
  // 0 dBm is what an ESP32 reports while it is not associated: no reading.
  if (values[MEASURES.WIFI] === 0) {
    delete values[MEASURES.WIFI];
  }
  return {
    serial,
    model: text(document.model),
    firmware: text(document.firmware),
    boot: numberOf(document.boot) ?? numberOf(document.bootCount),
    values,
  };
}

/**
 * The settings the integration can drive, from a legacy /config document.
 * @returns {{ control: string|null, values: Record<string, number|string> }}
 */
export function parseConfig(document) {
  const values = {};
  if (!document || typeof document !== 'object') {
    return { control: null, values };
  }
  for (const key of [SETTINGS.DISPLAY_BRIGHTNESS, SETTINGS.LED_BAR_BRIGHTNESS]) {
    const value = numberOf(document[SETTING_FIELDS[key]]);
    if (value !== null && value >= 0 && value <= 100) {
      values[key] = Math.round(value);
    }
  }
  const mode = text(document.ledBarMode)?.toLowerCase();
  if (LED_BAR_MODES.includes(mode)) {
    values[SETTINGS.LED_BAR_MODE] = mode;
  }
  const unit = text(document.temperatureUnit)?.toLowerCase();
  if (TEMPERATURE_UNITS.includes(unit)) {
    values[SETTINGS.TEMPERATURE_UNIT] = unit;
  }
  const control = text(document.configurationControl)?.toLowerCase() ?? null;
  return { control, values };
}

// What each family is expected to measure, so a monitor read right after a
// boot (no reading yet) is not published without its features. The DIY kits
// are built in many ways: only what they actually report counts for them.
const PM = [MEASURES.PM01, MEASURES.PM25, MEASURES.PM10, MEASURES.PM003_COUNT];
const CLIMATE = [MEASURES.TEMPERATURE, MEASURES.HUMIDITY];
const GAS_INDEXES = [MEASURES.TVOC_INDEX, MEASURES.NOX_INDEX];

/**
 * The family of a model code (`I-9PSL`, `O-1PST`, `0-1PS`, `P-1PSG`, `DIY-…`).
 * The Open Air codes spell their sensors: P a PM sensor (with temperature and
 * humidity), S the CO₂ sensor, T the TVOC/NOx sensor.
 */
export function modelInfo(model) {
  const code = (model ?? '').toUpperCase();
  if (code.startsWith('I-9PSL')) {
    return {
      family: 'one',
      name: 'AirGradient ONE',
      expected: [...PM, MEASURES.CO2, ...CLIMATE, ...GAS_INDEXES],
      settings: Object.values(SETTINGS),
    };
  }
  const outdoor = code.match(/^[O0]-1([A-Z]*)/);
  if (outdoor) {
    const letters = outdoor[1];
    return {
      family: 'open_air',
      name: 'AirGradient Open Air',
      expected: [
        ...PM,
        ...CLIMATE,
        ...(letters.includes('S') ? [MEASURES.CO2] : []),
        ...(letters.includes('T') ? GAS_INDEXES : []),
      ],
      // No screen, no LED bar.
      settings: [],
    };
  }
  if (code.startsWith('P-1PSG')) {
    return {
      family: 'go',
      name: 'AirGradient Go',
      expected: [...PM, MEASURES.CO2, ...CLIMATE, ...GAS_INDEXES, MEASURES.BATTERY],
      // Its settings live in another API (v1), not supported yet.
      settings: [],
    };
  }
  if (code.includes('DIY')) {
    return {
      family: 'diy',
      name: 'AirGradient DIY',
      expected: [],
      settings: [SETTINGS.DISPLAY_BRIGHTNESS, SETTINGS.TEMPERATURE_UNIT],
    };
  }
  return { family: 'unknown', name: 'AirGradient', expected: [], settings: [] };
}
