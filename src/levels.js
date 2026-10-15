// -----------------------------------------------------------------------------
// Air quality levels shown by the widget, from the colours the AirGradient
// firmware gives its own LED bar (src/AgStateMachine.cpp of
// airgradienthq/arduino):
//   - CO₂ (ppm): green up to 800, yellow up to 1000, orange up to 1500, red
//     above;
//   - PM2.5 (µg/m³): green up to 9, yellow up to 35, orange up to 55, red
//     above — the US EPA breakpoints (2024). The WHO 24-hour guideline,
//     15 µg/m³, falls in the yellow band.
// The levels are the integration's own reading aid; the thresholds of a scene
// are the user's choice, on the states themselves.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MEASURES } from './airgradient/model.js';

export const LEVELS = ['good', 'moderate', 'poor', 'very_poor'];

export const THRESHOLDS = {
  [MEASURES.CO2]: [800, 1000, 1500],
  [MEASURES.PM25]: [9, 35, 55],
};

export const LEVEL_COLORS = {
  good: WIDGET_COLORS.SUCCESS,
  moderate: WIDGET_COLORS.WARNING,
  poor: WIDGET_COLORS.DANGER,
  very_poor: WIDGET_COLORS.DANGER,
};

/** The level of one reading, or null for a measure without thresholds or no value. */
export function levelOf(key, value) {
  const thresholds = THRESHOLDS[key];
  if (!thresholds || typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const index = thresholds.findIndex((limit) => value <= limit);
  return LEVELS[index === -1 ? LEVELS.length - 1 : index];
}

/** The worst of several levels (nulls ignored), or null. */
export function worstLevel(levels) {
  const ranks = levels.filter(Boolean).map((level) => LEVELS.indexOf(level));
  return ranks.length === 0 ? null : LEVELS[Math.max(...ranks)];
}
