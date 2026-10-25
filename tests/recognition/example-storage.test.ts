import React, { act } from 'react';
import { useRecognitionExamples } from '../../src/state/use-recognition-examples';
import { SIGN_FEATURE_WIDTH } from '../../src/recognition/sign-features';
import { refineCandidates, type RecognitionCapture } from '../../src/recognition/recognition-examples';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockFiles = new Map<string, string>();
let mockWriteFails = false;
const mockPick = jest.fn();
jest.mock('expo-file-system', () => ({ Paths: { document: 'documents' }, Directory: { pickDirectoryAsync: () => mockPick() },
  File: class {
    path: string;
    constructor(...parts: string[]) { this.path = parts.join('/'); }
    get exists() { return mockFiles.has(this.path); }
    get size() { return mockFiles.get(this.path)?.length ?? 0; }
    async text() { return mockFiles.get(this.path); }
    create() { mockFiles.set(this.path, ''); }
    async write(value: string) { if (mockWriteFails) throw new Error('Disk unavailable'); mockFiles.set(this.path, value); }
    async move(target: { path: string }) { mockFiles.set(target.path, mockFiles.get(this.path)!); mockFiles.delete(this.path); }
    delete() { mockFiles.delete(this.path); }
  },
}));
let lab: ReturnType<typeof useRecognitionExamples>;
function Pilot({ active = true, token = 1 }: { active?: boolean; token?: number }) {
  lab = useRecognitionExamples(true, active, token); return null;
}
const capture = (): RecognitionCapture => ({
  sequence: { version: 1, durationMs: 1000, frames: Array.from({ length: 24 }, (_, i) => ({ timestampMs: i * 1000 / 23,
    values: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(0.1), mask: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(1) })) },
  baseline: ['HELLO', 'WATER', 'HELP'], displayed: ['HELLO', 'WATER', 'HELP'],
  diagnostics: { frames: 30, fps: 30, maxGapMs: 34, faceCoverage: 1, handCoverage: 1, inferenceMs: 30 },
});
describe('explicit local example collection', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  beforeEach(async () => {
    mockFiles.clear(); mockWriteFails = false; mockPick.mockClear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(React.createElement(Pilot)));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
  function record() {
    act(() => lab.setLabel('water'));
    act(() => lab.arm());
    const token = lab.request!.token;
    act(() => lab.learning.onCapture(token, capture()));
  }
  it('requires explicit arming and saving, and labels by intent rather than the prediction', async () => {
    act(() => lab.learning.onCapture('unrequested', capture()));
    expect(lab.pending).toBeNull(); expect(mockFiles.size).toBe(0);
    record(); expect(lab.pending?.label).toBe('WATER'); expect(lab.pending?.baseline[0]).toBe('HELLO');
    expect(mockFiles.size).toBe(0);
    await act(async () => { await lab.save(); });
    expect(lab.dataset.examples).toHaveLength(1); expect(lab.pending).toBeNull(); expect(lab.enabled).toBe(false);
    expect(mockFiles.has('documents/signbridge-examples-v1.json')).toBe(true);
    expect(mockPick).not.toHaveBeenCalled();
    await act(async () => { await lab.save(); });
    expect(lab.dataset.examples).toHaveLength(1);
  });
  it('cancels collection across camera sessions and never revives an old request', () => {
    act(() => lab.setLabel('hello')); act(() => lab.arm()); const token = lab.request!.token;
    act(() => root.render(React.createElement(Pilot, { active: false })));
    expect(lab.request).toBeNull(); expect(lab.learning.captureToken).toBeNull();
    act(() => lab.learning.onCapture(token, capture())); expect(lab.pending).toBeNull();
    act(() => root.render(React.createElement(Pilot, { active: true })));
    expect(lab.request).toBeNull();
  });
  it('keeps test sessions separate and rejects unsupported training labels', () => {
    act(() => lab.setLabel('UNKNOWN')); act(() => lab.arm()); expect(lab.request).toBeNull();
    const trainingSession = lab.session;
    act(() => lab.changeSplit('test')); expect(lab.session).not.toBe(trainingSession);
    act(() => lab.arm()); expect(lab.request!.label).toBeNull();
  });
  it('reports a failed save without losing the pending example, then supports deletion', async () => {
    record(); mockWriteFails = true;
    await act(async () => { await lab.save(); });
    expect(lab.dataset.examples).toHaveLength(0); expect(lab.pending).not.toBeNull(); expect(lab.notice).toContain('Disk unavailable');
    mockWriteFails = false; await act(async () => { await lab.save(); });
    await act(async () => { await lab.clear(); });
    expect(lab.dataset.examples).toHaveLength(0); expect(mockFiles.size).toBe(0);
  });

  it('teaches a new word, enables it, restores it after reopening, and persists turning it off', async () => {
    act(() => { lab.beginVariant('MY NAME'); });
    act(() => lab.setLabel('my name'));
    for (let i = 0; i < 3; i++) {
      act(() => lab.arm());
      const token = lab.request!.token;
      act(() => lab.learning.onCapture(token, capture()));
      await act(async () => { await lab.save(); });
      expect(lab.variantCount).toBe(i + 1);
    }
    expect(lab.enabled).toBe(false);
    await act(async () => { await lab.activateVariant(); });
    expect(lab.enabled).toBe(true);
    expect(lab.learning.ranker?.calibration.map((c) => c.label)).toEqual(['MY NAME']);
    expect(JSON.parse(mockFiles.get('documents/signbridge-examples-v1.json')!).profile).toEqual({ signer: 'me', enabled: true });
    act(() => root.unmount()); root = createRoot(container);
    await act(async () => { root.render(React.createElement(Pilot)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(lab.loaded).toBe(true); expect(lab.enabled).toBe(true);
    expect(lab.learning.ranker?.calibration[0].label).toBe('MY NAME');
    await act(async () => { await lab.toggle(); });
    expect(lab.enabled).toBe(false);
    expect(JSON.parse(mockFiles.get('documents/signbridge-examples-v1.json')!).profile.enabled).toBe(false);
  });

  it('keeps a failed teaching activation disabled and retains all recorded examples', async () => {
    act(() => { lab.beginVariant('MOON'); });
    for (let i = 0; i < 3; i++) {
      act(() => lab.arm()); const token = lab.request!.token;
      act(() => lab.learning.onCapture(token, capture()));
      await act(async () => { await lab.save(); });
    }
    mockWriteFails = true;
    await act(async () => { await lab.activateVariant(); });
    expect(lab.enabled).toBe(false); expect(lab.dataset.examples).toHaveLength(3);
    expect(lab.notice).toContain('Disk unavailable');
  });

  it('adds a second HELLO version despite wrong or absent predictions, restores both, and removes only the chosen version', async () => {
    const captured = (value: number, missing = false): RecognitionCapture => {
      const sample = capture(); sample.sequence.frames.forEach((f) => { f.values.fill(value); });
      sample.baseline = missing ? [] : ['FOREST', 'PILLOW', 'CLOUD']; sample.displayed = [...sample.baseline];
      return sample;
    };
    const variantIds: string[] = [];
    for (const value of [0.1, 0.5]) {
      act(() => { lab.beginVariant('HELLO'); });
      variantIds.push(lab.variantId!);
      for (let i = 0; i < 3; i++) {
        act(() => lab.arm()); const token = lab.request!.token;
        act(() => lab.learning.onCapture(token, captured(value, value === 0.5)));
        expect(lab.pending?.label).toBe('HELLO');
        await act(async () => { await lab.save(); });
      }
      await act(async () => { await lab.activateVariant(); });
      expect(lab.enabled).toBe(true);
    }
    expect(new Set(variantIds).size).toBe(2); expect(lab.dataset.examples).toHaveLength(6);
    expect(lab.savedVariants).toHaveLength(2);
    act(() => root.unmount()); root = createRoot(container);
    await act(async () => { root.render(React.createElement(Pilot)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(lab.enabled).toBe(true); expect(lab.savedVariants).toHaveLength(2);
    for (const value of [0.1, 0.5]) expect(refineCandidates(captured(value), lab.learning.ranker)[0]).toBe('HELLO');
    const oldVersion = lab.savedVariants[0].id;
    await act(async () => { await lab.forgetVariant(oldVersion); });
    expect(lab.dataset.examples).toHaveLength(3); expect(lab.savedVariants).toHaveLength(1);
    await act(async () => { await lab.activateSavedVariants(); });
    expect(refineCandidates(captured(0.1), lab.learning.ranker)).toEqual(['FOREST', 'PILLOW', 'CLOUD']);
    expect(refineCandidates(captured(0.5), lab.learning.ranker)[0]).toBe('HELLO');
  });
});
