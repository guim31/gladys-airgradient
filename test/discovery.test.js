import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit, mdnsCandidates } from '../src/discovery.js';

const announce = (overrides = {}) => ({
  name: 'airgradient_02c0ffee0001',
  host: 'airgradient_02c0ffee0001.local',
  addresses: ['fe80::4a3f:daff:fe00:1', '192.0.2.10'],
  port: 80,
  txt: ['model=I-9PSL', 'serialno=02c0ffee0001', 'fw_ver=3.1.21', 'vendor=AirGradient'],
  ...overrides,
});

test('an mDNS announcement gives the IPv4 address, the serial and the model', () => {
  assert.deepEqual(mdnsCandidates([announce()]), [
    { host: '192.0.2.10', serial: '02c0ffee0001', model: 'I-9PSL', preferV1: false },
  ]);
});

test('a port other than 80 is kept, api=1 asks for the v1 routes first', () => {
  const [candidate] = mdnsCandidates([
    announce({ port: 8080, txt: ['serialno=02c0ffee0005', 'model=P-1PSG', 'api=1'] }),
  ]);
  assert.equal(candidate.host, '192.0.2.10:8080');
  assert.equal(candidate.preferV1, true);
});

test('IPv6-only, foreign vendors, duplicates and junk are ignored', () => {
  assert.deepEqual(
    mdnsCandidates([
      announce({ addresses: ['fe80::1'] }),
      announce({ name: 'printer', txt: ['vendor=Acme'] }),
      announce(),
      announce(),
      null,
      'junk',
      { addresses: '192.0.2.99' },
    ]).map((candidate) => candidate.host),
    ['192.0.2.10'],
  );
  assert.deepEqual(mdnsCandidates(undefined), []);
});

test('mapLimit keeps the order and catches the failures', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    if (n === 3) {
      throw new Error('three');
    }
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results[0], { value: 10 });
  assert.equal(results[2].error.message, 'three');
  assert.deepEqual(results[4], { value: 50 });
});
