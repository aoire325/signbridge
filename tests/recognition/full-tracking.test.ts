import { trackingFeedback } from '../../src/recognition/tracking-feedback';
import { trackingOverlayGeometry } from '../../src/camera/tracking-overlay-geometry';
import { packSentenceFrame, SentenceCapture } from '../../src/recognition/sentence-input';
import { packWordLandmarks } from '../../src/recognition/asl-word-recognition';
import type { TrackingFrame } from '../../src/recognition/landmarks';

function frame(hands = true): TrackingFrame {
  const point = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const pose = Array.from({ length: 33 }, () => point(0.5, 0.2));
  pose[11] = point(0.3, 0.4); pose[12] = point(0.7, 0.4);
  pose[13] = point(0.2, 0.6); pose[14] = point(0.8, 0.6);
  pose[15] = point(0.25, 0.7); pose[16] = point(0.75, 0.7);
  pose[23] = point(0.35, 0.9); pose[24] = point(0.65, 0.9);
  const face = Array.from({ length: 478 }, (_, i) => point(0.4 + (i % 10) * 0.02, 0.15 + (i % 7) * 0.02));
  return { timestampMs: 0, width: 480, height: 640, pose, face, blendshapes: { browInnerUp: 0.3 }, inferenceMs: 30,
    hands: hands ? [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.25 + i * 0.002, 0.7 + i * 0.002)) }] : [] };
}

describe('face, upper-body and hand framing', () => {
  it('reports and draws face/body when no hands are present', () => {
    const input = frame(false);
    expect(trackingFeedback(input)).toMatchObject({ face: 'tracked', upperBody: 'tracked', hands: 0 });
    expect(trackingFeedback(input).guidance).toMatch(/raise your hands/i);
    const overlay = trackingOverlayGeometry(input, { width: 320, height: 240 }, false);
    expect(new Set(overlay.lines.map((l) => l.group))).toEqual(new Set(['face', 'body']));
    expect(overlay.dots.some((d) => d.group === 'hand')).toBe(false);
  });

  it('explains clipped faces and elbows instead of calling any nonempty array tracked', () => {
    const input = frame();
    const clippedFace = { ...input, face: input.face.map((p, i) => i === 152 ? { ...p, y: 1.2 } : p) };
    expect(trackingFeedback(clippedFace).face).toBe('partial');
    expect(trackingFeedback(clippedFace).guidance).toMatch(/whole face/i);
    const elbowHidden = { ...input, pose: input.pose.map((p, i) => i === 13 ? { ...p, visibility: 0.1 } : p) };
    expect(trackingFeedback(elbowHidden).upperBody).toBe('partial');
    expect(trackingFeedback(elbowHidden).guidance).toMatch(/elbows/i);
    const overlay = trackingOverlayGeometry(elbowHidden, { width: 300, height: 400 }, false);
    expect(overlay.lines.some((line) => line.key === 'body-11-13')).toBe(false);
    const invalid = { ...input, face: input.face.map((p) => ({ ...p, x: NaN })) };
    expect(trackingFeedback(invalid).face).toBe('missing');
    expect(trackingOverlayGeometry(invalid, { width: 300, height: 400 }, false).lines.some((l) => l.group === 'face')).toBe(false);
    expect(trackingFeedback({ ...input, width: 0 })).toMatchObject({ face: 'missing', upperBody: 'missing', hands: 0 });
  });

  it('mirrors only the display, with the same letterboxing for every tracked part', () => {
    const input = frame(); const before = JSON.stringify(input);
    const size = { width: 320, height: 240 };
    const direct = trackingOverlayGeometry(input, size, false);
    const mirrored = trackingOverlayGeometry(input, size, true);
    expect(new Set(direct.lines.map((l) => l.group))).toEqual(new Set(['face', 'body', 'hand']));
    expect(direct.lines.length + direct.dots.length).toBeLessThan(200);
    direct.dots.forEach((dot, i) => {
      expect(dot.x + mirrored.dots[i].x).toBeCloseTo(size.width);
      expect(dot.y).toBeCloseTo(mirrored.dots[i].y);
      expect(dot.x).toBeGreaterThanOrEqual(70); // 480×640 fitted into 320×240
      expect(dot.x).toBeLessThanOrEqual(250);
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(trackingOverlayGeometry(input, { width: 0, height: 0 }, false)).toEqual({ lines: [], dots: [] });
  });

  it('counts reliable hands and gives edge guidance without requiring two hands for a sign', () => {
    const input = frame();
    expect(trackingFeedback(input)).toMatchObject({ hands: 1, face: 'tracked', upperBody: 'tracked' });
    const partial = { ...input, hands: input.hands.map((h) => ({ ...h,
      landmarks: h.landmarks.map((p, i) => i === 20 ? { ...p, x: 1.1 } : p) })) };
    expect(trackingFeedback(partial).guidance).toMatch(/fingertips/i);
    expect(trackingFeedback({ ...input, hands: input.hands.map((h) => ({ ...h, score: 0.1 })) }).hands).toBe(0);
  });
});

describe('facial and body landmarks reach compatible recognizers', () => {
  it('preserves facial movement through a hands-out sentence pause', () => {
    const base = frame(false); const changed = { ...base, face: base.face.map((p, i) => i === 13 ? { ...p, y: p.y + 0.03 } : p) };
    const a = packSentenceFrame(base)!; const b = packSentenceFrame(changed)!;
    expect(Array.from(a.slice(0, 134))).toEqual(Array.from(b.slice(0, 134)));
    expect(Array.from(a.slice(134))).not.toEqual(Array.from(b.slice(134)));
    expect(Array.from(b.slice(50, 134))).toEqual(Array(84).fill(-1)); // missing hands stay missing
    const capture = new SentenceCapture();
    for (let t = 0; t <= 3000; t += 125) {
      const source = t === 1500 ? changed : frame();
      capture.accept({ ...source, timestampMs: t, pose: source.pose.map((p, i) => i === 11 || i === 12 ? p : { ...p, x: p.x + t * 0.0001 }) });
    }
    const input = capture.finish();
    expect(input.mask[12]).toBe(1);
    expect(Array.from(input.features.slice(12 * 208 + 134, 13 * 208))).toEqual(Array.from(b.slice(134)));
  });

  it('puts face, upper-body and hand coordinates in the 250-word model’s trained slots', () => {
    const input = frame();
    const packed = packWordLandmarks(input);
    expect(packed[13 * 3 + 1]).toBeCloseTo(input.face[13].y);
    expect(packed[(489 + 13) * 3]).toBeCloseTo(input.pose[13].x);
    expect(packed[(468 + 8) * 3]).toBeCloseTo(input.hands[0].landmarks[8].x);
  });
}); 

