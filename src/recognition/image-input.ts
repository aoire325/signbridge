import { toByteArray } from 'base64-js';
import type { PictureRef } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

const INPUT_SIZE = 64;
const INPUT_SCALE = 0.0038908112328499556;
const INPUT_ZERO_POINT = -128;
const PREVIEW_MAX_EDGE = 256;

/** Crops the camera's center square and converts it to the model's int8 grayscale tensor. */
export async function createAslModelInput(
  picture: PictureRef,
): Promise<ArrayBuffer> {
  const downscale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(picture.width, picture.height));
  const scaledWidth = Math.max(1, Math.round(picture.width * downscale));
  const scaledHeight = Math.max(1, Math.round(picture.height * downscale));
  const cropSize = Math.min(scaledWidth, scaledHeight);
  const originX = Math.floor((scaledWidth - cropSize) / 2);
  const originY = Math.floor((scaledHeight - cropSize) / 2);
  const context = ImageManipulator.manipulate(picture, {
    maxWidth: PREVIEW_MAX_EDGE,
    maxHeight: PREVIEW_MAX_EDGE,
  });
  let image: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  let resizedUri: string | null = null;

  try {
    context
      .resize({ width: scaledWidth, height: scaledHeight })
      .crop({ originX, originY, width: cropSize, height: cropSize })
      .resize({ width: INPUT_SIZE, height: INPUT_SIZE });
    image = await context.renderAsync();
    const saved = await image.saveAsync({
      base64: true,
      compress: 0.95,
      format: SaveFormat.JPEG,
    });
    resizedUri = saved.uri;
    if (!saved.base64) throw new Error('The cropped camera image could not be read.');

    const decoded = jpeg.decode(toByteArray(saved.base64), {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 0.02,
      maxMemoryUsageInMB: 1,
    });
    if (decoded.width !== INPUT_SIZE || decoded.height !== INPUT_SIZE) {
      throw new Error('The camera image did not match the model input size.');
    }

    const input = new Int8Array(INPUT_SIZE * INPUT_SIZE);
    for (let pixel = 0; pixel < input.length; pixel += 1) {
      const source = pixel * 4;
      const gray = 0.299 * decoded.data[source]! + 0.587 * decoded.data[source + 1]! + 0.114 * decoded.data[source + 2]!;
      const quantized = Math.round((gray / 255) / INPUT_SCALE) + INPUT_ZERO_POINT;
      input[pixel] = Math.max(-128, Math.min(127, quantized));
    }
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  } finally {
    context.release();
    image?.release();
    if (resizedUri) removeTemporaryImage(resizedUri);
  }
}

/** Make a second view of the same camera crop for left/right hand orientation tolerance. */
export function mirrorModelInput(inputBuffer: ArrayBuffer): ArrayBuffer {
  const input = new Int8Array(inputBuffer);
  const mirrored = new Int8Array(INPUT_SIZE * INPUT_SIZE);
  for (let y = 0; y < INPUT_SIZE; y += 1) {
    const rowStart = y * INPUT_SIZE;
    for (let x = 0; x < INPUT_SIZE; x += 1) {
      mirrored[rowStart + x] = input[rowStart + INPUT_SIZE - 1 - x]!;
    }
  }
  return mirrored.buffer;
}

/** The camera writes captures to its temporary cache; remove each frame after inference. */
export function removeTemporaryImage(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // The operating system may already have cleared a cache file.
  }
}

export function decodeQuantizedProbabilities(outputBuffer: ArrayBuffer): readonly number[] {
  const quantized = new Int8Array(outputBuffer);
  return Array.from(quantized, (value) => Math.max(0, Math.min(1, (value + 128) / 256)));
} 

