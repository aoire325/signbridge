import { Camera, useCameraPermissions, type CameraType } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useNavigation } from 'expo-router';

import { pauseForInterruption, toggleCameraFacing, type CameraSessionState } from '@/camera/session-state';

export function useCameraSession(isScreenFocused: boolean) {
  const [permission, requestPermission] = useCameraPermissions();
  const [permissionOverride, setPermissionOverride] = useState<typeof permission>(null);
  const [session, setSession] = useState<CameraSessionState>('stopped');
  const [sessionToken, setSessionToken] = useState(0);
  const [facing, setFacing] = useState<CameraType>('front');
  const [error, setError] = useState('');
  const [appState, setAppState] = useState<AppStateStatus>(
    (AppState.currentState as AppStateStatus | null) ?? 'active',
  );
  const currentPermission = permissionOverride ?? permission;
  const navigation = useNavigation();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (nextState !== 'active') {
        setSession(pauseForInterruption);
        return;
      }
      void Camera.getCameraPermissionsAsync()
        .then(setPermissionOverride)
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setSession(pauseForInterruption);
    });
    return unsubscribe;
  }, [navigation]);

  const start = async () => {
    setError('');
    try {
      const result = currentPermission?.granted ? currentPermission : await requestPermission();
      setPermissionOverride(result);
      if (!result.granted) return false;
      setSessionToken((current) => current + 1);
      setSession('running');
      return true;
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : 'Camera permission could not be checked.');
      return false;
    }
  };

  const pause = () => setSession(pauseForInterruption);

  const stop = () => {
    setSession('stopped');
    setError('');
  };

  const switchCamera = () => {
    setSessionToken((current) => current + 1);
    setFacing(toggleCameraFacing);
  };

  const reportCameraError = useCallback((message: string) => {
    setError(message);
    setSession('stopped');
  }, []);

  return {
    permission: currentPermission,
    session,
    sessionToken,
    facing,
    error,
    isActive: session === 'running' && appState === 'active' && isScreenFocused,
    start,
    pause,
    stop,
    switchCamera,
    reportCameraError,
  };
} 

