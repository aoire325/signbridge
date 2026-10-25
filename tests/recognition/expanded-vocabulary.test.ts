import { CITIZEN_LABELS, WLASL_LABELS, SUPPORTED_WORD_LABELS, citizenWord, wordKey, decodeExpandedWord, expandedWordSuggestions } from '../../src/recognition/expanded-vocabulary';

const scores = (labels: readonly string[], word?: string) => {
  const values = new Float32Array(labels.length).fill(word ? -20 : 0);
  if (word) values[labels.indexOf(word)] = 20;
  return values;
};

describe('trained expanded vocabulary and conservative model agreement', () => {
  it('has 2,917 distinct entries, not padded aliases or duplicate variants', () => {
    expect(CITIZEN_LABELS).toHaveLength(2731);
    expect(WLASL_LABELS).toHaveLength(2000);
    expect(SUPPORTED_WORD_LABELS).toHaveLength(2917);
    expect(new Set(SUPPORTED_WORD_LABELS.map(wordKey)).size).toBe(2917);
    for (const word of ['HELLO', 'PLEASE', 'WATER', 'HELP']) expect(SUPPORTED_WORD_LABELS).toContain(word);
    expect(SUPPORTED_WORD_LABELS).not.toContain('ABOUT1');
    expect(citizenWord('ABOUT2')).toBe(wordKey('about'));
    expect(citizenWord('1DOLLAR')).toBe('1DOLLAR');
  });

  it('accepts strong agreement, rejects contradictory shared words and all-flat scores', () => {
    expect(decodeExpandedWord(scores(CITIZEN_LABELS, 'HELLO'), scores(WLASL_LABELS, 'hello'))?.label).toBe('HELLO');
    expect(decodeExpandedWord(scores(CITIZEN_LABELS, 'HELLO'), scores(WLASL_LABELS, 'water'))).toBeNull();
    expect(decodeExpandedWord(scores(CITIZEN_LABELS), scores(WLASL_LABELS))).toBeNull();
    // A confident shared word must not override a different top prediction.
    const weak = scores(WLASL_LABELS); weak[WLASL_LABELS.indexOf('water')] = 0.1;
    expect(decodeExpandedWord(scores(CITIZEN_LABELS, 'HELLO'), weak)).toBeNull();
  });

  it('keeps legitimate model-exclusive words available without requiring impossible agreement', () => {
    const citizenKeys = new Set(CITIZEN_LABELS.map(citizenWord));
    const wlaslKeys = new Set(WLASL_LABELS.map(wordKey));
    const citizenOnly = CITIZEN_LABELS.find((label) => !wlaslKeys.has(citizenWord(label)))!;
    const wlaslOnly = WLASL_LABELS.find((label) => !citizenKeys.has(wordKey(label)))!;
    expect(wordKey(decodeExpandedWord(scores(CITIZEN_LABELS, citizenOnly), scores(WLASL_LABELS))!.label)).toBe(citizenWord(citizenOnly));
    expect(decodeExpandedWord(scores(CITIZEN_LABELS), scores(WLASL_LABELS, wlaslOnly))?.label).toBe(wlaslOnly.toUpperCase());
  });

  it('pools variants inside one model without combining scores from different models', () => {
    const citizen = new Float32Array(2731).fill(-20);
    citizen[CITIZEN_LABELS.indexOf('ABOUT1')] = Math.log(0.4);
    citizen[CITIZEN_LABELS.indexOf('ABOUT2')] = Math.log(0.4);
    citizen[CITIZEN_LABELS.indexOf('WATER')] = Math.log(0.2);
    const wlasl = scores(WLASL_LABELS); wlasl[WLASL_LABELS.indexOf('about')] = 0.1;
    expect(decodeExpandedWord(citizen, wlasl)?.label).toBe('ABOUT');
    expect(decodeExpandedWord(citizen, wlasl)?.confidence).toBeCloseTo(0.8);
    const choices = expandedWordSuggestions(citizen, wlasl, citizen);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map(wordKey)).size).toBe(3);
    expect(choices[0]).toBe('ABOUT');
    expect(choices).not.toContain('ABOUT1');
    expect(choices).not.toContain('ABOUT2');
    const invalid = scores(CITIZEN_LABELS); invalid[0] = NaN;
    expect(() => decodeExpandedWord(invalid, wlasl)).toThrow(/invalid/i);
    expect(() => decodeExpandedWord(new Float32Array(1000), wlasl)).toThrow(/invalid/i);
  });

  it('offers bounded unconfirmed alternatives for review while keeping ambiguous text out of the transcript', () => {
    const a = scores(CITIZEN_LABELS, 'HELLO'); const b = scores(WLASL_LABELS, 'water');
    expect(decodeExpandedWord(a, b)).toBeNull();
    expect(expandedWordSuggestions(a, b)).toEqual(['HELLO']);
    expect(expandedWordSuggestions(scores(CITIZEN_LABELS), scores(WLASL_LABELS))).toEqual([]);
  });

  it('preserves three trained MediaPipe alternatives and keeps WLASL-exclusive words reachable', () => {
    const a = new Float32Array(CITIZEN_LABELS.length).fill(-20);
    for (const [label, value] of [['HELLO', 4], ['WATER', 3], ['FRIEND', 2]] as const) a[CITIZEN_LABELS.indexOf(label)] = value;
    expect(expandedWordSuggestions(a, scores(WLASL_LABELS, 'water'))).toEqual(['HELLO', 'WATER', 'FRIEND']);
    const citizenKeys = new Set(CITIZEN_LABELS.map(citizenWord));
    const exclusive = WLASL_LABELS.find((label) => !citizenKeys.has(wordKey(label)))!;
    expect(expandedWordSuggestions(a, scores(WLASL_LABELS, exclusive)))
      .toEqual(['HELLO', 'WATER', exclusive.toUpperCase()]);
  });
});

