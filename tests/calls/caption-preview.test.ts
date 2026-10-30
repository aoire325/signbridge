import React, { act, type ReactNode } from 'react';
import { CallCaptionComposer } from '../../src/components/call-caption-composer';
import type { TrackingFrame } from '../../src/recognition/landmarks';
import { CITIZEN_LABELS as mockCitizenLabels, WLASL_LABELS as mockWlaslLabels } from '../../src/recognition/expanded-vocabulary';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
let mockOnFrame: (frame: TrackingFrame) => void;
let mockTrackingEnabled = false;
let mockModelCalls = 0;
const mockTracker = { ready: true, error: '', retry: jest.fn() };
const mockSend = jest.fn(() => true);
const mockFeedback = jest.fn();
const mockStream = {} as Parameters<typeof CallCaptionComposer>[0]['stream'];
jest.mock('expo-symbols', () => ({ SymbolView: () => jest.requireActual('react').createElement('span', { 'data-symbol': true }) }));

jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children }: { children?: ReactNode }) => React.createElement('div', null, children);
  return { View: container, Text: container, ActivityIndicator: container, TextInput: container, ScrollView: container,
    Modal: ({ visible, children }: { visible: boolean; children?: ReactNode }) => visible ? React.createElement('div', null, children) : null,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Switch: ({ accessibilityLabel, value, onValueChange }: { accessibilityLabel: string; value: boolean; onValueChange: (value: boolean) => void }) =>
      React.createElement('button', { 'aria-label': accessibilityLabel, onClick: () => onValueChange(!value) }, String(value)),
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) =>
      React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children) };
});
jest.mock('../../src/calls/use-call-tracking', () => ({ useCallTracking: (_stream: unknown, enabled: boolean, callback: typeof mockOnFrame) => {
  mockTrackingEnabled = enabled; mockOnFrame = callback; return mockTracker;
} }));
jest.mock('../../src/state/use-recognition-examples', () => ({ useRecognitionExamples: () => ({ learning: undefined }) }));
jest.mock('../../src/recognition/use-sentence-translator', () => ({ useSentenceTranslator: () => ({
  busy: false, recording: false, draft: '', message: '', frame: null, onFrame: jest.fn(),
}) }));
jest.mock('../../assets/models/asl_words_citizen.tflite', () => 1);
jest.mock('../../assets/models/asl_words_2000.tflite', () => 2);
jest.mock('../../src/recognition/local-model', () => ({ useBundledModel: () => {
  const citizen = mockModelCalls++ % 2 === 0;
  const labels = citizen ? mockCitizenLabels : mockWlaslLabels;
  const scores = new Float32Array(labels.length).fill(-20);
  scores[labels.indexOf(citizen ? 'HELLO' : 'water')] = 20;
  return { state: 'loaded', model: { inputs: [{ dataType: 'float32', shape: citizen ? [1, 2, 128, 27] : [1, 55, 100] }], run: async () => [scores.buffer] } };
} }));
function frame(timestampMs: number): TrackingFrame {
  const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
  const pose = Array.from({ length: 33 }, () => point(0.5));
  pose[11] = point(0.3); pose[12] = point(0.7); pose[15] = point(0.4);
  return { timestampMs, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 30,
    hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.4 + i / 1000)) }] };
}

describe('private AI preview before a guest joins', () => {
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  const render = (canSend = false, active = true, compact = false) => act(() => root.render(React.createElement(CallCaptionComposer, {
    stream: mockStream, active, canSend, frontCamera: true, onCaption: mockSend, onFeedback: mockFeedback, compact,
  })));
  const click = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
  };
  const sign = async (start = 0) => {
    act(() => { for (let t = start; t <= start + 800; t += 100) mockOnFrame(frame(t)); });
    await act(async () => click('Finish sign for caption'));
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mockModelCalls = 0; mockSend.mockClear(); mockFeedback.mockClear();
    mockTracker.error = ''; mockTracker.ready = true; mockTracker.retry.mockClear();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });

  it('runs the recognizer alone, shows a private guess, and does not transmit it', async () => {
    render(); expect(mockTrackingEnabled).toBe(true);
    await sign();
    expect(mockFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ preview: expect.stringMatching(/hello/i), tracking: '1 hand detected · shoulders visible' }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(container.textContent).toContain('even while waiting for a guest');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.getAttribute('aria-label')?.startsWith('Caption '));
    expect(buttons.length).toBeGreaterThan(0); expect(buttons.every((b) => b.disabled)).toBe(true);
  });
  it('does not send a practice guess when auto-sharing is enabled and a guest arrives', async () => {
    render(); act(() => click('Share AI guesses automatically')); await sign();
    expect(mockSend).not.toHaveBeenCalled();
    render(true);
    expect(mockFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ preview: '' }));
    expect(mockSend).not.toHaveBeenCalled();
    await sign(2000);
    expect(mockSend).toHaveBeenCalledWith(expect.stringMatching(/hello/i), 'ai');
  });
  it('shares a reviewed result only after the caller chooses it', async () => {
    render(true); await sign(); expect(mockSend).not.toHaveBeenCalled();
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label')?.startsWith('Caption '))!;
    act(() => button.click());
    expect(mockSend).toHaveBeenCalledWith(expect.any(String), 'reviewed');
  });
  it('shows tracking failures and offers a restart instead of silent inactivity', () => {
    mockTracker.error = 'No camera tracking frames are arriving.'; mockTracker.ready = false;
    render();
    expect(mockFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ message: mockTracker.error }));
    act(() => click('Restart AI tracking')); expect(mockTracker.retry).toHaveBeenCalledTimes(1);
  });
  it('stops recognition and clears the preview when the camera is paused', async () => {
    render(); await sign(); render(false, false);
    expect(mockTrackingEnabled).toBe(false);
    expect(mockFeedback).toHaveBeenLastCalledWith({ preview: '', message: 'Turn on your camera to sign.', tracking: 'Camera paused' });
  });
  it('keeps the private preview usable in focus mode with icon controls', async () => {
    render(false, true, true); await sign();
    expect(mockFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ preview: expect.stringMatching(/hello/i) }));
    expect(container.querySelector('[aria-label="Finish sign for caption"]')!.textContent).toBe('');
    expect(mockSend).not.toHaveBeenCalled();
  });
  it('preserves preview and sharing choice across focus changes and opens AI options', async () => {
    render(true); await sign(); render(true, true, true);
    expect(mockFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ preview: expect.stringMatching(/hello/i) }));
    act(() => click('AI caption options')); expect(container.textContent).toContain('Short sentence');
    act(() => click('Share AI guesses automatically'));
    expect(mockSend).toHaveBeenCalledWith(expect.stringMatching(/hello/i), 'ai');
    act(() => click('Close AI caption options')); render(true);
    expect(container.querySelector('[aria-label="Share AI guesses automatically"]')!.textContent).toBe('true');
  });
});
