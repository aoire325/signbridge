// Run the same feature classifier/evaluator as the app. No model download or upload.
// node scripts/evaluate-personal-words.cjs examples.json --signer me
// node scripts/evaluate-personal-words.cjs examples.json --baseline-only
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { BASELINE_VERSION, validDataset, trainPersonalRanker, evaluateExamples } = require('../src/recognition/recognition-examples.ts');
async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Provide an exported examples JSON file and --signer NAME (or --baseline-only).');
  if (fs.statSync(input).size > 20000000) throw new Error('Dataset exceeds the 20 MB limit.');
  const dataset = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!validDataset(dataset)) throw new Error('Invalid dataset or incompatible vocabulary/features.');
  const signerIndex = process.argv.indexOf('--signer');
  const baselineOnly = process.argv.includes('--baseline-only');
  if (!baselineOnly && (signerIndex < 0 || !process.argv[signerIndex + 1])) throw new Error('Specify --signer NAME or --baseline-only.');
  const ranker = baselineOnly ? null : await trainPersonalRanker(dataset, process.argv[signerIndex + 1]);
  const report = await evaluateExamples(dataset, ranker);
  process.stdout.write(JSON.stringify({ featureVersion: 1, vocabulary: 'common500-strict-v1', baselineVersion: BASELINE_VERSION, personalWords: ranker?.calibration ?? [], report,
    limitations: 'Personal sample benchmark only. Unknown gestures still receive three review-only baseline guesses. No population or 500-word accuracy claim.' }, null, 2) + '\n');
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
