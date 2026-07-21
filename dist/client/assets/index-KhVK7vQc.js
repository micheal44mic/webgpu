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

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pressure: f32,
  @location(2) @interpolate(flat) pointColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;

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
`,i=4096,a=32,o=65536,s=4,c=`quad`,l=`generic-smoothstep`,u=`reuse-position-copy-seed`,d=96,f=32;function p(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function m(e){return e.length===0?0:Math.max(...e)}function h(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}var g={color:`#ff5b35`,size:96,spacingPercent:1,count:24,flow:.07,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1,pressureSize:.65,pressureOpacity:.35},ee=class{layerSize=i;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;brushUniformBuffer;displayUniformBuffer;instanceBuffer;sampler;brushBindGroupLayout;displayBindGroupLayout;brushBindGroup;displayBindGroup;brushShaderModule;displayShaderModule;normalPipeline;additivePipeline;displayPipeline;instanceUpload=new ArrayBuffer(o*a);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);brushUniformUpload=new ArrayBuffer(d);displayUniformUpload=new Float32Array(f/4);settings={...g};pendingStamps=[];activeStroke=null;seedSequence=1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=i*.5;viewCenterY=i*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;constructor(e,t={}){this.canvas=e,this.callbacks=t}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<i)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${i}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats()}getSettings(){return{...this.settings}}setBrushSettings(e){this.settings={...this.settings,...e,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),flow:t(e.flow??this.settings.flow,.001,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.initialized&&(this.writeBrushUniforms(),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(!this.initialized||e===this.layerFormat)return;this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`),await this.device.queue.onSubmittedWorkDone();let t=this.layerFormat;try{await this.recreateLayerResources(e),this.layerFormat=e,this.clearRequested=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats()}catch(n){await this.recreateLayerResources(t),this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=i*.5,this.viewCenterY=i*.5,this.zoom=Math.max(.01,Math.min(e/i,t/i)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.requestRender()}zoomBy(e,n,r){let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.requestRender()}panByClientDelta(e,t){let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){this.activeStroke={lastInput:e,distanceSinceStamp:0},this.emitStamp(e,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(){this.activeStroke=null}clear(){this.pendingStamps.length=0,this.activeStroke=null,this.clearRequested=!0,this.displayDirty=!0,this.requestRender()}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);let n=t(Math.round(e),1,Math.min(12e3,o));this.pendingStamps.length=0,this.activeStroke=null,this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.generateBenchmarkStamps(n),i=performance.now(),a=this.submitImmediate(r,!0).totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone();let s=performance.now()-i;this.totalBaseStamps+=r.length,this.avoidedLogicalDraws+=r.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(performance.now()),this.publishStats();let c=r.reduce((e,t)=>e+t.radius*t.radius,0)/r.length,l=Math.round(Math.PI*c*r.length*this.settings.count),u=[`1 draw instanziata`,`${this.settings.count} copie fisiche GPU per stamp base`,`geometria quad triangle-strip (4 vertici)`,`coverage fragment smoothstep generica`,`riuso copySeed per jitter colore per copia`].join(` · `);return{baseStamps:r.length,logicalCopies:r.length*this.settings.count,cpuSubmitMs:a,gpuCompletionMs:s,estimatedCoveredFragments:l,strategy:u}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.clearRequested||this.displayDirty;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=h(e.renderIntervalMs);return{stampGeometry:c,stampVerticesPerCopy:s,fragmentCoverageStrategy:l,colorSeedStrategy:u,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:p(e.cpuFrameMs,.5),submitImmediateP95Ms:p(e.cpuFrameMs,.95),submitImmediateMaxMs:m(e.cpuFrameMs),renderFrameTotalP50Ms:p(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:p(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:m(e.renderFrameTotalMs),renderFrameOverheadP50Ms:p(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:p(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:m(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:p(e.cpuFrameMs,.5),cpuFrameP95Ms:p(e.cpuFrameMs,.95),cpuFrameMaxMs:m(e.cpuFrameMs),renderIntervalP50Ms:p(e.renderIntervalMs,.5),renderIntervalP95Ms:p(e.renderIntervalMs,.95),renderIntervalMaxMs:m(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:i,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:c,stampVerticesPerCopy:s,fragmentCoverageStrategy:l,colorSeedStrategy:u}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:d,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:f,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:o*a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}}]}),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:n}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:r}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.displayShaderModule,`display`)]);let e=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:e,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:i,height:i,depthOrArrayLayers:1},format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView(),a=this.device.createPipelineLayout({label:`Brush pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]});this.device.pushErrorScope(`validation`);let o=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),s=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),c=await this.device.popErrorScope();if(c)throw n.destroy(),Error(c.message);let l=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:r},{binding:2,resource:this.sampler}]});this.layerTexture=n,this.layerView=r,this.normalPipeline=o,this.additivePipeline=s,this.displayBindGroup=l,this.layerFormat=e,t?.destroy()}writeBrushUniforms(){let t=new Float32Array(this.brushUniformUpload),n=new Uint32Array(this.brushUniformUpload);t.fill(0);let[r,a,o]=e(this.settings.color),s=this.settings.jitterMaster;t[0]=i,t[1]=i,t[4]=r,t[5]=a,t[6]=o,t[7]=1,t[8]=this.settings.hueJitterDegrees/360*s,t[9]=this.settings.saturationJitter*s,t[10]=this.settings.lightnessJitter*s,t[11]=this.settings.darknessJitter*s,t[12]=this.settings.flow,t[13]=this.settings.hardness,t[14]=this.settings.blendIntensity,t[15]=this.settings.pressureOpacity,t[16]=this.settings.positionJitterLinear,t[17]=this.settings.positionJitterLateral,n[20]=this.settings.count>>>0,n[21]=+!!this.settings.jitterPerCopy,n[22]=+(this.settings.blendMode===`additive`),n[23]=0,this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeDisplayUniforms(){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=i,this.displayUniformUpload[3]=i,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1)}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;let i=r.lastInput,a=e.x-i.x,s=e.y-i.y,c=Math.hypot(a,s);if(c<=1e-4){r.lastInput=e,this.recordStampGenerationTime(n);return}let l=Math.max(.1,this.settings.size*(this.settings.spacingPercent/100)),u=a/c,d=s/c,f=0,p=r.distanceSinceStamp,m=0;for(;p+(c-f)>=l;){let n=l-p;f+=n;let r=t(f/c,0,1);if(this.emitStamp({x:i.x+a*r,y:i.y+s*r,pressure:i.pressure+(e.pressure-i.pressure)*r},u,d),p=0,m+=1,m>=o)break}p+=Math.max(0,c-f),r.lastInput=e,r.distanceSinceStamp=p,this.recordStampGenerationTime(n)}emitStamp(e,n,r){let a=t(e.pressure,.01,1),o=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,a),s=Math.max(.5,this.settings.size*.5*o),c=s*2*(this.settings.positionJitterLinear+this.settings.positionJitterLateral),l=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0;e.x+s+c<0||e.y+s+c<0||e.x-s-c>=i||e.y-s-c>=i||(this.pendingStamps.push({x:e.x,y:e.y,radius:s,pressure:a,seed:l,directionX:n,directionY:r}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n,i=performance.now(),a=Math.min(this.pendingStamps.length,o),s=a>0?this.pendingStamps.splice(0,a):[],c=performance.now()-i;if(!(this.clearRequested||s.length>0||this.displayDirty)||this.canvas.width<=0||this.canvas.height<=0)return;let l=this.clearRequested,u=performance.now(),d=this.submitImmediate(s,l);this.lastCpuFrameMs=performance.now()-u,this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=s.length,this.avoidedLogicalDraws+=s.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(e);let f=performance.now();this.publishStats();let p=performance.now()-f;(this.pendingStamps.length>0||this.displayDirty||this.clearRequested)&&this.requestRender(),this.recordStrokeFrameTiming(e,s.length,d,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:c,statsPublishMs:p})}submitImmediate(e,t){let n=performance.now(),r=this.device.createCommandEncoder({label:`Brush frame encoder`}),i=0,o=0,c=0,l=0,u=0,d=0;if(t||e.length>0){let n=null;if(e.length>0){let t=performance.now();n=this.packStamps(e),i=performance.now()-t;let r=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*a),o=performance.now()-r}let l=performance.now(),u=r.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});e.length>0&&n&&(d=n.width*n.height,u.setPipeline(this.settings.blendMode===`additive`?this.additivePipeline:this.normalPipeline),u.setBindGroup(0,this.brushBindGroup),u.setScissorRect(n.x,n.y,n.width,n.height),u.draw(s,e.length*this.settings.count,0,0)),u.end(),c=performance.now()-l}let f=performance.now();this.writeDisplayUniforms();let p=r.beginRenderPass({label:`Present paint layer`,colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});p.setPipeline(this.displayPipeline),p.setBindGroup(0,this.displayBindGroup),p.draw(3,1,0,0),p.end(),l=performance.now()-f;let m=performance.now();return this.device.queue.submit([r.finish()]),u=performance.now()-m,{totalCpuMs:performance.now()-n,stampPackingMs:i,instanceUploadMs:o,brushEncodingMs:c,displayEncodingMs:l,commandSubmitMs:u,scissorPixels:d}}packStamps(e){let n=i,r=i,o=0,s=0;for(let t=0;t<e.length;t+=1){let i=e[t],c=a/4*t;this.instanceUploadF32[c]=i.x,this.instanceUploadF32[c+1]=i.y,this.instanceUploadF32[c+2]=i.radius,this.instanceUploadF32[c+3]=i.pressure,this.instanceUploadU32[c+4]=i.seed,this.instanceUploadU32[c+5]=0,this.instanceUploadF32[c+6]=i.directionX,this.instanceUploadF32[c+7]=i.directionY;let l=i.radius*2*(this.settings.positionJitterLinear+this.settings.positionJitterLateral);n=Math.min(n,i.x-i.radius-l-2),r=Math.min(r,i.y-i.radius-l-2),o=Math.max(o,i.x+i.radius+l+2),s=Math.max(s,i.y+i.radius+l+2)}let c=t(Math.floor(n),0,i-1),l=t(Math.floor(r),0,i-1),u=t(Math.ceil(o),1,i),d=t(Math.ceil(s),1,i),f=Math.max(0,u-c),p=Math.max(0,d-l);return f>0&&p>0?{x:c,y:l,width:f,height:p}:null}generateBenchmarkStamps(e){let n=Array(e),r=i*.5,a=i*.39;for(let i=0;i<e;i+=1){let o=e<=1?0:i/(e-1),s=o*Math.PI*18,c=a*(.12+o*.88),l=t(.58+Math.sin(o*Math.PI*15)*.28,.1,1),u=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,l),d=Math.max(.5,this.settings.size*.5*u);n[i]={x:r+Math.cos(s)*c,y:r+Math.sin(s*1.037)*c,radius:d,pressure:l,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(s),directionY:Math.cos(s*1.037)}}return n}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r){let i=this.activeStrokeProfile;i&&(i.previousFrameTimestamp!==null&&i.renderIntervalMs.push(Math.max(0,e-i.previousFrameTimestamp)),i.previousFrameTimestamp=e,i.renderFrames+=1,i.cpuFrameMs.push(this.lastCpuFrameMs),i.renderFrameTotalMs.push(r.totalCpuMs),i.renderFrameOverheadMs.push(Math.max(0,r.totalCpuMs-n.totalCpuMs)),i.resizeCanvasMs+=r.resizeCanvasMs,i.batchExtractionMs+=r.batchExtractionMs,i.statsPublishMs+=r.statsPublishMs,i.stampPackingMs+=n.stampPackingMs,i.instanceUploadMs+=n.instanceUploadMs,i.brushEncodingMs+=n.brushEncodingMs,i.displayEncodingMs+=n.displayEncodingMs,i.commandSubmitMs+=n.commandSubmitMs,i.estimatedScissorPixels+=n.scissorPixels,t>0&&(i.brushBatches+=1,i.physicalCopies+=t*this.settings.count,i.largestBatchStamps=Math.max(i.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function _(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function v(e){return Number(_(e).value)}function y(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var b=_(`gpuCanvas`),x=_(`status`),S=_(`runBenchmark`),C=_(`benchmarkResult`),w=_(`recordHumanStroke`),T=_(`playHumanStroke`),E=_(`humanStrokeResult`),D=_(`layerFormat`),O=`webgpu-brush-engine.human-stroke.v1`,k=`/api/human-stroke`,te=`/api/benchmark-runs`,A=new ee(b,{onStatus(e,t){x.textContent=e,x.className=`status ${t===`working`?``:t}`},onStats(e){J(e)}}),j=null,M=null,N=!1,P=!1,F=!0,I=!1;function L(){return{color:_(`brushColor`).value,size:v(`brushSize`),spacingPercent:v(`spacing`),count:v(`count`),flow:v(`flow`)/100,hardness:v(`hardness`)/100,blendIntensity:v(`blendIntensity`),blendMode:_(`blendMode`).value,jitterMaster:v(`jitterMaster`)/100,hueJitterDegrees:v(`hueJitter`),saturationJitter:v(`saturationJitter`)/100,lightnessJitter:v(`lightnessJitter`)/100,darknessJitter:v(`darknessJitter`)/100,jitterPerCopy:_(`jitterPerCopy`).checked,positionJitterLateral:v(`positionJitterLateral`)/100,positionJitterLinear:v(`positionJitterLinear`)/100,pressureSize:v(`pressureSize`)/100,pressureOpacity:v(`pressureOpacity`)/100}}function R(){_(`brushSizeOut`).value=`${v(`brushSize`).toFixed(0)} px`,_(`spacingOut`).value=`${v(`spacing`).toFixed(2)}%`,_(`countOut`).value=v(`count`).toFixed(0),_(`flowOut`).value=`${v(`flow`).toFixed(1).replace(`.0`,``)}%`,_(`hardnessOut`).value=`${v(`hardness`).toFixed(0)}%`,_(`blendIntensityOut`).value=`${v(`blendIntensity`).toFixed(2)}×`,_(`jitterMasterOut`).value=`${v(`jitterMaster`).toFixed(0)}%`,_(`hueJitterOut`).value=`${v(`hueJitter`).toFixed(0)}°`,_(`saturationJitterOut`).value=`${v(`saturationJitter`).toFixed(0)}%`,_(`lightnessJitterOut`).value=`${v(`lightnessJitter`).toFixed(0)}%`,_(`darknessJitterOut`).value=`${v(`darknessJitter`).toFixed(0)}%`,_(`positionJitterLateralOut`).value=`${v(`positionJitterLateral`).toFixed(0)}%`,_(`positionJitterLinearOut`).value=`${v(`positionJitterLinear`).toFixed(0)}%`,_(`pressureSizeOut`).value=`${v(`pressureSize`).toFixed(0)}%`,_(`pressureOpacityOut`).value=`${v(`pressureOpacity`).toFixed(0)}%`,_(`benchmarkStampsOut`).value=y(v(`benchmarkStamps`))}function z(){R(),A.setBrushSettings(L())}function ne(e){return`${(e/1e3).toFixed(2)} s`}function B(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function re(){return new Promise(e=>requestAnimationFrame(e))}function ie(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function ae(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:B(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function oe(){let e=navigator,t=A.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,performanceTelemetryRevision:2,...t}}async function se(e){let t=await fetch(te,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function V(e){if(typeof e!=`object`||!e)return null;let t=e;return t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0?null:t}function ce(){try{let e=window.localStorage.getItem(O);return e?V(JSON.parse(e)):null}catch{return null}}function H(){try{window.localStorage.removeItem(O)}catch{}}async function le(){let e=await fetch(k,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return V(await e.json())}async function U(e){let t=await fetch(k,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=V(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=V(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function ue(){F=!0,K();try{let e=await le();if(e){j=e,H(),E.textContent=q(e);return}let t=ce();if(t){E.textContent=`Fissaggio del tratto che avevi già registrato…`,j=await U(t),H(),E.textContent=q(j);return}E.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){E.textContent=e instanceof Error?e.message:String(e)}finally{F=!1,K()}}function W(e,t){_(e).value=String(t)}function de(e){W(`brushColor`,e.color),W(`brushSize`,e.size),W(`spacing`,e.spacingPercent),W(`count`,e.count),W(`flow`,e.flow*100),W(`hardness`,e.hardness*100),W(`blendIntensity`,e.blendIntensity),W(`blendMode`,e.blendMode),W(`jitterMaster`,e.jitterMaster*100),W(`hueJitter`,e.hueJitterDegrees),W(`saturationJitter`,e.saturationJitter*100),W(`lightnessJitter`,e.lightnessJitter*100),W(`darknessJitter`,e.darknessJitter*100),_(`jitterPerCopy`).checked=e.jitterPerCopy,W(`positionJitterLateral`,e.positionJitterLateral*100),W(`positionJitterLinear`,e.positionJitterLinear*100),W(`pressureSize`,e.pressureSize*100),W(`pressureOpacity`,e.pressureOpacity*100),z()}function G(){return W(`brushSize`,750),W(`spacing`,1),W(`count`,16),W(`flow`,100),W(`hardness`,100),W(`blendIntensity`,4),W(`jitterMaster`,100),W(`hueJitter`,180),W(`saturationJitter`,100),_(`jitterPerCopy`).checked=!0,W(`positionJitterLateral`,100),W(`positionJitterLinear`,100),W(`pressureSize`,0),W(`pressureOpacity`,0),z(),L()}function K(){w.disabled=F||I||P||!!j,w.textContent=N?`Annulla registrazione tratto`:j?`Tratto umano fissato`:`Registra tratto umano`,T.disabled=!j||F||I||P}function q(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${y(e.points.length)} campioni`,`durata ${ne(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}for(let e of[`brushColor`,`brushSize`,`spacing`,`count`,`flow`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`,`pressureSize`,`pressureOpacity`])_(e).addEventListener(`input`,z),_(e).addEventListener(`change`,z);_(`benchmarkStamps`).addEventListener(`input`,R),_(`clearLayer`).addEventListener(`click`,()=>A.clear()),_(`fitView`).addEventListener(`click`,()=>A.fitView()),_(`zoomIn`).addEventListener(`click`,()=>A.zoomBy(1.35)),_(`zoomOut`).addEventListener(`click`,()=>A.zoomBy(1/1.35)),D.addEventListener(`change`,async()=>{let e=D.value;D.disabled=!0;try{await A.setLayerFormat(e)}catch{D.value=A.getStats().layerFormat}finally{D.disabled=!1}}),S.addEventListener(`click`,async()=>{S.disabled=!0,C.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await A.runBenchmark(v(`benchmarkStamps`));C.textContent=[`${y(e.baseStamps)} base stamps`,`${y(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){C.textContent=e instanceof Error?e.message:String(e)}finally{S.disabled=!1}}),w.addEventListener(`click`,()=>{F||I||P||M||j||(N=!N,N?(G(),E.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):E.textContent=j?q(j):`Registrazione annullata.`,K())}),T.addEventListener(`click`,()=>{he()});function J(e){_(`fpsStat`).textContent=`${e.fps}`,_(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,_(`stampStat`).textContent=y(e.totalBaseStamps),_(`avoidedStat`).textContent=y(e.avoidedLogicalDraws),_(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,_(`gpuStat`).textContent=e.gpuLabel}function fe(e,t){let n=G(),r=A.toLayerPoint(t);M={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},E.textContent=`Registrazione in corso…`}function pe(e,t){let n=M;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...A.toLayerPoint(t[r]),timeMs:a})}}async function me(e){let t=M;if(M=null,N=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};I=!0,E.textContent=`Fissaggio permanente del tratto di riferimento…`,K();try{j=await U(e),H(),E.textContent=q(j)}catch(e){E.textContent=e instanceof Error?e.message:String(e)}finally{I=!1}}else t&&(E.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);K()}async function he(){let e=j;if(!(!e||P)){P=!0,S.disabled=!0,K(),de(e.settings),E.textContent=`Riproduzione del tratto umano in corso…`;try{await A.waitForIdle(),A.resetStrokeRandomSeed(),A.clear(),await A.waitForIdle();let t=A.getStats(),n=performance.now(),r=e.points[e.points.length-1],i=[],a=[],o=1;A.startStrokePerformanceProfile();let s=performance.now();A.beginStrokeAtLayer(e.points[0]),a.push(performance.now()-s),await new Promise(t=>{let r=s=>{let c=s-n,l=[];for(;o<e.points.length&&e.points[o].timeMs<=c;)i.push(Math.max(0,c-e.points[o].timeMs)),l.push(e.points[o]),o+=1;if(l.length>0){let e=performance.now();A.extendStrokeAtLayer(l),a.push(performance.now()-e)}if(o<e.points.length){requestAnimationFrame(r);return}A.endStroke(),t()};requestAnimationFrame(r)});let c=performance.now();await A.waitForIdle();let l=performance.now();await re();let u=performance.now(),d=A.finishStrokePerformanceProfile();if(!d)throw Error(`Profilo del tratto non disponibile.`);let f=A.getStats(),p=Math.max(0,f.totalBaseStamps-t.totalBaseStamps),m=p*e.settings.count,h={inputDeliveryMs:c-n,inputDelayP50Ms:B(i,.5),inputDelayP95Ms:B(i,.95),inputDelayMaxMs:i.length===0?0:Math.max(...i),layerInputDispatchTotalMs:a.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:B(a,.5),layerInputDispatchP95Ms:B(a,.95),layerInputDispatchMaxMs:a.length===0?0:Math.max(...a),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,l-c),endToPresentedMs:Math.max(0,u-n)},g=await se({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:e.capturedAt,traceFingerprint:ie(e.points),pointCount:e.points.length,traceDurationMs:r.timeMs,...ae(e.points),settings:e.settings},playback:h,performance:d,environment:oe()});E.textContent=[`Tratto ${ne(r.timeMs)}`,`${y(e.points.length)} campioni`,`${y(p)} stamps base`,`${y(m)} copie fisiche`,`coda GPU ${h.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${d.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${d.submitImmediateP95Ms.toFixed(2)} ms`,`FPS medi ${d.averageRenderFps.toFixed(1)}`,`${y(d.delayedRenderFrames)} frame >20 ms`,`presentazione ${h.endToPresentedMs.toFixed(2)} ms`,g>0?`run #${g} salvata`:`run salvata`].join(` · `)}catch(e){A.finishStrokePerformanceProfile(),E.textContent=e instanceof Error?e.message:String(e)}finally{P=!1,S.disabled=!1,K()}}}function ge(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function _e(e){return{clientX:e.clientX,clientY:e.clientY,pressure:ge(e)}}var Y=null,X=null,Z=0,Q=0;b.addEventListener(`pointerdown`,e=>{if(Y===null)if(e.preventDefault(),Y=e.pointerId,X=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,b.setPointerCapture(e.pointerId),X===`pan`)b.classList.add(`panning`),Z=e.clientX,Q=e.clientY;else{let t=_e(e);N&&fe(e,t),A.beginStroke(t)}}),b.addEventListener(`pointermove`,e=>{if(e.pointerId!==Y||X===null)return;if(e.preventDefault(),X===`pan`){A.panByClientDelta(e.clientX-Z,e.clientY-Q),Z=e.clientX,Q=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(_e);pe(n,r),A.extendStroke(r)});function $(e){e.pointerId===Y&&(X===`paint`&&(A.endStroke(),me(e.type===`pointerup`)),b.classList.remove(`panning`),X=null,Y=null)}b.addEventListener(`pointerup`,$),b.addEventListener(`pointercancel`,$),b.addEventListener(`lostpointercapture`,$),b.addEventListener(`contextmenu`,e=>e.preventDefault()),b.addEventListener(`wheel`,e=>{e.preventDefault();let t=Math.exp(-e.deltaY*.0015);A.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>A.resizeCanvas()).observe(b),R(),A.setBrushSettings(L()),K(),ue(),A.initialize().catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;x.textContent=`${e instanceof Error?e.message:String(e)}${t}`,x.className=`status error`,S.disabled=!0}),window.setInterval(()=>J(A.getStats()),500);