const TARGET_AREA = 640 * 480;
const TARGET_ASPECT = 4 / 3;

/** Pick a camera-supported size close to VGA, which is ample for the 64px model input. */
export function chooseRecognitionPictureSize(sizes: readonly string[]): string | null {
  const parsed = sizes.flatMap((size) => {
    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) return [];
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return [];
    const area = width * height;
    const aspect = width / height;
    const score = Math.abs(Math.log(area / TARGET_AREA)) + Math.abs(aspect - TARGET_ASPECT) * 0.5;
    return [{ size, score }];
  });

  parsed.sort((left, right) => left.score - right.score);
  return parsed[0]?.size ?? null;
} 

