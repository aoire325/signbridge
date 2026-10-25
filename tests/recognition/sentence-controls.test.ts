import React, { act, type ReactNode } from 'react';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { WelcomeScreen } from '../../src/components/welcome-screen';
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
let mockTutorialSeen = true;
const mockMarkTutorialSeen = jest.fn(() => { mockTutorialSeen = true; });
let mockStoredTutorial = false;
let mockStorageFails = false;
const mockWriteFlag = jest.fn();
let mockView: string | undefined = 'camera';
let mockDimensions = { width: 1200, height: 900, fontScale: 1 };
let mockReduceMotion = false;
let mockMotionListener: (enabled: boolean) => void;
const mockRemoveMotionListener = jest.fn();
const mockSetOffset = jest.fn();
const mockStopAnimation = jest.fn();
const mockAnimate = jest.fn((_value: unknown, _config: unknown) => ({ start: jest.fn() }));
let mockCameraMounts = 0;
const mockChooseCandidate = jest.fn();
let mockCandidates: string[] = [];
let mockProcessing = false;
let mockRecognitionMessage = 'Sign one word, then lower your hands.';
const mockFinishSign = jest.fn();
const mockSentence = { recording: true, busy: false, frame: null, draft: '', message: 'Recording your sentence',
  finish: jest.fn(), start: jest.fn(), cancel: jest.fn(), onFrame: jest.fn() };

jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children, onLayout, style, testID }: { children?: ReactNode; onLayout?: (event: unknown) => void; style?: unknown; testID?: string }) => {
    React.useLayoutEffect(() => { onLayout?.({ nativeEvent: { layout: { y: 320 } } }); }, [onLayout]);
    const entries = [style].flat() as ({ flexDirection?: string } | false | undefined)[];
    const direction = entries.reduce<{ flexDirection?: string }>((result, entry) => entry ? { ...result, ...entry } : result, {}).flexDirection;
    return React.createElement('div', { 'data-direction': direction || 'column', 'data-testid': testID }, children);
  };
  return { View: container, Text: container, KeyboardAvoidingView: container,
    Modal: container, Platform: { OS: 'android' },
    FlatList: ({ data, renderItem, ListEmptyComponent }: {
      data: string[]; renderItem: (value: { item: string }) => ReactNode; ListEmptyComponent: ReactNode;
    }) => React.createElement('div', null, data.length
      ? data.slice(0, 20).map((item) => React.createElement('div', { key: item }, renderItem({ item }))) : ListEmptyComponent),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(mockReduceMotion),
      addEventListener: (_event: string, listener: (enabled: boolean) => void) => {
        mockMotionListener = listener; return { remove: mockRemoveMotionListener };
      },
    },
    useAnimatedValue: () => React.useState(() => ({ setValue: mockSetOffset, stopAnimation: mockStopAnimation }))[0],
    Animated: { Text: container, loop: () => ({ start: jest.fn(), stop: jest.fn() }), sequence: () => ({}), timing: (value: unknown, config: unknown) => mockAnimate(value, config),
      Value: class { setValue = mockSetOffset; stopAnimation = mockStopAnimation; } },
    useWindowDimensions: () => mockDimensions,
    ScrollView: container,
    TextInput: ({ value, onChangeText, onFocus, onBlur, accessibilityLabel }: {
      value: string; onChangeText: (value: string) => void; onFocus?: () => void;
      onBlur?: () => void; accessibilityLabel?: string;
    }) => React.createElement('textarea', { value, onFocus, onBlur, 'aria-label': accessibilityLabel,
      onInput: (event: { currentTarget: HTMLTextAreaElement }) => onChangeText(event.currentTarget.value),
      onChange: () => undefined }), ActivityIndicator: () => React.createElement('div', { role: 'progressbar' }),
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
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn(({ view }: { view: string }) => { mockView = view; }) },
  useLocalSearchParams: () => ({ view: mockView }), useIsFocused: () => true,
}));
jest.mock('../../src/camera/use-camera-session', () => ({ useCameraSession: (active: boolean) => ({ ...mockCamera, isActive: active && mockCamera.isActive }) }));
jest.mock('../../src/camera/live-landmark-camera', () => ({
  LiveLandmarkCamera: ({ onReady }: { onReady: () => void }) => {
    const React = jest.requireActual('react');
    React.useEffect(() => { mockCameraMounts++; }, []);
    return React.createElement('button', { onClick: onReady, 'aria-label': 'Simulate camera ready' });
  },
}));
jest.mock('../../src/camera/landmark-overlay', () => ({ LandmarkOverlay: () => jest.requireActual('react').createElement('div', { 'data-testid': 'tracking-guides' }) }));
jest.mock('../../src/recognition/use-sentence-translator', () => ({ useSentenceTranslator: () => mockSentence }));
jest.mock('../../src/recognition/use-asl-word-recognizer', () => ({
  useAslWordRecognizer: (_active: boolean, _token: number, onWord: (word: string) => void) => ({
    processing: mockProcessing, candidates: mockCandidates, status: 'loaded',
    finishSign: mockFinishSign, message: mockRecognitionMessage,
    chooseCandidate: (word: string) => { mockChooseCandidate(word); onWord(word); },
  }),
}));
jest.mock('../../src/state/accessibility-settings', () => ({ useAccessibilitySettings: () => ({
  largeText: false, highContrast: false, tutorialSeen: mockTutorialSeen, markTutorialSeen: mockMarkTutorialSeen,
}) }));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  File: class {
    get exists() { if (mockStorageFails) throw new Error('Storage unavailable'); return mockStoredTutorial; }
    create() { if (mockStorageFails) throw new Error('Storage unavailable'); }
    writeSync(value: string) { mockWriteFlag(value); mockStoredTutorial = true; }
  },
}));


