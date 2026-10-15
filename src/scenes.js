// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - calibrate_co2: starts the CO₂ sensor calibration (the "fresh air" one: the
//   sensor takes its current reading as 400 ppm). Refused unless the user
//   allowed it in the configuration (`co2_calibration`, off by default): run
//   indoors, it would shift every later reading. A scene can run it, for
//   example, on a schedule while the monitor is outside, which is the point.
//
// There is no "set the display" action: with `device_settings`, the display
// and the LED bar are device features, which the core's own "Control a
// device" action already drives.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  calibrate_co2: (hub, { fields }) => hub.calibrateCo2(fields),
};
