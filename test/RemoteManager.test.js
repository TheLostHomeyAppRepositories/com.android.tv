'use strict';

// Unit tests for the RemoteManager reconnect state machine.
//
// These run against the COMPILED output in .homeybuild/ (run `npm run build`
// first — the `test` npm script does this for you). We test against the built
// JS rather than the .ts source because RemoteMessageManager loads its protobuf
// via __dirname at construction time, which only resolves for the CommonJS
// build. Only Node built-ins are used (node:test, assert) — no new deps.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const EventEmitter = require('node:events');

// RemoteMessageManager.loadSync() reads remotemessage.proto relative to its own
// __dirname; tsc does not copy non-TS assets, so mirror the proto into the build
// output before requiring the compiled module.
const PROTO_SRC = path.join(__dirname, '..', 'androidtv-remote', 'remote', 'remotemessage.proto');
const PROTO_DST = path.join(__dirname, '..', '.homeybuild', 'androidtv-remote', 'remote', 'remotemessage.proto');
fs.mkdirSync(path.dirname(PROTO_DST), { recursive: true });
fs.copyFileSync(PROTO_SRC, PROTO_DST);

// Patch tls.connect to hand back controllable fake sockets. RemoteManager calls
// tls.connect(...) at runtime, so patching the shared module object is enough.
const sockets = [];
const realConnect = tls.connect;
tls.connect = function fakeConnect() {
  const socket = new FakeSocket();
  sockets.push(socket);
  return socket;
};

// Minimal model of a tls.TLSSocket for our purposes: 'close' destroys the socket
// (destroyed=true, not writable), and destroy() emits a single 'close'.
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writable = true;
    this.destroyCalled = false;
    this.removeAllCalled = false;
    this.written = [];
    this.timeoutMs = null;
    this.on('close', () => {
      this.destroyed = true;
      this.writable = false;
    });
  }
  setTimeout(ms) {
    this.timeoutMs = ms;
  }
  write(buf) {
    this.written.push(buf);
    return true;
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyCalled = true;
    this.emit('close', false);
    this.destroyed = true;
    this.writable = false;
  }
  removeAllListeners(...args) {
    // Forward zero arguments when called with none: EventEmitter checks
    // arguments.length, so an explicit undefined would remove listeners for an event
    // named "undefined" instead of removing them all.
    this.removeAllCalled = true;
    return super.removeAllListeners(...args);
  }
}

function makeFakeHomey() {
  const timers = [];
  let idc = 1;
  return {
    timers,
    setTimeout(fn, ms) {
      const id = idc++;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const t = timers.find(x => x.id === id);
      if (t) t.cleared = true;
    },
  };
}

const { RemoteManager } = require('../.homeybuild/androidtv-remote/remote/RemoteManager.js');

const CERTS = { key: 'fake-key', cert: 'fake-cert' };

function newManager(homey, cap = 60000) {
  const rm = new RemoteManager('10.0.0.1', 6466, CERTS, homey, cap, 'man', 'mod');
  rm.on('log.error', () => {});
  rm.on('log.debug', () => {});
  rm.on('log.info', () => {});
  rm.on('close', () => {});
  rm.on('ready', () => {});
  return rm;
}

function lastSocket() {
  return sockets[sockets.length - 1];
}

function lastTimer(homey) {
  return homey.timers[homey.timers.length - 1];
}

test.beforeEach(() => {
  sockets.length = 0;
});

test.after(() => {
  tls.connect = realConnect;
});

test('reconnect delay follows bounded-exponential backoff up to the cap', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey, 60000);

  const delays = [];
  rm.start();
  for (let i = 0; i < 6; i++) {
    const socket = lastSocket();
    const before = homey.timers.length;
    socket.emit('close', false); // transient close → schedule reconnect
    assert.strictEqual(homey.timers.length, before + 1, 'each close schedules exactly one reconnect');
    delays.push(lastTimer(homey).ms);
    lastTimer(homey).fn(); // fire the reconnect → next start() opens a fresh socket
  }

  // base = min(5000, cap) = 5000; doubling; capped at 60000.
  assert.deepStrictEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000]);
});

test('single-flight: a second start() while connecting does not open a second socket', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start(); // opens socket 1, no secureConnect yet → still connecting
  assert.strictEqual(sockets.length, 1);
  rm.start(); // must no-op while connecting
  assert.strictEqual(sockets.length, 1, 'no second concurrent socket');
});

test('close clears the connecting flag so reconnection is not permanently locked', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  lastSocket().emit('close', false); // failed connect (never secureConnected)
  lastTimer(homey).fn(); // reconnect must actually open a new socket (proves not locked)
  assert.strictEqual(sockets.length, 2, 'reconnect opened a fresh socket after a failed connect');
});

