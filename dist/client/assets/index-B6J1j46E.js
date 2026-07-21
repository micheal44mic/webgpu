(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=`
const MAX_COUNT: u32 = 24u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  _pad0: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  options: vec4<u32>,
};

struct Stamp {
  center: vec2<f32>,
  radius: f32,
  pressure: f32,
  seed: u32,
  _pad0: u32,
  _pad1: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pressure: f32,
  @location(2) @interpolate(flat) seed: u32,
  @location(3) @interpolate(flat) pointColor: vec3<f32>,
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

fn jitteredLinearColor(seed: u32, copyIndex: u32) -> vec3<f32> {
  let copySeed = hash32(seed ^ (copyIndex * 0x85ebca6bu));
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

fn integerPower(baseValue: f32, exponentValue: u32) -> f32 {
  var result = 1.0;
  var base = baseValue;
  var exponent = exponentValue;

  loop {
    if (exponent == 0u) {
      break;
    }
    if ((exponent & 1u) != 0u) {
      result = result * base;
    }
    exponent = exponent >> 1u;
    base = base * base;
  }

  return result;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let stamp = stamps[instanceIndex];
  let localPosition = corners[vertexIndex];
  let layerPosition = stamp.center + localPosition * stamp.radius;
  let clipPosition = vec2<f32>(
    layerPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - layerPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.pressure = stamp.pressure;
  output.seed = stamp.seed;
  output.pointColor = jitteredLinearColor(stamp.seed, 0u);
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
  let alphaPerCopy = clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * pressureAlpha * brush.controls.z,
    0.0,
    0.999999
  );

  let count = max(1u, min(brush.options.x, MAX_COUNT));
  let jitterPerCopy = brush.options.y != 0u;
  let additiveBlend = brush.options.z != 0u;
  let combinedAlpha = 1.0 - integerPower(1.0 - alphaPerCopy, count);

  if (!jitterPerCopy) {
    if (additiveBlend) {
      return vec4<f32>(input.pointColor * alphaPerCopy * f32(count), combinedAlpha);
    }
    return vec4<f32>(input.pointColor * combinedAlpha, combinedAlpha);
  }

  if (additiveBlend) {
    var additiveColor = vec3<f32>(0.0);
    for (var copyIndex = 0u; copyIndex < MAX_COUNT; copyIndex = copyIndex + 1u) {
      if (copyIndex >= count) {
        break;
      }
      additiveColor = additiveColor + jitteredLinearColor(input.seed, copyIndex) * alphaPerCopy;
    }
    return vec4<f32>(additiveColor, combinedAlpha);
  }

  var accumulatedColor = vec3<f32>(0.0);
  var accumulatedAlpha = 0.0;
  for (var copyIndex = 0u; copyIndex < MAX_COUNT; copyIndex = copyIndex + 1u) {
    if (copyIndex >= count) {
      break;
    }
    let copyColor = jitteredLinearColor(input.seed, copyIndex);
    accumulatedColor = copyColor * alphaPerCopy + accumulatedColor * (1.0 - alphaPerCopy);
    accumulatedAlpha = alphaPerCopy + accumulatedAlpha * (1.0 - alphaPerCopy);
  }

  return vec4<f32>(accumulatedColor, accumulatedAlpha);
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
  let paint = textureSample(layerTexture, layerSampler, uv);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,i=4096,a=32,o=65536,s=80,c=32,l={color:`#ff5b35`,size:96,spacingPercent:1,count:24,flow:.07,hardness:.88,blendIntensity:1,blendMode:`normal`,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,pressureSize:.65,pressureOpacity:.35},u=class{layerSize=i;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;brushUniformBuffer;displayUniformBuffer;instanceBuffer;sampler;brushBindGroupLayout;displayBindGroupLayout;brushBindGroup;displayBindGroup;brushShaderModule;displayShaderModule;normalPipeline;additivePipeline;displayPipeline;instanceUpload=new ArrayBuffer(o*a);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);brushUniformUpload=new ArrayBuffer(s);displayUniformUpload=new Float32Array(c/4);settings={...l};pendingStamps=[];activeStroke=null;seedSequence=1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=i*.5;viewCenterY=i*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;constructor(e,t={}){this.canvas=e,this.callbacks=t}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<i)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${i}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats()}getSettings(){return{...this.settings}}setBrushSettings(e){this.settings={...this.settings,...e,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,4,512),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,.25,25),flow:t(e.flow??this.settings.flow,.001,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),pressureSize:t(e.pressureSize??this.settings.pressureSize,0,1),pressureOpacity:t(e.pressureOpacity??this.settings.pressureOpacity,0,1)},this.initialized&&(this.writeBrushUniforms(),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(!this.initialized||e===this.layerFormat)return;this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`),await this.device.queue.onSubmittedWorkDone();let t=this.layerFormat;try{await this.recreateLayerResources(e),this.layerFormat=e,this.clearRequested=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats()}catch(n){await this.recreateLayerResources(t),this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=i*.5,this.viewCenterY=i*.5,this.zoom=Math.max(.01,Math.min(e/i,t/i)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.requestRender()}zoomBy(e,n,r){let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.requestRender()}panByClientDelta(e,t){let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.requestRender()}beginStroke(e){let t=this.pointerSampleToLayer(e);this.activeStroke={lastInput:t,distanceSinceStamp:0},this.emitStamp(t)}extendStroke(e){if(this.activeStroke)for(let t of e)this.appendPoint(this.pointerSampleToLayer(t))}endStroke(){this.activeStroke=null}clear(){this.pendingStamps.length=0,this.activeStroke=null,this.clearRequested=!0,this.displayDirty=!0,this.requestRender()}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);let n=t(Math.round(e),1,Math.min(12e3,o));this.pendingStamps.length=0,this.activeStroke=null,this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.generateBenchmarkStamps(n),i=performance.now(),a=this.submitImmediate(r,!0);this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone();let s=performance.now()-i;this.totalBaseStamps+=r.length,this.avoidedLogicalDraws+=r.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(performance.now()),this.publishStats();let c=r.reduce((e,t)=>e+t.radius*t.radius,0)/r.length,l=Math.round(Math.PI*c*r.length),u=this.settings.jitterPerCopy?`1 quad/base stamp + loop esatto ×${this.settings.count} nel fragment shader`:`count ${this.settings.count} collassato in 1 quad/base stamp`;return{baseStamps:r.length,logicalCopies:r.length*this.settings.count,cpuSubmitMs:a,gpuCompletionMs:s,estimatedCoveredFragments:l,strategy:u}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:s,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:c,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:o*a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}}]}),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:n}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:r}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.displayShaderModule,`display`)]);let e=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:e,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async recreateLayerResources(e){let t=this.layerTexture,n=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:i,height:i,depthOrArrayLayers:1},format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),r=n.createView(),a=this.device.createPipelineLayout({label:`Brush pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]});this.device.pushErrorScope(`validation`);let o=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-list`}}),s=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:a,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-list`}}),c=await this.device.popErrorScope();if(c)throw n.destroy(),Error(c.message);let l=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:r},{binding:2,resource:this.sampler}]});this.layerTexture=n,this.layerView=r,this.normalPipeline=o,this.additivePipeline=s,this.displayBindGroup=l,this.layerFormat=e,t?.destroy()}writeBrushUniforms(){let t=new Float32Array(this.brushUniformUpload),n=new Uint32Array(this.brushUniformUpload);t.fill(0);let[r,a,o]=e(this.settings.color),s=this.settings.jitterMaster;t[0]=i,t[1]=i,t[4]=r,t[5]=a,t[6]=o,t[7]=1,t[8]=this.settings.hueJitterDegrees/360*s,t[9]=this.settings.saturationJitter*s,t[10]=this.settings.lightnessJitter*s,t[11]=this.settings.darknessJitter*s,t[12]=this.settings.flow,t[13]=this.settings.hardness,t[14]=this.settings.blendIntensity,t[15]=this.settings.pressureOpacity,n[16]=this.settings.count>>>0,n[17]=+!!this.settings.jitterPerCopy,n[18]=+(this.settings.blendMode===`additive`),n[19]=0,this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeDisplayUniforms(){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=i,this.displayUniformUpload[3]=i,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}pointerSampleToLayer(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1)}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStroke;if(!n)return;let r=n.lastInput,i=e.x-r.x,a=e.y-r.y,s=Math.hypot(i,a);if(s<=1e-4){n.lastInput=e;return}let c=Math.max(.1,this.settings.size*(this.settings.spacingPercent/100)),l=0,u=n.distanceSinceStamp,d=0;for(;u+(s-l)>=c;){let n=c-u;l+=n;let f=t(l/s,0,1);if(this.emitStamp({x:r.x+i*f,y:r.y+a*f,pressure:r.pressure+(e.pressure-r.pressure)*f}),u=0,d+=1,d>=o)break}u+=Math.max(0,s-l),n.lastInput=e,n.distanceSinceStamp=u}emitStamp(e){let n=t(e.pressure,.01,1),r=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,n),a=Math.max(.5,this.settings.size*.5*r);if(e.x+a<0||e.y+a<0||e.x-a>=i||e.y-a>=i)return;let o=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0;this.pendingStamps.push({x:e.x,y:e.y,radius:a,pressure:n,seed:o}),this.displayDirty=!0,this.requestRender()}requestRender(){!this.initialized&&!this.device||this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){this.frameRequest=null,this.resizeCanvas();let t=Math.min(this.pendingStamps.length,o),n=t>0?this.pendingStamps.splice(0,t):[];if(!(this.clearRequested||n.length>0||this.displayDirty)||this.canvas.width<=0||this.canvas.height<=0)return;let r=this.clearRequested,i=performance.now();this.submitImmediate(n,r),this.lastCpuFrameMs=performance.now()-i,this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=n.length,this.avoidedLogicalDraws+=n.length*Math.max(0,this.settings.count-1),this.recordRenderedFrame(e),this.publishStats(),(this.pendingStamps.length>0||this.displayDirty||this.clearRequested)&&this.requestRender()}submitImmediate(e,t){let n=performance.now(),r=this.device.createCommandEncoder({label:`Brush frame encoder`});if(t||e.length>0){let n=null;e.length>0&&(n=this.packStamps(e),this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*a));let i=r.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});e.length>0&&n&&(i.setPipeline(this.settings.blendMode===`additive`?this.additivePipeline:this.normalPipeline),i.setBindGroup(0,this.brushBindGroup),i.setScissorRect(n.x,n.y,n.width,n.height),i.draw(6,e.length,0,0)),i.end()}this.writeDisplayUniforms();let i=r.beginRenderPass({label:`Present paint layer`,colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});return i.setPipeline(this.displayPipeline),i.setBindGroup(0,this.displayBindGroup),i.draw(3,1,0,0),i.end(),this.device.queue.submit([r.finish()]),performance.now()-n}packStamps(e){let n=i,r=i,o=0,s=0;for(let t=0;t<e.length;t+=1){let i=e[t],c=a/4*t;this.instanceUploadF32[c]=i.x,this.instanceUploadF32[c+1]=i.y,this.instanceUploadF32[c+2]=i.radius,this.instanceUploadF32[c+3]=i.pressure,this.instanceUploadU32[c+4]=i.seed,this.instanceUploadU32[c+5]=0,this.instanceUploadU32[c+6]=0,this.instanceUploadU32[c+7]=0,n=Math.min(n,i.x-i.radius-2),r=Math.min(r,i.y-i.radius-2),o=Math.max(o,i.x+i.radius+2),s=Math.max(s,i.y+i.radius+2)}let c=t(Math.floor(n),0,i-1),l=t(Math.floor(r),0,i-1),u=t(Math.ceil(o),1,i),d=t(Math.ceil(s),1,i),f=Math.max(0,u-c),p=Math.max(0,d-l);return f>0&&p>0?{x:c,y:l,width:f,height:p}:null}generateBenchmarkStamps(e){let n=Array(e),r=i*.5,a=i*.39;for(let i=0;i<e;i+=1){let o=e<=1?0:i/(e-1),s=o*Math.PI*18,c=a*(.12+o*.88),l=t(.58+Math.sin(o*Math.PI*15)*.28,.1,1),u=1-this.settings.pressureSize+this.settings.pressureSize*Math.max(.08,l),d=Math.max(.5,this.settings.size*.5*u);n[i]={x:r+Math.cos(s)*c,y:r+Math.sin(s*1.037)*c,radius:d,pressure:l,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0}}return n}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}publishStats(){this.callbacks.onStats?.(this.getStats())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function d(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function f(e){return Number(d(e).value)}function p(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var m=d(`gpuCanvas`),h=d(`status`),g=d(`runBenchmark`),_=d(`benchmarkResult`),v=d(`layerFormat`),y=new u(m,{onStatus(e,t){h.textContent=e,h.className=`status ${t===`working`?``:t}`},onStats(e){C(e)}});function b(){return{color:d(`brushColor`).value,size:f(`brushSize`),spacingPercent:f(`spacing`),count:f(`count`),flow:f(`flow`)/100,hardness:f(`hardness`)/100,blendIntensity:f(`blendIntensity`),blendMode:d(`blendMode`).value,jitterMaster:f(`jitterMaster`)/100,hueJitterDegrees:f(`hueJitter`),saturationJitter:f(`saturationJitter`)/100,lightnessJitter:f(`lightnessJitter`)/100,darknessJitter:f(`darknessJitter`)/100,jitterPerCopy:d(`jitterPerCopy`).checked,pressureSize:f(`pressureSize`)/100,pressureOpacity:f(`pressureOpacity`)/100}}function x(){d(`brushSizeOut`).value=`${f(`brushSize`).toFixed(0)} px`,d(`spacingOut`).value=`${f(`spacing`).toFixed(2)}%`,d(`countOut`).value=f(`count`).toFixed(0),d(`flowOut`).value=`${f(`flow`).toFixed(1).replace(`.0`,``)}%`,d(`hardnessOut`).value=`${f(`hardness`).toFixed(0)}%`,d(`blendIntensityOut`).value=`${f(`blendIntensity`).toFixed(2)}×`,d(`jitterMasterOut`).value=`${f(`jitterMaster`).toFixed(0)}%`,d(`hueJitterOut`).value=`${f(`hueJitter`).toFixed(0)}°`,d(`saturationJitterOut`).value=`${f(`saturationJitter`).toFixed(0)}%`,d(`lightnessJitterOut`).value=`${f(`lightnessJitter`).toFixed(0)}%`,d(`darknessJitterOut`).value=`${f(`darknessJitter`).toFixed(0)}%`,d(`pressureSizeOut`).value=`${f(`pressureSize`).toFixed(0)}%`,d(`pressureOpacityOut`).value=`${f(`pressureOpacity`).toFixed(0)}%`,d(`benchmarkStampsOut`).value=p(f(`benchmarkStamps`))}function S(){x(),y.setBrushSettings(b())}for(let e of[`brushColor`,`brushSize`,`spacing`,`count`,`flow`,`hardness`,`blendIntensity`,`blendMode`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`pressureSize`,`pressureOpacity`])d(e).addEventListener(`input`,S),d(e).addEventListener(`change`,S);d(`benchmarkStamps`).addEventListener(`input`,x),d(`clearLayer`).addEventListener(`click`,()=>y.clear()),d(`fitView`).addEventListener(`click`,()=>y.fitView()),d(`zoomIn`).addEventListener(`click`,()=>y.zoomBy(1.35)),d(`zoomOut`).addEventListener(`click`,()=>y.zoomBy(1/1.35)),v.addEventListener(`change`,async()=>{let e=v.value;v.disabled=!0;try{await y.setLayerFormat(e)}catch{v.value=y.getStats().layerFormat}finally{v.disabled=!1}}),g.addEventListener(`click`,async()=>{g.disabled=!0,_.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await y.runBenchmark(f(`benchmarkStamps`));_.textContent=[`${p(e.baseStamps)} base stamps`,`${p(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){_.textContent=e instanceof Error?e.message:String(e)}finally{g.disabled=!1}});function C(e){d(`fpsStat`).textContent=`${e.fps}`,d(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,d(`stampStat`).textContent=p(e.totalBaseStamps),d(`avoidedStat`).textContent=p(e.avoidedLogicalDraws),d(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,d(`gpuStat`).textContent=e.gpuLabel}function w(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function T(e){return{clientX:e.clientX,clientY:e.clientY,pressure:w(e)}}var E=null,D=null,O=0,k=0;m.addEventListener(`pointerdown`,e=>{E===null&&(e.preventDefault(),E=e.pointerId,D=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,m.setPointerCapture(e.pointerId),D===`pan`?(m.classList.add(`panning`),O=e.clientX,k=e.clientY):y.beginStroke(T(e)))}),m.addEventListener(`pointermove`,e=>{if(e.pointerId!==E||D===null)return;if(e.preventDefault(),D===`pan`){y.panByClientDelta(e.clientX-O,e.clientY-k),O=e.clientX,k=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=(t.length>0?t:[e]).map(T);y.extendStroke(n)});function A(e){e.pointerId===E&&(D===`paint`&&y.endStroke(),m.classList.remove(`panning`),D=null,E=null)}m.addEventListener(`pointerup`,A),m.addEventListener(`pointercancel`,A),m.addEventListener(`lostpointercapture`,A),m.addEventListener(`contextmenu`,e=>e.preventDefault()),m.addEventListener(`wheel`,e=>{e.preventDefault();let t=Math.exp(-e.deltaY*.0015);y.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>y.resizeCanvas()).observe(m),x(),y.setBrushSettings(b()),y.initialize().catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;h.textContent=`${e instanceof Error?e.message:String(e)}${t}`,h.className=`status error`,g.disabled=!0}),window.setInterval(()=>C(y.getStats()),500);