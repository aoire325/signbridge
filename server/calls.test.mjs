import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createCallServer, iceConfiguration } from './calls.mjs';

async function fixture(t) {
  const service = createCallServer({ env: {} });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(() => service.close());
  const url = `ws://127.0.0.1:${service.server.address().port}/calls`;
  async function connect() { const socket = new WebSocket(url); await once(socket, 'open'); return socket; }
  return { connect };
}
const receive = async (socket) => JSON.parse((await once(socket, 'message'))[0].toString());
const send = (socket, value) => socket.send(JSON.stringify(value));

test('two clients join a private room, exchange SDP and ICE, and receive hang-up', async (t) => {
  const { connect } = await fixture(t);
  const host = await connect(); const guest = await connect();
  const created = receive(host); send(host, { type: 'create', name: 'Alice' });
  const { code } = await created; assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  const hostReady = receive(host); const guestReady = receive(guest);
  send(guest, { type: 'join', name: 'Bob', code });
  assert.equal((await hostReady).initiator, true); assert.equal((await guestReady).peerName, 'Alice');
  const offer = receive(guest); send(host, { type: 'description', description: { type: 'offer', sdp: 'v=0' } });
  assert.equal((await offer).description.sdp, 'v=0');
  const ice = receive(host); send(guest, { type: 'ice', candidate: { candidate: 'candidate', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await ice).type, 'ice');
  const ended = receive(guest); send(host, { type: 'leave' }); assert.equal((await ended).type, 'ended');
});

test('a third caller cannot enter a full room, and a closed invite cannot be reused', async (t) => {
  const { connect } = await fixture(t); const host = await connect(); const guest = await connect(); const extra = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  const ready = receive(guest); send(guest, { type: 'join', name: 'Guest', code }); await ready;
  const rejected = receive(extra); send(extra, { type: 'join', name: 'Extra', code }); assert.equal((await rejected).type, 'error');
  const ended = receive(guest); host.close(); await ended;
  const expired = receive(extra); send(extra, { type: 'join', name: 'Extra', code }); assert.equal((await expired).type, 'error');
});

test('guessed codes, invalid names, and non-signaling payloads are rejected', async (t) => {
  const { connect } = await fixture(t); const client = await connect();
  let reply = receive(client); send(client, { type: 'join', name: 'Guest', code: 'AAAAAAAAAAAA' }); assert.equal((await reply).type, 'error');
  reply = receive(client); send(client, { type: 'create', name: '' }); assert.equal((await reply).type, 'error');
  reply = receive(client); send(client, { type: 'create', name: 'Host' }); await reply;
  // Once a peer exists, captions cannot be smuggled through the signaling server.
  const close = once(client, 'close'); client.send('invalid JSON'); assert.equal((await close)[0], 1008);
});

test('production requires relay credentials and issues expiring TURN passwords', () => {
  assert.throws(() => iceConfiguration({ NODE_ENV: 'production' }), /TURN/);
  const config = iceConfiguration({ NODE_ENV: 'production', TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:5349', TURN_SECRET: 'test-only' });
  assert.equal(config.length, 2); assert.ok(config[1].credential); assert.ok(Number(config[1].username.split(':')[0]) > Date.now() / 1000);
  assert.throws(() => iceConfiguration({ TURN_URLS: 'https://wrong.example.com' }), /TURN_URLS/);
});
