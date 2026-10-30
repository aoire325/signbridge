import { displayInvite, normalizeInvite, parseCallMessage, signalingUrl, validInvite } from '../../src/calls/protocol';

describe('call messages and invitations', () => {
  it('accepts formatted codes and rejects ambiguous or short codes', () => {
    expect(normalizeInvite('abcd - efgh - jklm')).toBe('ABCDEFGHJKLM');
    expect(validInvite('abcd - efgh - jklm')).toBe(true);
    expect(displayInvite('ABCDEFGHJKLM')).toBe('ABCD - EFGH - JKLM');
    for (const code of ['123456', 'ABCDEFGHIJKL', 'AAAA0000AAAA', '', 'A'.repeat(13)]) expect(validInvite(code)).toBe(false);
  });
  it('bounds untrusted captions and preserves their provenance', () => {
    expect(parseCallMessage(JSON.stringify({ type: 'caption', sequence: 1, text: ' HELLO\nFRIEND ', kind: 'ai' })))
      .toEqual({ type: 'caption', sequence: 1, text: 'HELLO FRIEND', kind: 'ai' });
    for (const value of [{ type: 'caption', sequence: -1, text: 'hi', kind: 'typed' },
      { type: 'caption', sequence: 1, text: 'a'.repeat(281), kind: 'typed' },
      { type: 'caption', sequence: 1, text: 'hi', kind: 'verified' }, { type: 'media', camera: 'true' }]) {
      expect(parseCallMessage(JSON.stringify(value))).toBeNull();
    }
    expect(parseCallMessage('not json')).toBeNull();
    expect(parseCallMessage(new ArrayBuffer(3))).toBeNull();
  });
  it('allows clearing a caption and validates media states', () => {
    expect(parseCallMessage('{"type":"caption","sequence":2,"text":"","kind":"typed"}')?.type).toBe('caption');
    expect(parseCallMessage('{"type":"media","camera":false,"microphone":true,"captions":false}'))
      .toEqual({ type: 'media', camera: false, microphone: true, captions: false });
  });
  it('requires secure signaling in packaged builds', () => {
    expect(signalingUrl('wss://calls.example.com/calls', false)).toBe('wss://calls.example.com/calls');
    expect(signalingUrl('ws://192.168.1.2:8787/calls', true)).toContain('ws:');
    for (const url of [undefined, 'ws://host/calls', 'https://host/calls', 'wss://user:pass@host/calls', 'wss://host/calls?secret=x']) {
      expect(() => signalingUrl(url, false)).toThrow();
    }
  });
});
