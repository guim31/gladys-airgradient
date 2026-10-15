// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { INIT_FAILED } from './messages.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'airgradient-app' });

// A configuration action displays what it resolves, in the user's language,
// while a thrown error shows a single string: the mistakes of the user (an
// unknown device, a monitor locked to the cloud) are answered, not thrown.
const answered =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.messages) {
        return err.messages;
      }
      throw err;
    }
  };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, now, timings
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
    timings: options.timings,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first scan is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  // The Discovery tab asks for a refresh: search the network again.
  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The hub reads the monitors with its own timer; this is the fallback,
  // skipped while the timer runs (see src/hub.js).
  gladys.onPoll(whenReady((device) => hub.poll(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => hub.reconfigure(normalizeConfig(newConfig))));

  const actions = {
    search: () => hub.searchReport(),
    use_local_settings: (fields) => hub.useLocalSettings(fields),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(
      key,
      whenReady(
        answered((fields) => {
          logger.info(`Action ${key}`);
          return handler(fields);
        }),
      ),
    );
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    actions: Object.keys(actions),
    stop: () => hub.stop(),
  };
}
