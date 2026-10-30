import type { MediaStream, RTCPeerConnection, RTCRtpSender, RTCIceCandidate, RTCSessionDescription } from 'react-native-webrtc';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import { CAPTION_LIMIT, normalizeInvite, parseCallMessage, validInvite, type Caption, type CaptionKind, type MediaState } from './protocol';

export type CallPhase = 'idle' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';
export type CallState = {
  phase: CallPhase; code: string; peerName: string; message: string; localStream: MediaStream | null;
  remoteStream: MediaStream | null; camera: boolean; microphone: boolean; frontCamera: boolean;
  captions: boolean; channelReady: boolean; localCaption: Caption | null; remoteCaption: Caption | null;
  peerMedia: MediaState; startedAt: number | null;
};
export const initialCallState = (): CallState => ({ phase: 'idle', code: '', peerName: '', message: '', localStream: null,
  remoteStream: null, camera: true, microphone: false, frontCamera: true, captions: false, channelReady: false,
  localCaption: null, remoteCaption: null, peerMedia: { type: 'media', camera: true, microphone: false, captions: false }, startedAt: null });
type RTC = typeof import('react-native-webrtc');
type Options = { action: 'create' | 'join'; code?: string; name: string; microphone: boolean; captions: boolean };

/** One owner for sockets, tracks, and the peer connection. Every asynchronous
 * continuation checks this session's generation before publishing or sending.
 */
