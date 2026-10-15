// -----------------------------------------------------------------------------
// A fake AirGradient monitor: the routes of the local API, answered like the
// firmware does (examples/OneOpenAir/LocalServer.cpp and src/AgConfigure.cpp of
// airgradienthq/arduino), from the fixtures of test/fixtures/airgradient.
//
// - `createFakeNetwork({ host: monitor })` gives an in-memory `fetch`, for the
//   tests of the integration (fast, no socket, works with mocked timers);
// - `startFakeServer(monitor)` serves the same monitor over real HTTP on the
//   loopback, for the tests of the HTTP client and for `npm run fake`.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/airgradient/${name}`, import.meta.url), 'utf8'));

const CLOUD_ONLY =
  'Monitor set to accept only configuration from the cloud. Use property configurationControl to change.';

export class FakeMonitor {
  /**
   * @param {object} options
   * @param {object} options.measures the measures document (a fixture)
   * @param {object} [options.config] the /config document (a fixture)
   * @param {'legacy'|'v1'} [options.api] the routes the firmware has
   */
  constructor({ measures, config = fixture('config-one-local.json'), api = 'legacy' }) {
    this.measures = structuredClone(measures);
    this.config = structuredClone(config);
    this.api = api;
    this.online = true;
    this.requests = [];
    this.calibrations = 0;
  }

  get serial() {
    return this.measures.serialno ?? this.measures.serialNumber;
  }

  /** Change readings: `monitor.set({ rco2: 900 })`. */
  set(values) {
    Object.assign(this.measures, values);
  }

  /** One request: `{ status, body, contentType }`. */
  handle(method, path, body) {
    this.requests.push({ method, path, body });
    const json = (document, status = 200) => ({
      status,
      body: JSON.stringify(document),
      contentType: 'application/json',
    });
    const plain = (text, status) => ({ status, body: text, contentType: 'text/plain' });
    const legacy = this.api === 'legacy';
    if (method === 'GET' && path === (legacy ? '/measures/current' : '/api/v1/measures')) {
      return json(this.measures);
    }
    if (method === 'GET' && path === (legacy ? '/config' : '/api/v1/config')) {
      return json(this.config);
    }
    if (legacy && method === 'PUT' && path === '/config') {
      return this.putConfig(body);
    }
    if (!legacy && method === 'POST' && path === '/api/v1/actions/calibrate-co2') {
      this.calibrations += 1;
      return json({ status: 'accepted' });
    }
    // The ESP32 web server answers a bare 404 on an unknown route.
    return plain('Not found', 404);
  }

  putConfig(raw) {
    const plain = (text, status) => ({ status, body: text, contentType: 'text/plain' });
    let fields;
    try {
      fields = JSON.parse(raw);
    } catch {
      return plain('JSON invalid', 400);
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return plain('JSON invalid', 400);
    }
    const control = fields.configurationControl;
    if (control !== undefined) {
      if (!['both', 'local', 'cloud'].includes(control)) {
        return plain(`'configurationControl' value '${control}' invalid`, 400);
      }
      this.config.configurationControl = control;
    }
    if (this.config.configurationControl === 'cloud') {
      return plain(CLOUD_ONLY, 400);
    }
    for (const key of ['displayBrightness', 'ledBarBrightness']) {
      if (fields[key] !== undefined) {
        if (typeof fields[key] !== 'number' || fields[key] < 0 || fields[key] > 100) {
          return plain(`'${key}' value '${fields[key]}' invalid`, 400);
        }
        this.config[key] = fields[key];
      }
    }
    if (fields.ledBarMode !== undefined) {
      if (!['off', 'co2', 'pm'].includes(fields.ledBarMode)) {
        return plain(`'ledBarMode' value '${fields.ledBarMode}' invalid`, 400);
      }
      this.config.ledBarMode = fields.ledBarMode;
    }
    if (fields.temperatureUnit !== undefined) {
      if (!['c', 'f'].includes(String(fields.temperatureUnit).toLowerCase())) {
        return plain(`'temperatureUnit' value '${fields.temperatureUnit}' invalid`, 400);
      }
      this.config.temperatureUnit = fields.temperatureUnit;
    }
    if (fields.co2CalibrationRequested === true) {
      this.calibrations += 1;
    }
    return plain('Success', 200);
  }
}

const response = ({ status, body, contentType }) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => body,
});

/**
 * In-memory network: `hosts[host] = FakeMonitor`; an unknown host, or a
 * monitor with `online = false`, refuses the connection like a real fetch.
 */
export function createFakeNetwork(hosts = {}) {
  const network = {
    hosts: { ...hosts },
    requests: [],
    async fetch(url, init = {}) {
      const { host, pathname } = new URL(url);
      const method = init.method ?? 'GET';
      network.requests.push({ host, method, path: pathname });
      const monitor = network.hosts[host];
      if (!monitor || !monitor.online) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'EHOSTUNREACH' };
        throw error;
      }
      return response(monitor.handle(method, pathname, init.body));
    },
  };
  return network;
}

/** Serve one monitor over HTTP on 127.0.0.1; resolves `{ host, close }`. */
export async function startFakeServer(monitor, { port = 0, address = '127.0.0.1' } = {}) {
  const server = createServer((request, reply) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const answer = monitor.handle(
        request.method,
        new URL(request.url, 'http://x').pathname,
        body,
      );
      reply.writeHead(answer.status, { 'Content-Type': answer.contentType });
      reply.end(answer.body);
    });
  });
  await new Promise((resolve) => server.listen(port, address, resolve));
  return {
    host: `${address}:${server.address().port}`,
    server,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The raw mDNS result the core would relay for a monitor at `host`. */
export function mdnsResult(host, monitor) {
  const [address, port] = host.split(':');
  return {
    name: `airgradient_${monitor.serial}`,
    host: `airgradient_${monitor.serial}.local`,
    addresses: [address, 'fe80::1'],
    port: port ? Number(port) : 80,
    txt: [
      `model=${monitor.measures.model}`,
      `serialno=${monitor.serial}`,
      `fw_ver=${monitor.measures.firmware}`,
      'vendor=AirGradient',
      ...(monitor.api === 'v1' ? ['api=1'] : []),
    ],
  };
}
