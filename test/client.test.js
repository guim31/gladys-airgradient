// -----------------------------------------------------------------------------
// The HTTP client against the fake monitor served over real HTTP on the
// loopback: format detection, errors, settings and calibration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AirGradientClient } from '../src/airgradient/client.js';
import { FakeMonitor, fixture, startFakeServer } from './helpers/fakeAirGradient.js';

async function serve(t, monitor) {
  const server = await startFakeServer(monitor);
  t.after(() => server.close());
  return server.host;
}

test('a legacy firmware is read on /measures/current', async (t) => {
  const monitor = new FakeMonitor({ measures: fixture('one-3.1.1.json') });
  const client = new AirGradientClient(await serve(t, monitor));
  const measures = await client.getMeasures();
  assert.equal(measures.api, 'legacy');
  assert.equal(measures.values.co2, 778);
  assert.equal(client.api, 'legacy');
  // The format is detected once: the v1 route is never tried.
  await client.getMeasures();
  assert.deepEqual(
    monitor.requests.map((request) => request.path),
    ['/measures/current', '/measures/current'],
  );
});

test('a v1-only firmware: the bare 404 of the legacy route leads to the v1 route', async (t) => {
  const monitor = new FakeMonitor({ measures: fixture('go-v1-full.json'), api: 'v1' });
  const client = new AirGradientClient(await serve(t, monitor));
  const measures = await client.getMeasures();
  assert.equal(measures.api, 'v1');
  assert.equal(measures.values.battery, 87);
  assert.deepEqual(
    monitor.requests.map((request) => request.path),
    ['/measures/current', '/api/v1/measures'],
  );
});

test('the mDNS hint api=1 tries the v1 route first', async (t) => {
  const monitor = new FakeMonitor({ measures: fixture('go-v1-full.json'), api: 'v1' });
  const client = new AirGradientClient(await serve(t, monitor), { preferV1: true });
  await client.getMeasures();
  assert.deepEqual(
    monitor.requests.map((request) => request.path),
    ['/api/v1/measures'],
  );
});

test('a structured error is an answer, not a missing route', async (t) => {
  const server = createServer((request, reply) => {
    reply.writeHead(404, { 'Content-Type': 'application/json' });
    reply.end('{"error":{"code":"not_ready"}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new AirGradientClient(`127.0.0.1:${server.address().port}`);
  await assert.rejects(client.getMeasures(), (err) => err.status === 404 && err.structured);
  assert.equal(client.api, null);
});

test('a monitor that is off is "unreachable", one that hangs times out', async (t) => {
  const closed = await startFakeServer(new FakeMonitor({ measures: fixture('one-3.1.1.json') }));
  await closed.close();
  await assert.rejects(new AirGradientClient(closed.host).getMeasures(), (err) => err.unreachable);

  const sockets = new Set();
  const silent = createServer(() => {});
  silent.on('connection', (socket) => sockets.add(socket));
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    sockets.forEach((socket) => socket.destroy());
    return new Promise((resolve) => silent.close(resolve));
  });
  // AbortSignal.timeout does not hold the event loop: keep a timer alive.
  const keepAlive = setInterval(() => {}, 50);
  t.after(() => clearInterval(keepAlive));
  const client = new AirGradientClient(`127.0.0.1:${silent.address().port}`, { timeoutMs: 200 });
  await assert.rejects(
    client.getMeasures(),
    (err) => err.unreachable && /no answer/.test(err.message),
  );
});

test('a document that is not JSON, or without serial, is an error', async (t) => {
  const server = createServer((request, reply) => {
    reply.writeHead(200, { 'Content-Type': 'text/html' });
    reply.end('<html>captive portal</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    new AirGradientClient(`127.0.0.1:${server.address().port}`).getMeasures(),
    /did not answer JSON/,
  );
  const anonymous = new FakeMonitor({ measures: { model: 'I-9PSL', rco2: 500 } });
  await assert.rejects(new AirGradientClient(await serve(t, anonymous)).getMeasures(), /serial/);
});

test('settings are written with PUT /config; a cloud-only monitor refuses them', async (t) => {
  const monitor = new FakeMonitor({ measures: fixture('one-3.1.1.json') });
  const client = new AirGradientClient(await serve(t, monitor));
  await client.setConfig({ displayBrightness: 40 });
  assert.equal(monitor.config.displayBrightness, 40);
  assert.deepEqual(JSON.parse(monitor.requests.at(-1).body), { displayBrightness: 40 });

  const locked = new FakeMonitor({
    measures: fixture('one-3.1.1.json'),
    config: fixture('config-one-cloud.json'),
  });
  const lockedClient = new AirGradientClient(await serve(t, locked));
  await assert.rejects(
    lockedClient.setConfig({ ledBarMode: 'off' }),
    (err) => err.status === 400 && err.cloudOnly,
  );
  await assert.rejects(
    client.setConfig({ ledBarMode: 'rainbow' }),
    (err) => err.status === 400 && !err.cloudOnly && /ledBarMode/.test(err.message),
  );
});

test('the CO₂ calibration: a config flag on legacy firmwares, an action on v1', async (t) => {
  const one = new FakeMonitor({ measures: fixture('one-3.1.1.json') });
  await new AirGradientClient(await serve(t, one)).calibrateCo2();
  assert.equal(one.calibrations, 1);
  assert.deepEqual(JSON.parse(one.requests.at(-1).body), { co2CalibrationRequested: true });

  const go = new FakeMonitor({ measures: fixture('go-v1-full.json'), api: 'v1' });
  await new AirGradientClient(await serve(t, go), { api: 'v1' }).calibrateCo2();
  assert.equal(go.calibrations, 1);
  assert.equal(go.requests.at(-1).path, '/api/v1/actions/calibrate-co2');

  // The v1 settings are not supported (yet): refused before any request.
  const before = go.requests.length;
  await assert.rejects(
    new AirGradientClient('unused', { api: 'v1' }).setConfig({ displayBrightness: 1 }),
    /not supported/,
  );
  assert.equal(go.requests.length, before);
});
