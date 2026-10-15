// -----------------------------------------------------------------------------
// scripts/probe.mjs against the fake monitor on the loopback: read-only, and
// nothing sensitive printed (the serial is shortened, the credentials a
// /config may hold are hidden).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FakeMonitor, fixture, startFakeServer } from './helpers/fakeAirGradient.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/probe.mjs', import.meta.url));

test('the probe reads, never writes, and hides what is sensitive', async (t) => {
  const secret = 'pr0be-S3cret';
  const monitor = new FakeMonitor({
    measures: { ...fixture('one-3.1.21.json'), serialno: 'aabbccdd1234' },
    config: { ...fixture('config-one-local.json'), mqttBrokerUrl: `mqtt://u:${secret}@192.0.2.50` },
  });
  const server = await startFakeServer(monitor);
  t.after(() => server.close());
  const { stdout } = await run(process.execPath, [script, server.host, '--raw']);
  assert.match(stdout, /model {6}: I-9PSL \(AirGradient ONE\)/);
  assert.match(stdout, /co2 {10}566/);
  assert.match(stdout, /serial {5}: …1234/);
  assert.ok(!stdout.includes('aabbccdd1234'), 'the full serial is not printed');
  assert.ok(!stdout.includes(secret), 'the MQTT credentials are not printed');
  assert.match(stdout, /"mqttBrokerUrl": "<hidden>"/);
  assert.deepEqual([...new Set(monitor.requests.map((request) => request.method))], ['GET']);
});

test('the probe says when nothing answers', async () => {
  const server = await startFakeServer(new FakeMonitor({ measures: fixture('one-3.1.1.json') }));
  await server.close();
  await assert.rejects(run(process.execPath, [script, server.host]), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /No AirGradient answer/);
    return true;
  });
});
