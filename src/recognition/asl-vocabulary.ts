export const ASL_MODEL_LABELS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'nothing',
] as const;

export const DYNAMIC_ASL_LETTERS = ['J', 'Z'] as const;

/** Static fingerspelling labels supported by the bundled image classifier. */
export const STATIC_ASL_LETTERS = ASL_MODEL_LABELS.filter(
  (label): label is Exclude<(typeof ASL_MODEL_LABELS)[number], 'J' | 'Z' | 'nothing'> =>
    label !== 'J' && label !== 'Z' && label !== 'nothing',
);

export const ASL_MODEL_VERSION = '06d6824';
export const ASL_MODEL_NAME = 'Tiny ASL Alphabet CNN (int8)'; 

