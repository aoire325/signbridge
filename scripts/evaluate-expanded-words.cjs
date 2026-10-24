// Replays public held-out pose fixtures through the actual mobile TypeScript
// preprocessing/decision code and local TFLite models. Not a camera benchmark.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(source, filename);
};
const root = path.resolve(__dirname, '..');
const data = path.resolve(process.argv[2]);
const { WordSegmenter } = require('../src/recognition/asl-word-recognition.ts');
const { ContextWordSegmenter } = require('../src/recognition/context-word-segmenter.ts');
const { hasExpandedContext, packExpandedWordLandmarks, createExpandedWordInputs } = require('../src/recognition/expanded-word-input.ts');
const { CITIZEN_LABELS, WLASL_LABELS, citizenWord, wordKey, decodeExpandedWord, expandedWordSuggestions, combineCitizenViews } = require('../src/recognition/expanded-vocabulary.ts');
const STANDARD_LABELS = require('../assets/models/asl_1000_labels.json');
const legacy = process.argv.includes('--legacy-trim');
const singleView = process.argv.includes('--single-view');
const intervalArg = process.argv.indexOf('--interval-ms');
const interval = intervalArg >= 0 ? Number(process.argv[intervalArg + 1]) : 33;
if (!Number.isFinite(interval) || interval < 0 || interval > 200) throw new Error('Use a frame interval from 0 to 200 ms');
const heldout = JSON.parse(fs.readFileSync(path.join(data, 'heldout.json'), 'utf8'));
const records = heldout.records.map((record, index) => {
  const Capture = legacy ? WordSegmenter : ContextWordSegmenter;
  const segmenter = new Capture(packExpandedWordLandmarks, hasExpandedContext);
  let last = -100;
  let segment;
  for (const frame of record.frames) {
    if (frame.timestampMs - last < interval) continue;
    last = frame.timestampMs;
    const result = segmenter.accept(frame);
    if (result.kind === 'complete') { segment = result; break; }
  }
  segment ??= segmenter.finish();
  if (process.argv.includes('--full-frames')) segment = { kind: 'complete', samples: record.frames.map((frame) => ({
    timestampMs: frame.timestampMs, landmarks: packExpandedWordLandmarks(frame),
  })) };
  let captured = segment.kind === 'complete';
  if (captured) {
    try {
      const inputs = createExpandedWordInputs(segment.samples);
      for (const key of ['citizen', 'citizenMirrored', 'wlasl']) fs.writeFileSync(path.join(data, `${index}.${key}.input.f32`), Buffer.from(inputs[key].buffer));
    } catch { captured = false; }
  }
  return { index, gloss: record.gloss, captured,
    sampleCount: segment.samples?.length ?? 0,
    durationMs: segment.samples?.length ? segment.samples.at(-1).timestampMs - segment.samples[0].timestampMs : 0 };
});
fs.writeFileSync(path.join(data, 'index.json'), JSON.stringify(records));
const run = spawnSync(process.env.SIGNBRIDGE_EVAL_PYTHON || 'python3', [path.join(__dirname, 'run-word-evaluation.py'), '--root', root, '--data', data], {
  stdio: 'inherit', env: { ...process.env, MPLCONFIGDIR: path.join(data, 'mpl-cache'), XDG_CACHE_HOME: path.join(data, 'cache') },
});
if (run.status !== 0) process.exit(run.status || 1);
const read = (filename) => {
  const buffer = fs.readFileSync(filename);
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
};
const top = (scores, labels) => labels[scores.indexOf(Math.max(...scores))];
const details = records.map((record) => {
  if (!record.captured) return { expected: record.gloss, prediction: null, reason: 'capture rejected' };
  const original = read(path.join(data, `${record.index}.citizen.output.f32`));
  const a = singleView ? original : combineCitizenViews(original, read(path.join(data, `${record.index}.citizenMirrored.output.f32`)));
  const b = read(path.join(data, `${record.index}.wlasl.output.f32`));
  const c = read(path.join(data, `${record.index}.standard.output.f32`));
  const prediction = decodeExpandedWord(a, b);
  return { expected: record.gloss, prediction: prediction?.label ?? null,
    correct: !!prediction && wordKey(prediction.label) === citizenWord(record.gloss),
    citizenTop: top(a, CITIZEN_LABELS), wlaslTop: top(b, WLASL_LABELS), standardTop: top(c, STANDARD_LABELS),
    suggestions: expandedWordSuggestions(original, b, singleView ? undefined : read(path.join(data, `${record.index}.citizenMirrored.output.f32`))),
    sampleCount: record.sampleCount, durationMs: record.durationMs };
});
const accepted = details.filter((r) => r.prediction);
const eligible = (labels) => details.filter((r) => labels.some((label) => wordKey(label) === citizenWord(r.expected)));
const summary = (rows, prediction, normalize = wordKey) => ({ examples: rows.length,
  correct: rows.filter((r) => r[prediction] && normalize(r[prediction]) === citizenWord(r.expected)).length });
const report = { corpus: 'Deterministic original-test-split examples among first 1,000 public batch_001 poses; common labels preferred',
  selection: heldout.selection,
  captureMode: process.argv.includes('--full-frames') ? 'full reference clips' : `${interval} ms minimum frame interval and ${legacy ? 'legacy trimmed' : 'context-preserving'} capture`,
  datasetRevision: heldout.datasetRevision, liveCameraBenchmark: false, examples: details.length,
  citizenViews: singleView ? 1 : 2,
  reviewRequired: true, automaticTranscriptWrites: 0,
  citizenTop1: summary(details, 'citizenTop', citizenWord),
  wlaslTop1WithinVocabulary: summary(eligible(WLASL_LABELS), 'wlaslTop'),
  standardTop1WithinVocabulary: summary(eligible(STANDARD_LABELS), 'standardTop'),
  suggestionRecall: { examples: details.length,
    correctInFirstThree: details.filter((r) => r.suggestions?.some((s) => wordKey(s) === citizenWord(r.expected))).length },
  heuristicProposals: accepted.length, correctHeuristicProposals: accepted.filter((r) => r.correct).length,
  incorrectHeuristicProposals: accepted.filter((r) => !r.correct).length, noHeuristicProposal: details.length - accepted.length,
  details };
fs.writeFileSync(path.join(data, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); 

