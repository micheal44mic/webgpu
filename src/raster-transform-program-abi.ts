/** Binding and vertex strides shared by Transform math, shaders, and programs. */

// The first 64 bytes retain the original affine ABI. The final 16-byte slot
// carries the document extent so programs are reusable across document sizes.
export const RASTER_TRANSFORM_UNIFORM_BYTES = 80;

// clip-space XY, source UV, and the perspective interpolation denominator.
export const RASTER_DEFORM_VERTEX_FLOATS = 5;
