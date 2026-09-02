/**
 * A compact, normalized Gaussian tip evaluated directly by the brush shader.
 * The logical radius is three standard deviations. Subtracting the value at
 * that radius makes the finite stamp meet zero continuously at its boundary,
 * avoiding a square-quad seam without storing a sampled mask texture.
 */
export const GAUSSIAN_TIP_EDGE_EXPONENT = 4.5;

export const gaussianBrushTipShader = /* wgsl */ `
const GAUSSIAN_TIP_FLAG: u32 = 4u;
const GAUSSIAN_TIP_EDGE_EXPONENT: f32 = ${GAUSSIAN_TIP_EDGE_EXPONENT};

fn normalizedGaussianTipCoverage(radiusSquared: f32) -> f32 {
  let edgeCoverage = exp(-GAUSSIAN_TIP_EDGE_EXPONENT);
  let rawCoverage = exp(
    -GAUSSIAN_TIP_EDGE_EXPONENT * max(radiusSquared, 0.0)
  );
  return clamp(
    (rawCoverage - edgeCoverage) / (1.0 - edgeCoverage),
    0.0,
    1.0
  );
}
`;

export function normalizedGaussianTipCoverage(radiusSquared: number): number {
  const boundedRadiusSquared = Math.max(0, Number.isFinite(radiusSquared)
    ? radiusSquared
    : 1);
  const edgeCoverage = Math.exp(-GAUSSIAN_TIP_EDGE_EXPONENT);
  const rawCoverage = Math.exp(
    -GAUSSIAN_TIP_EDGE_EXPONENT * boundedRadiusSquared,
  );
  return Math.max(
    0,
    Math.min(1, (rawCoverage - edgeCoverage) / (1 - edgeCoverage)),
  );
}
