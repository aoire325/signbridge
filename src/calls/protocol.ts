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

export function signalingUrl(value: string | undefined, development: boolean): string {
  const url = value?.trim();
  if (!url) throw new Error('Calling is not connected yet. The app needs its call service configured.');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash || parsed.search
    || (parsed.protocol !== 'wss:' && !(development && parsed.protocol === 'ws:'))) {
    throw new Error('The call service must use a secure WebSocket address.');
  }
  return url;
}
