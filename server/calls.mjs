import { createServer } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...randomBytes(12)].map((value) => alphabet[value % alphabet.length]).join('');
const validCode = (value) => typeof value === 'string' && /^[A-HJ-NP-Z2-9]{12}$/.test(value);
const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };

export function iceConfiguration(env = process.env) {
  const urls = (env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (urls.some((url) => !/^turns?:[^\s]+$/.test(url))) throw new Error('TURN_URLS must contain turn: or turns: URLs.');
  if (env.NODE_ENV === 'production' && (!urls.length || !env.TURN_SECRET)) {
    throw new Error('Production calls require TURN_URLS and TURN_SECRET for relay connectivity.');
  }
  const result = [{ urls: ['stun:stun.l.google.com:19302'] }];
  if (urls.length && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 10800}:${randomBytes(8).toString('hex')}`;
    result.push({ urls, username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return result;
}

/** Two-person, capability-based rooms. Possession of the random invitation is access.
 * Only connection metadata passes through this service; captions use the encrypted
 * WebRTC data channel. Nothing is persisted, and room codes/SDP are never logged.
 */
export function createCallServer({ env = process.env, now = Date.now } = {}) {
  iceConfiguration(env); // Fail at startup if deployment configuration is incomplete.
  const rooms = new Map();
  const addresses = new Map();
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(request.url === '/health' ? { ok: true } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ server, path: '/calls', maxPayload: 65536, perMessageDeflate: false });
  const closeRoom = (code, reason = 'The other person left the call.') => {
    const room = rooms.get(code);
    if (!room) return;
    rooms.delete(code);
    for (const member of room.members) {
      member.room = null;
      send(member.socket, { type: 'ended', message: reason });
      member.socket.close(1000);
    }
  };
  wss.on('connection', (socket, request) => {
    // Use the socket address, not an untrusted forwarded header. A reverse proxy
    // should additionally rate-limit upgrades by the actual client IP.
    const address = request.socket.remoteAddress || 'unknown';
    if (wss.clients.size > 500 || (addresses.get(address) || 0) >= 30) { socket.close(1013); return; }
    addresses.set(address, (addresses.get(address) || 0) + 1);
    const member = { socket, room: null, name: '', joinedAt: now(), alive: true, count: 0, window: now(), attempts: 0 };
    socket.on('pong', () => { member.alive = true; });
    socket.on('message', (raw, binary) => {
      if (now() - member.window > 10000) { member.window = now(); member.count = 0; }
      if (++member.count > 120 || binary) { socket.close(1008); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008); return; }
      if (!message || typeof message !== 'object') { socket.close(1008); return; }
      if (message.type === 'create' || message.type === 'join') {
        if (member.room || ++member.attempts > 5) { socket.close(1008); return; }
        if (typeof message.name !== 'string' || !message.name.trim() || message.name.length > 40) {
          send(socket, { type: 'error', message: 'Enter a display name of up to 40 characters.' }); return;
        }
        member.name = message.name.trim().replace(/[\x00-\x1f\x7f]/g, '');
        if (!member.name) { socket.close(1008); return; }
        if (message.type === 'create') {
          let code = newCode();
          while (rooms.has(code)) code = newCode();
          member.room = code;
          rooms.set(code, { members: [member], createdAt: now(), connectedAt: null });
          send(socket, { type: 'created', code });
        } else {
          const room = validCode(message.code) ? rooms.get(message.code) : null;
          if (!room || room.members.length !== 1 || now() - room.createdAt > 15 * 60000) {
            send(socket, { type: 'error', message: 'This invite is unavailable, full, or expired. Ask for a new code.' }); return;
          }
          member.room = message.code; room.members.push(member); room.connectedAt = now();
          const iceServers = iceConfiguration(env);
          room.members.forEach((person, index) => send(person.socket, {
            type: 'ready', code: member.room, initiator: index === 0, peerName: room.members[1 - index].name, iceServers,
          }));
        }
        return;
      }
      const room = rooms.get(member.room);
      if (!room) { socket.close(1008); return; }
      if (message.type === 'leave') { closeRoom(member.room); return; }
      const peer = room.members.find((person) => person !== member);
      if (!peer) return;
      if (message.type === 'description') {
        const description = message.description;
        const expected = room.members[0] === member ? 'offer' : 'answer';
        if (!description || description.type !== expected || typeof description.sdp !== 'string' || description.sdp.length > 60000) {
          socket.close(1008); return;
        }
        send(peer.socket, { type: 'description', description: { type: description.type, sdp: description.sdp } });
      } else if (message.type === 'ice') {
        const candidate = message.candidate;
        if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096
          || (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 100))
          || (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 20))) {
          socket.close(1008); return;
        }
        send(peer.socket, { type: 'ice', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } });
      } else socket.close(1008);
    });
    socket.on('close', () => {
      addresses.set(address, Math.max(0, (addresses.get(address) || 1) - 1));
      if (!addresses.get(address)) addresses.delete(address);
      if (member.room) closeRoom(member.room);
    });
    socket.on('error', () => socket.close());
    socket.member = member;
  });
  const sweep = setInterval(() => {
    for (const [code, room] of rooms) {
      if ((!room.connectedAt && now() - room.createdAt > 15 * 60000) || (room.connectedAt && now() - room.connectedAt > 2 * 3600000)) {
        closeRoom(code, 'This call expired. Start a new call to continue.');
      }
    }
    for (const socket of wss.clients) {
      const member = socket.member;
      if (!member) continue;
      if (!member.alive || (!member.room && now() - member.joinedAt > 30000)) { socket.terminate(); continue; }
      member.alive = false; socket.ping();
    }
  }, 15000);
  sweep.unref();
  wss.on('close', () => clearInterval(sweep));
  return { server, wss, close: async () => {
    clearInterval(sweep);
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createCallServer();
  const port = Number(process.env.PORT || 8787);
  server.listen(port, '0.0.0.0', () => console.log(`SignBridge call signaling listening on port ${port}`));
}
