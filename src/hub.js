// -----------------------------------------------------------------------------
// The AirGradient hub: finds the monitors, reads them, publishes their devices
// and states to Gladys, and runs the settings, the configuration actions and
// the scene action. Everything the SDK handlers, the scenes and the widget need
// goes through it (src/app.js wires it).
//
// Refresh: the devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll (Gladys
// 5.2.x skips the devices created without `should_poll`, and a device keeps
// the polling fields it was created with: GladysAssistant/Gladys#3198). So the
// hub reads every created monitor itself, at the configured interval. The
// timer skips a monitor read less than half a period ago; the core's onPoll
// (the fallback) skips one read less than 90 % of a period ago, so while the
// timer runs the core never adds a request.
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat
// every 12 hours so a stable value never shows "no recent value" (48 h).
// Readings are rounded (src/airgradient/model.js) so the noise of the sensors
// does not spend the 300 states per minute of the core.
//
// Logs: at info, only the lifecycle (start, a monitor found, moved, lost or
// back, one line per user action). A failure that repeats at every cycle is
// logged once, then at debug, with one line at recovery (src/issues.js).
// LOG_LEVEL=debug shows every cycle. The /config document of a monitor may
// hold an MQTT broker URL with credentials: it is never logged.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AirGradientClient } from './airgradient/client.js';
import {
  API,
  LED_BAR_MODES,
  MEASURES,
  SETTINGS,
  SETTING_FIELDS,
  TEMPERATURE_UNITS,
  modelInfo,
  normalizeSerial,
  parseConfig,
} from './airgradient/model.js';
import { buildDevice, defaultName, deviceIds, serialOf } from './devices.js';
import { MDNS_TIMEOUT_SECONDS, mapLimit, mdnsCandidates } from './discovery.js';
import { createIssueLog } from './issues.js';
import { levelOf } from './levels.js';
import { CONNECTION_TEXT, ERRORS, GladysError, REPORTS, join, render } from './messages.js';

const logger = createLogger({ name: 'airgradient' });

export const WIDGET_KEY = 'air_quality';
export const UNREACHABLE_TRIGGER = 'monitor_unreachable';

export const DEFAULT_TIMINGS = {
  // Monitors read at the same time.
  concurrency: 4,
  // Failed readings in a row before a monitor is declared unreachable.
  failuresBeforeUnreachable: 3,
  // New scan (mDNS + typed addresses), to follow DHCP changes and new monitors.
  rediscoveryMs: 30 * 60_000,
  // A scan asked by a monitor gone silent waits at least this since the last one.
  rescanGapMs: 5 * 60_000,
  heartbeatMs: 12 * 60 * 60_000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10_000,
};

