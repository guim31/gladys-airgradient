# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data`** (`/data/airgradient.json`): the AirGradient monitors
  seen so far — serial number, IP address, model, firmware version, API format
  and the measurements each one reported. No secret, no account, no token: the
  local API of the monitors has no password, and the integration needs none.
- **Network**: from its container, HTTP requests to port 80 of the monitors
  only (the addresses announced over mDNS, typed in the configuration or known
  from before): `GET` of the measures and of `/config`, and `PUT /config` or
  `POST` of the calibration action only when the user changes a setting, runs
  "Use local settings" or a scene runs the CO₂ calibration (off by default).
  The mDNS browse for `_airgradient._tcp` is done by the Gladys core on the
  integration's behalf (manifest `network_discovery`). Nothing leaves the local
  network: the AirGradient cloud is not contacted.
- **Logs**: never the `/config` document of a monitor, which may hold an MQTT
  broker URL with credentials.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the AirGradient monitors and their firmware (report to AirGradient), and the
AirGradient cloud.
