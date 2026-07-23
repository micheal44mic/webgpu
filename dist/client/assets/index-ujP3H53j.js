(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=new Uint8Array([137,80,78,71,13,10,26,10]),r=13;function i(e,t){return String.fromCharCode(e[t],e[t+1],e[t+2],e[t+3])}function a(e,t,n){let r=e+t-n,i=Math.abs(r-e),a=Math.abs(r-t),o=Math.abs(r-n);return i<=a&&i<=o?e:a<=o?t:n}function o(e,t,n){let r=t+1,i=r*n;if(e.byteLength!==i)throw Error(`Dati PNG decompressi non validi: attesi ${i} byte, trovati ${e.byteLength}.`);let o=new Uint8Array(t*n);for(let i=0;i<n;i+=1){let n=i*r,s=i*t,c=e[n];if(c>4)throw Error(`Filtro PNG non supportato: ${c}.`);for(let r=0;r<t;r+=1){let l=e[n+1+r],u=r>0?o[s+r-1]:0,d=i>0?o[s-t+r]:0,f=r>0&&i>0?o[s-t+r-1]:0,p=0;c===1?p=u:c===2?p=d:c===3?p=Math.floor((u+d)*.5):c===4&&(p=a(u,d,f)),o[s+r]=l+p&255}}return o}async function s(e){let t=new Uint8Array(e);if(t.byteLength<n.byteLength+12)throw Error(`PNG troppo corta.`);for(let e=0;e<n.byteLength;e+=1)if(t[e]!==n[e])throw Error(`Firma PNG non valida.`);let a=new DataView(e),s=[],c=0,l=0,u=0,d=!1,f=!1,p=n.byteLength;for(;p+12<=t.byteLength;){let e=a.getUint32(p,!1),n=p+4,o=p+8,m=o+e,h=m+4;if(m<o||h>t.byteLength)throw Error(`Chunk PNG oltre la fine del file.`);let g=i(t,n);if(g===`IHDR`){if(d||e!==r)throw Error(`Header PNG non valido.`);l=a.getUint32(o,!1),u=a.getUint32(o+4,!1);let n=t[o+8],i=t[o+9],s=t[o+10],c=t[o+11],f=t[o+12];if(l<=0||u<=0)throw Error(`Dimensioni PNG non valide.`);if(n!==8||i!==0||s!==0||c!==0||f!==0)throw Error(`La Shape richiede una PNG grayscale 8-bit, non interlacciata e con compressione standard.`);d=!0}else if(g===`IDAT`){if(!d||f)throw Error(`Ordine dei chunk PNG non valido.`);let e=t.slice(o,m);s.push(e),c+=e.byteLength}else if(g===`IEND`){f=!0;break}p=h}if(!d||!f||s.length===0)throw Error(`PNG incompleta.`);let m=new Uint8Array(c),h=0;for(let e of s)m.set(e,h),h+=e.byteLength;if(typeof DecompressionStream>`u`)throw Error(`DecompressionStream non disponibile.`);let g=new Blob([m]).stream().pipeThrough(new DecompressionStream(`deflate`)),_=new Uint8Array(await new Response(g).arrayBuffer());return{width:l,height:u,pixels:o(_,l,u)}}var c=`
const MAX_COUNT: u32 = 24u;
const TAU: f32 = 6.283185307179586;
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
};

struct Stamp {
  center: vec2<f32>,
  radius: f32,
  pressure: f32,
  seed: u32,
  _pad0: u32,
  direction: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pressure: f32,
  @location(2) @interpolate(flat) pointColor: vec3<f32>,
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(2) var shapeMaskTexture: texture_2d<f32>;
@group(0) @binding(3) var shapeMaskSampler: sampler;
@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;

fn hash32(value: u32) -> u32 {
  var x = value;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn random01(seed: u32, salt: u32) -> f32 {
  let bits = hash32(seed ^ (salt * 0x9e3779b9u)) & 0x00ffffffu;
  return f32(bits) / 16777216.0;
}

fn hueToRgb(p: f32, q: f32, inputT: f32) -> f32 {
  let t = fract(inputT);
  if (t < 1.0 / 6.0) {
    return p + (q - p) * 6.0 * t;
  }
  if (t < 1.0 / 2.0) {
    return q;
  }
  if (t < 2.0 / 3.0) {
    return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  }
  return p;
}

fn hslToSrgb(hsl: vec3<f32>) -> vec3<f32> {
  let h = fract(hsl.x);
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);

  if (s <= 0.00001) {
    return vec3<f32>(l);
  }

  let q = select(l * (1.0 + s), l + s - l * s, l >= 0.5);
  let p = 2.0 * l - q;
  return vec3<f32>(
    hueToRgb(p, q, h + 1.0 / 3.0),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1.0 / 3.0)
  );
}

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn jitteredLinearColorFromCopySeed(copySeed: u32) -> vec3<f32> {
  let hueDelta = (random01(copySeed, 1u) - 0.5) * 2.0 * brush.jitter.x;
  let saturationDelta = (random01(copySeed, 2u) - 0.5) * 2.0 * brush.jitter.y;
  let lightnessDelta = (random01(copySeed, 3u) - 0.5) * 2.0 * brush.jitter.z;
  let darkness = random01(copySeed, 4u) * brush.jitter.w;

  let hue = fract(brush.baseHslAlpha.x + hueDelta);
  let saturation = clamp(brush.baseHslAlpha.y + saturationDelta, 0.0, 1.0);
  let lightnessBeforeDarkness = clamp(brush.baseHslAlpha.z + lightnessDelta, 0.0, 1.0);
  let lightness = clamp(lightnessBeforeDarkness * (1.0 - darkness), 0.0, 1.0);

  return srgbToLinear(hslToSrgb(vec3<f32>(hue, saturation, lightness)));
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let copyCount = max(1u, min(brush.options.x, MAX_COUNT));
  let stampIndex = instanceIndex / copyCount;
  let copyIndex = instanceIndex % copyCount;
  let stamp = stamps[stampIndex];
  let localPosition = corners[vertexIndex];
  let directionLength = length(stamp.direction);
  let direction = select(vec2<f32>(1.0, 0.0), stamp.direction / directionLength, directionLength > 0.0001);
  let copySeed = hash32(stamp.seed ^ (copyIndex * 0x85ebca6bu));
  let linearOffset = (random01(copySeed, 5u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.x;
  let lateralOffset = (random01(copySeed, 6u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.y;
  let jitteredCenter = stamp.center
    + direction * linearOffset
    + vec2<f32>(-direction.y, direction.x) * lateralOffset;
  let layerPosition = jitteredCenter + localPosition * stamp.radius;
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.pressure = stamp.pressure;
  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  output.pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);
  return output;
}

@vertex
fn shapeVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let copyCount = max(1u, min(brush.options.x, MAX_COUNT));
  let stampIndex = instanceIndex / copyCount;
  let copyIndex = instanceIndex % copyCount;
  let stamp = stamps[stampIndex];
  let localPosition = corners[vertexIndex];
  let directionLength = length(stamp.direction);
  let direction = select(vec2<f32>(1.0, 0.0), stamp.direction / directionLength, directionLength > 0.0001);
  let copySeed = hash32(stamp.seed ^ (copyIndex * 0x85ebca6bu));
  let linearOffset = (random01(copySeed, 5u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.x;
  let lateralOffset = (random01(copySeed, 6u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.y;
  let jitteredCenter = stamp.center
    + direction * linearOffset
    + vec2<f32>(-direction.y, direction.x) * lateralOffset;

  var geometryPosition = localPosition;
  let scatter = clamp(brush.positionJitter.z, 0.0, 1.0);
  if (scatter > 0.00001) {
    let angle = (random01(copySeed, 7u) - 0.5) * TAU * scatter;
    let cosine = cos(angle);
    let sine = sin(angle);
    geometryPosition = vec2<f32>(
      localPosition.x * cosine - localPosition.y * sine,
      localPosition.x * sine + localPosition.y * cosine
    );
  }

  let layerPosition = jitteredCenter + geometryPosition * stamp.radius;
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.pressure = stamp.pressure;
  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  output.pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);
  return output;
}

fn paintAlpha(input: VertexOutput, coverage: f32) -> f32 {
  let pressureInfluence = clamp(brush.controls.w, 0.0, 1.0);
  let pressureAlpha = mix(1.0, clamp(input.pressure, 0.0, 1.0), pressureInfluence);
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );
}

fn premultipliedPaint(input: VertexOutput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(input.pointColor * alpha, alpha);
}

fn quantizedCoveragePaint(input: VertexOutput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  // M1 Glaze accumulates an R8 coverage mask with MAX. Repeating the exact
  // quantized value in RGBA lets the existing temporary RGBA attachment keep
  // its display mip chain while preserving the same coverage semantics.
  let quantized = unpack4x8unorm(pack4x8unorm(vec4<f32>(alpha))).r;
  return vec4<f32>(quantized);
}

fn circleCoverage(input: VertexOutput) -> f32 {
  let radiusSquared = dot(input.localPosition, input.localPosition);
  let antialiasWidth = max(fwidth(radiusSquared), 0.00001);

  if (radiusSquared > 1.0 + antialiasWidth) {
    discard;
  }

  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let innerEdge = min(hardness * hardness, 1.0 - antialiasWidth);
  let coverage = 1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

fn shapeCoverage(input: VertexOutput) -> f32 {
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let sourceCoverage = textureSample(shapeMaskTexture, shapeMaskSampler, uv).r;
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, circleCoverage(input));
}

@fragment
fn coverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, circleCoverage(input));
}

@fragment
fn shapeFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, shapeCoverage(input));
}

@fragment
fn shapeCoverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, shapeCoverage(input));
}

fn shapeOccupancyMayContribute(uv: vec2<f32>) -> bool {
  let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.99999994));
  let cell = min(
    vec2<u32>(clampedUv * f32(SHAPE_OCCUPANCY_GRID_SIZE)),
    vec2<u32>(SHAPE_OCCUPANCY_GRID_SIZE - 1u)
  );
  let cellIndex = cell.y * SHAPE_OCCUPANCY_GRID_SIZE + cell.x;
  let wordIndex = cellIndex >> 5u;
  let packedVector = shapeOccupancy.words[wordIndex >> 2u];
  let packedWord = packedVector[wordIndex & 3u];
  return (packedWord & (1u << (cellIndex & 31u))) != 0u;
}

fn occupiedShapeCoverage(input: VertexOutput) -> f32 {
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let uvDx = dpdx(uv);
  let uvDy = dpdy(uv);

  if (!shapeOccupancyMayContribute(uv)) {
    discard;
  }

  let sourceCoverage = textureSampleGrad(shapeMaskTexture, shapeMaskSampler, uv, uvDx, uvDy).r;
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeOccupancyFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, occupiedShapeCoverage(input));
}

@fragment
fn shapeOccupancyCoverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, occupiedShapeCoverage(input));
}
`,l=`
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;
const GRAIN_MIP_LEVEL_COUNT: u32 = 12u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
};

struct GrainUniforms {
  inversePeriod: f32,
  depth: f32,
  brightness: f32,
  contrastFactor: f32,
  filteringMode: u32,
  coordinateMode: u32,
  _pad1: u32,
  _pad2: u32,
};

struct FragmentInput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pressure: f32,
  @location(2) @interpolate(flat) pointColor: vec3<f32>,
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(2) var shapeMaskTexture: texture_2d<f32>;
@group(0) @binding(3) var shapeMaskSampler: sampler;
@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;
@group(0) @binding(5) var grainTexture: texture_2d<f32>;
@group(0) @binding(6) var grainSampler: sampler;
@group(0) @binding(7) var<uniform> grain: GrainUniforms;

fn adjustedGrainCoverage(
  grainUv: vec2<f32>,
  grainUvDx: vec2<f32>,
  grainUvDy: vec2<f32>
) -> f32 {
  var sourceSample: vec4<f32>;
  if (grain.filteringMode == 0u) {
    let baseDimensions = vec2<f32>(textureDimensions(grainTexture, 0));
    let footprint = max(
      length(grainUvDx * baseDimensions),
      length(grainUvDy * baseDimensions)
    );
    let mipLevel = u32(clamp(
      round(log2(max(footprint, 1.0))),
      0.0,
      f32(GRAIN_MIP_LEVEL_COUNT - 1u)
    ));
    // The No sampler uses nearest min/mag. Its mip filter is declared linear
    // only so it remains compatible with the shared filtering binding; an
    // exact integer LOD makes the effective mip choice nearest as well.
    sourceSample = textureSampleLevel(
      grainTexture,
      grainSampler,
      grainUv,
      f32(mipLevel)
    );
  } else {
    sourceSample = textureSampleGrad(
      grainTexture,
      grainSampler,
      grainUv,
      grainUvDx,
      grainUvDy
    );
  }
  // M1 uploads the original RGBA image and derives grain from RGB luma in the
  // fragment shader. Alpha metadata in the source image does not modulate paint.
  let source = dot(sourceSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let adjusted = clamp(
    (source - 0.5) * grain.contrastFactor + 0.5 + grain.brightness,
    0.0,
    1.0
  );
  return mix(1.0, adjusted, clamp(grain.depth, 0.0, 1.0));
}

fn selectedGrainUv(input: FragmentInput) -> vec2<f32> {
  if (grain.coordinateMode == 1u) {
    // M1 Moving maps one full grain image to every physical stamp. Because
    // localPosition is carried by the rotated support quad, the grain follows
    // the stamp's translation, scale and rotation.
    return input.localPosition * 0.5 + vec2<f32>(0.5);
  }
  // Fixed/Texturized is paper grain in authoritative layer coordinates.
  return (input.position.xy + brush.renderTargetOrigin) * grain.inversePeriod;
}

fn shapeOccupancyMayContribute(uv: vec2<f32>) -> bool {
  let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.99999994));
  let cell = min(
    vec2<u32>(clampedUv * f32(SHAPE_OCCUPANCY_GRID_SIZE)),
    vec2<u32>(SHAPE_OCCUPANCY_GRID_SIZE - 1u)
  );
  let cellIndex = cell.y * SHAPE_OCCUPANCY_GRID_SIZE + cell.x;
  let wordIndex = cellIndex >> 5u;
  let packedVector = shapeOccupancy.words[wordIndex >> 2u];
  let packedWord = packedVector[wordIndex & 3u];
  return (packedWord & (1u << (cellIndex & 31u))) != 0u;
}

fn paintAlpha(input: FragmentInput, coverage: f32) -> f32 {
  let pressureInfluence = clamp(brush.controls.w, 0.0, 1.0);
  let pressureAlpha = mix(1.0, clamp(input.pressure, 0.0, 1.0), pressureInfluence);
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );
}

fn premultipliedPaint(input: FragmentInput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(input.pointColor * alpha, alpha);
}

fn quantizedCoveragePaint(input: FragmentInput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  let quantized = unpack4x8unorm(pack4x8unorm(vec4<f32>(alpha))).r;
  return vec4<f32>(quantized);
}

fn circleGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let radiusSquared = dot(input.localPosition, input.localPosition);
  let antialiasWidth = max(fwidth(radiusSquared), 0.00001);

  if (radiusSquared > 1.0 + antialiasWidth) {
    discard;
  }

  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let innerEdge = min(hardness * hardness, 1.0 - antialiasWidth);
  var coverage = 1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared);

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn fragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, circleGrainCoverage(input));
}

@fragment
fn coverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, circleGrainCoverage(input));
}

fn shapeGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let sourceCoverage = textureSample(shapeMaskTexture, shapeMaskSampler, uv).r;
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  var coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, shapeGrainCoverage(input));
}

@fragment
fn shapeCoverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, shapeGrainCoverage(input));
}

fn occupiedShapeGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let uvDx = dpdx(uv);
  let uvDy = dpdy(uv);

  if (!shapeOccupancyMayContribute(uv)) {
    discard;
  }

  let sourceCoverage = textureSampleGrad(shapeMaskTexture, shapeMaskSampler, uv, uvDx, uvDy).r;
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  var coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeOccupancyFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, occupiedShapeGrainCoverage(input));
}

@fragment
fn shapeOccupancyCoverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return quantizedCoveragePaint(input, occupiedShapeGrainCoverage(input));
}
`,u=`
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let sourceDimensions = vec2<u32>(textureDimensions(sourceTexture, 0));
  let targetDimensions = max(sourceDimensions / 2u, vec2<u32>(1u));
  let uv = fragmentPosition.xy / vec2<f32>(targetDimensions);
  return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
}
`,d=`
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var layerTexture: texture_2d<f32>;
@group(0) @binding(2) var layerSampler: sampler;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = display.viewCenter
    + (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < display.layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp((layerPosition + vec2<f32>(0.5)) / display.layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let paint = textureSampleLevel(layerTexture, layerSampler, uv, display.selectedMipLevel);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,f=`
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  _pad0: u32,
  _pad1: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var layerTexture: texture_2d<f32>;
@group(0) @binding(2) var layerSampler: sampler;
@group(0) @binding(3) var tailTexture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> tail: ThicknessTailUniforms;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = display.viewCenter
    + (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < display.layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let layerUv = clamp(
    (layerPosition + vec2<f32>(0.5)) / display.layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let permanentPaint = textureSampleLevel(
    layerTexture,
    layerSampler,
    layerUv,
    display.selectedMipLevel
  );

  var paint = permanentPaint;
  let tailPosition = layerPosition - tail.origin;
  let insideTail = all(tailPosition >= vec2<f32>(0.0))
    && all(tailPosition < tail.textureSize);
  if (insideTail) {
    let tailUv = clamp(
      (tailPosition + vec2<f32>(0.5)) / tail.textureSize,
      vec2<f32>(0.0),
      vec2<f32>(1.0)
    );
    let transientPaint = textureSampleLevel(tailTexture, layerSampler, tailUv, 0.0);
    if (tail.compositionMode == 1u) {
      paint = vec4<f32>(
        permanentPaint.rgb + transientPaint.rgb,
        transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
      );
    } else {
      paint = transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,p=`
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var layerTexture: texture_2d<f32>;
@group(0) @binding(2) var strokeTexture: texture_2d<f32>;
@group(0) @binding(3) var layerSampler: sampler;
@group(0) @binding(4) var<uniform> lightGlaze: LightGlazeUniforms;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return unpack4x8unorm(pack4x8unorm(value));
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = clamp(accumulatedStroke.r, 0.0, 1.0);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn compositedLayerTexel(position: vec2<i32>) -> vec4<f32> {
  let permanentPaint = textureLoad(layerTexture, position, 0);
  let accumulatedStroke = textureLoad(strokeTexture, position, 0);
  let strokePaint = resolvedStrokePaint(accumulatedStroke);
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
}

fn sampleCompositedLayerLinear(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(layerTexture, 0));
  let maximumCoordinate = dimensions - vec2<i32>(1);
  let texelPosition = uv * vec2<f32>(dimensions) - vec2<f32>(0.5);
  let lowerCoordinate = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedLayerTexel(clamp(lowerCoordinate, vec2<i32>(0), maximumCoordinate));
  let p10 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(1, 0),
    vec2<i32>(0),
    maximumCoordinate
  ));
  let p01 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(0, 1),
    vec2<i32>(0),
    maximumCoordinate
  ));
  let p11 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(1, 1),
    vec2<i32>(0),
    maximumCoordinate
  ));
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = display.viewCenter
    + (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < display.layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp((layerPosition + vec2<f32>(0.5)) / display.layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  var paint: vec4<f32>;
  if (display.selectedMipLevel < 0.5) {
    // Reproduce sampling of the quantized committed mip 0: compose and encode
    // each neighboring layer texel first, then apply the sampler's bilinear mix.
    paint = sampleCompositedLayerLinear(uv);
  } else {
    // Mip 1+ of strokeTexture already stores box-filtered final compositing.
    // Sampling that pyramid avoids compose(filter(base), filter(stroke)),
    // which is not equivalent to filtering the per-pixel source-over result.
    paint = textureSampleLevel(
      strokeTexture,
      layerSampler,
      uv,
      display.selectedMipLevel
    );
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,m=`
struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var permanentTexture: texture_2d<f32>;
@group(0) @binding(1) var strokeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> lightGlaze: LightGlazeUniforms;

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return unpack4x8unorm(pack4x8unorm(value));
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = clamp(accumulatedStroke.r, 0.0, 1.0);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn compositedSource(sourcePosition: vec2<i32>) -> vec4<f32> {
  let permanentPaint = textureLoad(permanentTexture, sourcePosition, 0);
  let accumulatedStroke = textureLoad(strokeTexture, sourcePosition, 0);
  let strokePaint = resolvedStrokePaint(accumulatedStroke);
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  return (
    compositedSource(sourceOrigin)
    + compositedSource(sourceOrigin + vec2<i32>(1, 0))
    + compositedSource(sourceOrigin + vec2<i32>(0, 1))
    + compositedSource(sourceOrigin + vec2<i32>(1, 1))
  ) * 0.25;
}
`,h=`
struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var strokeTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> lightGlaze: LightGlazeUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let source = textureLoad(strokeTexture, vec2<i32>(fragmentPosition.xy), 0);
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = clamp(source.r, 0.0, 1.0);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return source * opacity;
}
`,g=`
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let dimensions = vec2<i32>(textureDimensions(sourceTexture));
  let maximumCoordinate = dimensions - vec2<i32>(1);
  let p00 = textureLoad(sourceTexture, min(sourceOrigin, maximumCoordinate), 0);
  let p10 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(1, 0), maximumCoordinate),
    0
  );
  let p01 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(0, 1), maximumCoordinate),
    0
  );
  let p11 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(1, 1), maximumCoordinate),
    0
  );
  return (p00 + p10 + p01 + p11) * 0.25;
}
`,_=`time-window-quadratic-ease-out-tail-holdback`;function v(e,t,n){return Math.min(n,Math.max(t,e))}function y(e){let t=1-v(e,0,1);return 1-t*t}function b(e,t,n,r){let i=Math.max(0,Number.isFinite(t)?t:0);if(!r)return i;if(!Number.isFinite(n)||n<=0)return Math.max(0,e);let a=1-Math.exp(-n/50);return Math.max(0,e+(i-e)*a)}function x(e,t,n){let r=Math.max(.001,t),i=y(v(Math.max(0,e)*100/r,0,1));return v(1+v(n,-200,200)/200*i,0,2)}function S(e,t,n){let r=v(e,0,2),i=v(t,0,2),a=y(n/100);return r+(i-r)*a}function C(e,t,n){let r=v(e,0,2),i=v(t,0,2),a=y(n/100);return i+(r-i)*a}function w(e,t,n,r){return Math.max(0,e)*C(t,n,r)}function T(e,t){return Math.abs(v(e,0,2)-1)>2**-52*8||Math.abs(v(t,-200,200))>2**-52*8}function E(e,t,n){return Math.abs(v(e,0,2)-1)<=2**-52*8&&!T(t,n)}var D=4096,O=Math.floor(Math.log2(D))+1,k=32,A=65536,j=4,M=`quad`,ee=`generic-smoothstep`,N=`shape-alpha-mask-2k`,P=`coarse-occupancy-bitmask`,te=`legacy-full-mask`,ne=`png-gray8-direct`,re=`canvas-fallback`,ie=`reuse-position-copy-seed`,ae=`directional-jitter-bounds`,oe=`persistent-full-resolution-screen-cache`,se=`copy-texture-to-current-texture`,ce=`live-dirty-box-filter-mip-chain`,F=`largest-power-of-two-without-upscaling`,le=`per-stamp-uniform-alpha-multiplier`,ue=`disabled-legacy-pipeline`,de=`rgba8-native-2500-fixed-coverage-multiply`,fe=`rgba8-native-2500-moving-coverage-multiply`,pe=`authoritative-layer-position`,me=`stamp-local-position`,he=`webgpu-wgsl-linear-full-chain`,ge=`separate-opt-in-pipelines`,_e=`post-tip-coverage-pre-alpha-multiply`,ve=`disabled-semantic-mismatch-probe-spacing-active`,ye=`lazy-stroke-mip0-format-quantized-composite-mips-single-commit`,be=`m1-r8-quantized-max-coverage-rgba-compat-single-commit`,xe=`disabled-semantic-mismatch`,Se=`queue-lag-canvas2d-tip-patch`,Ce=`predictive-webgpu-tail-overlay`,we=`single-sampled-queue-prefix-latency`,Te=`hide-confirmed-stale-bitmap-and-single-raf-retry`,Ee=`iphone-desynchronized-others-synchronized-canvas2d`,De=.5,Oe=1.25,ke=.2,Ae=2,je=256,Me=D,Ne=384,Pe=32,Fe=32,Ie=3,Le=.86,Re=12,ze=4,Be=60,Ve=58,He=2,Ue=45,We=`queue-lag-step-up-per-stroke`,Ge=.25,Ke=1.5,qe=4,Je=!1;function Ye(e){if(!e||typeof e.getContextAttributes!=`function`)return{alpha:null,desynchronized:null,colorSpace:null};let t=e.getContextAttributes();return{alpha:typeof t.alpha==`boolean`?t.alpha:null,desynchronized:typeof t.desynchronized==`boolean`?t.desynchronized:null,colorSpace:typeof t.colorSpace==`string`?t.colorSpace:null}}function Xe(){return navigator.platform===`iPhone`||/\biPhone\b/.test(navigator.userAgent)}function Ze(){return/\bAndroid\b/i.test(navigator.userAgent)?qe:Ke}var Qe=`cpu-render-batch-journal`,$e=`clear-and-stable-gpu-replay`,et=`shared-immutable-references`,I=2048,L=2500,tt=Math.floor(Math.log2(L))+1,nt=Array.from({length:tt},(e,t)=>{let n=Math.max(1,Math.floor(L/2**t));return n*n}).reduce((e,t)=>e+t,0),rt=256,it=I/rt,at=rt*rt,ot=at/32,st=4,ct=5,lt=128,ut=.5,dt=ot*4,ft=96,pt=32,mt=48,ht=32,gt=32;function _t(e){return e===`light-glaze`||e===`m1-glaze`}function vt(e){return e===`m1-glaze`?be:ye}function yt(e){let t=e===`rgba16float`?8:4,n=0;for(let e=1;e<O;e+=1){let t=Math.max(1,D>>e);n+=t*t}return n*t/(1024*1024)}function bt(e){return(e===`rgba16float`?128:64)+yt(e)}function R(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function xt(e){let t=2166136261;for(let n=0;n<e.length;n+=1)t=Math.imul(t^e[n],16777619)>>>0;return t}function St(e){return e.length===0?0:Math.max(...e)}function Ct(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}function wt(e){let t=e>>>0;return t=(t^t>>>16)>>>0,t=Math.imul(t,2146121005)>>>0,t=(t^t>>>15)>>>0,t=Math.imul(t,2221713035)>>>0,t=(t^t>>>16)>>>0,t}function Tt(e,t){return(wt((e^Math.imul(t,2654435769))>>>0)&16777215)/16777216}function Et(e,t,n){let r=(n%1+1)%1;return r<1/6?e+(t-e)*6*r:r<1/2?t:r<2/3?e+(t-e)*(2/3-r)*6:e}function Dt(e,n,r){let i=(e%1+1)%1,a=t(n,0,1),o=t(r,0,1);if(a<=1e-5){let e=Math.round(o*255);return[e,e,e]}let s=o<.5?o*(1+a):o+a-o*a,c=2*o-s;return[Math.round(t(Et(c,s,i+1/3),0,1)*255),Math.round(t(Et(c,s,i),0,1)*255),Math.round(t(Et(c,s,i-1/3),0,1)*255)]}function Ot(e){let n=t(e/255,0,1);return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}function kt(e){let t=new Uint32Array(ot*ct),n=new Uint8Array(at),r=[],i=[];for(let a=0;a<ct;a+=1){let o=e[a],s=I>>a,c=1<<a;for(let e=0;e<s;e+=1)for(let t=0;t<s;t+=1){if(o[e*s+t]===0)continue;let r=Math.max(0,(t-.5)*c),i=Math.min(I,(t+1.5)*c),a=Math.max(0,(e-.5)*c),l=Math.min(I,(e+1.5)*c),u=Math.max(0,Math.floor(r/it)),d=Math.min(rt-1,Math.ceil(i/it)-1),f=Math.max(0,Math.floor(a/it)),p=Math.min(rt-1,Math.ceil(l/it)-1);for(let e=f;e<=p;e+=1){let t=e*rt;for(let e=u;e<=d;e+=1)n[t+e]=1}}let l=0,u=a*ot;for(let e=0;e<n.length;e+=1){if(n[e]===0)continue;l+=1;let r=u+(e>>>5);t[r]|=1<<(e&31)>>>0}r.push(l),i.push(l/at)}return{words:t,activeCells:r,coverageRatios:i}}var At={shape:`circle`,shapeScatter:0,grainMode:`off`,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,color:`#ff5b35`,size:96,spacingPercent:1,startThickness:1,endThickness:1,speedThickness:0,count:24,flow:.07,opacity:1,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1,pressureSize:.65,pressureOpacity:.35},jt=class{layerSize=D;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;layerSamplingView;paintMipViews=[];paintMipDownsampleBindGroups=[];paintDisplayMipValidThroughLevel=0;paintDisplaySelectedMipLevel=0;presentationCacheTexture=null;presentationCacheView=null;presentationCacheWidth=0;presentationCacheHeight=0;presentationCacheNeedsFullRebuild=!0;lightGlazeTexture=null;lightGlazeView=null;lightGlazeSamplingView=null;lightGlazeMipViews=[];lightGlazeMipDownsampleBindGroups=[];lightGlazeCompositeMipBindGroup=null;lightGlazeDisplayBindGroup=null;lightGlazeCompositeBindGroup=null;lightGlazeSession=null;lightGlazeStorageAllocated=!1;thicknessTailTexture=null;thicknessTailView=null;thicknessTailDisplayBindGroup=null;thicknessTailTextureWidth=0;thicknessTailTextureHeight=0;thicknessTailPresentedRect=null;adaptivePreviewCanvas;adaptivePreviewContext;adaptivePreviewScratchCanvas;adaptivePreviewScratchContext;adaptiveSpacingMaxExtraPercentPoints;adaptivePreviewVisibleCanvasRequestedDesynchronized;adaptivePreviewVisibleContextAttributes;adaptivePreviewScratchContextAttributes;adaptivePreviewShapeSprite=null;adaptivePreviewShapePalette=[];adaptivePreviewShapePaletteKey=``;adaptivePreviewGeneration=1;adaptivePreviewSubmissionsSinceProbe=0;adaptivePreviewSubmittedSerial=0;adaptivePreviewConfirmedSerial=0;adaptivePreviewLastPresentedSerial=0;adaptivePreviewLastIncompleteRetrySerial=0;adaptivePreviewCandidates=[];adaptivePreviewProbe=null;adaptivePreviewConsecutiveSlowProbes=0;adaptivePreviewActive=!1;adaptivePreviewFrozen=!1;adaptivePreviewForceStroke=!1;adaptivePreviewStartedAt=0;adaptivePreviewRetirementTargetSerial=0;adaptivePreviewFrameRequest=null;adaptivePreviewRetirementFrame=null;adaptivePreviewCssWidth=0;adaptivePreviewCssHeight=0;canvasCssWidth=1;canvasCssHeight=1;brushUniformBuffer;thicknessTailBrushUniformBuffer;grainUniformBuffer;displayUniformBuffer;thicknessTailDisplayUniformBuffer;lightGlazeUniformBuffer;instanceBuffer;thicknessTailInstanceBuffer;shapeOccupancyUniformBuffers=[];sampler;shapeMaskTexture;shapeMaskView;shapeMaskSampler;grainTexture;grainTextureView;grainSamplers;grainTextureIdentity=0;grainStartupDecodeMs=0;grainStartupMipBuildMs=0;grainStartupUploadMs=0;shapeMaskDecodeStrategy=re;shapeMaskIdentity=0;shapeOccupancyActiveCells=Array(ct).fill(0);shapeOccupancyCoverageRatios=Array(ct).fill(1);packedMinimumRadius=1/0;brushBindGroupLayout;brushOccupancyBindGroupLayout;grainBrushBindGroupLayout;grainBrushOccupancyBindGroupLayout;displayBindGroupLayout;thicknessTailDisplayBindGroupLayout;lightGlazeDisplayBindGroupLayout;lightGlazeCompositeMipBindGroupLayout;lightGlazeCompositeBindGroupLayout;paintMipDownsampleBindGroupLayout;brushBindGroup;thicknessTailBrushBindGroup;brushOccupancyBindGroups=[];thicknessTailBrushOccupancyBindGroups=[];grainBrushBindGroups;grainBrushOccupancyBindGroups;thicknessTailGrainBrushBindGroups;thicknessTailGrainBrushOccupancyBindGroups;displayBindGroup;brushShaderModule;texturizedGrainShaderModule;displayShaderModule;thicknessTailDisplayShaderModule;lightGlazeDisplayShaderModule;lightGlazeCompositeMipShaderModule;lightGlazeCompositeShaderModule;paintMipDownsampleShaderModule;normalPipeline;additivePipeline;shapeNormalPipeline;shapeAdditivePipeline;shapeOccupancyNormalPipeline;shapeOccupancyAdditivePipeline;grainNormalPipeline;grainAdditivePipeline;grainShapeNormalPipeline;grainShapeAdditivePipeline;grainShapeOccupancyNormalPipeline;grainShapeOccupancyAdditivePipeline;m1GlazePipeline;m1GlazeShapePipeline;m1GlazeShapeOccupancyPipeline;grainM1GlazePipeline;grainM1GlazeShapePipeline;grainM1GlazeShapeOccupancyPipeline;displayPipeline;thicknessTailDisplayPipeline;lightGlazeDisplayPipeline;lightGlazeCompositeMipPipeline;lightGlazeCompositePipeline;paintMipDownsamplePipeline;instanceUpload=new ArrayBuffer(A*k);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);thicknessTailInstanceUpload=new ArrayBuffer(A*k);thicknessTailInstanceUploadF32=new Float32Array(this.thicknessTailInstanceUpload);thicknessTailInstanceUploadU32=new Uint32Array(this.thicknessTailInstanceUpload);brushUniformUpload=new ArrayBuffer(ft);thicknessTailBrushUniformUpload=new ArrayBuffer(ft);grainUniformUpload=new Float32Array(pt/4);displayUniformUpload=new Float32Array(mt/4);thicknessTailDisplayUniformUpload=new ArrayBuffer(gt);settings={...At};pendingStamps=[];activeStroke=null;seedSequence=1;historyActions=[];historyCursor=0;nextHistoryActionId=1;historyBatches=[];historyStoredBaseStamps=0;historyCompactionPending=!1;historyBusy=!1;layerHasContent=!1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=D*.5;viewCenterY=D*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;lastStampGeometry=M;lastStampVerticesPerCopy=j;lastShapeSamplingStrategy=`none`;lastShapeOccupancyFallbackReason=`none`;lastShapeOccupancyMipLevel=-1;lastShapeOccupancyActiveCells=0;lastShapeOccupancyCoverageRatio=0;lastShapeOccupancyCandidateMipLevel=-1;lastShapeOccupancyCandidateActiveCells=0;lastShapeOccupancyCandidateCoverageRatio=0;constructor(e,t={},n=null){this.canvas=e,this.callbacks=t,this.adaptivePreviewCanvas=n,this.adaptiveSpacingMaxExtraPercentPoints=Ze(),this.adaptivePreviewVisibleCanvasRequestedDesynchronized=Xe(),this.adaptivePreviewContext=n?.getContext(`2d`,{alpha:!0,desynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized})??null,this.adaptivePreviewScratchCanvas=this.adaptivePreviewContext?document.createElement(`canvas`):null,this.adaptivePreviewScratchContext=this.adaptivePreviewScratchCanvas?.getContext(`2d`,{alpha:!0,desynchronized:!0})??null,this.adaptivePreviewVisibleContextAttributes=Ye(this.adaptivePreviewContext),this.adaptivePreviewScratchContextAttributes=Ye(this.adaptivePreviewScratchContext)}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<D)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${D}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{this.invalidateAdaptivePreview();let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),this.prepareAdaptivePreviewShapePalette(this.settings),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.clearAdaptivePreviewCanvas(),this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats(),this.publishHistoryState()}getSettings(){return{...this.settings}}setBrushSettings(e){this.flushPendingWorkBeforeSettingsChange(),this.settings={...this.settings,...e,shape:e.shape===`shape`||e.shape===`circle`?e.shape:this.settings.shape,shapeScatter:t(e.shapeScatter??this.settings.shapeScatter,0,1),grainMode:e.grainMode===`off`||e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:this.settings.grainMode,grainScale:t(e.grainScale??this.settings.grainScale,.1,4),grainDepth:t(e.grainDepth??this.settings.grainDepth,0,1),grainBrightness:t(e.grainBrightness??this.settings.grainBrightness,-1,1),grainContrast:t(e.grainContrast??this.settings.grainContrast,-1,1),grainInvert:typeof e.grainInvert==`boolean`?e.grainInvert:this.settings.grainInvert,grainFiltering:e.grainFiltering===`no`||e.grainFiltering===`classic`||e.grainFiltering===`improved`?e.grainFiltering:this.settings.grainFiltering,grainBlendMode:e.grainBlendMode===`multiply`?e.grainBlendMode:this.settings.grainBlendMode,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),startThickness:t(e.startThickness??this.settings.startThickness,0,2),endThickness:t(e.endThickness??this.settings.endThickness,0,2),speedThickness:t(e.speedThickness??this.settings.speedThickness,-200,200),flow:t(e.flow??this.settings.flow,.001,1),opacity:t(e.opacity??this.settings.opacity,0,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),blendMode:e.blendMode===`normal`||e.blendMode===`additive`||e.blendMode===`light-glaze`||e.blendMode===`m1-glaze`?e.blendMode:this.settings.blendMode,jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.prepareAdaptivePreviewShapePalette(this.settings),this.initialized&&(this.invalidateAdaptivePreview(),this.writeBrushUniforms(),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(e===this.layerFormat)return!0;if(!this.initialized||this.historyBusy||this.activeStroke)return!1;let t=this.layerFormat;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`);try{return await this.waitForIdle(),await this.recreateLayerResources(e),this.layerFormat=e,this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.layerHasContent=!1,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats(),!0}catch(n){this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}finally{this.historyBusy=!1,this.publishHistoryState()}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect();this.canvasCssWidth=Math.max(1,e.width),this.canvasCssHeight=Math.max(1,e.height);let t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.invalidateAdaptivePreview(),this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){this.invalidateAdaptivePreview();let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=D*.5,this.viewCenterY=D*.5,this.zoom=Math.max(.01,Math.min(e/D,t/D)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}zoomBy(e,n,r){this.invalidateAdaptivePreview();let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}panByClientDelta(e,t){this.invalidateAdaptivePreview();let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){if(this.historyBusy)return;let t={...e,timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()};this.flushClosingLightGlazeSessionBeforeNewStroke(),this.invalidateAdaptivePreview();let n=_t(this.settings.blendMode)?{...this.settings}:null;n&&this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0),this.adaptivePreviewForceStroke=Je;let r=this.nextHistoryActionId++,i=n??this.settings,a={startThickness:i.startThickness,endThickness:i.endThickness,speedThickness:i.speedThickness};this.activeStroke={lastInput:t,startedAtMs:t.timeMs,filteredSpeedPxPerMs:0,speedFilterInitialized:!1,thicknessSettings:a,thicknessDynamicsNeutral:E(a.startThickness,a.endThickness,a.speedThickness),thicknessTailHoldback:T(a.endThickness,a.speedThickness),heldThicknessStamps:[],heldThicknessHead:0,distanceSinceStamp:0,adaptiveSpacingInitialPercent:n?.spacingPercent??this.settings.spacingPercent,adaptiveSpacingPercent:n?.spacingPercent??this.settings.spacingPercent,historyActionId:r,historyCommitted:!1,submitted:!1,seedSequenceBeforeStroke:this.seedSequence,historyCursorBeforeStroke:this.historyCursor,redoActionsBeforeStroke:this.historyCursor<this.historyActions.length?this.historyActions.slice(this.historyCursor):null,historyCompactionPendingBeforeStroke:this.historyCompactionPending,lightGlazeSettings:n},n&&this.startLightGlazeSession(r,n),this.emitStamp(t,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(e){let t=this.activeStroke,n=!!(t?.thicknessTailHoldback&&!t.lightGlazeSettings&&(this.settings.blendMode===`normal`||this.settings.blendMode===`additive`));if(t){let n=Number.isFinite(e)?e:t.lastInput.timeMs,r=Math.max(t.lastInput.timeMs,n);this.releaseHeldThicknessStamps(r,!0)}let r=t?.historyCommitted??!1;t?.lightGlazeSettings&&this.lightGlazeSession?.historyActionId===t.historyActionId&&(this.lightGlazeSession.endRequested=!0,this.displayDirty=!0,this.requestRender()),this.freezeAdaptivePreviewAtLift(),this.activeStroke=null,(n||this.thicknessTailPresentedRect)&&(this.displayDirty=!0,this.requestRender()),r&&this.publishHistoryState()}cancelStrokeBeforeRender(){let e=this.activeStroke;if(!e||e.submitted)return!1;let t=0;return this.pendingStamps=this.pendingStamps.filter(n=>{let r=n.historyActionId===e.historyActionId;return r&&(t+=1),!r}),this.seedSequence=e.seedSequenceBeforeStroke,e.historyCommitted&&(this.historyActions.length=e.historyCursorBeforeStroke,e.redoActionsBeforeStroke&&this.historyActions.push(...e.redoActionsBeforeStroke),this.historyCursor=e.historyCursorBeforeStroke,this.historyCompactionPending=e.historyCompactionPendingBeforeStroke,this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps=Math.max(0,this.activeStrokeProfile.baseStamps-t),this.activeStrokeProfile.historyCommittedActions=Math.max(0,this.activeStrokeProfile.historyCommittedActions-1))),this.activeStroke=null,this.lightGlazeSession?.historyActionId===e.historyActionId&&this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.thicknessTailPresentedRect&&(this.displayDirty=!0,this.requestRender()),e.historyCommitted&&this.publishHistoryState(),!0}async clear(){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;this.historyBusy=!0,this.invalidateAdaptivePreview(),this.publishHistoryState(),this.callbacks.onStatus?.(`Pulizia del layer…`,`working`);try{return await this.waitForIdle(),this.layerHasContent?(this.submitImmediate([],!0,this.settings,!0,null),this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone(),this.layerHasContent=!1,this.hasVisibleHistoryContent()?(this.truncateRedoHistory(),this.historyActions.push({id:this.nextHistoryActionId++,kind:`clear`}),this.historyCursor=this.historyActions.length,this.compactDiscardedHistory(),this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)):this.resetHistoryState(),this.callbacks.onStatus?.(`Layer pulito.`,`ok`),!0):(this.callbacks.onStatus?.(`Il layer è già vuoto.`,`ok`),!1)}finally{this.historyBusy=!1,this.publishHistoryState()}}resetDocument(){return this.historyBusy?!1:(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.pendingStamps.length=0,this.activeStroke=null,this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.layerHasContent=!1,this.requestRender(),this.publishHistoryState(),!0)}async undo(){return this.moveHistoryCursor(-1)}async redo(){return this.moveHistoryCursor(1)}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);if(this.historyBusy||this.activeStroke)throw Error(`Concludi prima il tratto o l'operazione Undo/Redo.`);this.lightGlazeSession&&await this.waitForIdle();let n=t(Math.round(e),1,Math.min(12e3,A));this.invalidateAdaptivePreview(),this.pendingStamps.length=0,this.activeStroke=null,this.resetHistoryState(),this.publishHistoryState(),this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.settings,i=this.generateBenchmarkStamps(n,r);_t(r.blendMode)&&(this.startLightGlazeSession(0,r),this.lightGlazeSession.endRequested=!0,this.lightGlazeSession.commitRequested=!0);let a=performance.now(),o=this.submitImmediate(i,!0,r),s=o.totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=!0,await this.device.queue.onSubmittedWorkDone();let c=performance.now()-a,l=this.nextHistoryActionId++;for(let e of i)e.historyActionId=l;this.historyActions.push({id:l,kind:`stroke`}),this.historyCursor=this.historyActions.length,this.recordHistoryBatch(i,r,o,!0),this.totalBaseStamps+=i.length,this.avoidedLogicalDraws+=i.length*Math.max(0,r.count-1),this.recordRenderedFrame(performance.now()),this.publishStats(),this.publishHistoryState();let u=i.reduce((e,t)=>e+t.radius*t.radius,0)/i.length,d=Math.round(Math.PI*u*i.length*r.count),f=[`1 draw instanziata`,`${r.count} copie fisiche GPU per stamp base`,r.shape===`shape`?this.lastShapeSamplingStrategy===P?`bitmask alpha ${rt}², mip ${this.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(this.lastShapeOccupancyCoverageRatio*100).toFixed(1)}%`:`quad Shape legacy da 4 vertici, fallback ${this.lastShapeOccupancyFallbackReason}, mappa candidata ${(this.lastShapeOccupancyCandidateCoverageRatio*100).toFixed(1)}%`:`geometria quad triangle-strip (4 vertici)`,r.shape===`shape`?`coverage da maschera alpha 2048²`:`coverage fragment smoothstep generica`,r.shape===`shape`?this.shapeMaskDecodeStrategy===ne?`PNG grayscale decodificata direttamente`:`PNG decodificata tramite fallback canvas`:`nessuna maschera Shape`,r.shape===`shape`?`scatter rotazione ${(r.shapeScatter*100).toFixed(0)}%`:`orientamento circolare invariato`,`riuso copySeed per jitter colore per copia`,`dirty rect direzionale conservativo`,this.isTexturizedGrainActive(r)?`grain Cotton Fleece M1 2500 ${r.grainMode} ${r.grainFiltering}, scale ${(r.grainScale*100).toFixed(0)}%, depth ${(r.grainDepth*100).toFixed(0)}%`:`grain Off, pipeline legacy`].join(` · `);return{baseStamps:i.length,logicalCopies:i.length*r.count,cpuSubmitMs:s,gpuCompletionMs:c,estimatedCoveredFragments:d,strategy:f}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}getHistoryState(){return{canUndo:!this.historyBusy&&this.historyCursor>0,canRedo:!this.historyBusy&&this.historyCursor<this.historyActions.length,busy:this.historyBusy,actionCount:this.historyActions.length,cursor:this.historyCursor,storedBaseStamps:this.historyStoredBaseStamps,logicalStampBytes:this.historyStoredBaseStamps*k}}getAdaptivePreviewDiagnostics(){return{active:this.adaptivePreviewActive,frozen:this.adaptivePreviewFrozen,visible:this.adaptivePreviewCanvas?.style.opacity===`1`,submittedSerial:this.adaptivePreviewSubmittedSerial,confirmedSerial:this.adaptivePreviewConfirmedSerial,lastPresentedSerial:this.adaptivePreviewLastPresentedSerial,retirementTargetSerial:this.adaptivePreviewRetirementTargetSerial,candidateCount:this.adaptivePreviewCandidates.length,presentedUnboundCandidates:this.adaptivePreviewCandidates.filter(e=>e.presented&&e.serial===null).length,drawFramePending:this.adaptivePreviewFrameRequest!==null,retirementFramePending:this.adaptivePreviewRetirementFrame!==null}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.clearRequested||this.displayDirty||this.lightGlazeSession?.commitRequested;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone(),this.retireAdaptivePreviewAfterGpuIdle()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={startedAt:performance.now(),stampGeometry:M,stampVerticesPerCopy:j,fragmentCoverageStrategy:this.settings.shape===`shape`?N:ee,shapeSamplingStrategy:`none`,shapeOccupancyFallbackReason:`none`,shapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:0,historyCapturedBaseStamps:0,historyCapturedBatches:0,historyCommittedActions:0,historyReplayOperations:0,baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,thicknessDynamicsHeldBaseStamps:0,thicknessDynamicsMaximumHeldBaseStamps:0,thicknessDynamicsReleasedDuringStroke:0,thicknessDynamicsReleasedAtLift:0,thicknessDynamicsPreviewFrames:0,thicknessDynamicsPreviewBaseStamps:0,thicknessDynamicsPreviewPhysicalCopies:0,thicknessDynamicsPreviewMaximumTexturePixels:0,presentationCacheFullRebuilds:0,presentationCachePartialUpdates:0,presentationCacheOffscreenSkips:0,presentationCacheUpdatedPixels:0,legacyDisplayShaderPixels:0,presentationCopiedPixels:0,paintDisplayMaximumSelectedMipLevel:0,paintDisplayPyramidMaintenanceFrames:0,paintDisplayPyramidFullLevelBuilds:0,paintDisplayPyramidDirtyLevelUpdates:0,paintDisplayPyramidPasses:0,paintDisplayPyramidBaseDirtyPixels:0,paintDisplayPyramidUpdatedPixels:0,paintDisplayPyramidEncodingMs:0,adaptivePreviewProbeStarts:0,adaptivePreviewProbeResolvedFast:0,adaptivePreviewProbeResolvedSlow:0,adaptivePreviewProbeTimeouts:0,adaptivePreviewProbeCancellations:0,adaptivePreviewProbeRejections:0,adaptivePreviewProbeNearMisses:0,adaptivePreviewProbeLatencyMs:[],adaptivePreviewProbeBacklogBaseStamps:[],adaptivePreviewProbeTimeoutLatenessMs:[],adaptiveSpacingInitialPercent:this.settings.spacingPercent,adaptiveSpacingFinalPercent:this.settings.spacingPercent,adaptiveSpacingEvents:[],grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?_e:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?ve:`legacy`,grainBatches:0,grainBaseStamps:0,grainPhysicalCopies:0,grainCircleBatches:0,grainShapeBatches:0,grainAdaptivePreviewSkips:0,lightGlazeStrategy:vt(this.settings.blendMode),lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,adaptivePreviewActivations:0,adaptivePreviewActivationReason:`none`,adaptivePreviewFirstActivationReason:null,adaptivePreviewFirstActivationMs:null,adaptivePreviewSecondActivationReason:null,adaptivePreviewSecondActivationMs:null,adaptivePreviewFrames:0,adaptivePreviewBaseStampsDrawn:0,adaptivePreviewPhysicalCopiesDrawn:0,adaptivePreviewBudgetSkips:0,adaptivePreviewConfirmedStaleBitmapHides:0,adaptivePreviewIncompleteFrameRetryRequests:0,adaptivePreviewOversizedSkips:0,adaptivePreviewPatchPixels:0,adaptivePreviewMaxPatchBackingPixels:0,adaptivePreviewJsTotalMs:0,adaptivePreviewJsFrameMs:[],adaptivePreviewMaxLifetimeMs:0,adaptivePreviewMaxQueueProbeLatencyMs:0,adaptivePreviewMaxUnconfirmedBaseStamps:0,adaptivePreviewRetirements:0,adaptivePreviewFrozenAtLift:0,adaptivePreviewLiftPendingBaseStamps:0,adaptivePreviewLiftPendingSerialBindings:0,adaptivePreviewUnsupportedBlendSkips:0,adaptivePreviewExactBaseStampsSubmitted:0,adaptivePreviewExactBatchesSubmitted:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=Ct(e.renderIntervalMs);return{stampGeometry:e.stampGeometry,stampVerticesPerCopy:e.stampVerticesPerCopy,fragmentCoverageStrategy:e.fragmentCoverageStrategy,shapeSamplingStrategy:e.shapeSamplingStrategy,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:e.shapeOccupancyFallbackReason,shapeOccupancyGridSize:rt,shapeOccupancyMipLevel:e.shapeOccupancyMipLevel,shapeOccupancyActiveCells:e.shapeOccupancyActiveCells,shapeOccupancyCoverageRatio:e.shapeOccupancyCoverageRatio,shapeOccupancyCandidateMipLevel:e.shapeOccupancyCandidateMipLevel,shapeOccupancyCandidateActiveCells:e.shapeOccupancyCandidateActiveCells,shapeOccupancyCandidateCoverageRatio:e.shapeOccupancyCandidateCoverageRatio,shapeOccupancyMaximumMip:st,shapeOccupancyMinimumRadius:lt,shapeOccupancyMaximumCoverageRatio:ut,shapeOccupancyBitmaskBytes:dt,colorSeedStrategy:ie,dirtyRectStrategy:ae,thicknessDynamicsStrategy:_,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsSpeedFilterTimeMs:50,thicknessDynamicsHeldBaseStamps:e.thicknessDynamicsHeldBaseStamps,thicknessDynamicsMaximumHeldBaseStamps:e.thicknessDynamicsMaximumHeldBaseStamps,thicknessDynamicsReleasedDuringStroke:e.thicknessDynamicsReleasedDuringStroke,thicknessDynamicsReleasedAtLift:e.thicknessDynamicsReleasedAtLift,thicknessDynamicsPreviewStrategy:Ce,thicknessDynamicsPreviewTextureQuantum:je,thicknessDynamicsPreviewMaximumTextureDimension:Me,thicknessDynamicsPreviewFrames:e.thicknessDynamicsPreviewFrames,thicknessDynamicsPreviewBaseStamps:e.thicknessDynamicsPreviewBaseStamps,thicknessDynamicsPreviewPhysicalCopies:e.thicknessDynamicsPreviewPhysicalCopies,thicknessDynamicsPreviewMaximumTexturePixels:e.thicknessDynamicsPreviewMaximumTexturePixels,thicknessDynamicsPreviewAdditionalMemoryMiB:e.thicknessDynamicsPreviewMaximumTexturePixels*(this.layerFormat===`rgba16float`?8:4)/(1024*1024),presentationCacheStrategy:oe,presentationTransferStrategy:se,presentationCacheFullRebuilds:e.presentationCacheFullRebuilds,presentationCachePartialUpdates:e.presentationCachePartialUpdates,presentationCacheOffscreenSkips:e.presentationCacheOffscreenSkips,presentationCacheUpdatedPixels:e.presentationCacheUpdatedPixels,legacyDisplayShaderPixels:e.legacyDisplayShaderPixels,presentationCopiedPixels:e.presentationCopiedPixels,paintDisplayPyramidStrategy:ce,paintDisplayLodSelectionStrategy:F,paintDisplayMipLevelCount:O,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayMaximumSelectedMipLevel:e.paintDisplayMaximumSelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:yt(this.layerFormat),paintDisplayPyramidMaintenanceFrames:e.paintDisplayPyramidMaintenanceFrames,paintDisplayPyramidFullLevelBuilds:e.paintDisplayPyramidFullLevelBuilds,paintDisplayPyramidDirtyLevelUpdates:e.paintDisplayPyramidDirtyLevelUpdates,paintDisplayPyramidPasses:e.paintDisplayPyramidPasses,paintDisplayPyramidBaseDirtyPixels:e.paintDisplayPyramidBaseDirtyPixels,paintDisplayPyramidUpdatedPixels:e.paintDisplayPyramidUpdatedPixels,paintDisplayPyramidEncodingMs:e.paintDisplayPyramidEncodingMs,brushOpacityStrategy:le,grainStrategy:e.grainStrategy,grainCoordinateStrategy:e.grainCoordinateStrategy,grainSamplingStrategy:e.grainSamplingStrategy,grainMipStrategy:he,grainTextureFormat:`rgba8unorm`,grainTextureWidth:L,grainTextureHeight:L,grainTextureMipLevelCount:tt,grainTextureMemoryMiB:nt*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:ge,grainCoverageStrategy:e.grainCoverageStrategy,grainAdaptivePreviewStrategy:e.grainAdaptivePreviewStrategy,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,grainBatches:e.grainBatches,grainBaseStamps:e.grainBaseStamps,grainPhysicalCopies:e.grainPhysicalCopies,grainCircleBatches:e.grainCircleBatches,grainShapeBatches:e.grainShapeBatches,grainAdaptivePreviewSkips:e.grainAdaptivePreviewSkips,lightGlazeStrategy:e.lightGlazeStrategy,lightGlazeAdaptivePreviewStrategy:xe,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?bt(this.layerFormat):0,lightGlazeBatches:e.lightGlazeBatches,lightGlazeCommits:e.lightGlazeCommits,lightGlazeCompositePixels:e.lightGlazeCompositePixels,lightGlazePyramidPasses:e.lightGlazePyramidPasses,lightGlazePyramidUpdatedPixels:e.lightGlazePyramidUpdatedPixels,adaptivePreviewStrategy:Se,adaptivePreviewTriggerStrategy:we,adaptivePreviewStaleFrameStrategy:Te,adaptivePreviewVisibleCanvasStrategy:Ee,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:De,adaptivePreviewJsBudgetMs:Oe,adaptivePreviewMaxTipBaseStamps:Ae,adaptivePreviewMaxPatchCssPixels:Ne,adaptivePreviewProbeIntervalSubmissions:ze,adaptivePreviewTriggerThresholdMs:Be,adaptivePreviewSlowCompletionThresholdMs:Ve,adaptivePreviewTriggerConsecutiveProbes:He,adaptivePreviewProbeNearMissMinimumMs:Ue,adaptivePreviewProbeStarts:e.adaptivePreviewProbeStarts,adaptivePreviewProbeResolvedFast:e.adaptivePreviewProbeResolvedFast,adaptivePreviewProbeResolvedSlow:e.adaptivePreviewProbeResolvedSlow,adaptivePreviewProbeTimeouts:e.adaptivePreviewProbeTimeouts,adaptivePreviewProbeCancellations:e.adaptivePreviewProbeCancellations,adaptivePreviewProbeRejections:e.adaptivePreviewProbeRejections,adaptivePreviewProbeNearMisses:e.adaptivePreviewProbeNearMisses,adaptiveSpacingStrategy:We,adaptiveSpacingStepPercentPoints:Ge,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,adaptiveSpacingInitialPercent:e.adaptiveSpacingInitialPercent,adaptiveSpacingFinalPercent:e.adaptiveSpacingFinalPercent,adaptiveSpacingIncreaseCount:e.adaptiveSpacingEvents.length,adaptiveSpacingReachedMaximum:e.adaptiveSpacingFinalPercent>=e.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints-2**-52*8,adaptiveSpacingEvents:e.adaptiveSpacingEvents,adaptivePreviewActivations:e.adaptivePreviewActivations,adaptivePreviewActivationReason:e.adaptivePreviewActivationReason,adaptivePreviewFirstActivationReason:e.adaptivePreviewFirstActivationReason,adaptivePreviewFirstActivationMs:e.adaptivePreviewFirstActivationMs,adaptivePreviewSecondActivationReason:e.adaptivePreviewSecondActivationReason,adaptivePreviewSecondActivationMs:e.adaptivePreviewSecondActivationMs,adaptivePreviewFrames:e.adaptivePreviewFrames,adaptivePreviewBaseStampsDrawn:e.adaptivePreviewBaseStampsDrawn,adaptivePreviewPhysicalCopiesDrawn:e.adaptivePreviewPhysicalCopiesDrawn,adaptivePreviewBudgetSkips:e.adaptivePreviewBudgetSkips,adaptivePreviewConfirmedStaleBitmapHides:e.adaptivePreviewConfirmedStaleBitmapHides,adaptivePreviewIncompleteFrameRetryRequests:e.adaptivePreviewIncompleteFrameRetryRequests,adaptivePreviewOversizedSkips:e.adaptivePreviewOversizedSkips,adaptivePreviewPatchPixels:e.adaptivePreviewPatchPixels,adaptivePreviewMaxPatchBackingPixels:e.adaptivePreviewMaxPatchBackingPixels,adaptivePreviewJsTotalMs:e.adaptivePreviewJsTotalMs,adaptivePreviewJsP50Ms:R(e.adaptivePreviewJsFrameMs,.5),adaptivePreviewJsP95Ms:R(e.adaptivePreviewJsFrameMs,.95),adaptivePreviewJsMaxMs:St(e.adaptivePreviewJsFrameMs),adaptivePreviewMaxLifetimeMs:e.adaptivePreviewMaxLifetimeMs,adaptivePreviewProbeLatencyP50Ms:R(e.adaptivePreviewProbeLatencyMs,.5),adaptivePreviewProbeLatencyP95Ms:R(e.adaptivePreviewProbeLatencyMs,.95),adaptivePreviewMaxQueueProbeLatencyMs:e.adaptivePreviewMaxQueueProbeLatencyMs,adaptivePreviewProbeBacklogP50BaseStamps:R(e.adaptivePreviewProbeBacklogBaseStamps,.5),adaptivePreviewProbeBacklogP95BaseStamps:R(e.adaptivePreviewProbeBacklogBaseStamps,.95),adaptivePreviewProbeBacklogMaxBaseStamps:St(e.adaptivePreviewProbeBacklogBaseStamps),adaptivePreviewProbeTimeoutLatenessP50Ms:R(e.adaptivePreviewProbeTimeoutLatenessMs,.5),adaptivePreviewProbeTimeoutLatenessP95Ms:R(e.adaptivePreviewProbeTimeoutLatenessMs,.95),adaptivePreviewProbeTimeoutLatenessMaxMs:St(e.adaptivePreviewProbeTimeoutLatenessMs),adaptivePreviewMaxUnconfirmedBaseStamps:e.adaptivePreviewMaxUnconfirmedBaseStamps,adaptivePreviewRetirements:e.adaptivePreviewRetirements,adaptivePreviewFrozenAtLift:e.adaptivePreviewFrozenAtLift,adaptivePreviewLiftPendingBaseStamps:e.adaptivePreviewLiftPendingBaseStamps,adaptivePreviewLiftPendingSerialBindings:e.adaptivePreviewLiftPendingSerialBindings,adaptivePreviewUnsupportedBlendSkips:e.adaptivePreviewUnsupportedBlendSkips,adaptivePreviewDeferredBaseStamps:0,adaptivePreviewResolvedBaseStamps:0,adaptivePreviewExactReplayBatches:0,adaptivePreviewLiftGpuSubmissions:0,adaptivePreviewExactBaseStampsSubmitted:e.adaptivePreviewExactBaseStampsSubmitted,adaptivePreviewExactBatchesSubmitted:e.adaptivePreviewExactBatchesSubmitted,historyStorageStrategy:Qe,historyReplayStrategy:$e,historyStampRetentionStrategy:et,historyCapturedBaseStamps:e.historyCapturedBaseStamps,historyCapturedBatches:e.historyCapturedBatches,historyCommittedActions:e.historyCommittedActions,historyStoredBaseStampsAtEnd:this.historyStoredBaseStamps,historyLogicalStampBytesAtEnd:this.historyStoredBaseStamps*k,historyReplayOperations:e.historyReplayOperations,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:R(e.cpuFrameMs,.5),submitImmediateP95Ms:R(e.cpuFrameMs,.95),submitImmediateMaxMs:St(e.cpuFrameMs),renderFrameTotalP50Ms:R(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:R(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:St(e.renderFrameTotalMs),renderFrameOverheadP50Ms:R(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:R(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:St(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:R(e.cpuFrameMs,.5),cpuFrameP95Ms:R(e.cpuFrameMs,.95),cpuFrameMaxMs:St(e.cpuFrameMs),renderIntervalP50Ms:R(e.renderIntervalMs,.5),renderIntervalP95Ms:R(e.renderIntervalMs,.95),renderIntervalMaxMs:St(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:D,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:this.settings.shape===`shape`?this.lastStampGeometry:M,stampVerticesPerCopy:this.settings.shape===`shape`?this.lastStampVerticesPerCopy:j,fragmentCoverageStrategy:this.settings.shape===`shape`?N:ee,shapeSamplingStrategy:this.settings.shape===`shape`?this.lastShapeSamplingStrategy:`none`,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:this.settings.shape===`shape`?this.lastShapeOccupancyFallbackReason:`none`,shapeOccupancyGridSize:rt,shapeOccupancyMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateCoverageRatio:0,shapeOccupancyMaximumMip:st,shapeOccupancyMinimumRadius:lt,shapeOccupancyMaximumCoverageRatio:ut,shapeOccupancyBitmaskBytes:dt,colorSeedStrategy:ie,dirtyRectStrategy:ae,thicknessDynamicsStrategy:_,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsSpeedFilterTimeMs:50,thicknessDynamicsPreviewStrategy:Ce,thicknessDynamicsPreviewTextureQuantum:je,thicknessDynamicsPreviewMaximumTextureDimension:Me,presentationCacheStrategy:oe,presentationTransferStrategy:se,paintDisplayPyramidStrategy:ce,paintDisplayLodSelectionStrategy:F,paintDisplayMipLevelCount:O,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:yt(this.layerFormat),brushOpacityStrategy:le,grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainMipStrategy:he,grainTextureFormat:`rgba8unorm`,grainTextureWidth:L,grainTextureHeight:L,grainTextureMipLevelCount:tt,grainTextureMemoryMiB:nt*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:ge,grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?_e:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?ve:`legacy`,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,lightGlazeStrategy:vt(this.settings.blendMode),lightGlazeAdaptivePreviewStrategy:xe,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?bt(this.layerFormat):0,adaptivePreviewStrategy:Se,adaptivePreviewTriggerStrategy:we,adaptivePreviewStaleFrameStrategy:Te,adaptivePreviewVisibleCanvasStrategy:Ee,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:De,adaptivePreviewJsBudgetMs:Oe,adaptivePreviewMaxTipBaseStamps:Ae,adaptivePreviewMaxPatchCssPixels:Ne,adaptivePreviewProbeIntervalSubmissions:ze,adaptivePreviewTriggerThresholdMs:Be,adaptivePreviewSlowCompletionThresholdMs:Ve,adaptivePreviewTriggerConsecutiveProbes:He,adaptivePreviewProbeNearMissMinimumMs:Ue,adaptiveSpacingStrategy:We,adaptiveSpacingStepPercentPoints:Ge,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,historyStorageStrategy:Qe,historyReplayStrategy:$e,historyStampRetentionStrategy:et}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:ft,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailBrushUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail brush uniforms`,size:ft,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.grainUniformBuffer=this.device.createBuffer({label:`Texturized grain uniforms`,size:pt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:mt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailDisplayUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail display uniforms`,size:gt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.lightGlazeUniformBuffer=this.device.createBuffer({label:`Light Glaze stroke opacity`,size:ht,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:A*k,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.thicknessTailInstanceBuffer=this.device.createBuffer({label:`Predictive thickness tail instance storage`,size:A*k,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.shapeMaskSampler=this.device.createSampler({label:`Shape 2K mask sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`});let e=(e,t)=>({no:this.device.createSampler({label:`Cotton Fleece M1 ${e} no filtering`,magFilter:`nearest`,minFilter:`nearest`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t}),classic:this.device.createSampler({label:`Cotton Fleece M1 ${e} classic filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:t,addressModeV:t}),improved:this.device.createSampler({label:`Cotton Fleece M1 ${e} improved filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t})});this.grainSamplers={fixed:e(`fixed`,`repeat`),moving:e(`moving`,`clamp-to-edge`)};let t=await this.createGrainTextureResources();this.grainTexture=t.texture,this.grainTextureView=this.grainTexture.createView({label:`Cotton Fleece M1 native grain full mip view`}),this.grainTextureIdentity=t.identity,this.grainStartupDecodeMs=t.decodeMs,this.grainStartupMipBuildMs=t.mipBuildMs,this.grainStartupUploadMs=t.uploadMs;let n=await this.createShapeMaskResources();this.shapeMaskTexture=n.texture,this.shapeMaskView=this.shapeMaskTexture.createView({label:`Shape 2K mask view`}),this.shapeMaskDecodeStrategy=n.decodeStrategy,this.shapeMaskIdentity=n.identity,this.shapeOccupancyActiveCells=n.occupancyActiveCells,this.shapeOccupancyCoverageRatios=n.occupancyCoverageRatios,this.adaptivePreviewShapeSprite=n.previewSprite,this.shapeOccupancyUniformBuffers=Array.from({length:ct},(e,t)=>{let r=this.device.createBuffer({label:`Shape conservative occupancy bitmask mip ${t}`,size:dt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),i=t*ot;return this.device.queue.writeBuffer(r,0,n.occupancyWords.subarray(i,i+ot)),r});let r=[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}];this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush legacy bind group layout`,entries:r}),this.brushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Brush occupancy bind group layout`,entries:[...r,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.lightGlazeDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze live display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.thicknessTailDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Predictive thickness tail display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]});let i=[...r,{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:7,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}];this.grainBrushBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain brush bind group layout`,entries:i}),this.grainBrushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain occupancy brush bind group layout`,entries:[...i,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeMipBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze composited mip 1 bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze final composite bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.paintMipDownsampleBindGroupLayout=this.device.createBindGroupLayout({label:`Paint display mip downsample bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.brushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]})),this.thicknessTailBrushBindGroup=this.device.createBindGroup({label:`Predictive thickness tail brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.thicknessTailBrushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Predictive thickness tail brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]}));let a=[`no`,`classic`,`improved`],o=[`fixed`,`moving`];this.grainBrushBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.device.createBindGroup({label:`Texturized M1 ${e} brush bind group ${t}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.grainBrushOccupancyBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Texturized M1 ${e} occupancy bind group ${t} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))])),this.thicknessTailGrainBrushBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.device.createBindGroup({label:`Predictive thickness tail ${e} grain bind group ${t}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.thicknessTailGrainBrushOccupancyBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Predictive thickness tail ${e} grain occupancy ${t} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))])),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:c}),this.texturizedGrainShaderModule=this.device.createShaderModule({label:`Texturized grain fragment WGSL`,code:l}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:d}),this.thicknessTailDisplayShaderModule=this.device.createShaderModule({label:`Predictive thickness tail display WGSL`,code:f}),this.lightGlazeDisplayShaderModule=this.device.createShaderModule({label:`Light Glaze live display WGSL`,code:p}),this.lightGlazeCompositeMipShaderModule=this.device.createShaderModule({label:`Light Glaze composited mip 1 WGSL`,code:m}),this.lightGlazeCompositeShaderModule=this.device.createShaderModule({label:`Light Glaze final composite WGSL`,code:h}),this.paintMipDownsampleShaderModule=this.device.createShaderModule({label:`Paint display mip downsample WGSL`,code:g}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.texturizedGrainShaderModule,`Texturized grain fragment`),this.assertShaderCompiled(this.displayShaderModule,`display`),this.assertShaderCompiled(this.thicknessTailDisplayShaderModule,`predictive thickness tail display`),this.assertShaderCompiled(this.lightGlazeDisplayShaderModule,`Light Glaze live display`),this.assertShaderCompiled(this.lightGlazeCompositeMipShaderModule,`Light Glaze composited mip 1`),this.assertShaderCompiled(this.lightGlazeCompositeShaderModule,`Light Glaze final composite`),this.assertShaderCompiled(this.paintMipDownsampleShaderModule,`paint display mip downsample`)]);let s=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:s,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let u=this.device.createPipelineLayout({label:`Predictive thickness tail display pipeline layout`,bindGroupLayouts:[this.thicknessTailDisplayBindGroupLayout]});this.thicknessTailDisplayPipeline=this.device.createRenderPipeline({label:`Predictive thickness tail display pipeline`,layout:u,vertex:{module:this.thicknessTailDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.thicknessTailDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let _=this.device.createPipelineLayout({label:`Light Glaze live display pipeline layout`,bindGroupLayouts:[this.lightGlazeDisplayBindGroupLayout]});this.lightGlazeDisplayPipeline=this.device.createRenderPipeline({label:`Light Glaze live display pipeline`,layout:_,vertex:{module:this.lightGlazeDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async createGrainTextureResources(){let e=await fetch(new URL(``+new URL(`graincottonfleece-P6Krz_AB.PNG`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Cotton Fleece M1 originale (${e.status}).`);let t=await e.arrayBuffer(),n=performance.now(),r=await createImageBitmap(new Blob([t],{type:`image/png`}),{colorSpaceConversion:`default`,premultiplyAlpha:`none`}),i=performance.now()-n;if(r.width!==L||r.height!==L)throw r.close(),Error(`Il grain M1 originale deve restare ${L}×${L}px; trovata ${r.width}×${r.height}px.`);let a=this.device.createTexture({label:`Cotton Fleece M1 original 2500 RGBA grain`,size:{width:L,height:L,depthOrArrayLayers:1},mipLevelCount:tt,format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),o=performance.now();this.device.queue.copyExternalImageToTexture({source:r},{texture:a,mipLevel:0,premultipliedAlpha:!1,colorSpace:`srgb`},{width:L,height:L,depthOrArrayLayers:1});let s=performance.now()-o;r.close();let c=performance.now(),l=this.device.createShaderModule({label:`Cotton Fleece M1 mip generation WGSL`,code:u});await this.assertShaderCompiled(l,`Cotton Fleece M1 mip generation`);let d=this.device.createBindGroupLayout({label:`Cotton Fleece M1 mip generation bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),f=this.device.createRenderPipeline({label:`Cotton Fleece M1 mip generation pipeline`,layout:this.device.createPipelineLayout({label:`Cotton Fleece M1 mip generation pipeline layout`,bindGroupLayouts:[d]}),vertex:{module:l,entryPoint:`vertexMain`},fragment:{module:l,entryPoint:`fragmentMain`,targets:[{format:`rgba8unorm`}]},primitive:{topology:`triangle-list`}}),p=this.device.createSampler({label:`Cotton Fleece M1 mip generation linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),m=this.device.createCommandEncoder({label:`Cotton Fleece M1 full mip chain encoder`});for(let e=1;e<tt;e+=1){let t=a.createView({label:`Cotton Fleece M1 mip ${e-1} source`,baseMipLevel:e-1,mipLevelCount:1}),n=a.createView({label:`Cotton Fleece M1 mip ${e} target`,baseMipLevel:e,mipLevelCount:1}),r=this.device.createBindGroup({label:`Cotton Fleece M1 mip ${e} bind group`,layout:d,entries:[{binding:0,resource:t},{binding:1,resource:p}]}),i=m.beginRenderPass({label:`Cotton Fleece M1 build mip ${e}`,colorAttachments:[{view:n,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});i.setPipeline(f),i.setBindGroup(0,r),i.draw(3,1,0,0),i.end()}this.device.queue.submit([m.finish()]),await this.device.queue.onSubmittedWorkDone();let h=performance.now()-c;return{texture:a,identity:xt(new Uint8Array(t)),decodeMs:i,mipBuildMs:h,uploadMs:s}}async decodeShapeMaskWithCanvas(e){let t=await createImageBitmap(new Blob([e],{type:`image/png`}),{colorSpaceConversion:`none`,premultiplyAlpha:`none`});try{if(t.width!==I||t.height!==I)throw Error(`Shape.png deve restare ${I}×${I}px; trovata ${t.width}×${t.height}px.`);let e=document.createElement(`canvas`);e.width=I,e.height=I;let n=e.getContext(`2d`,{willReadFrequently:!0});if(!n)throw Error(`Impossibile leggere la maschera Shape.png.`);n.drawImage(t,0,0);let r=n.getImageData(0,0,I,I).data,i=new Uint8Array(I*I);for(let e=0,t=0;e<i.length;e+=1,t+=4){let n=Math.round(r[t]*.2126+r[t+1]*.7152+r[t+2]*.0722);i[e]=Math.round(n*r[t+3]/255)}return i}finally{t.close()}}async createShapeMaskResources(){let e=await fetch(new URL(``+new URL(`Shape-BcXQOKCm.png`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Shape.png (${e.status}).`);let t=await e.arrayBuffer(),n,r;try{let e=await s(t);if(e.width!==I||e.height!==I)throw Error(`Shape.png deve restare ${I}×${I}px; trovata ${e.width}×${e.height}px.`);n=e.pixels,r=ne}catch{n=await this.decodeShapeMaskWithCanvas(t),r=re}let i=Math.log2(I)+1,a=this.device.createTexture({label:`Shape 2K white-times-alpha mask`,size:{width:I,height:I,depthOrArrayLayers:1},mipLevelCount:i,format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),o=n,c=I,l=[];for(let e=0;e<i;e+=1){e<=st&&l.push(o);let t=Math.ceil(c/256)*256,n=o;if(t!==c){n=new Uint8Array(t*c);for(let e=0;e<c;e+=1)n.set(o.subarray(e*c,(e+1)*c),e*t)}if(this.device.queue.writeTexture({texture:a,mipLevel:e},n,{offset:0,bytesPerRow:t,rowsPerImage:c},{width:c,height:c,depthOrArrayLayers:1}),c===1)continue;let r=c/2,i=new Uint8Array(r*r);for(let e=0;e<r;e+=1)for(let t=0;t<r;t+=1){let n=e*2*c+t*2;i[e*r+t]=Math.round((o[n]+o[n+1]+o[n+c]+o[n+c+1])/4)}o=i,c=r}let u=kt(l),d=l[st],f=document.createElement(`canvas`);f.width=128,f.height=128;let p=f.getContext(`2d`);if(p&&d){let e=p.createImageData(128,128);for(let t=0;t<d.length;t+=1){let n=t*4;e.data[n]=255,e.data[n+1]=255,e.data[n+2]=255,e.data[n+3]=d[t]}p.putImageData(e,0,0)}return{texture:a,decodeStrategy:r,identity:xt(n),occupancyWords:u.words,occupancyActiveCells:u.activeCells,occupancyCoverageRatios:u.coverageRatios,previewSprite:f}}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:D,height:D,depthOrArrayLayers:1},mipLevelCount:O,format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView({label:`Paint layer authoritative mip 0 ${e}`,baseMipLevel:0,mipLevelCount:1}),i=n.createView({label:`Paint layer display mip chain ${e}`,baseMipLevel:0,mipLevelCount:O}),a=Array.from({length:O},(t,r)=>n.createView({label:`Paint layer mip ${r} ${e}`,baseMipLevel:r,mipLevelCount:1})),o=this.device.createPipelineLayout({label:`Brush legacy pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]}),s=this.device.createPipelineLayout({label:`Brush occupancy pipeline layout ${e}`,bindGroupLayouts:[this.brushOccupancyBindGroupLayout]}),c=this.device.createPipelineLayout({label:`Texturized grain brush pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushBindGroupLayout]}),l=this.device.createPipelineLayout({label:`Texturized grain occupancy pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushOccupancyBindGroupLayout]}),u=this.device.createPipelineLayout({label:`Paint display mip downsample pipeline layout ${e}`,bindGroupLayouts:[this.paintMipDownsampleBindGroupLayout]}),d=this.device.createPipelineLayout({label:`Light Glaze composited mip 1 pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeMipBindGroupLayout]}),f=this.device.createPipelineLayout({label:`Light Glaze final composite pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeBindGroupLayout]});this.device.pushErrorScope(`validation`);let p=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:o,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),m=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:o,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),h=this.device.createRenderPipeline({label:`Brush shape 2K legacy normal ${e}`,layout:o,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),g=this.device.createRenderPipeline({label:`Brush shape 2K legacy additive ${e}`,layout:o,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),_=this.device.createRenderPipeline({label:`Brush shape 2K occupancy normal ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),v=this.device.createRenderPipeline({label:`Brush shape 2K occupancy additive ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),y=this.device.createRenderPipeline({label:`Brush Texturized grain normal ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),b=this.device.createRenderPipeline({label:`Brush Texturized grain additive ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),x=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain normal ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),S=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain additive ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),C=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain normal ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),w=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain additive ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),T=(t,n,r,i,a)=>this.device.createRenderPipeline({label:t,layout:n,vertex:{module:this.brushShaderModule,entryPoint:i},fragment:{module:r,entryPoint:a,targets:[{format:e,blend:{color:{operation:`max`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`max`,srcFactor:`one`,dstFactor:`one`}}}]},primitive:{topology:`triangle-strip`}}),E=T(`Brush M1 Glaze circle MAX coverage ${e}`,o,this.brushShaderModule,`vertexMain`,`coverageFragmentMain`),k=T(`Brush M1 Glaze Shape MAX coverage ${e}`,o,this.brushShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),A=T(`Brush M1 Glaze Shape occupancy MAX coverage ${e}`,s,this.brushShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),j=T(`Brush M1 Glaze Texturized circle MAX coverage ${e}`,c,this.texturizedGrainShaderModule,`vertexMain`,`coverageFragmentMain`),M=T(`Brush M1 Glaze Texturized Shape MAX coverage ${e}`,c,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),ee=T(`Brush M1 Glaze Texturized Shape occupancy MAX coverage ${e}`,l,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),N=this.device.createRenderPipeline({label:`Light Glaze composited mip 1 ${e}`,layout:d,vertex:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),P=this.device.createRenderPipeline({label:`Light Glaze final source-over composite ${e}`,layout:f,vertex:{module:this.lightGlazeCompositeShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-list`}}),te=this.device.createRenderPipeline({label:`Paint display mip downsample ${e}`,layout:u,vertex:{module:this.paintMipDownsampleShaderModule,entryPoint:`vertexMain`},fragment:{module:this.paintMipDownsampleShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),ne=await this.device.popErrorScope();if(ne)throw n.destroy(),Error(ne.message);let re=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:i},{binding:2,resource:this.sampler}]}),ie=a.slice(0,O-1).map((t,n)=>this.device.createBindGroup({label:`Paint display mip ${n} to ${n+1} ${e}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:t}]}));this.destroyLightGlazeResources(),this.destroyThicknessTailOverlayResources(),this.layerTexture=n,this.layerView=r,this.layerSamplingView=i,this.paintMipViews=a,this.paintMipDownsampleBindGroups=ie,this.normalPipeline=p,this.additivePipeline=m,this.shapeNormalPipeline=h,this.shapeAdditivePipeline=g,this.shapeOccupancyNormalPipeline=_,this.shapeOccupancyAdditivePipeline=v,this.grainNormalPipeline=y,this.grainAdditivePipeline=b,this.grainShapeNormalPipeline=x,this.grainShapeAdditivePipeline=S,this.grainShapeOccupancyNormalPipeline=C,this.grainShapeOccupancyAdditivePipeline=w,this.m1GlazePipeline=E,this.m1GlazeShapePipeline=k,this.m1GlazeShapeOccupancyPipeline=A,this.grainM1GlazePipeline=j,this.grainM1GlazeShapePipeline=M,this.grainM1GlazeShapeOccupancyPipeline=ee,this.lightGlazeCompositeMipPipeline=N,this.lightGlazeCompositePipeline=P,this.paintMipDownsamplePipeline=te,this.displayBindGroup=re,this.layerFormat=e,this.paintDisplayMipValidThroughLevel=0,this.paintDisplaySelectedMipLevel=0,this.presentationCacheNeedsFullRebuild=!0,t?.destroy()}ensureThicknessTailOverlayResources(e,n){let r=t(Math.ceil(Math.max(1,e)/je)*je,je,Me),i=t(Math.ceil(Math.max(1,n)/je)*je,je,Me);if(this.thicknessTailTexture&&this.thicknessTailView&&this.thicknessTailDisplayBindGroup&&this.thicknessTailTextureWidth>=r&&this.thicknessTailTextureHeight>=i)return;let a=Math.max(this.thicknessTailTextureWidth,r),o=Math.max(this.thicknessTailTextureHeight,i),s=this.device.createTexture({label:`Predictive thickness tail ${a}×${o} ${this.layerFormat}`,size:{width:a,height:o,depthOrArrayLayers:1},format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),c=s.createView({label:`Predictive thickness tail view`}),l=this.device.createBindGroup({label:`Predictive thickness tail display bind group`,layout:this.thicknessTailDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:this.sampler},{binding:3,resource:c},{binding:4,resource:{buffer:this.thicknessTailDisplayUniformBuffer}}]}),u=this.thicknessTailTexture;this.thicknessTailTexture=s,this.thicknessTailView=c,this.thicknessTailDisplayBindGroup=l,this.thicknessTailTextureWidth=a,this.thicknessTailTextureHeight=o,u?.destroy()}destroyThicknessTailOverlayResources(){this.thicknessTailTexture?.destroy(),this.thicknessTailTexture=null,this.thicknessTailView=null,this.thicknessTailDisplayBindGroup=null,this.thicknessTailTextureWidth=0,this.thicknessTailTextureHeight=0,this.thicknessTailPresentedRect=null}ensureLightGlazeResources(){if(this.lightGlazeTexture&&this.lightGlazeView&&this.lightGlazeSamplingView&&this.lightGlazeCompositeMipBindGroup&&this.lightGlazeDisplayBindGroup&&this.lightGlazeCompositeBindGroup)return;let e=this.device.createTexture({label:`Lazy Light Glaze stroke accumulator ${this.layerFormat}`,size:{width:D,height:D,depthOrArrayLayers:1},mipLevelCount:O,format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),t=e.createView({label:`Light Glaze authoritative stroke mip 0`,baseMipLevel:0,mipLevelCount:1}),n=e.createView({label:`Light Glaze live display mip chain`,baseMipLevel:0,mipLevelCount:O}),r=Array.from({length:O},(t,n)=>e.createView({label:`Light Glaze stroke mip ${n}`,baseMipLevel:n,mipLevelCount:1})),i=r.slice(0,O-1).map((e,t)=>this.device.createBindGroup({label:`Light Glaze mip ${t} to ${t+1}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:e}]})),a=this.device.createBindGroup({label:`Light Glaze permanent + stroke to composited mip 1`,layout:this.lightGlazeCompositeMipBindGroupLayout,entries:[{binding:0,resource:this.layerView},{binding:1,resource:t},{binding:2,resource:{buffer:this.lightGlazeUniformBuffer}}]}),o=this.device.createBindGroup({label:`Light Glaze live display bind group`,layout:this.lightGlazeDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:n},{binding:3,resource:this.sampler},{binding:4,resource:{buffer:this.lightGlazeUniformBuffer}}]}),s=this.device.createBindGroup({label:`Light Glaze final composite bind group`,layout:this.lightGlazeCompositeBindGroupLayout,entries:[{binding:0,resource:t},{binding:1,resource:{buffer:this.lightGlazeUniformBuffer}}]});this.lightGlazeTexture=e,this.lightGlazeView=t,this.lightGlazeSamplingView=n,this.lightGlazeMipViews=r,this.lightGlazeMipDownsampleBindGroups=i,this.lightGlazeCompositeMipBindGroup=a,this.lightGlazeDisplayBindGroup=o,this.lightGlazeCompositeBindGroup=s,this.lightGlazeStorageAllocated=!0}destroyLightGlazeResources(){this.lightGlazeSession=null,this.lightGlazeTexture?.destroy(),this.lightGlazeTexture=null,this.lightGlazeView=null,this.lightGlazeSamplingView=null,this.lightGlazeMipViews=[],this.lightGlazeMipDownsampleBindGroups=[],this.lightGlazeCompositeMipBindGroup=null,this.lightGlazeDisplayBindGroup=null,this.lightGlazeCompositeBindGroup=null,this.lightGlazeStorageAllocated=!1}startLightGlazeSession(e,n){if(this.lightGlazeSession)throw Error(`Un tratto Light Glaze precedente non è ancora stato finalizzato.`);this.ensureLightGlazeResources(),this.lightGlazeSession={historyActionId:e,settings:{...n,opacity:Number.isFinite(n.opacity)?t(n.opacity,0,1):1,blendMode:n.blendMode===`m1-glaze`?`m1-glaze`:`light-glaze`},dirtyRect:null,needsClear:!0,hasContent:!1,endRequested:!1,commitRequested:!1,mipValidThroughLevel:0,tintLinear:null}}abandonLightGlazeSession(){this.lightGlazeSession&&(this.lightGlazeSession=null,this.presentationCacheNeedsFullRebuild=!0)}flushClosingLightGlazeSessionBeforeNewStroke(){if(!this.lightGlazeSession?.endRequested)return;let e=0,t=Math.ceil(this.pendingStamps.length/A)+2;for(;this.lightGlazeSession?.endRequested;)if(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.renderFrame(performance.now()),e+=1,e>t)throw Error(`Impossibile finalizzare il tratto Light Glaze precedente.`)}flushPendingWorkBeforeSettingsChange(){if(!this.initialized||this.activeStroke||this.historyBusy||(this.flushClosingLightGlazeSessionBeforeNewStroke(),this.lightGlazeSession||this.pendingStamps.length===0))return;let e=0,t=Math.ceil(this.pendingStamps.length/A)+1;for(;this.pendingStamps.length>0;){this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null);let n=this.pendingStamps.length;if(this.renderFrame(performance.now()),e+=1,this.pendingStamps.length>=n||e>t)throw Error(`Impossibile finalizzare gli stamp prima del cambio impostazioni.`)}}writeLightGlazeUniforms(e,n,r){let i=new ArrayBuffer(ht),a=new Float32Array(i),o=new Uint32Array(i);a[0]=Number.isFinite(e)?t(e,0,1):1,o[1]=+(this.layerFormat===`rgba16float`),o[2]=+(n===`m1-max-coverage`),a[4]=r?.[0]??0,a[5]=r?.[1]??0,a[6]=r?.[2]??0,a[7]=1,this.device.queue.writeBuffer(this.lightGlazeUniformBuffer,0,i)}mergeDirtyRects(e,t){if(!e)return t?{...t}:null;if(!t)return{...e};let n=Math.min(e.x,t.x),r=Math.min(e.y,t.y),i=Math.max(e.x+e.width,t.x+t.width),a=Math.max(e.y+e.height,t.y+t.height);return{x:n,y:r,width:i-n,height:a-r}}encodeLightGlazeDisplayPyramid(e,t,n,r){let i=t.mipValidThroughLevel,a=n!==null,o=n,s=0,c=0;for(let t=1;t<=r;t+=1){let n=this.paintMipDimensions(t),r=t>i,a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null;if(!a||a.width<=0||a.height<=0)continue;let l=e.beginRenderPass({label:r?`Build full Light Glaze final-composite mip ${t}`:`Update Light Glaze final-composite mip ${t} dirty rect`,colorAttachments:[{view:this.lightGlazeMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});t===1?(l.setPipeline(this.lightGlazeCompositeMipPipeline),l.setBindGroup(0,this.lightGlazeCompositeMipBindGroup)):(l.setPipeline(this.paintMipDownsamplePipeline),l.setBindGroup(0,this.lightGlazeMipDownsampleBindGroups[t-1])),r||l.setScissorRect(a.x,a.y,a.width,a.height),l.draw(3,1,0,0),l.end(),s+=1,c+=a.width*a.height,o=a}return(a||r>i)&&(t.mipValidThroughLevel=r),{passes:s,updatedPixels:c}}isTexturizedGrainActive(e){return(e.grainMode===`texturized`||e.grainMode===`moving`)&&e.grainBlendMode===`multiply`&&e.grainDepth>0}grainCoordinateMode(e){return e.grainMode===`moving`?`moving`:`fixed`}grainStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?fe:de:ue}grainCoordinateStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?me:pe:`none`}grainSamplingStrategy(e){if(!this.isTexturizedGrainActive(e))return`none`;let t=e.grainMode===`moving`;return e.grainFiltering===`no`?t?`clamp-nearest`:`repeat-nearest`:e.grainFiltering===`classic`?t?`clamp-linear-mip-nearest`:`repeat-linear-mip-nearest`:t?`clamp-linear-trilinear`:`repeat-linear-trilinear`}writeGrainUniforms(e){let n=this.grainUniformUpload,r=new Uint32Array(n.buffer);n.fill(0);let i=t(e.grainScale,.1,4),a=e.grainInvert?-1:1;n[0]=1/(L*i),n[1]=t(e.grainDepth,0,1),n[2]=t(e.grainBrightness,-1,1)*a,n[3]=(1+t(e.grainContrast,-1,1))*a,r[4]=e.grainFiltering===`no`?0:e.grainFiltering===`classic`?1:2,r[5]=+(e.grainMode===`moving`),this.device.queue.writeBuffer(this.grainUniformBuffer,0,n)}populateBrushUniformUpload(n,r,i,a,o,s){let c=new Float32Array(n),l=new Uint32Array(n);c.fill(0);let[u,d,f]=e(r.color),p=r.jitterMaster;c[0]=i,c[1]=a,c[2]=o,c[3]=s,c[4]=u,c[5]=d,c[6]=f,c[7]=Number.isFinite(r.opacity)?t(r.opacity,0,1):1,c[8]=r.hueJitterDegrees/360*p,c[9]=r.saturationJitter*p,c[10]=r.lightnessJitter*p,c[11]=r.darknessJitter*p,c[12]=r.flow,c[13]=r.hardness,c[14]=r.blendIntensity,c[15]=r.pressureOpacity,c[16]=r.positionJitterLinear,c[17]=r.positionJitterLateral,c[18]=r.shapeScatter,l[20]=r.count>>>0,l[21]=+!!r.jitterPerCopy,l[22]=+(r.blendMode===`additive`),l[23]=0}writeBrushUniforms(e=this.settings){this.populateBrushUniformUpload(this.brushUniformUpload,e,D,D,0,0),this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeThicknessTailBrushUniforms(e,t,n,r,i){this.populateBrushUniformUpload(this.thicknessTailBrushUniformUpload,e,t,n,r,i),this.device.queue.writeBuffer(this.thicknessTailBrushUniformBuffer,0,this.thicknessTailBrushUniformUpload)}desiredPaintDisplayMipLevel(){return!Number.isFinite(this.zoom)||this.zoom>=1?0:t(Math.floor(Math.log2(1/Math.max(this.zoom,2**-52))+1e-6),0,O-1)}paintMipDimensions(e){let t=Math.max(1,D>>e);return{width:t,height:t}}downsampleDirtyRect(e,t){let{width:n,height:r}=this.paintMipDimensions(t),i=Math.max(0,Math.floor(e.x/2)),a=Math.max(0,Math.floor(e.y/2)),o=Math.min(n,Math.ceil((e.x+e.width)/2)),s=Math.min(r,Math.ceil((e.y+e.height)/2));return{x:i,y:a,width:Math.max(0,o-i),height:Math.max(0,s-a)}}encodePaintDisplayPyramid(e,t,n){let r=performance.now(),i=this.paintDisplayMipValidThroughLevel,a=t!==null,o=t,s=0,c=0,l=0,u=0;for(let t=1;t<=n;t+=1){let n=this.paintMipDimensions(t),r=t>i,a;if(a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null,!a||a.width<=0||a.height<=0)continue;let d=e.beginRenderPass({label:r?`Build full paint display mip ${t}`:`Update paint display mip ${t} dirty rect`,colorAttachments:[{view:this.paintMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});d.setPipeline(this.paintMipDownsamplePipeline),d.setBindGroup(0,this.paintMipDownsampleBindGroups[t-1]),r||d.setScissorRect(a.x,a.y,a.width,a.height),d.draw(3,1,0,0),d.end(),l+=1,u+=a.width*a.height,r?s+=1:c+=1,o=a}return(a||n>i)&&(this.paintDisplayMipValidThroughLevel=n),{maintenanceFrames:+(l>0),fullLevelBuilds:s,dirtyLevelUpdates:c,passes:l,baseDirtyPixels:t?t.width*t.height:0,updatedPixels:u,encodingMs:l>0?performance.now()-r:0}}writeDisplayUniforms(e=this.paintDisplaySelectedMipLevel){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=D,this.displayUniformUpload[3]=D,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.displayUniformUpload[8]=e,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}writeThicknessTailDisplayUniforms(e,t,n){let r=new Float32Array(this.thicknessTailDisplayUniformUpload),i=new Uint32Array(this.thicknessTailDisplayUniformUpload);r.fill(0),r[0]=e,r[1]=t,r[2]=this.thicknessTailTextureWidth,r[3]=this.thicknessTailTextureHeight,i[4]=+(n.blendMode===`additive`),this.device.queue.writeBuffer(this.thicknessTailDisplayUniformBuffer,0,this.thicknessTailDisplayUniformUpload)}ensurePresentationCacheTexture(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);if(this.presentationCacheTexture&&this.presentationCacheView&&this.presentationCacheWidth===e&&this.presentationCacheHeight===t)return;let n=this.presentationCacheTexture,r=this.device.createTexture({label:`Persistent presentation cache ${e}×${t}`,size:{width:e,height:t,depthOrArrayLayers:1},format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});this.presentationCacheTexture=r,this.presentationCacheView=r.createView({label:`Persistent presentation cache view`}),this.presentationCacheWidth=e,this.presentationCacheHeight=t,this.presentationCacheNeedsFullRebuild=!0,n?.destroy()}layerDirtyRectToPresentationRect(e,t){let n=this.canvas.width,r=this.canvas.height;if(n<=0||r<=0)return null;let i=Math.max(2,2**(t+1)),a=e.x-i,o=e.y-i,s=e.x+e.width+i,c=e.y+e.height+i,l=(a-this.viewCenterX)*this.zoom+n*.5,u=(o-this.viewCenterY)*this.zoom+r*.5,d=(s-this.viewCenterX)*this.zoom+n*.5,f=(c-this.viewCenterY)*this.zoom+r*.5,p=Math.max(0,Math.floor(Math.min(l,d))-1),m=Math.max(0,Math.floor(Math.min(u,f))-1),h=Math.min(n,Math.ceil(Math.max(l,d))+1),g=Math.min(r,Math.ceil(Math.max(u,f))+1),_=Math.max(0,h-p),v=Math.max(0,g-m);return _>0&&v>0?{x:p,y:m,width:_,height:v}:null}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1),timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;let i=r.lastInput,a={...e,timeMs:Math.max(i.timeMs,Number.isFinite(e.timeMs)?e.timeMs:i.timeMs)},o=a.x-i.x,s=a.y-i.y,c=Math.hypot(o,s),l=a.timeMs-i.timeMs;if(l>0&&(r.filteredSpeedPxPerMs=b(r.filteredSpeedPxPerMs,c/l,l,r.speedFilterInitialized),r.speedFilterInitialized=!0),this.releaseHeldThicknessStamps(a.timeMs,!1),c<=1e-4){r.lastInput=a,this.recordStampGenerationTime(n);return}let u=r.lightGlazeSettings??this.settings,d=Math.max(.1,u.size*(r.adaptiveSpacingPercent/100)),f=o/c,p=s/c,m=0,h=r.distanceSinceStamp,g=0;for(;h+(c-m)>=d;){let e=d-h;m+=e;let n=t(m/c,0,1);if(this.emitStamp({x:i.x+o*n,y:i.y+s*n,pressure:i.pressure+(a.pressure-i.pressure)*n,timeMs:i.timeMs+l*n},f,p),h=0,g+=1,g>=A)break}h+=Math.max(0,c-m),r.lastInput=a,r.distanceSinceStamp=h,this.releaseHeldThicknessStamps(a.timeMs,!1),this.recordStampGenerationTime(n)}emitStamp(e,n,r){let i=this.activeStroke;if(!i)return;let a=i.lightGlazeSettings??this.settings,o=t(e.pressure,.01,1),s=1-a.pressureSize+a.pressureSize*Math.max(.08,o),c=Math.max(.5,a.size*.5*s),l=i.thicknessDynamicsNeutral?1:x(i.filteredSpeedPxPerMs,a.size,i.thicknessSettings.speedThickness),u=i.thicknessDynamicsNeutral?1:S(i.thicknessSettings.startThickness,l,Math.max(0,e.timeMs-i.startedAtMs)),d=i.thicknessDynamicsNeutral?c:c*u,f=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,p={x:e.x,y:e.y,radius:d,pressure:o,seed:f,directionX:n,directionY:r,historyActionId:i.historyActionId};if(i.thicknessTailHoldback){i.heldThicknessStamps.push({stamp:p,timeMs:e.timeMs,baseRadius:c,liveThicknessFactor:u}),this.activeStrokeProfile&&(this.activeStrokeProfile.thicknessDynamicsHeldBaseStamps+=1,this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps=Math.max(this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps,i.heldThicknessStamps.length-i.heldThicknessHead)),this.displayDirty=!0,this.requestRender();return}this.commitThicknessStamp(p,i)}releaseHeldThicknessStamps(e,t){let n=this.activeStroke;if(!n||!n.thicknessTailHoldback)return;let r=n.heldThicknessStamps,i=0;for(;n.heldThicknessHead<r.length;){let a=r[n.heldThicknessHead],o=Math.max(0,e-a.timeMs);if(!t&&o<100)break;a.stamp.radius=t?w(a.baseRadius,a.liveThicknessFactor,n.thicknessSettings.endThickness,o):a.baseRadius*a.liveThicknessFactor,this.commitThicknessStamp(a.stamp,n),n.heldThicknessHead+=1,i+=1}i>0&&this.activeStrokeProfile&&(t?this.activeStrokeProfile.thicknessDynamicsReleasedAtLift+=i:this.activeStrokeProfile.thicknessDynamicsReleasedDuringStroke+=i),n.heldThicknessHead===r.length?(n.heldThicknessStamps=[],n.heldThicknessHead=0):n.heldThicknessHead>=1024&&(n.heldThicknessStamps=r.slice(n.heldThicknessHead),n.heldThicknessHead=0)}thicknessTailReferenceTimeMs(){let e=this.activeStroke;return e?Math.max(e.lastInput.timeMs,performance.now()):performance.now()}thicknessTailPreviewEligible(){let e=this.activeStroke;return!e||!e.thicknessTailHoldback||e.lightGlazeSettings||e.heldThicknessHead>=e.heldThicknessStamps.length?!1:this.settings.blendMode===`normal`||this.settings.blendMode===`additive`}prepareThicknessTailFrame(){let e=this.activeStroke;if(!e||!this.thicknessTailPreviewEligible())return null;let t=this.settings,n=e.heldThicknessStamps,r=Math.max(e.heldThicknessHead,n.length-A),i=this.thicknessTailReferenceTimeMs(),a=[];for(let t=r;t<n.length;t+=1){let r=n[t],o=w(r.baseRadius,r.liveThicknessFactor,e.thicknessSettings.endThickness,Math.max(0,i-r.timeMs));!Number.isFinite(o)||o<=0||a.push({...r.stamp,radius:o})}if(a.length===0)return null;let o=this.packThicknessTailStamps(a,t);return o.dirtyRect?(this.ensureThicknessTailOverlayResources(o.dirtyRect.width,o.dirtyRect.height),this.writeThicknessTailBrushUniforms(t,this.thicknessTailTextureWidth,this.thicknessTailTextureHeight,o.dirtyRect.x,o.dirtyRect.y),this.writeThicknessTailDisplayUniforms(o.dirtyRect.x,o.dirtyRect.y,t),this.device.queue.writeBuffer(this.thicknessTailInstanceBuffer,0,this.thicknessTailInstanceUpload,0,a.length*k),{settings:t,stamps:a,dirtyRect:o.dirtyRect,shapeOccupancySelection:t.shape===`shape`?this.selectShapeOccupancy(o.minimumRadius):null,grainActive:this.isTexturizedGrainActive(t)}):null}encodeThicknessTailFrame(e,t){let n=t.settings,r=n.shape===`shape`,i=t.shapeOccupancySelection?.selectedMipLevel??null,a=r&&i!==null,o=t.grainActive?r?a?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:r?a?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline,s=t.grainActive?a?this.thicknessTailGrainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][i]:this.thicknessTailGrainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.thicknessTailBrushOccupancyBindGroups[i]:this.thicknessTailBrushBindGroup,c=e.beginRenderPass({label:`Rebuild predictive thickness tail`,colorAttachments:[{view:this.thicknessTailView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});c.setPipeline(o),c.setBindGroup(0,s),c.setScissorRect(0,0,t.dirtyRect.width,t.dirtyRect.height),c.draw(j,t.stamps.length*n.count,0,0),c.end();let l=this.activeStrokeProfile;l&&(l.thicknessDynamicsPreviewFrames+=1,l.thicknessDynamicsPreviewBaseStamps+=t.stamps.length,l.thicknessDynamicsPreviewPhysicalCopies+=t.stamps.length*n.count,l.thicknessDynamicsPreviewMaximumTexturePixels=Math.max(l.thicknessDynamicsPreviewMaximumTexturePixels,this.thicknessTailTextureWidth*this.thicknessTailTextureHeight))}commitThicknessStamp(e,t){if(e.radius<=0)return;let n=t.lightGlazeSettings??this.settings,r=e.radius*2*(n.positionJitterLinear+n.positionJitterLateral);e.x+e.radius+r<0||e.y+e.radius+r<0||e.x-e.radius-r>=D||e.y-e.radius-r>=D||(t.historyCommitted||(this.truncateRedoHistory(),this.historyActions.push({id:t.historyActionId,kind:`stroke`}),this.historyCursor=this.historyActions.length,t.historyCommitted=!0,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)),this.pendingStamps.push(e),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n;this.activeStroke?.thicknessTailHoldback&&this.releaseHeldThicknessStamps(this.thicknessTailReferenceTimeMs(),!1);let i=performance.now(),a=this.pendingStamps.length,o=this.lightGlazeSession;if(o)for(a=0;a<this.pendingStamps.length&&this.pendingStamps[a].historyActionId===o.historyActionId;)a+=1;let s=Math.min(a,A),c=s>0?this.pendingStamps.splice(0,s):[];o&&(o.commitRequested=o.endRequested&&!this.pendingStamps.some(e=>e.historyActionId===o.historyActionId));let l=performance.now()-i;if(!(this.clearRequested||c.length>0||this.displayDirty||o?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)||this.canvas.width<=0||this.canvas.height<=0)return;let u=this.clearRequested,d=o?.settings??this.settings,f=performance.now(),p=this.submitImmediate(c,u,d);this.lastCpuFrameMs=performance.now()-f,c.length>0?(this.trackAdaptivePreviewExactSubmission(c,d),this.recordHistoryBatch(c,d,p,u),this.layerHasContent=!0):u&&(this.layerHasContent=!1),this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=c.length,this.avoidedLogicalDraws+=c.length*Math.max(0,d.count-1),this.recordRenderedFrame(e);let m=performance.now();this.publishStats();let h=performance.now()-m;(this.pendingStamps.length>0||this.displayDirty||this.clearRequested||this.lightGlazeSession?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)&&this.requestRender(),this.recordStrokeFrameTiming(e,c.length,d.count,p,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:l,statsPublishMs:h})}recordHistoryBatch(e,t,n,r){e.length===0||e[0].historyActionId===0||(this.activeStroke&&e.some(e=>e.historyActionId===this.activeStroke?.historyActionId)&&(this.activeStroke.submitted=!0),this.historyBatches.push({settings:t,stamps:e,clearLayer:r,dirtyRect:n.dirtyRect,shapeOccupancySelection:n.shapeOccupancySelection,shapeMaskIdentity:this.shapeMaskIdentity,grainTextureIdentity:this.isTexturizedGrainActive(t)?this.grainTextureIdentity:null}),this.historyStoredBaseStamps+=e.length,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCapturedBaseStamps+=e.length,this.activeStrokeProfile.historyCapturedBatches+=1))}truncateRedoHistory(){this.historyCursor>=this.historyActions.length||(this.historyActions.length=this.historyCursor,this.historyCompactionPending=!0)}compactDiscardedHistory(){if(!this.historyCompactionPending)return;let e=new Set(this.historyActions.filter(e=>e.kind===`stroke`).map(e=>e.id)),t=[],n=0;for(let r of this.historyBatches){let i=r.stamps.filter(t=>e.has(t.historyActionId));i.length!==0&&(t.push(i.length===r.stamps.length?r:{...r,stamps:i}),n+=i.length)}this.historyBatches=t,this.historyStoredBaseStamps=n,this.historyCompactionPending=!1}visibleHistoryStrokeIds(){let e=0;for(let t=this.historyCursor-1;t>=0;--t)if(this.historyActions[t].kind===`clear`){e=t+1;break}let t=new Set;for(let n=e;n<this.historyCursor;n+=1){let e=this.historyActions[n];e.kind===`stroke`&&t.add(e.id)}return t}hasVisibleHistoryContent(){return this.visibleHistoryStrokeIds().size>0}resetHistoryState(){this.historyActions=[],this.historyCursor=0,this.nextHistoryActionId=1,this.historyBatches=[],this.historyStoredBaseStamps=0,this.historyCompactionPending=!1}async moveHistoryCursor(e){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;let t=this.historyCursor+e;if(t<0||t>this.historyActions.length)return!1;let n=this.historyCursor;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(e<0?`Undo: ricostruzione del layer…`:`Redo: ricostruzione del layer…`,`working`);try{await this.waitForIdle(),this.compactDiscardedHistory(),this.historyCursor=t;try{await this.rebuildLayerFromHistory()}catch(e){this.historyCursor=n;try{await this.rebuildLayerFromHistory()}catch(t){let n=e instanceof Error?e.message:String(e),r=t instanceof Error?t.message:String(t);throw Error(`Undo/Redo non riuscito (${n}) e ripristino fallito (${r}).`)}throw e}return this.activeStrokeProfile&&(this.activeStrokeProfile.historyReplayOperations+=1),this.callbacks.onStatus?.(e<0?`Undo completato.`:`Redo completato.`,`ok`),!0}finally{this.historyBusy=!1,this.publishHistoryState()}}async rebuildLayerFromHistory(){let e=this.visibleHistoryStrokeIds(),t=-1,n=-1;for(let r=0;r<this.historyBatches.length;r+=1)this.historyBatches[r].stamps.some(t=>e.has(t.historyActionId))&&(t<0&&(t=r),n=r);try{if(n<0)this.submitImmediate([],!0,this.settings,!0,null);else{let r=this.historyBatches[t];r.clearLayer||this.submitImmediate([],!0,r.settings,!1,null);for(let r=t;r<=n;r+=1){let t=this.historyBatches[r],i=t.stamps.every(t=>e.has(t.historyActionId))?t.stamps:t.stamps.filter(t=>e.has(t.historyActionId));if(i.length!==0){if(_t(t.settings.blendMode)){let a=i[0].historyActionId;if(i.some(e=>e.historyActionId!==a))throw Error(`Un batch Light Glaze storico contiene più pennellate.`);if(!this.lightGlazeSession)this.startLightGlazeSession(a,t.settings);else if(this.lightGlazeSession.historyActionId!==a)throw Error(`Ordine storico Light Glaze non valido.`);let o=!1;for(let t=r+1;t<=n;t+=1)if(this.historyBatches[t].stamps.some(t=>t.historyActionId===a&&e.has(a))){o=!0;break}let s=this.lightGlazeSession;if(!s)throw Error(`Sessione Light Glaze storica non inizializzata.`);s.endRequested=!o,s.commitRequested=!o}this.writeBrushUniforms(t.settings),this.submitImmediate(i,t.clearLayer,t.settings,r===n,t)}}if(this.lightGlazeSession)throw Error(`La ricostruzione storica ha lasciato un tratto Light Glaze aperto.`)}}finally{this.lightGlazeSession&&this.abandonLightGlazeSession(),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings)}this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=n>=0,await this.device.queue.onSubmittedWorkDone()}selectShapeOccupancy(e){let t=Number.isFinite(e),n=t?Math.log2(I/Math.max(1,e*2)):1/0,r=t?Math.max(0,Math.ceil(n+1e-4)):-1,i=r>=0&&r<=st,a=i?this.shapeOccupancyActiveCells[r]:0,o=i?this.shapeOccupancyCoverageRatios[r]:0;return!t||e<lt?{selectedMipLevel:null,fallbackReason:`minimum-radius`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:i?o>ut?{selectedMipLevel:null,fallbackReason:`coverage-too-dense`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:r,fallbackReason:`none`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:null,fallbackReason:`mip-out-of-range`,candidateMipLevel:r,candidateActiveCells:0,candidateCoverageRatio:0}}recordShapeSampling(e){let t=e.selectedMipLevel,n=t===null?te:P,r=t===null?0:this.shapeOccupancyActiveCells[t],i=t===null?0:this.shapeOccupancyCoverageRatios[t];this.lastStampGeometry=M,this.lastStampVerticesPerCopy=j,this.lastShapeSamplingStrategy=n,this.lastShapeOccupancyFallbackReason=e.fallbackReason,this.lastShapeOccupancyMipLevel=t??-1,this.lastShapeOccupancyActiveCells=r,this.lastShapeOccupancyCoverageRatio=i,this.lastShapeOccupancyCandidateMipLevel=e.candidateMipLevel,this.lastShapeOccupancyCandidateActiveCells=e.candidateActiveCells,this.lastShapeOccupancyCandidateCoverageRatio=e.candidateCoverageRatio;let a=this.activeStrokeProfile;if(!a)return;a.stampGeometry=M,a.stampVerticesPerCopy=j;let o=a.shapeSamplingStrategy;a.shapeSamplingStrategy=a.shapeSamplingStrategy===`none`||a.shapeSamplingStrategy===n?n:`mixed`,o!==`none`&&o!==n?a.shapeOccupancyFallbackReason=`mixed`:e.fallbackReason!==`none`&&(a.shapeOccupancyFallbackReason=a.shapeOccupancyFallbackReason===`none`||a.shapeOccupancyFallbackReason===e.fallbackReason?e.fallbackReason:`mixed`),a.shapeOccupancyCandidateMipLevel=Math.max(a.shapeOccupancyCandidateMipLevel,e.candidateMipLevel),a.shapeOccupancyCandidateActiveCells=Math.max(a.shapeOccupancyCandidateActiveCells,e.candidateActiveCells),a.shapeOccupancyCandidateCoverageRatio=Math.max(a.shapeOccupancyCandidateCoverageRatio,e.candidateCoverageRatio),t!==null&&(a.shapeOccupancyMipLevel=Math.max(a.shapeOccupancyMipLevel,t),a.shapeOccupancyActiveCells=Math.max(a.shapeOccupancyActiveCells,r),a.shapeOccupancyCoverageRatio=Math.max(a.shapeOccupancyCoverageRatio,i))}adaptivePreviewRgb(n,r,i=e(r.color)){let a=r.jitterMaster,o=(Tt(n,1)-.5)*2*(r.hueJitterDegrees/360)*a,s=(Tt(n,2)-.5)*2*r.saturationJitter*a,c=(Tt(n,3)-.5)*2*r.lightnessJitter*a,l=Tt(n,4)*r.darknessJitter*a,u=t(i[2]+c,0,1);return Dt(i[0]+o,i[1]+s,u*(1-l))}prepareAdaptivePreviewShapePalette(n){let r=this.adaptivePreviewShapeSprite;if(n.shape!==`shape`||!r||!this.adaptivePreviewContext)return;let i=[n.color,n.jitterMaster,n.hueJitterDegrees,n.saturationJitter,n.lightnessJitter,n.darknessJitter,n.hardness].join(`|`);if(i===this.adaptivePreviewShapePaletteKey)return;let a=e(n.color),o=document.createElement(`canvas`);o.width=r.width,o.height=r.height;let s=o.getContext(`2d`),c=r.getContext(`2d`);if(!s||!c){this.adaptivePreviewShapePalette=[],this.adaptivePreviewShapePaletteKey=i;return}let l=c.getImageData(0,0,r.width,r.height),u=t(n.hardness,0,1);for(let e=3;e<l.data.length;e+=4){let n=l.data[e]/255,r=n*n*(1-u)+n*u;l.data[e]=Math.round(t(r,0,1)*255)}s.putImageData(l,0,0);let d=[],f=new Set;for(let e=0;e<Re;e+=1){let t=wt(Math.imul(e+1,2654435761)^2769414579),[i,s,c]=this.adaptivePreviewRgb(t,n,a),l=`rgb(${i} ${s} ${c})`;if(f.has(l))continue;let u=document.createElement(`canvas`);u.width=r.width,u.height=r.height;let p=u.getContext(`2d`);p&&(p.drawImage(o,0,0),p.globalCompositeOperation=`source-in`,p.fillStyle=l,p.fillRect(0,0,u.width,u.height),d.push({red:i,green:s,blue:c,sprite:u}),f.add(l))}this.adaptivePreviewShapePalette=d,this.adaptivePreviewShapePaletteKey=i}nearestAdaptivePreviewShapeSprite(e){let t=null,n=1/0;for(let r of this.adaptivePreviewShapePalette){let i=r.red-e.red,a=r.green-e.green,o=r.blue-e.blue,s=i*i+a*a+o*o;s<n&&(t=r,n=s)}return t?.sprite??null}adaptivePreviewCandidatesForFrame(){return this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2)}finishAdaptivePreviewLifetime(e=performance.now()){this.adaptivePreviewStartedAt<=0||(this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs=Math.max(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs,e-this.adaptivePreviewStartedAt)),this.adaptivePreviewStartedAt=0)}clearAdaptivePreviewCanvas(){let e=this.adaptivePreviewCanvas,t=this.adaptivePreviewContext;if(!(!e||!t)){if(!(e.style.opacity===`1`||this.adaptivePreviewLastPresentedSerial>0||this.adaptivePreviewCandidates.some(e=>e.presented))){this.adaptivePreviewLastPresentedSerial=0;return}t.setTransform(1,0,0,1,0,0),t.globalAlpha=1,t.globalCompositeOperation=`source-over`,t.clearRect(0,0,e.width,e.height),e.style.opacity=`0`,e.style.left=`-10000px`,e.style.top=`-10000px`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1}}hideConfirmedStaleAdaptivePreviewBitmap(){let e=this.adaptivePreviewCanvas;if(!e||e.style.opacity!==`1`||this.adaptivePreviewLastPresentedSerial<=0||this.adaptivePreviewLastPresentedSerial>this.adaptivePreviewConfirmedSerial||this.hasAdaptivePreviewPresentedUnboundCandidate())return!1;e.style.opacity=`0`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1;return this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewConfirmedStaleBitmapHides+=1),!0}requestAdaptivePreviewIncompleteFrameRetry(e){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen)return;let t=0;for(let n of e)n.serial!==null&&(t=Math.max(t,n.serial));t<=0||t<=this.adaptivePreviewLastIncompleteRetrySerial||(this.adaptivePreviewLastIncompleteRetrySerial=t,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewIncompleteFrameRetryRequests+=1),this.requestAdaptivePreviewDraw())}finishIncompleteAdaptivePreviewFrame(e,t,n,r){this.hideConfirmedStaleAdaptivePreviewBitmap(),r&&this.requestAdaptivePreviewIncompleteFrameRetry(n),this.recordAdaptivePreviewJsFrame(e,t)}cancelAdaptivePreviewProbe(){let e=this.adaptivePreviewProbe;e&&(window.clearTimeout(e.timeout),this.adaptivePreviewProbe=null,e.telemetryProfile&&(e.telemetryProfile.adaptivePreviewProbeCancellations+=1))}invalidateAdaptivePreview(){this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewSubmittedSerial=0,this.adaptivePreviewConfirmedSerial=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewCandidates.length=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.clearAdaptivePreviewCanvas()}activateAdaptivePreview(e){if(this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewCandidates.length===0)return;if(this.adaptivePreviewCandidates[this.adaptivePreviewCandidates.length-1].settings.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1);return}this.adaptivePreviewActive=!0;let t=performance.now();this.adaptivePreviewStartedAt=t;let n=this.activeStrokeProfile;if(n){let r=t-n.startedAt;n.adaptivePreviewActivations===0?(n.adaptivePreviewFirstActivationReason=e,n.adaptivePreviewFirstActivationMs=r):n.adaptivePreviewActivations===1&&(n.adaptivePreviewSecondActivationReason=e,n.adaptivePreviewSecondActivationMs=r),n.adaptivePreviewActivations+=1,n.adaptivePreviewActivationReason=n.adaptivePreviewActivationReason===`none`||n.adaptivePreviewActivationReason===e?e:`mixed`}this.requestAdaptivePreviewDraw()}retireAdaptivePreview(e){let t=this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0;this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewCandidates.length=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.clearAdaptivePreviewCanvas(),t&&e&&this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewRetirements+=1)}retireAdaptivePreviewAfterGpuIdle(){this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0?(this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,this.adaptivePreviewSubmittedSerial),this.adaptivePreviewFrozen?this.scheduleAdaptivePreviewRetirement():this.scheduleAdaptivePreviewCatchUpClear()):this.clearAdaptivePreviewCanvas()}hasAdaptivePreviewPresentedUnboundCandidate(){return this.adaptivePreviewCandidates.some(e=>e.presented&&e.serial===null)}hasAdaptivePreviewUnconfirmedCandidate(){return this.adaptivePreviewCandidates.some(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial)}scheduleAdaptivePreviewRetirement(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null;let t=this.adaptivePreviewRetirementTargetSerial;e!==this.adaptivePreviewGeneration||!this.adaptivePreviewFrozen||this.hasAdaptivePreviewPresentedUnboundCandidate()||t<=0||this.adaptivePreviewConfirmedSerial<t||this.retireAdaptivePreview(!0)})}scheduleAdaptivePreviewCatchUpClear(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration,t=this.adaptivePreviewLastPresentedSerial;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewConfirmedSerial<t||this.hasAdaptivePreviewUnconfirmedCandidate())&&(this.adaptivePreviewForceStroke&&this.activeStroke?this.clearAdaptivePreviewCanvas():this.retireAdaptivePreview(!0))})}freezeAdaptivePreviewAtLift(){if(!this.adaptivePreviewActive){this.invalidateAdaptivePreview();return}this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null);let e=this.activeStroke;if(e){let t=[],n=0,r=Ae;for(let n=this.pendingStamps.length-1;n>=0&&t.length<r;--n){let r=this.pendingStamps[n];r.historyActionId===e.historyActionId&&t.unshift(r)}for(let e of t)this.adaptivePreviewCandidates.some(t=>t.stamp===e)||(this.adaptivePreviewCandidates.push({serial:null,stamp:e,settings:this.settings,presented:!1}),n+=1);this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.slice(-2),this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewLiftPendingBaseStamps+=n)}if(this.adaptivePreviewFrozen=!0,this.drawAdaptivePreviewFrame(),this.adaptivePreviewLastPresentedSerial<=0&&!this.hasAdaptivePreviewPresentedUnboundCandidate()){this.invalidateAdaptivePreview();return}if(this.adaptivePreviewRetirementTargetSerial=this.adaptivePreviewLastPresentedSerial,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewFrozenAtLift+=1),!this.hasAdaptivePreviewPresentedUnboundCandidate()){if(this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial){this.scheduleAdaptivePreviewRetirement();return}this.startAdaptivePreviewProbe(!0)}}requestAdaptivePreviewDraw(){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewFrameRequest!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewFrameRequest=requestAnimationFrame(()=>{this.adaptivePreviewFrameRequest=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen)&&this.drawAdaptivePreviewFrame()})}increaseAdaptiveSpacing(e){let t=this.activeStroke;if(!t||this.adaptivePreviewFrozen)return;let n=t.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints,r=Math.min(n,t.adaptiveSpacingPercent+Ge);if(r<=t.adaptiveSpacingPercent)return;t.adaptiveSpacingPercent=r;let i=this.activeStrokeProfile;i&&(i.adaptiveSpacingFinalPercent=r,i.adaptiveSpacingEvents.push({offsetMs:Math.max(0,performance.now()-i.startedAt),reason:e,spacingPercent:r,extraPercentPoints:r-t.adaptiveSpacingInitialPercent,backlogBaseStamps:Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),generatedBaseStamps:i.baseStamps}))}startAdaptivePreviewProbe(e){if(!this.adaptivePreviewContext||this.adaptivePreviewProbe||this.adaptivePreviewSubmittedSerial<=this.adaptivePreviewConfirmedSerial||!this.activeStroke&&!this.adaptivePreviewFrozen||!e&&this.adaptivePreviewSubmissionsSinceProbe<ze)return;let t=performance.now(),n=this.activeStrokeProfile,r=Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),i={generation:this.adaptivePreviewGeneration,startedAt:t,prefixSerial:this.adaptivePreviewSubmittedSerial,timeout:0,spacingIncreaseApplied:!1,telemetryProfile:n};n&&(n.adaptivePreviewProbeStarts+=1,n.adaptivePreviewProbeBacklogBaseStamps.push(r)),this.adaptivePreviewSubmissionsSinceProbe=0,i.timeout=window.setTimeout(()=>{let e=performance.now();this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration||!this.activeStroke||this.adaptivePreviewFrozen||(i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeTimeouts+=1,i.telemetryProfile.adaptivePreviewProbeTimeoutLatenessMs.push(Math.max(0,e-(i.startedAt+Be)))),i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`probe-timeout`),this.activateAdaptivePreview(`probe-timeout`))},Be),this.adaptivePreviewProbe=i,this.device.queue.onSubmittedWorkDone().then(()=>{if(this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration)return;window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null;let e=performance.now()-i.startedAt;e>=Ve&&!i.spacingIncreaseApplied&&(i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`slow-completion`)),this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,i.prefixSerial);let t=i.telemetryProfile;if(t&&(t.adaptivePreviewProbeLatencyMs.push(e),e>=Ve?t.adaptivePreviewProbeResolvedSlow+=1:t.adaptivePreviewProbeResolvedFast+=1,e>=Ue&&e<Be&&(t.adaptivePreviewProbeNearMisses+=1),t.adaptivePreviewMaxQueueProbeLatencyMs=Math.max(t.adaptivePreviewMaxQueueProbeLatencyMs,e)),this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial),this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0);return}if(e>=Ve?this.adaptivePreviewConsecutiveSlowProbes+=1:this.adaptivePreviewConsecutiveSlowProbes=0,!this.adaptivePreviewActive&&this.activeStroke&&this.adaptivePreviewConsecutiveSlowProbes>=He&&this.activateAdaptivePreview(`consecutive-slow`),this.adaptivePreviewActive)if(this.adaptivePreviewCandidates.length>0)this.requestAdaptivePreviewDraw();else{this.scheduleAdaptivePreviewCatchUpClear();return}this.activeStroke&&this.adaptivePreviewSubmittedSerial>this.adaptivePreviewConfirmedSerial&&this.startAdaptivePreviewProbe(this.adaptivePreviewActive||this.adaptivePreviewSubmissionsSinceProbe>=ze)}).catch(()=>{i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeRejections+=1),this.adaptivePreviewProbe===i&&(window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null),i.generation===this.adaptivePreviewGeneration&&this.invalidateAdaptivePreview()})}trackAdaptivePreviewExactSubmission(e,t){let n=this.activeStrokeProfile;n&&(n.adaptivePreviewExactBaseStampsSubmitted+=e.length,n.adaptivePreviewExactBatchesSubmitted+=1);let r=this.adaptivePreviewSubmittedSerial;this.adaptivePreviewSubmittedSerial+=e.length,this.adaptivePreviewSubmissionsSinceProbe+=1,n&&(n.adaptivePreviewMaxUnconfirmedBaseStamps=Math.max(n.adaptivePreviewMaxUnconfirmedBaseStamps,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial));for(let t of this.adaptivePreviewCandidates){if(t.serial!==null)continue;let i=e.indexOf(t.stamp);i<0||(t.serial=r+i+1,n&&(n.adaptivePreviewLiftPendingSerialBindings+=1),t.presented&&(this.adaptivePreviewLastPresentedSerial=Math.max(this.adaptivePreviewLastPresentedSerial,t.serial),this.adaptivePreviewRetirementTargetSerial=Math.max(this.adaptivePreviewRetirementTargetSerial,t.serial)))}if(this.adaptivePreviewFrozen||!this.activeStroke){if(this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewRetirementTargetSerial>0&&this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0)}return}if(this.isTexturizedGrainActive(t)){n&&(n.grainAdaptivePreviewSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),this.startAdaptivePreviewProbe(!1);return}if(t.blendMode!==`normal`){n&&(n.adaptivePreviewUnsupportedBlendSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),_t(t.blendMode)&&this.startAdaptivePreviewProbe(!1);return}let i=Ae,a=Math.max(0,e.length-i);for(let n=a;n<e.length;n+=1)this.adaptivePreviewCandidates.some(t=>t.stamp===e[n])||this.adaptivePreviewCandidates.push({serial:r+n+1,stamp:e[n],settings:t,presented:!1});this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2),this.adaptivePreviewForceStroke&&this.activateAdaptivePreview(`diagnostic-force`),this.adaptivePreviewActive&&this.requestAdaptivePreviewDraw(),this.startAdaptivePreviewProbe(this.adaptivePreviewActive)}recordAdaptivePreviewJsFrame(e,t){let n=performance.now()-e,r=this.activeStrokeProfile;r&&(r.adaptivePreviewJsTotalMs+=n,r.adaptivePreviewJsFrameMs.push(n),!t&&n>Oe&&(r.adaptivePreviewBudgetSkips+=1))}drawAdaptivePreviewFrame(){let n=performance.now(),r=this.adaptivePreviewCanvas,i=this.adaptivePreviewContext,a=this.adaptivePreviewScratchCanvas,o=this.adaptivePreviewScratchContext,s=this.adaptivePreviewCandidatesForFrame();if(!r||!i||!a||!o||s.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let c=s[s.length-1].settings;if(this.isTexturizedGrainActive(c)){this.activeStrokeProfile&&(this.activeStrokeProfile.grainAdaptivePreviewSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.shape===`shape`&&(this.prepareAdaptivePreviewShapePalette(c),this.adaptivePreviewShapePalette.length===0)){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let l=this.canvasCssWidth,u=this.canvasCssHeight,d=Math.max(1,this.canvas.width),f=Math.max(1,this.canvas.height),p=this.zoom*l/d,m=this.zoom*u/f,h=(Math.abs(p)+Math.abs(m))*.5;if(l<=0||u<=0||!Number.isFinite(h)||h<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let g=[];for(let n=0;n<s.length;n+=1){let r=s[n],i=r.settings;if(i.shape!==c.shape||i.blendMode!==c.blendMode)continue;let a=r.stamp,o=Math.fround(a.x),d=Math.fround(a.y),f=Math.fround(a.radius);if(f<=0)continue;let _=Math.fround(a.directionX),v=Math.fround(a.directionY),y=Math.hypot(_,v),b=y>1e-4?_/y:1,x=y>1e-4?v/y:0,S=e(i.color),C=i.pressureOpacity,w=1-C+C*t(a.pressure,0,1),T=t(i.flow*i.opacity*i.blendIntensity*w,0,.999999)*Le,E=t(Math.round(i.count),1,24);for(let e=0;e<E;e+=1){let t=wt((a.seed^Math.imul(e,2246822507))>>>0),r=(Tt(t,5)-.5)*4*f*Math.fround(i.positionJitterLinear),s=(Tt(t,6)-.5)*4*f*Math.fround(i.positionJitterLateral),c=o+b*r-x*s,_=d+x*r+b*s,v=i.shape===`shape`?(Tt(t,7)-.5)*Math.PI*2*i.shapeScatter:0,y=i.jitterPerCopy?t:wt(a.seed),[C,w,E]=this.adaptivePreviewRgb(y,i,S);g.push({x:(c-this.viewCenterX)*p+l*.5,y:(_-this.viewCenterY)*m+u*.5,radius:Math.max(.25,f*h),rotation:v,alpha:T,candidateIndex:n,red:C,green:w,blue:E,color:`rgb(${C} ${w} ${E})`})}}if(g.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(performance.now()-n>Oe){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}let _=1/0,v=1/0,y=-1/0,b=-1/0;for(let e of g){let t=c.shape===`shape`?e.radius*(Math.abs(Math.cos(e.rotation))+Math.abs(Math.sin(e.rotation))):e.radius;_=Math.min(_,e.x-t),v=Math.min(v,e.y-t),y=Math.max(y,e.x+t),b=Math.max(b,e.y+t)}let x=Math.max(0,_-Ie),S=Math.max(0,v-Ie),C=Math.min(l,y+Ie),w=Math.min(u,b+Ie),T=Math.max(0,C-x),E=Math.max(0,w-S);if(T<=0||E<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(T>Ne||E>Ne){let e=this.activeStrokeProfile;e&&(e.adaptivePreviewOversizedSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let D=(e,t)=>Math.min(t,Math.max(Pe,Math.ceil(e/Fe)*Fe)),O=D(T,Math.min(Ne,Math.ceil(l))),k=D(E,Math.min(Ne,Math.ceil(u))),A=t(Math.floor((x+C-O)*.5),0,Math.max(0,Math.ceil(l)-O)),j=t(Math.floor((S+w-k)*.5),0,Math.max(0,Math.ceil(u)-k)),M=d/l*De,ee=f/u*De,N=Math.max(1,Math.ceil(O*M)),P=Math.max(1,Math.ceil(k*ee));(a.width!==N||a.height!==P)&&(a.width=N,a.height=P),o.setTransform(1,0,0,1,0,0),o.globalCompositeOperation=`source-over`,o.globalAlpha=1,o.clearRect(0,0,N,P),o.imageSmoothingEnabled=!0,o.imageSmoothingQuality=`low`;let te=N/O,ne=P/k,re=new Set,ie=0,ae=!1,oe=!0,se=Math.max(0,Oe-ke);for(let e of g){if(performance.now()-n>se){ae=!0,oe=!1;break}let r=(e.x-A)*te,i=(e.y-j)*ne,a=e.radius*te,s=e.radius*ne;if(o.globalAlpha=e.alpha,c.shape===`shape`){let t=this.nearestAdaptivePreviewShapeSprite(e);if(!t){oe=!1;break}o.save(),o.translate(r,i),o.rotate(e.rotation),o.drawImage(t,-a,-s,a*2,s*2),o.restore()}else if(o.beginPath(),o.ellipse(r,i,a,s,0,0,Math.PI*2),o.fillStyle=e.color,c.hardness>=.995)o.fill();else{let n=o.createRadialGradient(r,i,0,r,i,Math.max(a,s)),l=t(c.hardness,0,.999);n.addColorStop(0,e.color),n.addColorStop(l,e.color),n.addColorStop(1,`rgb(${e.red} ${e.green} ${e.blue} / 0)`),o.fillStyle=n,o.fill()}re.add(e.candidateIndex),ie+=1}if(o.globalAlpha=1,!oe||ae||ie!==g.length||performance.now()-n>se){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}(r.width!==N||r.height!==P)&&(r.width=N,r.height=P),(this.adaptivePreviewCssWidth!==O||this.adaptivePreviewCssHeight!==k)&&(r.style.width=`${O}px`,r.style.height=`${k}px`,this.adaptivePreviewCssWidth=O,this.adaptivePreviewCssHeight=k),r.style.left=`${A}px`,r.style.top=`${j}px`,i.setTransform(1,0,0,1,0,0),i.globalCompositeOperation=`copy`,i.globalAlpha=1,i.drawImage(a,0,0),i.globalCompositeOperation=`source-over`;for(let e of this.adaptivePreviewCandidates)e.presented=!1;let ce=0;for(let e of re){let t=s[e];t.presented=!0,t.serial!==null&&(ce=Math.max(ce,t.serial))}this.adaptivePreviewLastPresentedSerial=ce,r.style.opacity=`1`;let F=this.activeStrokeProfile;F&&(F.adaptivePreviewFrames+=1,F.adaptivePreviewBaseStampsDrawn+=re.size,F.adaptivePreviewPhysicalCopiesDrawn+=ie,F.adaptivePreviewPatchPixels+=N*P,F.adaptivePreviewMaxPatchBackingPixels=Math.max(F.adaptivePreviewMaxPatchBackingPixels,N*P)),this.recordAdaptivePreviewJsFrame(n,!1)}submitLightGlazeImmediate(e,t,n,r,i){this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0);let a=this.lightGlazeSession;if(!a||!_t(a.settings.blendMode))throw Error(`Sessione Light Glaze mancante durante il rendering.`);if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let o=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==o)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);this.ensureLightGlazeResources();let s=this.isTexturizedGrainActive(n),c=n.blendMode===`m1-glaze`,l=performance.now();if(r&&this.ensurePresentationCacheTexture(),this.writeBrushUniforms({...n,opacity:1,blendMode:`normal`}),s&&this.writeGrainUniforms(n),c&&a.tintLinear===null&&e.length>0){let[t,r,i]=this.adaptivePreviewRgb(wt(e[0].seed),n);a.tintLinear=[Ot(t),Ot(r),Ot(i)]}this.writeLightGlazeUniforms(n.opacity,c?`m1-max-coverage`:`source-over`,a.tintLinear);let u=this.device.createCommandEncoder({label:`Light Glaze frame encoder`}),d=0,f=0,p=0,m=0,h=0,g=0,_=null,v=null,y=0,b=0,x=0,S=0,C=0,w=0,T=!1,E=this.paintDisplaySelectedMipLevel,O=0,A=0,M=0,ee=0,N=0,P=0,te=0,ne=0,re=0,ie=0,ae=0,oe=0,se=0,ce=0,F=0,le=0,ue=0,de=performance.now();if(t&&(u.beginRenderPass({label:`Clear permanent layer before Light Glaze`,colorAttachments:[{view:this.layerView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),this.paintDisplayMipValidThroughLevel=0),e.length>0){let t=performance.now(),r=this.packStamps(e,n);_=i?i.dirtyRect:r,d=performance.now()-t;let o=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*k),n.shape===`shape`&&(v=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),f=performance.now()-o;let l=u.beginRenderPass({label:`Accumulate Light Glaze stroke`,colorAttachments:[{view:this.lightGlazeView,loadOp:a.needsClear?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(_){g=_.width*_.height;let t=n.shape===`shape`,r=v?.selectedMipLevel??null,a=t&&r!==null,o=c?s?t?a?this.grainM1GlazeShapeOccupancyPipeline:this.grainM1GlazeShapePipeline:this.grainM1GlazePipeline:t?a?this.m1GlazeShapeOccupancyPipeline:this.m1GlazeShapePipeline:this.m1GlazePipeline:s?t?a?this.grainShapeOccupancyNormalPipeline:this.grainShapeNormalPipeline:this.grainNormalPipeline:t?a?this.shapeOccupancyNormalPipeline:this.shapeNormalPipeline:this.normalPipeline;l.setPipeline(o),l.setBindGroup(0,s?a?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][r]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.brushOccupancyBindGroups[r]:this.brushBindGroup),l.setScissorRect(_.x,_.y,_.width,_.height),t&&v&&!i&&this.recordShapeSampling(v),l.draw(j,e.length*n.count,0,0),s&&(se=1,ce=e.length,F=e.length*n.count,le=+!t,ue=+!!t)}l.end(),a.needsClear=!1,a.hasContent=a.hasContent||_!==null,a.dirtyRect=this.mergeDirtyRects(a.dirtyRect,_),ne=1}if(p+=performance.now()-de,!r&&(t||e.length>0||a.commitRequested)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0),r){let e=performance.now();E=this.desiredPaintDisplayMipLevel(),E!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=E;let n=this.canvas.width*this.canvas.height;if(C=n,w=n,!a.commitRequested){if(a.hasContent){let e=this.encodeLightGlazeDisplayPyramid(u,a,_,E);ae+=e.passes,oe+=e.updatedPixels}else{let e=this.encodePaintDisplayPyramid(u,t?{x:0,y:0,width:D,height:D}:null,E);O+=e.maintenanceFrames,A+=e.fullLevelBuilds,M+=e.dirtyLevelUpdates,ee+=e.passes,N+=e.baseDirtyPixels,P+=e.updatedPixels,te+=e.encodingMs}let e=this.presentationCacheNeedsFullRebuild||t,n=e?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:_?this.layerDirtyRectToPresentationRect(_,E):null;if(n){this.writeDisplayUniforms(E);let t=u.beginRenderPass({label:e?`Rebuild presentation cache with live Light Glaze`:`Update presentation cache with live Light Glaze`,colorAttachments:[{view:this.presentationCacheView,loadOp:e?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});t.setPipeline(a.hasContent?this.lightGlazeDisplayPipeline:this.displayPipeline),t.setBindGroup(0,a.hasContent?this.lightGlazeDisplayBindGroup:this.displayBindGroup),e||t.setScissorRect(n.x,n.y,n.width,n.height),t.draw(3,1,0,0),t.end(),T=!0,S=n.width*n.height,e?y=1:b=1}else _&&(x=1)}m+=performance.now()-e}if(a.commitRequested){if(a.hasContent&&a.dirtyRect){let e=performance.now(),t=u.beginRenderPass({label:`Commit complete Light Glaze stroke once`,colorAttachments:[{view:this.layerView,loadOp:`load`,storeOp:`store`}]});t.setPipeline(this.lightGlazeCompositePipeline),t.setBindGroup(0,this.lightGlazeCompositeBindGroup),t.setScissorRect(a.dirtyRect.x,a.dirtyRect.y,a.dirtyRect.width,a.dirtyRect.height),t.draw(3,1,0,0),t.end(),p+=performance.now()-e,re=1,ie=a.dirtyRect.width*a.dirtyRect.height}if(r){let e=performance.now(),n=t?{x:0,y:0,width:D,height:D}:a.dirtyRect,r=this.encodePaintDisplayPyramid(u,n,E);O+=r.maintenanceFrames,A+=r.fullLevelBuilds,M+=r.dirtyLevelUpdates,ee+=r.passes,N+=r.baseDirtyPixels,P+=r.updatedPixels,te+=r.encodingMs;let i=this.presentationCacheNeedsFullRebuild||t,o=i?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:a.dirtyRect?this.layerDirtyRectToPresentationRect(a.dirtyRect,E):null;if(o){this.writeDisplayUniforms(E);let e=u.beginRenderPass({label:i?`Rebuild canonical presentation cache after Light Glaze commit`:`Canonicalize Light Glaze presentation cache after commit`,colorAttachments:[{view:this.presentationCacheView,loadOp:i?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});e.setPipeline(this.displayPipeline),e.setBindGroup(0,this.displayBindGroup),i||e.setScissorRect(o.x,o.y,o.width,o.height),e.draw(3,1,0,0),e.end(),T=!0,S=o.width*o.height,i?y=1:b=1}else a.dirtyRect&&(x=1);m+=performance.now()-e}}if(r){let e=performance.now(),t=this.context.getCurrentTexture();u.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:t},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),m+=performance.now()-e}let fe=performance.now();return this.device.queue.submit([u.finish()]),h=performance.now()-fe,r&&T&&(this.presentationCacheNeedsFullRebuild=!1),a.commitRequested&&(this.lightGlazeSession=null),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),{totalCpuMs:performance.now()-l,stampPackingMs:d,instanceUploadMs:f,brushEncodingMs:p,displayEncodingMs:m,commandSubmitMs:h,scissorPixels:g,dirtyRect:_,shapeOccupancySelection:v,presentationCacheFullRebuilds:y,presentationCachePartialUpdates:b,presentationCacheOffscreenSkips:x,presentationCacheUpdatedPixels:S,legacyDisplayShaderPixels:C,presentationCopiedPixels:w,displaySelectedMipLevel:E,paintDisplayPyramidMaintenanceFrames:O,paintDisplayPyramidFullLevelBuilds:A,paintDisplayPyramidDirtyLevelUpdates:M,paintDisplayPyramidPasses:ee,paintDisplayPyramidBaseDirtyPixels:N,paintDisplayPyramidUpdatedPixels:P,paintDisplayPyramidEncodingMs:te,lightGlazeBatches:ne,lightGlazeCommits:re,lightGlazeCompositePixels:ie,lightGlazePyramidPasses:ae,lightGlazePyramidUpdatedPixels:oe,grainBatches:se,grainBaseStamps:ce,grainPhysicalCopies:F,grainCircleBatches:le,grainShapeBatches:ue}}submitImmediate(e,t,n=this.settings,r=!0,i=null){if(_t(n.blendMode)){if(this.lightGlazeSession)return this.submitLightGlazeImmediate(e,t,n,r,i);if(e.length>0)throw Error(`Stamp Light Glaze senza sessione per-stroke.`)}let a=this.isTexturizedGrainActive(n);a&&this.writeGrainUniforms(n);let o=performance.now();r&&this.ensurePresentationCacheTexture();let s=r?this.prepareThicknessTailFrame():null;s?.grainActive&&!a&&this.writeGrainUniforms(s.settings);let c=this.device.createCommandEncoder({label:`Brush frame encoder`}),l=0,u=0,d=0,f=0,p=0,m=0,h=null,g=null,_=0,v=0,y=0,b=0,x=0,S=0,C=!1,w=this.paintDisplaySelectedMipLevel,T=0,E=0,O=0,A=0,M=0,ee=0,N=0,P=0,te=0,ne=0,re=0,ie=0;if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let ae=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==ae)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);if(t||e.length>0){let r=null,o=null;if(e.length>0){let t=performance.now(),a=this.packStamps(e,n);r=i?i.dirtyRect:a,l=performance.now()-t;let s=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*k),n.shape===`shape`&&(o=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),u=performance.now()-s}h=r,g=o;let s=performance.now(),f=c.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(e.length>0&&r){m=r.width*r.height;let t=n.shape===`shape`,s=o?.selectedMipLevel??null,c=t&&s!==null,l=a?t?c?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:t?c?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline;f.setPipeline(l),f.setBindGroup(0,a?c?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][s]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:c?this.brushOccupancyBindGroups[s]:this.brushBindGroup),f.setScissorRect(r.x,r.y,r.width,r.height),t&&o&&!i&&this.recordShapeSampling(o),f.draw(j,e.length*n.count,0,0),a&&(P=1,te=e.length,ne=e.length*n.count,re=+!t,ie=+!!t)}f.end(),d=performance.now()-s}if(s){let e=performance.now();this.encodeThicknessTailFrame(c,s),d+=performance.now()-e}if(!r&&(t||e.length>0)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0),r){let e=performance.now();w=this.desiredPaintDisplayMipLevel(),w!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=w;let n=t?{x:0,y:0,width:D,height:D}:h;t&&(this.paintDisplayMipValidThroughLevel=0);let r=this.encodePaintDisplayPyramid(c,n,w);T=r.maintenanceFrames,E=r.fullLevelBuilds,O=r.dirtyLevelUpdates,A=r.passes,M=r.baseDirtyPixels,ee=r.updatedPixels,N=r.encodingMs;let i=this.canvas.width*this.canvas.height;x=i,S=i;let a=this.presentationCacheNeedsFullRebuild||t,o=this.mergeDirtyRects(h,this.mergeDirtyRects(this.thicknessTailPresentedRect,s?.dirtyRect??null)),l=a?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:o?this.layerDirtyRectToPresentationRect(o,w):null;if(l){this.writeDisplayUniforms(w);let e=c.beginRenderPass({label:a?`Rebuild persistent presentation cache`:`Update persistent presentation cache dirty rect`,colorAttachments:[{view:this.presentationCacheView,loadOp:a?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});e.setPipeline(s?this.thicknessTailDisplayPipeline:this.displayPipeline),e.setBindGroup(0,s?this.thicknessTailDisplayBindGroup:this.displayBindGroup),a||e.setScissorRect(l.x,l.y,l.width,l.height),e.draw(3,1,0,0),e.end(),C=!0,b=l.width*l.height,a?_=1:v=1}else o&&(y=1);let u=this.context.getCurrentTexture();c.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:u},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),f=performance.now()-e}let oe=performance.now();return this.device.queue.submit([c.finish()]),p=performance.now()-oe,r&&C&&(this.presentationCacheNeedsFullRebuild=!1),r&&(this.thicknessTailPresentedRect=s?{...s.dirtyRect}:null),{totalCpuMs:performance.now()-o,stampPackingMs:l,instanceUploadMs:u,brushEncodingMs:d,displayEncodingMs:f,commandSubmitMs:p,scissorPixels:m,dirtyRect:h,shapeOccupancySelection:g,presentationCacheFullRebuilds:_,presentationCachePartialUpdates:v,presentationCacheOffscreenSkips:y,presentationCacheUpdatedPixels:b,legacyDisplayShaderPixels:x,presentationCopiedPixels:S,displaySelectedMipLevel:w,paintDisplayPyramidMaintenanceFrames:T,paintDisplayPyramidFullLevelBuilds:E,paintDisplayPyramidDirtyLevelUpdates:O,paintDisplayPyramidPasses:A,paintDisplayPyramidBaseDirtyPixels:M,paintDisplayPyramidUpdatedPixels:ee,paintDisplayPyramidEncodingMs:N,lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,grainBatches:P,grainBaseStamps:te,grainPhysicalCopies:ne,grainCircleBatches:re,grainShapeBatches:ie}}packStampsIntoUpload(e,n,r,i){let a=D,o=D,s=0,c=0,l=1/0,u=Math.PI*n.shapeScatter,d=n.shape===`shape`?u>=Math.PI*.25?Math.SQRT2:Math.cos(u)+Math.sin(u):1;for(let t=0;t<e.length;t+=1){let u=e[t],f=k/4*t;r[f]=u.x,r[f+1]=u.y,r[f+2]=u.radius,r[f+3]=u.pressure,i[f+4]=u.seed,i[f+5]=0,r[f+6]=u.directionX,r[f+7]=u.directionY;let p=r[f],m=r[f+1],h=r[f+2];l=Math.min(l,h);let g=r[f+6],_=r[f+7],v=Math.hypot(g,_),y=h*2*n.positionJitterLinear,b=h*2*n.positionJitterLateral,x=h*d,S,C;if(v>2e-4){let e=g/v,t=_/v;S=x+Math.abs(e)*y+Math.abs(t)*b+2,C=x+Math.abs(t)*y+Math.abs(e)*b+2}else{let e=x+y+b+2;S=e,C=e}a=Math.min(a,p-S),o=Math.min(o,m-C),s=Math.max(s,p+S),c=Math.max(c,m+C)}let f=t(Math.floor(a),0,D-1),p=t(Math.floor(o),0,D-1),m=t(Math.ceil(s),1,D),h=t(Math.ceil(c),1,D),g=Math.max(0,m-f),_=Math.max(0,h-p);return{dirtyRect:g>0&&_>0?{x:f,y:p,width:g,height:_}:null,minimumRadius:l}}packStamps(e,t){let n=this.packStampsIntoUpload(e,t,this.instanceUploadF32,this.instanceUploadU32);return this.packedMinimumRadius=n.minimumRadius,n.dirtyRect}packThicknessTailStamps(e,t){return this.packStampsIntoUpload(e,t,this.thicknessTailInstanceUploadF32,this.thicknessTailInstanceUploadU32)}generateBenchmarkStamps(e,n){let r=Array(e),i=D*.5,a=D*.39;for(let o=0;o<e;o+=1){let s=e<=1?0:o/(e-1),c=s*Math.PI*18,l=a*(.12+s*.88),u=t(.58+Math.sin(s*Math.PI*15)*.28,.1,1),d=1-n.pressureSize+n.pressureSize*Math.max(.08,u),f=Math.max(.5,n.size*.5*d);r[o]={x:i+Math.cos(c)*l,y:i+Math.sin(c*1.037)*l,radius:f,pressure:u,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(c),directionY:Math.cos(c*1.037),historyActionId:0}}return r}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r,i){let a=this.activeStrokeProfile;a&&(a.previousFrameTimestamp!==null&&a.renderIntervalMs.push(Math.max(0,e-a.previousFrameTimestamp)),a.previousFrameTimestamp=e,a.renderFrames+=1,a.cpuFrameMs.push(this.lastCpuFrameMs),a.renderFrameTotalMs.push(i.totalCpuMs),a.renderFrameOverheadMs.push(Math.max(0,i.totalCpuMs-r.totalCpuMs)),a.resizeCanvasMs+=i.resizeCanvasMs,a.batchExtractionMs+=i.batchExtractionMs,a.statsPublishMs+=i.statsPublishMs,a.stampPackingMs+=r.stampPackingMs,a.instanceUploadMs+=r.instanceUploadMs,a.brushEncodingMs+=r.brushEncodingMs,a.displayEncodingMs+=r.displayEncodingMs,a.commandSubmitMs+=r.commandSubmitMs,a.estimatedScissorPixels+=r.scissorPixels,a.presentationCacheFullRebuilds+=r.presentationCacheFullRebuilds,a.presentationCachePartialUpdates+=r.presentationCachePartialUpdates,a.presentationCacheOffscreenSkips+=r.presentationCacheOffscreenSkips,a.presentationCacheUpdatedPixels+=r.presentationCacheUpdatedPixels,a.legacyDisplayShaderPixels+=r.legacyDisplayShaderPixels,a.presentationCopiedPixels+=r.presentationCopiedPixels,a.paintDisplayMaximumSelectedMipLevel=Math.max(a.paintDisplayMaximumSelectedMipLevel,r.displaySelectedMipLevel),a.paintDisplayPyramidMaintenanceFrames+=r.paintDisplayPyramidMaintenanceFrames,a.paintDisplayPyramidFullLevelBuilds+=r.paintDisplayPyramidFullLevelBuilds,a.paintDisplayPyramidDirtyLevelUpdates+=r.paintDisplayPyramidDirtyLevelUpdates,a.paintDisplayPyramidPasses+=r.paintDisplayPyramidPasses,a.paintDisplayPyramidBaseDirtyPixels+=r.paintDisplayPyramidBaseDirtyPixels,a.paintDisplayPyramidUpdatedPixels+=r.paintDisplayPyramidUpdatedPixels,a.paintDisplayPyramidEncodingMs+=r.paintDisplayPyramidEncodingMs,a.lightGlazeBatches+=r.lightGlazeBatches,a.lightGlazeCommits+=r.lightGlazeCommits,a.lightGlazeCompositePixels+=r.lightGlazeCompositePixels,a.lightGlazePyramidPasses+=r.lightGlazePyramidPasses,a.lightGlazePyramidUpdatedPixels+=r.lightGlazePyramidUpdatedPixels,a.grainBatches+=r.grainBatches,a.grainBaseStamps+=r.grainBaseStamps,a.grainPhysicalCopies+=r.grainPhysicalCopies,a.grainCircleBatches+=r.grainCircleBatches,a.grainShapeBatches+=r.grainShapeBatches,t>0&&(a.brushBatches+=1,a.physicalCopies+=t*n,a.largestBatchStamps=Math.max(a.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}publishHistoryState(){this.callbacks.onHistoryChange?.(this.getHistoryState())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function z(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function B(e){return Number(z(e).value)}function V(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var H=z(`gpuCanvas`),Mt=z(`tipPreviewCanvas`),Nt=z(`controlsPanel`),Pt=z(`toggleControls`),Ft=z(`status`),It=z(`runBenchmark`),Lt=z(`benchmarkResult`),Rt=z(`recordHumanStroke`),zt=z(`playHumanStroke`),U=z(`humanStrokeResult`),Bt=z(`humanStrokeTestVariant`),Vt=z(`humanStrokeTestBlendMode`),Ht=z(`humanStrokeTestGrainMode`),Ut=z(`layerFormat`),Wt=z(`clearLayer`),Gt=z(`undoStroke`),Kt=z(`redoStroke`),qt=z(`fitView`),Jt=z(`zoomIn`),Yt=z(`zoomOut`),Xt=z(`benchmarkStamps`),Zt=`webgpu-brush-engine.human-stroke.v1`,Qt=`/api/human-stroke`,$t=`/api/benchmark-runs`,W={canUndo:!1,canRedo:!1,busy:!1,actionCount:0,cursor:0,storedBaseStamps:0,logicalStampBytes:0},G=new jt(H,{onStatus(e,t){Ft.textContent=e,Ft.className=`status ${t===`working`?``:t}`},onStats(e){Vn(e)},onHistoryChange(e){W=e,Z(),Y()}},Mt),K=null,en=null,tn=!1,q=!1,nn=!0,rn=!1,an=!1,on=!1,sn=!1,cn=!1,ln=!0;function un(e){ln=e,Nt.hidden=!e,Pt.setAttribute(`aria-expanded`,String(e)),Pt.setAttribute(`aria-label`,e?`Nascondi pannelli`:`Mostra pannelli`),Pt.title=e?`Nascondi pannelli`:`Mostra pannelli`}function dn(){return{shape:z(`brushShape`).value,shapeScatter:B(`shapeScatter`)/100,grainMode:z(`grainMode`).value,grainScale:B(`grainScale`)/100,grainDepth:B(`grainDepth`)/100,grainBrightness:B(`grainBrightness`)/100,grainContrast:B(`grainContrast`)/100,grainInvert:z(`grainInvert`).checked,grainFiltering:z(`grainFiltering`).value,grainBlendMode:z(`grainBlendMode`).value,color:z(`brushColor`).value,size:B(`brushSize`),spacingPercent:B(`spacing`),startThickness:B(`startThickness`)/100,endThickness:B(`endThickness`)/100,speedThickness:B(`speedThickness`),count:B(`count`),flow:B(`flow`)/100,opacity:B(`opacity`)/100,hardness:B(`hardness`)/100,blendIntensity:B(`blendIntensity`),blendMode:z(`blendMode`).value,jitterMaster:B(`jitterMaster`)/100,hueJitterDegrees:B(`hueJitter`),saturationJitter:B(`saturationJitter`)/100,lightnessJitter:B(`lightnessJitter`)/100,darknessJitter:B(`darknessJitter`)/100,jitterPerCopy:z(`jitterPerCopy`).checked,positionJitterLateral:B(`positionJitterLateral`)/100,positionJitterLinear:B(`positionJitterLinear`)/100,pressureSize:B(`pressureSize`)/100,pressureOpacity:B(`pressureOpacity`)/100}}function fn(){z(`shapeScatterOut`).value=`${B(`shapeScatter`).toFixed(0)}%`,z(`grainScaleOut`).value=`${B(`grainScale`).toFixed(0)}%`,z(`grainDepthOut`).value=`${B(`grainDepth`).toFixed(0)}%`;let e=B(`grainBrightness`);z(`grainBrightnessOut`).value=`${e>0?`+`:``}${e.toFixed(0)}%`;let t=B(`grainContrast`);z(`grainContrastOut`).value=`${t>0?`+`:``}${t.toFixed(0)}%`,z(`brushSizeOut`).value=`${B(`brushSize`).toFixed(0)} px`,z(`spacingOut`).value=`${B(`spacing`).toFixed(2)}%`,z(`startThicknessOut`).value=`${B(`startThickness`).toFixed(0)}%`,z(`endThicknessOut`).value=`${B(`endThickness`).toFixed(0)}%`;let n=B(`speedThickness`);z(`speedThicknessOut`).value=`${n>0?`+`:``}${n.toFixed(0)}%`,z(`countOut`).value=B(`count`).toFixed(0),z(`flowOut`).value=`${B(`flow`).toFixed(1).replace(`.0`,``)}%`,z(`opacityOut`).value=`${B(`opacity`).toFixed(1).replace(`.0`,``)}%`,z(`hardnessOut`).value=`${B(`hardness`).toFixed(0)}%`,z(`blendIntensityOut`).value=`${B(`blendIntensity`).toFixed(2)}×`,z(`jitterMasterOut`).value=`${B(`jitterMaster`).toFixed(0)}%`,z(`hueJitterOut`).value=`${B(`hueJitter`).toFixed(0)}°`,z(`saturationJitterOut`).value=`${B(`saturationJitter`).toFixed(0)}%`,z(`lightnessJitterOut`).value=`${B(`lightnessJitter`).toFixed(0)}%`,z(`darknessJitterOut`).value=`${B(`darknessJitter`).toFixed(0)}%`,z(`positionJitterLateralOut`).value=`${B(`positionJitterLateral`).toFixed(0)}%`,z(`positionJitterLinearOut`).value=`${B(`positionJitterLinear`).toFixed(0)}%`,z(`pressureSizeOut`).value=`${B(`pressureSize`).toFixed(0)}%`,z(`pressureOpacityOut`).value=`${B(`pressureOpacity`).toFixed(0)}%`,z(`benchmarkStampsOut`).value=V(B(`benchmarkStamps`))}function pn(){fn(),zn(),G.setBrushSettings(dn())}function mn(e){return`${(e/1e3).toFixed(2)} s`}function hn(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function gn(){return new Promise(e=>requestAnimationFrame(e))}function _n(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function vn(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:hn(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function yn(){let e=navigator,t=G.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,controlsLayoutStrategy:`full-stage-overlay-drawer`,touchNavigationStrategy:`two-finger-pan-pinch`,performanceTelemetryRevision:27,...t}}async function bn(e){let t=await fetch($t,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function xn(e){if(typeof e!=`object`||!e)return null;let t=e;if(t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0)return null;let n=t,r=Number.isFinite(n.settings.opacity)?Math.min(1,Math.max(0,n.settings.opacity)):1,i=n.settings.blendMode===`additive`||n.settings.blendMode===`light-glaze`||n.settings.blendMode===`m1-glaze`?n.settings.blendMode:`normal`,a=n.settings.grainMode===`texturized`||n.settings.grainMode===`moving`?n.settings.grainMode:`off`,o=Number.isFinite(n.settings.grainScale)?Math.min(4,Math.max(.1,n.settings.grainScale)):1.4,s=Number.isFinite(n.settings.grainDepth)?Math.min(1,Math.max(0,n.settings.grainDepth)):1,c=Number.isFinite(n.settings.grainBrightness)?Math.min(1,Math.max(-1,n.settings.grainBrightness)):0,l=Number.isFinite(n.settings.grainContrast)?Math.min(1,Math.max(-1,n.settings.grainContrast)):0,u=n.settings.grainInvert===!0,d=n.settings.grainFiltering===`no`||n.settings.grainFiltering===`classic`?n.settings.grainFiltering:`improved`,f=Number.isFinite(n.settings.startThickness)?Math.min(2,Math.max(0,n.settings.startThickness)):1,p=Number.isFinite(n.settings.endThickness)?Math.min(2,Math.max(0,n.settings.endThickness)):1,m=Number.isFinite(n.settings.speedThickness)?Math.min(200,Math.max(-200,n.settings.speedThickness)):0;return{...n,settings:{...n.settings,shape:n.settings.shape===`shape`?`shape`:`circle`,shapeScatter:Number.isFinite(n.settings.shapeScatter)?Math.min(1,Math.max(0,n.settings.shapeScatter)):0,grainMode:a,grainScale:o,grainDepth:s,grainBrightness:c,grainContrast:l,grainInvert:u,grainFiltering:d,grainBlendMode:`multiply`,startThickness:f,endThickness:p,speedThickness:m,opacity:r,blendMode:i}}}function Sn(){try{let e=window.localStorage.getItem(Zt);return e?xn(JSON.parse(e)):null}catch{return null}}function Cn(){try{window.localStorage.removeItem(Zt)}catch{}}async function wn(){let e=await fetch(Qt,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return xn(await e.json())}async function Tn(e){let t=await fetch(Qt,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=xn(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=xn(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function En(){nn=!0,Y();try{let e=await wn();if(e){K=e,Cn(),U.textContent=Ln(e);return}let t=Sn();if(t){U.textContent=`Fissaggio del tratto che avevi già registrato…`,K=await Tn(t),Cn(),U.textContent=Ln(K);return}U.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){U.textContent=e instanceof Error?e.message:String(e)}finally{nn=!1,Y()}}function J(e,t){z(e).value=String(t)}function Dn(e){J(`brushShape`,e.shape===`shape`?`shape`:`circle`),J(`shapeScatter`,(e.shapeScatter??0)*100),J(`grainMode`,e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:`off`),J(`grainScale`,(e.grainScale??1.4)*100),J(`grainDepth`,(e.grainDepth??1)*100),J(`grainBrightness`,(e.grainBrightness??0)*100),J(`grainContrast`,(e.grainContrast??0)*100),z(`grainInvert`).checked=e.grainInvert===!0,J(`grainFiltering`,e.grainFiltering===`no`||e.grainFiltering===`classic`?e.grainFiltering:`improved`),J(`grainBlendMode`,`multiply`),J(`brushColor`,e.color),J(`brushSize`,e.size),J(`spacing`,e.spacingPercent),J(`startThickness`,(e.startThickness??1)*100),J(`endThickness`,(e.endThickness??1)*100),J(`speedThickness`,e.speedThickness??0),J(`count`,e.count),J(`flow`,e.flow*100),J(`opacity`,(e.opacity??1)*100),J(`hardness`,e.hardness*100),J(`blendIntensity`,e.blendIntensity),J(`blendMode`,e.blendMode),J(`jitterMaster`,e.jitterMaster*100),J(`hueJitter`,e.hueJitterDegrees),J(`saturationJitter`,e.saturationJitter*100),J(`lightnessJitter`,e.lightnessJitter*100),J(`darknessJitter`,e.darknessJitter*100),z(`jitterPerCopy`).checked=e.jitterPerCopy,J(`positionJitterLateral`,e.positionJitterLateral*100),J(`positionJitterLinear`,e.positionJitterLinear*100),J(`pressureSize`,e.pressureSize*100),J(`pressureOpacity`,e.pressureOpacity*100),pn()}function On(){return J(`brushShape`,`circle`),J(`shapeScatter`,0),J(`grainMode`,`off`),J(`grainScale`,140),J(`grainDepth`,100),J(`grainBrightness`,0),J(`grainContrast`,0),z(`grainInvert`).checked=!1,J(`grainFiltering`,`improved`),J(`grainBlendMode`,`multiply`),J(`brushSize`,750),J(`spacing`,1),J(`startThickness`,100),J(`endThickness`,100),J(`speedThickness`,0),J(`count`,16),J(`flow`,100),J(`opacity`,100),J(`hardness`,100),J(`blendIntensity`,4),J(`blendMode`,`normal`),J(`jitterMaster`,100),J(`hueJitter`,180),J(`saturationJitter`,100),z(`jitterPerCopy`).checked=!0,J(`positionJitterLateral`,100),J(`positionJitterLinear`,100),J(`pressureSize`,0),J(`pressureOpacity`,0),pn(),dn()}function kn(){return Bt.value===`fur`?`fur`:`base`}function An(){return Vt.value===`m1-glaze`?`m1-glaze`:`normal`}function jn(){return Ht.value===`texturized`?`texturized`:`off`}function Mn(e,t,n,r){let i={...e.settings,opacity:1,blendIntensity:n===`m1-glaze`?1:4,blendMode:n,grainMode:r,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,shape:`circle`,shapeScatter:0,startThickness:1,endThickness:1,speedThickness:0,positionJitterLateral:1,positionJitterLinear:1};return t===`fur`?{...i,shape:`shape`,shapeScatter:1,positionJitterLateral:0,positionJitterLinear:0}:i}function Nn(e,t,n){return`${e===`fur`?`Fur`:`Base`} · ${t===`m1-glaze`?`M1 Glaze non accumulativo · 1×`:`Normal accumulativo · 4×`} · ${n===`texturized`?`Grain Fixed M1`:`Grain Off`}`}function Y(){let e=!cn||sn||W.busy||an||on;Rt.disabled=e||nn||rn||q||!!K,Rt.textContent=tn?`Annulla registrazione tratto`:K?`Tratto umano fissato`:`Registra tratto umano`,zt.disabled=e||!K||nn||rn||q,Bt.disabled=e||nn||rn||q||tn||!!en,Vt.disabled=e||nn||rn||q||tn||!!en,Ht.disabled=e||nn||rn||q||tn||!!en}function Pn(){return!cn||sn||W.busy||an||on||q||rn}function X(){return Pn()||Q!==null}function Z(){let e=X();Gt.disabled=e||!W.canUndo,Kt.disabled=e||!W.canRedo,Wt.disabled=e,It.disabled=e,Xt.disabled=e,Ut.disabled=e,qt.disabled=e,Jt.disabled=e,Yt.disabled=e,Pt.disabled=an||q;for(let t of Bn)z(t).disabled=e;zn(e)}async function Fn(e){if(!(X()||Q!==null)&&!(e===`undo`?!W.canUndo:!W.canRedo)){sn=!0,Z(),Y();try{e===`undo`?await G.undo():await G.redo()}catch(e){Ft.textContent=e instanceof Error?e.message:String(e),Ft.className=`status error`}finally{sn=!1,W=G.getHistoryState(),Z(),Y()}}}async function In(){if(!(X()||Q!==null)){sn=!0,Z(),Y();try{await G.clear()}catch(e){Ft.textContent=e instanceof Error?e.message:String(e),Ft.className=`status error`}finally{sn=!1,W=G.getHistoryState(),Z(),Y()}}}function Ln(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${V(e.points.length)} campioni`,`durata ${mn(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}var Rn=[`grainScale`,`grainDepth`,`grainBrightness`,`grainContrast`,`grainInvert`,`grainFiltering`,`grainBlendMode`];function zn(e=X()){let t=z(`grainMode`).value,n=t===`texturized`||t===`moving`;z(`grainParameters`).hidden=!n;for(let r of Rn)z(r).disabled=e||!n||r===`grainScale`&&t===`moving`}var Bn=[`brushShape`,`shapeScatter`,`grainMode`,...Rn,`brushColor`,`brushSize`,`spacing`,`startThickness`,`endThickness`,`speedThickness`,`count`,`flow`,`opacity`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`,`pressureSize`,`pressureOpacity`];for(let e of Bn)z(e).addEventListener(`input`,pn),z(e).addEventListener(`change`,pn);Xt.addEventListener(`input`,fn),Pt.addEventListener(`click`,()=>{Pt.disabled||un(!ln)}),Wt.addEventListener(`click`,()=>{In()}),Gt.addEventListener(`click`,()=>{Fn(`undo`)}),Kt.addEventListener(`click`,()=>{Fn(`redo`)}),qt.addEventListener(`click`,()=>{!X()&&Q===null&&G.fitView()}),Jt.addEventListener(`click`,()=>{!X()&&Q===null&&G.zoomBy(1.35)}),Yt.addEventListener(`click`,()=>{!X()&&Q===null&&G.zoomBy(1/1.35)}),Ut.addEventListener(`change`,async()=>{if(X()||Q!==null){Ut.value=G.getStats().layerFormat;return}let e=Ut.value;on=!0,Ut.disabled=!0,Z(),Y();try{await G.setLayerFormat(e)||(Ut.value=G.getStats().layerFormat)}catch{Ut.value=G.getStats().layerFormat}finally{on=!1,W=G.getHistoryState(),Z(),Y()}}),It.addEventListener(`click`,async()=>{if(!X()){un(!1),an=!0,It.disabled=!0,Z(),Y(),Lt.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await G.runBenchmark(B(`benchmarkStamps`));Lt.textContent=[`${V(e.baseStamps)} base stamps`,`${V(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){Lt.textContent=e instanceof Error?e.message:String(e)}finally{an=!1,It.disabled=!1,W=G.getHistoryState(),Z(),Y()}}}),Rt.addEventListener(`click`,()=>{X()||nn||rn||q||en||K||(tn=!tn,tn?(On(),un(!1),U.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):U.textContent=K?Ln(K):`Registrazione annullata.`,Y())}),zt.addEventListener(`click`,()=>{Gn()});function Vn(e){z(`fpsStat`).textContent=`${e.fps}`,z(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,z(`stampStat`).textContent=V(e.totalBaseStamps),z(`avoidedStat`).textContent=V(e.avoidedLogicalDraws),z(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,z(`gpuStat`).textContent=e.gpuLabel}function Hn(e,t){let n=On(),r=G.toLayerPoint(t);en={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},U.textContent=`Registrazione in corso…`}function Un(e,t){let n=en;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...G.toLayerPoint(t[r]),timeMs:a})}}async function Wn(e){let t=en;if(en=null,tn=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};rn=!0,U.textContent=`Fissaggio permanente del tratto di riferimento…`,Y();try{K=await Tn(e),Cn(),U.textContent=Ln(K)}catch(e){U.textContent=e instanceof Error?e.message:String(e)}finally{rn=!1}}else t&&(U.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);Y()}async function Gn(){let e=K;if(!e||q||X())return;let t=kn(),n=An(),r=jn(),i=Mn(e,t,n,r),a=Nn(t,n,r);un(!1),q=!0,It.disabled=!0,Y(),Z(),Dn(i),U.textContent=`Riproduzione test ${a} in corso…`;try{if(await G.waitForIdle(),G.resetStrokeRandomSeed(),!G.resetDocument())throw Error(`Il documento è occupato da un'operazione Undo/Redo.`);await G.waitForIdle();let o=G.getStats(),s=performance.now(),c=e.points[e.points.length-1],l=[],u=[],d=1;G.startStrokePerformanceProfile();let f=performance.now();G.beginStrokeAtLayer(e.points[0]),u.push(performance.now()-f),await new Promise(t=>{let n=r=>{let i=r-s,a=[];for(;d<e.points.length&&e.points[d].timeMs<=i;)l.push(Math.max(0,i-e.points[d].timeMs)),a.push(e.points[d]),d+=1;if(a.length>0){let e=performance.now();G.extendStrokeAtLayer(a),u.push(performance.now()-e)}if(d<e.points.length){requestAnimationFrame(n);return}G.endStroke(c.timeMs),t()};requestAnimationFrame(n)});let p=performance.now();await G.waitForIdle();let m=performance.now();await gn();let h=performance.now(),g=G.finishStrokePerformanceProfile();if(!g)throw Error(`Profilo del tratto non disponibile.`);let _=G.getStats(),v=Math.max(0,_.totalBaseStamps-o.totalBaseStamps),y=v*i.count,b={inputDeliveryMs:p-s,inputDelayP50Ms:hn(l,.5),inputDelayP95Ms:hn(l,.95),inputDelayMaxMs:l.length===0?0:Math.max(...l),layerInputDispatchTotalMs:u.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:hn(u,.5),layerInputDispatchP95Ms:hn(u,.95),layerInputDispatchMaxMs:u.length===0?0:Math.max(...u),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,m-p),endToPresentedMs:Math.max(0,h-s)},x=await bn({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:e.capturedAt,traceFingerprint:_n(e.points),pointCount:e.points.length,traceDurationMs:c.timeMs,...vn(e.points),testVariant:t,testBlendMode:n,testGrainMode:r,settings:i},playback:b,performance:g,environment:yn()});U.textContent=[`Test ${a}`,`Tratto ${mn(c.timeMs)}`,`${V(e.points.length)} campioni`,`${V(v)} stamps base`,`${V(y)} copie fisiche`,`coda GPU ${b.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${g.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${g.submitImmediateP95Ms.toFixed(2)} ms`,`display mip ${g.paintDisplaySelectedMipLevel} / ${V(g.paintDisplayPyramidPasses)} pass`,g.adaptivePreviewActivations>0?`preview tip ${V(g.adaptivePreviewBaseStampsDrawn)} stamp / ${g.adaptivePreviewJsTotalMs.toFixed(2)} ms JS`:`preview tip non attivata`,`spacing adattivo ${g.adaptiveSpacingInitialPercent.toFixed(2)}→${g.adaptiveSpacingFinalPercent.toFixed(2)}% / ${g.adaptiveSpacingIncreaseCount} step`,`history CPU ${V(g.historyCapturedBaseStamps)} stamp / ${V(g.historyCapturedBatches)} batch`,`FPS medi ${g.averageRenderFps.toFixed(1)}`,`${V(g.delayedRenderFrames)} frame >20 ms`,`presentazione ${b.endToPresentedMs.toFixed(2)} ms`,x>0?`run #${x} salvata`:`run salvata`].join(` · `)}catch(e){G.finishStrokePerformanceProfile(),U.textContent=e instanceof Error?e.message:String(e)}finally{q=!1,It.disabled=!1,Y(),W=G.getHistoryState(),Z()}}function Kn(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function qn(e){return{clientX:e.clientX,clientY:e.clientY,pressure:Kn(e),timeMs:e.timeStamp}}var Q=null,$=null,Jn=0,Yn=0,Xn=new Map,Zn=null;function Qn(){let e=[...Xn.values()];if(e.length<2)return null;let t=e[0],n=e[1];return{centerX:(t.clientX+n.clientX)*.5,centerY:(t.clientY+n.clientY)*.5,distance:Math.max(1,Math.hypot(n.clientX-t.clientX,n.clientY-t.clientY))}}function $n(){en&&(en=null,tn=!1,U.textContent=`Registrazione annullata dal gesto a due dita.`,Y())}function er(){$!==`touch-navigation`&&($===`paint`&&(G.cancelStrokeBeforeRender()||G.endStroke(),$n()),$=`touch-navigation`,H.classList.add(`panning`)),Zn=Qn()}H.addEventListener(`pointerdown`,e=>{if(e.pointerType===`touch`&&Q!==null&&Xn.size>0&&!Pn()){e.preventDefault(),Xn.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),H.setPointerCapture(e.pointerId),Xn.size>=2&&er();return}if(!(Q!==null||Pn())){if(e.preventDefault(),Q=e.pointerId,e.pointerType===`touch`&&Xn.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),$=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,H.setPointerCapture(e.pointerId),$===`pan`)H.classList.add(`panning`),Jn=e.clientX,Yn=e.clientY;else{let t=qn(e);tn&&Hn(e,t),G.beginStroke(t)}requestAnimationFrame(()=>{Q===e.pointerId&&(Z(),Y())})}}),H.addEventListener(`pointermove`,e=>{if(e.pointerType===`touch`&&Xn.has(e.pointerId)&&(Xn.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),$===`touch-navigation`)){e.preventDefault();let t=Qn(),n=Zn;if(t&&n){let e=t.centerX-n.centerX,r=t.centerY-n.centerY;(Math.abs(e)>.01||Math.abs(r)>.01)&&G.panByClientDelta(e,r);let i=t.distance/n.distance;Number.isFinite(i)&&Math.abs(i-1)>1e-4&&G.zoomBy(Math.min(2,Math.max(.5,i)),t.centerX,t.centerY)}Zn=t;return}if(e.pointerId!==Q||$===null)return;if(e.preventDefault(),$===`pan`){G.panByClientDelta(e.clientX-Jn,e.clientY-Yn),Jn=e.clientX,Yn=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(qn);Un(n,r),G.extendStroke(r)});function tr(e){if(e.pointerType===`touch`&&Xn.delete(e.pointerId),$===`touch-navigation`){e.preventDefault();let t=Xn.keys().next().value;Q=typeof t==`number`?t:null,Zn=Qn(),Xn.size===0&&(H.classList.remove(`panning`),$=null,W=G.getHistoryState(),Z(),Y());return}e.pointerId===Q&&($===`paint`&&(G.endStroke(e.timeStamp),Wn(e.type===`pointerup`)),H.classList.remove(`panning`),$=null,Q=null,Zn=null,W=G.getHistoryState(),Z(),Y())}H.addEventListener(`pointerup`,tr),H.addEventListener(`pointercancel`,tr),H.addEventListener(`lostpointercapture`,tr),H.addEventListener(`contextmenu`,e=>e.preventDefault()),window.addEventListener(`keydown`,e=>{if(e.defaultPrevented||e.repeat||e.isComposing||e.altKey||!e.ctrlKey&&!e.metaKey||e.key.toLowerCase()!==`z`||(e.target instanceof Element?e.target:null)?.closest(`input, textarea, select, [contenteditable]`))return;let t=e.shiftKey?`redo`:`undo`;!(t===`undo`?W.canUndo:W.canRedo)||X()||Q!==null||(e.preventDefault(),Fn(t))}),H.addEventListener(`wheel`,e=>{if(e.preventDefault(),X()||Q!==null)return;let t=Math.exp(-e.deltaY*.0015);G.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>G.resizeCanvas()).observe(H),un(!0),fn(),G.setBrushSettings(dn()),Y(),Z(),En(),G.initialize().then(()=>{cn=!0,W=G.getHistoryState(),Z(),Y()}).catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;Ft.textContent=`${e instanceof Error?e.message:String(e)}${t}`,Ft.className=`status error`,It.disabled=!0,Z()}),window.setInterval(()=>Vn(G.getStats()),500);