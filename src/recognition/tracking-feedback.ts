import { visibleHands, type Landmark, type TrackingFrame } from './landmarks';

export type TrackingVisibility = 'tracked' | 'partial' | 'missing';
export const TRACKING_COLORS = { face: '#FFB2D5', body: '#8BC9FF', leftHand: '#85F0CF', rightHand: '#FFD785' } as const;

/** Display/framing checks only: never zero low-confidence model inputs here. */
export function pointInView(point: Landmark | undefined): point is Landmark {
  return !!point && [point.x, point.y, point.z].every(Number.isFinite)
    && (point.visibility ?? 1) >= 0.5 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function trackingFeedback(frame: TrackingFrame | null) {
  let face: TrackingVisibility = 'missing';
  let upperBody: TrackingVisibility = 'missing';
  const validFrame = frame && Number.isFinite(frame.width) && Number.isFinite(frame.height)
    && frame.width > 0 && frame.height > 0;
  const hands = validFrame ? visibleHands(frame) : [];
  if (validFrame) {
    // Nose, eye corners, mouth corners and chin: useful framing anchors rather
    // than a mesh-length check that can mistake invalid arrays for a face.
    const faceAnchors = [1, 33, 263, 61, 291, 152].map((i) => frame.face[i]);
    if (frame.face.length >= 468 && faceAnchors.some(pointInView)) {
      const leftEye = frame.face[33]; const rightEye = frame.face[263];
      const eyeDistance = leftEye && rightEye ? Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y) : 0;
      face = faceAnchors.every(pointInView) && eyeDistance >= 0.01 ? 'tracked' : 'partial';
      if (!Number.isFinite(eyeDistance) || eyeDistance === 0) face = 'missing';
    }
    const joints = [11, 12, 13, 14].map((i) => frame.pose[i]);
    if (joints.some(pointInView)) {
      const [left, right] = joints;
      const shoulderDistance = left && right ? Math.hypot(left.x - right.x, left.y - right.y) : 0;
      upperBody = joints.every(pointInView) && shoulderDistance >= 0.03 ? 'tracked' : 'partial';
      if (!Number.isFinite(shoulderDistance) || shoulderDistance === 0) upperBody = 'missing';
    }
  }
  let guidance = 'Keep your face, shoulders, elbows and signing hands in view.';
  if (!validFrame) guidance = 'Position yourself so your face, upper body and hands fit in the camera.';
  else if (face !== 'tracked') guidance = 'Keep your whole face visible and well lit, including your eyes and mouth.';
  else if (upperBody !== 'tracked') guidance = 'Move back until both shoulders and elbows fit in view.';
  else if (!hands.length) guidance = 'Face and upper body are visible. Raise your hands to begin signing.';
  else if (hands.some((hand) => !hand.landmarks.every(pointInView))) guidance = 'Keep your wrists and fingertips inside the camera view.';
  else guidance = 'Face, upper body and signing hands are visible.';
  return { face, upperBody, hands: hands.length, guidance };
} 

