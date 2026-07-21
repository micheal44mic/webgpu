(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=`
const MAX_COUNT: u32 = 24u;

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

struct TileUniforms {
  origin: vec2<f32>,
  logicalSize: f32,
  storageSize: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pressure: f32,
  @location(2) @interpolate(flat) pointColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(2) var<storage, read> copyReferences: array<u32>;
@group(0) @binding(3) var<uniform> tile: TileUniforms;

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

  let copyReference = copyReferences[instanceIndex];
  let stampIndex = copyReference & 0xffffu;
  let copyIndex = (copyReference >> 16u) & 0x1fu;
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
  let tilePosition = layerPosition - tile.origin;
  let gutter = (tile.storageSize - tile.logicalSize) * 0.5;
  let clipPosition = vec2<f32>(
    (tilePosition.x + gutter) / tile.storageSize * 2.0 - 1.0,
    1.0 - (tilePosition.y + gutter) / tile.storageSize * 2.0
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
`,r=`
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  tileSize: f32,
  tileStorageSize: f32,
  tileGridWidth: f32,
  tileGutter: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var layerTexture: texture_2d_array<f32>;
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

fn sampleLayer(layerPosition: vec2<f32>) -> vec4<f32> {
  let samplePosition = min(layerPosition, display.layerSize - vec2<f32>(1.0));
  let tileCoordinate = min(
    vec2<u32>(floor(samplePosition / display.tileSize)),
    vec2<u32>(u32(display.tileGridWidth) - 1u)
  );
  let tileIndex = tileCoordinate.y * u32(display.tileGridWidth) + tileCoordinate.x;
  let tileOrigin = vec2<f32>(tileCoordinate) * display.tileSize;
  let localPosition = samplePosition - tileOrigin;
  let tileUv = (
    localPosition + vec2<f32>(display.tileGutter + 0.5)
  ) / display.tileStorageSize;
  return textureSampleLevel(layerTexture, layerSampler, tileUv, i32(tileIndex), 0.0);
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

  let paint = sampleLayer(layerPosition);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,i=4096,a=1024,o=1,s=1026,c=i/a,l=i/a,u=c*l,d=16,f=4,p=1024,m=2,h=32,g=65536,_=4,v=`quad`,y=`generic-smoothstep`,b=`reuse-position-copy-seed`,x=`per-copy-tile-bounds`,S=`tiled-2d-array`,C=`cpu-stable-physical-copy-references`,w=96,T=48;function E(e){let t=e>>>0;return t=(t^t>>>16)>>>0,t=Math.imul(t,2146121005)>>>0,t=(t^t>>>15)>>>0,t=Math.imul(t,2221713035)>>>0,t=(t^t>>>16)>>>0,t}function ee(e,t){return(E((e^Math.imul(t,2654435769))>>>0)&16777215)/16777216}function te(e,t){return Math.ceil(e/t)*t}function D(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function O(e){return e.length===0?0:Math.max(...e)}function ne(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}var re={color:`#ff5b35`,size:96,spacingPercent:1,count:24,flow:.07,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1,pressureSize:.65,pressureOpacity:.35},ie=class{layerSize=i;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;layerTileViews=[];brushUniformBuffer;displayUniformBuffer;instanceBuffer;copyReferenceBuffer;tileUniformBuffer;sampler;brushBindGroupLayout;displayBindGroupLayout;brushBindGroup;displayBindGroup;brushShaderModule;displayShaderModule;normalPipeline;additivePipeline;displayPipeline;instanceUpload=new ArrayBuffer(g*h);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);copyReferenceUpload=new Uint32Array(p);copyReferenceCapacity=p;copyTileBounds=new Uint8Array;tileUniformStride=d;brushUniformUpload=new ArrayBuffer(w);displayUniformUpload=new Float32Array(T/4);settings={...re};pendingStamps=[];activeStroke=null;seedSequence=1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=i*.5;viewCenterY=i*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;constructor(e,t={}){this.canvas=e,this.callbacks=t}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<i)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${i}px richiesti.`);if(e.limits.maxTextureArrayLayers<u)throw Error(`La GPU supporta ${e.limits.maxTextureArrayLayers} layer texture, meno dei ${u} tile richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats()}getSettings(){return{...this.settings}}setBrushSettings(e){this.settings={...this.settings,...e,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),flow:t(e.flow??this.settings.flow,.001,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.initialized&&(this.writeBrushUniforms(),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(!this.initialized||e===this.layerFormat)return;this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`),await this.device.queue.onSubmittedWorkDone();let t=this.layerFormat;try{await this.recreateLayerResources(e),this.layerFormat=e,this.clearRequested=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats()}catch(n){await this.recreateLayerResources(t),this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=i*.5,this.viewCenterY=i*.5,this.zoom=Math.max(.01,Math.min(e/i,t/i)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.requestRender()}zoomBy(e,n,r){let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.requestRender()}panByClientDelta(e,t){let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){this.activeStroke={lastInput:e,distanceSinceStamp:0},this.emitStamp(e,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(){this.activeStroke=null}clear(){this.pendingStamps.length=0,this.activeStroke=null,this.clearRequested=!0,this.displayDirty=!0,this.requestRender()}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);let n=t(Math.round(e),1,Math.min(12e3,g));this.pendingStamps.length=0,this.activeStroke=null,this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.generateBenchmarkStamps(n),i=performance.now(),a=this.submitImmediate(r,!0).totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone();let o=performance.now()-i;this.totalBaseStamps+=r.length,this.avoidedLogicalDraws+=r.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(performance.now()),this.publishStats();let s=r.reduce((e,t)=>e+t.radius*t.radius,0)/r.length,c=Math.round(Math.PI*s*r.length*this.settings.count),l=[`draw instanziate soltanto per tile attiva`,`${this.settings.count} copie fisiche GPU per stamp base`,`geometria quad triangle-strip (4 vertici)`,`coverage fragment smoothstep generica`,`riuso copySeed per jitter colore per copia`,`limiti tile conservativi per copia`,`layer 4×4 tile da 1024 px con gutter`,`binning stabile per copia fisica`].join(` · `);return{baseStamps:r.length,logicalCopies:r.length*this.settings.count,cpuSubmitMs:a,gpuCompletionMs:o,estimatedCoveredFragments:c,strategy:l}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.getLayerMemoryMiB(),gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.clearRequested||this.displayDirty;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,activeTileVisits:0,peakActiveTiles:0,physicalCopyTileAssignments:0,tileRenderPasses:0,tileBrushRenderPasses:0,tileClearRenderPasses:0,tileGutterCopies:0,estimatedTileAttachmentPixels:0,stampGenerationMs:0,stampPackingMs:0,tileBinningMs:0,instanceUploadMs:0,copyReferenceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=ne(e.renderIntervalMs);return{stampGeometry:v,stampVerticesPerCopy:_,fragmentCoverageStrategy:y,colorSeedStrategy:b,dirtyRectStrategy:x,layerStorageStrategy:S,tileBinningStrategy:C,tileSizePx:a,tileGridWidth:c,tileGridHeight:l,tileGutterPixels:o,activeTileVisits:e.activeTileVisits,peakActiveTiles:e.peakActiveTiles,physicalCopyTileAssignments:e.physicalCopyTileAssignments,tileRenderPasses:e.tileRenderPasses,tileBrushRenderPasses:e.tileBrushRenderPasses,tileClearRenderPasses:e.tileClearRenderPasses,tileGutterCopies:e.tileGutterCopies,estimatedTileAttachmentPixels:e.estimatedTileAttachmentPixels,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,tileBinningMs:e.tileBinningMs,instanceUploadMs:e.instanceUploadMs,copyReferenceUploadMs:e.copyReferenceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:D(e.cpuFrameMs,.5),submitImmediateP95Ms:D(e.cpuFrameMs,.95),submitImmediateMaxMs:O(e.cpuFrameMs),renderFrameTotalP50Ms:D(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:D(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:O(e.renderFrameTotalMs),renderFrameOverheadP50Ms:D(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:D(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:O(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:D(e.cpuFrameMs,.5),cpuFrameP95Ms:D(e.cpuFrameMs,.95),cpuFrameMaxMs:O(e.cpuFrameMs),renderIntervalP50Ms:D(e.renderIntervalMs,.5),renderIntervalP95Ms:D(e.renderIntervalMs,.95),renderIntervalMaxMs:O(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:i,layerFormat:this.layerFormat,layerMemoryMiB:this.getLayerMemoryMiB(),gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:v,stampVerticesPerCopy:_,fragmentCoverageStrategy:y,colorSeedStrategy:b,dirtyRectStrategy:x,layerStorageStrategy:S,tileBinningStrategy:C,tileSizePx:a,tileGridWidth:c,tileGridHeight:l,tileGutterPixels:o}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:w,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:T,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:g*h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.copyReferenceBuffer=this.device.createBuffer({label:`Tile copy-reference storage`,size:this.copyReferenceCapacity*f,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.tileUniformStride=te(d,this.device.limits.minUniformBufferOffsetAlignment),this.tileUniformBuffer=this.device.createBuffer({label:`Tile draw uniforms`,size:this.tileUniformStride*u,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let e=new ArrayBuffer(this.tileUniformStride*u),t=new Float32Array(e);for(let e=0;e<u;e+=1){let n=e*this.tileUniformStride/4;t[n]=e%c*a,t[n+1]=Math.floor(e/c)*a,t[n+2]=a,t[n+3]=s}this.device.queue.writeBuffer(this.tileUniformBuffer,0,e),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:d}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d-array`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.createBrushBindGroup(),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:n}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:r}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.displayShaderModule,`display`)]);let i=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:i,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer as ${c}×${l} tiled array ${e}`,size:{width:s,height:s,depthOrArrayLayers:u},format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView({label:`Paint tile array view ${e}`,dimension:`2d-array`,baseArrayLayer:0,arrayLayerCount:u}),i=Array.from({length:u},(t,r)=>n.createView({label:`Paint tile ${r} ${e}`,dimension:`2d`,baseArrayLayer:r,arrayLayerCount:1})),a=this.device.createPipelineLayout({label:`Brush pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]});this.device.pushErrorScope(`validation`);let o=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),d=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),f=await this.device.popErrorScope();if(f)throw n.destroy(),Error(f.message);let p=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:r},{binding:2,resource:this.sampler}]});this.layerTexture=n,this.layerView=r,this.layerTileViews=i,this.normalPipeline=o,this.additivePipeline=d,this.displayBindGroup=p,this.layerFormat=e,t?.destroy()}writeBrushUniforms(){let t=new Float32Array(this.brushUniformUpload),n=new Uint32Array(this.brushUniformUpload);t.fill(0);let[r,a,o]=e(this.settings.color),s=this.settings.jitterMaster;t[0]=i,t[1]=i,t[4]=r,t[5]=a,t[6]=o,t[7]=1,t[8]=this.settings.hueJitterDegrees/360*s,t[9]=this.settings.saturationJitter*s,t[10]=this.settings.lightnessJitter*s,t[11]=this.settings.darknessJitter*s,t[12]=this.settings.flow,t[13]=this.settings.hardness,t[14]=this.settings.blendIntensity,t[15]=this.settings.pressureOpacity,t[16]=this.settings.positionJitterLinear,t[17]=this.settings.positionJitterLateral,n[20]=this.settings.count>>>0,n[21]=+!!this.settings.jitterPerCopy,n[22]=+(this.settings.blendMode===`additive`),n[23]=0,this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeDisplayUniforms(){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=i,this.displayUniformUpload[3]=i,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.displayUniformUpload[8]=a,this.displayUniformUpload[9]=s,this.displayUniformUpload[10]=c,this.displayUniformUpload[11]=o,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1)}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;let i=r.lastInput,a=e.x-i.x,o=e.y-i.y,s=Math.hypot(a,o);if(s<=1e-4){r.lastInput=e,this.recordStampGenerationTime(n);return}let c=Math.max(.1,this.settings.size*(this.settings.spacingPercent/100)),l=a/s,u=o/s,d=0,f=r.distanceSinceStamp,p=0;for(;f+(s-d)>=c;){let n=c-f;d+=n;let r=t(d/s,0,1);if(this.emitStamp({x:i.x+a*r,y:i.y+o*r,pressure:i.pressure+(e.pressure-i.pressure)*r},l,u),f=0,p+=1,p>=g)break}f+=Math.max(0,s-d),r.lastInput=e,r.distanceSinceStamp=f,this.recordStampGenerationTime(n)}emitStamp(e,n,r){let a=t(e.pressure,.01,1),o=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,a),s=Math.max(.5,this.settings.size*.5*o),c=s*2*(this.settings.positionJitterLinear+this.settings.positionJitterLateral),l=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0;e.x+s+c<0||e.y+s+c<0||e.x-s-c>=i||e.y-s-c>=i||(this.pendingStamps.push({x:e.x,y:e.y,radius:s,pressure:a,seed:l,directionX:n,directionY:r}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n,i=performance.now(),a=Math.min(this.pendingStamps.length,g),o=a>0?this.pendingStamps.splice(0,a):[],s=performance.now()-i;if(!(this.clearRequested||o.length>0||this.displayDirty)||this.canvas.width<=0||this.canvas.height<=0)return;let c=this.clearRequested,l=performance.now(),u=this.submitImmediate(o,c);this.lastCpuFrameMs=performance.now()-l,this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=o.length,this.avoidedLogicalDraws+=o.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(e);let d=performance.now();this.publishStats();let f=performance.now()-d;(this.pendingStamps.length>0||this.displayDirty||this.clearRequested)&&this.requestRender(),this.recordStrokeFrameTiming(e,o.length,u,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:s,statsPublishMs:f})}submitImmediate(e,t){let n=performance.now(),r=this.device.createCommandEncoder({label:`Brush frame encoder`}),i=0,c=0,l=0,d=0,p=0,m=0,g=0,v=0,y=0,b=0,x=0,S=0,C=0,w={activeTiles:[],assignmentCounts:new Uint32Array(u),assignmentOffsets:new Uint32Array(17),assignmentCount:0};if(t||e.length>0){if(e.length>0){let t=performance.now();this.packStamps(e),i=performance.now()-t;let n=performance.now();w=this.binPhysicalCopies(e.length),c=performance.now()-n;let r=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*h),l=performance.now()-r;let a=performance.now();this.device.queue.writeBuffer(this.copyReferenceBuffer,0,this.copyReferenceUpload.buffer,0,w.assignmentCount*f),d=performance.now()-a}let n=performance.now(),m=e=>{let n=w.assignmentCounts[e],i=r.beginRenderPass({label:`Paint tile ${e}`,colorAttachments:[{view:this.layerTileViews[e],loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});y+=1,t&&(x+=1),n>0&&(b+=1,i.setPipeline(this.settings.blendMode===`additive`?this.additivePipeline:this.normalPipeline),i.setBindGroup(0,this.brushBindGroup,[e*this.tileUniformStride]),i.setViewport(0,0,s,s,0,1),i.setScissorRect(o,o,a,a),i.draw(_,n,0,w.assignmentOffsets[e])),i.end()};if(t)for(let e=0;e<u;e+=1)m(e);else for(let e of w.activeTiles)m(e);w.activeTiles.length>0&&(S=this.encodeTileGutterCopies(r,w.activeTiles)),v=b*a*a,C=y*s*s,p=performance.now()-n}let T=performance.now();this.writeDisplayUniforms();let E=r.beginRenderPass({label:`Present paint layer`,colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});E.setPipeline(this.displayPipeline),E.setBindGroup(0,this.displayBindGroup),E.draw(3,1,0,0),E.end(),m=performance.now()-T;let ee=performance.now();return this.device.queue.submit([r.finish()]),g=performance.now()-ee,{totalCpuMs:performance.now()-n,stampPackingMs:i,tileBinningMs:c,instanceUploadMs:l,copyReferenceUploadMs:d,brushEncodingMs:p,displayEncodingMs:m,commandSubmitMs:g,scissorPixels:v,activeTiles:w.activeTiles.length,physicalCopyTileAssignments:w.assignmentCount,tileRenderPasses:y,tileBrushRenderPasses:b,tileClearRenderPasses:x,tileGutterCopies:S,tileAttachmentPixels:C}}packStamps(e){for(let t=0;t<e.length;t+=1){let n=e[t],r=h/4*t;this.instanceUploadF32[r]=n.x,this.instanceUploadF32[r+1]=n.y,this.instanceUploadF32[r+2]=n.radius,this.instanceUploadF32[r+3]=n.pressure,this.instanceUploadU32[r+4]=n.seed,this.instanceUploadU32[r+5]=0,this.instanceUploadF32[r+6]=n.directionX,this.instanceUploadF32[r+7]=n.directionY}}binPhysicalCopies(e){let n=this.settings.count,r=e*n,o=new Uint32Array(u),s=new Uint32Array(17);this.ensureCopyTileBoundsCapacity(r);for(let r=0;r<e;r+=1){let e=h/4*r,s=this.instanceUploadF32[e],u=this.instanceUploadF32[e+1],d=this.instanceUploadF32[e+2],f=this.instanceUploadU32[e+4],p=this.instanceUploadF32[e+6],g=this.instanceUploadF32[e+7],_=Math.hypot(p,g),v=_<5e-5||_>2e-4,y=_>2e-4?p/_:1,b=_>2e-4?g/_:0;for(let e=0;e<n;e+=1){let p=(r*n+e)*4,h,g,_,x;if(v){let t=E((f^Math.imul(e,2246822507))>>>0),n=(ee(t,5)-.5)*4*d*this.settings.positionJitterLinear,r=(ee(t,6)-.5)*4*d*this.settings.positionJitterLateral,i=s+y*n-b*r,a=u+b*n+y*r;h=i-d-m,g=a-d-m,_=i+d+m,x=a+d+m}else{let e=d*2*this.settings.positionJitterLinear,t=d*2*this.settings.positionJitterLateral,n=d+e+t+m;h=s-n,g=u-n,_=s+n,x=u+n}if(_<0||x<0||h>=i||g>=i){this.copyTileBounds[p]=255;continue}let S=t(Math.floor(h/a),0,c-1),C=t(Math.floor(g/a),0,l-1),w=t(Math.floor(_/a),0,c-1),T=t(Math.floor(x/a),0,l-1);this.copyTileBounds[p]=S,this.copyTileBounds[p+1]=C,this.copyTileBounds[p+2]=w,this.copyTileBounds[p+3]=T;for(let e=C;e<=T;e+=1){let t=e*c;for(let e=S;e<=w;e+=1)o[t+e]+=1}}}let d=0,f=[];for(let e=0;e<u;e+=1)s[e]=d,d+=o[e],o[e]>0&&f.push(e);s[u]=d,this.ensureCopyReferenceCapacity(d);let p=s.slice(0,u);for(let t=0;t<e;t+=1)for(let e=0;e<n;e+=1){let r=(t*n+e)*4;if(this.copyTileBounds[r]===255)continue;let i=this.copyTileBounds[r],a=this.copyTileBounds[r+1],o=this.copyTileBounds[r+2],s=this.copyTileBounds[r+3],l=(t|e<<16)>>>0;for(let e=a;e<=s;e+=1){let t=e*c;for(let e=i;e<=o;e+=1){let n=t+e;this.copyReferenceUpload[p[n]]=l,p[n]+=1}}}return{activeTiles:f,assignmentCounts:o,assignmentOffsets:s,assignmentCount:d}}ensureCopyTileBoundsCapacity(e){let t=e*4;if(this.copyTileBounds.length>=t)return;let n=Math.max(4096,this.copyTileBounds.length||0);for(;n<t;)n*=2;this.copyTileBounds=new Uint8Array(n)}ensureCopyReferenceCapacity(e){if(e<=this.copyReferenceCapacity)return;let t=this.copyReferenceCapacity;for(;t<e;)t*=2;let n=t*f,r=Number(this.device.limits.maxStorageBufferBindingSize);if(n>r)throw Error(`Il binning richiede ${n} byte di riferimenti, oltre il limite GPU di ${r}.`);let i=this.copyReferenceBuffer;this.copyReferenceBuffer=this.device.createBuffer({label:`Tile copy-reference storage`,size:n,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.copyReferenceCapacity=t,this.copyReferenceUpload=new Uint32Array(t),this.createBrushBindGroup(),i.destroy()}createBrushBindGroup(){this.brushBindGroup=this.device.createBindGroup({label:`Brush tiled bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:{buffer:this.copyReferenceBuffer}},{binding:3,resource:{buffer:this.tileUniformBuffer,offset:0,size:d}}]})}encodeTileGutterCopies(e,t){let n=0;for(let r of t){let t=r%c,i=Math.floor(r/c);t>0&&(this.copyTileRegion(e,r,1,1,r-1,s-1,1,1,a),n+=1),t+1<c&&(this.copyTileRegion(e,r,a,1,r+1,0,1,1,a),n+=1),i>0&&(this.copyTileRegion(e,r,1,1,r-c,1,s-1,a,1),n+=1),i+1<l&&(this.copyTileRegion(e,r,1,a,r+c,1,0,a,1),n+=1),t>0&&i>0&&(this.copyTileRegion(e,r,1,1,r-c-1,s-1,s-1,1,1),n+=1),t+1<c&&i>0&&(this.copyTileRegion(e,r,a,1,r-c+1,0,s-1,1,1),n+=1),t>0&&i+1<l&&(this.copyTileRegion(e,r,1,a,r+c-1,s-1,0,1,1),n+=1),t+1<c&&i+1<l&&(this.copyTileRegion(e,r,a,a,r+c+1,0,0,1,1),n+=1)}return n}copyTileRegion(e,t,n,r,i,a,o,s,c){e.copyTextureToTexture({texture:this.layerTexture,origin:{x:n,y:r,z:t}},{texture:this.layerTexture,origin:{x:a,y:o,z:i}},{width:s,height:c,depthOrArrayLayers:1})}getLayerMemoryMiB(){let e=this.layerFormat===`rgba16float`?8:4;return s*s*u*e/(1024*1024)}generateBenchmarkStamps(e){let n=Array(e),r=i*.5,a=i*.39;for(let i=0;i<e;i+=1){let o=e<=1?0:i/(e-1),s=o*Math.PI*18,c=a*(.12+o*.88),l=t(.58+Math.sin(o*Math.PI*15)*.28,.1,1),u=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,l),d=Math.max(.5,this.settings.size*.5*u);n[i]={x:r+Math.cos(s)*c,y:r+Math.sin(s*1.037)*c,radius:d,pressure:l,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(s),directionY:Math.cos(s*1.037)}}return n}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r){let i=this.activeStrokeProfile;i&&(i.previousFrameTimestamp!==null&&i.renderIntervalMs.push(Math.max(0,e-i.previousFrameTimestamp)),i.previousFrameTimestamp=e,i.renderFrames+=1,i.cpuFrameMs.push(this.lastCpuFrameMs),i.renderFrameTotalMs.push(r.totalCpuMs),i.renderFrameOverheadMs.push(Math.max(0,r.totalCpuMs-n.totalCpuMs)),i.resizeCanvasMs+=r.resizeCanvasMs,i.batchExtractionMs+=r.batchExtractionMs,i.statsPublishMs+=r.statsPublishMs,i.stampPackingMs+=n.stampPackingMs,i.tileBinningMs+=n.tileBinningMs,i.instanceUploadMs+=n.instanceUploadMs,i.copyReferenceUploadMs+=n.copyReferenceUploadMs,i.brushEncodingMs+=n.brushEncodingMs,i.displayEncodingMs+=n.displayEncodingMs,i.commandSubmitMs+=n.commandSubmitMs,i.estimatedScissorPixels+=n.scissorPixels,i.activeTileVisits+=n.activeTiles,i.peakActiveTiles=Math.max(i.peakActiveTiles,n.activeTiles),i.physicalCopyTileAssignments+=n.physicalCopyTileAssignments,i.tileRenderPasses+=n.tileRenderPasses,i.tileBrushRenderPasses+=n.tileBrushRenderPasses,i.tileClearRenderPasses+=n.tileClearRenderPasses,i.tileGutterCopies+=n.tileGutterCopies,i.estimatedTileAttachmentPixels+=n.tileAttachmentPixels,t>0&&(i.brushBatches+=1,i.physicalCopies+=t*this.settings.count,i.largestBatchStamps=Math.max(i.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function k(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function A(e){return Number(k(e).value)}function j(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var M=k(`gpuCanvas`),N=k(`status`),P=k(`runBenchmark`),F=k(`benchmarkResult`),ae=k(`recordHumanStroke`),oe=k(`playHumanStroke`),I=k(`humanStrokeResult`),L=k(`layerFormat`),se=`webgpu-brush-engine.human-stroke.v1`,ce=`/api/human-stroke`,le=`/api/benchmark-runs`,R=new ie(M,{onStatus(e,t){N.textContent=e,N.className=`status ${t===`working`?``:t}`},onStats(e){Te(e)}}),z=null,B=null,V=!1,H=!1,U=!0,W=!1;function ue(){return{color:k(`brushColor`).value,size:A(`brushSize`),spacingPercent:A(`spacing`),count:A(`count`),flow:A(`flow`)/100,hardness:A(`hardness`)/100,blendIntensity:A(`blendIntensity`),blendMode:k(`blendMode`).value,jitterMaster:A(`jitterMaster`)/100,hueJitterDegrees:A(`hueJitter`),saturationJitter:A(`saturationJitter`)/100,lightnessJitter:A(`lightnessJitter`)/100,darknessJitter:A(`darknessJitter`)/100,jitterPerCopy:k(`jitterPerCopy`).checked,positionJitterLateral:A(`positionJitterLateral`)/100,positionJitterLinear:A(`positionJitterLinear`)/100,pressureSize:A(`pressureSize`)/100,pressureOpacity:A(`pressureOpacity`)/100}}function de(){k(`brushSizeOut`).value=`${A(`brushSize`).toFixed(0)} px`,k(`spacingOut`).value=`${A(`spacing`).toFixed(2)}%`,k(`countOut`).value=A(`count`).toFixed(0),k(`flowOut`).value=`${A(`flow`).toFixed(1).replace(`.0`,``)}%`,k(`hardnessOut`).value=`${A(`hardness`).toFixed(0)}%`,k(`blendIntensityOut`).value=`${A(`blendIntensity`).toFixed(2)}×`,k(`jitterMasterOut`).value=`${A(`jitterMaster`).toFixed(0)}%`,k(`hueJitterOut`).value=`${A(`hueJitter`).toFixed(0)}°`,k(`saturationJitterOut`).value=`${A(`saturationJitter`).toFixed(0)}%`,k(`lightnessJitterOut`).value=`${A(`lightnessJitter`).toFixed(0)}%`,k(`darknessJitterOut`).value=`${A(`darknessJitter`).toFixed(0)}%`,k(`positionJitterLateralOut`).value=`${A(`positionJitterLateral`).toFixed(0)}%`,k(`positionJitterLinearOut`).value=`${A(`positionJitterLinear`).toFixed(0)}%`,k(`pressureSizeOut`).value=`${A(`pressureSize`).toFixed(0)}%`,k(`pressureOpacityOut`).value=`${A(`pressureOpacity`).toFixed(0)}%`,k(`benchmarkStampsOut`).value=j(A(`benchmarkStamps`))}function G(){de(),R.setBrushSettings(ue())}function fe(e){return`${(e/1e3).toFixed(2)} s`}function K(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function pe(){return new Promise(e=>requestAnimationFrame(e))}function me(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function he(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:K(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function ge(){let e=navigator,t=R.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,performanceTelemetryRevision:3,...t}}async function _e(e){let t=await fetch(le,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function q(e){if(typeof e!=`object`||!e)return null;let t=e;return t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0?null:t}function ve(){try{let e=window.localStorage.getItem(se);return e?q(JSON.parse(e)):null}catch{return null}}function ye(){try{window.localStorage.removeItem(se)}catch{}}async function be(){let e=await fetch(ce,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return q(await e.json())}async function xe(e){let t=await fetch(ce,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=q(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=q(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function Se(){U=!0,Y();try{let e=await be();if(e){z=e,ye(),I.textContent=X(e);return}let t=ve();if(t){I.textContent=`Fissaggio del tratto che avevi già registrato…`,z=await xe(t),ye(),I.textContent=X(z);return}I.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){I.textContent=e instanceof Error?e.message:String(e)}finally{U=!1,Y()}}function J(e,t){k(e).value=String(t)}function Ce(e){J(`brushColor`,e.color),J(`brushSize`,e.size),J(`spacing`,e.spacingPercent),J(`count`,e.count),J(`flow`,e.flow*100),J(`hardness`,e.hardness*100),J(`blendIntensity`,e.blendIntensity),J(`blendMode`,e.blendMode),J(`jitterMaster`,e.jitterMaster*100),J(`hueJitter`,e.hueJitterDegrees),J(`saturationJitter`,e.saturationJitter*100),J(`lightnessJitter`,e.lightnessJitter*100),J(`darknessJitter`,e.darknessJitter*100),k(`jitterPerCopy`).checked=e.jitterPerCopy,J(`positionJitterLateral`,e.positionJitterLateral*100),J(`positionJitterLinear`,e.positionJitterLinear*100),J(`pressureSize`,e.pressureSize*100),J(`pressureOpacity`,e.pressureOpacity*100),G()}function we(){return J(`brushSize`,750),J(`spacing`,1),J(`count`,16),J(`flow`,100),J(`hardness`,100),J(`blendIntensity`,4),J(`jitterMaster`,100),J(`hueJitter`,180),J(`saturationJitter`,100),k(`jitterPerCopy`).checked=!0,J(`positionJitterLateral`,100),J(`positionJitterLinear`,100),J(`pressureSize`,0),J(`pressureOpacity`,0),G(),ue()}function Y(){ae.disabled=U||W||H||!!z,ae.textContent=V?`Annulla registrazione tratto`:z?`Tratto umano fissato`:`Registra tratto umano`,oe.disabled=!z||U||W||H}function X(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${j(e.points.length)} campioni`,`durata ${fe(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}for(let e of[`brushColor`,`brushSize`,`spacing`,`count`,`flow`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`,`pressureSize`,`pressureOpacity`])k(e).addEventListener(`input`,G),k(e).addEventListener(`change`,G);k(`benchmarkStamps`).addEventListener(`input`,de),k(`clearLayer`).addEventListener(`click`,()=>R.clear()),k(`fitView`).addEventListener(`click`,()=>R.fitView()),k(`zoomIn`).addEventListener(`click`,()=>R.zoomBy(1.35)),k(`zoomOut`).addEventListener(`click`,()=>R.zoomBy(1/1.35)),L.addEventListener(`change`,async()=>{let e=L.value;L.disabled=!0;try{await R.setLayerFormat(e)}catch{L.value=R.getStats().layerFormat}finally{L.disabled=!1}}),P.addEventListener(`click`,async()=>{P.disabled=!0,F.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await R.runBenchmark(A(`benchmarkStamps`));F.textContent=[`${j(e.baseStamps)} base stamps`,`${j(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){F.textContent=e instanceof Error?e.message:String(e)}finally{P.disabled=!1}}),ae.addEventListener(`click`,()=>{U||W||H||B||z||(V=!V,V?(we(),I.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):I.textContent=z?X(z):`Registrazione annullata.`,Y())}),oe.addEventListener(`click`,()=>{ke()});function Te(e){k(`fpsStat`).textContent=`${e.fps}`,k(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,k(`stampStat`).textContent=j(e.totalBaseStamps),k(`avoidedStat`).textContent=j(e.avoidedLogicalDraws),k(`memoryStat`).textContent=`${e.layerMemoryMiB.toFixed(1)} MiB`,k(`gpuStat`).textContent=e.gpuLabel}function Ee(e,t){let n=we(),r=R.toLayerPoint(t);B={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},I.textContent=`Registrazione in corso…`}function De(e,t){let n=B;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...R.toLayerPoint(t[r]),timeMs:a})}}async function Oe(e){let t=B;if(B=null,V=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};W=!0,I.textContent=`Fissaggio permanente del tratto di riferimento…`,Y();try{z=await xe(e),ye(),I.textContent=X(z)}catch(e){I.textContent=e instanceof Error?e.message:String(e)}finally{W=!1}}else t&&(I.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);Y()}async function ke(){let e=z;if(!(!e||H)){H=!0,P.disabled=!0,Y(),Ce(e.settings),I.textContent=`Riproduzione del tratto umano in corso…`;try{await R.waitForIdle(),R.resetStrokeRandomSeed(),R.clear(),await R.waitForIdle();let t=R.getStats(),n=performance.now(),r=e.points[e.points.length-1],i=[],a=[],o=1;R.startStrokePerformanceProfile();let s=performance.now();R.beginStrokeAtLayer(e.points[0]),a.push(performance.now()-s),await new Promise(t=>{let r=s=>{let c=s-n,l=[];for(;o<e.points.length&&e.points[o].timeMs<=c;)i.push(Math.max(0,c-e.points[o].timeMs)),l.push(e.points[o]),o+=1;if(l.length>0){let e=performance.now();R.extendStrokeAtLayer(l),a.push(performance.now()-e)}if(o<e.points.length){requestAnimationFrame(r);return}R.endStroke(),t()};requestAnimationFrame(r)});let c=performance.now();await R.waitForIdle();let l=performance.now();await pe();let u=performance.now(),d=R.finishStrokePerformanceProfile();if(!d)throw Error(`Profilo del tratto non disponibile.`);let f=R.getStats(),p=Math.max(0,f.totalBaseStamps-t.totalBaseStamps),m=p*e.settings.count,h={inputDeliveryMs:c-n,inputDelayP50Ms:K(i,.5),inputDelayP95Ms:K(i,.95),inputDelayMaxMs:i.length===0?0:Math.max(...i),layerInputDispatchTotalMs:a.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:K(a,.5),layerInputDispatchP95Ms:K(a,.95),layerInputDispatchMaxMs:a.length===0?0:Math.max(...a),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,l-c),endToPresentedMs:Math.max(0,u-n)},g=await _e({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:e.capturedAt,traceFingerprint:me(e.points),pointCount:e.points.length,traceDurationMs:r.timeMs,...he(e.points),settings:e.settings},playback:h,performance:d,environment:ge()});I.textContent=[`Tratto ${fe(r.timeMs)}`,`${j(e.points.length)} campioni`,`${j(p)} stamps base`,`${j(m)} copie fisiche`,`coda GPU ${h.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${d.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${d.submitImmediateP95Ms.toFixed(2)} ms`,`FPS medi ${d.averageRenderFps.toFixed(1)}`,`${j(d.delayedRenderFrames)} frame >20 ms`,`tile attive max ${d.peakActiveTiles}/${d.tileGridWidth*d.tileGridHeight}`,`${j(d.physicalCopyTileAssignments)} assegnazioni tile`,`${j(d.tileBrushRenderPasses)} pass tile`,`presentazione ${h.endToPresentedMs.toFixed(2)} ms`,g>0?`run #${g} salvata`:`run salvata`].join(` · `)}catch(e){R.finishStrokePerformanceProfile(),I.textContent=e instanceof Error?e.message:String(e)}finally{H=!1,P.disabled=!1,Y()}}}function Ae(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function je(e){return{clientX:e.clientX,clientY:e.clientY,pressure:Ae(e)}}var Z=null,Q=null,Me=0,Ne=0;M.addEventListener(`pointerdown`,e=>{if(Z===null)if(e.preventDefault(),Z=e.pointerId,Q=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,M.setPointerCapture(e.pointerId),Q===`pan`)M.classList.add(`panning`),Me=e.clientX,Ne=e.clientY;else{let t=je(e);V&&Ee(e,t),R.beginStroke(t)}}),M.addEventListener(`pointermove`,e=>{if(e.pointerId!==Z||Q===null)return;if(e.preventDefault(),Q===`pan`){R.panByClientDelta(e.clientX-Me,e.clientY-Ne),Me=e.clientX,Ne=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(je);De(n,r),R.extendStroke(r)});function $(e){e.pointerId===Z&&(Q===`paint`&&(R.endStroke(),Oe(e.type===`pointerup`)),M.classList.remove(`panning`),Q=null,Z=null)}M.addEventListener(`pointerup`,$),M.addEventListener(`pointercancel`,$),M.addEventListener(`lostpointercapture`,$),M.addEventListener(`contextmenu`,e=>e.preventDefault()),M.addEventListener(`wheel`,e=>{e.preventDefault();let t=Math.exp(-e.deltaY*.0015);R.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>R.resizeCanvas()).observe(M),de(),R.setBrushSettings(ue()),Y(),Se(),R.initialize().catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;N.textContent=`${e instanceof Error?e.message:String(e)}${t}`,N.className=`status error`,P.disabled=!0}),window.setInterval(()=>Te(R.getStats()),500);