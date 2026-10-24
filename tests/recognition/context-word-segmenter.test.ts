import { ContextWordSegmenter } from '../../src/recognition/context-word-segmenter';
import { packCitizenLandmarks } from '../../src/recognition/citizen-recognition';
import { hasExpandedContext } from '../../src/recognition/expanded-word-input';
import type { TrackingFrame } from '../../src/recognition/landmarks';

function frame(timestampMs: number, hands = true): TrackingFrame {
  const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
  const pose = Array.from({ length: 33 }, () => point(0.5));
  pose[11] = point(0.3); pose[12] = point(0.7);
  return { timestampMs, width: 640, height: 480, pose, face: [], blendshapes: {}, inferenceMs: 20,
    hands: hands ? [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, () => point(0.4)) }] : [] };
}
const capture = () => new ContextWordSegmenter(packCitizenLandmarks, hasExpandedContext);

describe('whole isolated-sign boundaries', () => {
  it('retains bounded body lead-in, brief missed hands and the hands-out ending', () => {
    const segmenter = capture();
    for (let t = 0; t < 1000; t += 100) segmenter.accept(frame(t, false));
    for (let t = 1000; t <= 1800; t += 100) segmenter.accept(frame(t, t !== 1300));
    for (let t = 1900; t < 2500; t += 100) segmenter.accept(frame(t, false));
    const result = segmenter.accept(frame(2500, false));
    expect(result.kind).toBe('complete');
    if (result.kind !== 'complete') throw new Error('Expected complete capture');
    expect(result.samples[0].timestampMs).toBe(400);
    expect(result.samples.at(-1)!.timestampMs).toBe(2500);
    expect(result.samples.find((s) => s.timestampMs === 1300)!.landmarks.slice(14).every((v) => v === 0)).toBe(true);
    expect(result.samples.at(-1)!.landmarks[6]).toBeCloseTo(0.3); // body remains observed
    expect(result.samples.at(-1)!.landmarks.slice(14).every((v) => v === 0)).toBe(true);
    expect(segmenter.finish().kind).toBe('idle');
  });

  it('does not mistake lead-in or ending time for the minimum amount of signing', () => {
    const segmenter = capture();
    for (let t = 0; t < 1000; t += 100) segmenter.accept(frame(t, false));
    segmenter.accept(frame(1000)); segmenter.accept(frame(1100));
    for (let t = 1200; t < 1800; t += 100) segmenter.accept(frame(t, false));
    expect(segmenter.accept(frame(1800, false)).kind).toBe('too-short');
  });

  it('can finish while hands are visible without repeating a held sign', () => {
    const segmenter = capture();
    for (let t = 0; t <= 800; t += 100) segmenter.accept(frame(t));
    expect(segmenter.finish().kind).toBe('complete');
    for (let t = 900; t <= 1500; t += 100) expect(segmenter.accept(frame(t)).kind).toBe('idle');
    expect(segmenter.finish().kind).toBe('idle');
    for (let t = 1600; t <= 2200; t += 100) segmenter.accept(frame(t, false));
    for (let t = 2300; t <= 3100; t += 100) segmenter.accept(frame(t));
    expect(segmenter.finish().kind).toBe('complete');
  });

  it('supports five seconds at the faster native rate, plus context, without a 64-frame cutoff', () => {
    const segmenter = capture();
    for (let t = 0; t < 600; t += 33) segmenter.accept(frame(t, false));
    for (let t = 600; t <= 5550; t += 33) expect(segmenter.accept(frame(t)).kind).toBe('tracking');
    const result = segmenter.finish();
    expect(result.kind).toBe('complete');
    if (result.kind !== 'complete') throw new Error('Expected complete capture');
    expect(result.samples.length).toBeGreaterThan(160);
    expect(result.samples.length).toBeLessThanOrEqual(200);
  });

  it('discards long signs and interrupted fragments, requiring hands out before another attempt', () => {
    const segmenter = capture();
    for (let t = 0; t <= 5000; t += 100) segmenter.accept(frame(t));
    expect(segmenter.accept(frame(5100)).kind).toBe('too-long');
    expect(segmenter.finish().kind).toBe('idle');
    segmenter.reset(); segmenter.accept(frame(0));
    expect(segmenter.accept(frame(1000)).kind).toBe('interrupted');
    for (let t = 1100; t <= 2000; t += 100) expect(segmenter.accept(frame(t)).kind).toBe('idle');
    expect(segmenter.finish().kind).toBe('idle');
  });

  it('does not join clips across missing body anchors or a clock reset', () => {
    const segmenter = capture();
    for (let t = 0; t <= 800; t += 100) segmenter.accept(frame(t));
    for (let t = 900; t <= 1200; t += 100) segmenter.accept({ ...frame(t), pose: [] });
    expect(segmenter.accept({ ...frame(1300), pose: [] }).kind).toBe('interrupted');
    expect(segmenter.finish().kind).toBe('idle');
    segmenter.reset(); segmenter.accept(frame(1000));
    expect(segmenter.accept(frame(900)).kind).toBe('interrupted');
  });
}); 

