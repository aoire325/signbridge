import React, { act, type ReactNode } from 'react';
import HomeScreen from '../../src/app/index';

// Keep Expo's native Jest environment; its setup defines window itself and
// cannot be combined directly with the jsdom environment's window accessor.
const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockCamera = { isActive: true, session: 'running', sessionToken: 1, facing: 'front',
  permission: { granted: true }, error: '', pause: jest.fn(), stop: jest.fn(),
  switchCamera: jest.fn(), reportCameraError: jest.fn(), start: jest.fn() };
const mockSentence = { recording: true, busy: false, frame: null, draft: '', message: 'Recording your sentence',
  finish: jest.fn(), start: jest.fn(), cancel: jest.fn(), onFrame: jest.fn() };

jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children }: { children?: ReactNode }) => React.createElement('div', null, children);
  return { View: container, Text: container, ScrollView: container,
    TextInput: () => null, ActivityIndicator: () => React.createElement('div', { role: 'progressbar' }),
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: {
      children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string;
    }) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
    Keyboard: { dismiss: jest.fn() }, Linking: { openSettings: jest.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => jest.requireActual('react').createElement('div', null, children),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));
jest.mock('../../src/camera/use-camera-session', () => ({ useCameraSession: () => mockCamera }));
jest.mock('../../src/camera/live-landmark-camera', () => ({ LiveLandmarkCamera: () => null }));
jest.mock('../../src/camera/landmark-overlay', () => ({ LandmarkOverlay: () => null }));
jest.mock('../../src/recognition/use-sentence-translator', () => ({ useSentenceTranslator: () => mockSentence }));
jest.mock('../../src/recognition/use-asl-word-recognizer', () => ({ useAslWordRecognizer: () => ({ processing: false, candidates: [] }) }));
jest.mock('../../src/state/accessibility-settings', () => ({ useAccessibilitySettings: () => ({ largeText: false, highContrast: false }) }));
jest.mock('../../src/state/use-transcript', () => ({ useTranscript: () => ({
  value: '', wordCount: 0, isEditing: false, commitEditing: jest.fn(),
}) }));

describe('home screen sentence stop action', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks(); mockSentence.busy = false; mockSentence.recording = true;
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(HomeScreen)));
    const sentences = container.querySelector<HTMLButtonElement>('button[aria-label="Sentences"]')!;
    act(() => sentences.click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });

  it('sends Stop to sentence translation without stopping the camera or losing the capture', () => {
    const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop & translate"]')!;
    expect(stop).not.toBeNull(); expect(stop.disabled).toBe(false);
    act(() => stop.click());
    expect(mockSentence.finish).toHaveBeenCalledTimes(1);
    expect(mockCamera.stop).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Pause camera"]')!.disabled).toBe(true);
  });

  it('blocks camera stop during processing and shows progress plus cancellation', () => {
    mockSentence.recording = false; mockSentence.busy = true;
    mockSentence.message = 'Analysing the recorded sentence offline';
    act(() => root.render(React.createElement(HomeScreen)));
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(container.textContent).toContain(mockSentence.message);
    const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop camera"]')!;
    expect(stop.disabled).toBe(true);
    act(() => stop.click());
    expect(mockCamera.stop).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sentence"]')!.disabled).toBe(false);
  });
}); 