const SETTING_KEYS = new Set(Object.values(SETTINGS));

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] test seam for the HTTP client
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {() => number} [options.now]
   * @param {object} [options.timings] DEFAULT_TIMINGS overrides
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetchImpl;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    /** @type {Map<string, object>} monitor records, by serial number */
    this.monitors = new Map();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.refreshTimer = null;
    this.running = null;
    // The background scan asked by a monitor gone silent (awaited by stop and the tests).
    this.rescan = null;
    this.lastScan = { mdns: 'not-run', at: -Infinity };
    this.lastRefreshAt = -Infinity;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  get periodMs() {
    return this.config.refreshSeconds * 1000;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    this.restoreFromGladys();
    // The known monitors first, so their devices are there even if they are off.
    await this.publishDevices();
    await this.discover();
    await this.publishDevices();
    // The monitors that just answered the scan are not read twice.
    await this.runCycle();
    await this.publishTransports();
    await this.publishConnectionStatus();
    logger.info(`Started: ${this.monitors.size} monitor(s), read every ${config.refreshSeconds} s`);
    this.requestRefresh();
    this.schedule();
  }

  /** Reconnection (Gladys restarted): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates?.();
    await this.publishDevices();
    await this.runCycle({ force: true });
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestRefresh();
  }

  async reconfigure(config) {
    const previous = this.config ?? config;
    this.config = config;
    if (previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.discover();
    }
    // Settings switched on or off: features appear or go, Gladys offers "Update".
    await this.publishDevices();
    if (previous.deviceSettings !== config.deviceSettings) {
      await this.runCycle({ force: true });
    }
    this.schedule();
    await this.publishConnectionStatus();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    clearTimeout(this.refreshTimer);
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    await this.running?.catch(() => {});
    await this.rescan;
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (!this.timers || this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.runCycle();
      this.schedule();
    }, this.periodMs);
    this.pollTimer.unref?.();
    if (!this.rediscoveryTimer) {
      this.rediscoveryTimer = setInterval(() => {
        this.rediscover().catch((err) => logger.debug(`Rediscovery failed: ${err.message}`));
      }, this.timings.rediscoveryMs);
      this.rediscoveryTimer.unref?.();
    }
  }

  // --- Persistence -----------------------------------------------------------

  createRecord({ serial, host, model = null, firmware = null, api = null, keys = [] }) {
    return {
      serial,
      host,
      model,
      firmware,
      api,
      keys: [...keys],
      client: new AirGradientClient(host, { fetch: this.fetch, api }),
      reachable: null,
      failures: 0,
      values: {},
      settings: {},
      control: null,
      lastPolledAt: undefined,
      inFlight: null,
      levels: '',
    };
  }

  async restore() {
    const data = await this.store.load();
    for (const [serial, saved] of Object.entries(data.monitors ?? {})) {
      if (!normalizeSerial(serial) || typeof saved?.host !== 'string') {
        continue;
      }
      this.monitors.set(
        serial,
        this.createRecord({
          serial,
          host: saved.host,
          model: typeof saved.model === 'string' ? saved.model : null,
          firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
          api: saved.api,
          keys: Array.isArray(saved.keys)
            ? saved.keys.filter((key) => typeof key === 'string')
            : [],
        }),
      );
    }
  }

  /**
   * Monitors already created in Gladys but missing from /data (file lost):
   * rebuilt from their device parameters, so they keep being read.
   */
  restoreFromGladys() {
    for (const device of this.gladys.devices ?? []) {
      const serial = serialOf(this.gladys, device.external_id);
      if (!serial || this.monitors.has(serial)) {
        continue;
      }
      const param = (name) => device.params?.find((p) => p.name === name)?.value;
      const host = param('HOST');
      if (typeof host !== 'string' || host === '') {
        continue;
      }
      const prefix = `${device.external_id}:`;
      const keys = (device.features ?? [])
        .map((feature) => feature.external_id?.slice(prefix.length))
        .filter((key) => Object.values(MEASURES).includes(key));
      this.monitors.set(
        serial,
        this.createRecord({ serial, host, model: param('MODEL') ?? null, keys }),
      );
      this.save();
    }
  }

  save() {
    const monitors = {};
    for (const monitor of this.monitors.values()) {
      monitors[monitor.serial] = {
        host: monitor.host,
        model: monitor.model,
        firmware: monitor.firmware,
        api: monitor.client.api ?? monitor.api,
        keys: monitor.keys,
      };
    }
    return this.store.save({ version: 1, monitors });
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Scan: mDNS through the Gladys core, the typed addresses and the known
   * ones. Resolves with the serial numbers that answered.
   */
  async discover() {
    // Priority when one monitor answers on several addresses: the typed one,
    // then the one mDNS announces, then the one known from before.
    const candidates = [];
    const add = (candidate) => {
      if (!candidates.some((known) => known.host === candidate.host)) {
        candidates.push(candidate);
      }
    };
    this.config.hosts.forEach((host) => add({ host, preferV1: false }));
    (await this.scanMdns()).forEach(add);
    [...this.monitors.values()].forEach((monitor) => add({ host: monitor.host, preferV1: false }));

    const results = await mapLimit(candidates, this.timings.concurrency, (candidate) =>
      this.probe(candidate),
    );
    const answered = new Set();
    for (const [index, result] of results.entries()) {
      if (result.error) {
        logger.debug(
          `No AirGradient answer from ${candidates[index].host}: ${result.error.message}`,
        );
        continue;
      }
      const { measures, client } = result.value;
      if (answered.has(measures.serial)) {
        continue;
      }
      answered.add(measures.serial);
      await this.adopt(candidates[index].host, client, measures);
    }
    this.lastScan = { ...this.lastScan, at: this.now(), found: answered.size };
    await this.save();
    return answered;
  }

  async scanMdns() {
    try {
      const results = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: MDNS_TIMEOUT_SECONDS,
      });
      const candidates = mdnsCandidates(results);
      this.issues.ok('mdns', 'mDNS scan through Gladys works again');
      this.lastScan = { ...this.lastScan, mdns: 'ok' };
      logger.debug(`mDNS: ${candidates.length} AirGradient announcement(s)`);
      return candidates;
    } catch (err) {
      // 403: an older core, or the capture refused. Typed addresses still work.
      this.issues.fail('mdns', `mDNS scan through Gladys unavailable: ${err.message}`);
      this.lastScan = { ...this.lastScan, mdns: 'unavailable' };
      return [];
    }
  }

  /** Ask one address who it is: `{ measures, client }`. */
  async probe({ host, preferV1 }) {
    const known = [...this.monitors.values()].find((monitor) => monitor.host === host);
    const client = new AirGradientClient(host, {
      fetch: this.fetch,
      api: known?.client.api ?? null,
      preferV1,
    });
    return { measures: await client.getMeasures(), client };
  }

  /**
   * Take a probe answer: a new monitor is added, a known one found at a new
   * address (DHCP) moves there. The reading itself is applied too.
   */
  async adopt(host, client, measures) {
    let monitor = this.monitors.get(measures.serial);
    if (!monitor) {
      monitor = this.createRecord({ serial: measures.serial, host, api: measures.api });
      monitor.client = client;
      this.monitors.set(measures.serial, monitor);
      logger.info(
        `${modelInfo(measures.model).name} ${measures.serial.slice(-4)} found at ${host}`,
      );
    } else if (monitor.host !== host) {
      logger.info(`${this.nameOf(monitor)} moved from ${monitor.host} to ${host}`);
      monitor.host = host;
      monitor.client = client;
    } else if (!monitor.client.api) {
      monitor.client.api = measures.api;
    }
    monitor.lastPolledAt = this.now();
    await this.applyReading(monitor, measures);
  }

  async rediscover() {
    await this.discover();
    // New monitors, and new addresses (DHCP) for the params of the created devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  // --- Devices ---------------------------------------------------------------

  buildAllDevices() {
    return [...this.monitors.values()].map((monitor) =>
      buildDevice(this.gladys, this.publishedShape(monitor), this.config),
    );
  }

  /** What buildDevice needs of a record. */
  publishedShape(monitor) {
    return {
      serial: monitor.serial,
      host: monitor.host,
      model: monitor.model,
      firmware: monitor.firmware,
      api: monitor.client.api ?? monitor.api,
      keys: monitor.keys,
    };
  }

  async publishDevices() {
    await this.toGladys('publishDiscoveredDevices', this.buildAllDevices()).catch(() => {});
  }

  /** The device the user created for a monitor, or undefined. */
  createdDevice(monitor) {
    const id = deviceIds(this.gladys, monitor.serial).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id);
  }

  /** The monitors whose device exists in Gladys: the ones worth reading. */
  createdMonitors() {
    return [...this.monitors.values()].filter((monitor) => this.createdDevice(monitor));
  }

  /** Feature keys of the created device of a monitor. */
  createdKeys(monitor) {
    const device = this.createdDevice(monitor);
    if (!device) {
      return [];
    }
    const prefix = `${device.external_id}:`;
    return (device.features ?? [])
      .map((feature) => feature.external_id)
      .filter((id) => typeof id === 'string' && id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));
  }

  nameOf(monitor) {
    return this.createdDevice(monitor)?.name ?? defaultName(this.publishedShape(monitor));
  }

  /** The monitor behind a device external id (a select value, a command), or a GladysError. */
  monitorOf(externalId) {
    const serial = serialOf(this.gladys, externalId);
    const monitor = serial ? this.monitors.get(serial) : undefined;
    if (!monitor) {
      throw new GladysError(render(ERRORS, 'unknown'), this.config.language);
    }
    return monitor;
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * One reading of every created monitor, a few at a time. Errors are logged
   * (never thrown). `force`: read even a monitor read moments ago.
   */
  runCycle({ force = false } = {}) {
    if (this.stopped) {
      return Promise.resolve();
    }
    const run = (async () => {
      if (this.gladys.connected === false) {
        logger.debug('Gladys unreachable: reading skipped');
        return;
      }
      const monitors = this.createdMonitors();
      await mapLimit(monitors, this.timings.concurrency, (monitor) =>
        this.pollMonitor(monitor, { force }),
      );
      logger.debug(`Reading cycle: ${monitors.length} monitor(s)`);
      this.issues.ok('cycle', 'Reading cycles work again');
    })().catch((err) => this.issues.fail('cycle', `Reading cycle failed: ${err.message}`, 'error'));
    const tracked = run.finally(() => {
      if (this.running === tracked) {
        this.running = null;
      }
    });
    this.running = tracked;
    return tracked;
  }

  /**
   * Read one monitor, unless it was read less than `minGap` periods ago.
   * Forced: waits for a reading in progress, then reads again.
   */
  async pollMonitor(monitor, { force = false, minGap = 0.5 } = {}) {
    while (monitor.inFlight && force) {
      await monitor.inFlight.catch(() => {});
    }
    if (monitor.inFlight) {
      return monitor.inFlight;
    }
    const last = monitor.lastPolledAt;
    if (!force && last !== undefined && this.now() - last < this.periodMs * minGap) {
      logger.debug(`${this.nameOf(monitor)}: read ${this.now() - last} ms ago, skipped`);
      return undefined;
    }
    monitor.lastPolledAt = this.now();
    monitor.inFlight = this.read(monitor).finally(() => {
      monitor.inFlight = null;
    });
    return monitor.inFlight;
  }

  async read(monitor) {
    let measures;
    let configDocument = null;
    try {
      measures = await monitor.client.getMeasures();
      if (measures.serial !== monitor.serial) {
        // Another monitor took this address (DHCP): look for this one again.
        throw new Error(
          `another monitor (${measures.serial.slice(-4)}) answers at ${monitor.host}`,
        );
      }
      if (this.wantsSettings(monitor)) {
        configDocument = await monitor.client.getConfig();
      }
    } catch (err) {
      await this.readingFailed(monitor, err);
      return;
    }
    if (configDocument) {
      const { control, values } = parseConfig(configDocument);
      monitor.control = control;
      monitor.settings = values;
    }
    await this.applyReading(monitor, measures);
  }

  /** The created device has setting features, and the monitor the legacy API. */
  wantsSettings(monitor) {
    return (
      (monitor.client.api ?? monitor.api) === API.LEGACY &&
      this.createdKeys(monitor).some((key) => SETTING_KEYS.has(key))
    );
  }

  async applyReading(monitor, measures) {
    monitor.failures = 0;
    monitor.values = measures.values;
    monitor.api = measures.api ?? monitor.api;
    let changed = false;
    if (measures.model && measures.model !== monitor.model) {
      monitor.model = measures.model;
      changed = true;
    }
    if (measures.firmware && measures.firmware !== monitor.firmware) {
      if (monitor.firmware) {
        logger.info(`${this.nameOf(monitor)} runs firmware ${measures.firmware}`);
      }
      monitor.firmware = measures.firmware;
      changed = true;
    }
    const newKeys = Object.keys(measures.values).filter((key) => !monitor.keys.includes(key));
    if (newKeys.length > 0) {
      monitor.keys.push(...newKeys);
      changed = true;
    }
    if (changed) {
      this.save();
      // A new measurement is a new feature: Gladys offers "Update".
      await this.publishDevices();
    }
    await this.reachabilityChanged(monitor, true);
    await this.publishStates(monitor);
    this.refreshIfLevelsChanged(monitor);
  }

  async readingFailed(monitor, err) {
    monitor.failures += 1;
    logger.debug(`Reading of ${this.nameOf(monitor)} failed: ${err.message}`);
    if (monitor.failures < this.timings.failuresBeforeUnreachable) {
      return;
    }
    await this.reachabilityChanged(monitor, false);
    // Its address may have changed (DHCP): look again, not too often.
    if (!this.rescan && this.now() - this.lastScan.at >= this.timings.rescanGapMs) {
      this.lastScan = { ...this.lastScan, at: this.now() };
      this.rescan = this.rediscover()
        .catch((error) => logger.debug(`Rediscovery failed: ${error.message}`))
        .finally(() => {
          this.rescan = null;
        });
    }
  }

  async reachabilityChanged(monitor, reachable) {
    const before = monitor.reachable;
    if (before === reachable) {
      return;
    }
    monitor.reachable = reachable;
    const name = this.nameOf(monitor);
    if (reachable) {
      if (before === false) {
        logger.info(`${name} answers again`);
      }
    } else {
      logger.info(`${name} does not answer (${monitor.host})`);
      if (before === true && this.createdDevice(monitor)) {
        await this.toGladys('publishSceneEvent', UNREACHABLE_TRIGGER, {
          device: deviceIds(this.gladys, monitor.serial).device,
          name,
          address: monitor.host,
        }).catch(() => {});
      }
    }
    if (before !== null || !reachable) {
      await this.publishTransports([monitor]);
      await this.publishConnectionStatus();
    }
    this.requestRefresh();
  }

  // --- States ----------------------------------------------------------------

  /** The states of the created device of a monitor: only its features, only known values. */
  statesOf(monitor) {
    const ids = deviceIds(this.gladys, monitor.serial);
    const states = [];
    for (const key of this.createdKeys(monitor)) {
      if (SETTING_KEYS.has(key)) {
        const value = monitor.settings[key];
        if (typeof value === 'number') {
          states.push({ device_feature_external_id: ids.feature(key), state: value });
        } else if (typeof value === 'string') {
          states.push({ device_feature_external_id: ids.feature(key), text: value });
        }
      } else if (typeof monitor.values[key] === 'number') {
        states.push({ device_feature_external_id: ids.feature(key), state: monitor.values[key] });
      }
    }
    return states;
  }

  async publishStates(monitor) {
    const states = this.statesOf(monitor);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.issues.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  async publishTransports(monitors = [...this.monitors.values()]) {
    const entries = monitors
      .filter((monitor) => monitor.reachable !== null && this.createdDevice(monitor))
      .map((monitor) => ({
        external_id: deviceIds(this.gladys, monitor.serial).device,
        transport: monitor.reachable ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.toGladys('publishTransports', entries.slice(at, at + 100)).catch(() => {});
    }
  }

  async publishConnectionStatus() {
    const monitors = [...this.monitors.values()];
    if (monitors.length === 0) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noMonitor).catch(() => {});
    } else if (monitors.every((monitor) => monitor.reachable === false)) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noAnswer).catch(() => {});
    } else {
      await this.toGladys('setConnectionStatus', true).catch(() => {});
    }
  }

  /**
   * A call to the Gladys host API. While Gladys restarts every call fails:
   * one warning when it starts, one info line when Gladys accepts them again.
   */
  async toGladys(method, ...args) {
    try {
      const result = await this.gladys[method](...args);
      this.issues.ok('gladys', 'Gladys accepts the updates again');
      return result;
    } catch (err) {
      this.issues.fail('gladys', `Gladys refused an update (${method}): ${err.message}`);
      throw err;
    }
  }

  // --- Gladys events -----------------------------------------------------------

  /**
   * The user added (or updated) a device: the SDK forgot its states, Gladys
   * dropped the ones sent before it existed. Read it now, send everything.
   */
  async onDeviceCreated(device) {
    const serial = serialOf(this.gladys, device?.external_id);
    const monitor = serial ? this.monitors.get(serial) : undefined;
    if (!monitor) {
      return;
    }
    await this.pollMonitor(monitor, { force: true });
    await this.publishTransports([monitor]);
    this.requestRefresh();
  }

  /** onPoll of the core (fallback): skipped when the timer has just read the monitor. */
  async poll(device) {
    const serial = serialOf(this.gladys, device?.external_id);
    const monitor = serial ? this.monitors.get(serial) : undefined;
    if (monitor) {
      await this.pollMonitor(monitor, { minGap: 0.9 });
    }
  }

  // --- Settings ----------------------------------------------------------------

  /** A command on a setting feature (display, LED bar, temperature unit). */
  async setValue(device, feature, value) {
    const monitor = this.monitorOf(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const name = this.nameOf(monitor);
    const { language } = this.config;
    if (!SETTING_KEYS.has(key) || !modelInfo(monitor.model).settings.includes(key)) {
      throw new GladysError(render(ERRORS, 'notSupported', { name }), language);
    }
    const field = SETTING_FIELDS[key];
    const wireValue = settingValue(key, value);
    if (wireValue === null) {
      throw new GladysError(render(ERRORS, 'invalidValue', { value: String(value) }), language);
    }
    await this.writeConfig(monitor, { [field]: wireValue });
    logger.info(`${name}: ${field} set to ${wireValue}`);
    monitor.settings[key] = wireValue;
    // Read back what the monitor applied.
    await this.pollMonitor(monitor, { force: true });
  }

  async writeConfig(monitor, fields) {
    try {
      await monitor.client.setConfig(fields);
    } catch (err) {
      throw this.deviceError(monitor, err);
    }
  }

  /** What the user reads when a monitor refuses or does not answer. */
  deviceError(monitor, err) {
    const name = this.nameOf(monitor);
    const { language } = this.config;
    if (err.unreachable) {
      return new GladysError(render(ERRORS, 'noAnswer', { name }), language);
    }
    if (err.cloudOnly) {
      return new GladysError(render(ERRORS, 'cloudOnly', { name }), language);
    }
    const reason = String(err.body || err.message).slice(0, 80);
    return new GladysError(render(ERRORS, 'refused', { name, reason }), language);
  }

  /** Configuration action: make a monitor take its settings from the local network only. */
  async useLocalSettings(fields) {
    const monitor = this.monitorOf(fields?.device);
    const name = this.nameOf(monitor);
    let control;
    try {
      control = parseConfig(await monitor.client.getConfig()).control;
    } catch {
      throw new GladysError(render(ERRORS, 'noAnswer', { name }), this.config.language);
    }
    if (control === 'local') {
      return render(REPORTS, 'localAlready', { name });
    }
    await this.writeConfig(monitor, { configurationControl: 'local' });
    monitor.control = 'local';
    logger.info(`${name}: settings now taken from the local network only`);
    return render(REPORTS, 'localDone', { name });
  }

  /**
   * Scene action: start the CO₂ calibration. Refused unless the user allowed
   * it in the configuration: the sensor takes what it reads as 400 ppm, which
   * spoils every reading of a monitor that is not in fresh outdoor air.
   */
  async calibrateCo2(fields) {
    const { language } = this.config;
    if (!this.config.co2Calibration) {
      throw new GladysError(render(ERRORS, 'calibrationDisabled'), language);
    }
    const monitor = this.monitorOf(fields?.device);
    const name = this.nameOf(monitor);
    if (!measureKnown(monitor, MEASURES.CO2)) {
      throw new GladysError(render(ERRORS, 'noCo2', { name }), language);
    }
    try {
      await monitor.client.calibrateCo2();
    } catch (err) {
      throw this.deviceError(monitor, err);
    }
    logger.info(`${name}: CO2 calibration started`);
    return {};
  }

  // --- Search report -----------------------------------------------------------

  /** Configuration action "Search": scan again and list the monitors. */
  async searchReport() {
    await this.rediscover();
    const monitors = [...this.monitors.values()];
    const parts = [];
    if (monitors.length === 0) {
      parts.push(render(REPORTS, 'none'));
    } else {
      const reachable = monitors.filter((monitor) => monitor.reachable !== false).length;
      parts.push(render(REPORTS, 'count', { total: monitors.length, reachable }));
      const list = Object.fromEntries(
        Object.keys(REPORTS).map((language) => [
          language,
          `${monitors
            .slice(0, 8)
            .map((monitor) => {
              const state = monitor.reachable === false ? `, ${REPORTS[language].unreachable}` : '';
              const firmware = monitor.firmware ? `, ${monitor.firmware}` : '';
              return `${this.nameOf(monitor)} (${monitor.host}${firmware}${state})`;
            })
            .join(', ')}.`,
        ]),
      );
      parts.push(list);
      if (monitors.some((monitor) => !this.createdDevice(monitor))) {
        parts.push(render(REPORTS, 'toDiscovery'));
      }
    }
    if (this.lastScan.mdns === 'unavailable') {
      parts.push(render(REPORTS, 'noMdns'));
    }
    if (this.config.invalidHosts.length > 0) {
      parts.push(
        render(REPORTS, 'ignored', { list: this.config.invalidHosts.slice(0, 3).join(', ') }),
      );
    }
    return join(...parts);
  }

  // --- Widget ------------------------------------------------------------------

  /** A refresh of the widget when a level it colours changes. */
  refreshIfLevelsChanged(monitor) {
    const levels = [MEASURES.CO2, MEASURES.PM25]
      .map((key) => levelOf(key, monitor.values[key]) ?? '-')
      .join('|');
    if (levels !== monitor.levels) {
      monitor.levels = levels;
      this.requestRefresh();
    }
  }

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows of one monitor, or null. */
  view(externalId) {
    const serial = serialOf(this.gladys, externalId);
    const monitor = serial ? this.monitors.get(serial) : undefined;
    const device = monitor && this.createdDevice(monitor);
    if (!device) {
      return null;
    }
    return {
      name: device.name,
      deviceId: device.external_id,
      reachable: monitor.reachable,
      values: { ...monitor.values },
      keys: this.createdKeys(monitor),
    };
  }
}

/** A measurement the monitor has (a feature) or has reported. */
function measureKnown(monitor, key) {
  return (
    monitor.keys.includes(key) ||
    modelInfo(monitor.model).expected.includes(key) ||
    typeof monitor.values[key] === 'number'
  );
}

/** The wire value of a setting command, or null when invalid. */
function settingValue(key, value) {
  if (key === SETTINGS.LED_BAR_MODE || key === SETTINGS.TEMPERATURE_UNIT) {
    const choice = String(value ?? '').toLowerCase();
    const allowed = key === SETTINGS.LED_BAR_MODE ? LED_BAR_MODES : TEMPERATURE_UNITS;
    return allowed.includes(choice) ? choice : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(number)));
}
