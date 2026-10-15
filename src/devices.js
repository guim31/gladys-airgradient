// -----------------------------------------------------------------------------
// The Gladys device of one AirGradient monitor.
//
// One device per monitor, identified by its serial number (the MAC address the
// firmware reports): `gladys.externalIds('monitor', serial)`. The features are
// the measurements the monitor's family is expected to report, plus every one
// it was ever seen reporting (kept in /data), so a monitor read right after a
// boot, before its first readings, keeps its features and Gladys never offers
// a needless "Update".
//
// Categories (couples of test/fixtures/gladys-feature-table.json):
//   - PM1 has no category of its own in Gladys: `pm25-sensor`, like the core's
//     own Matter mapping of the PM1 cluster; its name says PM1.
//   - TVOC and NOx are Sensirion gas indexes (1-500, no unit):
//     `voc-index-sensor/integer` for both. `no2-matter-index-sensor` would be
//     wrong: its values are the Matter levels (low, medium...), not an index.
//   - The 0.3 µm particle count is per decilitre (0.1 L), a unit Gladys does
//     not have: `counter-sensor/integer`, the unit in the name.
//   - The Wi-Fi signal is in dBm, -100 to -30: the front draws its bars from
//     the feature's min/max.
//   - The temperature is always in °C on the wire, whatever the monitor's
//     display shows: Gladys converts it for the users who want °F.
// Settings (with `device_settings`): sliders are `switch/dimmer` (the slider
// the dashboard can drive, no unit in that category), lists `text/select`.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import {
  API,
  LED_BAR_MODES,
  MEASURES,
  SETTINGS,
  TEMPERATURE_UNITS,
  modelInfo,
} from './airgradient/model.js';

export const DEVICE_TYPE = 'monitor';

