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
  it('finds the shared call service when a development bundle has no environment setting', () => {
    expect(signalingUrl(undefined, true, '10.67.169.106:8081')).toBe('ws://10.67.169.106:8787/calls');
    expect(signalingUrl('', true, '192.168.1.10:8082')).toBe('ws://192.168.1.10:8787/calls');
    expect(signalingUrl('  ', true, '172.20.10.2:8081')).toBe('ws://172.20.10.2:8787/calls');
    expect(signalingUrl(undefined, true, 'macbook.local:8081')).toBe('ws://macbook.local:8787/calls');
  });
  it('supports USB forwarding and the iOS simulator without changing the other phone’s address', () => {
    expect(signalingUrl(undefined, true, '127.0.0.1:8081')).toBe('ws://127.0.0.1:8787/calls');
    expect(signalingUrl(undefined, true, '[::1]:8082')).toBe('ws://127.0.0.1:8787/calls');
  });
  it('always honors an explicitly configured shared service', () => {
    expect(signalingUrl(' wss://calls.example.com/calls ', true, '127.0.0.1:8081')).toBe('wss://calls.example.com/calls');
    expect(() => signalingUrl('https://wrong.example.com', true, '192.168.1.10:8081')).toThrow();
  });
  it('never invents a production or tunnel call service', () => {
    expect(() => signalingUrl(undefined, false, '192.168.1.10:8081')).toThrow('updated build');
    for (const host of [undefined, '', 'not a host', 'project.exp.direct:80', 'user:pass@192.168.1.10:8081', '192.168.1.10:8081/path']) {
      expect(() => signalingUrl(undefined, true, host)).toThrow('same computer');
    }
  });
});
