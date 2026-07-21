/**
 * Geometry shared by the authored scroll handoff, the live transition layer,
 * and the reader parchment. Keeping these calculations DOM-free makes the
 * final alignment deterministic at every viewport shape.
 */

const DEFAULT_PARCHMENT_SCALE = 1.2;
const DEFAULT_SOURCE_Y_OFFSET_RATIO = 1640 / 3840;
const DEFAULT_READER_TEXTURE_MIN_WIDTH = 1000;

const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finiteOr(value, 0)));

/**
 * @param {{
 *   viewportWidth: number,
 *   viewportHeight: number,
 *   viewportLeft?: number,
 *   viewportTop?: number,
 *   parchmentScale?: number,
 *   sourceYOffsetRatio?: number,
 * }} options
 * @returns {{ width: number, left: number, top: number }}
 */
export function handoffTextureGeometry({
  viewportWidth,
  viewportHeight,
  viewportLeft = 0,
  viewportTop = 0,
  parchmentScale = DEFAULT_PARCHMENT_SCALE,
  sourceYOffsetRatio = DEFAULT_SOURCE_Y_OFFSET_RATIO,
}) {
  const safeWidth = Math.max(1, finiteOr(viewportWidth, 1));
  const safeHeight = Math.max(1, finiteOr(viewportHeight, 1));
  const coverWidth = Math.max(safeWidth, safeHeight * (9 / 16));
  const coverHeight = coverWidth * (16 / 9);
  const coverCropY = Math.max(0, (coverHeight - safeHeight) / 2);
  const scale = Math.max(0.01, finiteOr(parchmentScale, DEFAULT_PARCHMENT_SCALE));
  const sourceOffset = coverHeight
    * finiteOr(sourceYOffsetRatio, DEFAULT_SOURCE_Y_OFFSET_RATIO);

  return {
    width: coverWidth * scale,
    left: finiteOr(viewportLeft, 0) + (safeWidth - coverWidth * scale) / 2,
    top: finiteOr(viewportTop, 0) - (sourceOffset + coverCropY),
  };
}

/**
 * @param {{ surfaceWidth: number, surfaceTop: number, minimumWidth?: number }} options
 * @returns {{ width: number, left: number, top: number }}
 */
export function destinationTextureGeometry({
  surfaceWidth,
  surfaceTop,
  minimumWidth = DEFAULT_READER_TEXTURE_MIN_WIDTH,
}) {
  return {
    width: Math.max(
      1,
      finiteOr(surfaceWidth, 1),
      finiteOr(minimumWidth, DEFAULT_READER_TEXTURE_MIN_WIDTH),
    ),
    left: 0,
    top: finiteOr(surfaceTop, 0),
  };
}

/**
 * @param {{ width: number, left: number, top: number }} start
 * @param {{ width: number, left: number, top: number }} end
 * @param {number} progress
 * @returns {{ width: number, left: number, top: number }}
 */
export function interpolateTextureGeometry(start, end, progress) {
  const linear = clamp01(progress);
  const eased = linear * linear * (3 - 2 * linear);
  return {
    width: start.width + (end.width - start.width) * eased,
    left: start.left + (end.left - start.left) * eased,
    top: start.top + (end.top - start.top) * eased,
  };
}
