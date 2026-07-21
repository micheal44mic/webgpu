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

const OUTSIDE_LINEAR: vec3<f32> = vec3<f32>(0.00440084934);
const CHECKER_DARK_LINEAR: vec3<f32> = vec3<f32>(0.638283253);
const CHECKER_LIGHT_LINEAR: vec3<f32> = vec3<f32>(0.807346106);

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
    return vec4<f32>(OUTSIDE_LINEAR, 1.0);
  }

  let uv = clamp((layerPosition + vec2<f32>(0.5)) / display.layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let paint = textureSampleLevel(layerTexture, layerSampler, uv, 0.0);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundLinear = select(CHECKER_DARK_LINEAR, CHECKER_LIGHT_LINEAR, checkerParity == 0);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(compositedLinear, 1.0);
}
`,i=4096,a=32,o=65536,s=4,c=`quad`,l=`generic-smoothstep`,u=`reuse-position-copy-seed`,d=`directional-jitter-bounds`,f=`srgb-render-target`,p=96,m=32;function h(e){if(e===`bgra8unorm`)return`bgra8unorm-srgb`;if(e===`rgba8unorm`)return`rgba8unorm-srgb`;throw Error(`Il formato canvas ${e} non ha una view sRGB compatibile.`)}function g(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function _(e){return e.length===0?0:Math.max(...e)}function v(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}var ee={color:`#ff5b35`,size:96,spacingPercent:1,count:24,flow:.07,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1,pressureSize:.65,pressureOpacity:.35},te=class{layerSize=i;canvas;callbacks;adapter;device;context;canvasFormat;canvasSrgbFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;brushUniformBuffer;displayUniformBuffer;instanceBuffer;sampler;brushBindGroupLayout;displayBindGroupLayout;brushBindGroup;displayBindGroup;brushShaderModule;displayShaderModule;normalPipeline;additivePipeline;displayPipeline;instanceUpload=new ArrayBuffer(o*a);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);brushUniformUpload=new ArrayBuffer(p);displayUniformUpload=new Float32Array(m/4);settings={...ee};pendingStamps=[];activeStroke=null;seedSequence=1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=i*.5;viewCenterY=i*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;constructor(e,t={}){this.canvas=e,this.callbacks=t}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<i)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${i}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.canvasSrgbFormat=h(this.canvasFormat),this.context.configure({device:this.device,format:this.canvasFormat,viewFormats:[this.canvasSrgbFormat],alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats()}getSettings(){return{...this.settings}}setBrushSettings(e){this.settings={...this.settings,...e,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),flow:t(e.flow??this.settings.flow,.001,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.initialized&&(this.writeBrushUniforms(),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(!this.initialized||e===this.layerFormat)return;this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`),await this.device.queue.onSubmittedWorkDone();let t=this.layerFormat;try{await this.recreateLayerResources(e),this.layerFormat=e,this.clearRequested=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats()}catch(n){await this.recreateLayerResources(t),this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=i*.5,this.viewCenterY=i*.5,this.zoom=Math.max(.01,Math.min(e/i,t/i)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.requestRender()}zoomBy(e,n,r){let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.requestRender()}panByClientDelta(e,t){let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){this.activeStroke={lastInput:e,distanceSinceStamp:0},this.emitStamp(e,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(){this.activeStroke=null}clear(){this.pendingStamps.length=0,this.activeStroke=null,this.clearRequested=!0,this.displayDirty=!0,this.requestRender()}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);let n=t(Math.round(e),1,Math.min(12e3,o));this.pendingStamps.length=0,this.activeStroke=null,this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.generateBenchmarkStamps(n),i=performance.now(),a=this.submitImmediate(r,!0).totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone();let s=performance.now()-i;this.totalBaseStamps+=r.length,this.avoidedLogicalDraws+=r.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(performance.now()),this.publishStats();let c=r.reduce((e,t)=>e+t.radius*t.radius,0)/r.length,l=Math.round(Math.PI*c*r.length*this.settings.count),u=[`1 draw instanziata`,`${this.settings.count} copie fisiche GPU per stamp base`,`geometria quad triangle-strip (4 vertici)`,`coverage fragment smoothstep generica`,`riuso copySeed per jitter colore per copia`,`dirty rect direzionale conservativo`,`display lineare su target sRGB`].join(` · `);return{baseStamps:r.length,logicalCopies:r.length*this.settings.count,cpuSubmitMs:a,gpuCompletionMs:s,estimatedCoveredFragments:l,strategy:u}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.clearRequested||this.displayDirty;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=v(e.renderIntervalMs);return{stampGeometry:c,stampVerticesPerCopy:s,fragmentCoverageStrategy:l,colorSeedStrategy:u,dirtyRectStrategy:d,displayColorStrategy:f,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:g(e.cpuFrameMs,.5),submitImmediateP95Ms:g(e.cpuFrameMs,.95),submitImmediateMaxMs:_(e.cpuFrameMs),renderFrameTotalP50Ms:g(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:g(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:_(e.renderFrameTotalMs),renderFrameOverheadP50Ms:g(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:g(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:_(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:g(e.cpuFrameMs,.5),cpuFrameP95Ms:g(e.cpuFrameMs,.95),cpuFrameMaxMs:_(e.cpuFrameMs),renderIntervalP50Ms:g(e.renderIntervalMs,.5),renderIntervalP95Ms:g(e.renderIntervalMs,.95),renderIntervalMaxMs:_(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:i,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:c,stampVerticesPerCopy:s,fragmentCoverageStrategy:l,colorSeedStrategy:u,dirtyRectStrategy:d,displayColorStrategy:f}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:p,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:m,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:o*a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}}]}),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:n}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:r}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.displayShaderModule,`display`)]);let e=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:e,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasSrgbFormat}]},primitive:{topology:`triangle-list`}})}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:i,height:i,depthOrArrayLayers:1},format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView(),a=this.device.createPipelineLayout({label:`Brush pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]});this.device.pushErrorScope(`validation`);let o=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),s=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),c=await this.device.popErrorScope();if(c)throw n.destroy(),Error(c.message);let l=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:r},{binding:2,resource:this.sampler}]});this.layerTexture=n,this.layerView=r,this.normalPipeline=o,this.additivePipeline=s,this.displayBindGroup=l,this.layerFormat=e,t?.destroy()}writeBrushUniforms(){let t=new Float32Array(this.brushUniformUpload),n=new Uint32Array(this.brushUniformUpload);t.fill(0);let[r,a,o]=e(this.settings.color),s=this.settings.jitterMaster;t[0]=i,t[1]=i,t[4]=r,t[5]=a,t[6]=o,t[7]=1,t[8]=this.settings.hueJitterDegrees/360*s,t[9]=this.settings.saturationJitter*s,t[10]=this.settings.lightnessJitter*s,t[11]=this.settings.darknessJitter*s,t[12]=this.settings.flow,t[13]=this.settings.hardness,t[14]=this.settings.blendIntensity,t[15]=this.settings.pressureOpacity,t[16]=this.settings.positionJitterLinear,t[17]=this.settings.positionJitterLateral,n[20]=this.settings.count>>>0,n[21]=+!!this.settings.jitterPerCopy,n[22]=+(this.settings.blendMode===`additive`),n[23]=0,this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeDisplayUniforms(){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=i,this.displayUniformUpload[3]=i,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1)}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;let i=r.lastInput,a=e.x-i.x,s=e.y-i.y,c=Math.hypot(a,s);if(c<=1e-4){r.lastInput=e,this.recordStampGenerationTime(n);return}let l=Math.max(.1,this.settings.size*(this.settings.spacingPercent/100)),u=a/c,d=s/c,f=0,p=r.distanceSinceStamp,m=0;for(;p+(c-f)>=l;){let n=l-p;f+=n;let r=t(f/c,0,1);if(this.emitStamp({x:i.x+a*r,y:i.y+s*r,pressure:i.pressure+(e.pressure-i.pressure)*r},u,d),p=0,m+=1,m>=o)break}p+=Math.max(0,c-f),r.lastInput=e,r.distanceSinceStamp=p,this.recordStampGenerationTime(n)}emitStamp(e,n,r){let a=t(e.pressure,.01,1),o=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,a),s=Math.max(.5,this.settings.size*.5*o),c=s*2*(this.settings.positionJitterLinear+this.settings.positionJitterLateral),l=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0;e.x+s+c<0||e.y+s+c<0||e.x-s-c>=i||e.y-s-c>=i||(this.pendingStamps.push({x:e.x,y:e.y,radius:s,pressure:a,seed:l,directionX:n,directionY:r}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n,i=performance.now(),a=Math.min(this.pendingStamps.length,o),s=a>0?this.pendingStamps.splice(0,a):[],c=performance.now()-i;if(!(this.clearRequested||s.length>0||this.displayDirty)||this.canvas.width<=0||this.canvas.height<=0)return;let l=this.clearRequested,u=performance.now(),d=this.submitImmediate(s,l);this.lastCpuFrameMs=performance.now()-u,this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=s.length,this.avoidedLogicalDraws+=s.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(e);let f=performance.now();this.publishStats();let p=performance.now()-f;(this.pendingStamps.length>0||this.displayDirty||this.clearRequested)&&this.requestRender(),this.recordStrokeFrameTiming(e,s.length,d,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:c,statsPublishMs:p})}submitImmediate(e,t){let n=performance.now(),r=this.device.createCommandEncoder({label:`Brush frame encoder`}),i=0,o=0,c=0,l=0,u=0,d=0;if(t||e.length>0){let n=null;if(e.length>0){let t=performance.now();n=this.packStamps(e),i=performance.now()-t;let r=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*a),o=performance.now()-r}let l=performance.now(),u=r.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});e.length>0&&n&&(d=n.width*n.height,u.setPipeline(this.settings.blendMode===`additive`?this.additivePipeline:this.normalPipeline),u.setBindGroup(0,this.brushBindGroup),u.setScissorRect(n.x,n.y,n.width,n.height),u.draw(s,e.length*this.settings.count,0,0)),u.end(),c=performance.now()-l}let f=performance.now();this.writeDisplayUniforms();let p=r.beginRenderPass({label:`Present paint layer`,colorAttachments:[{view:this.context.getCurrentTexture().createView({format:this.canvasSrgbFormat}),loadOp:`clear`,storeOp:`store`,clearValue:{r:.001547988,g:.001547988,b:.001934985,a:1}}]});p.setPipeline(this.displayPipeline),p.setBindGroup(0,this.displayBindGroup),p.draw(3,1,0,0),p.end(),l=performance.now()-f;let m=performance.now();return this.device.queue.submit([r.finish()]),u=performance.now()-m,{totalCpuMs:performance.now()-n,stampPackingMs:i,instanceUploadMs:o,brushEncodingMs:c,displayEncodingMs:l,commandSubmitMs:u,scissorPixels:d}}packStamps(e){let n=i,r=i,o=0,s=0;for(let t=0;t<e.length;t+=1){let i=e[t],c=a/4*t;this.instanceUploadF32[c]=i.x,this.instanceUploadF32[c+1]=i.y,this.instanceUploadF32[c+2]=i.radius,this.instanceUploadF32[c+3]=i.pressure,this.instanceUploadU32[c+4]=i.seed,this.instanceUploadU32[c+5]=0,this.instanceUploadF32[c+6]=i.directionX,this.instanceUploadF32[c+7]=i.directionY;let l=this.instanceUploadF32[c],u=this.instanceUploadF32[c+1],d=this.instanceUploadF32[c+2],f=this.instanceUploadF32[c+6],p=this.instanceUploadF32[c+7],m=Math.hypot(f,p),h=d*2*this.settings.positionJitterLinear,g=d*2*this.settings.positionJitterLateral,_,v;if(m>2e-4){let e=f/m,t=p/m;_=d+Math.abs(e)*h+Math.abs(t)*g+2,v=d+Math.abs(t)*h+Math.abs(e)*g+2}else{let e=d+h+g+2;_=e,v=e}n=Math.min(n,l-_),r=Math.min(r,u-v),o=Math.max(o,l+_),s=Math.max(s,u+v)}let c=t(Math.floor(n),0,i-1),l=t(Math.floor(r),0,i-1),u=t(Math.ceil(o),1,i),d=t(Math.ceil(s),1,i),f=Math.max(0,u-c),p=Math.max(0,d-l);return f>0&&p>0?{x:c,y:l,width:f,height:p}:null}generateBenchmarkStamps(e){let n=Array(e),r=i*.5,a=i*.39;for(let i=0;i<e;i+=1){let o=e<=1?0:i/(e-1),s=o*Math.PI*18,c=a*(.12+o*.88),l=t(.58+Math.sin(o*Math.PI*15)*.28,.1,1),u=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,l),d=Math.max(.5,this.settings.size*.5*u);n[i]={x:r+Math.cos(s)*c,y:r+Math.sin(s*1.037)*c,radius:d,pressure:l,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(s),directionY:Math.cos(s*1.037)}}return n}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r){let i=this.activeStrokeProfile;i&&(i.previousFrameTimestamp!==null&&i.renderIntervalMs.push(Math.max(0,e-i.previousFrameTimestamp)),i.previousFrameTimestamp=e,i.renderFrames+=1,i.cpuFrameMs.push(this.lastCpuFrameMs),i.renderFrameTotalMs.push(r.totalCpuMs),i.renderFrameOverheadMs.push(Math.max(0,r.totalCpuMs-n.totalCpuMs)),i.resizeCanvasMs+=r.resizeCanvasMs,i.batchExtractionMs+=r.batchExtractionMs,i.statsPublishMs+=r.statsPublishMs,i.stampPackingMs+=n.stampPackingMs,i.instanceUploadMs+=n.instanceUploadMs,i.brushEncodingMs+=n.brushEncodingMs,i.displayEncodingMs+=n.displayEncodingMs,i.commandSubmitMs+=n.commandSubmitMs,i.estimatedScissorPixels+=n.scissorPixels,t>0&&(i.brushBatches+=1,i.physicalCopies+=t*this.settings.count,i.largestBatchStamps=Math.max(i.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function y(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function b(e){return Number(y(e).value)}function x(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var S=y(`gpuCanvas`),C=y(`status`),w=y(`runBenchmark`),T=y(`benchmarkResult`),E=y(`recordHumanStroke`),ne=y(`playHumanStroke`),D=y(`humanStrokeResult`),O=y(`layerFormat`),k=`webgpu-brush-engine.human-stroke.v1`,A=`/api/human-stroke`,re=`/api/benchmark-runs`,j=new te(S,{onStatus(e,t){C.textContent=e,C.className=`status ${t===`working`?``:t}`},onStats(e){me(e)}}),M=null,N=null,P=!1,F=!1,I=!0,L=!1;function R(){return{color:y(`brushColor`).value,size:b(`brushSize`),spacingPercent:b(`spacing`),count:b(`count`),flow:b(`flow`)/100,hardness:b(`hardness`)/100,blendIntensity:b(`blendIntensity`),blendMode:y(`blendMode`).value,jitterMaster:b(`jitterMaster`)/100,hueJitterDegrees:b(`hueJitter`),saturationJitter:b(`saturationJitter`)/100,lightnessJitter:b(`lightnessJitter`)/100,darknessJitter:b(`darknessJitter`)/100,jitterPerCopy:y(`jitterPerCopy`).checked,positionJitterLateral:b(`positionJitterLateral`)/100,positionJitterLinear:b(`positionJitterLinear`)/100,pressureSize:b(`pressureSize`)/100,pressureOpacity:b(`pressureOpacity`)/100}}function z(){y(`brushSizeOut`).value=`${b(`brushSize`).toFixed(0)} px`,y(`spacingOut`).value=`${b(`spacing`).toFixed(2)}%`,y(`countOut`).value=b(`count`).toFixed(0),y(`flowOut`).value=`${b(`flow`).toFixed(1).replace(`.0`,``)}%`,y(`hardnessOut`).value=`${b(`hardness`).toFixed(0)}%`,y(`blendIntensityOut`).value=`${b(`blendIntensity`).toFixed(2)}×`,y(`jitterMasterOut`).value=`${b(`jitterMaster`).toFixed(0)}%`,y(`hueJitterOut`).value=`${b(`hueJitter`).toFixed(0)}°`,y(`saturationJitterOut`).value=`${b(`saturationJitter`).toFixed(0)}%`,y(`lightnessJitterOut`).value=`${b(`lightnessJitter`).toFixed(0)}%`,y(`darknessJitterOut`).value=`${b(`darknessJitter`).toFixed(0)}%`,y(`positionJitterLateralOut`).value=`${b(`positionJitterLateral`).toFixed(0)}%`,y(`positionJitterLinearOut`).value=`${b(`positionJitterLinear`).toFixed(0)}%`,y(`pressureSizeOut`).value=`${b(`pressureSize`).toFixed(0)}%`,y(`pressureOpacityOut`).value=`${b(`pressureOpacity`).toFixed(0)}%`,y(`benchmarkStampsOut`).value=x(b(`benchmarkStamps`))}function B(){z(),j.setBrushSettings(R())}function V(e){return`${(e/1e3).toFixed(2)} s`}function H(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function ie(){return new Promise(e=>requestAnimationFrame(e))}function ae(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function oe(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:H(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function se(){let e=navigator,t=j.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,performanceTelemetryRevision:2,...t}}async function ce(e){let t=await fetch(re,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function U(e){if(typeof e!=`object`||!e)return null;let t=e;return t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0?null:t}function le(){try{let e=window.localStorage.getItem(k);return e?U(JSON.parse(e)):null}catch{return null}}function W(){try{window.localStorage.removeItem(k)}catch{}}async function ue(){let e=await fetch(A,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return U(await e.json())}async function G(e){let t=await fetch(A,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=U(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=U(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function de(){I=!0,q();try{let e=await ue();if(e){M=e,W(),D.textContent=J(e);return}let t=le();if(t){D.textContent=`Fissaggio del tratto che avevi già registrato…`,M=await G(t),W(),D.textContent=J(M);return}D.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){D.textContent=e instanceof Error?e.message:String(e)}finally{I=!1,q()}}function K(e,t){y(e).value=String(t)}function fe(e){K(`brushColor`,e.color),K(`brushSize`,e.size),K(`spacing`,e.spacingPercent),K(`count`,e.count),K(`flow`,e.flow*100),K(`hardness`,e.hardness*100),K(`blendIntensity`,e.blendIntensity),K(`blendMode`,e.blendMode),K(`jitterMaster`,e.jitterMaster*100),K(`hueJitter`,e.hueJitterDegrees),K(`saturationJitter`,e.saturationJitter*100),K(`lightnessJitter`,e.lightnessJitter*100),K(`darknessJitter`,e.darknessJitter*100),y(`jitterPerCopy`).checked=e.jitterPerCopy,K(`positionJitterLateral`,e.positionJitterLateral*100),K(`positionJitterLinear`,e.positionJitterLinear*100),K(`pressureSize`,e.pressureSize*100),K(`pressureOpacity`,e.pressureOpacity*100),B()}function pe(){return K(`brushSize`,750),K(`spacing`,1),K(`count`,16),K(`flow`,100),K(`hardness`,100),K(`blendIntensity`,4),K(`jitterMaster`,100),K(`hueJitter`,180),K(`saturationJitter`,100),y(`jitterPerCopy`).checked=!0,K(`positionJitterLateral`,100),K(`positionJitterLinear`,100),K(`pressureSize`,0),K(`pressureOpacity`,0),B(),R()}function q(){E.disabled=I||L||F||!!M,E.textContent=P?`Annulla registrazione tratto`:M?`Tratto umano fissato`:`Registra tratto umano`,ne.disabled=!M||I||L||F}function J(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${x(e.points.length)} campioni`,`durata ${V(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}for(let e of[`brushColor`,`brushSize`,`spacing`,`count`,`flow`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`,`pressureSize`,`pressureOpacity`])y(e).addEventListener(`input`,B),y(e).addEventListener(`change`,B);y(`benchmarkStamps`).addEventListener(`input`,z),y(`clearLayer`).addEventListener(`click`,()=>j.clear()),y(`fitView`).addEventListener(`click`,()=>j.fitView()),y(`zoomIn`).addEventListener(`click`,()=>j.zoomBy(1.35)),y(`zoomOut`).addEventListener(`click`,()=>j.zoomBy(1/1.35)),O.addEventListener(`change`,async()=>{let e=O.value;O.disabled=!0;try{await j.setLayerFormat(e)}catch{O.value=j.getStats().layerFormat}finally{O.disabled=!1}}),w.addEventListener(`click`,async()=>{w.disabled=!0,T.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await j.runBenchmark(b(`benchmarkStamps`));T.textContent=[`${x(e.baseStamps)} base stamps`,`${x(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){T.textContent=e instanceof Error?e.message:String(e)}finally{w.disabled=!1}}),E.addEventListener(`click`,()=>{I||L||F||N||M||(P=!P,P?(pe(),D.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):D.textContent=M?J(M):`Registrazione annullata.`,q())}),ne.addEventListener(`click`,()=>{ve()});function me(e){y(`fpsStat`).textContent=`${e.fps}`,y(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,y(`stampStat`).textContent=x(e.totalBaseStamps),y(`avoidedStat`).textContent=x(e.avoidedLogicalDraws),y(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,y(`gpuStat`).textContent=e.gpuLabel}function he(e,t){let n=pe(),r=j.toLayerPoint(t);N={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},D.textContent=`Registrazione in corso…`}function ge(e,t){let n=N;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...j.toLayerPoint(t[r]),timeMs:a})}}async function _e(e){let t=N;if(N=null,P=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};L=!0,D.textContent=`Fissaggio permanente del tratto di riferimento…`,q();try{M=await G(e),W(),D.textContent=J(M)}catch(e){D.textContent=e instanceof Error?e.message:String(e)}finally{L=!1}}else t&&(D.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);q()}async function ve(){let e=M;if(!(!e||F)){F=!0,w.disabled=!0,q(),fe(e.settings),D.textContent=`Riproduzione del tratto umano in corso…`;try{await j.waitForIdle(),j.resetStrokeRandomSeed(),j.clear(),await j.waitForIdle();let t=j.getStats(),n=performance.now(),r=e.points[e.points.length-1],i=[],a=[],o=1;j.startStrokePerformanceProfile();let s=performance.now();j.beginStrokeAtLayer(e.points[0]),a.push(performance.now()-s),await new Promise(t=>{let r=s=>{let c=s-n,l=[];for(;o<e.points.length&&e.points[o].timeMs<=c;)i.push(Math.max(0,c-e.points[o].timeMs)),l.push(e.points[o]),o+=1;if(l.length>0){let e=performance.now();j.extendStrokeAtLayer(l),a.push(performance.now()-e)}if(o<e.points.length){requestAnimationFrame(r);return}j.endStroke(),t()};requestAnimationFrame(r)});let c=performance.now();await j.waitForIdle();let l=performance.now();await ie();let u=performance.now(),d=j.finishStrokePerformanceProfile();if(!d)throw Error(`Profilo del tratto non disponibile.`);let f=j.getStats(),p=Math.max(0,f.totalBaseStamps-t.totalBaseStamps),m=p*e.settings.count,h={inputDeliveryMs:c-n,inputDelayP50Ms:H(i,.5),inputDelayP95Ms:H(i,.95),inputDelayMaxMs:i.length===0?0:Math.max(...i),layerInputDispatchTotalMs:a.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:H(a,.5),layerInputDispatchP95Ms:H(a,.95),layerInputDispatchMaxMs:a.length===0?0:Math.max(...a),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,l-c),endToPresentedMs:Math.max(0,u-n)},g=await ce({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:e.capturedAt,traceFingerprint:ae(e.points),pointCount:e.points.length,traceDurationMs:r.timeMs,...oe(e.points),settings:e.settings},playback:h,performance:d,environment:se()});D.textContent=[`Tratto ${V(r.timeMs)}`,`${x(e.points.length)} campioni`,`${x(p)} stamps base`,`${x(m)} copie fisiche`,`coda GPU ${h.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${d.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${d.submitImmediateP95Ms.toFixed(2)} ms`,`FPS medi ${d.averageRenderFps.toFixed(1)}`,`${x(d.delayedRenderFrames)} frame >20 ms`,`presentazione ${h.endToPresentedMs.toFixed(2)} ms`,g>0?`run #${g} salvata`:`run salvata`].join(` · `)}catch(e){j.finishStrokePerformanceProfile(),D.textContent=e instanceof Error?e.message:String(e)}finally{F=!1,w.disabled=!1,q()}}}function ye(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function be(e){return{clientX:e.clientX,clientY:e.clientY,pressure:ye(e)}}var Y=null,X=null,Z=0,Q=0;S.addEventListener(`pointerdown`,e=>{if(Y===null)if(e.preventDefault(),Y=e.pointerId,X=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,S.setPointerCapture(e.pointerId),X===`pan`)S.classList.add(`panning`),Z=e.clientX,Q=e.clientY;else{let t=be(e);P&&he(e,t),j.beginStroke(t)}}),S.addEventListener(`pointermove`,e=>{if(e.pointerId!==Y||X===null)return;if(e.preventDefault(),X===`pan`){j.panByClientDelta(e.clientX-Z,e.clientY-Q),Z=e.clientX,Q=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(be);ge(n,r),j.extendStroke(r)});function $(e){e.pointerId===Y&&(X===`paint`&&(j.endStroke(),_e(e.type===`pointerup`)),S.classList.remove(`panning`),X=null,Y=null)}S.addEventListener(`pointerup`,$),S.addEventListener(`pointercancel`,$),S.addEventListener(`lostpointercapture`,$),S.addEventListener(`contextmenu`,e=>e.preventDefault()),S.addEventListener(`wheel`,e=>{e.preventDefault();let t=Math.exp(-e.deltaY*.0015);j.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>j.resizeCanvas()).observe(S),z(),j.setBrushSettings(R()),q(),de(),j.initialize().catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;C.textContent=`${e instanceof Error?e.message:String(e)}${t}`,C.className=`status error`,w.disabled=!0}),window.setInterval(()=>me(j.getStats()),500);