// Feature names, frozen at creation (config `language`, French by default).
export const NAMES = {
  en: {
    [MEASURES.PM01]: 'PM1',
    [MEASURES.PM25]: 'PM2.5',
    [MEASURES.PM10]: 'PM10',
    [MEASURES.CO2]: 'CO₂',
    [MEASURES.TEMPERATURE]: 'Temperature',
    [MEASURES.HUMIDITY]: 'Humidity',
    [MEASURES.TVOC_INDEX]: 'TVOC index',
    [MEASURES.NOX_INDEX]: 'NOx index',
    [MEASURES.PM003_COUNT]: '0.3 µm particles (per dL)',
    [MEASURES.BATTERY]: 'Battery',
    [MEASURES.WIFI]: 'Wi-Fi signal',
    [SETTINGS.DISPLAY_BRIGHTNESS]: 'Display brightness',
    [SETTINGS.LED_BAR_BRIGHTNESS]: 'LED bar brightness',
    [SETTINGS.LED_BAR_MODE]: 'LED bar mode',
    [SETTINGS.TEMPERATURE_UNIT]: 'Display temperature unit',
  },
  fr: {
    [MEASURES.PM01]: 'PM1',
    [MEASURES.PM25]: 'PM2,5',
    [MEASURES.PM10]: 'PM10',
    [MEASURES.CO2]: 'CO₂',
    [MEASURES.TEMPERATURE]: 'Température',
    [MEASURES.HUMIDITY]: 'Humidité',
    [MEASURES.TVOC_INDEX]: 'Indice COV',
    [MEASURES.NOX_INDEX]: 'Indice NOx',
    [MEASURES.PM003_COUNT]: 'Particules 0,3 µm (par dL)',
    [MEASURES.BATTERY]: 'Batterie',
    [MEASURES.WIFI]: 'Signal Wi-Fi',
    [SETTINGS.DISPLAY_BRIGHTNESS]: "Luminosité de l'écran",
    [SETTINGS.LED_BAR_BRIGHTNESS]: 'Luminosité de la barre LED',
    [SETTINGS.LED_BAR_MODE]: 'Mode de la barre LED',
    [SETTINGS.TEMPERATURE_UNIT]: "Unité de température de l'écran",
  },
  de: {
    [MEASURES.PM01]: 'PM1',
    [MEASURES.PM25]: 'PM2,5',
    [MEASURES.PM10]: 'PM10',
    [MEASURES.CO2]: 'CO₂',
    [MEASURES.TEMPERATURE]: 'Temperatur',
    [MEASURES.HUMIDITY]: 'Luftfeuchtigkeit',
    [MEASURES.TVOC_INDEX]: 'TVOC-Index',
    [MEASURES.NOX_INDEX]: 'NOx-Index',
    [MEASURES.PM003_COUNT]: 'Partikel 0,3 µm (pro dL)',
    [MEASURES.BATTERY]: 'Akku',
    [MEASURES.WIFI]: 'WLAN-Signal',
    [SETTINGS.DISPLAY_BRIGHTNESS]: 'Display-Helligkeit',
    [SETTINGS.LED_BAR_BRIGHTNESS]: 'Helligkeit der LED-Leiste',
    [SETTINGS.LED_BAR_MODE]: 'Modus der LED-Leiste',
    [SETTINGS.TEMPERATURE_UNIT]: 'Temperatureinheit des Displays',
  },
  es: {
    [MEASURES.PM01]: 'PM1',
    [MEASURES.PM25]: 'PM2,5',
    [MEASURES.PM10]: 'PM10',
    [MEASURES.CO2]: 'CO₂',
    [MEASURES.TEMPERATURE]: 'Temperatura',
    [MEASURES.HUMIDITY]: 'Humedad',
    [MEASURES.TVOC_INDEX]: 'Índice de COV',
    [MEASURES.NOX_INDEX]: 'Índice de NOx',
    [MEASURES.PM003_COUNT]: 'Partículas de 0,3 µm (por dL)',
    [MEASURES.BATTERY]: 'Batería',
    [MEASURES.WIFI]: 'Señal Wi-Fi',
    [SETTINGS.DISPLAY_BRIGHTNESS]: 'Brillo de la pantalla',
    [SETTINGS.LED_BAR_BRIGHTNESS]: 'Brillo de la barra LED',
    [SETTINGS.LED_BAR_MODE]: 'Modo de la barra LED',
    [SETTINGS.TEMPERATURE_UNIT]: 'Unidad de temperatura de la pantalla',
  },
};

// Labels of the text/select options, in the feature-name language.
export const OPTION_LABELS = {
  en: { off: 'Off', co2: 'CO₂', pm: 'PM2.5', c: 'Celsius (°C)', f: 'Fahrenheit (°F)' },
  fr: { off: 'Éteinte', co2: 'CO₂', pm: 'PM2,5', c: 'Celsius (°C)', f: 'Fahrenheit (°F)' },
  de: { off: 'Aus', co2: 'CO₂', pm: 'PM2,5', c: 'Celsius (°C)', f: 'Fahrenheit (°F)' },
  es: { off: 'Apagada', co2: 'CO₂', pm: 'PM2,5', c: 'Celsius (°C)', f: 'Fahrenheit (°F)' },
};