describe('two-pass recognition checks', () => {
  const { combineCitizenViews } = jest.requireActual('../../src/recognition/expanded-vocabulary');
  it('averages probabilities equally despite very different logit scales', () => {
    const a = scores(CITIZEN_LABELS, 'HELLO');
    const b = scores(CITIZEN_LABELS, 'WATER');
    b[CITIZEN_LABELS.indexOf('WATER')] = 200;
    const combined = combineCitizenViews(a, b);
    expect(combined[CITIZEN_LABELS.indexOf('HELLO')]).toBeCloseTo(Math.log(0.5));
    expect(combined[CITIZEN_LABELS.indexOf('WATER')]).toBeCloseTo(Math.log(0.5));
    expect(combined.every(Number.isFinite)).toBe(true);
    expect(() => combineCitizenViews(a, new Float32Array(2))).toThrow(/invalid/i);
  });
  it('ranks three distinct alternatives even when anatomical views disagree', () => {
    const view = (words: string[]) => {
      const logits = new Float32Array(CITIZEN_LABELS.length).fill(-20);
      words.forEach((word, i) => { logits[CITIZEN_LABELS.indexOf(word)] = 6 - i; });
      return logits;
    };
    const a = view(['LAMP', 'FOREST', 'SUNBATHE']);
    const b = view(['HELLO', 'BYE', 'MOTHER']);
    const result = expandedWordSuggestions(a, scores(WLASL_LABELS, 'hello'), b);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
    expect(result).toContain('HELLO');
    expect(expandedWordSuggestions(scores(CITIZEN_LABELS, 'HELLO'), scores(WLASL_LABELS, 'water'), scores(CITIZEN_LABELS, 'HELLO'))).toHaveLength(3);
  });
  it('fills all three ranked choices when an exclusive WLASL guess is rejected', () => {
    const view = (first: string) => {
      const logits = new Float32Array(CITIZEN_LABELS.length).fill(-20);
      for (const [word, probability] of [[first, 0.7], ['WATER', 0.2], ['FRIEND', 0.1]] as const) {
        logits[CITIZEN_LABELS.indexOf(word)] = Math.log(probability);
      }
      return logits;
    };
    const citizenKeys = new Set(CITIZEN_LABELS.map(citizenWord));
    const exclusive = WLASL_LABELS.find((label) => !citizenKeys.has(wordKey(label)))!;
    const weak = scores(WLASL_LABELS); weak[WLASL_LABELS.indexOf(exclusive)] = 0.1;
    const a = view('HELLO'); const b = view('HELP');
    expect(expandedWordSuggestions(a, weak, b)).toEqual(['HELLO', 'HELP', 'WATER']);
    expect(expandedWordSuggestions(a, scores(WLASL_LABELS, exclusive), b)).toEqual(['HELLO', 'HELP', exclusive.toUpperCase()]);
    // Historical single-pass reports retain their original slot selection.
    expect(expandedWordSuggestions(a, weak)).toEqual(['HELLO', 'WATER']);
  });
  it('keeps three ranked choices even when lower matches have weak scores', () => {
    const a = new Float32Array(CITIZEN_LABELS.length).fill(-20);
    for (const [label, probability] of [['HELLO', 0.6], ['WATER', 0.3], ['FRIEND', 0.1]] as const) {
      a[CITIZEN_LABELS.indexOf(label)] = Math.log(probability);
    }
    const citizenKeys = new Set(CITIZEN_LABELS.map(citizenWord));
    const exclusive = WLASL_LABELS.find((label) => !citizenKeys.has(wordKey(label)))!;
    const weak = scores(WLASL_LABELS); weak[WLASL_LABELS.indexOf(exclusive)] = 0.1;
    expect(expandedWordSuggestions(a, weak, a)).toEqual(['HELLO', 'WATER', 'FRIEND']);
    expect(expandedWordSuggestions(a, scores(WLASL_LABELS, exclusive), a)).toEqual(['HELLO', 'WATER', exclusive.toUpperCase()]);
    a[CITIZEN_LABELS.indexOf('HELLO')] = Math.log(0.94);
    a[CITIZEN_LABELS.indexOf('WATER')] = Math.log(0.04);
    a[CITIZEN_LABELS.indexOf('FRIEND')] = Math.log(0.02);
    expect(expandedWordSuggestions(a, weak, a)).toEqual(['HELLO', 'WATER', 'FRIEND']);
  });
  it.each(['BED', 'LAMP', 'EMAIL', 'NUT', 'BOW', 'FOREST', 'MATURE'])('does not hard-code a correction for %s', (label) => {
      const trained = CITIZEN_LABELS.find((word) => citizenWord(word) === label);
      if (trained) {
        const strong = scores(CITIZEN_LABELS, trained);
        expect(expandedWordSuggestions(strong, scores(WLASL_LABELS), strong)).toContain(label);
      } else {
        const fallback = WLASL_LABELS.find((word) => wordKey(word) === label);
        expect(fallback).toBeDefined();
        const weak = scores(CITIZEN_LABELS);
        expect(expandedWordSuggestions(weak, scores(WLASL_LABELS, fallback), weak)).toContain(label);
      }
  });
}); 

