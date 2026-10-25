import { visibleHands, type Landmark, type TrackingFrame } from '../recognition/landmarks';
import { pointInView, trackingFeedback, TRACKING_COLORS } from '../recognition/tracking-feedback';

const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const BODY_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
// Sparse contours through MediaPipe's published FaceMesh landmark topology.
// Draw expression-bearing features, not hundreds of filled mesh triangles.
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
const FACE_PATHS = [
  [10, 297, 284, 389, 454, 361, 397, 379, 400, 152, 176, 150, 172, 132, 234, 162, 54, 67, 10],
  [33, 160, 158, 133, 153, 144, 33], [263, 387, 385, 362, 380, 373, 263],
  [70, 63, 105, 66, 107], [300, 293, 334, 296, 336],
  [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91, 61],
  [78, 81, 13, 311, 308, 402, 14, 178, 78],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [98, 97, 2, 326, 327, 294],
  [469, 470, 471, 472, 469], [474, 475, 476, 477, 474],
];
// Deduplicate contour endpoints. Iris centres are available in the 478-point
// task model; older 468-point frames simply omit them without inventing dots.
const FACE_DOTS = [...new Set([...FACE_PATHS.flat(), 468, 473])];
type Point = { x: number; y: number };
type Group = 'face' | 'body' | 'hand';
type Line = { key: string; group: Group; from: Point; to: Point; color: string; thickness: number };
type Dot = Point & { key: string; group: Group; color: string; radius: number };

export function trackingOverlayGeometry(frame: TrackingFrame | null, size: { width: number; height: number }, mirrored: boolean) {
  const lines: Line[] = []; const dots: Dot[] = [];
  if (!frame || ![frame.width, frame.height, size.width, size.height].every((n) => Number.isFinite(n) && n > 0)) return { lines, dots };
  const scale = Math.min(size.width / frame.width, size.height / frame.height);
  const width = frame.width * scale; const height = frame.height * scale;
  const xOffset = (size.width - width) / 2; const yOffset = (size.height - height) / 2;
  const project = (p: Landmark | undefined): Point | null => pointInView(p)
    ? { x: xOffset + (mirrored ? 1 - p.x : p.x) * width, y: yOffset + p.y * height } : null;
  const line = (a: Landmark | undefined, b: Landmark | undefined, key: string, group: Group, color: string, thickness: number) => {
    const from = project(a); const to = project(b);
    if (from && to && Math.hypot(to.x - from.x, to.y - from.y) >= 0.1) lines.push({ key, group, from, to, color, thickness });
  };
  const dot = (p: Landmark | undefined, key: string, group: Group, color: string, radius: number) => {
    const position = project(p);
    if (position) dots.push({ ...position, key, group, color, radius });
  };
  const feedback = trackingFeedback(frame);
  if (feedback.upperBody !== 'missing') {
    for (const [a, b] of BODY_BONES) line(frame.pose[a], frame.pose[b], `body-${a}-${b}`, 'body', TRACKING_COLORS.body, 2);
    for (const i of [11, 12, 13, 14, 15, 16]) dot(frame.pose[i], `body-${i}`, 'body', TRACKING_COLORS.body, 3);
  }
  if (feedback.face !== 'missing') {
    FACE_PATHS.forEach((path, index) => path.slice(1).forEach((b, i) =>
      line(frame.face[path[i]], frame.face[b], `face-${index}-${i}`, 'face', TRACKING_COLORS.face, 1.25)));
    for (const i of FACE_DOTS) dot(frame.face[i], `face-${i}`, 'face', TRACKING_COLORS.face, 2);
  }
  visibleHands(frame).forEach((hand, index) => {
    const color = hand.side === 'Left' ? TRACKING_COLORS.leftHand : TRACKING_COLORS.rightHand;
    for (const [a, b] of HAND_BONES) line(hand.landmarks[a], hand.landmarks[b], `hand-${index}-${a}-${b}`, 'hand', color, 2);
    hand.landmarks.forEach((p, i) => dot(p, `hand-${index}-${i}`, 'hand', color, 3));
  });
  return { lines, dots };
} 

