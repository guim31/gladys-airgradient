// -----------------------------------------------------------------------------
// HTTP client of the local API of one AirGradient monitor (port 80, no
// authentication). Read-only except `setConfig` and `calibrateCo2`.
//
// The wire format is detected on the first reading, like the `airgradient`
// Python library: the legacy route first (firmware 3.x), the v1 route when the
// legacy one answers a bare 404 (a firmware that only has the v1 API). An mDNS
// TXT `api=1` hint reverses the order. The detected format is kept for the
// life of the client.
// -----------------------------------------------------------------------------

import { API, parseMeasures } from './model.js';

export const REQUEST_TIMEOUT_MS = 10_000;

const ROUTES = {
  [API.LEGACY]: { measures: '/measures/current', config: '/config' },
  [API.V1]: { measures: '/api/v1/measures', config: '/api/v1/config' },
};

export class AirGradientError extends Error {
  /**
   * @param {string} message
   * @param {{ unreachable?: boolean, status?: number, body?: string, structured?: boolean }} [details]
   *   `structured`: the error answer is a JSON document (a route that exists)
   */
  constructor(message, { unreachable = false, status = null, body = '', structured = false } = {}) {
    super(message);
    this.unreachable = unreachable;
    this.status = status;
    this.body = body;
    this.structured = structured;
  }

  /** The monitor refuses local settings (its `configurationControl` is `cloud`). */
  get cloudOnly() {
    return this.status === 400 && /cloud/i.test(this.body);
  }
}

export class AirGradientClient {
  /**
   * @param {string} host `ip` or `ip:port`
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {string|null} [options.api] a known format (from /data), or null to detect
   * @param {boolean} [options.preferV1] the mDNS TXT says `api=1`
   * @param {number} [options.timeoutMs]
   */
  constructor(host, { fetch: fetchImpl, api = null, preferV1 = false, timeoutMs } = {}) {
    this.host = host;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.api = Object.values(API).includes(api) ? api : null;
    this.preferV1 = preferV1;
    this.timeoutMs = timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  url(path) {
    return `http://${this.host}${path}`;
  }

  /** One request; resolves `{ status, body }`, rejects with an AirGradientError. */
  async request(path, { method = 'GET', json } = {}) {
    let response;
    try {
      response = await this.fetch(this.url(path), {
        method,
        headers: {
          Accept: 'application/json',
          ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'no answer' : (err?.cause?.code ?? err.message);
      throw new AirGradientError(`${this.host} unreachable (${reason})`, { unreachable: true });
    }
    let body;
    try {
      body = await response.text();
    } catch (err) {
      throw new AirGradientError(`${this.host} cut the answer (${err.message})`, {
        unreachable: true,
      });
    }
    return { status: response.status, body, contentType: response.headers?.get?.('content-type') };
  }

  async getJson(path) {
    const { status, body, contentType } = await this.request(path);
    if (status !== 200) {
      throw new AirGradientError(`${this.host}${path} answered HTTP ${status}`, {
        status,
        body,
        structured: /json/i.test(contentType ?? '') || /^\s*[[{]/.test(body),
      });
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new AirGradientError(`${this.host}${path} did not answer JSON`, { status });
    }
  }

  /** Current measures, parsed: `{ serial, model, firmware, values, api }`. */
  async getMeasures() {
    if (this.api) {
      const document = await this.getJson(ROUTES[this.api].measures);
      return { ...parseMeasures(document, this.api), api: this.api };
    }
    const [first, second] = this.preferV1 ? [API.V1, API.LEGACY] : [API.LEGACY, API.V1];
    let document;
    let api = first;
    try {
      document = await this.getJson(ROUTES[first].measures);
    } catch (err) {
      // A bare 404 is a route the firmware does not have; anything else is an answer.
      if (err.status !== 404 || err.structured) {
        throw err;
      }
      api = second;
      document = await this.getJson(ROUTES[second].measures);
    }
    const measures = parseMeasures(document, api);
    this.api = api;
    return { ...measures, api };
  }

  /** The raw /config document of the detected format. */
  async getConfig() {
    if (!this.api) {
      await this.getMeasures();
    }
    return this.getJson(ROUTES[this.api].config);
  }

  /**
   * Change settings (legacy format only): `{ displayBrightness: 40 }`. The
   * monitor answers 200 "Success", or 400 with the reason in plain text.
   */
  async setConfig(fields) {
    if (!this.api) {
      await this.getMeasures();
    }
    if (this.api !== API.LEGACY) {
      throw new AirGradientError(`${this.host} settings are not supported by its API`, {
        status: 404,
      });
    }
    const { status, body } = await this.request(ROUTES[API.LEGACY].config, {
      method: 'PUT',
      json: fields,
    });
    if (status !== 200) {
      throw new AirGradientError(
        `${this.host} refused the settings (HTTP ${status}: ${short(body)})`,
        {
          status,
          body,
        },
      );
    }
  }

  /** Start the CO₂ calibration (the sensor takes its reading as 400 ppm). */
  async calibrateCo2() {
    if (!this.api) {
      await this.getMeasures();
    }
    if (this.api === API.LEGACY) {
      await this.setConfig({ co2CalibrationRequested: true });
      return;
    }
    const { status, body } = await this.request('/api/v1/actions/calibrate-co2', {
      method: 'POST',
    });
    if (status < 200 || status >= 300) {
      throw new AirGradientError(`${this.host} refused the calibration (HTTP ${status})`, {
        status,
        body,
      });
    }
  }
}

const short = (body) => String(body ?? '').slice(0, 120);
