# AirGradient fixtures

Answers of the local API of AirGradient monitors, used by the tests through the
fake monitor (`test/helpers/fakeAirGradient.js`). Serial numbers are invented
(`02c0ffee00xx`); nothing else identifies a real monitor.

| File                                  | Route               | Source                                                                               |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `one-3.1.1.json`                      | `/measures/current` | python-airgradient `tests/fixtures/current_measures.json`                            |
| `one-3.1.21.json`                     | `/measures/current` | python-airgradient `tests/fixtures/current_measures_2.json`                          |
| `one-zero-compensated-3.1.1.json`     | `/measures/current` | python-airgradient `tests/fixtures/current_measures_zero.json`                       |
| `one-after-boot-3.0.8.json`           | `/measures/current` | python-airgradient `tests/fixtures/measures_after_boot.json`                         |
| `one-boot-count-only-3.1.1.json`      | `/measures/current` | python-airgradient `tests/fixtures/legacy_boot_count_only.json`                      |
| `one-indoor-ha-3.1.1.json`            | `/measures/current` | Home Assistant `tests/components/airgradient/fixtures/current_measures_indoor.json`  |
| `open-air-o-1ppt-channels-3.1.1.json` | `/measures/current` | Home Assistant `tests/components/airgradient/fixtures/current_measures_outdoor.json` |
| `go-v1-full.json`                     | `/api/v1/measures`  | python-airgradient `tests/fixtures/v1/measures_full.json`                            |
| `go-v1-minimal.json`                  | `/api/v1/measures`  | python-airgradient `tests/fixtures/v1/measures_minimal.json`                         |
| `go-v1-zero.json`                     | `/api/v1/measures`  | python-airgradient `tests/fixtures/v1/measures_zero.json`                            |
| `config-one-both.json`                | `/config`           | Home Assistant `tests/components/airgradient/fixtures/get_config.json`               |
| `config-one-cloud.json`               | `/config`           | Home Assistant `tests/components/airgradient/fixtures/get_config_cloud.json`         |
| `config-one-local.json`               | `/config`           | Home Assistant `tests/components/airgradient/fixtures/get_config_local.json`         |
| `config-go-v1.json`                   | `/api/v1/config`    | python-airgradient `tests/fixtures/v1/config_go.json`                                |
| `open-air-o-1ppt-3.3.9.json`          | `/measures/current` | **constructed** from the firmware source (two PM sensors averaged, `channels`)       |
| `open-air-0-1ps-3.3.9.json`           | `/measures/current` | **constructed** from the firmware source (model code `0-1PS`, with a zero, as sent)  |
| `diy-basic-3.3.9.json`                | `/measures/current` | **constructed** from the firmware source (`DIY-BASIC-I-4.0PS`)                       |

The constructed files follow `Measurements::toString()` of
[airgradienthq/arduino](https://github.com/airgradienthq/arduino) (`src/AgValue.cpp`):
key names, rounding to two decimals, invalid sensors left out. They were not captured
on a real monitor: replace them with captures (`node scripts/probe.mjs <ip> --raw`)
when one is available.

Licenses: python-airgradient is MIT (© AirGradient), Home Assistant is Apache-2.0.
