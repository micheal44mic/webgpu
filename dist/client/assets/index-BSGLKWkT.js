(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=new Uint8Array([137,80,78,71,13,10,26,10]),r=13;function i(e,t){return String.fromCharCode(e[t],e[t+1],e[t+2],e[t+3])}function a(e,t,n){let r=e+t-n,i=Math.abs(r-e),a=Math.abs(r-t),o=Math.abs(r-n);return i<=a&&i<=o?e:a<=o?t:n}function o(e,t,n){let r=t+1,i=r*n;if(e.byteLength!==i)throw Error(`Dati PNG decompressi non validi: attesi ${i} byte, trovati ${e.byteLength}.`);let o=new Uint8Array(t*n);for(let i=0;i<n;i+=1){let n=i*r,s=i*t,c=e[n];if(c>4)throw Error(`Filtro PNG non supportato: ${c}.`);for(let r=0;r<t;r+=1){let l=e[n+1+r],u=r>0?o[s+r-1]:0,d=i>0?o[s-t+r]:0,f=r>0&&i>0?o[s-t+r-1]:0,p=0;c===1?p=u:c===2?p=d:c===3?p=Math.floor((u+d)*.5):c===4&&(p=a(u,d,f)),o[s+r]=l+p&255}}return o}async function s(e){let t=new Uint8Array(e);if(t.byteLength<n.byteLength+12)throw Error(`PNG troppo corta.`);for(let e=0;e<n.byteLength;e+=1)if(t[e]!==n[e])throw Error(`Firma PNG non valida.`);let a=new DataView(e),s=[],c=0,l=0,u=0,d=!1,f=!1,p=n.byteLength;for(;p+12<=t.byteLength;){let e=a.getUint32(p,!1),n=p+4,o=p+8,m=o+e,h=m+4;if(m<o||h>t.byteLength)throw Error(`Chunk PNG oltre la fine del file.`);let g=i(t,n);if(g===`IHDR`){if(d||e!==r)throw Error(`Header PNG non valido.`);l=a.getUint32(o,!1),u=a.getUint32(o+4,!1);let n=t[o+8],i=t[o+9],s=t[o+10],c=t[o+11],f=t[o+12];if(l<=0||u<=0)throw Error(`Dimensioni PNG non valide.`);if(n!==8||i!==0||s!==0||c!==0||f!==0)throw Error(`La Shape richiede una PNG grayscale 8-bit, non interlacciata e con compressione standard.`);d=!0}else if(g===`IDAT`){if(!d||f)throw Error(`Ordine dei chunk PNG non valido.`);let e=t.slice(o,m);s.push(e),c+=e.byteLength}else if(g===`IEND`){f=!0;break}p=h}if(!d||!f||s.length===0)throw Error(`PNG incompleta.`);let m=new Uint8Array(c),h=0;for(let e of s)m.set(e,h),h+=e.byteLength;if(typeof DecompressionStream>`u`)throw Error(`DecompressionStream non disponibile.`);let g=new Blob([m]).stream().pipeThrough(new DecompressionStream(`deflate`)),_=new Uint8Array(await new Response(g).arrayBuffer());return{width:l,height:u,pixels:o(_,l,u)}}var c=`
const MAX_COUNT: u32 = 24u;
const TAU: f32 = 6.283185307179586;
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  _pad0: vec2<f32>,
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
  let clipPosition = vec2<f32>(
    layerPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - layerPosition.y / brush.layerSize.y * 2.0
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
  let clipPosition = vec2<f32>(
    layerPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - layerPosition.y / brush.layerSize.y * 2.0
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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
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

  let pressureInfluence = clamp(brush.controls.w, 0.0, 1.0);
  let pressureAlpha = mix(1.0, clamp(input.pressure, 0.0, 1.0), pressureInfluence);
  let alpha = clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );

  return vec4<f32>(input.pointColor * alpha, alpha);
}

@fragment
fn shapeFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let sourceCoverage = textureSample(shapeMaskTexture, shapeMaskSampler, uv).r;
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }

  let pressureInfluence = clamp(brush.controls.w, 0.0, 1.0);
  let pressureAlpha = mix(1.0, clamp(input.pressure, 0.0, 1.0), pressureInfluence);
  let alpha = clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );

  return vec4<f32>(input.pointColor * alpha, alpha);
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

@fragment
fn shapeOccupancyFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
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

  let pressureInfluence = clamp(brush.controls.w, 0.0, 1.0);
  let pressureAlpha = mix(1.0, clamp(input.pressure, 0.0, 1.0), pressureInfluence);
  let alpha = clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );

  return vec4<f32>(input.pointColor * alpha, alpha);
}
`,l=`
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
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
  let paint = textureSampleLevel(layerTexture, layerSampler, uv, 0.0);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,u=4096,d=32,f=65536,p=4,m=`quad`,h=`generic-smoothstep`,g=`shape-alpha-mask-2k`,_=`coarse-occupancy-bitmask`,v=`legacy-full-mask`,y=`png-gray8-direct`,b=`canvas-fallback`,x=`reuse-position-copy-seed`,ee=`directional-jitter-bounds`,S=2048,C=256,w=S/C,te=C*C,T=te/32,E=4,D=5,ne=128,re=.5,ie=T*4,ae=96,oe=32;function O(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function k(e){return e.length===0?0:Math.max(...e)}function se(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}function ce(e){let t=new Uint32Array(T*D),n=new Uint8Array(te),r=[],i=[];for(let a=0;a<D;a+=1){let o=e[a],s=S>>a,c=1<<a;for(let e=0;e<s;e+=1)for(let t=0;t<s;t+=1){if(o[e*s+t]===0)continue;let r=Math.max(0,(t-.5)*c),i=Math.min(S,(t+1.5)*c),a=Math.max(0,(e-.5)*c),l=Math.min(S,(e+1.5)*c),u=Math.max(0,Math.floor(r/w)),d=Math.min(C-1,Math.ceil(i/w)-1),f=Math.max(0,Math.floor(a/w)),p=Math.min(C-1,Math.ceil(l/w)-1);for(let e=f;e<=p;e+=1){let t=e*C;for(let e=u;e<=d;e+=1)n[t+e]=1}}let l=0,u=a*T;for(let e=0;e<n.length;e+=1){if(n[e]===0)continue;l+=1;let r=u+(e>>>5);t[r]|=1<<(e&31)>>>0}r.push(l),i.push(l/te)}return{words:t,activeCells:r,coverageRatios:i}}var le={shape:`circle`,shapeScatter:0,color:`#ff5b35`,size:96,spacingPercent:1,count:24,flow:.07,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1,pressureSize:.65,pressureOpacity:.35},ue=class{layerSize=u;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;brushUniformBuffer;displayUniformBuffer;instanceBuffer;shapeOccupancyUniformBuffers=[];sampler;shapeMaskTexture;shapeMaskView;shapeMaskSampler;shapeMaskDecodeStrategy=b;shapeOccupancyActiveCells=Array(D).fill(0);shapeOccupancyCoverageRatios=Array(D).fill(1);packedMinimumRadius=1/0;brushBindGroupLayout;brushOccupancyBindGroupLayout;displayBindGroupLayout;brushBindGroup;brushOccupancyBindGroups=[];displayBindGroup;brushShaderModule;displayShaderModule;normalPipeline;additivePipeline;shapeNormalPipeline;shapeAdditivePipeline;shapeOccupancyNormalPipeline;shapeOccupancyAdditivePipeline;displayPipeline;instanceUpload=new ArrayBuffer(f*d);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);brushUniformUpload=new ArrayBuffer(ae);displayUniformUpload=new Float32Array(oe/4);settings={...le};pendingStamps=[];activeStroke=null;seedSequence=1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=u*.5;viewCenterY=u*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;lastStampGeometry=m;lastStampVerticesPerCopy=p;lastShapeSamplingStrategy=`none`;lastShapeOccupancyFallbackReason=`none`;lastShapeOccupancyMipLevel=-1;lastShapeOccupancyActiveCells=0;lastShapeOccupancyCoverageRatio=0;lastShapeOccupancyCandidateMipLevel=-1;lastShapeOccupancyCandidateActiveCells=0;lastShapeOccupancyCandidateCoverageRatio=0;constructor(e,t={}){this.canvas=e,this.callbacks=t}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<u)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${u}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats()}getSettings(){return{...this.settings}}setBrushSettings(e){this.settings={...this.settings,...e,shape:e.shape===`shape`||e.shape===`circle`?e.shape:this.settings.shape,shapeScatter:t(e.shapeScatter??this.settings.shapeScatter,0,1),count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),flow:t(e.flow??this.settings.flow,.001,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.initialized&&(this.writeBrushUniforms(),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(!this.initialized||e===this.layerFormat)return;this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`),await this.device.queue.onSubmittedWorkDone();let t=this.layerFormat;try{await this.recreateLayerResources(e),this.layerFormat=e,this.clearRequested=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats()}catch(n){await this.recreateLayerResources(t),this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=u*.5,this.viewCenterY=u*.5,this.zoom=Math.max(.01,Math.min(e/u,t/u)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.requestRender()}zoomBy(e,n,r){let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.requestRender()}panByClientDelta(e,t){let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){this.activeStroke={lastInput:e,distanceSinceStamp:0},this.emitStamp(e,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(){this.activeStroke=null}clear(){this.pendingStamps.length=0,this.activeStroke=null,this.clearRequested=!0,this.displayDirty=!0,this.requestRender()}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);let n=t(Math.round(e),1,Math.min(12e3,f));this.pendingStamps.length=0,this.activeStroke=null,this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.generateBenchmarkStamps(n),i=performance.now(),a=this.submitImmediate(r,!0).totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone();let o=performance.now()-i;this.totalBaseStamps+=r.length,this.avoidedLogicalDraws+=r.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(performance.now()),this.publishStats();let s=r.reduce((e,t)=>e+t.radius*t.radius,0)/r.length,c=Math.round(Math.PI*s*r.length*this.settings.count),l=[`1 draw instanziata`,`${this.settings.count} copie fisiche GPU per stamp base`,this.settings.shape===`shape`?this.lastShapeSamplingStrategy===_?`bitmask alpha ${C}², mip ${this.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(this.lastShapeOccupancyCoverageRatio*100).toFixed(1)}%`:`quad Shape legacy da 4 vertici, fallback ${this.lastShapeOccupancyFallbackReason}, mappa candidata ${(this.lastShapeOccupancyCandidateCoverageRatio*100).toFixed(1)}%`:`geometria quad triangle-strip (4 vertici)`,this.settings.shape===`shape`?`coverage da maschera alpha 2048²`:`coverage fragment smoothstep generica`,this.settings.shape===`shape`?this.shapeMaskDecodeStrategy===y?`PNG grayscale decodificata direttamente`:`PNG decodificata tramite fallback canvas`:`nessuna maschera Shape`,this.settings.shape===`shape`?`scatter rotazione ${(this.settings.shapeScatter*100).toFixed(0)}%`:`orientamento circolare invariato`,`riuso copySeed per jitter colore per copia`,`dirty rect direzionale conservativo`].join(` · `);return{baseStamps:r.length,logicalCopies:r.length*this.settings.count,cpuSubmitMs:a,gpuCompletionMs:o,estimatedCoveredFragments:c,strategy:l}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.clearRequested||this.displayDirty;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={stampGeometry:m,stampVerticesPerCopy:p,fragmentCoverageStrategy:this.settings.shape===`shape`?g:h,shapeSamplingStrategy:`none`,shapeOccupancyFallbackReason:`none`,shapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:0,baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=se(e.renderIntervalMs);return{stampGeometry:e.stampGeometry,stampVerticesPerCopy:e.stampVerticesPerCopy,fragmentCoverageStrategy:e.fragmentCoverageStrategy,shapeSamplingStrategy:e.shapeSamplingStrategy,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:e.shapeOccupancyFallbackReason,shapeOccupancyGridSize:C,shapeOccupancyMipLevel:e.shapeOccupancyMipLevel,shapeOccupancyActiveCells:e.shapeOccupancyActiveCells,shapeOccupancyCoverageRatio:e.shapeOccupancyCoverageRatio,shapeOccupancyCandidateMipLevel:e.shapeOccupancyCandidateMipLevel,shapeOccupancyCandidateActiveCells:e.shapeOccupancyCandidateActiveCells,shapeOccupancyCandidateCoverageRatio:e.shapeOccupancyCandidateCoverageRatio,shapeOccupancyMaximumMip:E,shapeOccupancyMinimumRadius:ne,shapeOccupancyMaximumCoverageRatio:re,shapeOccupancyBitmaskBytes:ie,colorSeedStrategy:x,dirtyRectStrategy:ee,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:O(e.cpuFrameMs,.5),submitImmediateP95Ms:O(e.cpuFrameMs,.95),submitImmediateMaxMs:k(e.cpuFrameMs),renderFrameTotalP50Ms:O(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:O(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:k(e.renderFrameTotalMs),renderFrameOverheadP50Ms:O(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:O(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:k(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:O(e.cpuFrameMs,.5),cpuFrameP95Ms:O(e.cpuFrameMs,.95),cpuFrameMaxMs:k(e.cpuFrameMs),renderIntervalP50Ms:O(e.renderIntervalMs,.5),renderIntervalP95Ms:O(e.renderIntervalMs,.95),renderIntervalMaxMs:k(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:u,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:this.settings.shape===`shape`?this.lastStampGeometry:m,stampVerticesPerCopy:this.settings.shape===`shape`?this.lastStampVerticesPerCopy:p,fragmentCoverageStrategy:this.settings.shape===`shape`?g:h,shapeSamplingStrategy:this.settings.shape===`shape`?this.lastShapeSamplingStrategy:`none`,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:this.settings.shape===`shape`?this.lastShapeOccupancyFallbackReason:`none`,shapeOccupancyGridSize:C,shapeOccupancyMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateCoverageRatio:0,shapeOccupancyMaximumMip:E,shapeOccupancyMinimumRadius:ne,shapeOccupancyMaximumCoverageRatio:re,shapeOccupancyBitmaskBytes:ie,colorSeedStrategy:x,dirtyRectStrategy:ee}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:ae,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:oe,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:f*d,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.shapeMaskSampler=this.device.createSampler({label:`Shape 2K mask sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`});let e=await this.createShapeMaskResources();this.shapeMaskTexture=e.texture,this.shapeMaskView=this.shapeMaskTexture.createView({label:`Shape 2K mask view`}),this.shapeMaskDecodeStrategy=e.decodeStrategy,this.shapeOccupancyActiveCells=e.occupancyActiveCells,this.shapeOccupancyCoverageRatios=e.occupancyCoverageRatios,this.shapeOccupancyUniformBuffers=Array.from({length:D},(t,n)=>{let r=this.device.createBuffer({label:`Shape conservative occupancy bitmask mip ${n}`,size:ie,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),i=n*T;return this.device.queue.writeBuffer(r,0,e.occupancyWords.subarray(i,i+T)),r});let t=[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}];this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush legacy bind group layout`,entries:t}),this.brushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Brush occupancy bind group layout`,entries:[...t,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.brushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]})),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:c}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:l}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.displayShaderModule,`display`)]);let n=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:n,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async decodeShapeMaskWithCanvas(e){let t=await createImageBitmap(new Blob([e],{type:`image/png`}),{colorSpaceConversion:`none`,premultiplyAlpha:`none`});try{if(t.width!==S||t.height!==S)throw Error(`Shape.png deve restare ${S}×${S}px; trovata ${t.width}×${t.height}px.`);let e=document.createElement(`canvas`);e.width=S,e.height=S;let n=e.getContext(`2d`,{willReadFrequently:!0});if(!n)throw Error(`Impossibile leggere la maschera Shape.png.`);n.drawImage(t,0,0);let r=n.getImageData(0,0,S,S).data,i=new Uint8Array(S*S);for(let e=0,t=0;e<i.length;e+=1,t+=4){let n=Math.round(r[t]*.2126+r[t+1]*.7152+r[t+2]*.0722);i[e]=Math.round(n*r[t+3]/255)}return i}finally{t.close()}}async createShapeMaskResources(){let e=await fetch(new URL(``+new URL(`Shape-BcXQOKCm.png`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Shape.png (${e.status}).`);let t=await e.arrayBuffer(),n,r;try{let e=await s(t);if(e.width!==S||e.height!==S)throw Error(`Shape.png deve restare ${S}×${S}px; trovata ${e.width}×${e.height}px.`);n=e.pixels,r=y}catch{n=await this.decodeShapeMaskWithCanvas(t),r=b}let i=Math.log2(S)+1,a=this.device.createTexture({label:`Shape 2K white-times-alpha mask`,size:{width:S,height:S,depthOrArrayLayers:1},mipLevelCount:i,format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),o=n,c=S,l=[];for(let e=0;e<i;e+=1){e<=E&&l.push(o);let t=Math.ceil(c/256)*256,n=o;if(t!==c){n=new Uint8Array(t*c);for(let e=0;e<c;e+=1)n.set(o.subarray(e*c,(e+1)*c),e*t)}if(this.device.queue.writeTexture({texture:a,mipLevel:e},n,{offset:0,bytesPerRow:t,rowsPerImage:c},{width:c,height:c,depthOrArrayLayers:1}),c===1)continue;let r=c/2,i=new Uint8Array(r*r);for(let e=0;e<r;e+=1)for(let t=0;t<r;t+=1){let n=e*2*c+t*2;i[e*r+t]=Math.round((o[n]+o[n+1]+o[n+c]+o[n+c+1])/4)}o=i,c=r}let u=ce(l);return{texture:a,decodeStrategy:r,occupancyWords:u.words,occupancyActiveCells:u.activeCells,occupancyCoverageRatios:u.coverageRatios}}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:u,height:u,depthOrArrayLayers:1},format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView(),i=this.device.createPipelineLayout({label:`Brush legacy pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]}),a=this.device.createPipelineLayout({label:`Brush occupancy pipeline layout ${e}`,bindGroupLayouts:[this.brushOccupancyBindGroupLayout]});this.device.pushErrorScope(`validation`);let o=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:i,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),s=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:i,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),c=this.device.createRenderPipeline({label:`Brush shape 2K legacy normal ${e}`,layout:i,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),l=this.device.createRenderPipeline({label:`Brush shape 2K legacy additive ${e}`,layout:i,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),d=this.device.createRenderPipeline({label:`Brush shape 2K occupancy normal ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),f=this.device.createRenderPipeline({label:`Brush shape 2K occupancy additive ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),p=await this.device.popErrorScope();if(p)throw n.destroy(),Error(p.message);let m=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:r},{binding:2,resource:this.sampler}]});this.layerTexture=n,this.layerView=r,this.normalPipeline=o,this.additivePipeline=s,this.shapeNormalPipeline=c,this.shapeAdditivePipeline=l,this.shapeOccupancyNormalPipeline=d,this.shapeOccupancyAdditivePipeline=f,this.displayBindGroup=m,this.layerFormat=e,t?.destroy()}writeBrushUniforms(){let t=new Float32Array(this.brushUniformUpload),n=new Uint32Array(this.brushUniformUpload);t.fill(0);let[r,i,a]=e(this.settings.color),o=this.settings.jitterMaster;t[0]=u,t[1]=u,t[4]=r,t[5]=i,t[6]=a,t[7]=1,t[8]=this.settings.hueJitterDegrees/360*o,t[9]=this.settings.saturationJitter*o,t[10]=this.settings.lightnessJitter*o,t[11]=this.settings.darknessJitter*o,t[12]=this.settings.flow,t[13]=this.settings.hardness,t[14]=this.settings.blendIntensity,t[15]=this.settings.pressureOpacity,t[16]=this.settings.positionJitterLinear,t[17]=this.settings.positionJitterLateral,t[18]=this.settings.shapeScatter,n[20]=this.settings.count>>>0,n[21]=+!!this.settings.jitterPerCopy,n[22]=+(this.settings.blendMode===`additive`),n[23]=0,this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeDisplayUniforms(){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=u,this.displayUniformUpload[3]=u,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1)}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;let i=r.lastInput,a=e.x-i.x,o=e.y-i.y,s=Math.hypot(a,o);if(s<=1e-4){r.lastInput=e,this.recordStampGenerationTime(n);return}let c=Math.max(.1,this.settings.size*(this.settings.spacingPercent/100)),l=a/s,u=o/s,d=0,p=r.distanceSinceStamp,m=0;for(;p+(s-d)>=c;){let n=c-p;d+=n;let r=t(d/s,0,1);if(this.emitStamp({x:i.x+a*r,y:i.y+o*r,pressure:i.pressure+(e.pressure-i.pressure)*r},l,u),p=0,m+=1,m>=f)break}p+=Math.max(0,s-d),r.lastInput=e,r.distanceSinceStamp=p,this.recordStampGenerationTime(n)}emitStamp(e,n,r){let i=t(e.pressure,.01,1),a=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,i),o=Math.max(.5,this.settings.size*.5*a),s=o*2*(this.settings.positionJitterLinear+this.settings.positionJitterLateral),c=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0;e.x+o+s<0||e.y+o+s<0||e.x-o-s>=u||e.y-o-s>=u||(this.pendingStamps.push({x:e.x,y:e.y,radius:o,pressure:i,seed:c,directionX:n,directionY:r}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n,i=performance.now(),a=Math.min(this.pendingStamps.length,f),o=a>0?this.pendingStamps.splice(0,a):[],s=performance.now()-i;if(!(this.clearRequested||o.length>0||this.displayDirty)||this.canvas.width<=0||this.canvas.height<=0)return;let c=this.clearRequested,l=performance.now(),u=this.submitImmediate(o,c);this.lastCpuFrameMs=performance.now()-l,this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=o.length,this.avoidedLogicalDraws+=o.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(e);let d=performance.now();this.publishStats();let p=performance.now()-d;(this.pendingStamps.length>0||this.displayDirty||this.clearRequested)&&this.requestRender(),this.recordStrokeFrameTiming(e,o.length,u,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:s,statsPublishMs:p})}selectShapeOccupancy(e){let t=Number.isFinite(e),n=t?Math.log2(S/Math.max(1,e*2)):1/0,r=t?Math.max(0,Math.ceil(n+1e-4)):-1,i=r>=0&&r<=E,a=i?this.shapeOccupancyActiveCells[r]:0,o=i?this.shapeOccupancyCoverageRatios[r]:0;return!t||e<ne?{selectedMipLevel:null,fallbackReason:`minimum-radius`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:i?o>re?{selectedMipLevel:null,fallbackReason:`coverage-too-dense`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:r,fallbackReason:`none`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:null,fallbackReason:`mip-out-of-range`,candidateMipLevel:r,candidateActiveCells:0,candidateCoverageRatio:0}}recordShapeSampling(e){let t=e.selectedMipLevel,n=t===null?v:_,r=t===null?0:this.shapeOccupancyActiveCells[t],i=t===null?0:this.shapeOccupancyCoverageRatios[t];this.lastStampGeometry=m,this.lastStampVerticesPerCopy=p,this.lastShapeSamplingStrategy=n,this.lastShapeOccupancyFallbackReason=e.fallbackReason,this.lastShapeOccupancyMipLevel=t??-1,this.lastShapeOccupancyActiveCells=r,this.lastShapeOccupancyCoverageRatio=i,this.lastShapeOccupancyCandidateMipLevel=e.candidateMipLevel,this.lastShapeOccupancyCandidateActiveCells=e.candidateActiveCells,this.lastShapeOccupancyCandidateCoverageRatio=e.candidateCoverageRatio;let a=this.activeStrokeProfile;if(!a)return;a.stampGeometry=m,a.stampVerticesPerCopy=p;let o=a.shapeSamplingStrategy;a.shapeSamplingStrategy=a.shapeSamplingStrategy===`none`||a.shapeSamplingStrategy===n?n:`mixed`,o!==`none`&&o!==n?a.shapeOccupancyFallbackReason=`mixed`:e.fallbackReason!==`none`&&(a.shapeOccupancyFallbackReason=a.shapeOccupancyFallbackReason===`none`||a.shapeOccupancyFallbackReason===e.fallbackReason?e.fallbackReason:`mixed`),a.shapeOccupancyCandidateMipLevel=Math.max(a.shapeOccupancyCandidateMipLevel,e.candidateMipLevel),a.shapeOccupancyCandidateActiveCells=Math.max(a.shapeOccupancyCandidateActiveCells,e.candidateActiveCells),a.shapeOccupancyCandidateCoverageRatio=Math.max(a.shapeOccupancyCandidateCoverageRatio,e.candidateCoverageRatio),t!==null&&(a.shapeOccupancyMipLevel=Math.max(a.shapeOccupancyMipLevel,t),a.shapeOccupancyActiveCells=Math.max(a.shapeOccupancyActiveCells,r),a.shapeOccupancyCoverageRatio=Math.max(a.shapeOccupancyCoverageRatio,i))}submitImmediate(e,t){let n=performance.now(),r=this.device.createCommandEncoder({label:`Brush frame encoder`}),i=0,a=0,o=0,s=0,c=0,l=0;if(t||e.length>0){let n=null,s=null;if(e.length>0){let t=performance.now();n=this.packStamps(e),i=performance.now()-t;let r=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*d),this.settings.shape===`shape`&&(s=this.selectShapeOccupancy(this.packedMinimumRadius)),a=performance.now()-r}let c=performance.now(),u=r.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(e.length>0&&n){l=n.width*n.height;let t=this.settings.shape===`shape`,r=s?.selectedMipLevel??null,i=t&&r!==null,a=t?i?this.settings.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:this.settings.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:this.settings.blendMode===`additive`?this.additivePipeline:this.normalPipeline;u.setPipeline(a),u.setBindGroup(0,i?this.brushOccupancyBindGroups[r]:this.brushBindGroup),u.setScissorRect(n.x,n.y,n.width,n.height),t&&s&&this.recordShapeSampling(s),u.draw(p,e.length*this.settings.count,0,0)}u.end(),o=performance.now()-c}let u=performance.now();this.writeDisplayUniforms();let f=r.beginRenderPass({label:`Present paint layer`,colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});f.setPipeline(this.displayPipeline),f.setBindGroup(0,this.displayBindGroup),f.draw(3,1,0,0),f.end(),s=performance.now()-u;let m=performance.now();return this.device.queue.submit([r.finish()]),c=performance.now()-m,{totalCpuMs:performance.now()-n,stampPackingMs:i,instanceUploadMs:a,brushEncodingMs:o,displayEncodingMs:s,commandSubmitMs:c,scissorPixels:l}}packStamps(e){let n=u,r=u,i=0,a=0,o=1/0,s=Math.PI*this.settings.shapeScatter,c=this.settings.shape===`shape`?s>=Math.PI*.25?Math.SQRT2:Math.cos(s)+Math.sin(s):1;for(let t=0;t<e.length;t+=1){let s=e[t],l=d/4*t;this.instanceUploadF32[l]=s.x,this.instanceUploadF32[l+1]=s.y,this.instanceUploadF32[l+2]=s.radius,this.instanceUploadF32[l+3]=s.pressure,this.instanceUploadU32[l+4]=s.seed,this.instanceUploadU32[l+5]=0,this.instanceUploadF32[l+6]=s.directionX,this.instanceUploadF32[l+7]=s.directionY;let u=this.instanceUploadF32[l],f=this.instanceUploadF32[l+1],p=this.instanceUploadF32[l+2];o=Math.min(o,p);let m=this.instanceUploadF32[l+6],h=this.instanceUploadF32[l+7],g=Math.hypot(m,h),_=p*2*this.settings.positionJitterLinear,v=p*2*this.settings.positionJitterLateral,y=p*c,b,x;if(g>2e-4){let e=m/g,t=h/g;b=y+Math.abs(e)*_+Math.abs(t)*v+2,x=y+Math.abs(t)*_+Math.abs(e)*v+2}else{let e=y+_+v+2;b=e,x=e}n=Math.min(n,u-b),r=Math.min(r,f-x),i=Math.max(i,u+b),a=Math.max(a,f+x)}let l=t(Math.floor(n),0,u-1),f=t(Math.floor(r),0,u-1),p=t(Math.ceil(i),1,u),m=t(Math.ceil(a),1,u),h=Math.max(0,p-l),g=Math.max(0,m-f);return this.packedMinimumRadius=o,h>0&&g>0?{x:l,y:f,width:h,height:g}:null}generateBenchmarkStamps(e){let n=Array(e),r=u*.5,i=u*.39;for(let a=0;a<e;a+=1){let o=e<=1?0:a/(e-1),s=o*Math.PI*18,c=i*(.12+o*.88),l=t(.58+Math.sin(o*Math.PI*15)*.28,.1,1),u=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,l),d=Math.max(.5,this.settings.size*.5*u);n[a]={x:r+Math.cos(s)*c,y:r+Math.sin(s*1.037)*c,radius:d,pressure:l,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(s),directionY:Math.cos(s*1.037)}}return n}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r){let i=this.activeStrokeProfile;i&&(i.previousFrameTimestamp!==null&&i.renderIntervalMs.push(Math.max(0,e-i.previousFrameTimestamp)),i.previousFrameTimestamp=e,i.renderFrames+=1,i.cpuFrameMs.push(this.lastCpuFrameMs),i.renderFrameTotalMs.push(r.totalCpuMs),i.renderFrameOverheadMs.push(Math.max(0,r.totalCpuMs-n.totalCpuMs)),i.resizeCanvasMs+=r.resizeCanvasMs,i.batchExtractionMs+=r.batchExtractionMs,i.statsPublishMs+=r.statsPublishMs,i.stampPackingMs+=n.stampPackingMs,i.instanceUploadMs+=n.instanceUploadMs,i.brushEncodingMs+=n.brushEncodingMs,i.displayEncodingMs+=n.displayEncodingMs,i.commandSubmitMs+=n.commandSubmitMs,i.estimatedScissorPixels+=n.scissorPixels,t>0&&(i.brushBatches+=1,i.physicalCopies+=t*this.settings.count,i.largestBatchStamps=Math.max(i.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function A(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function j(e){return Number(A(e).value)}function M(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var N=A(`gpuCanvas`),P=A(`status`),F=A(`runBenchmark`),de=A(`benchmarkResult`),I=A(`recordHumanStroke`),fe=A(`playHumanStroke`),L=A(`humanStrokeResult`),pe=A(`humanStrokeTestVariant`),R=A(`layerFormat`),me=`webgpu-brush-engine.human-stroke.v1`,he=`/api/human-stroke`,ge=`/api/benchmark-runs`,z=new ue(N,{onStatus(e,t){P.textContent=e,P.className=`status ${t===`working`?``:t}`},onStats(e){Fe(e)}}),B=null,V=null,H=!1,U=!1,W=!0,G=!1;function _e(){return{shape:A(`brushShape`).value,shapeScatter:j(`shapeScatter`)/100,color:A(`brushColor`).value,size:j(`brushSize`),spacingPercent:j(`spacing`),count:j(`count`),flow:j(`flow`)/100,hardness:j(`hardness`)/100,blendIntensity:j(`blendIntensity`),blendMode:A(`blendMode`).value,jitterMaster:j(`jitterMaster`)/100,hueJitterDegrees:j(`hueJitter`),saturationJitter:j(`saturationJitter`)/100,lightnessJitter:j(`lightnessJitter`)/100,darknessJitter:j(`darknessJitter`)/100,jitterPerCopy:A(`jitterPerCopy`).checked,positionJitterLateral:j(`positionJitterLateral`)/100,positionJitterLinear:j(`positionJitterLinear`)/100,pressureSize:j(`pressureSize`)/100,pressureOpacity:j(`pressureOpacity`)/100}}function ve(){A(`shapeScatterOut`).value=`${j(`shapeScatter`).toFixed(0)}%`,A(`brushSizeOut`).value=`${j(`brushSize`).toFixed(0)} px`,A(`spacingOut`).value=`${j(`spacing`).toFixed(2)}%`,A(`countOut`).value=j(`count`).toFixed(0),A(`flowOut`).value=`${j(`flow`).toFixed(1).replace(`.0`,``)}%`,A(`hardnessOut`).value=`${j(`hardness`).toFixed(0)}%`,A(`blendIntensityOut`).value=`${j(`blendIntensity`).toFixed(2)}×`,A(`jitterMasterOut`).value=`${j(`jitterMaster`).toFixed(0)}%`,A(`hueJitterOut`).value=`${j(`hueJitter`).toFixed(0)}°`,A(`saturationJitterOut`).value=`${j(`saturationJitter`).toFixed(0)}%`,A(`lightnessJitterOut`).value=`${j(`lightnessJitter`).toFixed(0)}%`,A(`darknessJitterOut`).value=`${j(`darknessJitter`).toFixed(0)}%`,A(`positionJitterLateralOut`).value=`${j(`positionJitterLateral`).toFixed(0)}%`,A(`positionJitterLinearOut`).value=`${j(`positionJitterLinear`).toFixed(0)}%`,A(`pressureSizeOut`).value=`${j(`pressureSize`).toFixed(0)}%`,A(`pressureOpacityOut`).value=`${j(`pressureOpacity`).toFixed(0)}%`,A(`benchmarkStampsOut`).value=M(j(`benchmarkStamps`))}function K(){ve(),z.setBrushSettings(_e())}function ye(e){return`${(e/1e3).toFixed(2)} s`}function q(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function be(){return new Promise(e=>requestAnimationFrame(e))}function xe(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function Se(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:q(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function Ce(){let e=navigator,t=z.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,performanceTelemetryRevision:6,...t}}async function we(e){let t=await fetch(ge,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function J(e){if(typeof e!=`object`||!e)return null;let t=e;if(t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0)return null;let n=t;return{...n,settings:{...n.settings,shape:n.settings.shape===`shape`?`shape`:`circle`,shapeScatter:Number.isFinite(n.settings.shapeScatter)?Math.min(1,Math.max(0,n.settings.shapeScatter)):0}}}function Te(){try{let e=window.localStorage.getItem(me);return e?J(JSON.parse(e)):null}catch{return null}}function Ee(){try{window.localStorage.removeItem(me)}catch{}}async function De(){let e=await fetch(he,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return J(await e.json())}async function Oe(e){let t=await fetch(he,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=J(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=J(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function ke(){W=!0,X();try{let e=await De();if(e){B=e,Ee(),L.textContent=Z(e);return}let t=Te();if(t){L.textContent=`Fissaggio del tratto che avevi già registrato…`,B=await Oe(t),Ee(),L.textContent=Z(B);return}L.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){L.textContent=e instanceof Error?e.message:String(e)}finally{W=!1,X()}}function Y(e,t){A(e).value=String(t)}function Ae(e){Y(`brushShape`,e.shape===`shape`?`shape`:`circle`),Y(`shapeScatter`,(e.shapeScatter??0)*100),Y(`brushColor`,e.color),Y(`brushSize`,e.size),Y(`spacing`,e.spacingPercent),Y(`count`,e.count),Y(`flow`,e.flow*100),Y(`hardness`,e.hardness*100),Y(`blendIntensity`,e.blendIntensity),Y(`blendMode`,e.blendMode),Y(`jitterMaster`,e.jitterMaster*100),Y(`hueJitter`,e.hueJitterDegrees),Y(`saturationJitter`,e.saturationJitter*100),Y(`lightnessJitter`,e.lightnessJitter*100),Y(`darknessJitter`,e.darknessJitter*100),A(`jitterPerCopy`).checked=e.jitterPerCopy,Y(`positionJitterLateral`,e.positionJitterLateral*100),Y(`positionJitterLinear`,e.positionJitterLinear*100),Y(`pressureSize`,e.pressureSize*100),Y(`pressureOpacity`,e.pressureOpacity*100),K()}function je(){return Y(`brushShape`,`circle`),Y(`shapeScatter`,0),Y(`brushSize`,750),Y(`spacing`,1),Y(`count`,16),Y(`flow`,100),Y(`hardness`,100),Y(`blendIntensity`,4),Y(`jitterMaster`,100),Y(`hueJitter`,180),Y(`saturationJitter`,100),A(`jitterPerCopy`).checked=!0,Y(`positionJitterLateral`,100),Y(`positionJitterLinear`,100),Y(`pressureSize`,0),Y(`pressureOpacity`,0),K(),_e()}function Me(){return pe.value===`fur`?`fur`:`base`}function Ne(e,t){let n={...e.settings,shape:`circle`,shapeScatter:0,positionJitterLateral:1,positionJitterLinear:1};return t===`fur`?{...n,shape:`shape`,shapeScatter:1,positionJitterLateral:0,positionJitterLinear:0}:n}function Pe(e){return e===`fur`?`Fur`:`Base`}function X(){I.disabled=W||G||U||!!B,I.textContent=H?`Annulla registrazione tratto`:B?`Tratto umano fissato`:`Registra tratto umano`,fe.disabled=!B||W||G||U,pe.disabled=W||G||U||H||!!V}function Z(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${M(e.points.length)} campioni`,`durata ${ye(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}for(let e of[`brushShape`,`shapeScatter`,`brushColor`,`brushSize`,`spacing`,`count`,`flow`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`,`pressureSize`,`pressureOpacity`])A(e).addEventListener(`input`,K),A(e).addEventListener(`change`,K);A(`benchmarkStamps`).addEventListener(`input`,ve),A(`clearLayer`).addEventListener(`click`,()=>z.clear()),A(`fitView`).addEventListener(`click`,()=>z.fitView()),A(`zoomIn`).addEventListener(`click`,()=>z.zoomBy(1.35)),A(`zoomOut`).addEventListener(`click`,()=>z.zoomBy(1/1.35)),R.addEventListener(`change`,async()=>{let e=R.value;R.disabled=!0;try{await z.setLayerFormat(e)}catch{R.value=z.getStats().layerFormat}finally{R.disabled=!1}}),F.addEventListener(`click`,async()=>{F.disabled=!0,de.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await z.runBenchmark(j(`benchmarkStamps`));de.textContent=[`${M(e.baseStamps)} base stamps`,`${M(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){de.textContent=e instanceof Error?e.message:String(e)}finally{F.disabled=!1}}),I.addEventListener(`click`,()=>{W||G||U||V||B||(H=!H,H?(je(),L.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):L.textContent=B?Z(B):`Registrazione annullata.`,X())}),fe.addEventListener(`click`,()=>{ze()});function Fe(e){A(`fpsStat`).textContent=`${e.fps}`,A(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,A(`stampStat`).textContent=M(e.totalBaseStamps),A(`avoidedStat`).textContent=M(e.avoidedLogicalDraws),A(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,A(`gpuStat`).textContent=e.gpuLabel}function Ie(e,t){let n=je(),r=z.toLayerPoint(t);V={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},L.textContent=`Registrazione in corso…`}function Le(e,t){let n=V;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...z.toLayerPoint(t[r]),timeMs:a})}}async function Re(e){let t=V;if(V=null,H=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};G=!0,L.textContent=`Fissaggio permanente del tratto di riferimento…`,X();try{B=await Oe(e),Ee(),L.textContent=Z(B)}catch(e){L.textContent=e instanceof Error?e.message:String(e)}finally{G=!1}}else t&&(L.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);X()}async function ze(){let e=B;if(!e||U)return;let t=Me(),n=Ne(e,t),r=Pe(t);U=!0,F.disabled=!0,X(),Ae(n),L.textContent=`Riproduzione test ${r} in corso…`;try{await z.waitForIdle(),z.resetStrokeRandomSeed(),z.clear(),await z.waitForIdle();let i=z.getStats(),a=performance.now(),o=e.points[e.points.length-1],s=[],c=[],l=1;z.startStrokePerformanceProfile();let u=performance.now();z.beginStrokeAtLayer(e.points[0]),c.push(performance.now()-u),await new Promise(t=>{let n=r=>{let i=r-a,o=[];for(;l<e.points.length&&e.points[l].timeMs<=i;)s.push(Math.max(0,i-e.points[l].timeMs)),o.push(e.points[l]),l+=1;if(o.length>0){let e=performance.now();z.extendStrokeAtLayer(o),c.push(performance.now()-e)}if(l<e.points.length){requestAnimationFrame(n);return}z.endStroke(),t()};requestAnimationFrame(n)});let d=performance.now();await z.waitForIdle();let f=performance.now();await be();let p=performance.now(),m=z.finishStrokePerformanceProfile();if(!m)throw Error(`Profilo del tratto non disponibile.`);let h=z.getStats(),g=Math.max(0,h.totalBaseStamps-i.totalBaseStamps),_=g*n.count,v={inputDeliveryMs:d-a,inputDelayP50Ms:q(s,.5),inputDelayP95Ms:q(s,.95),inputDelayMaxMs:s.length===0?0:Math.max(...s),layerInputDispatchTotalMs:c.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:q(c,.5),layerInputDispatchP95Ms:q(c,.95),layerInputDispatchMaxMs:c.length===0?0:Math.max(...c),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,f-d),endToPresentedMs:Math.max(0,p-a)},y=await we({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:e.capturedAt,traceFingerprint:xe(e.points),pointCount:e.points.length,traceDurationMs:o.timeMs,...Se(e.points),testVariant:t,settings:n},playback:v,performance:m,environment:Ce()});L.textContent=[`Test ${r}`,`Tratto ${ye(o.timeMs)}`,`${M(e.points.length)} campioni`,`${M(g)} stamps base`,`${M(_)} copie fisiche`,`coda GPU ${v.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${m.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${m.submitImmediateP95Ms.toFixed(2)} ms`,`FPS medi ${m.averageRenderFps.toFixed(1)}`,`${M(m.delayedRenderFrames)} frame >20 ms`,`presentazione ${v.endToPresentedMs.toFixed(2)} ms`,y>0?`run #${y} salvata`:`run salvata`].join(` · `)}catch(e){z.finishStrokePerformanceProfile(),L.textContent=e instanceof Error?e.message:String(e)}finally{U=!1,F.disabled=!1,X()}}function Be(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function Ve(e){return{clientX:e.clientX,clientY:e.clientY,pressure:Be(e)}}var Q=null,$=null,He=0,Ue=0;N.addEventListener(`pointerdown`,e=>{if(Q===null)if(e.preventDefault(),Q=e.pointerId,$=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,N.setPointerCapture(e.pointerId),$===`pan`)N.classList.add(`panning`),He=e.clientX,Ue=e.clientY;else{let t=Ve(e);H&&Ie(e,t),z.beginStroke(t)}}),N.addEventListener(`pointermove`,e=>{if(e.pointerId!==Q||$===null)return;if(e.preventDefault(),$===`pan`){z.panByClientDelta(e.clientX-He,e.clientY-Ue),He=e.clientX,Ue=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(Ve);Le(n,r),z.extendStroke(r)});function We(e){e.pointerId===Q&&($===`paint`&&(z.endStroke(),Re(e.type===`pointerup`)),N.classList.remove(`panning`),$=null,Q=null)}N.addEventListener(`pointerup`,We),N.addEventListener(`pointercancel`,We),N.addEventListener(`lostpointercapture`,We),N.addEventListener(`contextmenu`,e=>e.preventDefault()),N.addEventListener(`wheel`,e=>{e.preventDefault();let t=Math.exp(-e.deltaY*.0015);z.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>z.resizeCanvas()).observe(N),ve(),z.setBrushSettings(_e()),X(),ke(),z.initialize().catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;P.textContent=`${e instanceof Error?e.message:String(e)}${t}`,P.className=`status error`,F.disabled=!0}),window.setInterval(()=>Fe(z.getStats()),500);