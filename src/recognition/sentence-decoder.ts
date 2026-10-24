import pieces from '../../assets/models/asl_sentence_tokens.json';
import { SENTENCE_FRAMES, SENTENCE_TOKENS, type SentenceInput } from './sentence-input';

export type LocalTensor = { name: string; shape: number[]; dataType: string };
export type LocalModel = { inputs: readonly LocalTensor[]; run: (inputs: ArrayBuffer[]) => Promise<ArrayBuffer[]> };
export type SentenceModels = { encoder: LocalModel; decoder: LocalModel };

function inputs(model: LocalModel, values: Record<string, Float32Array | Int32Array>) {
  return model.inputs.map((tensor) => {
    const key = tensor.name.split(':')[0].split('/').pop()!;
    const value = values[key];
    if (!value || tensor.shape.reduce((a, b) => a * b, 1) !== value.length
      || tensor.dataType !== (value instanceof Int32Array ? 'int32' : 'float32')) {
      throw new Error(`Sentence model input is incompatible: ${key}.`);
    }
    return value.buffer as ArrayBuffer;
  });
}

export function sentenceTokensToText(tokens: readonly number[]) {
  if (tokens.some((id) => id < 3 || id >= 32000 || !Number.isInteger(id))) {
    throw new Error('The sentence model produced an unsupported text token.');
  }
  const text = tokens.map((id) => pieces[id]).join('').replaceAll('▁', ' ').trim();
  if (!text || !/[A-Za-z]/.test(text)) throw new Error('No clear sentence was translated. Please try again.');
  return text;
}

/** Greedy decoding with the checkpoint's no-repeat-trigram setting. No grammar templates or word substitution. */
export function chooseSentenceToken(logits: Float32Array, previous: readonly number[]) {
  if (logits.length !== 32128 || !logits.every(Number.isFinite)) throw new Error('The sentence model returned invalid scores.');
  const banned = new Set([0, 2]);
  for (let id = 32000; id < logits.length; id++) banned.add(id);
  if (previous.length >= 2) {
    for (let i = 0; i < previous.length - 2; i++) {
      if (previous[i] === previous[previous.length - 2] && previous[i + 1] === previous[previous.length - 1]) banned.add(previous[i + 2]);
    }
  }
  let best = -1;
  for (let i = 0; i < logits.length; i++) if (!banned.has(i) && (best < 0 || logits[i] > logits[best])) best = i;
  if (best < 0) throw new Error('No valid sentence continuation.');
  const max = Math.max(...logits);
  const total = logits.reduce((sum, v) => sum + Math.exp(v - max), 0);
  return { token: best, logProbability: logits[best] - max - Math.log(total) };
}

/** Whole-sequence pose encoder → trained autoregressive English decoder, entirely through local models. */
export async function translateSentence(models: SentenceModels, input: SentenceInput,
  isCurrent: () => boolean, onProgress: (tokens: number) => void): Promise<string> {
  const check = () => { if (!isCurrent()) throw new Error('Sentence translation cancelled.'); };
  check();
  const encoded = await models.encoder.run(inputs(models.encoder, input));
  check();
  if (!encoded[0] || encoded[0].byteLength !== SENTENCE_FRAMES * 768 * 4) throw new Error('Sentence encoder returned invalid features.');
  const hidden = new Float32Array(encoded[0]);
  if (!hidden.every(Number.isFinite)) throw new Error('Sentence encoder returned invalid coordinates.');
  const tokens = new Int32Array(SENTENCE_TOKENS); // decoder start token = 0
  const generated: number[] = [];
  let logProbability = 0;
  for (let position = 0; position < SENTENCE_TOKENS - 1; position++) {
    check();
    const result = await models.decoder.run(inputs(models.decoder, {
      hidden, mask: input.mask, tokens, position: new Int32Array([position]),
    }));
    check();
    if (!result[0]) throw new Error('Sentence decoder returned no result.');
    const next = chooseSentenceToken(new Float32Array(result[0]), generated);
    if (next.token === 1) {
      if (!generated.length || (logProbability + next.logProbability) / (generated.length + 1) < -3.5) throw new Error('The sentence translation was uncertain. Record it again more clearly.');
      return sentenceTokensToText(generated);
    }
    generated.push(next.token);
    logProbability += next.logProbability;
    tokens[position + 1] = next.token;
    onProgress(generated.length);
  }
  throw new Error('The sentence was too long to finish translating. Try a shorter sentence.');
} 

