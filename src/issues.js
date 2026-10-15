// -----------------------------------------------------------------------------
// Repeated failures, logged once.
//
// A monitor unplugged for the night, Gladys restarting, a /data that cannot be
// written: each would write the same warning at every cycle. An issue log
// keeps, per key, whether the problem is ongoing: the first failure is a
// warning (or an error), the next ones go to debug, and the recovery is one
// info line.
// -----------------------------------------------------------------------------

/**
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} logger
 */
export function createIssueLog(logger) {
  const ongoing = new Set();
  return {
    /**
     * Report a failure: logged the first time, debug while it lasts.
     * @param {string} key what failed (one key per independent problem)
     * @param {string} message
     * @param {'warn'|'error'} [level]
     */
    fail(key, message, level = 'warn') {
      if (ongoing.has(key)) {
        logger.debug(`${message} (still failing)`);
        return;
      }
      ongoing.add(key);
      logger[level](message);
    },

    /**
     * Report a success: one info line when it ends an ongoing failure.
     * @param {string} key
     * @param {string} message said on recovery only
     */
    ok(key, message) {
      if (ongoing.delete(key)) {
        logger.info(message);
      }
    },

    /** @param {string} key */
    isFailing(key) {
      return ongoing.has(key);
    },
  };
}
