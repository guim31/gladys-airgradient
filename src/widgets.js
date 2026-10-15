// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `air_quality`.
//
// The device box shows the numbers; the widget says what they mean. For the
// monitor chosen in its settings:
//   - live tiles bound to the device features (CO₂, PM2.5, temperature,
//     humidity): they follow the published states with no refresh;
//   - a status list: the overall air quality (the worst of CO₂ and PM2.5) and
//     the level of each, coloured with the thresholds of src/levels.js;
//   - a caption when the monitor does not answer.
// The levels are computed when the content is pulled: the hub asks for a
// refresh when one of them changes (src/hub.js), the TTL covers the rest.
//
// Budget (8 components, 2 texts, 6 tiles, 1 status): one heading, 4 tiles at
// most, one status list, one caption at most. Only the features the created
// device has are bound (the core does not check that a bound feature exists).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MEASURES } from './airgradient/model.js';
import { WIDGET_KEY } from './hub.js';
import { LEVEL_COLORS, levelOf, worstLevel } from './levels.js';

export const TTL_SECONDS = 60;

export const TEXT = {
  pick: {
    en: 'Choose an AirGradient monitor in the settings of this widget.',
    fr: 'Choisissez un capteur AirGradient dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets ein AirGradient-Messgerät aus.',
    es: 'Elija un sensor AirGradient en los ajustes de este widget.',
  },
  unknown: {
    en: 'This monitor is no longer in Gladys: choose another one in the settings of this widget.',
    fr: "Ce capteur n'est plus dans Gladys : choisissez-en un autre dans les réglages de ce widget.",
    de: 'Dieses Messgerät ist nicht mehr in Gladys: Wähle in den Einstellungen dieses Widgets ein anderes aus.',
    es: 'Este sensor ya no está en Gladys: elija otro en los ajustes de este widget.',
  },
  unreachable: {
    en: 'The monitor does not answer: the values are the last ones read.',
    fr: 'Le capteur ne répond pas : les valeurs sont les dernières lues.',
    de: 'Das Messgerät antwortet nicht: Die Werte sind die zuletzt gelesenen.',
    es: 'El sensor no responde: los valores son los últimos leídos.',
  },
  noReading: {
    en: 'No reading yet',
    fr: 'Pas encore de mesure',
    de: 'Noch kein Messwert',
    es: 'Aún sin medición',
  },
  airQuality: {
    en: 'Air quality',
    fr: "Qualité de l'air",
    de: 'Luftqualität',
    es: 'Calidad del aire',
  },
  co2: { en: 'CO₂', fr: 'CO₂', de: 'CO₂', es: 'CO₂' },
  pm25: { en: 'PM2.5', fr: 'PM2,5', de: 'PM2,5', es: 'PM2,5' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Feuchtigkeit', es: 'Humedad' },
  good: { en: 'Good', fr: 'Bonne', de: 'Gut', es: 'Buena' },
  moderate: { en: 'Moderate', fr: 'Moyenne', de: 'Mäßig', es: 'Moderada' },
  poor: { en: 'Poor', fr: 'Mauvaise', de: 'Schlecht', es: 'Mala' },
  very_poor: { en: 'Very poor', fr: 'Très mauvaise', de: 'Sehr schlecht', es: 'Muy mala' },
};

const t = (text, language) => text[language] ?? text.en;

// Tiles, in display order: the feature key and its label.
const TILES = [
  [MEASURES.CO2, 'co2'],
  [MEASURES.PM25, 'pm25'],
  [MEASURES.TEMPERATURE, 'temperature'],
  [MEASURES.HUMIDITY, 'humidity'],
];

const UNITS = { [MEASURES.CO2]: 'ppm', [MEASURES.PM25]: 'µg/m³' };

const formatNumber = (value, language) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);

/** One status row: "778 ppm · Moderate", coloured. */
function levelItem(key, label, view, language) {
  const value = view.values[key];
  const level = levelOf(key, value);
  if (!level) {
    return null;
  }
  return {
    label: t(TEXT[label], language),
    value: `${formatNumber(value, language)} ${UNITS[key]} · ${t(TEXT[level], language)}`,
    color: LEVEL_COLORS[level],
  };
}

/** The content of one widget instance (pure: the hub's view in, components out). */
export function buildContent(view, language = 'en') {
  const components = [{ type: 'text', variant: 'heading', text: view.name.slice(0, 40) }];
  const ids = (key) => `${view.deviceId}:${key}`;
  for (const [key, label] of TILES) {
    if (view.keys.includes(key)) {
      components.push({ type: 'value', label: t(TEXT[label], language), device_feature: ids(key) });
    }
  }
  const rows = [
    levelItem(MEASURES.CO2, 'co2', view, language),
    levelItem(MEASURES.PM25, 'pm25', view, language),
  ].filter(Boolean);
  const overall = worstLevel([
    levelOf(MEASURES.CO2, view.values[MEASURES.CO2]),
    levelOf(MEASURES.PM25, view.values[MEASURES.PM25]),
  ]);
  components.push({
    type: 'status',
    items: [
      overall
        ? {
            label: t(TEXT.airQuality, language),
            value: t(TEXT[overall], language),
            color: LEVEL_COLORS[overall],
          }
        : {
            label: t(TEXT.airQuality, language),
            value: t(TEXT.noReading, language),
            color: WIDGET_COLORS.NEUTRAL,
          },
      ...rows,
    ],
  });
  if (view.reachable === false) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.unreachable, language) });
  }
  return { ttl_seconds: TTL_SECONDS, components };
}

const message = (text, language) => ({
  ttl_seconds: TTL_SECONDS,
  components: [{ type: 'text', variant: 'body', text: t(text, language) }],
});

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings, language = 'en' }) {
      const device = typeof settings?.device === 'string' ? settings.device : '';
      if (device === '') {
        return message(TEXT.pick, language);
      }
      const view = hub.view(device);
      return view ? buildContent(view, language) : message(TEXT.unknown, language);
    },
  },
};
