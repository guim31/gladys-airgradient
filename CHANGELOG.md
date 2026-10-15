# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- AirGradient air quality monitors in Gladys, over their local API (no account,
  no cloud): the AirGradient ONE, the Open Air, the DIY kits (firmware 3.1 or
  later) and the AirGradient Go.
- One device per monitor, found automatically on the network (mDNS, through
  Gladys) or added by its IP address, and followed by its serial number when
  its address changes.
- Its measurements, refreshed every minute (30 s to 5 min): PM1, PM2.5, PM10,
  CO₂, temperature, humidity, TVOC and NOx indexes, 0.3 µm particle count,
  Wi-Fi signal and, on the Go, the battery. The corrected values of the
  firmware are used when it provides them; only what the model measures is
  published.
- Optional monitor settings from Gladys (AirGradient ONE, DIY kits): display
  and LED bar brightness, LED bar mode, display temperature unit. A
  **Use local settings** action for the monitors locked to the AirGradient
  cloud.
- An **Air quality** dashboard widget: live CO₂, PM2.5, temperature and
  humidity, with the air quality in colour.
- A scene trigger when a monitor stops answering, and a scene action to
  calibrate the CO₂ sensor, refused unless allowed in the configuration.
- Texts, feature names and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-airgradient/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-airgradient/releases/tag/v1.0.1
