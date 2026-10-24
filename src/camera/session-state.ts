import type { CameraType } from 'expo-camera';

export type CameraSessionState = 'stopped' | 'running' | 'paused';

export function pauseForInterruption(session: CameraSessionState): CameraSessionState {
  return session === 'running' ? 'paused' : session;
}

export function toggleCameraFacing(facing: CameraType): CameraType {
  return facing === 'front' ? 'back' : 'front';
} 

