import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { requireOptionalNativeModule } from 'expo';
import { CallSession, initialCallState } from './call-session';
import { getWebRTC } from './native-webrtc';
import { signalingUrl, type CaptionKind } from './protocol';

const audioModule = () => requireOptionalNativeModule<{ startCallAudio?: () => void; stopCallAudio?: () => void }>('SignBridgeTracker');

export function useVideoCall() {
  const [state, setState] = useState(initialCallState);
  const session = useRef<CallSession | null>(null);
  const mounted = useRef(true);
  const isFocused = useIsFocused();
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (next) => {
      // Permission prompts may temporarily make iOS inactive. Only background
      // ends the foreground-only call and releases camera/microphone resources.
      if (next === 'background') session.current?.end('Call ended when SignBridge went into the background.');
    });
    return () => { mounted.current = false; listener.remove(); session.current?.end(); session.current = null; audioModule()?.stopCallAudio?.(); };
  }, []);
  useEffect(() => { if (!isFocused) session.current?.end(); }, [isFocused]);
  const start = useCallback((options: Parameters<CallSession['start']>[1]) => {
    try {
      const url = signalingUrl(process.env.EXPO_PUBLIC_CALL_SIGNAL_URL, __DEV__);
      const rtc = getWebRTC();
      audioModule()?.startCallAudio?.();
      session.current ??= new CallSession(rtc, (address) => new WebSocket(address), (next) => {
        if (next.phase === 'ended' || next.phase === 'error') audioModule()?.stopCallAudio?.();
        if (mounted.current) setState(next);
      });
      void session.current.start(url, options);
    } catch (error) { audioModule()?.stopCallAudio?.(); setState({ ...initialCallState(), phase: 'error', message: error instanceof Error ? error.message : 'Calling is unavailable.' }); }
  }, []);
  const sendCaption = useCallback((text: string, kind: CaptionKind) => session.current?.sendCaption(text, kind) ?? false, []);
  return { ...state, start, sendCaption, end: () => session.current?.end(), toggleCamera: () => session.current?.toggleCamera(),
    toggleMicrophone: () => void session.current?.toggleMicrophone(), switchCamera: () => void session.current?.switchCamera(),
    setCaptions: (enabled: boolean) => session.current?.setCaptions(enabled) };
}
