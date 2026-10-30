import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MediaStream } from 'react-native-webrtc';
import type { TrackingFrame } from '@/recognition/landmarks';

type Frame = TrackingFrame & { token: number };
type Tracker = InstanceType<NativeModule<{ onCallLandmarks: (frame: Frame) => void; onCallTrackingError: (event: { token: number; message: string }) => void }>> & {
  startCallTracking: (token: number) => Promise<void>; stopCallTracking: (token: number) => void;
};
// Fast Refresh can reload this module while the native processor survives.
// Preserve ordering so a refreshed JS session is not rejected as an old start.
const trackingRuntime = globalThis as typeof globalThis & { __signBridgeCallTrackingToken?: number };
export function useCallTracking(stream: MediaStream | null, enabled: boolean, onFrame: (frame: TrackingFrame) => void, cameraGeneration: boolean) {
  const callback = useRef(onFrame);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const activation = useMemo(() => ({ stream, enabled, cameraGeneration, attempt }), [stream, enabled, cameraGeneration, attempt]);
  const [status, setStatus] = useState<{ activation: object | null; error: string; ready: boolean }>({ activation: null, error: '', ready: false });
  const tracker = requireOptionalNativeModule<Tracker>('SignBridgeTracker');
  useLayoutEffect(() => { callback.current = onFrame; });
  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!enabled || !track || !tracker?.startCallTracking) return;
    const token = (trackingRuntime.__signBridgeCallTrackingToken ?? 0) + 1;
    trackingRuntime.__signBridgeCallTrackingToken = token;
    let disposed = false;
    let lastFrameAt = Date.now();
    let receiving = false;
    let receivedFrame = false;
    let failed = false;
    let stalled = false;
    const frames = tracker.addListener('onCallLandmarks', (frame) => {
      if (disposed || failed || frame.token !== token) return;
      lastFrameAt = Date.now(); receivedFrame = true; stalled = false;
      if (!receiving) { receiving = true; setStatus({ activation, error: '', ready: true }); }
      callback.current(frame);
    });
    const errors = tracker.addListener('onCallTrackingError', (event) => {
      if (!disposed && event.token === token) { failed = true; setStatus({ activation, error: event.message, ready: false }); }
    });
    // Resolving start only registers the processor. Require real frames before
    // claiming tracking is ready, and surface stalls instead of waiting forever.
    const watchdog = setInterval(() => {
      if (disposed || failed || stalled || Date.now() - lastFrameAt < (receivedFrame ? 5000 : 15000)) return;
      receiving = false; stalled = true;
      setStatus({ activation, error: 'No camera tracking frames are arriving. Tap Restart AI tracking to try again.', ready: false });
    }, 1000);
    void tracker.startCallTracking(token).then(() => {
      if (disposed) { tracker.stopCallTracking(token); return; }
      track._setVideoEffects(['signbridge-captions']);
    }).catch((cause: unknown) => {
      if (!disposed) { failed = true; setStatus({ activation, error: cause instanceof Error ? cause.message : 'Could not start AI captions.', ready: false }); }
    });
    return () => {
      disposed = true; clearInterval(watchdog); frames.remove(); errors.remove();
      try { track._setVideoEffects([]); } finally { tracker.stopCallTracking(token); }
    };
  }, [stream, enabled, activation, tracker]);
  return { error: enabled && !tracker?.startCallTracking ? 'AI call captions need the updated SignBridge build. You can still type captions.'
    : status.activation === activation ? status.error : '', ready: enabled && status.activation === activation && status.ready, retry };
}
