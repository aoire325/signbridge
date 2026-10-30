import React, { act } from 'react';
import { useCallTracking } from '../../src/calls/use-call-tracking';
import type { TrackingFrame } from '../../src/recognition/landmarks';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockListeners = new Map<string, (event: unknown) => void>();
const mockModule = {
  startCallTracking: jest.fn(async (_token: number) => {}), stopCallTracking: jest.fn(),
  addListener: jest.fn((name: string, callback: (event: unknown) => void) => {
    mockListeners.set(name, callback); return { remove: () => mockListeners.delete(name) };
  }),
};
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockModule }));
const effects = jest.fn();
const stream = { getVideoTracks: () => [{ _setVideoEffects: effects }] } as unknown as NonNullable<Parameters<typeof useCallTracking>[0]>;
const onFrame = jest.fn();
let current: ReturnType<typeof useCallTracking>;
function Pilot({ enabled = true }: { enabled?: boolean }) { current = useCallTracking(stream, enabled, onFrame, true); return null; }
const token = () => mockModule.startCallTracking.mock.calls.at(-1)![0];
const emitFrame = (value = token()) => mockListeners.get('onCallLandmarks')?.({ token: value } as TrackingFrame & { token: number });

describe('call tracker frame health', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  beforeEach(async () => {
    jest.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mockListeners.clear(); jest.clearAllMocks();
    mockModule.startCallTracking.mockImplementation(async () => {});
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(React.createElement(Pilot)));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
  it('requires an actual frame before reporting ready', () => {
    expect(effects).toHaveBeenCalledWith(['signbridge-captions']); expect(current.ready).toBe(false);
    act(() => emitFrame()); expect(current.ready).toBe(true); expect(onFrame).toHaveBeenCalledTimes(1);
  });
  it('reports a missing camera feed and recovers when frames arrive', () => {
    act(() => jest.advanceTimersByTime(15000));
    expect(current.ready).toBe(false); expect(current.error).toContain('No camera tracking frames');
    act(() => emitFrame()); expect(current.ready).toBe(true); expect(current.error).toBe('');
    act(() => jest.advanceTimersByTime(5000)); expect(current.ready).toBe(false); expect(current.error).toContain('Restart AI');
  });
  it('restarts with a fresh token and ignores frames from the previous session', async () => {
    const previous = token(); await act(async () => current.retry());
    expect(mockModule.stopCallTracking).toHaveBeenCalledWith(previous);
    act(() => emitFrame(previous)); expect(onFrame).not.toHaveBeenCalled(); expect(current.ready).toBe(false);
    act(() => emitFrame()); expect(onFrame).toHaveBeenCalledTimes(1); expect(current.ready).toBe(true);
  });
  it('keeps native failures visible rather than letting the watchdog replace them', () => {
    act(() => mockListeners.get('onCallTrackingError')?.({ token: token(), message: 'Model is missing' }));
    act(() => jest.advanceTimersByTime(20000));
    expect(current.error).toBe('Model is missing'); expect(current.ready).toBe(false);
    act(() => emitFrame()); expect(onFrame).not.toHaveBeenCalled();
  });
  it('releases listeners and the processor when disabled', () => {
    const clearWatchdog = jest.spyOn(globalThis, 'clearInterval');
    const previous = token(); act(() => root.render(React.createElement(Pilot, { enabled: false })));
    expect(mockModule.stopCallTracking).toHaveBeenCalledWith(previous); expect(effects).toHaveBeenLastCalledWith([]);
    expect(mockListeners.size).toBe(0); expect(current.ready).toBe(false); expect(clearWatchdog).toHaveBeenCalledTimes(1);
    clearWatchdog.mockRestore();
  });
});