describe('home screen sentence stop action', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks(); mockTutorialSeen = true; mockView = 'camera'; mockSentence.busy = false; mockSentence.recording = true;
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Options"]')!.click());
    const sentences = container.querySelector<HTMLButtonElement>('button[aria-label="Sentences"]')!;
    act(() => sentences.click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

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



describe('Sign to Text review flow', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const input = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Word transcript"]')!;
  const typeText = (value: string) => act(() => {
    input().value = value;
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks(); mockTutorialSeen = true; mockDimensions = { width: 1200, height: 900, fontScale: 1 }; mockView = 'camera'; mockCameraMounts = 0; mockCandidates = ['HELLO']; mockProcessing = false;
    mockSentence.recording = false; mockSentence.busy = false;
    mockRecognitionMessage = 'Sign one word, then lower your hands.';
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => button('Simulate camera ready').click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('returns to welcome and reopens the same experience with text intact', () => {
    typeText('Keep my text');
    act(() => { button('Home').click(); root.render(React.createElement(HomeScreen)); });
    expect(container.textContent).toContain('Welcome to\nSignBridge');
    expect(button('Simulate camera ready')).toBeNull();
    expect(mockCamera.pause).toHaveBeenCalledTimes(1);
    act(() => { button('Get Started').click(); root.render(React.createElement(HomeScreen)); });
    expect(input().value).toBe('Keep my text');
    expect(mockCamera.start).not.toHaveBeenCalled();
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('shows welcome by default and enters the existing camera experience', () => {
    mockView = undefined;
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Get Started')).not.toBeNull();
    expect(button('Dictionary')).toBeNull();
    act(() => { button('Get Started').click(); root.render(React.createElement(HomeScreen)); });
    expect(button('Dictionary')).not.toBeNull();
    expect(button('Simulate camera ready')).not.toBeNull();
  });

  it('opens, searches and closes Dictionary without remounting or pausing the camera', () => {
    expect(button('Close Dictionary')).toBeNull();
    typeText('Keep this');
    act(() => button('Dictionary').click());
    const search = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Search Dictionary"]')!;
    expect(search).not.toBeNull();
    act(() => { search.value = 'hello'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(container.textContent).toContain('HELLO');
    act(() => { search.value = 'zzzzzznomatch'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(container.textContent).toContain('No matching words.');
    act(() => button('Close Dictionary').click());
    expect(button('Close Dictionary')).toBeNull();
    expect(input().value).toBe('Keep this');
    expect(mockCameraMounts).toBe(1);
    expect(mockCamera.pause).not.toHaveBeenCalled();
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('keeps secondary tools closed by default and adapts the panels to screen width and text scaling', () => {
    expect(button('Undo')).toBeNull();
    expect(button('Sentences')).toBeNull();
    expect(container.textContent).not.toContain('NOT SAVED');
    expect(button('Copy')).not.toBeNull();
    const direction = () => container.querySelector('[data-testid="translation-workspace"]')!.getAttribute('data-direction');
    expect(direction()).toBe('row');
    mockDimensions = { width: 390, height: 640, fontScale: 1 };
    act(() => root.render(React.createElement(HomeScreen)));
    expect(direction()).toBe('column');
    mockDimensions = { width: 1200, height: 900, fontScale: 2 };
    act(() => root.render(React.createElement(HomeScreen)));
    expect(direction()).toBe('column');
  });

  it('guides all four targets, supports Back and Finish, and leaves no tutorial UI behind', () => {
    mockTutorialSeen = false; mockView = undefined;
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => { button('Get Started').click(); root.render(React.createElement(HomeScreen)); });
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    expect(button('Back').disabled).toBe(true);
    act(() => button('Next').click());
    expect(container.textContent).toContain('Your recognized signs will appear here.');
    act(() => button('Back').click());
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    act(() => button('Next').click());
    act(() => button('Next').click());
    expect(container.textContent).toContain('Choose a suggestion if the recognition is incorrect.');
    const mounts = mockCameraMounts;
    act(() => button('Add HELLO').click());
    expect(input().value).toBe('HELLO');
    act(() => button('Next').click());
    expect(container.textContent).toContain('Open Dictionary to explore available signs.');
    act(() => button('Dictionary').click());
    expect(button('Close Dictionary')).not.toBeNull();
    act(() => button('Close Dictionary').click());
    act(() => button('Finish').click());
    expect(button('Next')).toBeNull(); expect(button('Finish')).toBeNull(); expect(button('Skip')).toBeNull();
    expect(container.textContent).not.toContain('Quick tour');
    expect(container.textContent).not.toContain('↓');
    expect(mockMarkTutorialSeen).toHaveBeenCalledTimes(1);
    expect(mockCameraMounts).toBe(mounts);
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('supports Skip, remembers completion and allows replay through Options', () => {
    mockTutorialSeen = false; mockView = undefined;
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => { button('Get Started').click(); root.render(React.createElement(HomeScreen)); });
    act(() => button('Skip').click());
    expect(button('Next')).toBeNull();
    expect(mockMarkTutorialSeen).toHaveBeenCalledTimes(1);
    act(() => { button('Home').click(); root.render(React.createElement(HomeScreen)); });
    act(() => { button('Get Started').click(); root.render(React.createElement(HomeScreen)); });
    expect(button('Next')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Replay tutorial').click());
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    act(() => button('Skip').click());
  });

  it('keeps tutorial arrows static when reduced motion is enabled', async () => {
    mockReduceMotion = true;
    act(() => button('Options').click());
    await act(async () => button('Replay tutorial').click());
    expect(mockAnimate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Quick tour');
    mockReduceMotion = false;
  });

  it('removes redundant labels and places the existing suggestions before recognized text', () => {
    expect(container.textContent).not.toContain('EDITABLE');
    expect(container.textContent).not.toContain('ASL word recognition');
    expect(container.textContent).toContain('Recognized Text');
    expect(container.textContent).not.toContain('Suggestions');
    expect(container.textContent).not.toContain('3 possible matches');
    expect(container.textContent!.indexOf('HELLO')).toBeLessThan(container.textContent!.indexOf('Recognized Text'));
    expect(button('Home').textContent).toContain('Home');
    expect(button('Dictionary').textContent).toContain('Dictionary');
    expect(button('Options').textContent).toContain('Options');
    typeText('Still editable');
    expect(input().value).toBe('Still editable');
  });

  it('adds a real candidate to the editable transcript through the existing selection callback', () => {
    expect(input().value).toBe('');
    act(() => button('Add HELLO').click());
    expect(mockChooseCandidate).toHaveBeenCalledWith('HELLO');
    expect(input().value).toBe('HELLO');
  });

  it('supports manual edits, copy and clear', async () => {
    typeText('Hello there');
    await act(async () => button('Copy').click());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Hello there');
    act(() => button('Clear').click());
    expect(input().value).toBe('');
  });

  it('removes the extended text tools and keeps the basic editing controls', () => {
    for (const label of ['More text tools', 'Fewer text tools', 'Add space', 'Delete last character', 'Undo', 'Confirm final text']) {
      expect(button(label)).toBeNull();
    }
    typeText('Reviewed text');
    expect(input().value).toBe('Reviewed text');
    expect(button('Copy').disabled).toBe(false);
    expect(button('Clear').disabled).toBe(false);
    expect(mockCamera.pause).not.toHaveBeenCalled();
  });

  it('expands Options above the camera and closes without remounting it', () => {
    expect(container.textContent).not.toContain('Recognition options');
    act(() => button('Options').click());
    expect(container.textContent!.indexOf('Recognition options')).toBeLessThan(container.textContent!.indexOf('Recognized Text'));
    expect(button('Words')).not.toBeNull();
    expect(button('Use legacy 1,000-sign model')).not.toBeNull();
    expect(mockCameraMounts).toBe(1);
    act(() => button('Hide options').click());
    expect(container.textContent).not.toContain('Recognition options');
    expect(mockCameraMounts).toBe(1);
  });

  it('shows three clickable matches without a retry button or blocking the next sign', () => {
    mockCandidates = ['HELLO', 'WATER', 'FRIEND'];
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Try again')).toBeNull();
    expect(button('Finish sign').disabled).toBe(false);
    for (const word of mockCandidates) {
      expect(button(`Add ${word}`).disabled).toBe(false);
      expect(button(`Add ${word}`).textContent).toContain(word);
      expect(button(`Add ${word}`).textContent).toBe(word);
    }
    expect(mockCameraMounts).toBe(1);
  });

  it('disables candidate selection and Finish during inference', () => {
    mockProcessing = true;
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Try again')).toBeNull();
    expect(button('Add HELLO').disabled).toBe(true);
    expect(button('Finish sign')).toBeNull();
    expect(button('Reading sign…').disabled).toBe(true);
  });

  it('shows tracking guides by default, can hide them without remounting the camera and preserves Settings navigation', () => {
    expect(container.querySelector('[data-testid="tracking-guides"]')).not.toBeNull();
    expect(button('Open model and accessibility settings')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Hide tracking guides').click());
    expect(container.querySelector('[data-testid="tracking-guides"]')).toBeNull();
    act(() => button('Show tracking guides').click());
    expect(container.querySelector('[data-testid="tracking-guides"]')).not.toBeNull();
    expect(mockCameraMounts).toBe(1);
    act(() => button('Open model and accessibility settings').click());
    expect(router.push).toHaveBeenCalledWith('/settings');
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('explains missing alternatives without displaying invented suggestions', () => {
    mockCandidates = [];
    act(() => root.render(React.createElement(HomeScreen)));
    expect(container.textContent).toContain(mockRecognitionMessage);
    expect(button('Add HELLO')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Sentences').click());
    expect(container.textContent).toContain('no alternative predictions');
  });
});

describe('welcome motion preference', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('uses one subtle native slide when motion is allowed and stops when reduced motion is enabled', async () => {
    mockReduceMotion = false;
    await act(async () => root.render(React.createElement(WelcomeScreen, { onGetStarted: jest.fn() })));
    expect(mockAnimate).toHaveBeenCalledWith(expect.anything(), { toValue: 0, duration: 480, useNativeDriver: true });
    act(() => mockMotionListener(true));
    expect(mockSetOffset).toHaveBeenLastCalledWith(0);
    expect(mockStopAnimation).toHaveBeenCalled();
  });

  it('shows the full heading without animation when reduced motion is enabled', async () => {
    mockReduceMotion = true;
    await act(async () => root.render(React.createElement(WelcomeScreen, { onGetStarted: jest.fn() })));
    expect(container.textContent).toContain('Welcome to\nSignBridge');
    expect(mockAnimate).not.toHaveBeenCalled();
    expect(mockSetOffset).toHaveBeenLastCalledWith(0);
  });
});

describe('saved tutorial preference', () => {
  const { AccessibilitySettingsProvider, useAccessibilitySettings } = jest.requireActual('../../src/state/accessibility-settings');
  let current: { tutorialSeen: boolean; markTutorialSeen: () => void };
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  function SettingsProbe() { current = useAccessibilitySettings(); return null; }
  beforeEach(() => {
    mockStorageFails = false; mockStoredTutorial = false; mockWriteFlag.mockClear();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const renderSettings = () => act(() => root.render(React.createElement(AccessibilitySettingsProvider, null, React.createElement(SettingsProbe))));

  it('persists completion and reads it when the settings provider mounts again', () => {
    renderSettings(); expect(current.tutorialSeen).toBe(false);
    act(() => current.markTutorialSeen());
    expect(current.tutorialSeen).toBe(true); expect(mockWriteFlag).toHaveBeenCalledWith('complete');
    act(() => root.unmount()); root = createRoot(container);
    renderSettings(); expect(current.tutorialSeen).toBe(true);
  });

  it('keeps a session preference when device storage is unavailable', () => {
    mockStorageFails = true; renderSettings();
    expect(current.tutorialSeen).toBe(false);
    act(() => current.markTutorialSeen());
    expect(current.tutorialSeen).toBe(true);
  });
});

afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
