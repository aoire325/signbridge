import { CallSession } from '../../src/calls/call-session';

class Events {
  listeners = new Map<string, ((event: any) => void)[]>();
  addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) || []), listener]); }
  emit(name: string, event = {}) { this.listeners.get(name)?.forEach((listener) => listener(event)); }
}
class Track {
  id = Math.random().toString(); enabled = true; kind = 'video'; stop = jest.fn(); applyConstraints = jest.fn(async () => {});
}
class Stream {
  tracks = [new Track()]; release = jest.fn();
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getTrackById(id: string) { return this.tracks.find((track) => track.id === id); }
  addTrack(track: Track) { this.tracks.push(track); }
}
class Channel extends Events {
  label = 'signbridge-captions-v1'; readyState = 'connecting'; bufferedAmount = 0;
  send = jest.fn(); close = jest.fn();
  open() { this.readyState = 'open'; this.emit('open'); }
}
class Peer extends Events {
  connectionState = 'new'; remoteDescription: unknown = null; localDescription: any = null;
  channel = new Channel(); sender = { replaceTrack: jest.fn(async (_track: Track) => {}) };
  addTrack = jest.fn(); addTransceiver = jest.fn(() => ({ sender: this.sender })); close = jest.fn();
  createDataChannel = jest.fn(() => this.channel);
  createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'offer' })); createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'answer' }));
  setLocalDescription = jest.fn(async (value: object) => { this.localDescription = { toJSON: () => value }; });
  setRemoteDescription = jest.fn(async (value: object) => { this.remoteDescription = value; });
  addIceCandidate = jest.fn(async () => {});
  connect() { this.connectionState = 'connected'; this.emit('connectionstatechange'); }
}
class Socket {
  readyState = 0; onopen: (() => void) | null = null; onclose: ((event: { reason: string }) => void) | null = null;
  onerror: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  send = jest.fn(); close = jest.fn();
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup() {
  const stream = new Stream(); const socket = new Socket(); const peers: Peer[] = [];
  const getUserMedia = jest.fn(async () => stream);
  const rtc = { mediaDevices: { getUserMedia }, MediaStream: Stream,
    RTCPeerConnection: class extends Peer { constructor() { super(); peers.push(this); } },
    RTCSessionDescription: class { constructor(value: object) { Object.assign(this, value); } },
    RTCIceCandidate: class { constructor(value: object) { Object.assign(this, value); } } };
  const session = new CallSession(rtc as unknown as ConstructorParameters<typeof CallSession>[0], () => socket as unknown as WebSocket, jest.fn());
  const start = async () => { await session.start('wss://host/calls', { action: 'create', name: 'Alice', microphone: false, captions: true }); socket.open(); };
  const ready = async () => { socket.message({ type: 'ready', code: 'ABCDEFGHJKLM', peerName: 'Bob', initiator: true, iceServers: [] }); await flush(); return peers[0]; };
  return { session, stream, socket, peers, getUserMedia, start, ready };
}

describe('call ownership and signaling', () => {
  afterEach(() => jest.useRealTimers());
  it('starts with video only and negotiates a microphone slot without requiring audio permission', async () => {
    const t = setup(); await t.start();
    expect(t.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    const peer = await t.ready();
    expect(peer.addTransceiver).toHaveBeenCalledWith('audio', expect.objectContaining({ direction: 'sendrecv' }));
    expect(t.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'description', description: { type: 'offer', sdp: 'offer' } }));
    t.session.end();
  });
  it('releases a late permission result after the user has left', async () => {
    const t = setup(); let resolve!: (stream: Stream) => void;
    t.getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const starting = t.session.start('wss://host/calls', { action: 'create', name: 'Alice', microphone: false, captions: false });
    t.session.end(); resolve(t.stream); await starting;
    expect(t.stream.tracks[0].stop).toHaveBeenCalled(); expect(t.stream.release).toHaveBeenCalled();
    expect(t.session.state.localStream).toBeNull(); expect(t.session.state.phase).toBe('ended');
  });
  it('queues early ICE until the remote description has been applied', async () => {
    const t = setup(); await t.start(); const peer = await t.ready();
    t.socket.message({ type: 'ice', candidate: { candidate: 'candidate', sdpMid: '0', sdpMLineIndex: 0 } }); await flush();
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    t.socket.message({ type: 'description', description: { type: 'answer', sdp: 'answer' } }); await flush();
    expect(peer.addIceCandidate).toHaveBeenCalledTimes(1); t.session.end();
  });
  it('only sends captions over an open connected channel and ignores old or malformed captions', async () => {
    const t = setup(); await t.start(); const peer = await t.ready();
    expect(t.session.sendCaption('HELLO', 'ai')).toBe(false);
    peer.channel.open(); peer.connect();
    expect(t.session.sendCaption('HELLO', 'ai')).toBe(true);
    expect(t.session.state.localCaption?.kind).toBe('ai');
    peer.channel.emit('message', { data: JSON.stringify({ type: 'caption', sequence: 3, text: 'Hi', kind: 'typed' }) });
    peer.channel.emit('message', { data: JSON.stringify({ type: 'caption', sequence: 2, text: 'Old', kind: 'typed' }) });
    peer.channel.emit('message', { data: 'invalid' });
    expect(t.session.state.remoteCaption?.text).toBe('Hi');
    expect(t.session.sendCaption('', 'typed')).toBe(true);
    peer.channel.bufferedAmount = 20000; expect(t.session.sendCaption('Delayed', 'typed')).toBe(false);
    t.session.end(); expect(t.session.sendCaption('stale', 'ai')).toBe(false);
  });
  it('stops media, clears captions, and closes both transports on hang-up', async () => {
    const t = setup(); await t.start(); const peer = await t.ready(); peer.channel.open(); peer.connect(); t.session.sendCaption('Hello', 'typed');
    t.session.end();
    expect(t.stream.getTracks()[0].stop).toHaveBeenCalled(); expect(t.stream.release).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled(); expect(peer.channel.close).toHaveBeenCalled(); expect(t.socket.close).toHaveBeenCalled();
    expect(t.session.state.localCaption).toBeNull(); expect(t.session.state.remoteStream).toBeNull();
  });
  it('ends a stalled connection and releases the camera', async () => {
    jest.useFakeTimers(); const t = setup(); await t.start();
    jest.advanceTimersByTime(21000);
    expect(t.session.state.phase).toBe('error'); expect(t.stream.release).toHaveBeenCalled();
  });
  it('preserves the iOS native connection error delivered after the empty error event', async () => {
    const t = setup();
    await t.session.start('ws://192.168.1.10:8787/calls', { action: 'create', name: 'Alice', microphone: false, captions: false });
    t.socket.onerror?.();
    t.socket.onclose?.({ reason: 'The operation couldn’t be completed. Connection refused' });
    expect(t.session.state.phase).toBe('error');
    expect(t.session.state.message).toContain('Connection refused');
    expect(t.session.state.message).toContain('Local Network > SignBridge');
    expect(t.stream.release).toHaveBeenCalled();
  });
  it('still releases media if a socket reports an error without a close event', async () => {
    jest.useFakeTimers(); const t = setup(); await t.start();
    t.socket.onerror?.(); jest.advanceTimersByTime(250);
    expect(t.session.state.phase).toBe('error'); expect(t.stream.release).toHaveBeenCalled();
    expect(t.session.state.message).not.toContain('Local Network');
  });
  it('releases the camera even if signaling and channel teardown throw', async () => {
    const t = setup(); await t.start(); const peer = await t.ready();
    t.socket.send.mockImplementation(() => { throw new Error('Disconnected'); });
    t.socket.close.mockImplementation(() => { throw new Error('Already closed'); });
    peer.channel.close.mockImplementation(() => { throw new Error('Channel lost'); });
    expect(() => t.session.end()).not.toThrow();
    expect(peer.close).toHaveBeenCalled(); expect(t.stream.tracks[0].stop).toHaveBeenCalled();
    expect(t.stream.release).toHaveBeenCalled(); expect(t.session.state.phase).toBe('ended');
  });
  it('handles a socket send failure when joining without leaving the camera active', async () => {
    const t = setup();
    t.socket.send.mockImplementation(() => { throw new Error('Disconnected'); });
    await t.start();
    expect(t.session.state.phase).toBe('error'); expect(t.stream.release).toHaveBeenCalled();
  });
  it('enables the microphone after connecting through the negotiated audio sender', async () => {
    const t = setup(); await t.start(); const peer = await t.ready();
    const audio = new Stream(); audio.tracks[0].kind = 'audio';
    t.getUserMedia.mockResolvedValueOnce(audio);
    await t.session.toggleMicrophone();
    expect(peer.sender.replaceTrack).toHaveBeenCalledWith(audio.tracks[0]);
    expect(t.session.state.microphone).toBe(true); expect(audio.release).toHaveBeenCalledWith(false);
    await t.session.toggleMicrophone(); expect(audio.tracks[0].enabled).toBe(false);
    t.session.end(); expect(audio.tracks[0].stop).toHaveBeenCalled();
  });
  it('rejects duplicate starts while camera permission is pending', async () => {
    const t = setup(); let resolve!: (stream: Stream) => void;
    t.getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const options = { action: 'create' as const, name: 'Alice', microphone: false, captions: true };
    const first = t.session.start('wss://host/calls', options); await t.session.start('wss://host/calls', options);
    expect(t.getUserMedia).toHaveBeenCalledTimes(1); resolve(t.stream); await first; t.session.end();
  });
});
