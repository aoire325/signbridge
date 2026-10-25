import React, { act, type ReactNode } from 'react';
import { PersonalSignPanel } from '../../src/components/personal-sign-panel';
import { useRecognitionExamples } from '../../src/state/use-recognition-examples';
import { refineCandidates, type RecognitionCapture } from '../../src/recognition/recognition-examples';
import { buildSignSequence, SIGN_FEATURE_WIDTH } from '../../src/recognition/sign-features';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockFiles = new Map<string, string>();
let mockWriteFails = false;
jest.mock('expo-file-system', () => ({ Paths: { document: 'documents' },
  File: class {
    path: string;
    constructor(...parts: string[]) { this.path = parts.join('/'); }
    get exists() { return mockFiles.has(this.path); }
    get size() { return mockFiles.get(this.path)?.length ?? 0; }
    async text() { return mockFiles.get(this.path); }
    create() { mockFiles.set(this.path, ''); }
    async write(text: string) { if (mockWriteFails) throw new Error('Storage unavailable'); mockFiles.set(this.path, text); }
    async move(target: { path: string }) { mockFiles.set(target.path, mockFiles.get(this.path)!); mockFiles.delete(this.path); }
  },
}));
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children, accessibilityRole }: { children?: ReactNode; accessibilityRole?: string }) => React.createElement('div', { role: accessibilityRole }, children);
  return { View: container, Text: container, Keyboard: { dismiss: jest.fn() }, StyleSheet: { create: (style: unknown) => style },
    Pressable: ({ children, onPress, accessibilityLabel, disabled }: { children?: ReactNode; onPress: () => void; accessibilityLabel: string; disabled?: boolean }) =>
      React.createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
    TextInput: () => React.createElement('input'),
  };
});
let lab: ReturnType<typeof useRecognitionExamples>;
function Pilot() {
  lab = useRecognitionExamples(true, true, 1);
  return React.createElement(PersonalSignPanel, { lab, canRecord: true, initiallyAddWord: false, onClose: () => {}, onChooseDictionary: () => {},
    onSelectWord: (word?: string) => { lab.beginVariant(word); } });
}
function capture(frames = 5, handCoverage = 1): RecognitionCapture {
  return { sequence: { version: 1, durationMs: 800, frames: Array.from({ length: 24 }, (_, i) => ({ timestampMs: i * 800 / 23,
    values: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(0.1), mask: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(1) })) },
    baseline: ['FOREST', 'PILLOW', 'CLOUD'], displayed: ['FOREST', 'PILLOW', 'CLOUD'],
    diagnostics: { frames, fps: 5, maxGapMs: 200, handCoverage, faceCoverage: 1, inferenceMs: 20 } };
}

describe('personal sign Save example button and progress', () => {
  let root: { render: (node: ReactNode) => void; unmount: () => void }; let container: HTMLDivElement;
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mockFiles.clear(); mockWriteFails = false;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(React.createElement(Pilot)); });
    act(() => { lab.beginVariant('MY NEW WORD'); }); act(() => button('Teach my version').click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
  function finishRecording(sample: RecognitionCapture) {
    act(() => button('Record version example').click()); const token = lab.request!.token;
    act(() => lab.learning.onCapture(token, sample));
  }
  async function pressAndFinish(label: string) {
    act(() => button(label).click());
    for (let i = 0; i < 100 && lab.busy; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    expect(lab.busy).toBe(false);
  }
  it('advances 0 → 1 → 2 → 3 after successful saves on a slow camera, despite wrong predictions', async () => {
    expect(container.textContent).toContain('0 of 3 examples saved');
    for (let count = 1; count <= 3; count++) {
      finishRecording(capture());
      expect(container.textContent).not.toContain('signed MY NEW WORD correctly');
      await pressAndFinish('Save version example');
      expect(container.textContent).toContain(`${count} of 3 examples saved`);
      expect(lab.pending).toBeNull();
    }
    expect(JSON.parse(mockFiles.get('documents/signbridge-examples-v1.json')!).examples).toHaveLength(3);
    await pressAndFinish('Save and use this version');
    expect(button('Done personalizing')).not.toBeNull();
    expect(lab.learning.ranker?.calibration[0].label).toBe('MY NEW WORD');
  });
  it('counts a short captured sign even when lead-in and ending leave hands visible in under 40% of frames', async () => {
    finishRecording(capture(20, 0.25));
    await pressAndFinish('Save version example');
    expect(container.textContent).toContain('1 of 3 examples saved');
  });
  it('saves all three paused recordings and learns a usable version while keeping the gap masked', async () => {
    const sample = (times: number[]): RecognitionCapture => ({ ...capture(times.length),
      sequence: buildSignSequence(times.map((timestampMs) => ({ timestampMs,
        values: Array<number>(SIGN_FEATURE_WIDTH).fill(0.1), mask: Array<number>(SIGN_FEATURE_WIDTH).fill(1) })))!,
      diagnostics: { frames: times.length, fps: times.length - 1, maxGapMs: Math.max(...times.slice(1).map((t, i) => t - times[i])),
        handCoverage: 1, faceCoverage: 1, inferenceMs: 20 } });
    for (let count = 1; count <= 3; count++) {
      finishRecording(sample([0, 100, 200, 700, 800, 900, 1000]));
      await pressAndFinish('Save version example');
      expect(container.textContent).toContain(`${count} of 3 examples saved`);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    }
    const saved = JSON.parse(mockFiles.get('documents/signbridge-examples-v1.json')!);
    expect(saved.examples).toHaveLength(3);
    expect(saved.examples[0].sequence.frames[10].mask.every((m: number) => m === 0)).toBe(true);
    await pressAndFinish('Save and use this version');
    const fresh = sample(Array.from({ length: 11 }, (_, i) => i * 100));
    expect(refineCandidates(fresh, lab.learning.ranker)).toEqual(['MY NEW WORD', 'FOREST', 'PILLOW']);
  });
  it('keeps a mostly untracked recording pending and explains the actual missing data', async () => {
    const sparse = capture(); sparse.diagnostics.maxGapMs = 600;
    sparse.sequence.frames.slice(3, 20).forEach((frame) => { frame.mask.fill(0); frame.values.fill(0); });
    finishRecording(sparse);
    await pressAndFinish('Save version example');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Too much tracking is missing');
    expect(container.textContent).toContain('0 of 3 examples saved');
    expect(lab.pending).not.toBeNull(); expect(lab.dataset.examples).toHaveLength(0);
  });
  it('shows a storage error beside Save, keeps the recording, and advances once after retry', async () => {
    finishRecording(capture()); mockWriteFails = true;
    await pressAndFinish('Save version example');
    expect(container.textContent).toContain('0 of 3 examples saved');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
    expect(lab.pending).not.toBeNull(); expect(button('Save version example').disabled).toBe(false);
    mockWriteFails = false;
    await pressAndFinish('Save version example');
    expect(container.textContent).toContain('1 of 3 examples saved'); expect(lab.dataset.examples).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('explains actual missing tracking without calling the gesture incorrect', async () => {
    finishRecording(capture(5, 0));
    await pressAndFinish('Save version example');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('hands were not tracked');
    expect(container.textContent).toContain('0 of 3 examples saved'); expect(lab.pending).not.toBeNull();
  });
});