export class CallSession {
  state = initialCallState();
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private audioSender: RTCRtpSender | null = null;
  private pendingIce: RTCIceCandidate[] = [];
  private generation = 0;
  private captionSequence = 0;
  private receivedSequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private microphoneBusy = false;
  private cameraBusy = false;
  private signalQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rtc: RTC, private readonly createSocket: (url: string) => WebSocket,
    private readonly update: (state: CallState) => void) {}

  private patch(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.update(this.state); }
  private sendSignal(message: object) {
    if (this.socket?.readyState !== 1) throw new Error('The call service disconnected. Start a new call.');
    this.socket.send(JSON.stringify(message));
  }
  private timeout(milliseconds: number, message: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.end(message, true), milliseconds);
  }
  private mediaState(): MediaState {
    return { type: 'media', camera: this.state.camera, microphone: this.state.microphone, captions: this.state.captions };
  }
  private broadcastMedia() {
    if (this.channel?.readyState === 'open') {
      try { this.channel.send(JSON.stringify(this.mediaState())); }
      catch { this.patch({ message: 'The connection is interrupted. Your media controls still apply locally.' }); }
    }
  }

  async start(url: string, options: Options) {
    if (!['idle', 'ended', 'error'].includes(this.state.phase)) return;
    const name = options.name.trim();
    if (!name || name.length > 40) { this.patch({ phase: 'error', message: 'Enter your name, up to 40 characters.' }); return; }
    if (options.action === 'join' && !validInvite(options.code || '')) { this.patch({ phase: 'error', message: 'Enter the 12-character invite code.' }); return; }
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.captionSequence = 0; this.receivedSequence = 0;
    this.patch({ ...initialCallState(), phase: 'starting', captions: options.captions, message: 'Opening your camera…' });
    try {
      const stream = await this.rtc.mediaDevices.getUserMedia({ audio: options.microphone,
        video: { facingMode: 'user', width: 640, height: 480, frameRate: 24 } });
      if (!current()) { stream.getTracks().forEach((track) => track.stop()); stream.release(); return; }
      this.patch({ localStream: stream, microphone: options.microphone, message: 'Connecting to the call service…' });
      const socket = this.createSocket(url);
      this.socket = socket;
      let socketOpened = false;
      let socketFailed = false;
      const connectionError = (reason?: string) => {
        const help = url.startsWith('ws:')
          ? 'Check that the phone and computer are on the same Wi-Fi and the call server is running. On iPhone, check Settings > Privacy & Security > Local Network > SignBridge.'
          : 'Check your internet connection and try again.';
        const detail = reason?.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 240);
        return `Could not reach the call service. ${help}${detail ? ` Details: ${detail}` : ''}`;
      };
      this.timeout(20000, 'The call service did not respond. Check your connection and try again.');
      socket.onopen = () => {
        if (!current()) return;
        socketOpened = true;
        try { this.sendSignal({ type: options.action, name, ...(options.action === 'join' ? { code: normalizeInvite(options.code!) } : {}) }); }
        catch { this.end('The call service disconnected. Start a new call.', true); }
      };
      socket.onmessage = ({ data }) => {
        // Serialize offer/answer and ICE; native setRemoteDescription is async.
        this.signalQueue = this.signalQueue.then(async () => {
          if (!current()) return;
          if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid call service response.');
          const message = JSON.parse(data);
          if (message.type === 'error') throw new Error(typeof message.message === 'string' ? message.message : 'Could not join this call.');
          if (message.type === 'ended') { this.end(typeof message.message === 'string' ? message.message : 'The call ended.'); return; }
          if (message.type === 'created') {
            if (!validInvite(message.code || '')) throw new Error('Invalid invitation from the call service.');
            if (this.timer) clearTimeout(this.timer);
            this.patch({ phase: 'waiting', code: message.code, message: 'Share the code with someone to start talking.' }); return;
          }
          if (message.type === 'ready') {
            if (this.peer || !validInvite(message.code || '') || typeof message.initiator !== 'boolean'
              || typeof message.peerName !== 'string' || !Array.isArray(message.iceServers)) throw new Error('Invalid connection details.');
            this.patch({ phase: 'connecting', code: message.code, peerName: message.peerName.slice(0, 40), message: 'Connecting your call…' });
            this.timeout(45000, 'The call could not connect. Try another network or ask the host for a new invite.');
            const peer = new this.rtc.RTCPeerConnection({ iceServers: message.iceServers });
            this.peer = peer;
            const local = this.state.localStream!;
            local.getVideoTracks().forEach((track) => peer.addTrack(track, local));
            // Always negotiate an audio slot, even when the caller starts muted.
            // Microphone permission is requested only when they choose to use it.
            this.audioSender = peer.addTransceiver(local.getAudioTracks()[0] ?? 'audio', { direction: 'sendrecv', streams: [local] }).sender;
            peer.addEventListener('icecandidate', (event) => {
              if (!current() || !event.candidate || this.socket?.readyState !== 1) return;
              try { this.sendSignal({ type: 'ice', candidate: event.candidate.toJSON() }); }
              catch { this.end('The call service disconnected. Start a new call.', true); }
            });
            peer.addEventListener('track', (event) => {
              if (!current() || !event.track) return;
              const remote = event.streams[0] ?? this.state.remoteStream ?? new this.rtc.MediaStream();
              if (!remote.getTrackById(event.track.id)) remote.addTrack(event.track);
              this.patch({ remoteStream: remote });
            });
            peer.addEventListener('datachannel', (event) => { if (current()) this.bindChannel(event.channel, current); });
            peer.addEventListener('connectionstatechange', () => {
              if (!current()) return;
              if (peer.connectionState === 'connected') {
                if (this.timer) clearTimeout(this.timer);
                this.patch({ phase: 'connected', startedAt: this.state.startedAt ?? Date.now(), message: 'Connected' });
              } else if (peer.connectionState === 'disconnected') {
                this.patch({ phase: 'reconnecting', message: 'Connection interrupted. Trying to reconnect…' });
                this.timeout(15000, 'Connection lost. Start a new call to reconnect.');
              } else if (peer.connectionState === 'failed') this.end('The connection failed. Start a new call to try again.', true);
            });
            if (message.initiator) {
              this.bindChannel(peer.createDataChannel('signbridge-captions-v1', { ordered: true }), current);
              const offer = await peer.createOffer(); if (!current()) return;
              await peer.setLocalDescription(offer); if (!current()) return;
              this.sendSignal({ type: 'description', description: peer.localDescription?.toJSON() });
            }
            return;
          }
          if (message.type === 'description') {
            const peer = this.peer;
            if (!peer || !['offer', 'answer'].includes(message.description?.type) || typeof message.description?.sdp !== 'string') throw new Error('Invalid call negotiation.');
            await peer.setRemoteDescription(new this.rtc.RTCSessionDescription(message.description)); if (!current()) return;
            for (const candidate of this.pendingIce.splice(0)) { await peer.addIceCandidate(candidate); if (!current()) return; }
            if ((message.description as RTCSessionDescription).type === 'offer') {
              const answer = await peer.createAnswer(); if (!current()) return;
              await peer.setLocalDescription(answer); if (!current()) return;
              this.sendSignal({ type: 'description', description: peer.localDescription?.toJSON() });
            }
          } else if (message.type === 'ice') {
            if (!message.candidate || this.pendingIce.length >= 128) throw new Error('Invalid connection candidate.');
            const candidate = new this.rtc.RTCIceCandidate(message.candidate);
            if (this.peer?.remoteDescription) await this.peer.addIceCandidate(candidate);
            else this.pendingIce.push(candidate);
          }
        }).catch((error: unknown) => { if (current()) this.end(error instanceof Error ? error.message : 'The call could not connect.', true); });
      };
      // React Native emits an empty error event, then a close event containing
      // the native failure reason. Ending in onerror erased that second event,
      // hiding iOS permission, routing, and connection-refused diagnostics.
      socket.onerror = () => {
        if (!current()) return;
        socketFailed = true;
        this.timeout(250, connectionError());
      };
      socket.onclose = (event) => {
        if (!current()) return;
        this.end(!socketOpened || socketFailed ? connectionError(event.reason)
          : 'The call service disconnected. Start a new call.', true);
      };
    } catch (error) {
      if (current()) this.end(error instanceof Error ? error.message : 'Camera or microphone access was unavailable.', true);
    }
  }

  private bindChannel(channel: RTCDataChannel, current: () => boolean) {
    if (this.channel || channel.label !== 'signbridge-captions-v1') { channel.close(); return; }
    this.channel = channel;
    channel.addEventListener('open', () => { if (current()) { this.patch({ channelReady: true }); this.broadcastMedia(); } });
    channel.addEventListener('close', () => { if (current()) this.patch({ channelReady: false, message: 'Captions disconnected. Video may still be available.' }); });
    channel.addEventListener('message', (event) => {
      if (!current()) return;
      const message = parseCallMessage(event.data);
      if (message?.type === 'media') this.patch({ peerMedia: message });
      if (message?.type === 'caption' && message.sequence > this.receivedSequence) {
        this.receivedSequence = message.sequence; this.patch({ remoteCaption: message });
      }
    });
  }

  sendCaption(text: string, kind: CaptionKind) {
    if (this.state.phase !== 'connected' || this.channel?.readyState !== 'open' || this.channel.bufferedAmount > 16384) return false;
    if (text.trim().length > CAPTION_LIMIT) return false;
    const caption: Caption = { type: 'caption', sequence: this.captionSequence + 1, text: text.trim(), kind };
    try { this.channel.send(JSON.stringify(caption)); }
    catch { return false; }
    this.captionSequence++; this.patch({ localCaption: caption }); return true;
  }

  setCaptions(enabled: boolean) { this.patch({ captions: enabled }); this.broadcastMedia(); }
  toggleCamera() {
    if (!this.state.localStream) return;
    const enabled = !this.state.camera;
    this.state.localStream.getVideoTracks().forEach((track) => { track.enabled = enabled; });
    this.patch({ camera: enabled }); this.broadcastMedia();
  }
  async toggleMicrophone() {
    if (!this.state.localStream || this.microphoneBusy) return;
    this.microphoneBusy = true;
    const generation = this.generation;
    const local = this.state.localStream;
    try {
      let track = local.getAudioTracks()[0];
      if (!track) {
        const acquired = await this.rtc.mediaDevices.getUserMedia({ audio: true, video: false });
        if (generation !== this.generation) { acquired.getTracks().forEach((item) => item.stop()); acquired.release(); return; }
        track = acquired.getAudioTracks()[0];
        if (!track) { acquired.release(); throw new Error('No microphone is available.'); }
        try { if (this.audioSender) await this.audioSender.replaceTrack(track); }
        catch (error) { acquired.release(); throw error; }
        if (generation !== this.generation) { acquired.release(); return; }
        local.addTrack(track); acquired.release(false);
        track.enabled = true;
      } else track.enabled = !this.state.microphone;
      this.patch({ microphone: track.enabled }); this.broadcastMedia();
    } catch { if (generation === this.generation) this.patch({ message: 'Microphone access is unavailable. You can continue signing or typing.' }); }
    finally { if (generation === this.generation) this.microphoneBusy = false; }
  }
  async switchCamera() {
    const track = this.state.localStream?.getVideoTracks()[0];
    if (!track || this.cameraBusy) return;
    this.cameraBusy = true;
    const generation = this.generation;
    try {
      const frontCamera = !this.state.frontCamera;
      await track.applyConstraints({ facingMode: frontCamera ? 'user' : 'environment' });
      if (generation === this.generation) this.patch({ frontCamera });
    } catch { if (generation === this.generation) this.patch({ message: 'Could not switch cameras on this device.' }); }
    finally { if (generation === this.generation) this.cameraBusy = false; }
  }

  end(message = 'Call ended.', error = false) {
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.microphoneBusy = false; this.cameraBusy = false;
    // A transport can fail between its ready-state check and send/close. Each
    // resource must still be released even when another resource is already gone.
    const safely = (release: () => void) => { try { release(); } catch { /* Already disconnected or released. */ } };
    const socket = this.socket; this.socket = null;
    if (socket) {
      socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.onopen = null;
      if (socket.readyState === 1) safely(() => socket.send(JSON.stringify({ type: 'leave' })));
      safely(() => socket.close());
    }
    safely(() => this.channel?.close()); this.channel = null;
    safely(() => this.peer?.close()); this.peer = null; this.audioSender = null;
    this.state.localStream?.getTracks().forEach((track) => safely(() => track.stop()));
    safely(() => this.state.localStream?.release());
    this.pendingIce = []; this.signalQueue = Promise.resolve();
    this.patch({ phase: error ? 'error' : 'ended', message, localStream: null, remoteStream: null, channelReady: false,
      localCaption: null, remoteCaption: null, microphone: false, captions: false });
  }
}
