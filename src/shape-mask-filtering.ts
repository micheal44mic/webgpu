/**
 * Builds the GPU sampling derivative of a logical Shape mask.
 *
 * The source mask is never mutated. Its complete 2048² frame is resampled
 * into a centered inner rectangle while the surrounding texels stay exactly
 * transparent. Hardware linear/trilinear filtering can therefore reconstruct
 * the authored edge against zero coverage instead of extending a non-zero
 * boundary texel across the stamp rectangle.
 */

export function resampleShapeMaskIntoTransparentGuard(
  source: Readonly<Uint8Array>,
  sourceSize: number,
  guardTexels: number,
): Uint8Array {
  if (!Number.isInteger(sourceSize) || sourceSize <= 0) {
    throw new RangeError("Shape mask size must be a positive integer.");
  }
  if (source.length !== sourceSize * sourceSize) {
    throw new RangeError("Shape mask byte length does not match its dimensions.");
  }
  if (
    !Number.isInteger(guardTexels)
    || guardTexels < 0
    || guardTexels * 2 >= sourceSize
  ) {
    throw new RangeError("Shape filtering guard does not fit inside the mask.");
  }

  if (guardTexels === 0) return Uint8Array.from(source);

  const contentSize = sourceSize - guardTexels * 2;
  const lower = new Uint16Array(contentSize);
  const upper = new Uint16Array(contentSize);
  const fraction = new Float32Array(contentSize);
  const sourcePerDestination = sourceSize / contentSize;

  for (let coordinate = 0; coordinate < contentSize; coordinate += 1) {
    const sourceCoordinate = Math.min(
      sourceSize - 1,
      Math.max(0, (coordinate + 0.5) * sourcePerDestination - 0.5),
    );
    const first = Math.floor(sourceCoordinate);
    lower[coordinate] = first;
    upper[coordinate] = Math.min(sourceSize - 1, first + 1);
    fraction[coordinate] = sourceCoordinate - first;
  }

  const protectedMask = new Uint8Array(source.length);
  for (let targetY = 0; targetY < contentSize; targetY += 1) {
    const sourceRow0 = lower[targetY] * sourceSize;
    const sourceRow1 = upper[targetY] * sourceSize;
    const verticalFraction = fraction[targetY];
    const targetRow = (targetY + guardTexels) * sourceSize + guardTexels;

    for (let targetX = 0; targetX < contentSize; targetX += 1) {
      const sourceX0 = lower[targetX];
      const sourceX1 = upper[targetX];
      const horizontalFraction = fraction[targetX];
      const topLeft = source[sourceRow0 + sourceX0];
      const top = topLeft
        + (source[sourceRow0 + sourceX1] - topLeft) * horizontalFraction;
      const bottomLeft = source[sourceRow1 + sourceX0];
      const bottom = bottomLeft
        + (source[sourceRow1 + sourceX1] - bottomLeft) * horizontalFraction;
      protectedMask[targetRow + targetX] = Math.round(
        top + (bottom - top) * verticalFraction,
      );
    }
  }

  return protectedMask;
}

export function downsampleShapeMask2x(
  source: Readonly<Uint8Array>,
  sourceSize: number,
): Uint8Array {
  if (!Number.isInteger(sourceSize) || sourceSize < 2 || sourceSize % 2 !== 0) {
    throw new RangeError("Shape mip source size must be a positive even integer.");
  }
  if (source.length !== sourceSize * sourceSize) {
    throw new RangeError("Shape mip byte length does not match its dimensions.");
  }

  const targetSize = sourceSize / 2;
  const target = new Uint8Array(targetSize * targetSize);
  for (let y = 0; y < targetSize; y += 1) {
    const sourceRow = y * 2 * sourceSize;
    const nextSourceRow = sourceRow + sourceSize;
    const targetRow = y * targetSize;
    for (let x = 0; x < targetSize; x += 1) {
      const sourceIndex = sourceRow + x * 2;
      target[targetRow + x] = Math.round(
        (
          source[sourceIndex]
          + source[sourceIndex + 1]
          + source[nextSourceRow + x * 2]
          + source[nextSourceRow + x * 2 + 1]
        ) / 4,
      );
    }
  }
  return target;
}
