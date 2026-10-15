// -----------------------------------------------------------------------------
// Where to look for AirGradient monitors: the mDNS announcements relayed by the
// Gladys core (`_airgradient._tcp`, declared in the manifest
// `network_discovery`), the addresses typed in the configuration, and the
// addresses already known.
//
// The integration container sits on a bridge network: it never sees mDNS
// itself, the core browses for it (mediated network discovery). The firmware
// announces `_airgradient._tcp` on port 80 with the TXT records `serialno`,
// `model`, `fw_ver` and `vendor` (and `api=1` on the firmwares that only have
// the v1 API). Each address is then read over HTTP: the serial number the
// monitor reports identifies it, whatever address it answers on.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { normalizeSerial } from './airgradient/model.js';

export const MDNS_SERVICE = '_airgradient._tcp';
export const MDNS_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Candidates from the raw results of `scanNetwork('mdns')`:
 * `[{ host, serial, model, preferV1 }]`. IPv4 only: a link-local IPv6 address
 * cannot be reached from the container. Other services browsed by the core
 * (none today) are ignored by their TXT `vendor`.
 * @param {Array} results `[{ name, host, addresses, port, txt }]`
 */
export function mdnsCandidates(results) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    const name = typeof result.name === 'string' ? result.name : '';
    if (
      txt.vendor &&
      String(txt.vendor).toLowerCase() !== 'airgradient' &&
      !/airgradient/i.test(name)
    ) {
      continue;
    }
    const addresses = Array.isArray(result.addresses) ? result.addresses : [];
    const ipv4 = addresses.find((address) => typeof address === 'string' && IPV4.test(address));
    if (!ipv4) {
      continue;
    }
    const port = Number.isInteger(result.port) && result.port !== 80 ? `:${result.port}` : '';
    const host = `${ipv4}${port}`;
    if (candidates.some((candidate) => candidate.host === host)) {
      continue;
    }
    candidates.push({
      host,
      serial: normalizeSerial(txt.serialno),
      model: typeof txt.model === 'string' ? txt.model : null,
      preferV1: txt.api === '1',
    });
  }
  return candidates;
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
