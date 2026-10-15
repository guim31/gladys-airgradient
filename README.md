# AirGradient for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that reads the
[AirGradient](https://www.airgradient.com) air quality monitors — the AirGradient ONE (indoor),
the Open Air (outdoor), the DIY kits and the AirGradient Go — over their **local API**: no
account, no cloud, no API key. The equivalent of the Home Assistant `airgradient` integration.

> **Developed without the hardware: feedback welcome.** The integration is covered by automated
> tests (the real answers published with the `airgradient` Python library and the Home Assistant
> integration, a fake monitor following the firmware source, the SDK's fake Gladys), but has not
> yet run against a real AirGradient monitor nor in a real Gladys installation. Please report what
> works and what does not in the [issues](https://github.com/guim31/gladys-airgradient/issues).

This integration is not affiliated with AirGradient.

## Features

- **One device per monitor**, found automatically on the network (mDNS `_airgradient._tcp`,
  browsed by the Gladys core for the container), or added by its IP address. A monitor is
  identified by its serial number: a new address (DHCP) is followed, its device stays.
- **Measurements**, refreshed every minute (30 s to 5 min): PM1, PM2.5, PM10, CO₂, temperature,
  humidity, TVOC index, NOx index, 0.3 µm particle count, Wi-Fi signal, and the battery of the Go.
  Only what the model measures; the **corrected values** of the firmware (`pm02Compensated`,
  `atmpCompensated`, `rhumCompensated`) when it sends them.
- **Monitor settings** from Gladys, as an option (AirGradient ONE, DIY kits): display and LED bar
  brightness (sliders), LED bar mode and display temperature unit (lists). A **Use local
  settings** action unlocks the monitors set to take their settings from the AirGradient cloud
  only.
- **Dashboard widget** _Air quality_: live CO₂, PM2.5, temperature and humidity tiles, and the air
  quality in colour (thresholds of the AirGradient LED bar).
- **Scene trigger** _AirGradient monitor not answering_ (a sensor that goes silent is otherwise
  invisible: its last values just stay), and **scene action** _Calibrate the AirGradient CO₂
  sensor_, refused unless allowed in the configuration (a calibration indoors spoils every later
  reading).
- English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions, mediated mDNS).
- An AirGradient monitor on firmware 3.1 or later (the local API exists since 3.0.10), on a network
  Gladys can reach. Firmwares that only have the newer `/api/v1` routes (the AirGradient Go) are
  read too.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-airgradient` (or install it from the catalog once it is
   listed). The install screen shows the access the integration asks for: the **mDNS search for
   `_airgradient._tcp`**.
2. Open the **Discover** tab and press **Add to Gladys** on each monitor. A monitor on another
   network: type its IP address in the **Configuration** tab, then **Search for monitors**.
3. Optionally, turn on **Monitor settings from Gladys** or allow the **CO₂ calibration**.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **Reading**: `GET http://<monitor>/measures/current` (firmware 3.x), or `GET /api/v1/measures`
  when the legacy route answers a bare 404, like the `airgradient` Python library. The settings
  come from `GET /config` and go back with `PUT /config`; the calibration is
  `{"co2CalibrationRequested": true}` (or `POST /api/v1/actions/calibrate-co2`).
- **Refresh**: the container reads the created devices itself, at the configured interval. The
  devices are published with `should_poll: true` and a one-minute `poll_frequency`, but the core's
  poll is only a fallback, skipped while the internal timer runs (the core does not poll external
  devices reliably, GladysAssistant/Gladys#3198).
- **States**: only the values that changed are sent (rounded to what the sensors resolve), plus a
  heartbeat every 12 hours. The local API has no quota; one reading a minute is also what Home
  Assistant does.
- **Reachability**: three failed readings in a row make a monitor "unreachable" (transport badge,
  connection status, scene trigger) and start a new mDNS search, in case its address changed.

## Limitations

- Local API only: the AirGradient cloud API (with a token) is not supported.
- The settings of the AirGradient Go (`/api/v1/config`) and of the Open Air (no display) are not
  offered.
- Gladys has no PM1 nor NOx category: PM1 is a `pm25-sensor` feature named "PM1" (like the core's
  own Matter mapping), the NOx index a `voc-index-sensor` feature named "NOx index".
- The local API has no authentication: anyone on the LAN can read a monitor, and change its
  settings when it accepts local settings.
- Developed without the hardware: the Open Air and DIY answers used by the tests are built from
  the firmware source, not captured (see [`test/fixtures/airgradient`](test/fixtures/airgradient)).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: the SDK's fake Gladys and fake monitors, no network
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator

npm run fake -- one-3.1.21.json 8080     # a fake monitor on 127.0.0.1:8080
npm run probe -- 192.168.1.50            # read-only check of a real monitor (--raw: fixtures)
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/app.js                handlers → hub, configuration actions
src/hub.js                monitors, discovery, internal timer, states, settings, trigger
src/airgradient/client.js HTTP client of the local API (legacy and v1 routes)
src/airgradient/model.js  measures and /config parsing, model families
src/devices.js            the Gladys device of a monitor (features, names in 4 languages)
src/discovery.js          mDNS answers relayed by the core
src/levels.js             air quality levels of the widget
src/scenes.js             scene action
src/widgets.js            dashboard widget
src/messages.js           texts sent from the container, four languages
src/store.js              /data persistence
src/config.js             configuration defaults and normalization
scripts/probe.mjs         read-only probe of a real monitor
```

## Credits

- [airgradienthq/python-airgradient](https://github.com/airgradienthq/python-airgradient) (MIT,
  © AirGradient, written by Joost Lekkerkerker): the API detection, the preference for the
  corrected values, and the real answers used as test fixtures.
- [Home Assistant](https://www.home-assistant.io/integrations/airgradient/) `airgradient`
  integration (Apache-2.0, code owners AirGradient and Joost Lekkerkerker): the model capabilities, the local-only settings, and more fixtures.
- [airgradienthq/arduino](https://github.com/airgradienthq/arduino), the AirGradient firmware: the
  local API documentation, the mDNS announcement, the LED bar thresholds, read to follow the
  protocol (CC BY-SA 4.0, nothing copied).

AirGradient is a trademark of its owner. This integration is not affiliated with AirGradient nor
with Home Assistant.

## License

Apache-2.0, see [LICENSE](LICENSE).