const sensor = (category, type, { min, max, unit } = {}) => ({
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

// Bounds: the sensors' measuring ranges (the gauge needle is placed with them).
const SPECS = {
  [MEASURES.PM01]: sensor('pm25-sensor', 'decimal', {
    min: 0,
    max: 1000,
    unit: 'microgram-per-cubic-meter',
  }),
  [MEASURES.PM25]: sensor('pm25-sensor', 'decimal', {
    min: 0,
    max: 1000,
    unit: 'microgram-per-cubic-meter',
  }),
  [MEASURES.PM10]: sensor('pm10-sensor', 'decimal', {
    min: 0,
    max: 1000,
    unit: 'microgram-per-cubic-meter',
  }),
  [MEASURES.CO2]: sensor('co2-sensor', 'integer', { min: 0, max: 5000, unit: 'ppm' }),
  [MEASURES.TEMPERATURE]: sensor('temperature-sensor', 'decimal', {
    min: -40,
    max: 85,
    unit: 'celsius',
  }),
  [MEASURES.HUMIDITY]: sensor('humidity-sensor', 'decimal', { min: 0, max: 100, unit: 'percent' }),
  [MEASURES.TVOC_INDEX]: sensor('voc-index-sensor', 'integer', { min: 0, max: 500 }),
  [MEASURES.NOX_INDEX]: sensor('voc-index-sensor', 'integer', { min: 0, max: 500 }),
  [MEASURES.PM003_COUNT]: sensor('counter-sensor', 'integer', { min: 0, max: 100000 }),
  [MEASURES.BATTERY]: sensor('battery', 'integer', { min: 0, max: 100, unit: 'percent' }),
  [MEASURES.WIFI]: sensor('signal', 'integer', { min: -100, max: -30 }),
};

const slider = () => ({
  category: 'switch',
  type: 'dimmer',
  min: 0,
  max: 100,
  read_only: false,
  has_feedback: true,
  keep_history: false,
});

const select = (values, language) => ({
  category: 'text',
  type: 'select',
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  supported_options: values.map((value, index) => ({
    value,
    label: OPTION_LABELS[language]?.[value] ?? OPTION_LABELS.en[value],
    sort_order: index,
  })),
});

const SETTING_SPECS = {
  [SETTINGS.DISPLAY_BRIGHTNESS]: () => slider(),
  [SETTINGS.LED_BAR_BRIGHTNESS]: () => slider(),
  [SETTINGS.LED_BAR_MODE]: (language) => select(LED_BAR_MODES, language),
  [SETTINGS.TEMPERATURE_UNIT]: (language) => select(TEMPERATURE_UNITS, language),
};

// Publication order of the features.
const MEASURE_ORDER = Object.values(MEASURES);

export const deviceIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** The serial number behind a device external id, or null. */
export function serialOf(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = deviceIds(gladys, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const rest = externalId.slice(prefix.length);
  return rest && !rest.includes(':') ? rest : null;
}

/** The measurement keys a monitor's device has. */
export function measureKeys(monitor) {
  const known = new Set([...modelInfo(monitor.model).expected, ...(monitor.keys ?? [])]);
  return MEASURE_ORDER.filter((key) => known.has(key));
}

/** The setting keys a monitor's device has (none unless `device_settings` is on). */
export function settingKeys(monitor, config) {
  if (!config.deviceSettings || monitor.api !== API.LEGACY) {
    return [];
  }
  return modelInfo(monitor.model).settings;
}

/** Name proposed for a new device: the product name and the end of the serial. */
export function defaultName(monitor) {
  return `${modelInfo(monitor.model).name} ${monitor.serial.slice(-4)}`;
}

/**
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {{ serial, host, model, firmware, api, keys }} monitor
 * @param {{ language: string, deviceSettings: boolean }} config
 */
export function buildDevice(gladys, monitor, config) {
  const ids = deviceIds(gladys, monitor.serial);
  const names = NAMES[config.language] ?? NAMES.en;
  const features = [
    ...measureKeys(monitor).map((key) => ({ key, ...SPECS[key] })),
    ...settingKeys(monitor, config).map((key) => ({
      key,
      ...SETTING_SPECS[key](config.language),
    })),
  ].map(({ key, ...spec }) => ({ name: names[key], external_id: ids.feature(key), ...spec }));
  const params = [
    { name: 'HOST', value: monitor.host },
    { name: 'SERIAL', value: monitor.serial },
  ];
  if (monitor.model) {
    params.push({ name: 'MODEL', value: monitor.model });
  }
  if (monitor.firmware) {
    params.push({ name: 'FIRMWARE', value: monitor.firmware });
  }
  return {
    name: defaultName(monitor),
    external_id: ids.device,
    model: monitor.model ?? undefined,
    // The container reads the monitors itself (src/hub.js); the core's poll,
    // when it comes, is a fallback the hub skips while its own timer runs.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params,
    features,
  };
}