test('stop() during a pending connect tears down the socket and prevents any further reconnect', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  const socket = lastSocket();
  rm.stop();
  assert.ok(socket.destroyCalled, 'socket destroyed on stop');
  assert.ok(socket.removeAllCalled, 'listeners removed on stop');

  const before = homey.timers.filter(t => !t.cleared).length;
  socket.emit('close', false); // must be ignored once destroyed
  const after = homey.timers.filter(t => !t.cleared).length;
  assert.strictEqual(after, before, 'no reconnect scheduled after stop()');
});

test('start() after stop() is a no-op', async () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);
  rm.stop();
  await rm.start();
  assert.strictEqual(sockets.length, 0, 'no socket opened after stop()');
});

test('a late close from a stale (replaced) socket schedules no reconnect', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  const first = lastSocket();
  first.emit('close', false); // schedules reconnect #1
  lastTimer(homey).fn(); // reconnect → opens socket #2 (now the current client)
  assert.strictEqual(sockets.length, 2);

  const before = homey.timers.length;
  first.emit('close', false); // stale: teardown removed its listeners → no-op
  assert.strictEqual(homey.timers.length, before, 'stale socket does not schedule a reconnect');
});

test('backoff counter resets on application-level ready (remoteConfigure), NOT on secureConnect', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  lastSocket().emit('close', false); // attempt → 1
  lastTimer(homey).fn();
  lastSocket().emit('close', false); // attempt → 2
  lastTimer(homey).fn();
  const socket = lastSocket();
  assert.ok(rm.reconnectAttempts >= 2, 'counter advanced after failed attempts');

  socket.emit('secureConnect'); // TLS up, but NOT the app-level handshake
  assert.ok(rm.reconnectAttempts >= 2, 'secureConnect must NOT reset the backoff counter');

  // A real remoteConfigure frame → the 'ready' path resets the counter.
  socket.emit('data', Buffer.from(rm.remoteMessageManager.createRemoteConfigure()));
  assert.strictEqual(rm.reconnectAttempts, 0, 'application-level ready resets the counter');
});

test('idle timeout destroys the socket (half-open detection) and schedules a reconnect', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  const socket = lastSocket();
  assert.strictEqual(socket.timeoutMs, 10000, 'socket idle timeout armed at 10s');
  socket.emit('timeout'); // RM handler → socket.destroy()
  assert.ok(socket.destroyCalled, 'idle timeout destroys the socket');
  assert.strictEqual(lastTimer(homey).ms, 5000, 'reconnect scheduled after idle-timeout close');
});

test('teardown resets the receive buffer so a reconnect does not desync', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  // A partial frame: header claims length 10 but only 3 bytes arrive → buffered.
  lastSocket().emit('data', Buffer.from([10, 1, 2]));
  assert.ok(rm.chunks.length > 0, 'partial frame buffered');
  rm.stop(); // teardownSocket resets chunks
  assert.strictEqual(rm.chunks.length, 0, 'chunks reset on teardown');
});

test('per-attempt error flag is reset at the start of the next attempt', () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  rm.start();
  const socket = lastSocket();
  socket.emit('error', new Error('boom'));
  assert.ok(rm.error, 'error recorded on the socket error event');
  socket.emit('close', true); // schedule reconnect
  lastTimer(homey).fn(); // next start() resets error
  assert.strictEqual(rm.error, null, 'error reset at the start of the next attempt');
});

// node:test has no default timeout, so without one this would hang rather than fail.
test('start() does not block on the connect outcome (TV off at init)', { timeout: 1000 }, async () => {
  // The load-bearing guarantee: the original bug was start() resolving only on
  // secureConnect, so a TV that is off at init hung the awaited start() forever.
  const homey = makeFakeHomey();
  const rm = newManager(homey);

  await rm.start(); // no secureConnect and no close: must still resolve
  assert.strictEqual(sockets.length, 1, 'the connect attempt was fired');

  lastSocket().emit('close', false); // the connect fails later on
  assert.strictEqual(lastTimer(homey).ms, 5000, 'and the reconnect loop takes over');
});

test('a synchronous tls.connect throw recovers into backoff', async () => {
  const homey = makeFakeHomey();
  const rm = newManager(homey);
  const saved = tls.connect;
  tls.connect = function throwingConnect() {
    throw new Error('malformed cert');
  };
  try {
    const before = homey.timers.length;
    await rm.start(); // no socket and no close event to fall back on
    assert.strictEqual(homey.timers.length, before + 1, 'a reconnect was scheduled after the throw');
    assert.strictEqual(lastTimer(homey).ms, 5000, 'recovers into the base 5s backoff, not a deadlock');
  } finally {
    tls.connect = saved;
  }
});
