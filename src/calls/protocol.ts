export const CAPTION_LIMIT = 280;
export type CaptionKind = 'typed' | 'reviewed' | 'ai';
export type Caption = { type: 'caption'; sequence: number; text: string; kind: CaptionKind };
export type MediaState = { type: 'media'; camera: boolean; microphone: boolean; captions: boolean };
export type CallMessage = Caption | MediaState;
export const normalizeInvite = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');
export const validInvite = (value: string) => /^[A-HJ-NP-Z2-9]{12}$/.test(normalizeInvite(value));
export const displayInvite = (value: string) => normalizeInvite(value).match(/.{1,4}/g)?.join(' - ') ?? '';

export function parseCallMessage(raw: unknown): CallMessage | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.type === 'caption' && Number.isSafeInteger(value.sequence) && value.sequence > 0
      && typeof value.text === 'string' && value.text.length <= CAPTION_LIMIT
      && ['typed', 'reviewed', 'ai'].includes(value.kind)) {
      return { type: 'caption', sequence: value.sequence, text: value.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim(), kind: value.kind };
    }
    if (value?.type === 'media' && ['camera', 'microphone', 'captions'].every((key) => typeof value[key] === 'boolean')) {
      return { type: 'media', camera: value.camera, microphone: value.microphone, captions: value.captions };
    }
  } catch { /* Ignore malformed peer data. */ }
  return null;
}

export function signalingUrl(value: string | undefined, development: boolean, developmentHost?: string | null): string {
  let url = value?.trim();
  // A dev client can load a bundle without the machine's ignored .env.local.
  // Use the same computer that served that client, never the phone's localhost
  // unless Metro itself was opened through localhost (e.g. adb reverse).
  if (!url && development && developmentHost) {
    try {
      const host = new URL(`http://${developmentHost}`);
      const hostname = host.hostname;
      const local = hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')
        || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
      if (local && !host.username && !host.password && !host.search && !host.hash && host.pathname === '/') {
        // The bundled development service listens on IPv4, including loopback.
        url = `ws://${hostname === '[::1]' || hostname === 'localhost' ? '127.0.0.1' : hostname}:8787/calls`;
      }
    } catch { /* Fall through to the actionable configuration error. */ }
  }
  if (!url) throw new Error(development
    ? 'Open the latest SignBridge project from the same computer on both phones, then reload. The computer must also run the call service.'
    : 'This app build is missing its call service address. Install an updated build with calling configured.');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash || parsed.search
    || (parsed.protocol !== 'wss:' && !(development && parsed.protocol === 'ws:'))) {
    throw new Error('The call service must use a secure WebSocket address.');
  }
  return url;
}
