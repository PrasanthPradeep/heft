import { requireOptionalNativeModule } from 'expo';

import {
  mergeRecognitions,
  parseWeightCandidatesFromRecognition,
  shiftRecognition,
  summarizeRecognition,
  type ImageSize,
  type RecognitionLike,
  type ScaleProfile,
  type WeightCandidate,
} from './parser';

export type OcrResult = {
  candidates: WeightCandidate[];
  rawText: string;
  /** Human-readable token/geometry dump for on-device troubleshooting. */
  debug: string;
};

type MlkitOcrModule = typeof import('expo-mlkit-ocr');
type ImageManipulatorModule = typeof import('expo-image-manipulator');

const NATIVE_MODULE_NAME = 'ExpoMlkitOcr';

/**
 * ML Kit's on-device text detector downscales anything larger than roughly
 * this many pixels on its long edge, which shrinks a scale's LCD digits until
 * they are unrecognizable. Every region we send is capped to this size, so the
 * detector always sees the display at full detail.
 */
const MAX_LONG_EDGE = 1600;

let cachedModule: MlkitOcrModule | null | undefined;

function loadOcrModule(): MlkitOcrModule | null {
  if (cachedModule !== undefined) return cachedModule;

  try {
    cachedModule = requireOptionalNativeModule(NATIVE_MODULE_NAME)
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('expo-mlkit-ocr') as MlkitOcrModule)
      : null;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

async function loadImageManipulator(): Promise<ImageManipulatorModule> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-image-manipulator') as ImageManipulatorModule;
}

type Region = { x: number; y: number; width: number; height: number };
type Pass = { uri: string; originX: number; originY: number; scale: number };

/**
 * Regions worth OCR-ing in a photo of a scale. The full frame is usually too
 * large (see MAX_LONG_EDGE) and too cluttered for the detector, so we also try
 * narrower horizontal bands and a centred square, where the LCD becomes many
 * times larger relative to the frame.
 */
function plannedRegions(width: number, height: number): Region[] {
  const regions: Region[] = [{ x: 0, y: 0, width, height }];

  const bandHeight = Math.round(height * 0.6);
  for (const fraction of [0, 0.2, 0.4]) {
    const y = Math.min(Math.round(height * fraction), height - bandHeight);
    regions.push({ x: 0, y: Math.max(0, y), width, height: bandHeight });
  }

  const square = Math.round(Math.min(width, height) * 0.7);
  regions.push({
    x: Math.max(0, Math.round((width - square) / 2)),
    y: Math.max(0, Math.round((height - square) / 2)),
    width: Math.min(square, width),
    height: Math.min(square, height),
  });

  return regions;
}

async function makePass(
  imageUri: string,
  region: Region
): Promise<Pass> {
  const { manipulateAsync, SaveFormat } = await loadImageManipulator();
  const { width, height } = region;
  const steps: Parameters<typeof manipulateAsync>[1] = [
    { crop: { originX: region.x, originY: region.y, width, height } },
  ];

  const scale = Math.max(1, Math.max(width, height) / MAX_LONG_EDGE);
  if (scale > 1) {
    steps.push({
      resize: {
        width: Math.max(1, Math.round(width / scale)),
        height: Math.max(1, Math.round(height / scale)),
      },
    });
  }

  const output = await manipulateAsync(imageUri, steps, {
    compress: 0.85,
    format: SaveFormat.JPEG,
  });

  return { uri: output.uri, originX: region.x, originY: region.y, scale };
}

/** Collects OCR for every planned region, remapped to full-image coordinates. */
async function recognizeAllRegions(
  imageUri: string,
  imageSize: ImageSize,
  module: MlkitOcrModule
): Promise<RecognitionLike[]> {
  const regions = plannedRegions(imageSize.width, imageSize.height);
  const results: RecognitionLike[] = [];

  for (const region of regions) {
    try {
      const pass = await makePass(imageUri, region);
      const raw = await module.recognizeText(pass.uri);
      results.push(
        shiftRecognition(raw, pass.originX, pass.originY, pass.scale)
      );
    } catch {
      // A single failed region must not abort the whole scan.
    }
  }

  return results;
}

/**
 * Thin adapter around the native OCR module so the rest of the app never
 * imports it directly. Swapping OCR providers only touches this file.
 *
 * The photo is broken into several capped-size regions (full frame, horizontal
 * bands, centred square), each OCR'd separately, then merged. This keeps the
 * LCD large enough for ML Kit to read it reliably, and all bounding boxes are
 * mapped back into one coordinate space for ranking.
 */
export async function recognizeWeight(
  imageUri: string,
  profile: ScaleProfile,
  imageSize?: ImageSize
): Promise<OcrResult> {
  const module = loadOcrModule();

  if (!module) {
    throw new Error(
      'On-device OCR is unavailable. Run the development build (not Expo Go) or enter the reading manually.'
    );
  }

  let size = imageSize;
  if (!size?.width || !size?.height) {
    const { manipulateAsync } = await loadImageManipulator();
    const meta = await manipulateAsync(imageUri);
    size = { width: meta.width, height: meta.height };
  }

  const merged = mergeRecognitions(
    await recognizeAllRegions(imageUri, size, module)
  );
  const rawText = merged.text ?? '';

  return {
    rawText,
    debug: summarizeRecognition(merged),
    candidates: parseWeightCandidatesFromRecognition(
      merged,
      profile,
      size
    ),
  };
}

/**
 * `false` when the device cannot run ML Kit (e.g. Expo Go, web, or an
 * unsupported OS). Callers should fall back to manual entry.
 */
export function isOcrSupported(): boolean {
  const module = loadOcrModule();
  if (!module) return false;

  try {
    return module.isSupported();
  } catch {
    return false;
  }
}
