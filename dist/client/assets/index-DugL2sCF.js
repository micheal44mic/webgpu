(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=new Uint8Array([137,80,78,71,13,10,26,10]),r=13;function i(e,t){return String.fromCharCode(e[t],e[t+1],e[t+2],e[t+3])}function a(e,t,n){let r=e+t-n,i=Math.abs(r-e),a=Math.abs(r-t),o=Math.abs(r-n);return i<=a&&i<=o?e:a<=o?t:n}function o(e,t,n){let r=t+1,i=r*n;if(e.byteLength!==i)throw Error(`Dati PNG decompressi non validi: attesi ${i} byte, trovati ${e.byteLength}.`);let o=new Uint8Array(t*n);for(let i=0;i<n;i+=1){let n=i*r,s=i*t,c=e[n];if(c>4)throw Error(`Filtro PNG non supportato: ${c}.`);for(let r=0;r<t;r+=1){let l=e[n+1+r],u=r>0?o[s+r-1]:0,d=i>0?o[s-t+r]:0,f=r>0&&i>0?o[s-t+r-1]:0,p=0;c===1?p=u:c===2?p=d:c===3?p=Math.floor((u+d)*.5):c===4&&(p=a(u,d,f)),o[s+r]=l+p&255}}return o}async function s(e){let t=new Uint8Array(e);if(t.byteLength<n.byteLength+12)throw Error(`PNG troppo corta.`);for(let e=0;e<n.byteLength;e+=1)if(t[e]!==n[e])throw Error(`Firma PNG non valida.`);let a=new DataView(e),s=[],c=0,l=0,u=0,d=!1,f=!1,p=n.byteLength;for(;p+12<=t.byteLength;){let e=a.getUint32(p,!1),n=p+4,o=p+8,m=o+e,h=m+4;if(m<o||h>t.byteLength)throw Error(`Chunk PNG oltre la fine del file.`);let g=i(t,n);if(g===`IHDR`){if(d||e!==r)throw Error(`Header PNG non valido.`);l=a.getUint32(o,!1),u=a.getUint32(o+4,!1);let n=t[o+8],i=t[o+9],s=t[o+10],c=t[o+11],f=t[o+12];if(l<=0||u<=0)throw Error(`Dimensioni PNG non valide.`);if(n!==8||i!==0||s!==0||c!==0||f!==0)throw Error(`La Shape richiede una PNG grayscale 8-bit, non interlacciata e con compressione standard.`);d=!0}else if(g===`IDAT`){if(!d||f)throw Error(`Ordine dei chunk PNG non valido.`);let e=t.slice(o,m);s.push(e),c+=e.byteLength}else if(g===`IEND`){f=!0;break}p=h}if(!d||!f||s.length===0)throw Error(`PNG incompleta.`);let m=new Uint8Array(c),h=0;for(let e of s)m.set(e,h),h+=e.byteLength;if(typeof DecompressionStream>`u`)throw Error(`DecompressionStream non disponibile.`);let g=new Blob([m]).stream().pipeThrough(new DecompressionStream(`deflate`)),_=new Uint8Array(await new Response(g).arrayBuffer());return{width:l,height:u,pixels:o(_,l,u)}}var c=`dry-blend-continuous-core-v1-pressure-inert`,l=.06,u=2.5,d=1/256,f=Object.freeze({size:64,strength:1,spacing:.15,flow:1,stretch:.18,paint:.14,aspect:1,angle:0,orientToStroke:!0,seed:1}),p=(e,t,n)=>Math.max(t,Math.min(n,e)),m=(e,t)=>{let n=Number(e);if(!Number.isFinite(n))throw TypeError(`${t} deve essere finito`);return n},h=(e,t)=>{let n=m(e,t);if(!(n>0))throw RangeError(`${t} deve essere > 0`);return n},g=(e,t)=>{let n=m(e,t);if(n<0||n>1)throw RangeError(`${t} deve stare fra 0 e 1`);return n},_=(e,t)=>{let n=Math.trunc(m(e,t));if(n<1)throw RangeError(`${t} deve essere >= 1`);return n},v=e=>Math.fround(e),y=(e,t,n)=>e+(t-e)*n;function b(e={}){if(!e||typeof e!=`object`)throw TypeError(`controlli Blend dry non validi`);return Object.freeze({size:p(h(e.size??f.size,`size`),1,1024),strength:g(e.strength??f.strength,`strength`),spacing:p(h(e.spacing??f.spacing,`spacing`),.01,4),flow:g(e.flow??f.flow,`flow`),stretch:g(e.stretch??f.stretch,`stretch`),paint:g(e.paint??f.paint,`paint`),aspect:p(h(e.aspect??f.aspect,`aspect`),.05,20),angle:m(e.angle??f.angle,`angle`),orientToStroke:!!(e.orientToStroke??f.orientToStroke),seed:Math.trunc(m(e.seed??f.seed,`seed`))>>>0})}function x(e=f.stretch){return Math.sqrt(g(e,`stretch`))}function S(e=f.paint){let t=g(e,`paint`);return t*t}function C(e){if(!e||typeof e!=`object`)throw TypeError(`campione Blend dry non valido`);return{x:Math.round(m(e.x,`sample.x`)*256)/256,y:Math.round(m(e.y,`sample.y`)*256)/256,timeMs:Math.round(m(e.timeMs??e.timeStamp??0,`sample.timeMs`)),pressure:1}}function w(e){return p(h(e,`diameter`)*l,u,48)}function T(){return{fromX:0,fromY:0,toX:0,toY:0,dirX:0,dirY:0,distance:0,fromDiameter:0,toDiameter:0,diameter:0,fromHalfWidth:0,fromHalfHeight:0,toHalfWidth:0,toHalfHeight:0,fromAngle:0,toAngle:0,angle:0,warpStrength:0,flow:1,spacing:.15,arcStart:0,arcEnd:0,speed:0,minX:0,minY:0,maxX:0,maxY:0,maxHalo:0}}function E(e){return{...e}}function D(e,t){return e.x=t.x,e.y=t.y,e.timeMs=t.timeMs,e}function O(e,t,n,r){return e.x=v(y(t.x,n.x,r)),e.y=v(y(t.y,n.y,r)),e.timeMs=y(t.timeMs,n.timeMs,r),e}function k(e,t,n,r,i){return e.x=t,e.y=n,e.width=r,e.height=i,e}function A(e,t,n,r,i){if(t.width<=0||t.height<=0)return 0;let a=Math.ceil(n/i),o=Math.ceil(r/i),s=Math.floor(t.x/i),c=Math.floor(t.y/i),l=Math.ceil((t.x+t.width)/i),u=Math.ceil((t.y+t.height)/i),d=0;for(let t=c;t<u;t+=1)for(let n=s;n<l;n+=1)n>=0&&t>=0&&n<a&&t<o&&(e[d]=t*a+n,d+=1);return d}function ee(e){let t=1/0,n=1/0,r=-1/0,i=-1/0;for(let a=0;a<5;a+=1){let o=a*.25,s=y(e.fromX,e.toX,o),c=y(e.fromY,e.toY,o),l=y(e.fromHalfWidth,e.toHalfWidth,o),u=y(e.fromHalfHeight,e.toHalfHeight,o),d=y(e.fromAngle,e.toAngle,o),f=Math.abs(Math.cos(d)),p=Math.abs(Math.sin(d)),m=f*l+p*u+2,h=p*l+f*u+2;t=Math.min(t,Math.floor(s-m)),n=Math.min(n,Math.floor(c-h)),r=Math.max(r,Math.ceil(s+m)),i=Math.max(i,Math.ceil(c+h))}e.minX=t,e.minY=n,e.maxX=r,e.maxY=i}function te(e){let t={x:0,y:0,width:0,height:0};return{build:c,generation:0,stepCount:1,steps:[T()],empty:!0,maxHalo:0,readRect:{x:0,y:0,width:0,height:0},writeRect:t,localWriteRect:{x:0,y:0,width:0,height:0},clippedReadRect:{x:0,y:0,width:0,height:0},dirtyRect:t,readTiles:new Uint32Array(e),writeTiles:new Uint32Array(e),readTileCount:0,writeTileCount:0}}function ne(e,t,n,r,i,a){let o=p(t.minX,0,n),s=p(t.minY,0,r),c=p(t.maxX,0,n),l=p(t.maxY,0,r),u=t.maxHalo;if(k(e.writeRect,o,s,Math.max(0,c-o),Math.max(0,l-s)),k(e.readRect,o-u,s-u,Math.max(0,c-o)+u*2,Math.max(0,l-s)+u*2),e.readRect.width>a||e.readRect.height>a)throw RangeError(`segmento Blend dry ${e.readRect.width}x${e.readRect.height} oltre scratch ${a}`);k(e.localWriteRect,u,u,e.writeRect.width,e.writeRect.height);let d=p(e.readRect.x,0,n),f=p(e.readRect.y,0,r),m=p(e.readRect.x+e.readRect.width,0,n),h=p(e.readRect.y+e.readRect.height,0,r);k(e.clippedReadRect,d,f,Math.max(0,m-d),Math.max(0,h-f)),e.writeTileCount=A(e.writeTiles,e.writeRect,n,r,i),e.readTileCount=A(e.readTiles,e.clippedReadRect,n,r,i),e.maxHalo=u,e.empty=e.writeRect.width<=0||e.writeRect.height<=0,e.dirtyRect=e.writeRect}function j(e={},t={}){let n=b(e),r=_(t.documentWidth??4096,`documentWidth`),i=_(t.documentHeight??4096,`documentHeight`),a=_(t.tileSize??256,`tileSize`),o=_(t.scratchSize??1664,`scratchSize`),s=_(t.maxSteps??8192,`maxSteps`),l=Math.ceil(r/a)*Math.ceil(i/a),u=Array.from({length:s},T),f=te(l),p={x:0,y:0,timeMs:0,pressure:1},m={x:0,y:0,timeMs:0,pressure:1},h={x:0,y:0,timeMs:0,pressure:1},g=!1,y=!1,x=!1,S=0,k=0,A=0,j=0,M=0,re=()=>({steps:A,stepFree:s-A}),N=(e,t)=>({accepted:!0,steps:e,stationary:t,reason:null,requiredSteps:0,capacity:null}),ie=e=>({accepted:!1,steps:0,stationary:!1,reason:`capacity`,requiredSteps:e,capacity:re()}),ae=()=>(g=!1,y=!1,x=!1,S=0,k=0,A=0,j=0,M=0,!0),oe=(e={})=>{if(A>0)throw Error(`configure Blend dry richiede una coda vuota`);return n=b(e),ae(),n},se=e=>(ae(),D(p,C(e)),g=!0,{...p}),ce=(e,t)=>{let r=u[k],i=t.x-e.x,a=t.y-e.y,o=Math.hypot(i,a),c=i/o,l=a/o,d=n.size,f=n.size,p=n.size,m=Math.atan2(l,c),h=n.angle+(n.orientToStroke?m:0),g=Math.max(.001,(t.timeMs-e.timeMs)/1e3);Object.assign(r,T(),{fromX:e.x,fromY:e.y,toX:t.x,toY:t.y,dirX:v(c),dirY:v(l),distance:v(o),fromDiameter:v(d),toDiameter:v(f),diameter:v(p),fromHalfWidth:v(d*.5),fromHalfHeight:v(d*.5*n.aspect),toHalfWidth:v(f*.5),toHalfHeight:v(f*.5*n.aspect),fromAngle:v(h),toAngle:v(h),angle:v(h),warpStrength:v(n.strength),flow:v(n.flow),spacing:v(n.spacing),arcStart:v(M),arcEnd:v(M+o),speed:v(o/g)}),r.maxHalo=Math.ceil(o*r.warpStrength)+2,ee(r),M+=o,k=(k+1)%s,A+=1,x=!0},le=e=>{if(!g)throw Error(`planner Blend dry non inizializzato: chiamare reset(down)`);if(y)throw Error(`planner Blend dry gia finalizzato`);let t=C(e),r=t.x-p.x,i=t.y-p.y,a=Math.hypot(r,i);if(a<d)return D(p,t),N(0,!0);let o=Math.max(1,Math.ceil(a/w(n.size)));if(o>s-A)return ie(o);D(m,p);for(let e=1;e<=o;e+=1)O(h,p,t,e/o),ce(m,h),D(m,h);return D(p,t),N(o,!1)};return{build:c,get controls(){return n},configure:oe,reset:se,discardPending:ae,pushSample:le,pushSamples:e=>{let t=0;for(let n of e){let e=le(n);if(!e.accepted)return{...e,steps:t};t+=e.steps}return N(t,!1)},finish:()=>{if(!g)throw Error(`planner Blend dry non inizializzato: chiamare reset(down)`);return y||=!0,N(0,!x)},buildNextBatch:()=>{if(A===0)return null;let e=u[S],t=f.steps[0];return Object.assign(t,e),f.generation=++j,ne(f,t,r,i,a,o),S=(S+1)%s,--A,f},snapshotSteps:()=>{let e=[];for(let t=0;t<A;t+=1)e.push(E(u[(S+t)%s]));return e},capacity:re,sampleMovesFromLast:e=>{if(!g)return!0;let t=C(e);return t.x!==p.x||t.y!==p.y},pendingSteps:()=>A,lastSample:()=>g?{...p}:null,memoryLedger:()=>{let e=s*Object.keys(T()).length*8,t=f.readTiles.byteLength+f.writeTiles.byteLength;return{stepCapacity:s,stepBytes:e,batchBytes:t,totalBytes:e+t}}}}var M=`
struct BlendUniforms {
  documentAndRoi: vec4<f32>,
  validAndFrom: vec4<f32>,
  toAndFromHalfSize: vec4<f32>,
  toHalfSizeAndAngles: vec4<f32>,
  maskControls: vec4<f32>,
  transportControls: vec4<f32>,
  grainControls: vec4<f32>,
  grainAffineAndPhase: vec4<f32>,
  paintColor: vec4<f32>,
  options: vec4<u32>,
};

@group(0) @binding(0) var<uniform> blend: BlendUniforms;

fn documentSize() -> vec2<i32> {
  return vec2<i32>(blend.documentAndRoi.xy);
}

fn roiOrigin() -> vec2<i32> {
  return vec2<i32>(blend.documentAndRoi.zw);
}

fn validSize() -> vec2<i32> {
  return vec2<i32>(blend.validAndFrom.xy);
}

@vertex
fn fullscreenVertex(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}
`,re=`
${M}

@group(0) @binding(1) var canonicalLayer: texture_2d<f32>;

@fragment
fn gatherFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = roiOrigin() + vec2<i32>(fragmentPosition.xy);
  if (
    any(documentPixel < vec2<i32>(0))
    || any(documentPixel >= documentSize())
  ) {
    return vec4<f32>(0.0);
  }

  // The target engine already stores authoritative premultiplied linear RGBA.
  // The source WebGL renderer's sRGB conversions must not be repeated here.
  let value = textureLoad(canonicalLayer, documentPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`,N=`
${M}

const GRAIN_MIP_LEVEL_COUNT: u32 = 12u;

struct MaskOutput {
  @location(0) stepCoverage: f32,
  @location(1) unionCoverage: f32,
};

struct LocalSample {
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

struct CustomSample {
  coverage: f32,
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

@group(0) @binding(1) var shapeTexture: texture_2d<f32>;
@group(0) @binding(2) var shapeSampler: sampler;
@group(0) @binding(3) var grainTexture: texture_2d<f32>;
@group(0) @binding(4) var grainSampler: sampler;

fn localAt(documentPosition: vec2<f32>, interpolation: f32) -> LocalSample {
  let center = mix(blend.validAndFrom.zw, blend.toAndFromHalfSize.xy, interpolation);
  let halfSize = max(
    mix(blend.toAndFromHalfSize.zw, blend.toHalfSizeAndAngles.xy, interpolation),
    vec2<f32>(0.001)
  );
  let angle = mix(
    blend.toHalfSizeAndAngles.z,
    blend.toHalfSizeAndAngles.w,
    interpolation
  );
  let cosine = cos(angle);
  let sine = sin(angle);
  let delta = documentPosition - center;
  let local = vec2<f32>(
    cosine * delta.x + sine * delta.y,
    -sine * delta.x + cosine * delta.y
  );

  var result: LocalSample;
  result.uv = vec2<f32>(
    local.x / (2.0 * halfSize.x) + 0.5,
    local.y / (2.0 * halfSize.y) + 0.5
  );
  result.brushPixels = local;
  return result;
}

fn customAt(documentPosition: vec2<f32>, interpolation: f32) -> CustomSample {
  let local = localAt(documentPosition, interpolation);
  var result: CustomSample;
  result.uv = local.uv;
  result.brushPixels = local.brushPixels;
  if (
    any(local.uv < vec2<f32>(0.0))
    || any(local.uv > vec2<f32>(1.0))
  ) {
    result.coverage = 0.0;
    return result;
  }
  result.coverage = textureSampleLevel(shapeTexture, shapeSampler, local.uv, 0.0).r;
  return result;
}

fn adjustedGrainCoverage(grainUv: vec2<f32>) -> f32 {
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  var sourceSample: vec4<f32>;
  if (blend.options.z == 0u) {
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

  let source = dot(sourceSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let adjusted = clamp(
    (source - 0.5) * blend.grainAffineAndPhase.x
      + 0.5
      + blend.grainControls.w,
    0.0,
    1.0
  );
  return mix(1.0, adjusted, clamp(blend.grainControls.z, 0.0, 1.0));
}

@fragment
fn maskFragment(@builtin(position) fragmentPosition: vec4<f32>) -> MaskOutput {
  let documentPosition = blend.documentAndRoi.zw + fragmentPosition.xy;
  let segment = blend.toAndFromHalfSize.xy - blend.validAndFrom.zw;
  let denominator = max(dot(segment, segment), 0.00000001);
  let closest = clamp(
    dot(documentPosition - blend.validAndFrom.zw, segment) / denominator,
    0.0,
    1.0
  );

  var coverage = 0.0;
  var bestInterpolation = closest;
  var bestLocal = localAt(documentPosition, closest);

  if (blend.options.x == 0u) {
    let halfSize = max(
      mix(blend.toAndFromHalfSize.zw, blend.toHalfSizeAndAngles.xy, closest),
      vec2<f32>(0.001)
    );
    let center = mix(blend.validAndFrom.zw, blend.toAndFromHalfSize.xy, closest);
    let radius = max(0.001, min(halfSize.x, halfSize.y));
    let normalizedRadius = length(documentPosition - center) / radius;
    let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;
    let antialiasWidth = max(
      fwidth(normalizedRadius) * 1.35,
      0.55 / max(radius, 1.0)
    );
    coverage = 1.0 - smoothstep(
      core - antialiasWidth,
      1.0 + antialiasWidth,
      normalizedRadius
    );
  } else {
    var selected = customAt(documentPosition, closest);
    coverage = selected.coverage;
    bestLocal.uv = selected.uv;
    bestLocal.brushPixels = selected.brushPixels;

    for (var index = 0u; index <= 32u; index += 1u) {
      let interpolation = f32(index) / 32.0;
      let candidate = customAt(documentPosition, interpolation);
      if (candidate.coverage > coverage) {
        coverage = candidate.coverage;
        bestInterpolation = interpolation;
        bestLocal.uv = candidate.uv;
        bestLocal.brushPixels = candidate.brushPixels;
      }
    }
  }

  let spacing = blend.maskControls.z;
  if (spacing > 1.0) {
    let period = max(1.0, blend.transportControls.y * spacing);
    let support = max(0.5, blend.transportControls.y * 0.5);
    let arcPosition = blend.maskControls.w
      + bestInterpolation * blend.transportControls.x;
    let phase = abs(
      ((arcPosition + period * 0.5) % period) - period * 0.5
    );
    let antialiasWidth = max(fwidth(arcPosition), 0.5);
    coverage *= 1.0 - smoothstep(
      support - antialiasWidth,
      support + antialiasWidth,
      phase
    );
  }

  var grainCoverage = 1.0;
  if (blend.options.y != 0u) {
    var grainUv: vec2<f32>;
    if (blend.options.y == 2u) {
      // Moving maps one complete grain image to the selected brush footprint.
      grainUv = bestLocal.uv;
    } else {
      // Fixed is anchored to authoritative top-left layer coordinates.
      grainUv = documentPosition * blend.grainControls.x;
    }
    grainCoverage = adjustedGrainCoverage(grainUv);
  }

  let documentPixel = vec2<i32>(floor(documentPosition));
  var finalCoverage = 0.0;
  if (
    all(documentPixel >= vec2<i32>(0))
    && all(documentPixel < documentSize())
  ) {
    finalCoverage = clamp(
      coverage * grainCoverage * blend.maskControls.y,
      0.0,
      1.0
    );
  }

  var output: MaskOutput;
  output.stepCoverage = finalCoverage;
  output.unionCoverage = finalCoverage;
  return output;
}
`,ie=`
@group(0) @binding(1) var stateTexture: texture_2d<f32>;

fn cleanState(pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= validSize())
  ) {
    return vec4<f32>(0.0);
  }
  let value = textureLoad(stateTexture, pixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}

fn sampleState(center: vec2<f32>) -> vec4<f32> {
  let samplePosition = center - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(samplePosition));
  let interpolation = fract(samplePosition);
  return mix(
    mix(cleanState(lower), cleanState(lower + vec2<i32>(1, 0)), interpolation.x),
    mix(
      cleanState(lower + vec2<i32>(0, 1)),
      cleanState(lower + vec2<i32>(1, 1)),
      interpolation.x
    ),
    interpolation.y
  );
}
`,ae=`
${M}
${ie}

@group(0) @binding(2) var previousCarrier: texture_2d<f32>;

@fragment
fn pickupFragment() -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  var total = 0.0;
  let angle = blend.toHalfSizeAndAngles.z;
  let cosine = cos(angle);
  let sine = sin(angle);
  let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;

  for (var y = 0u; y < 8u; y += 1u) {
    for (var x = 0u; x < 8u; x += 1u) {
      let uv = (vec2<f32>(f32(x), f32(y)) + vec2<f32>(0.5)) / 8.0;
      let normalized = uv * 2.0 - vec2<f32>(1.0);
      let radius = length(normalized);
      let weight = 1.0 - smoothstep(core, 1.0, radius);
      if (weight > 0.0) {
        let local = normalized * blend.toAndFromHalfSize.zw;
        let documentPosition = blend.validAndFrom.zw + vec2<f32>(
          cosine * local.x - sine * local.y,
          sine * local.x + cosine * local.y
        );
        if (
          all(documentPosition >= vec2<f32>(0.0))
          && all(documentPosition < blend.documentAndRoi.xy)
        ) {
          // Outside the authoritative document is not transparent pigment.
          // Clamp only the bilinear lookup so a valid edge tap cannot mix with
          // the zero-filled scratch texels that surround the document.
          let sampleDocumentPosition = clamp(
            documentPosition,
            vec2<f32>(0.5),
            blend.documentAndRoi.xy - vec2<f32>(0.5)
          );
          sum += sampleState(
            sampleDocumentPosition - blend.documentAndRoi.zw
          ) * weight;
          total += weight;
        }
      }
    }
  }

  let hasPickup = total > 0.0;
  var pigment = sum / max(total, 0.000001);
  if (blend.options.w != 0u) {
    let previous = textureLoad(previousCarrier, vec2<i32>(0), 0);
    if (hasPickup) {
      pigment = mix(
        pigment,
        previous,
        clamp(blend.transportControls.w, 0.0, 1.0)
      );
    } else {
      // A completely off-canvas step transports the carrier unchanged.
      pigment = previous;
    }
  }

  let alpha = clamp(pigment.a, 0.0, 1.0);
  return vec4<f32>(
    clamp(pigment.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
  );
}
`,oe=`
${M}
${ie}

@group(0) @binding(2) var stepMask: texture_2d<f32>;
@group(0) @binding(3) var carrierTexture: texture_2d<f32>;

@fragment
fn depositFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(fragmentPosition.xy);
  let canvas = cleanState(pixel);
  let coverage = clamp(
    textureLoad(stepMask, pixel, 0).r * blend.transportControls.z,
    0.0,
    1.0
  );
  if (coverage <= 0.0) {
    return canvas;
  }

  let carrier = textureLoad(carrierTexture, vec2<i32>(0), 0);
  let loaded = vec4<f32>(clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  let pigment = mix(
    carrier,
    loaded,
    clamp(blend.grainControls.y, 0.0, 1.0)
  );
  let mixed = mix(canvas, pigment, coverage);
  let resultAlpha = clamp(mixed.a, 0.0, 1.0);
  let result = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
    resultAlpha
  );
  if (resultAlpha <= blend.grainAffineAndPhase.w) {
    return vec4<f32>(0.0);
  }
  return result;
}
`,se=`
${M}

@group(0) @binding(1) var resolvedState: texture_2d<f32>;
@group(0) @binding(2) var unionMask: texture_2d<f32>;

@fragment
fn scatterFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = vec2<i32>(fragmentPosition.xy);
  let localPixel = documentPixel - roiOrigin();
  if (
    any(localPixel < vec2<i32>(0))
    || any(localPixel >= validSize())
    || textureLoad(unionMask, localPixel, 0).r <= 0.0
  ) {
    discard;
  }

  let value = textureLoad(resolvedState, localPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`,ce=160,le=64,P=`rgba16float`,ue=`r8unorm`,de=`dry-blend-webgpu-v2-border-safe-pickup`;function fe(e,t,n){return Math.min(n,Math.max(t,e))}function pe(e,t){if(!e)return{...t};let n=Math.min(e.x,t.x),r=Math.min(e.y,t.y),i=Math.max(e.x+e.width,t.x+t.width),a=Math.max(e.y+e.height,t.y+t.height);return{x:n,y:r,width:i-n,height:a-r}}function me(e){let t=fe(e,0,1);return t<=.04045?t/12.92:((t+.055)/1.055)**2.4}function he(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX Blend non valido: ${e}`);return[me(Number.parseInt(t.slice(0,2),16)/255),me(Number.parseInt(t.slice(2,4),16)/255),me(Number.parseInt(t.slice(4,6),16)/255)]}function ge(e){return{x:e.x,y:e.y,width:e.width,height:e.height}}function _e(e){return{build:e.build,stepCount:1,steps:[{...e.steps[0]}],empty:e.empty,readRect:ge(e.readRect),writeRect:ge(e.writeRect)}}async function ve(e){let t=(await Promise.all(e.map(async({label:e,module:t})=>({label:e,messages:(await t.getCompilationInfo()).messages})))).flatMap(({label:e,messages:t})=>[...t].filter(e=>e.type===`error`).map(t=>`${e}:${t.lineNum}:${t.linePos} ${t.message}`));if(t.length>0)throw Error(`Shader Blend WGSL non valido:\n${t.join(`
`)}`)}var ye=class e{static async create(t){let n=new e(t);try{return await n.initialize(),n}catch(e){throw n.destroy(),e}}build=de;maximumBatchesPerSubmit=le;device;documentWidth;documentHeight;layerFormat;layerView;layerSamplingView;shapeMaskView;shapeMaskSampler;grainTextureView;grainSamplers;scratchSize;uniformStride;uniformUpload;uniformBuffer;gatherBindGroupLayout;maskBindGroupLayout;pickupBindGroupLayout;depositBindGroupLayout;scatterBindGroupLayout;gatherPipeline;maskPipeline;pickupPipeline;depositPipeline;scatterPipeline;scratch=null;activeHistoryActionId=null;carrierIndex=0;carrierValid=!1;destroyed=!1;constructor(e){this.device=e.device,this.documentWidth=e.documentWidth,this.documentHeight=e.documentHeight,this.layerFormat=e.layerFormat,this.layerView=e.layerView,this.layerSamplingView=e.layerSamplingView,this.shapeMaskView=e.shapeMaskView,this.shapeMaskSampler=e.shapeMaskSampler,this.grainTextureView=e.grainTextureView,this.grainSamplers=e.grainSamplers,this.scratchSize=e.scratchSize??1664,this.uniformStride=Math.ceil(ce/this.device.limits.minUniformBufferOffsetAlignment)*this.device.limits.minUniformBufferOffsetAlignment,this.uniformUpload=new ArrayBuffer(this.uniformStride*le),this.uniformBuffer=this.device.createBuffer({label:`Blend dry dynamic uniforms`,size:this.uniformUpload.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}async initialize(){let e={binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:ce}},t=e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`,multisampled:!1}}),n=e=>({binding:e,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}});this.gatherBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry gather bind group layout`,entries:[e,t(1)]}),this.maskBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry mask bind group layout`,entries:[e,t(1),n(2),t(3),n(4)]}),this.pickupBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry pickup bind group layout`,entries:[e,t(1),t(2)]}),this.depositBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry deposit bind group layout`,entries:[e,t(1),t(2),t(3)]}),this.scatterBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry scatter bind group layout`,entries:[e,t(1),t(2)]});let r=[{label:`Blend gather`,module:this.device.createShaderModule({label:`Blend gather WGSL`,code:re})},{label:`Blend mask`,module:this.device.createShaderModule({label:`Blend mask WGSL`,code:N})},{label:`Blend pickup`,module:this.device.createShaderModule({label:`Blend pickup WGSL`,code:ae})},{label:`Blend deposit`,module:this.device.createShaderModule({label:`Blend deposit WGSL`,code:oe})},{label:`Blend scatter`,module:this.device.createShaderModule({label:`Blend scatter WGSL`,code:se})}];await ve(r);let i=(e,t)=>this.device.createPipelineLayout({label:e,bindGroupLayouts:[t]}),a=(e,t,n,r,a)=>this.device.createRenderPipeline({label:e,layout:i(`${e} pipeline layout`,t),vertex:{module:n,entryPoint:`fullscreenVertex`},fragment:{module:n,entryPoint:r,targets:a},primitive:{topology:`triangle-list`}});this.device.pushErrorScope(`validation`),this.gatherPipeline=a(`Blend dry gather`,this.gatherBindGroupLayout,r[0].module,`gatherFragment`,[{format:P}]),this.maskPipeline=a(`Blend dry continuous sweep mask`,this.maskBindGroupLayout,r[1].module,`maskFragment`,[{format:ue},{format:ue}]),this.pickupPipeline=a(`Blend dry weighted pickup`,this.pickupBindGroupLayout,r[2].module,`pickupFragment`,[{format:P}]),this.depositPipeline=a(`Blend dry pigment deposit`,this.depositBindGroupLayout,r[3].module,`depositFragment`,[{format:P}]),this.scatterPipeline=a(`Blend dry scatter to canonical layer`,this.scatterBindGroupLayout,r[4].module,`scatterFragment`,[{format:this.layerFormat}]);let o=await this.device.popErrorScope();if(o)throw Error(`Pipeline Blend WebGPU non valida: ${o.message}`)}beginStroke(e){this.assertAlive(),this.activeHistoryActionId=e,this.carrierIndex=0,this.carrierValid=!1}submit(e,t,n,r){if(this.assertAlive(),e.length>le)throw RangeError(`Blend dry accetta al massimo ${le} batch per submit.`);this.activeHistoryActionId!==n&&this.beginStroke(n);let i=performance.now(),a=this.ensureScratchResources(),o=e.filter(e=>!e.empty);for(let e of o)this.validateBatch(e);this.populateUniforms(o,t),o.length>0&&this.device.queue.writeBuffer(this.uniformBuffer,0,this.uniformUpload,0,o.length*this.uniformStride);let s=this.device.createCommandEncoder({label:`Blend dry frame encoder`}),c=0,l=null;r&&(s.beginRenderPass({label:`Blend dry clear canonical layer`,colorAttachments:[{view:this.layerView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),c+=1);for(let e=0;e<o.length;e+=1){let n=o[e],r=e*this.uniformStride,i=n.readRect.width,u=n.readRect.height,d=s.beginRenderPass({label:`Blend dry gather ROI`,colorAttachments:[{view:a.stateViews[0],loadOp:`load`,storeOp:`store`}]});d.setPipeline(this.gatherPipeline),d.setBindGroup(0,a.gatherBindGroup,[r]),d.setScissorRect(0,0,i,u),d.draw(3),d.end();let f=t.grainMode===`moving`?`moving`:`fixed`,p=s.beginRenderPass({label:`Blend dry continuous sweep mask`,colorAttachments:[{view:a.stepMaskView,loadOp:`load`,storeOp:`store`},{view:a.unionMaskView,loadOp:`load`,storeOp:`store`}]});p.setPipeline(this.maskPipeline),p.setBindGroup(0,a.maskBindGroups[f][t.grainFiltering],[r]),p.setScissorRect(0,0,i,u),p.draw(3),p.end();let m=+(this.carrierIndex===0),h=s.beginRenderPass({label:`Blend dry 8x8 weighted pigment pickup`,colorAttachments:[{view:a.carrierViews[m],loadOp:`load`,storeOp:`store`}]});h.setPipeline(this.pickupPipeline),h.setBindGroup(0,a.pickupBindGroups[m],[r]),h.setScissorRect(0,0,1,1),h.draw(3),h.end(),this.carrierIndex=m,this.carrierValid=!0;let g=s.beginRenderPass({label:`Blend dry carried pigment deposit`,colorAttachments:[{view:a.stateViews[1],loadOp:`load`,storeOp:`store`}]});g.setPipeline(this.depositPipeline),g.setBindGroup(0,a.depositBindGroups[this.carrierIndex],[r]),g.setScissorRect(0,0,i,u),g.draw(3),g.end();let _=s.beginRenderPass({label:`Blend dry scatter ROI to canonical layer`,colorAttachments:[{view:this.layerView,loadOp:`load`,storeOp:`store`}]});_.setPipeline(this.scatterPipeline),_.setBindGroup(0,a.scatterBindGroup,[r]),_.setScissorRect(n.writeRect.x,n.writeRect.y,n.writeRect.width,n.writeRect.height),_.draw(3),_.end(),c+=5,l=pe(l,n.writeRect)}return(r||o.length>0)&&this.device.queue.submit([s.finish()]),{dirtyRect:l,batchCount:o.length,passCount:c,scratchAllocated:this.scratch!==null,cpuMs:performance.now()-i}}memoryMiB(){if(!this.scratch)return 0;let e=this.scratchSize*this.scratchSize;return(e*8*2+e*2+16+this.uniformUpload.byteLength)/(1024*1024)}destroy(){if(!this.destroyed&&(this.destroyed=!0,this.uniformBuffer.destroy(),this.scratch)){for(let e of this.scratch.stateTextures)e.destroy();this.scratch.stepMaskTexture.destroy(),this.scratch.unionMaskTexture.destroy();for(let e of this.scratch.carrierTextures)e.destroy();this.scratch=null}}assertAlive(){if(this.destroyed)throw Error(`Renderer Blend dry già distrutto.`)}validateBatch(e){if(e.build!==`dry-blend-continuous-core-v1-pressure-inert`||e.stepCount!==1)throw Error(`Batch Blend dry incompatibile.`);if(![e.readRect.x,e.readRect.y,e.readRect.width,e.readRect.height,e.writeRect.x,e.writeRect.y,e.writeRect.width,e.writeRect.height].every(Number.isFinite))throw TypeError(`Rettangolo Blend dry non valido.`);if(e.readRect.width<=0||e.readRect.height<=0||e.readRect.width>this.scratchSize||e.readRect.height>this.scratchSize)throw RangeError(`ROI Blend dry oltre lo scratch WebGPU.`);if(e.writeRect.x<0||e.writeRect.y<0||e.writeRect.width<=0||e.writeRect.height<=0||e.writeRect.x+e.writeRect.width>this.documentWidth||e.writeRect.y+e.writeRect.height>this.documentHeight)throw RangeError(`Dirty rect Blend dry fuori dal layer.`)}populateUniforms(e,t){let n=he(t.color),r=t.grainInvert?-1:1,i=fe(t.grainScale,.1,4),a=t.grainMode===`moving`?2:+(t.grainMode===`texturized`),o=t.grainFiltering===`no`?0:t.grainFiltering===`classic`?1:2;for(let s=0;s<e.length;s+=1){let c=e[s],l=c.steps[0],u=s*this.uniformStride,d=new Float32Array(this.uniformUpload,u,ce/4),f=new Uint32Array(this.uniformUpload,u,ce/4);d.fill(0),d[0]=this.documentWidth,d[1]=this.documentHeight,d[2]=c.readRect.x,d[3]=c.readRect.y,d[4]=c.readRect.width,d[5]=c.readRect.height,d[6]=l.fromX,d[7]=l.fromY,d[8]=l.toX,d[9]=l.toY,d[10]=l.fromHalfWidth,d[11]=l.fromHalfHeight,d[12]=l.toHalfWidth,d[13]=l.toHalfHeight,d[14]=l.fromAngle,d[15]=l.toAngle,d[16]=fe(t.hardness,0,1),d[17]=fe(l.flow,0,1),d[18]=l.spacing,d[19]=l.arcStart,d[20]=l.distance,d[21]=l.diameter,d[22]=fe(l.warpStrength,0,1),d[23]=x(t.blendStretch),d[24]=1/(2500*i),d[25]=S(t.blendPaint),d[26]=fe(t.grainDepth,0,1),d[27]=fe(t.grainBrightness,-1,1)*r,d[28]=(1+fe(t.grainContrast,-1,1))*r,d[31]=0,d[32]=n[0],d[33]=n[1],d[34]=n[2],d[35]=1,f[36]=+(t.shape===`shape`),f[37]=a,f[38]=o,f[39]=this.carrierValid||s>0?1:0}}ensureScratchResources(){if(this.scratch)return this.scratch;let e=e=>this.device.createTexture({label:e,size:{width:this.scratchSize,height:this.scratchSize,depthOrArrayLayers:1},format:P,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),t=e=>this.device.createTexture({label:e,size:{width:this.scratchSize,height:this.scratchSize,depthOrArrayLayers:1},format:ue,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),n=e=>this.device.createTexture({label:e,size:{width:1,height:1,depthOrArrayLayers:1},format:P,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),r=[e(`Blend dry scratch state A`),e(`Blend dry scratch state B`)],i=r.map(e=>e.createView()),a=t(`Blend dry step coverage`),o=t(`Blend dry union coverage`),s=a.createView(),c=o.createView(),l=[n(`Blend dry carrier A`),n(`Blend dry carrier B`)],u=l.map(e=>e.createView()),d={binding:0,resource:{buffer:this.uniformBuffer,offset:0,size:ce}},f=this.device.createBindGroup({label:`Blend dry gather bind group`,layout:this.gatherBindGroupLayout,entries:[d,{binding:1,resource:this.layerSamplingView}]}),p={fixed:{},moving:{}};for(let e of[`fixed`,`moving`])for(let t of[`no`,`classic`,`improved`])p[e][t]=this.device.createBindGroup({label:`Blend dry mask ${e} ${t}`,layout:this.maskBindGroupLayout,entries:[d,{binding:1,resource:this.shapeMaskView},{binding:2,resource:this.shapeMaskSampler},{binding:3,resource:this.grainTextureView},{binding:4,resource:this.grainSamplers[e][t]}]});let m=[0,1].map(e=>this.device.createBindGroup({label:`Blend dry pickup to carrier ${e}`,layout:this.pickupBindGroupLayout,entries:[d,{binding:1,resource:i[0]},{binding:2,resource:u[+(e===0)]}]})),h=[0,1].map(e=>this.device.createBindGroup({label:`Blend dry deposit from carrier ${e}`,layout:this.depositBindGroupLayout,entries:[d,{binding:1,resource:i[0]},{binding:2,resource:s},{binding:3,resource:u[e]}]})),g=this.device.createBindGroup({label:`Blend dry scatter bind group`,layout:this.scatterBindGroupLayout,entries:[d,{binding:1,resource:i[1]},{binding:2,resource:c}]});return this.scratch={stateTextures:r,stateViews:i,stepMaskTexture:a,stepMaskView:s,unionMaskTexture:o,unionMaskView:c,carrierTextures:l,carrierViews:u,gatherBindGroup:f,maskBindGroups:p,pickupBindGroups:m,depositBindGroups:h,scatterBindGroup:g},this.scratch}},be=`
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
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
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
  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  output.pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);
  return output;
}

fn paintAlpha(input: VertexOutput, coverage: f32) -> f32 {
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * brush.controls.z,
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
`,xe=`
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
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
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
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * brush.controls.z,
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
`,Se=`
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
`,Ce=`
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
`,we=`
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
`,Te=`
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
`,Ee=`
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
`,De=`
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
`,Oe=`
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
`,ke=`time-window-quadratic-ease-out-start-end-tail-holdback`;function Ae(e,t,n){return Math.min(n,Math.max(t,e))}function je(e){let t=1-Ae(e,0,1);return 1-t*t}function Me(e,t){let n=Ae(e,0,2),r=je(t/100);return n+(1-n)*r}function Ne(e,t,n){let r=Ae(e,0,2),i=Ae(t,0,2),a=je(n/100);return i+(r-i)*a}function Pe(e,t,n,r){return Math.max(0,e)*Ne(t,n,r)}function Fe(e){return Math.abs(Ae(e,0,2)-1)>2**-52*8}function Ie(e,t){return Math.abs(Ae(e,0,2)-1)<=2**-52*8&&!Fe(t)}var F=4096,I=Math.floor(Math.log2(F))+1,Le=32,Re=65536,ze=8,Be=4,Ve=`quad`,He=`generic-smoothstep`,Ue=`shape-alpha-mask-2k`,We=`coarse-occupancy-bitmask`,Ge=`legacy-full-mask`,Ke=`png-gray8-direct`,qe=`canvas-fallback`,Je=`reuse-position-copy-seed`,Ye=`directional-jitter-bounds`,Xe=`persistent-full-resolution-screen-cache`,Ze=`copy-texture-to-current-texture`,Qe=`live-dirty-box-filter-mip-chain`,$e=`largest-power-of-two-without-upscaling`,et=`per-stamp-uniform-alpha-multiplier`,tt=`disabled-legacy-pipeline`,nt=`rgba8-native-2500-fixed-coverage-multiply`,rt=`rgba8-native-2500-moving-coverage-multiply`,it=`authoritative-layer-position`,at=`stamp-local-position`,ot=`webgpu-wgsl-linear-full-chain`,st=`separate-opt-in-pipelines`,ct=`post-tip-coverage-pre-alpha-multiply`,lt=`disabled-semantic-mismatch-probe-spacing-active`,ut=`lazy-stroke-mip0-format-quantized-composite-mips-single-commit`,dt=`m1-r8-quantized-max-coverage-rgba-compat-single-commit`,ft=`disabled-semantic-mismatch`,pt=`queue-lag-canvas2d-tip-patch`,mt=`predictive-webgpu-tail-overlay`,ht=`single-sampled-queue-prefix-latency`,gt=`hide-confirmed-stale-bitmap-and-single-raf-retry`,_t=`iphone-desynchronized-others-synchronized-canvas2d`,vt=.5,yt=1.25,bt=.2,xt=2,St=256,Ct=F,wt=384,Tt=32,Et=32,Dt=3,Ot=.86,kt=12,At=4,jt=60,Mt=58,Nt=2,Pt=45,Ft=`queue-lag-step-up-per-stroke`,It=.25,Lt=1.5,Rt=4,zt=!1;function Bt(e){if(!e||typeof e.getContextAttributes!=`function`)return{alpha:null,desynchronized:null,colorSpace:null};let t=e.getContextAttributes();return{alpha:typeof t.alpha==`boolean`?t.alpha:null,desynchronized:typeof t.desynchronized==`boolean`?t.desynchronized:null,colorSpace:typeof t.colorSpace==`string`?t.colorSpace:null}}function Vt(){return navigator.platform===`iPhone`||/\biPhone\b/.test(navigator.userAgent)}function Ht(){return/\bAndroid\b/i.test(navigator.userAgent)?Rt:Lt}var Ut=`cpu-render-batch-journal`,Wt=`clear-and-stable-gpu-replay`,Gt=`shared-immutable-references`,L=2048,R=2500,Kt=Math.floor(Math.log2(R))+1,qt=Array.from({length:Kt},(e,t)=>{let n=Math.max(1,Math.floor(R/2**t));return n*n}).reduce((e,t)=>e+t,0),Jt=256,Yt=L/Jt,Xt=Jt*Jt,Zt=Xt/32,Qt=4,$t=5,en=128,tn=.5,nn=Zt*4,rn=96,an=32,on=48,sn=32,cn=32;function ln(e){return e===`light-glaze`||e===`m1-glaze`}function un(e){return e===`m1-glaze`?dt:ut}function dn(e){let t=e===`rgba16float`?8:4,n=0;for(let e=1;e<I;e+=1){let t=Math.max(1,F>>e);n+=t*t}return n*t/(1024*1024)}function fn(e){return(e===`rgba16float`?128:64)+dn(e)}function z(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function pn(e){let t=2166136261;for(let n=0;n<e.length;n+=1)t=Math.imul(t^e[n],16777619)>>>0;return t}function mn(e){return e.length===0?0:Math.max(...e)}function hn(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}function gn(e){let t=e>>>0;return t=(t^t>>>16)>>>0,t=Math.imul(t,2146121005)>>>0,t=(t^t>>>15)>>>0,t=Math.imul(t,2221713035)>>>0,t=(t^t>>>16)>>>0,t}function _n(e,t){return(gn((e^Math.imul(t,2654435769))>>>0)&16777215)/16777216}function vn(e,t,n){let r=(n%1+1)%1;return r<1/6?e+(t-e)*6*r:r<1/2?t:r<2/3?e+(t-e)*(2/3-r)*6:e}function yn(e,n,r){let i=(e%1+1)%1,a=t(n,0,1),o=t(r,0,1);if(a<=1e-5){let e=Math.round(o*255);return[e,e,e]}let s=o<.5?o*(1+a):o+a-o*a,c=2*o-s;return[Math.round(t(vn(c,s,i+1/3),0,1)*255),Math.round(t(vn(c,s,i),0,1)*255),Math.round(t(vn(c,s,i-1/3),0,1)*255)]}function bn(e){let n=t(e/255,0,1);return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}function xn(e){let t=new Uint32Array(Zt*$t),n=new Uint8Array(Xt),r=[],i=[];for(let a=0;a<$t;a+=1){let o=e[a],s=L>>a,c=1<<a;for(let e=0;e<s;e+=1)for(let t=0;t<s;t+=1){if(o[e*s+t]===0)continue;let r=Math.max(0,(t-.5)*c),i=Math.min(L,(t+1.5)*c),a=Math.max(0,(e-.5)*c),l=Math.min(L,(e+1.5)*c),u=Math.max(0,Math.floor(r/Yt)),d=Math.min(Jt-1,Math.ceil(i/Yt)-1),f=Math.max(0,Math.floor(a/Yt)),p=Math.min(Jt-1,Math.ceil(l/Yt)-1);for(let e=f;e<=p;e+=1){let t=e*Jt;for(let e=u;e<=d;e+=1)n[t+e]=1}}let l=0,u=a*Zt;for(let e=0;e<n.length;e+=1){if(n[e]===0)continue;l+=1;let r=u+(e>>>5);t[r]|=1<<(e&31)>>>0}r.push(l),i.push(l/Xt)}return{words:t,activeCells:r,coverageRatios:i}}var Sn={tool:`paint`,shape:`circle`,shapeScatter:0,grainMode:`off`,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,color:`#ff5b35`,size:96,spacingPercent:1,startThickness:1,endThickness:1,count:24,flow:.07,opacity:1,hardness:.88,blendIntensity:1,blendMode:`normal`,blendStretch:.18,blendPaint:.14,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1},Cn=class{layerSize=F;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;layerSamplingView;blendRenderer=null;paintMipViews=[];paintMipDownsampleBindGroups=[];paintDisplayMipValidThroughLevel=0;paintDisplaySelectedMipLevel=0;presentationCacheTexture=null;presentationCacheView=null;presentationCacheWidth=0;presentationCacheHeight=0;presentationCacheNeedsFullRebuild=!0;lightGlazeTexture=null;lightGlazeView=null;lightGlazeSamplingView=null;lightGlazeMipViews=[];lightGlazeMipDownsampleBindGroups=[];lightGlazeCompositeMipBindGroup=null;lightGlazeDisplayBindGroup=null;lightGlazeCompositeBindGroup=null;lightGlazeSession=null;lightGlazeStorageAllocated=!1;thicknessTailTexture=null;thicknessTailView=null;thicknessTailDisplayBindGroup=null;thicknessTailTextureWidth=0;thicknessTailTextureHeight=0;thicknessTailPresentedRect=null;adaptivePreviewCanvas;adaptivePreviewContext;adaptivePreviewScratchCanvas;adaptivePreviewScratchContext;adaptiveSpacingMaxExtraPercentPoints;adaptivePreviewVisibleCanvasRequestedDesynchronized;adaptivePreviewVisibleContextAttributes;adaptivePreviewScratchContextAttributes;adaptivePreviewShapeSprite=null;adaptivePreviewShapePalette=[];adaptivePreviewShapePaletteKey=``;adaptivePreviewGeneration=1;adaptivePreviewSubmissionsSinceProbe=0;adaptivePreviewSubmittedSerial=0;adaptivePreviewConfirmedSerial=0;adaptivePreviewLastPresentedSerial=0;adaptivePreviewLastIncompleteRetrySerial=0;adaptivePreviewCandidates=[];adaptivePreviewProbe=null;adaptivePreviewConsecutiveSlowProbes=0;adaptivePreviewActive=!1;adaptivePreviewFrozen=!1;adaptivePreviewForceStroke=!1;adaptivePreviewStartedAt=0;adaptivePreviewRetirementTargetSerial=0;adaptivePreviewFrameRequest=null;adaptivePreviewRetirementFrame=null;adaptivePreviewCssWidth=0;adaptivePreviewCssHeight=0;canvasCssWidth=1;canvasCssHeight=1;brushUniformBuffer;thicknessTailBrushUniformBuffer;grainUniformBuffer;displayUniformBuffer;thicknessTailDisplayUniformBuffer;lightGlazeUniformBuffer;instanceBuffer;thicknessTailInstanceBuffer;shapeOccupancyUniformBuffers=[];sampler;shapeMaskTexture;shapeMaskView;shapeMaskSampler;grainTexture;grainTextureView;grainSamplers;grainTextureIdentity=0;grainStartupDecodeMs=0;grainStartupMipBuildMs=0;grainStartupUploadMs=0;shapeMaskDecodeStrategy=qe;shapeMaskIdentity=0;shapeOccupancyActiveCells=Array($t).fill(0);shapeOccupancyCoverageRatios=Array($t).fill(1);packedMinimumRadius=1/0;brushBindGroupLayout;brushOccupancyBindGroupLayout;grainBrushBindGroupLayout;grainBrushOccupancyBindGroupLayout;displayBindGroupLayout;thicknessTailDisplayBindGroupLayout;lightGlazeDisplayBindGroupLayout;lightGlazeCompositeMipBindGroupLayout;lightGlazeCompositeBindGroupLayout;paintMipDownsampleBindGroupLayout;brushBindGroup;thicknessTailBrushBindGroup;brushOccupancyBindGroups=[];thicknessTailBrushOccupancyBindGroups=[];grainBrushBindGroups;grainBrushOccupancyBindGroups;thicknessTailGrainBrushBindGroups;thicknessTailGrainBrushOccupancyBindGroups;displayBindGroup;brushShaderModule;texturizedGrainShaderModule;displayShaderModule;thicknessTailDisplayShaderModule;lightGlazeDisplayShaderModule;lightGlazeCompositeMipShaderModule;lightGlazeCompositeShaderModule;paintMipDownsampleShaderModule;normalPipeline;additivePipeline;shapeNormalPipeline;shapeAdditivePipeline;shapeOccupancyNormalPipeline;shapeOccupancyAdditivePipeline;grainNormalPipeline;grainAdditivePipeline;grainShapeNormalPipeline;grainShapeAdditivePipeline;grainShapeOccupancyNormalPipeline;grainShapeOccupancyAdditivePipeline;m1GlazePipeline;m1GlazeShapePipeline;m1GlazeShapeOccupancyPipeline;grainM1GlazePipeline;grainM1GlazeShapePipeline;grainM1GlazeShapeOccupancyPipeline;displayPipeline;thicknessTailDisplayPipeline;lightGlazeDisplayPipeline;lightGlazeCompositeMipPipeline;lightGlazeCompositePipeline;paintMipDownsamplePipeline;instanceUpload=new ArrayBuffer(Re*Le);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);thicknessTailInstanceUpload=new ArrayBuffer(Re*Le);thicknessTailInstanceUploadF32=new Float32Array(this.thicknessTailInstanceUpload);thicknessTailInstanceUploadU32=new Uint32Array(this.thicknessTailInstanceUpload);brushUniformUpload=new ArrayBuffer(rn);thicknessTailBrushUniformUpload=new ArrayBuffer(rn);grainUniformUpload=new Float32Array(an/4);displayUniformUpload=new Float32Array(on/4);thicknessTailDisplayUniformUpload=new ArrayBuffer(cn);settings={...Sn};pendingStamps=[];pendingBlendBatches=[];activeStroke=null;seedSequence=1;historyActions=[];historyCursor=0;nextHistoryActionId=1;historyBatches=[];historyStoredBaseStamps=0;historyCompactionPending=!1;historyBusy=!1;layerHasContent=!1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=F*.5;viewCenterY=F*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;lastStampGeometry=Ve;lastStampVerticesPerCopy=Be;lastShapeSamplingStrategy=`none`;lastShapeOccupancyFallbackReason=`none`;lastShapeOccupancyMipLevel=-1;lastShapeOccupancyActiveCells=0;lastShapeOccupancyCoverageRatio=0;lastShapeOccupancyCandidateMipLevel=-1;lastShapeOccupancyCandidateActiveCells=0;lastShapeOccupancyCandidateCoverageRatio=0;constructor(e,t={},n=null){this.canvas=e,this.callbacks=t,this.adaptivePreviewCanvas=n,this.adaptiveSpacingMaxExtraPercentPoints=Ht(),this.adaptivePreviewVisibleCanvasRequestedDesynchronized=Vt(),this.adaptivePreviewContext=n?.getContext(`2d`,{alpha:!0,desynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized})??null,this.adaptivePreviewScratchCanvas=this.adaptivePreviewContext?document.createElement(`canvas`):null,this.adaptivePreviewScratchContext=this.adaptivePreviewScratchCanvas?.getContext(`2d`,{alpha:!0,desynchronized:!0})??null,this.adaptivePreviewVisibleContextAttributes=Bt(this.adaptivePreviewContext),this.adaptivePreviewScratchContextAttributes=Bt(this.adaptivePreviewScratchContext)}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<F)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${F}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{this.invalidateAdaptivePreview();let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),this.prepareAdaptivePreviewShapePalette(this.settings),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.clearAdaptivePreviewCanvas(),this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats(),this.publishHistoryState()}getSettings(){return{...this.settings}}setBrushSettings(e){this.flushPendingWorkBeforeSettingsChange();let n=e.tool===`paint`||e.tool===`blend`?e.tool:this.settings.tool;this.settings={...this.settings,...e,tool:n,shape:e.shape===`shape`||e.shape===`circle`?e.shape:this.settings.shape,shapeScatter:t(e.shapeScatter??this.settings.shapeScatter,0,1),grainMode:e.grainMode===`off`||e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:this.settings.grainMode,grainScale:t(e.grainScale??this.settings.grainScale,.1,4),grainDepth:t(e.grainDepth??this.settings.grainDepth,0,1),grainBrightness:t(e.grainBrightness??this.settings.grainBrightness,-1,1),grainContrast:t(e.grainContrast??this.settings.grainContrast,-1,1),grainInvert:typeof e.grainInvert==`boolean`?e.grainInvert:this.settings.grainInvert,grainFiltering:e.grainFiltering===`no`||e.grainFiltering===`classic`||e.grainFiltering===`improved`?e.grainFiltering:this.settings.grainFiltering,grainBlendMode:e.grainBlendMode===`multiply`?e.grainBlendMode:this.settings.grainBlendMode,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,n===`blend`?1:4,n===`blend`?1024:1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,n===`blend`?1:.25,n===`blend`?400:25),startThickness:t(e.startThickness??this.settings.startThickness,0,2),endThickness:t(e.endThickness??this.settings.endThickness,0,2),flow:t(e.flow??this.settings.flow,.001,1),opacity:t(e.opacity??this.settings.opacity,0,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),blendMode:e.blendMode===`normal`||e.blendMode===`additive`||e.blendMode===`light-glaze`||e.blendMode===`m1-glaze`?e.blendMode:this.settings.blendMode,blendStretch:t(e.blendStretch??this.settings.blendStretch,0,1),blendPaint:t(e.blendPaint??this.settings.blendPaint,0,1),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1)},this.prepareAdaptivePreviewShapePalette(this.settings),this.initialized&&(this.invalidateAdaptivePreview(),this.writeBrushUniforms(),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),this.displayDirty=!0,this.requestRender())}async setLayerFormat(e){if(e===this.layerFormat)return!0;if(!this.initialized||this.historyBusy||this.activeStroke)return!1;let t=this.layerFormat;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`);try{return await this.waitForIdle(),await this.recreateLayerResources(e),this.layerFormat=e,this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.layerHasContent=!1,this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats(),!0}catch(n){this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}finally{this.historyBusy=!1,this.publishHistoryState()}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect();this.canvasCssWidth=Math.max(1,e.width),this.canvasCssHeight=Math.max(1,e.height);let t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.invalidateAdaptivePreview(),this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){this.invalidateAdaptivePreview();let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=F*.5,this.viewCenterY=F*.5,this.zoom=Math.max(.01,Math.min(e/F,t/F)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}zoomBy(e,n,r){this.invalidateAdaptivePreview();let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}panByClientDelta(e,t){this.invalidateAdaptivePreview();let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){if(this.historyBusy)return;let t={...e,timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()};this.flushPendingWorkBeforeSettingsChange(),this.flushClosingLightGlazeSessionBeforeNewStroke(),this.invalidateAdaptivePreview();let n=this.settings.tool,r=n===`paint`&&ln(this.settings.blendMode)?{...this.settings}:null;r&&this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0),this.adaptivePreviewForceStroke=n===`paint`&&zt;let i=this.nextHistoryActionId++,a=r??this.settings,o={startThickness:a.startThickness,endThickness:a.endThickness},s=n===`blend`?j({size:this.settings.size,strength:1,spacing:this.settings.spacingPercent/100,flow:this.settings.flow,stretch:this.settings.blendStretch,paint:this.settings.blendPaint,aspect:1,angle:0,orientToStroke:!0,seed:i},{documentWidth:F,documentHeight:F}):null;s?.reset(t),this.activeStroke={tool:n,lastInput:t,startedAtMs:t.timeMs,thicknessSettings:o,thicknessDynamicsNeutral:n===`blend`||Ie(o.startThickness,o.endThickness),thicknessTailHoldback:n===`paint`&&Fe(o.endThickness),heldThicknessStamps:[],heldThicknessHead:0,distanceSinceStamp:0,adaptiveSpacingInitialPercent:r?.spacingPercent??this.settings.spacingPercent,adaptiveSpacingPercent:r?.spacingPercent??this.settings.spacingPercent,historyActionId:i,historyCommitted:!1,submitted:!1,seedSequenceBeforeStroke:this.seedSequence,historyCursorBeforeStroke:this.historyCursor,redoActionsBeforeStroke:this.historyCursor<this.historyActions.length?this.historyActions.slice(this.historyCursor):null,historyCompactionPendingBeforeStroke:this.historyCompactionPending,lightGlazeSettings:r,blendSettings:n===`blend`?{...this.settings}:null,blendPlanner:s},r&&this.startLightGlazeSession(i,r),n===`blend`?this.blendRenderer?.beginStroke(i):this.emitStamp(t,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(e){let t=this.activeStroke;if(t?.tool===`blend`){t.blendPlanner?.finish(),this.drainBlendPlanner(t);let e=t.historyCommitted;this.activeStroke=null,this.pendingBlendBatches.length>0&&(this.displayDirty=!0,this.requestRender()),e&&this.publishHistoryState();return}let n=!!(t?.thicknessTailHoldback&&!t.lightGlazeSettings&&(this.settings.blendMode===`normal`||this.settings.blendMode===`additive`));if(t){let n=Number.isFinite(e)?e:t.lastInput.timeMs,r=Math.max(t.lastInput.timeMs,n);this.releaseHeldThicknessStamps(r,!0)}let r=t?.historyCommitted??!1;t?.lightGlazeSettings&&this.lightGlazeSession?.historyActionId===t.historyActionId&&(this.lightGlazeSession.endRequested=!0,this.displayDirty=!0,this.requestRender()),this.freezeAdaptivePreviewAtLift(),this.activeStroke=null,(n||this.thicknessTailPresentedRect)&&(this.displayDirty=!0,this.requestRender()),r&&this.publishHistoryState()}cancelStrokeBeforeRender(){let e=this.activeStroke;if(!e||e.submitted)return!1;let t=0;this.pendingStamps=this.pendingStamps.filter(n=>{let r=n.historyActionId===e.historyActionId;return r&&(t+=1),!r});let n=this.pendingBlendBatches.length;return this.pendingBlendBatches=this.pendingBlendBatches.filter(t=>t.actionId!==e.historyActionId),t+=n-this.pendingBlendBatches.length,e.blendPlanner?.discardPending(),this.seedSequence=e.seedSequenceBeforeStroke,e.historyCommitted&&(this.historyActions.length=e.historyCursorBeforeStroke,e.redoActionsBeforeStroke&&this.historyActions.push(...e.redoActionsBeforeStroke),this.historyCursor=e.historyCursorBeforeStroke,this.historyCompactionPending=e.historyCompactionPendingBeforeStroke,this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps=Math.max(0,this.activeStrokeProfile.baseStamps-t),this.activeStrokeProfile.historyCommittedActions=Math.max(0,this.activeStrokeProfile.historyCommittedActions-1))),this.activeStroke=null,this.lightGlazeSession?.historyActionId===e.historyActionId&&this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.thicknessTailPresentedRect&&(this.displayDirty=!0,this.requestRender()),e.historyCommitted&&this.publishHistoryState(),!0}async clear(){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;this.historyBusy=!0,this.invalidateAdaptivePreview(),this.publishHistoryState(),this.callbacks.onStatus?.(`Pulizia del layer…`,`working`);try{return await this.waitForIdle(),this.layerHasContent?(this.submitImmediate([],!0,this.settings,!0,null),this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone(),this.layerHasContent=!1,this.hasVisibleHistoryContent()?(this.truncateRedoHistory(),this.historyActions.push({id:this.nextHistoryActionId++,kind:`clear`}),this.historyCursor=this.historyActions.length,this.compactDiscardedHistory(),this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)):this.resetHistoryState(),this.callbacks.onStatus?.(`Layer pulito.`,`ok`),!0):(this.callbacks.onStatus?.(`Il layer è già vuoto.`,`ok`),!1)}finally{this.historyBusy=!1,this.publishHistoryState()}}resetDocument(){return this.historyBusy?!1:(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.pendingStamps.length=0,this.pendingBlendBatches.length=0,this.activeStroke=null,this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.layerHasContent=!1,this.requestRender(),this.publishHistoryState(),!0)}async undo(){return this.moveHistoryCursor(-1)}async redo(){return this.moveHistoryCursor(1)}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);if(this.historyBusy||this.activeStroke)throw Error(`Concludi prima il tratto o l'operazione Undo/Redo.`);if(this.settings.tool===`blend`)throw Error(`Il benchmark GPU sintetico misura Paint: seleziona Pennello Paint.`);this.lightGlazeSession&&await this.waitForIdle();let n=t(Math.round(e),1,Math.min(12e3,Re));this.invalidateAdaptivePreview(),this.pendingStamps.length=0,this.pendingBlendBatches.length=0,this.activeStroke=null,this.resetHistoryState(),this.publishHistoryState(),this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.settings,i=this.generateBenchmarkStamps(n,r);ln(r.blendMode)&&(this.startLightGlazeSession(0,r),this.lightGlazeSession.endRequested=!0,this.lightGlazeSession.commitRequested=!0);let a=performance.now(),o=this.submitImmediate(i,!0,r),s=o.totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=!0,await this.device.queue.onSubmittedWorkDone();let c=performance.now()-a,l=this.nextHistoryActionId++;for(let e of i)e.historyActionId=l;this.historyActions.push({id:l,kind:`stroke`}),this.historyCursor=this.historyActions.length,this.recordHistoryBatch(i,r,o,!0),this.totalBaseStamps+=i.length,this.avoidedLogicalDraws+=i.length*Math.max(0,r.count-1),this.recordRenderedFrame(performance.now()),this.publishStats(),this.publishHistoryState();let u=i.reduce((e,t)=>e+t.radius*t.radius,0)/i.length,d=Math.round(Math.PI*u*i.length*r.count),f=[`1 draw instanziata`,`${r.count} copie fisiche GPU per stamp base`,r.shape===`shape`?this.lastShapeSamplingStrategy===We?`bitmask alpha ${Jt}², mip ${this.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(this.lastShapeOccupancyCoverageRatio*100).toFixed(1)}%`:`quad Shape legacy da 4 vertici, fallback ${this.lastShapeOccupancyFallbackReason}, mappa candidata ${(this.lastShapeOccupancyCandidateCoverageRatio*100).toFixed(1)}%`:`geometria quad triangle-strip (4 vertici)`,r.shape===`shape`?`coverage da maschera alpha 2048²`:`coverage fragment smoothstep generica`,r.shape===`shape`?this.shapeMaskDecodeStrategy===Ke?`PNG grayscale decodificata direttamente`:`PNG decodificata tramite fallback canvas`:`nessuna maschera Shape`,r.shape===`shape`?`scatter rotazione ${(r.shapeScatter*100).toFixed(0)}%`:`orientamento circolare invariato`,`riuso copySeed per jitter colore per copia`,`dirty rect direzionale conservativo`,this.isTexturizedGrainActive(r)?`grain Cotton Fleece M1 2500 ${r.grainMode} ${r.grainFiltering}, scale ${(r.grainScale*100).toFixed(0)}%, depth ${(r.grainDepth*100).toFixed(0)}%`:`grain Off, pipeline legacy`].join(` · `);return{baseStamps:i.length,logicalCopies:i.length*r.count,cpuSubmitMs:s,gpuCompletionMs:c,estimatedCoveredFragments:d,strategy:f}}getStats(){let e=performance.now();return this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3),{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}getBlendRuntimeState(){let e=this.blendRenderer?.memoryMiB()??0;return{scratchAllocated:e>0,scratchMemoryMiB:e}}getHistoryState(){return{canUndo:!this.historyBusy&&this.historyCursor>0,canRedo:!this.historyBusy&&this.historyCursor<this.historyActions.length,busy:this.historyBusy,actionCount:this.historyActions.length,cursor:this.historyCursor,storedBaseStamps:this.historyStoredBaseStamps,logicalStampBytes:this.historyStoredBaseStamps*Le}}getAdaptivePreviewDiagnostics(){return{active:this.adaptivePreviewActive,frozen:this.adaptivePreviewFrozen,visible:this.adaptivePreviewCanvas?.style.opacity===`1`,submittedSerial:this.adaptivePreviewSubmittedSerial,confirmedSerial:this.adaptivePreviewConfirmedSerial,lastPresentedSerial:this.adaptivePreviewLastPresentedSerial,retirementTargetSerial:this.adaptivePreviewRetirementTargetSerial,candidateCount:this.adaptivePreviewCandidates.length,presentedUnboundCandidates:this.adaptivePreviewCandidates.filter(e=>e.presented&&e.serial===null).length,drawFramePending:this.adaptivePreviewFrameRequest!==null,retirementFramePending:this.adaptivePreviewRetirementFrame!==null}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.frameRequest!==null||this.pendingStamps.length>0||this.pendingBlendBatches.length>0||this.clearRequested||this.displayDirty||this.lightGlazeSession?.commitRequested;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone(),this.retireAdaptivePreviewAfterGpuIdle()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={startedAt:performance.now(),stampGeometry:Ve,stampVerticesPerCopy:Be,fragmentCoverageStrategy:this.settings.shape===`shape`?Ue:He,shapeSamplingStrategy:`none`,shapeOccupancyFallbackReason:`none`,shapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:0,historyCapturedBaseStamps:0,historyCapturedBatches:0,historyCommittedActions:0,historyReplayOperations:0,baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,thicknessDynamicsHeldBaseStamps:0,thicknessDynamicsMaximumHeldBaseStamps:0,thicknessDynamicsReleasedDuringStroke:0,thicknessDynamicsReleasedAtLift:0,thicknessDynamicsPreviewFrames:0,thicknessDynamicsPreviewBaseStamps:0,thicknessDynamicsPreviewPhysicalCopies:0,thicknessDynamicsPreviewMaximumTexturePixels:0,presentationCacheFullRebuilds:0,presentationCachePartialUpdates:0,presentationCacheOffscreenSkips:0,presentationCacheUpdatedPixels:0,legacyDisplayShaderPixels:0,presentationCopiedPixels:0,paintDisplayMaximumSelectedMipLevel:0,paintDisplayPyramidMaintenanceFrames:0,paintDisplayPyramidFullLevelBuilds:0,paintDisplayPyramidDirtyLevelUpdates:0,paintDisplayPyramidPasses:0,paintDisplayPyramidBaseDirtyPixels:0,paintDisplayPyramidUpdatedPixels:0,paintDisplayPyramidEncodingMs:0,adaptivePreviewProbeStarts:0,adaptivePreviewProbeResolvedFast:0,adaptivePreviewProbeResolvedSlow:0,adaptivePreviewProbeTimeouts:0,adaptivePreviewProbeCancellations:0,adaptivePreviewProbeRejections:0,adaptivePreviewProbeNearMisses:0,adaptivePreviewProbeLatencyMs:[],adaptivePreviewProbeBacklogBaseStamps:[],adaptivePreviewProbeTimeoutLatenessMs:[],adaptiveSpacingInitialPercent:this.settings.spacingPercent,adaptiveSpacingFinalPercent:this.settings.spacingPercent,adaptiveSpacingEvents:[],grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?ct:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?lt:`legacy`,grainBatches:0,grainBaseStamps:0,grainPhysicalCopies:0,grainCircleBatches:0,grainShapeBatches:0,grainAdaptivePreviewSkips:0,lightGlazeStrategy:un(this.settings.blendMode),lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,adaptivePreviewActivations:0,adaptivePreviewActivationReason:`none`,adaptivePreviewFirstActivationReason:null,adaptivePreviewFirstActivationMs:null,adaptivePreviewSecondActivationReason:null,adaptivePreviewSecondActivationMs:null,adaptivePreviewFrames:0,adaptivePreviewBaseStampsDrawn:0,adaptivePreviewPhysicalCopiesDrawn:0,adaptivePreviewBudgetSkips:0,adaptivePreviewConfirmedStaleBitmapHides:0,adaptivePreviewIncompleteFrameRetryRequests:0,adaptivePreviewOversizedSkips:0,adaptivePreviewPatchPixels:0,adaptivePreviewMaxPatchBackingPixels:0,adaptivePreviewJsTotalMs:0,adaptivePreviewJsFrameMs:[],adaptivePreviewMaxLifetimeMs:0,adaptivePreviewMaxQueueProbeLatencyMs:0,adaptivePreviewMaxUnconfirmedBaseStamps:0,adaptivePreviewRetirements:0,adaptivePreviewFrozenAtLift:0,adaptivePreviewLiftPendingBaseStamps:0,adaptivePreviewLiftPendingSerialBindings:0,adaptivePreviewUnsupportedBlendSkips:0,adaptivePreviewExactBaseStampsSubmitted:0,adaptivePreviewExactBatchesSubmitted:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=hn(e.renderIntervalMs);return{stampGeometry:e.stampGeometry,stampVerticesPerCopy:e.stampVerticesPerCopy,fragmentCoverageStrategy:e.fragmentCoverageStrategy,shapeSamplingStrategy:e.shapeSamplingStrategy,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:e.shapeOccupancyFallbackReason,shapeOccupancyGridSize:Jt,shapeOccupancyMipLevel:e.shapeOccupancyMipLevel,shapeOccupancyActiveCells:e.shapeOccupancyActiveCells,shapeOccupancyCoverageRatio:e.shapeOccupancyCoverageRatio,shapeOccupancyCandidateMipLevel:e.shapeOccupancyCandidateMipLevel,shapeOccupancyCandidateActiveCells:e.shapeOccupancyCandidateActiveCells,shapeOccupancyCandidateCoverageRatio:e.shapeOccupancyCandidateCoverageRatio,shapeOccupancyMaximumMip:Qt,shapeOccupancyMinimumRadius:en,shapeOccupancyMaximumCoverageRatio:tn,shapeOccupancyBitmaskBytes:nn,colorSeedStrategy:Je,dirtyRectStrategy:Ye,thicknessDynamicsStrategy:ke,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsHeldBaseStamps:e.thicknessDynamicsHeldBaseStamps,thicknessDynamicsMaximumHeldBaseStamps:e.thicknessDynamicsMaximumHeldBaseStamps,thicknessDynamicsReleasedDuringStroke:e.thicknessDynamicsReleasedDuringStroke,thicknessDynamicsReleasedAtLift:e.thicknessDynamicsReleasedAtLift,thicknessDynamicsPreviewStrategy:mt,thicknessDynamicsPreviewTextureQuantum:St,thicknessDynamicsPreviewMaximumTextureDimension:Ct,thicknessDynamicsPreviewFrames:e.thicknessDynamicsPreviewFrames,thicknessDynamicsPreviewBaseStamps:e.thicknessDynamicsPreviewBaseStamps,thicknessDynamicsPreviewPhysicalCopies:e.thicknessDynamicsPreviewPhysicalCopies,thicknessDynamicsPreviewMaximumTexturePixels:e.thicknessDynamicsPreviewMaximumTexturePixels,thicknessDynamicsPreviewAdditionalMemoryMiB:e.thicknessDynamicsPreviewMaximumTexturePixels*(this.layerFormat===`rgba16float`?8:4)/(1024*1024),presentationCacheStrategy:Xe,presentationTransferStrategy:Ze,presentationCacheFullRebuilds:e.presentationCacheFullRebuilds,presentationCachePartialUpdates:e.presentationCachePartialUpdates,presentationCacheOffscreenSkips:e.presentationCacheOffscreenSkips,presentationCacheUpdatedPixels:e.presentationCacheUpdatedPixels,legacyDisplayShaderPixels:e.legacyDisplayShaderPixels,presentationCopiedPixels:e.presentationCopiedPixels,paintDisplayPyramidStrategy:Qe,paintDisplayLodSelectionStrategy:$e,paintDisplayMipLevelCount:I,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayMaximumSelectedMipLevel:e.paintDisplayMaximumSelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:dn(this.layerFormat),paintDisplayPyramidMaintenanceFrames:e.paintDisplayPyramidMaintenanceFrames,paintDisplayPyramidFullLevelBuilds:e.paintDisplayPyramidFullLevelBuilds,paintDisplayPyramidDirtyLevelUpdates:e.paintDisplayPyramidDirtyLevelUpdates,paintDisplayPyramidPasses:e.paintDisplayPyramidPasses,paintDisplayPyramidBaseDirtyPixels:e.paintDisplayPyramidBaseDirtyPixels,paintDisplayPyramidUpdatedPixels:e.paintDisplayPyramidUpdatedPixels,paintDisplayPyramidEncodingMs:e.paintDisplayPyramidEncodingMs,brushOpacityStrategy:et,grainStrategy:e.grainStrategy,grainCoordinateStrategy:e.grainCoordinateStrategy,grainSamplingStrategy:e.grainSamplingStrategy,grainMipStrategy:ot,grainTextureFormat:`rgba8unorm`,grainTextureWidth:R,grainTextureHeight:R,grainTextureMipLevelCount:Kt,grainTextureMemoryMiB:qt*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:st,grainCoverageStrategy:e.grainCoverageStrategy,grainAdaptivePreviewStrategy:e.grainAdaptivePreviewStrategy,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,grainBatches:e.grainBatches,grainBaseStamps:e.grainBaseStamps,grainPhysicalCopies:e.grainPhysicalCopies,grainCircleBatches:e.grainCircleBatches,grainShapeBatches:e.grainShapeBatches,grainAdaptivePreviewSkips:e.grainAdaptivePreviewSkips,lightGlazeStrategy:e.lightGlazeStrategy,lightGlazeAdaptivePreviewStrategy:ft,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?fn(this.layerFormat):0,lightGlazeBatches:e.lightGlazeBatches,lightGlazeCommits:e.lightGlazeCommits,lightGlazeCompositePixels:e.lightGlazeCompositePixels,lightGlazePyramidPasses:e.lightGlazePyramidPasses,lightGlazePyramidUpdatedPixels:e.lightGlazePyramidUpdatedPixels,adaptivePreviewStrategy:pt,adaptivePreviewTriggerStrategy:ht,adaptivePreviewStaleFrameStrategy:gt,adaptivePreviewVisibleCanvasStrategy:_t,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:vt,adaptivePreviewJsBudgetMs:yt,adaptivePreviewMaxTipBaseStamps:xt,adaptivePreviewMaxPatchCssPixels:wt,adaptivePreviewProbeIntervalSubmissions:At,adaptivePreviewTriggerThresholdMs:jt,adaptivePreviewSlowCompletionThresholdMs:Mt,adaptivePreviewTriggerConsecutiveProbes:Nt,adaptivePreviewProbeNearMissMinimumMs:Pt,adaptivePreviewProbeStarts:e.adaptivePreviewProbeStarts,adaptivePreviewProbeResolvedFast:e.adaptivePreviewProbeResolvedFast,adaptivePreviewProbeResolvedSlow:e.adaptivePreviewProbeResolvedSlow,adaptivePreviewProbeTimeouts:e.adaptivePreviewProbeTimeouts,adaptivePreviewProbeCancellations:e.adaptivePreviewProbeCancellations,adaptivePreviewProbeRejections:e.adaptivePreviewProbeRejections,adaptivePreviewProbeNearMisses:e.adaptivePreviewProbeNearMisses,adaptiveSpacingStrategy:Ft,adaptiveSpacingStepPercentPoints:It,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,adaptiveSpacingInitialPercent:e.adaptiveSpacingInitialPercent,adaptiveSpacingFinalPercent:e.adaptiveSpacingFinalPercent,adaptiveSpacingIncreaseCount:e.adaptiveSpacingEvents.length,adaptiveSpacingReachedMaximum:e.adaptiveSpacingFinalPercent>=e.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints-2**-52*8,adaptiveSpacingEvents:e.adaptiveSpacingEvents,adaptivePreviewActivations:e.adaptivePreviewActivations,adaptivePreviewActivationReason:e.adaptivePreviewActivationReason,adaptivePreviewFirstActivationReason:e.adaptivePreviewFirstActivationReason,adaptivePreviewFirstActivationMs:e.adaptivePreviewFirstActivationMs,adaptivePreviewSecondActivationReason:e.adaptivePreviewSecondActivationReason,adaptivePreviewSecondActivationMs:e.adaptivePreviewSecondActivationMs,adaptivePreviewFrames:e.adaptivePreviewFrames,adaptivePreviewBaseStampsDrawn:e.adaptivePreviewBaseStampsDrawn,adaptivePreviewPhysicalCopiesDrawn:e.adaptivePreviewPhysicalCopiesDrawn,adaptivePreviewBudgetSkips:e.adaptivePreviewBudgetSkips,adaptivePreviewConfirmedStaleBitmapHides:e.adaptivePreviewConfirmedStaleBitmapHides,adaptivePreviewIncompleteFrameRetryRequests:e.adaptivePreviewIncompleteFrameRetryRequests,adaptivePreviewOversizedSkips:e.adaptivePreviewOversizedSkips,adaptivePreviewPatchPixels:e.adaptivePreviewPatchPixels,adaptivePreviewMaxPatchBackingPixels:e.adaptivePreviewMaxPatchBackingPixels,adaptivePreviewJsTotalMs:e.adaptivePreviewJsTotalMs,adaptivePreviewJsP50Ms:z(e.adaptivePreviewJsFrameMs,.5),adaptivePreviewJsP95Ms:z(e.adaptivePreviewJsFrameMs,.95),adaptivePreviewJsMaxMs:mn(e.adaptivePreviewJsFrameMs),adaptivePreviewMaxLifetimeMs:e.adaptivePreviewMaxLifetimeMs,adaptivePreviewProbeLatencyP50Ms:z(e.adaptivePreviewProbeLatencyMs,.5),adaptivePreviewProbeLatencyP95Ms:z(e.adaptivePreviewProbeLatencyMs,.95),adaptivePreviewMaxQueueProbeLatencyMs:e.adaptivePreviewMaxQueueProbeLatencyMs,adaptivePreviewProbeBacklogP50BaseStamps:z(e.adaptivePreviewProbeBacklogBaseStamps,.5),adaptivePreviewProbeBacklogP95BaseStamps:z(e.adaptivePreviewProbeBacklogBaseStamps,.95),adaptivePreviewProbeBacklogMaxBaseStamps:mn(e.adaptivePreviewProbeBacklogBaseStamps),adaptivePreviewProbeTimeoutLatenessP50Ms:z(e.adaptivePreviewProbeTimeoutLatenessMs,.5),adaptivePreviewProbeTimeoutLatenessP95Ms:z(e.adaptivePreviewProbeTimeoutLatenessMs,.95),adaptivePreviewProbeTimeoutLatenessMaxMs:mn(e.adaptivePreviewProbeTimeoutLatenessMs),adaptivePreviewMaxUnconfirmedBaseStamps:e.adaptivePreviewMaxUnconfirmedBaseStamps,adaptivePreviewRetirements:e.adaptivePreviewRetirements,adaptivePreviewFrozenAtLift:e.adaptivePreviewFrozenAtLift,adaptivePreviewLiftPendingBaseStamps:e.adaptivePreviewLiftPendingBaseStamps,adaptivePreviewLiftPendingSerialBindings:e.adaptivePreviewLiftPendingSerialBindings,adaptivePreviewUnsupportedBlendSkips:e.adaptivePreviewUnsupportedBlendSkips,adaptivePreviewDeferredBaseStamps:0,adaptivePreviewResolvedBaseStamps:0,adaptivePreviewExactReplayBatches:0,adaptivePreviewLiftGpuSubmissions:0,adaptivePreviewExactBaseStampsSubmitted:e.adaptivePreviewExactBaseStampsSubmitted,adaptivePreviewExactBatchesSubmitted:e.adaptivePreviewExactBatchesSubmitted,historyStorageStrategy:Ut,historyReplayStrategy:Wt,historyStampRetentionStrategy:Gt,historyCapturedBaseStamps:e.historyCapturedBaseStamps,historyCapturedBatches:e.historyCapturedBatches,historyCommittedActions:e.historyCommittedActions,historyStoredBaseStampsAtEnd:this.historyStoredBaseStamps,historyLogicalStampBytesAtEnd:this.historyStoredBaseStamps*Le,historyReplayOperations:e.historyReplayOperations,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:z(e.cpuFrameMs,.5),submitImmediateP95Ms:z(e.cpuFrameMs,.95),submitImmediateMaxMs:mn(e.cpuFrameMs),renderFrameTotalP50Ms:z(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:z(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:mn(e.renderFrameTotalMs),renderFrameOverheadP50Ms:z(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:z(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:mn(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:z(e.cpuFrameMs,.5),cpuFrameP95Ms:z(e.cpuFrameMs,.95),cpuFrameMaxMs:mn(e.cpuFrameMs),renderIntervalP50Ms:z(e.renderIntervalMs,.5),renderIntervalP95Ms:z(e.renderIntervalMs,.95),renderIntervalMaxMs:mn(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:F,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,stampGeometry:this.settings.shape===`shape`?this.lastStampGeometry:Ve,stampVerticesPerCopy:this.settings.shape===`shape`?this.lastStampVerticesPerCopy:Be,fragmentCoverageStrategy:this.settings.shape===`shape`?Ue:He,shapeSamplingStrategy:this.settings.shape===`shape`?this.lastShapeSamplingStrategy:`none`,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:this.settings.shape===`shape`?this.lastShapeOccupancyFallbackReason:`none`,shapeOccupancyGridSize:Jt,shapeOccupancyMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateCoverageRatio:0,shapeOccupancyMaximumMip:Qt,shapeOccupancyMinimumRadius:en,shapeOccupancyMaximumCoverageRatio:tn,shapeOccupancyBitmaskBytes:nn,colorSeedStrategy:Je,dirtyRectStrategy:Ye,thicknessDynamicsStrategy:ke,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsPreviewStrategy:mt,thicknessDynamicsPreviewTextureQuantum:St,thicknessDynamicsPreviewMaximumTextureDimension:Ct,presentationCacheStrategy:Xe,presentationTransferStrategy:Ze,paintDisplayPyramidStrategy:Qe,paintDisplayLodSelectionStrategy:$e,paintDisplayMipLevelCount:I,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:dn(this.layerFormat),brushOpacityStrategy:et,grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainMipStrategy:ot,grainTextureFormat:`rgba8unorm`,grainTextureWidth:R,grainTextureHeight:R,grainTextureMipLevelCount:Kt,grainTextureMemoryMiB:qt*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:st,grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?ct:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?lt:`legacy`,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,lightGlazeStrategy:un(this.settings.blendMode),lightGlazeAdaptivePreviewStrategy:ft,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?fn(this.layerFormat):0,adaptivePreviewStrategy:pt,adaptivePreviewTriggerStrategy:ht,adaptivePreviewStaleFrameStrategy:gt,adaptivePreviewVisibleCanvasStrategy:_t,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:vt,adaptivePreviewJsBudgetMs:yt,adaptivePreviewMaxTipBaseStamps:xt,adaptivePreviewMaxPatchCssPixels:wt,adaptivePreviewProbeIntervalSubmissions:At,adaptivePreviewTriggerThresholdMs:jt,adaptivePreviewSlowCompletionThresholdMs:Mt,adaptivePreviewTriggerConsecutiveProbes:Nt,adaptivePreviewProbeNearMissMinimumMs:Pt,adaptiveSpacingStrategy:Ft,adaptiveSpacingStepPercentPoints:It,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,historyStorageStrategy:Ut,historyReplayStrategy:Wt,historyStampRetentionStrategy:Gt}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:rn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailBrushUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail brush uniforms`,size:rn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.grainUniformBuffer=this.device.createBuffer({label:`Texturized grain uniforms`,size:an,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:on,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailDisplayUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail display uniforms`,size:cn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.lightGlazeUniformBuffer=this.device.createBuffer({label:`Light Glaze stroke opacity`,size:sn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:Re*Le,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.thicknessTailInstanceBuffer=this.device.createBuffer({label:`Predictive thickness tail instance storage`,size:Re*Le,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.shapeMaskSampler=this.device.createSampler({label:`Shape 2K mask sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`});let e=(e,t)=>({no:this.device.createSampler({label:`Cotton Fleece M1 ${e} no filtering`,magFilter:`nearest`,minFilter:`nearest`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t}),classic:this.device.createSampler({label:`Cotton Fleece M1 ${e} classic filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:t,addressModeV:t}),improved:this.device.createSampler({label:`Cotton Fleece M1 ${e} improved filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t})});this.grainSamplers={fixed:e(`fixed`,`repeat`),moving:e(`moving`,`clamp-to-edge`)};let t=await this.createGrainTextureResources();this.grainTexture=t.texture,this.grainTextureView=this.grainTexture.createView({label:`Cotton Fleece M1 native grain full mip view`}),this.grainTextureIdentity=t.identity,this.grainStartupDecodeMs=t.decodeMs,this.grainStartupMipBuildMs=t.mipBuildMs,this.grainStartupUploadMs=t.uploadMs;let n=await this.createShapeMaskResources();this.shapeMaskTexture=n.texture,this.shapeMaskView=this.shapeMaskTexture.createView({label:`Shape 2K mask view`}),this.shapeMaskDecodeStrategy=n.decodeStrategy,this.shapeMaskIdentity=n.identity,this.shapeOccupancyActiveCells=n.occupancyActiveCells,this.shapeOccupancyCoverageRatios=n.occupancyCoverageRatios,this.adaptivePreviewShapeSprite=n.previewSprite,this.shapeOccupancyUniformBuffers=Array.from({length:$t},(e,t)=>{let r=this.device.createBuffer({label:`Shape conservative occupancy bitmask mip ${t}`,size:nn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),i=t*Zt;return this.device.queue.writeBuffer(r,0,n.occupancyWords.subarray(i,i+Zt)),r});let r=[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}];this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush legacy bind group layout`,entries:r}),this.brushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Brush occupancy bind group layout`,entries:[...r,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.lightGlazeDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze live display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.thicknessTailDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Predictive thickness tail display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]});let i=[...r,{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:7,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}];this.grainBrushBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain brush bind group layout`,entries:i}),this.grainBrushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain occupancy brush bind group layout`,entries:[...i,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeMipBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze composited mip 1 bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze final composite bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.paintMipDownsampleBindGroupLayout=this.device.createBindGroupLayout({label:`Paint display mip downsample bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}}]}),this.brushBindGroup=this.device.createBindGroup({label:`Brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.brushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]})),this.thicknessTailBrushBindGroup=this.device.createBindGroup({label:`Predictive thickness tail brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.thicknessTailBrushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Predictive thickness tail brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]}));let a=[`no`,`classic`,`improved`],o=[`fixed`,`moving`];this.grainBrushBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.device.createBindGroup({label:`Texturized M1 ${e} brush bind group ${t}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.grainBrushOccupancyBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Texturized M1 ${e} occupancy bind group ${t} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))])),this.thicknessTailGrainBrushBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.device.createBindGroup({label:`Predictive thickness tail ${e} grain bind group ${t}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.thicknessTailGrainBrushOccupancyBindGroups=Object.fromEntries(o.map(e=>[e,Object.fromEntries(a.map(t=>[t,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Predictive thickness tail ${e} grain occupancy ${t} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[e][t]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))])),this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:be}),this.texturizedGrainShaderModule=this.device.createShaderModule({label:`Texturized grain fragment WGSL`,code:xe}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:Ce}),this.thicknessTailDisplayShaderModule=this.device.createShaderModule({label:`Predictive thickness tail display WGSL`,code:we}),this.lightGlazeDisplayShaderModule=this.device.createShaderModule({label:`Light Glaze live display WGSL`,code:Te}),this.lightGlazeCompositeMipShaderModule=this.device.createShaderModule({label:`Light Glaze composited mip 1 WGSL`,code:Ee}),this.lightGlazeCompositeShaderModule=this.device.createShaderModule({label:`Light Glaze final composite WGSL`,code:De}),this.paintMipDownsampleShaderModule=this.device.createShaderModule({label:`Paint display mip downsample WGSL`,code:Oe}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.texturizedGrainShaderModule,`Texturized grain fragment`),this.assertShaderCompiled(this.displayShaderModule,`display`),this.assertShaderCompiled(this.thicknessTailDisplayShaderModule,`predictive thickness tail display`),this.assertShaderCompiled(this.lightGlazeDisplayShaderModule,`Light Glaze live display`),this.assertShaderCompiled(this.lightGlazeCompositeMipShaderModule,`Light Glaze composited mip 1`),this.assertShaderCompiled(this.lightGlazeCompositeShaderModule,`Light Glaze final composite`),this.assertShaderCompiled(this.paintMipDownsampleShaderModule,`paint display mip downsample`)]);let s=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:s,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let c=this.device.createPipelineLayout({label:`Predictive thickness tail display pipeline layout`,bindGroupLayouts:[this.thicknessTailDisplayBindGroupLayout]});this.thicknessTailDisplayPipeline=this.device.createRenderPipeline({label:`Predictive thickness tail display pipeline`,layout:c,vertex:{module:this.thicknessTailDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.thicknessTailDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let l=this.device.createPipelineLayout({label:`Light Glaze live display pipeline layout`,bindGroupLayouts:[this.lightGlazeDisplayBindGroupLayout]});this.lightGlazeDisplayPipeline=this.device.createRenderPipeline({label:`Light Glaze live display pipeline`,layout:l,vertex:{module:this.lightGlazeDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async createGrainTextureResources(){let e=await fetch(new URL(``+new URL(`graincottonfleece-P6Krz_AB.PNG`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Cotton Fleece M1 originale (${e.status}).`);let t=await e.arrayBuffer(),n=performance.now(),r=await createImageBitmap(new Blob([t],{type:`image/png`}),{colorSpaceConversion:`default`,premultiplyAlpha:`none`}),i=performance.now()-n;if(r.width!==R||r.height!==R)throw r.close(),Error(`Il grain M1 originale deve restare ${R}×${R}px; trovata ${r.width}×${r.height}px.`);let a=this.device.createTexture({label:`Cotton Fleece M1 original 2500 RGBA grain`,size:{width:R,height:R,depthOrArrayLayers:1},mipLevelCount:Kt,format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),o=performance.now();this.device.queue.copyExternalImageToTexture({source:r},{texture:a,mipLevel:0,premultipliedAlpha:!1,colorSpace:`srgb`},{width:R,height:R,depthOrArrayLayers:1});let s=performance.now()-o;r.close();let c=performance.now(),l=this.device.createShaderModule({label:`Cotton Fleece M1 mip generation WGSL`,code:Se});await this.assertShaderCompiled(l,`Cotton Fleece M1 mip generation`);let u=this.device.createBindGroupLayout({label:`Cotton Fleece M1 mip generation bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),d=this.device.createRenderPipeline({label:`Cotton Fleece M1 mip generation pipeline`,layout:this.device.createPipelineLayout({label:`Cotton Fleece M1 mip generation pipeline layout`,bindGroupLayouts:[u]}),vertex:{module:l,entryPoint:`vertexMain`},fragment:{module:l,entryPoint:`fragmentMain`,targets:[{format:`rgba8unorm`}]},primitive:{topology:`triangle-list`}}),f=this.device.createSampler({label:`Cotton Fleece M1 mip generation linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),p=this.device.createCommandEncoder({label:`Cotton Fleece M1 full mip chain encoder`});for(let e=1;e<Kt;e+=1){let t=a.createView({label:`Cotton Fleece M1 mip ${e-1} source`,baseMipLevel:e-1,mipLevelCount:1}),n=a.createView({label:`Cotton Fleece M1 mip ${e} target`,baseMipLevel:e,mipLevelCount:1}),r=this.device.createBindGroup({label:`Cotton Fleece M1 mip ${e} bind group`,layout:u,entries:[{binding:0,resource:t},{binding:1,resource:f}]}),i=p.beginRenderPass({label:`Cotton Fleece M1 build mip ${e}`,colorAttachments:[{view:n,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});i.setPipeline(d),i.setBindGroup(0,r),i.draw(3,1,0,0),i.end()}this.device.queue.submit([p.finish()]),await this.device.queue.onSubmittedWorkDone();let m=performance.now()-c;return{texture:a,identity:pn(new Uint8Array(t)),decodeMs:i,mipBuildMs:m,uploadMs:s}}async decodeShapeMaskWithCanvas(e){let t=await createImageBitmap(new Blob([e],{type:`image/png`}),{colorSpaceConversion:`none`,premultiplyAlpha:`none`});try{if(t.width!==L||t.height!==L)throw Error(`Shape.png deve restare ${L}×${L}px; trovata ${t.width}×${t.height}px.`);let e=document.createElement(`canvas`);e.width=L,e.height=L;let n=e.getContext(`2d`,{willReadFrequently:!0});if(!n)throw Error(`Impossibile leggere la maschera Shape.png.`);n.drawImage(t,0,0);let r=n.getImageData(0,0,L,L).data,i=new Uint8Array(L*L);for(let e=0,t=0;e<i.length;e+=1,t+=4){let n=Math.round(r[t]*.2126+r[t+1]*.7152+r[t+2]*.0722);i[e]=Math.round(n*r[t+3]/255)}return i}finally{t.close()}}async createShapeMaskResources(){let e=await fetch(new URL(``+new URL(`Shape-BcXQOKCm.png`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Shape.png (${e.status}).`);let t=await e.arrayBuffer(),n,r;try{let e=await s(t);if(e.width!==L||e.height!==L)throw Error(`Shape.png deve restare ${L}×${L}px; trovata ${e.width}×${e.height}px.`);n=e.pixels,r=Ke}catch{n=await this.decodeShapeMaskWithCanvas(t),r=qe}let i=Math.log2(L)+1,a=this.device.createTexture({label:`Shape 2K white-times-alpha mask`,size:{width:L,height:L,depthOrArrayLayers:1},mipLevelCount:i,format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),o=n,c=L,l=[];for(let e=0;e<i;e+=1){e<=Qt&&l.push(o);let t=Math.ceil(c/256)*256,n=o;if(t!==c){n=new Uint8Array(t*c);for(let e=0;e<c;e+=1)n.set(o.subarray(e*c,(e+1)*c),e*t)}if(this.device.queue.writeTexture({texture:a,mipLevel:e},n,{offset:0,bytesPerRow:t,rowsPerImage:c},{width:c,height:c,depthOrArrayLayers:1}),c===1)continue;let r=c/2,i=new Uint8Array(r*r);for(let e=0;e<r;e+=1)for(let t=0;t<r;t+=1){let n=e*2*c+t*2;i[e*r+t]=Math.round((o[n]+o[n+1]+o[n+c]+o[n+c+1])/4)}o=i,c=r}let u=xn(l),d=l[Qt],f=document.createElement(`canvas`);f.width=128,f.height=128;let p=f.getContext(`2d`);if(p&&d){let e=p.createImageData(128,128);for(let t=0;t<d.length;t+=1){let n=t*4;e.data[n]=255,e.data[n+1]=255,e.data[n+2]=255,e.data[n+3]=d[t]}p.putImageData(e,0,0)}return{texture:a,decodeStrategy:r,identity:pn(n),occupancyWords:u.words,occupancyActiveCells:u.activeCells,occupancyCoverageRatios:u.coverageRatios,previewSprite:f}}async recreateLayerResources(e){let t=this.layerTexture,n=this.blendRenderer,r=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:F,height:F,depthOrArrayLayers:1},mipLevelCount:I,format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),i=r.createView({label:`Paint layer authoritative mip 0 ${e}`,baseMipLevel:0,mipLevelCount:1}),a=r.createView({label:`Paint layer display mip chain ${e}`,baseMipLevel:0,mipLevelCount:I}),o=Array.from({length:I},(t,n)=>r.createView({label:`Paint layer mip ${n} ${e}`,baseMipLevel:n,mipLevelCount:1})),s=this.device.createPipelineLayout({label:`Brush legacy pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]}),c=this.device.createPipelineLayout({label:`Brush occupancy pipeline layout ${e}`,bindGroupLayouts:[this.brushOccupancyBindGroupLayout]}),l=this.device.createPipelineLayout({label:`Texturized grain brush pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushBindGroupLayout]}),u=this.device.createPipelineLayout({label:`Texturized grain occupancy pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushOccupancyBindGroupLayout]}),d=this.device.createPipelineLayout({label:`Paint display mip downsample pipeline layout ${e}`,bindGroupLayouts:[this.paintMipDownsampleBindGroupLayout]}),f=this.device.createPipelineLayout({label:`Light Glaze composited mip 1 pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeMipBindGroupLayout]}),p=this.device.createPipelineLayout({label:`Light Glaze final composite pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeBindGroupLayout]});this.device.pushErrorScope(`validation`);let m=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),h=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),g=this.device.createRenderPipeline({label:`Brush shape 2K legacy normal ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),_=this.device.createRenderPipeline({label:`Brush shape 2K legacy additive ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),v=this.device.createRenderPipeline({label:`Brush shape 2K occupancy normal ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),y=this.device.createRenderPipeline({label:`Brush shape 2K occupancy additive ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),b=this.device.createRenderPipeline({label:`Brush Texturized grain normal ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),x=this.device.createRenderPipeline({label:`Brush Texturized grain additive ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),S=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain normal ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),C=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain additive ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),w=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain normal ${e}`,layout:u,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),T=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain additive ${e}`,layout:u,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),E=(t,n,r,i,a)=>this.device.createRenderPipeline({label:t,layout:n,vertex:{module:this.brushShaderModule,entryPoint:i},fragment:{module:r,entryPoint:a,targets:[{format:e,blend:{color:{operation:`max`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`max`,srcFactor:`one`,dstFactor:`one`}}}]},primitive:{topology:`triangle-strip`}}),D=E(`Brush M1 Glaze circle MAX coverage ${e}`,s,this.brushShaderModule,`vertexMain`,`coverageFragmentMain`),O=E(`Brush M1 Glaze Shape MAX coverage ${e}`,s,this.brushShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),k=E(`Brush M1 Glaze Shape occupancy MAX coverage ${e}`,c,this.brushShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),A=E(`Brush M1 Glaze Texturized circle MAX coverage ${e}`,l,this.texturizedGrainShaderModule,`vertexMain`,`coverageFragmentMain`),ee=E(`Brush M1 Glaze Texturized Shape MAX coverage ${e}`,l,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),te=E(`Brush M1 Glaze Texturized Shape occupancy MAX coverage ${e}`,u,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),ne=this.device.createRenderPipeline({label:`Light Glaze composited mip 1 ${e}`,layout:f,vertex:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),j=this.device.createRenderPipeline({label:`Light Glaze final source-over composite ${e}`,layout:p,vertex:{module:this.lightGlazeCompositeShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-list`}}),M=this.device.createRenderPipeline({label:`Paint display mip downsample ${e}`,layout:d,vertex:{module:this.paintMipDownsampleShaderModule,entryPoint:`vertexMain`},fragment:{module:this.paintMipDownsampleShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),re=await this.device.popErrorScope();if(re)throw r.destroy(),Error(re.message);let N=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:a},{binding:2,resource:this.sampler}]}),ie=o.slice(0,I-1).map((t,n)=>this.device.createBindGroup({label:`Paint display mip ${n} to ${n+1} ${e}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:t}]})),ae;try{ae=await ye.create({device:this.device,documentWidth:F,documentHeight:F,layerFormat:e,layerView:i,layerSamplingView:a,shapeMaskView:this.shapeMaskView,shapeMaskSampler:this.shapeMaskSampler,grainTextureView:this.grainTextureView,grainSamplers:this.grainSamplers})}catch(e){throw r.destroy(),e}this.destroyLightGlazeResources(),this.destroyThicknessTailOverlayResources(),this.layerTexture=r,this.layerView=i,this.layerSamplingView=a,this.blendRenderer=ae,this.paintMipViews=o,this.paintMipDownsampleBindGroups=ie,this.normalPipeline=m,this.additivePipeline=h,this.shapeNormalPipeline=g,this.shapeAdditivePipeline=_,this.shapeOccupancyNormalPipeline=v,this.shapeOccupancyAdditivePipeline=y,this.grainNormalPipeline=b,this.grainAdditivePipeline=x,this.grainShapeNormalPipeline=S,this.grainShapeAdditivePipeline=C,this.grainShapeOccupancyNormalPipeline=w,this.grainShapeOccupancyAdditivePipeline=T,this.m1GlazePipeline=D,this.m1GlazeShapePipeline=O,this.m1GlazeShapeOccupancyPipeline=k,this.grainM1GlazePipeline=A,this.grainM1GlazeShapePipeline=ee,this.grainM1GlazeShapeOccupancyPipeline=te,this.lightGlazeCompositeMipPipeline=ne,this.lightGlazeCompositePipeline=j,this.paintMipDownsamplePipeline=M,this.displayBindGroup=N,this.layerFormat=e,this.paintDisplayMipValidThroughLevel=0,this.paintDisplaySelectedMipLevel=0,this.presentationCacheNeedsFullRebuild=!0,n?.destroy(),t?.destroy()}ensureThicknessTailOverlayResources(e,n){let r=t(Math.ceil(Math.max(1,e)/St)*St,St,Ct),i=t(Math.ceil(Math.max(1,n)/St)*St,St,Ct);if(this.thicknessTailTexture&&this.thicknessTailView&&this.thicknessTailDisplayBindGroup&&this.thicknessTailTextureWidth>=r&&this.thicknessTailTextureHeight>=i)return;let a=Math.max(this.thicknessTailTextureWidth,r),o=Math.max(this.thicknessTailTextureHeight,i),s=this.device.createTexture({label:`Predictive thickness tail ${a}×${o} ${this.layerFormat}`,size:{width:a,height:o,depthOrArrayLayers:1},format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),c=s.createView({label:`Predictive thickness tail view`}),l=this.device.createBindGroup({label:`Predictive thickness tail display bind group`,layout:this.thicknessTailDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:this.sampler},{binding:3,resource:c},{binding:4,resource:{buffer:this.thicknessTailDisplayUniformBuffer}}]}),u=this.thicknessTailTexture;this.thicknessTailTexture=s,this.thicknessTailView=c,this.thicknessTailDisplayBindGroup=l,this.thicknessTailTextureWidth=a,this.thicknessTailTextureHeight=o,u?.destroy()}destroyThicknessTailOverlayResources(){this.thicknessTailTexture?.destroy(),this.thicknessTailTexture=null,this.thicknessTailView=null,this.thicknessTailDisplayBindGroup=null,this.thicknessTailTextureWidth=0,this.thicknessTailTextureHeight=0,this.thicknessTailPresentedRect=null}ensureLightGlazeResources(){if(this.lightGlazeTexture&&this.lightGlazeView&&this.lightGlazeSamplingView&&this.lightGlazeCompositeMipBindGroup&&this.lightGlazeDisplayBindGroup&&this.lightGlazeCompositeBindGroup)return;let e=this.device.createTexture({label:`Lazy Light Glaze stroke accumulator ${this.layerFormat}`,size:{width:F,height:F,depthOrArrayLayers:1},mipLevelCount:I,format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),t=e.createView({label:`Light Glaze authoritative stroke mip 0`,baseMipLevel:0,mipLevelCount:1}),n=e.createView({label:`Light Glaze live display mip chain`,baseMipLevel:0,mipLevelCount:I}),r=Array.from({length:I},(t,n)=>e.createView({label:`Light Glaze stroke mip ${n}`,baseMipLevel:n,mipLevelCount:1})),i=r.slice(0,I-1).map((e,t)=>this.device.createBindGroup({label:`Light Glaze mip ${t} to ${t+1}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:e}]})),a=this.device.createBindGroup({label:`Light Glaze permanent + stroke to composited mip 1`,layout:this.lightGlazeCompositeMipBindGroupLayout,entries:[{binding:0,resource:this.layerView},{binding:1,resource:t},{binding:2,resource:{buffer:this.lightGlazeUniformBuffer}}]}),o=this.device.createBindGroup({label:`Light Glaze live display bind group`,layout:this.lightGlazeDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:n},{binding:3,resource:this.sampler},{binding:4,resource:{buffer:this.lightGlazeUniformBuffer}}]}),s=this.device.createBindGroup({label:`Light Glaze final composite bind group`,layout:this.lightGlazeCompositeBindGroupLayout,entries:[{binding:0,resource:t},{binding:1,resource:{buffer:this.lightGlazeUniformBuffer}}]});this.lightGlazeTexture=e,this.lightGlazeView=t,this.lightGlazeSamplingView=n,this.lightGlazeMipViews=r,this.lightGlazeMipDownsampleBindGroups=i,this.lightGlazeCompositeMipBindGroup=a,this.lightGlazeDisplayBindGroup=o,this.lightGlazeCompositeBindGroup=s,this.lightGlazeStorageAllocated=!0}destroyLightGlazeResources(){this.lightGlazeSession=null,this.lightGlazeTexture?.destroy(),this.lightGlazeTexture=null,this.lightGlazeView=null,this.lightGlazeSamplingView=null,this.lightGlazeMipViews=[],this.lightGlazeMipDownsampleBindGroups=[],this.lightGlazeCompositeMipBindGroup=null,this.lightGlazeDisplayBindGroup=null,this.lightGlazeCompositeBindGroup=null,this.lightGlazeStorageAllocated=!1}startLightGlazeSession(e,n){if(this.lightGlazeSession)throw Error(`Un tratto Light Glaze precedente non è ancora stato finalizzato.`);this.ensureLightGlazeResources(),this.lightGlazeSession={historyActionId:e,settings:{...n,opacity:Number.isFinite(n.opacity)?t(n.opacity,0,1):1,blendMode:n.blendMode===`m1-glaze`?`m1-glaze`:`light-glaze`},dirtyRect:null,needsClear:!0,hasContent:!1,endRequested:!1,commitRequested:!1,mipValidThroughLevel:0,tintLinear:null}}abandonLightGlazeSession(){this.lightGlazeSession&&(this.lightGlazeSession=null,this.presentationCacheNeedsFullRebuild=!0)}flushClosingLightGlazeSessionBeforeNewStroke(){if(!this.lightGlazeSession?.endRequested)return;let e=0,t=Math.ceil(this.pendingStamps.length/Re)+2;for(;this.lightGlazeSession?.endRequested;)if(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.renderFrame(performance.now()),e+=1,e>t)throw Error(`Impossibile finalizzare il tratto Light Glaze precedente.`)}flushPendingWorkBeforeSettingsChange(){if(!this.initialized||this.activeStroke||this.historyBusy||(this.flushClosingLightGlazeSessionBeforeNewStroke(),this.lightGlazeSession||this.pendingStamps.length===0&&this.pendingBlendBatches.length===0))return;let e=0,t=Math.ceil(this.pendingStamps.length/Re)+Math.ceil(this.pendingBlendBatches.length/64)+2;for(;this.pendingStamps.length>0||this.pendingBlendBatches.length>0;){this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null);let n=this.pendingStamps.length+this.pendingBlendBatches.length;if(this.renderFrame(performance.now()),e+=1,this.pendingStamps.length+this.pendingBlendBatches.length>=n||e>t)throw Error(`Impossibile finalizzare gli stamp prima del cambio impostazioni.`)}}writeLightGlazeUniforms(e,n,r){let i=new ArrayBuffer(sn),a=new Float32Array(i),o=new Uint32Array(i);a[0]=Number.isFinite(e)?t(e,0,1):1,o[1]=+(this.layerFormat===`rgba16float`),o[2]=+(n===`m1-max-coverage`),a[4]=r?.[0]??0,a[5]=r?.[1]??0,a[6]=r?.[2]??0,a[7]=1,this.device.queue.writeBuffer(this.lightGlazeUniformBuffer,0,i)}mergeDirtyRects(e,t){if(!e)return t?{...t}:null;if(!t)return{...e};let n=Math.min(e.x,t.x),r=Math.min(e.y,t.y),i=Math.max(e.x+e.width,t.x+t.width),a=Math.max(e.y+e.height,t.y+t.height);return{x:n,y:r,width:i-n,height:a-r}}encodeLightGlazeDisplayPyramid(e,t,n,r){let i=t.mipValidThroughLevel,a=n!==null,o=n,s=0,c=0;for(let t=1;t<=r;t+=1){let n=this.paintMipDimensions(t),r=t>i,a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null;if(!a||a.width<=0||a.height<=0)continue;let l=e.beginRenderPass({label:r?`Build full Light Glaze final-composite mip ${t}`:`Update Light Glaze final-composite mip ${t} dirty rect`,colorAttachments:[{view:this.lightGlazeMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});t===1?(l.setPipeline(this.lightGlazeCompositeMipPipeline),l.setBindGroup(0,this.lightGlazeCompositeMipBindGroup)):(l.setPipeline(this.paintMipDownsamplePipeline),l.setBindGroup(0,this.lightGlazeMipDownsampleBindGroups[t-1])),r||l.setScissorRect(a.x,a.y,a.width,a.height),l.draw(3,1,0,0),l.end(),s+=1,c+=a.width*a.height,o=a}return(a||r>i)&&(t.mipValidThroughLevel=r),{passes:s,updatedPixels:c}}isTexturizedGrainActive(e){return(e.grainMode===`texturized`||e.grainMode===`moving`)&&e.grainBlendMode===`multiply`&&e.grainDepth>0}grainCoordinateMode(e){return e.grainMode===`moving`?`moving`:`fixed`}grainStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?rt:nt:tt}grainCoordinateStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?at:it:`none`}grainSamplingStrategy(e){if(!this.isTexturizedGrainActive(e))return`none`;let t=e.grainMode===`moving`;return e.grainFiltering===`no`?t?`clamp-nearest`:`repeat-nearest`:e.grainFiltering===`classic`?t?`clamp-linear-mip-nearest`:`repeat-linear-mip-nearest`:t?`clamp-linear-trilinear`:`repeat-linear-trilinear`}writeGrainUniforms(e){let n=this.grainUniformUpload,r=new Uint32Array(n.buffer);n.fill(0);let i=t(e.grainScale,.1,4),a=e.grainInvert?-1:1;n[0]=1/(R*i),n[1]=t(e.grainDepth,0,1),n[2]=t(e.grainBrightness,-1,1)*a,n[3]=(1+t(e.grainContrast,-1,1))*a,r[4]=e.grainFiltering===`no`?0:e.grainFiltering===`classic`?1:2,r[5]=+(e.grainMode===`moving`),this.device.queue.writeBuffer(this.grainUniformBuffer,0,n)}populateBrushUniformUpload(n,r,i,a,o,s){let c=new Float32Array(n),l=new Uint32Array(n);c.fill(0);let[u,d,f]=e(r.color),p=r.jitterMaster;c[0]=i,c[1]=a,c[2]=o,c[3]=s,c[4]=u,c[5]=d,c[6]=f,c[7]=Number.isFinite(r.opacity)?t(r.opacity,0,1):1,c[8]=r.hueJitterDegrees/360*p,c[9]=r.saturationJitter*p,c[10]=r.lightnessJitter*p,c[11]=r.darknessJitter*p,c[12]=r.flow,c[13]=r.hardness,c[14]=r.blendIntensity,c[15]=0,c[16]=r.positionJitterLinear,c[17]=r.positionJitterLateral,c[18]=r.shapeScatter,l[20]=r.count>>>0,l[21]=+!!r.jitterPerCopy,l[22]=+(r.blendMode===`additive`),l[23]=0}writeBrushUniforms(e=this.settings){this.populateBrushUniformUpload(this.brushUniformUpload,e,F,F,0,0),this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeThicknessTailBrushUniforms(e,t,n,r,i){this.populateBrushUniformUpload(this.thicknessTailBrushUniformUpload,e,t,n,r,i),this.device.queue.writeBuffer(this.thicknessTailBrushUniformBuffer,0,this.thicknessTailBrushUniformUpload)}desiredPaintDisplayMipLevel(){return!Number.isFinite(this.zoom)||this.zoom>=1?0:t(Math.floor(Math.log2(1/Math.max(this.zoom,2**-52))+1e-6),0,I-1)}paintMipDimensions(e){let t=Math.max(1,F>>e);return{width:t,height:t}}downsampleDirtyRect(e,t){let{width:n,height:r}=this.paintMipDimensions(t),i=Math.max(0,Math.floor(e.x/2)),a=Math.max(0,Math.floor(e.y/2)),o=Math.min(n,Math.ceil((e.x+e.width)/2)),s=Math.min(r,Math.ceil((e.y+e.height)/2));return{x:i,y:a,width:Math.max(0,o-i),height:Math.max(0,s-a)}}encodePaintDisplayPyramid(e,t,n){let r=performance.now(),i=this.paintDisplayMipValidThroughLevel,a=t!==null,o=t,s=0,c=0,l=0,u=0;for(let t=1;t<=n;t+=1){let n=this.paintMipDimensions(t),r=t>i,a;if(a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null,!a||a.width<=0||a.height<=0)continue;let d=e.beginRenderPass({label:r?`Build full paint display mip ${t}`:`Update paint display mip ${t} dirty rect`,colorAttachments:[{view:this.paintMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});d.setPipeline(this.paintMipDownsamplePipeline),d.setBindGroup(0,this.paintMipDownsampleBindGroups[t-1]),r||d.setScissorRect(a.x,a.y,a.width,a.height),d.draw(3,1,0,0),d.end(),l+=1,u+=a.width*a.height,r?s+=1:c+=1,o=a}return(a||n>i)&&(this.paintDisplayMipValidThroughLevel=n),{maintenanceFrames:+(l>0),fullLevelBuilds:s,dirtyLevelUpdates:c,passes:l,baseDirtyPixels:t?t.width*t.height:0,updatedPixels:u,encodingMs:l>0?performance.now()-r:0}}writeDisplayUniforms(e=this.paintDisplaySelectedMipLevel){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=F,this.displayUniformUpload[3]=F,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.displayUniformUpload[8]=e,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}writeThicknessTailDisplayUniforms(e,t,n){let r=new Float32Array(this.thicknessTailDisplayUniformUpload),i=new Uint32Array(this.thicknessTailDisplayUniformUpload);r.fill(0),r[0]=e,r[1]=t,r[2]=this.thicknessTailTextureWidth,r[3]=this.thicknessTailTextureHeight,i[4]=+(n.blendMode===`additive`),this.device.queue.writeBuffer(this.thicknessTailDisplayUniformBuffer,0,this.thicknessTailDisplayUniformUpload)}ensurePresentationCacheTexture(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);if(this.presentationCacheTexture&&this.presentationCacheView&&this.presentationCacheWidth===e&&this.presentationCacheHeight===t)return;let n=this.presentationCacheTexture,r=this.device.createTexture({label:`Persistent presentation cache ${e}×${t}`,size:{width:e,height:t,depthOrArrayLayers:1},format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});this.presentationCacheTexture=r,this.presentationCacheView=r.createView({label:`Persistent presentation cache view`}),this.presentationCacheWidth=e,this.presentationCacheHeight=t,this.presentationCacheNeedsFullRebuild=!0,n?.destroy()}layerDirtyRectToPresentationRect(e,t){let n=this.canvas.width,r=this.canvas.height;if(n<=0||r<=0)return null;let i=Math.max(2,2**(t+1)),a=e.x-i,o=e.y-i,s=e.x+e.width+i,c=e.y+e.height+i,l=(a-this.viewCenterX)*this.zoom+n*.5,u=(o-this.viewCenterY)*this.zoom+r*.5,d=(s-this.viewCenterX)*this.zoom+n*.5,f=(c-this.viewCenterY)*this.zoom+r*.5,p=Math.max(0,Math.floor(Math.min(l,d))-1),m=Math.max(0,Math.floor(Math.min(u,f))-1),h=Math.min(n,Math.ceil(Math.max(l,d))+1),g=Math.min(r,Math.ceil(Math.max(u,f))+1),_=Math.max(0,h-p),v=Math.max(0,g-m);return _>0&&v>0?{x:p,y:m,width:_,height:v}:null}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1),timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;if(r.tool===`blend`){let t={...e,timeMs:Math.max(r.lastInput.timeMs,Number.isFinite(e.timeMs)?e.timeMs:r.lastInput.timeMs)},i=r.blendPlanner?.pushSample(t);if(i&&!i.accepted)throw Error(`Coda Blend dry piena: servono ${i.requiredSteps} segmenti.`);r.lastInput=t,this.drainBlendPlanner(r),this.recordStampGenerationTime(n);return}let i=r.lastInput,a={...e,timeMs:Math.max(i.timeMs,Number.isFinite(e.timeMs)?e.timeMs:i.timeMs)},o=a.x-i.x,s=a.y-i.y,c=Math.hypot(o,s),l=a.timeMs-i.timeMs;if(this.releaseHeldThicknessStamps(a.timeMs,!1),c<=1e-4){r.lastInput=a,this.recordStampGenerationTime(n);return}let u=r.lightGlazeSettings??this.settings,d=Math.max(.1,u.size*(r.adaptiveSpacingPercent/100)),f=o/c,p=s/c,m=0,h=r.distanceSinceStamp,g=0;for(;h+(c-m)>=d;){let e=d-h;m+=e;let n=t(m/c,0,1);if(this.emitStamp({x:i.x+o*n,y:i.y+s*n,pressure:i.pressure+(a.pressure-i.pressure)*n,timeMs:i.timeMs+l*n},f,p),h=0,g+=1,g>=Re)break}h+=Math.max(0,c-m),r.lastInput=a,r.distanceSinceStamp=h,this.releaseHeldThicknessStamps(a.timeMs,!1),this.recordStampGenerationTime(n)}drainBlendPlanner(e){let t=e.blendPlanner,n=e.blendSettings;if(!t||!n)return;let r=t.buildNextBatch();for(;r;)r.empty||(e.historyCommitted||(this.truncateRedoHistory(),this.historyActions.push({id:e.historyActionId,kind:`stroke`}),this.historyCursor=this.historyActions.length,e.historyCommitted=!0,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)),this.pendingBlendBatches.push({actionId:e.historyActionId,settings:n,batch:_e(r)}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1)),r=t.buildNextBatch();this.pendingBlendBatches.length>0&&(this.displayDirty=!0,this.requestRender())}emitStamp(e,n,r){let i=this.activeStroke;if(!i)return;let a=i.lightGlazeSettings??this.settings,o=t(e.pressure,.01,1),s=Math.max(.5,a.size*.5),c=i.thicknessDynamicsNeutral?1:Me(i.thicknessSettings.startThickness,Math.max(0,e.timeMs-i.startedAtMs)),l=i.thicknessDynamicsNeutral?s:s*c,u=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,d={x:e.x,y:e.y,radius:l,pressure:o,seed:u,directionX:n,directionY:r,historyActionId:i.historyActionId};if(i.thicknessTailHoldback){i.heldThicknessStamps.push({stamp:d,timeMs:e.timeMs,baseRadius:s,liveThicknessFactor:c}),this.activeStrokeProfile&&(this.activeStrokeProfile.thicknessDynamicsHeldBaseStamps+=1,this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps=Math.max(this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps,i.heldThicknessStamps.length-i.heldThicknessHead)),this.displayDirty=!0,this.requestRender();return}this.commitThicknessStamp(d,i)}releaseHeldThicknessStamps(e,t){let n=this.activeStroke;if(!n||!n.thicknessTailHoldback)return;let r=n.heldThicknessStamps,i=0;for(;n.heldThicknessHead<r.length;){let a=r[n.heldThicknessHead],o=Math.max(0,e-a.timeMs);if(!t&&o<100)break;a.stamp.radius=t?Pe(a.baseRadius,a.liveThicknessFactor,n.thicknessSettings.endThickness,o):a.baseRadius*a.liveThicknessFactor,this.commitThicknessStamp(a.stamp,n),n.heldThicknessHead+=1,i+=1}i>0&&this.activeStrokeProfile&&(t?this.activeStrokeProfile.thicknessDynamicsReleasedAtLift+=i:this.activeStrokeProfile.thicknessDynamicsReleasedDuringStroke+=i),n.heldThicknessHead===r.length?(n.heldThicknessStamps=[],n.heldThicknessHead=0):n.heldThicknessHead>=1024&&(n.heldThicknessStamps=r.slice(n.heldThicknessHead),n.heldThicknessHead=0)}thicknessTailReferenceTimeMs(){let e=this.activeStroke;return e?Math.max(e.lastInput.timeMs,performance.now()):performance.now()}thicknessTailPreviewEligible(){let e=this.activeStroke;return!e||!e.thicknessTailHoldback||e.lightGlazeSettings||e.heldThicknessHead>=e.heldThicknessStamps.length?!1:this.settings.blendMode===`normal`||this.settings.blendMode===`additive`}prepareThicknessTailFrame(){let e=this.activeStroke;if(!e||!this.thicknessTailPreviewEligible())return null;let t=this.settings,n=e.heldThicknessStamps,r=Math.max(e.heldThicknessHead,n.length-Re),i=this.thicknessTailReferenceTimeMs(),a=[];for(let t=r;t<n.length;t+=1){let r=n[t],o=Pe(r.baseRadius,r.liveThicknessFactor,e.thicknessSettings.endThickness,Math.max(0,i-r.timeMs));!Number.isFinite(o)||o<=0||a.push({...r.stamp,radius:o})}if(a.length===0)return null;let o=this.packThicknessTailStamps(a,t);return o.dirtyRect?(this.ensureThicknessTailOverlayResources(o.dirtyRect.width,o.dirtyRect.height),this.writeThicknessTailBrushUniforms(t,this.thicknessTailTextureWidth,this.thicknessTailTextureHeight,o.dirtyRect.x,o.dirtyRect.y),this.writeThicknessTailDisplayUniforms(o.dirtyRect.x,o.dirtyRect.y,t),this.device.queue.writeBuffer(this.thicknessTailInstanceBuffer,0,this.thicknessTailInstanceUpload,0,a.length*Le),{settings:t,stamps:a,dirtyRect:o.dirtyRect,shapeOccupancySelection:t.shape===`shape`?this.selectShapeOccupancy(o.minimumRadius):null,grainActive:this.isTexturizedGrainActive(t)}):null}encodeThicknessTailFrame(e,t){let n=t.settings,r=n.shape===`shape`,i=t.shapeOccupancySelection?.selectedMipLevel??null,a=r&&i!==null,o=t.grainActive?r?a?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:r?a?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline,s=t.grainActive?a?this.thicknessTailGrainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][i]:this.thicknessTailGrainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.thicknessTailBrushOccupancyBindGroups[i]:this.thicknessTailBrushBindGroup,c=e.beginRenderPass({label:`Rebuild predictive thickness tail`,colorAttachments:[{view:this.thicknessTailView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});c.setPipeline(o),c.setBindGroup(0,s),c.setScissorRect(0,0,t.dirtyRect.width,t.dirtyRect.height),c.draw(Be,t.stamps.length*n.count,0,0),c.end();let l=this.activeStrokeProfile;l&&(l.thicknessDynamicsPreviewFrames+=1,l.thicknessDynamicsPreviewBaseStamps+=t.stamps.length,l.thicknessDynamicsPreviewPhysicalCopies+=t.stamps.length*n.count,l.thicknessDynamicsPreviewMaximumTexturePixels=Math.max(l.thicknessDynamicsPreviewMaximumTexturePixels,this.thicknessTailTextureWidth*this.thicknessTailTextureHeight))}commitThicknessStamp(e,t){if(e.radius<=0)return;let n=t.lightGlazeSettings??this.settings,r=e.radius*2*(n.positionJitterLinear+n.positionJitterLateral);e.x+e.radius+r<0||e.y+e.radius+r<0||e.x-e.radius-r>=F||e.y-e.radius-r>=F||(t.historyCommitted||(this.truncateRedoHistory(),this.historyActions.push({id:t.historyActionId,kind:`stroke`}),this.historyCursor=this.historyActions.length,t.historyCommitted=!0,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)),this.pendingStamps.push(e),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n;this.activeStroke?.thicknessTailHoldback&&this.releaseHeldThicknessStamps(this.thicknessTailReferenceTimeMs(),!1);let i=performance.now(),a=this.pendingStamps.length,o=this.lightGlazeSession;if(o)for(a=0;a<this.pendingStamps.length&&this.pendingStamps[a].historyActionId===o.historyActionId;)a+=1;let s=Math.min(a,Re),c=s>0?this.pendingStamps.splice(0,s):[],l=[];if(!o&&c.length===0&&this.pendingBlendBatches.length>0){let e=this.pendingBlendBatches[0],t=e.settings.size<=8?64:e.settings.size<=32?32:e.settings.size<=64?24:e.settings.size<=256?8:e.settings.size<=512?4:ze,n=0;for(;n<this.pendingBlendBatches.length&&n<t&&this.pendingBlendBatches[n].actionId===e.actionId;)n+=1;l=this.pendingBlendBatches.splice(0,n)}o&&(o.commitRequested=o.endRequested&&!this.pendingStamps.some(e=>e.historyActionId===o.historyActionId));let u=performance.now()-i;if(!(this.clearRequested||c.length>0||l.length>0||this.displayDirty||o?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)||this.canvas.width<=0||this.canvas.height<=0)return;let d=this.clearRequested,f=l[0]?.settings??o?.settings??this.settings,p=performance.now(),m=l.length>0?this.submitBlendImmediate(l.map(e=>e.batch),d,f,l[0].actionId):this.submitImmediate(c,d,f);this.lastCpuFrameMs=performance.now()-p,l.length>0?(this.recordBlendHistoryBatch(l,m,d),this.layerHasContent=!0):c.length>0?(this.trackAdaptivePreviewExactSubmission(c,f),this.recordHistoryBatch(c,f,m,d),this.layerHasContent=!0):d&&(this.layerHasContent=!1),this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=c.length+l.length,c.length>0&&(this.avoidedLogicalDraws+=c.length*Math.max(0,f.count-1)),this.recordRenderedFrame(e);let h=performance.now();this.publishStats();let g=performance.now()-h;(this.pendingStamps.length>0||this.pendingBlendBatches.length>0||this.displayDirty||this.clearRequested||this.lightGlazeSession?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)&&this.requestRender(),this.recordStrokeFrameTiming(e,c.length+l.length,l.length>0?1:f.count,m,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:u,statsPublishMs:g})}recordHistoryBatch(e,t,n,r){e.length===0||e[0].historyActionId===0||(this.activeStroke&&e.some(e=>e.historyActionId===this.activeStroke?.historyActionId)&&(this.activeStroke.submitted=!0),this.historyBatches.push({kind:`paint`,settings:t,stamps:e,clearLayer:r,dirtyRect:n.dirtyRect,shapeOccupancySelection:n.shapeOccupancySelection,shapeMaskIdentity:this.shapeMaskIdentity,grainTextureIdentity:this.isTexturizedGrainActive(t)?this.grainTextureIdentity:null}),this.historyStoredBaseStamps+=e.length,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCapturedBaseStamps+=e.length,this.activeStrokeProfile.historyCapturedBatches+=1))}truncateRedoHistory(){this.historyCursor>=this.historyActions.length||(this.historyActions.length=this.historyCursor,this.historyCompactionPending=!0)}compactDiscardedHistory(){if(!this.historyCompactionPending)return;let e=new Set(this.historyActions.filter(e=>e.kind===`stroke`).map(e=>e.id)),t=[],n=0;for(let r of this.historyBatches){if(r.kind===`blend`){if(!e.has(r.actionId))continue;t.push(r),n+=r.batches.length;continue}let i=r.stamps.filter(t=>e.has(t.historyActionId));i.length!==0&&(t.push(i.length===r.stamps.length?r:{...r,stamps:i}),n+=i.length)}this.historyBatches=t,this.historyStoredBaseStamps=n,this.historyCompactionPending=!1}visibleHistoryStrokeIds(){let e=0;for(let t=this.historyCursor-1;t>=0;--t)if(this.historyActions[t].kind===`clear`){e=t+1;break}let t=new Set;for(let n=e;n<this.historyCursor;n+=1){let e=this.historyActions[n];e.kind===`stroke`&&t.add(e.id)}return t}hasVisibleHistoryContent(){return this.visibleHistoryStrokeIds().size>0}resetHistoryState(){this.historyActions=[],this.historyCursor=0,this.nextHistoryActionId=1,this.historyBatches=[],this.historyStoredBaseStamps=0,this.historyCompactionPending=!1}async moveHistoryCursor(e){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;let t=this.historyCursor+e;if(t<0||t>this.historyActions.length)return!1;let n=this.historyCursor;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(e<0?`Undo: ricostruzione del layer…`:`Redo: ricostruzione del layer…`,`working`);try{await this.waitForIdle(),this.compactDiscardedHistory(),this.historyCursor=t;try{await this.rebuildLayerFromHistory()}catch(e){this.historyCursor=n;try{await this.rebuildLayerFromHistory()}catch(t){let n=e instanceof Error?e.message:String(e),r=t instanceof Error?t.message:String(t);throw Error(`Undo/Redo non riuscito (${n}) e ripristino fallito (${r}).`)}throw e}return this.activeStrokeProfile&&(this.activeStrokeProfile.historyReplayOperations+=1),this.callbacks.onStatus?.(e<0?`Undo completato.`:`Redo completato.`,`ok`),!0}finally{this.historyBusy=!1,this.publishHistoryState()}}async rebuildLayerFromHistory(){this.blendRenderer?.beginStroke(0);let e=this.visibleHistoryStrokeIds(),t=-1,n=-1;for(let r=0;r<this.historyBatches.length;r+=1){let i=this.historyBatches[r];(i.kind===`blend`?e.has(i.actionId):i.stamps.some(t=>e.has(t.historyActionId)))&&(t<0&&(t=r),n=r)}try{if(n<0)this.submitImmediate([],!0,this.settings,!0,null);else{let r=this.historyBatches[t];r.clearLayer||this.submitImmediate([],!0,r.settings,!1,null);for(let r=t;r<=n;r+=1){let t=this.historyBatches[r];if(t.kind===`blend`){if(!e.has(t.actionId))continue;this.submitBlendImmediate(t.batches,t.clearLayer,t.settings,t.actionId,r===n,t);continue}let i=t.stamps.every(t=>e.has(t.historyActionId))?t.stamps:t.stamps.filter(t=>e.has(t.historyActionId));if(i.length!==0){if(ln(t.settings.blendMode)){let a=i[0].historyActionId;if(i.some(e=>e.historyActionId!==a))throw Error(`Un batch Light Glaze storico contiene più pennellate.`);if(!this.lightGlazeSession)this.startLightGlazeSession(a,t.settings);else if(this.lightGlazeSession.historyActionId!==a)throw Error(`Ordine storico Light Glaze non valido.`);let o=!1;for(let t=r+1;t<=n;t+=1){let n=this.historyBatches[t];if(n.kind===`paint`&&n.stamps.some(t=>t.historyActionId===a&&e.has(a))){o=!0;break}}let s=this.lightGlazeSession;if(!s)throw Error(`Sessione Light Glaze storica non inizializzata.`);s.endRequested=!o,s.commitRequested=!o}this.writeBrushUniforms(t.settings),this.submitImmediate(i,t.clearLayer,t.settings,r===n,t)}}if(this.lightGlazeSession)throw Error(`La ricostruzione storica ha lasciato un tratto Light Glaze aperto.`)}}finally{this.lightGlazeSession&&this.abandonLightGlazeSession(),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings)}this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=n>=0,await this.device.queue.onSubmittedWorkDone()}selectShapeOccupancy(e){let t=Number.isFinite(e),n=t?Math.log2(L/Math.max(1,e*2)):1/0,r=t?Math.max(0,Math.ceil(n+1e-4)):-1,i=r>=0&&r<=Qt,a=i?this.shapeOccupancyActiveCells[r]:0,o=i?this.shapeOccupancyCoverageRatios[r]:0;return!t||e<en?{selectedMipLevel:null,fallbackReason:`minimum-radius`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:i?o>tn?{selectedMipLevel:null,fallbackReason:`coverage-too-dense`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:r,fallbackReason:`none`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:null,fallbackReason:`mip-out-of-range`,candidateMipLevel:r,candidateActiveCells:0,candidateCoverageRatio:0}}recordShapeSampling(e){let t=e.selectedMipLevel,n=t===null?Ge:We,r=t===null?0:this.shapeOccupancyActiveCells[t],i=t===null?0:this.shapeOccupancyCoverageRatios[t];this.lastStampGeometry=Ve,this.lastStampVerticesPerCopy=Be,this.lastShapeSamplingStrategy=n,this.lastShapeOccupancyFallbackReason=e.fallbackReason,this.lastShapeOccupancyMipLevel=t??-1,this.lastShapeOccupancyActiveCells=r,this.lastShapeOccupancyCoverageRatio=i,this.lastShapeOccupancyCandidateMipLevel=e.candidateMipLevel,this.lastShapeOccupancyCandidateActiveCells=e.candidateActiveCells,this.lastShapeOccupancyCandidateCoverageRatio=e.candidateCoverageRatio;let a=this.activeStrokeProfile;if(!a)return;a.stampGeometry=Ve,a.stampVerticesPerCopy=Be;let o=a.shapeSamplingStrategy;a.shapeSamplingStrategy=a.shapeSamplingStrategy===`none`||a.shapeSamplingStrategy===n?n:`mixed`,o!==`none`&&o!==n?a.shapeOccupancyFallbackReason=`mixed`:e.fallbackReason!==`none`&&(a.shapeOccupancyFallbackReason=a.shapeOccupancyFallbackReason===`none`||a.shapeOccupancyFallbackReason===e.fallbackReason?e.fallbackReason:`mixed`),a.shapeOccupancyCandidateMipLevel=Math.max(a.shapeOccupancyCandidateMipLevel,e.candidateMipLevel),a.shapeOccupancyCandidateActiveCells=Math.max(a.shapeOccupancyCandidateActiveCells,e.candidateActiveCells),a.shapeOccupancyCandidateCoverageRatio=Math.max(a.shapeOccupancyCandidateCoverageRatio,e.candidateCoverageRatio),t!==null&&(a.shapeOccupancyMipLevel=Math.max(a.shapeOccupancyMipLevel,t),a.shapeOccupancyActiveCells=Math.max(a.shapeOccupancyActiveCells,r),a.shapeOccupancyCoverageRatio=Math.max(a.shapeOccupancyCoverageRatio,i))}recordBlendHistoryBatch(e,t,n){if(e.length===0||e[0].actionId===0)return;let r=e[0].actionId;if(e.some(e=>e.actionId!==r))throw Error(`Un batch storico Blend contiene più pennellate.`);this.activeStroke?.historyActionId===r&&(this.activeStroke.submitted=!0);let i=e[0].settings;this.historyBatches.push({kind:`blend`,actionId:r,settings:i,batches:e.map(e=>e.batch),clearLayer:n,dirtyRect:t.dirtyRect,shapeMaskIdentity:this.shapeMaskIdentity,grainTextureIdentity:this.isTexturizedGrainActive(i)?this.grainTextureIdentity:null}),this.historyStoredBaseStamps+=e.length,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCapturedBaseStamps+=e.length,this.activeStrokeProfile.historyCapturedBatches+=1)}adaptivePreviewRgb(n,r,i=e(r.color)){let a=r.jitterMaster,o=(_n(n,1)-.5)*2*(r.hueJitterDegrees/360)*a,s=(_n(n,2)-.5)*2*r.saturationJitter*a,c=(_n(n,3)-.5)*2*r.lightnessJitter*a,l=_n(n,4)*r.darknessJitter*a,u=t(i[2]+c,0,1);return yn(i[0]+o,i[1]+s,u*(1-l))}prepareAdaptivePreviewShapePalette(n){let r=this.adaptivePreviewShapeSprite;if(n.shape!==`shape`||!r||!this.adaptivePreviewContext)return;let i=[n.color,n.jitterMaster,n.hueJitterDegrees,n.saturationJitter,n.lightnessJitter,n.darknessJitter,n.hardness].join(`|`);if(i===this.adaptivePreviewShapePaletteKey)return;let a=e(n.color),o=document.createElement(`canvas`);o.width=r.width,o.height=r.height;let s=o.getContext(`2d`),c=r.getContext(`2d`);if(!s||!c){this.adaptivePreviewShapePalette=[],this.adaptivePreviewShapePaletteKey=i;return}let l=c.getImageData(0,0,r.width,r.height),u=t(n.hardness,0,1);for(let e=3;e<l.data.length;e+=4){let n=l.data[e]/255,r=n*n*(1-u)+n*u;l.data[e]=Math.round(t(r,0,1)*255)}s.putImageData(l,0,0);let d=[],f=new Set;for(let e=0;e<kt;e+=1){let t=gn(Math.imul(e+1,2654435761)^2769414579),[i,s,c]=this.adaptivePreviewRgb(t,n,a),l=`rgb(${i} ${s} ${c})`;if(f.has(l))continue;let u=document.createElement(`canvas`);u.width=r.width,u.height=r.height;let p=u.getContext(`2d`);p&&(p.drawImage(o,0,0),p.globalCompositeOperation=`source-in`,p.fillStyle=l,p.fillRect(0,0,u.width,u.height),d.push({red:i,green:s,blue:c,sprite:u}),f.add(l))}this.adaptivePreviewShapePalette=d,this.adaptivePreviewShapePaletteKey=i}nearestAdaptivePreviewShapeSprite(e){let t=null,n=1/0;for(let r of this.adaptivePreviewShapePalette){let i=r.red-e.red,a=r.green-e.green,o=r.blue-e.blue,s=i*i+a*a+o*o;s<n&&(t=r,n=s)}return t?.sprite??null}adaptivePreviewCandidatesForFrame(){return this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2)}finishAdaptivePreviewLifetime(e=performance.now()){this.adaptivePreviewStartedAt<=0||(this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs=Math.max(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs,e-this.adaptivePreviewStartedAt)),this.adaptivePreviewStartedAt=0)}clearAdaptivePreviewCanvas(){let e=this.adaptivePreviewCanvas,t=this.adaptivePreviewContext;if(!(!e||!t)){if(!(e.style.opacity===`1`||this.adaptivePreviewLastPresentedSerial>0||this.adaptivePreviewCandidates.some(e=>e.presented))){this.adaptivePreviewLastPresentedSerial=0;return}t.setTransform(1,0,0,1,0,0),t.globalAlpha=1,t.globalCompositeOperation=`source-over`,t.clearRect(0,0,e.width,e.height),e.style.opacity=`0`,e.style.left=`-10000px`,e.style.top=`-10000px`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1}}hideConfirmedStaleAdaptivePreviewBitmap(){let e=this.adaptivePreviewCanvas;if(!e||e.style.opacity!==`1`||this.adaptivePreviewLastPresentedSerial<=0||this.adaptivePreviewLastPresentedSerial>this.adaptivePreviewConfirmedSerial||this.hasAdaptivePreviewPresentedUnboundCandidate())return!1;e.style.opacity=`0`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1;return this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewConfirmedStaleBitmapHides+=1),!0}requestAdaptivePreviewIncompleteFrameRetry(e){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen)return;let t=0;for(let n of e)n.serial!==null&&(t=Math.max(t,n.serial));t<=0||t<=this.adaptivePreviewLastIncompleteRetrySerial||(this.adaptivePreviewLastIncompleteRetrySerial=t,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewIncompleteFrameRetryRequests+=1),this.requestAdaptivePreviewDraw())}finishIncompleteAdaptivePreviewFrame(e,t,n,r){this.hideConfirmedStaleAdaptivePreviewBitmap(),r&&this.requestAdaptivePreviewIncompleteFrameRetry(n),this.recordAdaptivePreviewJsFrame(e,t)}cancelAdaptivePreviewProbe(){let e=this.adaptivePreviewProbe;e&&(window.clearTimeout(e.timeout),this.adaptivePreviewProbe=null,e.telemetryProfile&&(e.telemetryProfile.adaptivePreviewProbeCancellations+=1))}invalidateAdaptivePreview(){this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewSubmittedSerial=0,this.adaptivePreviewConfirmedSerial=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewCandidates.length=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.clearAdaptivePreviewCanvas()}activateAdaptivePreview(e){if(this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewCandidates.length===0)return;if(this.adaptivePreviewCandidates[this.adaptivePreviewCandidates.length-1].settings.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1);return}this.adaptivePreviewActive=!0;let t=performance.now();this.adaptivePreviewStartedAt=t;let n=this.activeStrokeProfile;if(n){let r=t-n.startedAt;n.adaptivePreviewActivations===0?(n.adaptivePreviewFirstActivationReason=e,n.adaptivePreviewFirstActivationMs=r):n.adaptivePreviewActivations===1&&(n.adaptivePreviewSecondActivationReason=e,n.adaptivePreviewSecondActivationMs=r),n.adaptivePreviewActivations+=1,n.adaptivePreviewActivationReason=n.adaptivePreviewActivationReason===`none`||n.adaptivePreviewActivationReason===e?e:`mixed`}this.requestAdaptivePreviewDraw()}retireAdaptivePreview(e){let t=this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0;this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewCandidates.length=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.clearAdaptivePreviewCanvas(),t&&e&&this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewRetirements+=1)}retireAdaptivePreviewAfterGpuIdle(){this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0?(this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,this.adaptivePreviewSubmittedSerial),this.adaptivePreviewFrozen?this.scheduleAdaptivePreviewRetirement():this.scheduleAdaptivePreviewCatchUpClear()):this.clearAdaptivePreviewCanvas()}hasAdaptivePreviewPresentedUnboundCandidate(){return this.adaptivePreviewCandidates.some(e=>e.presented&&e.serial===null)}hasAdaptivePreviewUnconfirmedCandidate(){return this.adaptivePreviewCandidates.some(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial)}scheduleAdaptivePreviewRetirement(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null;let t=this.adaptivePreviewRetirementTargetSerial;e!==this.adaptivePreviewGeneration||!this.adaptivePreviewFrozen||this.hasAdaptivePreviewPresentedUnboundCandidate()||t<=0||this.adaptivePreviewConfirmedSerial<t||this.retireAdaptivePreview(!0)})}scheduleAdaptivePreviewCatchUpClear(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration,t=this.adaptivePreviewLastPresentedSerial;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewConfirmedSerial<t||this.hasAdaptivePreviewUnconfirmedCandidate())&&(this.adaptivePreviewForceStroke&&this.activeStroke?this.clearAdaptivePreviewCanvas():this.retireAdaptivePreview(!0))})}freezeAdaptivePreviewAtLift(){if(!this.adaptivePreviewActive){this.invalidateAdaptivePreview();return}this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null);let e=this.activeStroke;if(e){let t=[],n=0,r=xt;for(let n=this.pendingStamps.length-1;n>=0&&t.length<r;--n){let r=this.pendingStamps[n];r.historyActionId===e.historyActionId&&t.unshift(r)}for(let e of t)this.adaptivePreviewCandidates.some(t=>t.stamp===e)||(this.adaptivePreviewCandidates.push({serial:null,stamp:e,settings:this.settings,presented:!1}),n+=1);this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.slice(-2),this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewLiftPendingBaseStamps+=n)}if(this.adaptivePreviewFrozen=!0,this.drawAdaptivePreviewFrame(),this.adaptivePreviewLastPresentedSerial<=0&&!this.hasAdaptivePreviewPresentedUnboundCandidate()){this.invalidateAdaptivePreview();return}if(this.adaptivePreviewRetirementTargetSerial=this.adaptivePreviewLastPresentedSerial,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewFrozenAtLift+=1),!this.hasAdaptivePreviewPresentedUnboundCandidate()){if(this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial){this.scheduleAdaptivePreviewRetirement();return}this.startAdaptivePreviewProbe(!0)}}requestAdaptivePreviewDraw(){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewFrameRequest!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewFrameRequest=requestAnimationFrame(()=>{this.adaptivePreviewFrameRequest=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen)&&this.drawAdaptivePreviewFrame()})}increaseAdaptiveSpacing(e){let t=this.activeStroke;if(!t||this.adaptivePreviewFrozen)return;let n=t.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints,r=Math.min(n,t.adaptiveSpacingPercent+It);if(r<=t.adaptiveSpacingPercent)return;t.adaptiveSpacingPercent=r;let i=this.activeStrokeProfile;i&&(i.adaptiveSpacingFinalPercent=r,i.adaptiveSpacingEvents.push({offsetMs:Math.max(0,performance.now()-i.startedAt),reason:e,spacingPercent:r,extraPercentPoints:r-t.adaptiveSpacingInitialPercent,backlogBaseStamps:Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),generatedBaseStamps:i.baseStamps}))}startAdaptivePreviewProbe(e){if(!this.adaptivePreviewContext||this.adaptivePreviewProbe||this.adaptivePreviewSubmittedSerial<=this.adaptivePreviewConfirmedSerial||!this.activeStroke&&!this.adaptivePreviewFrozen||!e&&this.adaptivePreviewSubmissionsSinceProbe<At)return;let t=performance.now(),n=this.activeStrokeProfile,r=Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),i={generation:this.adaptivePreviewGeneration,startedAt:t,prefixSerial:this.adaptivePreviewSubmittedSerial,timeout:0,spacingIncreaseApplied:!1,telemetryProfile:n};n&&(n.adaptivePreviewProbeStarts+=1,n.adaptivePreviewProbeBacklogBaseStamps.push(r)),this.adaptivePreviewSubmissionsSinceProbe=0,i.timeout=window.setTimeout(()=>{let e=performance.now();this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration||!this.activeStroke||this.adaptivePreviewFrozen||(i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeTimeouts+=1,i.telemetryProfile.adaptivePreviewProbeTimeoutLatenessMs.push(Math.max(0,e-(i.startedAt+jt)))),i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`probe-timeout`),this.activateAdaptivePreview(`probe-timeout`))},jt),this.adaptivePreviewProbe=i,this.device.queue.onSubmittedWorkDone().then(()=>{if(this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration)return;window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null;let e=performance.now()-i.startedAt;e>=Mt&&!i.spacingIncreaseApplied&&(i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`slow-completion`)),this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,i.prefixSerial);let t=i.telemetryProfile;if(t&&(t.adaptivePreviewProbeLatencyMs.push(e),e>=Mt?t.adaptivePreviewProbeResolvedSlow+=1:t.adaptivePreviewProbeResolvedFast+=1,e>=Pt&&e<jt&&(t.adaptivePreviewProbeNearMisses+=1),t.adaptivePreviewMaxQueueProbeLatencyMs=Math.max(t.adaptivePreviewMaxQueueProbeLatencyMs,e)),this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial),this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0);return}if(e>=Mt?this.adaptivePreviewConsecutiveSlowProbes+=1:this.adaptivePreviewConsecutiveSlowProbes=0,!this.adaptivePreviewActive&&this.activeStroke&&this.adaptivePreviewConsecutiveSlowProbes>=Nt&&this.activateAdaptivePreview(`consecutive-slow`),this.adaptivePreviewActive)if(this.adaptivePreviewCandidates.length>0)this.requestAdaptivePreviewDraw();else{this.scheduleAdaptivePreviewCatchUpClear();return}this.activeStroke&&this.adaptivePreviewSubmittedSerial>this.adaptivePreviewConfirmedSerial&&this.startAdaptivePreviewProbe(this.adaptivePreviewActive||this.adaptivePreviewSubmissionsSinceProbe>=At)}).catch(()=>{i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeRejections+=1),this.adaptivePreviewProbe===i&&(window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null),i.generation===this.adaptivePreviewGeneration&&this.invalidateAdaptivePreview()})}trackAdaptivePreviewExactSubmission(e,t){let n=this.activeStrokeProfile;n&&(n.adaptivePreviewExactBaseStampsSubmitted+=e.length,n.adaptivePreviewExactBatchesSubmitted+=1);let r=this.adaptivePreviewSubmittedSerial;this.adaptivePreviewSubmittedSerial+=e.length,this.adaptivePreviewSubmissionsSinceProbe+=1,n&&(n.adaptivePreviewMaxUnconfirmedBaseStamps=Math.max(n.adaptivePreviewMaxUnconfirmedBaseStamps,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial));for(let t of this.adaptivePreviewCandidates){if(t.serial!==null)continue;let i=e.indexOf(t.stamp);i<0||(t.serial=r+i+1,n&&(n.adaptivePreviewLiftPendingSerialBindings+=1),t.presented&&(this.adaptivePreviewLastPresentedSerial=Math.max(this.adaptivePreviewLastPresentedSerial,t.serial),this.adaptivePreviewRetirementTargetSerial=Math.max(this.adaptivePreviewRetirementTargetSerial,t.serial)))}if(this.adaptivePreviewFrozen||!this.activeStroke){if(this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewRetirementTargetSerial>0&&this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0)}return}if(this.isTexturizedGrainActive(t)){n&&(n.grainAdaptivePreviewSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),this.startAdaptivePreviewProbe(!1);return}if(t.blendMode!==`normal`){n&&(n.adaptivePreviewUnsupportedBlendSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),ln(t.blendMode)&&this.startAdaptivePreviewProbe(!1);return}let i=xt,a=Math.max(0,e.length-i);for(let n=a;n<e.length;n+=1)this.adaptivePreviewCandidates.some(t=>t.stamp===e[n])||this.adaptivePreviewCandidates.push({serial:r+n+1,stamp:e[n],settings:t,presented:!1});this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2),this.adaptivePreviewForceStroke&&this.activateAdaptivePreview(`diagnostic-force`),this.adaptivePreviewActive&&this.requestAdaptivePreviewDraw(),this.startAdaptivePreviewProbe(this.adaptivePreviewActive)}recordAdaptivePreviewJsFrame(e,t){let n=performance.now()-e,r=this.activeStrokeProfile;r&&(r.adaptivePreviewJsTotalMs+=n,r.adaptivePreviewJsFrameMs.push(n),!t&&n>yt&&(r.adaptivePreviewBudgetSkips+=1))}drawAdaptivePreviewFrame(){let n=performance.now(),r=this.adaptivePreviewCanvas,i=this.adaptivePreviewContext,a=this.adaptivePreviewScratchCanvas,o=this.adaptivePreviewScratchContext,s=this.adaptivePreviewCandidatesForFrame();if(!r||!i||!a||!o||s.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let c=s[s.length-1].settings;if(this.isTexturizedGrainActive(c)){this.activeStrokeProfile&&(this.activeStrokeProfile.grainAdaptivePreviewSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.shape===`shape`&&(this.prepareAdaptivePreviewShapePalette(c),this.adaptivePreviewShapePalette.length===0)){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let l=this.canvasCssWidth,u=this.canvasCssHeight,d=Math.max(1,this.canvas.width),f=Math.max(1,this.canvas.height),p=this.zoom*l/d,m=this.zoom*u/f,h=(Math.abs(p)+Math.abs(m))*.5;if(l<=0||u<=0||!Number.isFinite(h)||h<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let g=[];for(let n=0;n<s.length;n+=1){let r=s[n],i=r.settings;if(i.shape!==c.shape||i.blendMode!==c.blendMode)continue;let a=r.stamp,o=Math.fround(a.x),d=Math.fround(a.y),f=Math.fround(a.radius);if(f<=0)continue;let _=Math.fround(a.directionX),v=Math.fround(a.directionY),y=Math.hypot(_,v),b=y>1e-4?_/y:1,x=y>1e-4?v/y:0,S=e(i.color),C=t(i.flow*i.opacity*i.blendIntensity,0,.999999)*Ot,w=t(Math.round(i.count),1,24);for(let e=0;e<w;e+=1){let t=gn((a.seed^Math.imul(e,2246822507))>>>0),r=(_n(t,5)-.5)*4*f*Math.fround(i.positionJitterLinear),s=(_n(t,6)-.5)*4*f*Math.fround(i.positionJitterLateral),c=o+b*r-x*s,_=d+x*r+b*s,v=i.shape===`shape`?(_n(t,7)-.5)*Math.PI*2*i.shapeScatter:0,y=i.jitterPerCopy?t:gn(a.seed),[w,T,E]=this.adaptivePreviewRgb(y,i,S);g.push({x:(c-this.viewCenterX)*p+l*.5,y:(_-this.viewCenterY)*m+u*.5,radius:Math.max(.25,f*h),rotation:v,alpha:C,candidateIndex:n,red:w,green:T,blue:E,color:`rgb(${w} ${T} ${E})`})}}if(g.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(performance.now()-n>yt){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}let _=1/0,v=1/0,y=-1/0,b=-1/0;for(let e of g){let t=c.shape===`shape`?e.radius*(Math.abs(Math.cos(e.rotation))+Math.abs(Math.sin(e.rotation))):e.radius;_=Math.min(_,e.x-t),v=Math.min(v,e.y-t),y=Math.max(y,e.x+t),b=Math.max(b,e.y+t)}let x=Math.max(0,_-Dt),S=Math.max(0,v-Dt),C=Math.min(l,y+Dt),w=Math.min(u,b+Dt),T=Math.max(0,C-x),E=Math.max(0,w-S);if(T<=0||E<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(T>wt||E>wt){let e=this.activeStrokeProfile;e&&(e.adaptivePreviewOversizedSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let D=(e,t)=>Math.min(t,Math.max(Tt,Math.ceil(e/Et)*Et)),O=D(T,Math.min(wt,Math.ceil(l))),k=D(E,Math.min(wt,Math.ceil(u))),A=t(Math.floor((x+C-O)*.5),0,Math.max(0,Math.ceil(l)-O)),ee=t(Math.floor((S+w-k)*.5),0,Math.max(0,Math.ceil(u)-k)),te=d/l*vt,ne=f/u*vt,j=Math.max(1,Math.ceil(O*te)),M=Math.max(1,Math.ceil(k*ne));(a.width!==j||a.height!==M)&&(a.width=j,a.height=M),o.setTransform(1,0,0,1,0,0),o.globalCompositeOperation=`source-over`,o.globalAlpha=1,o.clearRect(0,0,j,M),o.imageSmoothingEnabled=!0,o.imageSmoothingQuality=`low`;let re=j/O,N=M/k,ie=new Set,ae=0,oe=!1,se=!0,ce=Math.max(0,yt-bt);for(let e of g){if(performance.now()-n>ce){oe=!0,se=!1;break}let r=(e.x-A)*re,i=(e.y-ee)*N,a=e.radius*re,s=e.radius*N;if(o.globalAlpha=e.alpha,c.shape===`shape`){let t=this.nearestAdaptivePreviewShapeSprite(e);if(!t){se=!1;break}o.save(),o.translate(r,i),o.rotate(e.rotation),o.drawImage(t,-a,-s,a*2,s*2),o.restore()}else if(o.beginPath(),o.ellipse(r,i,a,s,0,0,Math.PI*2),o.fillStyle=e.color,c.hardness>=.995)o.fill();else{let n=o.createRadialGradient(r,i,0,r,i,Math.max(a,s)),l=t(c.hardness,0,.999);n.addColorStop(0,e.color),n.addColorStop(l,e.color),n.addColorStop(1,`rgb(${e.red} ${e.green} ${e.blue} / 0)`),o.fillStyle=n,o.fill()}ie.add(e.candidateIndex),ae+=1}if(o.globalAlpha=1,!se||oe||ae!==g.length||performance.now()-n>ce){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}(r.width!==j||r.height!==M)&&(r.width=j,r.height=M),(this.adaptivePreviewCssWidth!==O||this.adaptivePreviewCssHeight!==k)&&(r.style.width=`${O}px`,r.style.height=`${k}px`,this.adaptivePreviewCssWidth=O,this.adaptivePreviewCssHeight=k),r.style.left=`${A}px`,r.style.top=`${ee}px`,i.setTransform(1,0,0,1,0,0),i.globalCompositeOperation=`copy`,i.globalAlpha=1,i.drawImage(a,0,0),i.globalCompositeOperation=`source-over`;for(let e of this.adaptivePreviewCandidates)e.presented=!1;let le=0;for(let e of ie){let t=s[e];t.presented=!0,t.serial!==null&&(le=Math.max(le,t.serial))}this.adaptivePreviewLastPresentedSerial=le,r.style.opacity=`1`;let P=this.activeStrokeProfile;P&&(P.adaptivePreviewFrames+=1,P.adaptivePreviewBaseStampsDrawn+=ie.size,P.adaptivePreviewPhysicalCopiesDrawn+=ae,P.adaptivePreviewPatchPixels+=j*M,P.adaptivePreviewMaxPatchBackingPixels=Math.max(P.adaptivePreviewMaxPatchBackingPixels,j*M)),this.recordAdaptivePreviewJsFrame(n,!1)}submitLightGlazeImmediate(e,t,n,r,i){this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0);let a=this.lightGlazeSession;if(!a||!ln(a.settings.blendMode))throw Error(`Sessione Light Glaze mancante durante il rendering.`);if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let o=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==o)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);this.ensureLightGlazeResources();let s=this.isTexturizedGrainActive(n),c=n.blendMode===`m1-glaze`,l=performance.now();if(r&&this.ensurePresentationCacheTexture(),this.writeBrushUniforms({...n,opacity:1,blendMode:`normal`}),s&&this.writeGrainUniforms(n),c&&a.tintLinear===null&&e.length>0){let[t,r,i]=this.adaptivePreviewRgb(gn(e[0].seed),n);a.tintLinear=[bn(t),bn(r),bn(i)]}this.writeLightGlazeUniforms(n.opacity,c?`m1-max-coverage`:`source-over`,a.tintLinear);let u=this.device.createCommandEncoder({label:`Light Glaze frame encoder`}),d=0,f=0,p=0,m=0,h=0,g=0,_=null,v=null,y=0,b=0,x=0,S=0,C=0,w=0,T=!1,E=this.paintDisplaySelectedMipLevel,D=0,O=0,k=0,A=0,ee=0,te=0,ne=0,j=0,M=0,re=0,N=0,ie=0,ae=0,oe=0,se=0,ce=0,le=0,P=performance.now();if(t&&(u.beginRenderPass({label:`Clear permanent layer before Light Glaze`,colorAttachments:[{view:this.layerView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),this.paintDisplayMipValidThroughLevel=0),e.length>0){let t=performance.now(),r=this.packStamps(e,n);_=i?i.dirtyRect:r,d=performance.now()-t;let o=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*Le),n.shape===`shape`&&(v=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),f=performance.now()-o;let l=u.beginRenderPass({label:`Accumulate Light Glaze stroke`,colorAttachments:[{view:this.lightGlazeView,loadOp:a.needsClear?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(_){g=_.width*_.height;let t=n.shape===`shape`,r=v?.selectedMipLevel??null,a=t&&r!==null,o=c?s?t?a?this.grainM1GlazeShapeOccupancyPipeline:this.grainM1GlazeShapePipeline:this.grainM1GlazePipeline:t?a?this.m1GlazeShapeOccupancyPipeline:this.m1GlazeShapePipeline:this.m1GlazePipeline:s?t?a?this.grainShapeOccupancyNormalPipeline:this.grainShapeNormalPipeline:this.grainNormalPipeline:t?a?this.shapeOccupancyNormalPipeline:this.shapeNormalPipeline:this.normalPipeline;l.setPipeline(o),l.setBindGroup(0,s?a?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][r]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.brushOccupancyBindGroups[r]:this.brushBindGroup),l.setScissorRect(_.x,_.y,_.width,_.height),t&&v&&!i&&this.recordShapeSampling(v),l.draw(Be,e.length*n.count,0,0),s&&(ae=1,oe=e.length,se=e.length*n.count,ce=+!t,le=+!!t)}l.end(),a.needsClear=!1,a.hasContent=a.hasContent||_!==null,a.dirtyRect=this.mergeDirtyRects(a.dirtyRect,_),j=1}if(p+=performance.now()-P,!r&&(t||e.length>0||a.commitRequested)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0),r){let e=performance.now();E=this.desiredPaintDisplayMipLevel(),E!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=E;let n=this.canvas.width*this.canvas.height;if(C=n,w=n,!a.commitRequested){if(a.hasContent){let e=this.encodeLightGlazeDisplayPyramid(u,a,_,E);N+=e.passes,ie+=e.updatedPixels}else{let e=this.encodePaintDisplayPyramid(u,t?{x:0,y:0,width:F,height:F}:null,E);D+=e.maintenanceFrames,O+=e.fullLevelBuilds,k+=e.dirtyLevelUpdates,A+=e.passes,ee+=e.baseDirtyPixels,te+=e.updatedPixels,ne+=e.encodingMs}let e=this.presentationCacheNeedsFullRebuild||t,n=e?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:_?this.layerDirtyRectToPresentationRect(_,E):null;if(n){this.writeDisplayUniforms(E);let t=u.beginRenderPass({label:e?`Rebuild presentation cache with live Light Glaze`:`Update presentation cache with live Light Glaze`,colorAttachments:[{view:this.presentationCacheView,loadOp:e?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});t.setPipeline(a.hasContent?this.lightGlazeDisplayPipeline:this.displayPipeline),t.setBindGroup(0,a.hasContent?this.lightGlazeDisplayBindGroup:this.displayBindGroup),e||t.setScissorRect(n.x,n.y,n.width,n.height),t.draw(3,1,0,0),t.end(),T=!0,S=n.width*n.height,e?y=1:b=1}else _&&(x=1)}m+=performance.now()-e}if(a.commitRequested){if(a.hasContent&&a.dirtyRect){let e=performance.now(),t=u.beginRenderPass({label:`Commit complete Light Glaze stroke once`,colorAttachments:[{view:this.layerView,loadOp:`load`,storeOp:`store`}]});t.setPipeline(this.lightGlazeCompositePipeline),t.setBindGroup(0,this.lightGlazeCompositeBindGroup),t.setScissorRect(a.dirtyRect.x,a.dirtyRect.y,a.dirtyRect.width,a.dirtyRect.height),t.draw(3,1,0,0),t.end(),p+=performance.now()-e,M=1,re=a.dirtyRect.width*a.dirtyRect.height}if(r){let e=performance.now(),n=t?{x:0,y:0,width:F,height:F}:a.dirtyRect,r=this.encodePaintDisplayPyramid(u,n,E);D+=r.maintenanceFrames,O+=r.fullLevelBuilds,k+=r.dirtyLevelUpdates,A+=r.passes,ee+=r.baseDirtyPixels,te+=r.updatedPixels,ne+=r.encodingMs;let i=this.presentationCacheNeedsFullRebuild||t,o=i?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:a.dirtyRect?this.layerDirtyRectToPresentationRect(a.dirtyRect,E):null;if(o){this.writeDisplayUniforms(E);let e=u.beginRenderPass({label:i?`Rebuild canonical presentation cache after Light Glaze commit`:`Canonicalize Light Glaze presentation cache after commit`,colorAttachments:[{view:this.presentationCacheView,loadOp:i?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});e.setPipeline(this.displayPipeline),e.setBindGroup(0,this.displayBindGroup),i||e.setScissorRect(o.x,o.y,o.width,o.height),e.draw(3,1,0,0),e.end(),T=!0,S=o.width*o.height,i?y=1:b=1}else a.dirtyRect&&(x=1);m+=performance.now()-e}}if(r){let e=performance.now(),t=this.context.getCurrentTexture();u.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:t},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),m+=performance.now()-e}let ue=performance.now();return this.device.queue.submit([u.finish()]),h=performance.now()-ue,r&&T&&(this.presentationCacheNeedsFullRebuild=!1),a.commitRequested&&(this.lightGlazeSession=null),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),{totalCpuMs:performance.now()-l,stampPackingMs:d,instanceUploadMs:f,brushEncodingMs:p,displayEncodingMs:m,commandSubmitMs:h,scissorPixels:g,dirtyRect:_,shapeOccupancySelection:v,presentationCacheFullRebuilds:y,presentationCachePartialUpdates:b,presentationCacheOffscreenSkips:x,presentationCacheUpdatedPixels:S,legacyDisplayShaderPixels:C,presentationCopiedPixels:w,displaySelectedMipLevel:E,paintDisplayPyramidMaintenanceFrames:D,paintDisplayPyramidFullLevelBuilds:O,paintDisplayPyramidDirtyLevelUpdates:k,paintDisplayPyramidPasses:A,paintDisplayPyramidBaseDirtyPixels:ee,paintDisplayPyramidUpdatedPixels:te,paintDisplayPyramidEncodingMs:ne,lightGlazeBatches:j,lightGlazeCommits:M,lightGlazeCompositePixels:re,lightGlazePyramidPasses:N,lightGlazePyramidUpdatedPixels:ie,grainBatches:ae,grainBaseStamps:oe,grainPhysicalCopies:se,grainCircleBatches:ce,grainShapeBatches:le}}submitBlendImmediate(e,t,n,r,i=!0,a=null){let o=this.blendRenderer;if(!o)throw Error(`Renderer WebGPU Blend dry non inizializzato.`);if(a&&a.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape Blend usata dalla cronologia non corrisponde alla risorsa corrente.`);let s=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(a&&a.grainTextureIdentity!==s)throw Error(`Il Grain Blend usato dalla cronologia non corrisponde alla risorsa corrente.`);let c=o.submit(e,n,r,t),l=t?{x:0,y:0,width:F,height:F}:c.dirtyRect;t&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0);let u=this.submitImmediate([],!1,n,i,null,l);return{...u,totalCpuMs:u.totalCpuMs+c.cpuMs,brushEncodingMs:u.brushEncodingMs+c.cpuMs,scissorPixels:e.reduce((e,t)=>e+t.readRect.width*t.readRect.height,0),dirtyRect:c.dirtyRect,shapeOccupancySelection:null}}submitImmediate(e,t,n=this.settings,r=!0,i=null,a=null){if(ln(n.blendMode)){if(this.lightGlazeSession)return this.submitLightGlazeImmediate(e,t,n,r,i);if(e.length>0)throw Error(`Stamp Light Glaze senza sessione per-stroke.`)}let o=this.isTexturizedGrainActive(n);o&&this.writeGrainUniforms(n);let s=performance.now();r&&this.ensurePresentationCacheTexture();let c=r?this.prepareThicknessTailFrame():null;c?.grainActive&&!o&&this.writeGrainUniforms(c.settings);let l=this.device.createCommandEncoder({label:`Brush frame encoder`}),u=0,d=0,f=0,p=0,m=0,h=0,g=a,_=null,v=0,y=0,b=0,x=0,S=0,C=0,w=!1,T=this.paintDisplaySelectedMipLevel,E=0,D=0,O=0,k=0,A=0,ee=0,te=0,ne=0,j=0,M=0,re=0,N=0;if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let ie=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==ie)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);if(t||e.length>0){let r=null,a=null;if(e.length>0){let t=performance.now(),o=this.packStamps(e,n);r=i?i.dirtyRect:o,u=performance.now()-t;let s=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*Le),n.shape===`shape`&&(a=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),d=performance.now()-s}g=r,_=a;let s=performance.now(),c=l.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(e.length>0&&r){h=r.width*r.height;let t=n.shape===`shape`,s=a?.selectedMipLevel??null,l=t&&s!==null,u=o?t?l?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:t?l?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline;c.setPipeline(u),c.setBindGroup(0,o?l?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][s]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:l?this.brushOccupancyBindGroups[s]:this.brushBindGroup),c.setScissorRect(r.x,r.y,r.width,r.height),t&&a&&!i&&this.recordShapeSampling(a),c.draw(Be,e.length*n.count,0,0),o&&(ne=1,j=e.length,M=e.length*n.count,re=+!t,N=+!!t)}c.end(),f=performance.now()-s}if(c){let e=performance.now();this.encodeThicknessTailFrame(l,c),f+=performance.now()-e}if(!r&&(t||e.length>0||a)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0),r){let e=performance.now();T=this.desiredPaintDisplayMipLevel(),T!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=T;let n=t?{x:0,y:0,width:F,height:F}:g;t&&(this.paintDisplayMipValidThroughLevel=0);let r=this.encodePaintDisplayPyramid(l,n,T);E=r.maintenanceFrames,D=r.fullLevelBuilds,O=r.dirtyLevelUpdates,k=r.passes,A=r.baseDirtyPixels,ee=r.updatedPixels,te=r.encodingMs;let i=this.canvas.width*this.canvas.height;S=i,C=i;let a=this.presentationCacheNeedsFullRebuild||t,o=this.mergeDirtyRects(g,this.mergeDirtyRects(this.thicknessTailPresentedRect,c?.dirtyRect??null)),s=a?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:o?this.layerDirtyRectToPresentationRect(o,T):null;if(s){this.writeDisplayUniforms(T);let e=l.beginRenderPass({label:a?`Rebuild persistent presentation cache`:`Update persistent presentation cache dirty rect`,colorAttachments:[{view:this.presentationCacheView,loadOp:a?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});e.setPipeline(c?this.thicknessTailDisplayPipeline:this.displayPipeline),e.setBindGroup(0,c?this.thicknessTailDisplayBindGroup:this.displayBindGroup),a||e.setScissorRect(s.x,s.y,s.width,s.height),e.draw(3,1,0,0),e.end(),w=!0,x=s.width*s.height,a?v=1:y=1}else o&&(b=1);let u=this.context.getCurrentTexture();l.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:u},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),p=performance.now()-e}let ae=performance.now();return this.device.queue.submit([l.finish()]),m=performance.now()-ae,r&&w&&(this.presentationCacheNeedsFullRebuild=!1),r&&(this.thicknessTailPresentedRect=c?{...c.dirtyRect}:null),{totalCpuMs:performance.now()-s,stampPackingMs:u,instanceUploadMs:d,brushEncodingMs:f,displayEncodingMs:p,commandSubmitMs:m,scissorPixels:h,dirtyRect:g,shapeOccupancySelection:_,presentationCacheFullRebuilds:v,presentationCachePartialUpdates:y,presentationCacheOffscreenSkips:b,presentationCacheUpdatedPixels:x,legacyDisplayShaderPixels:S,presentationCopiedPixels:C,displaySelectedMipLevel:T,paintDisplayPyramidMaintenanceFrames:E,paintDisplayPyramidFullLevelBuilds:D,paintDisplayPyramidDirtyLevelUpdates:O,paintDisplayPyramidPasses:k,paintDisplayPyramidBaseDirtyPixels:A,paintDisplayPyramidUpdatedPixels:ee,paintDisplayPyramidEncodingMs:te,lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,grainBatches:ne,grainBaseStamps:j,grainPhysicalCopies:M,grainCircleBatches:re,grainShapeBatches:N}}packStampsIntoUpload(e,n,r,i){let a=F,o=F,s=0,c=0,l=1/0,u=Math.PI*n.shapeScatter,d=n.shape===`shape`?u>=Math.PI*.25?Math.SQRT2:Math.cos(u)+Math.sin(u):1;for(let t=0;t<e.length;t+=1){let u=e[t],f=Le/4*t;r[f]=u.x,r[f+1]=u.y,r[f+2]=u.radius,r[f+3]=u.pressure,i[f+4]=u.seed,i[f+5]=0,r[f+6]=u.directionX,r[f+7]=u.directionY;let p=r[f],m=r[f+1],h=r[f+2];l=Math.min(l,h);let g=r[f+6],_=r[f+7],v=Math.hypot(g,_),y=h*2*n.positionJitterLinear,b=h*2*n.positionJitterLateral,x=h*d,S,C;if(v>2e-4){let e=g/v,t=_/v;S=x+Math.abs(e)*y+Math.abs(t)*b+2,C=x+Math.abs(t)*y+Math.abs(e)*b+2}else{let e=x+y+b+2;S=e,C=e}a=Math.min(a,p-S),o=Math.min(o,m-C),s=Math.max(s,p+S),c=Math.max(c,m+C)}let f=t(Math.floor(a),0,F-1),p=t(Math.floor(o),0,F-1),m=t(Math.ceil(s),1,F),h=t(Math.ceil(c),1,F),g=Math.max(0,m-f),_=Math.max(0,h-p);return{dirtyRect:g>0&&_>0?{x:f,y:p,width:g,height:_}:null,minimumRadius:l}}packStamps(e,t){let n=this.packStampsIntoUpload(e,t,this.instanceUploadF32,this.instanceUploadU32);return this.packedMinimumRadius=n.minimumRadius,n.dirtyRect}packThicknessTailStamps(e,t){return this.packStampsIntoUpload(e,t,this.thicknessTailInstanceUploadF32,this.thicknessTailInstanceUploadU32)}generateBenchmarkStamps(e,n){let r=Array(e),i=F*.5,a=F*.39;for(let o=0;o<e;o+=1){let s=e<=1?0:o/(e-1),c=s*Math.PI*18,l=a*(.12+s*.88),u=t(.58+Math.sin(s*Math.PI*15)*.28,.1,1),d=Math.max(.5,n.size*.5);r[o]={x:i+Math.cos(c)*l,y:i+Math.sin(c*1.037)*l,radius:d,pressure:u,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(c),directionY:Math.cos(c*1.037),historyActionId:0}}return r}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r,i){let a=this.activeStrokeProfile;a&&(a.previousFrameTimestamp!==null&&a.renderIntervalMs.push(Math.max(0,e-a.previousFrameTimestamp)),a.previousFrameTimestamp=e,a.renderFrames+=1,a.cpuFrameMs.push(this.lastCpuFrameMs),a.renderFrameTotalMs.push(i.totalCpuMs),a.renderFrameOverheadMs.push(Math.max(0,i.totalCpuMs-r.totalCpuMs)),a.resizeCanvasMs+=i.resizeCanvasMs,a.batchExtractionMs+=i.batchExtractionMs,a.statsPublishMs+=i.statsPublishMs,a.stampPackingMs+=r.stampPackingMs,a.instanceUploadMs+=r.instanceUploadMs,a.brushEncodingMs+=r.brushEncodingMs,a.displayEncodingMs+=r.displayEncodingMs,a.commandSubmitMs+=r.commandSubmitMs,a.estimatedScissorPixels+=r.scissorPixels,a.presentationCacheFullRebuilds+=r.presentationCacheFullRebuilds,a.presentationCachePartialUpdates+=r.presentationCachePartialUpdates,a.presentationCacheOffscreenSkips+=r.presentationCacheOffscreenSkips,a.presentationCacheUpdatedPixels+=r.presentationCacheUpdatedPixels,a.legacyDisplayShaderPixels+=r.legacyDisplayShaderPixels,a.presentationCopiedPixels+=r.presentationCopiedPixels,a.paintDisplayMaximumSelectedMipLevel=Math.max(a.paintDisplayMaximumSelectedMipLevel,r.displaySelectedMipLevel),a.paintDisplayPyramidMaintenanceFrames+=r.paintDisplayPyramidMaintenanceFrames,a.paintDisplayPyramidFullLevelBuilds+=r.paintDisplayPyramidFullLevelBuilds,a.paintDisplayPyramidDirtyLevelUpdates+=r.paintDisplayPyramidDirtyLevelUpdates,a.paintDisplayPyramidPasses+=r.paintDisplayPyramidPasses,a.paintDisplayPyramidBaseDirtyPixels+=r.paintDisplayPyramidBaseDirtyPixels,a.paintDisplayPyramidUpdatedPixels+=r.paintDisplayPyramidUpdatedPixels,a.paintDisplayPyramidEncodingMs+=r.paintDisplayPyramidEncodingMs,a.lightGlazeBatches+=r.lightGlazeBatches,a.lightGlazeCommits+=r.lightGlazeCommits,a.lightGlazeCompositePixels+=r.lightGlazeCompositePixels,a.lightGlazePyramidPasses+=r.lightGlazePyramidPasses,a.lightGlazePyramidUpdatedPixels+=r.lightGlazePyramidUpdatedPixels,a.grainBatches+=r.grainBatches,a.grainBaseStamps+=r.grainBaseStamps,a.grainPhysicalCopies+=r.grainPhysicalCopies,a.grainCircleBatches+=r.grainCircleBatches,a.grainShapeBatches+=r.grainShapeBatches,t>0&&(a.brushBatches+=1,a.physicalCopies+=t*n,a.largestBatchStamps=Math.max(a.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}publishHistoryState(){this.callbacks.onHistoryChange?.(this.getHistoryState())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function B(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function V(e){return Number(B(e).value)}function H(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var U=B(`gpuCanvas`),wn=B(`tipPreviewCanvas`),Tn=B(`controlsPanel`),En=B(`toggleControls`),Dn=B(`status`),On=B(`runBenchmark`),kn=B(`benchmarkResult`),An=B(`recordHumanStroke`),jn=B(`playHumanStroke`),Mn=B(`playBlendHumanStroke`),W=B(`humanStrokeResult`),Nn=B(`humanStrokeTestVariant`),Pn=B(`humanStrokeTestBlendMode`),Fn=B(`humanStrokeTestGrainMode`),In=B(`layerFormat`),Ln=B(`clearLayer`),Rn=B(`undoStroke`),zn=B(`redoStroke`),Bn=B(`fitView`),Vn=B(`zoomIn`),Hn=B(`zoomOut`),Un=B(`benchmarkStamps`),Wn=`webgpu-brush-engine.human-stroke.v1`,Gn=`/api/human-stroke`,Kn=`/api/benchmark-runs`,G={canUndo:!1,canRedo:!1,busy:!1,actionCount:0,cursor:0,storedBaseStamps:0,logicalStampBytes:0},K=new Cn(U,{onStatus(e,t){Dn.textContent=e,Dn.className=`status ${t===`working`?``:t}`},onStats(e){Vr(e)},onHistoryChange(e){G=e,Z(),Y()}},wn),q=null,qn=null,Jn=!1,Yn=!1,Xn=!0,Zn=!1,Qn=!1,$n=!1,er=!1,tr=!1,nr=!0,rr=`paint`,ir={paint:{size:96,spacing:1,flow:7,hardness:88},blend:{size:100,spacing:10,flow:45,hardness:8}};function ar(){ir[rr]={size:V(`brushSize`),spacing:V(`spacing`),flow:V(`flow`),hardness:V(`hardness`)}}function or(e,t){let n=rr;t&&n!==e&&ar(),rr=e,J(`brushTool`,e);let r=e===`blend`,i=B(`brushSize`),a=B(`spacing`);if(i.min=r?`1`:`4`,i.max=r?`1024`:`1500`,a.min=r?`1`:`0.25`,a.max=r?`400`:`25`,a.step=r?`1`:`0.25`,t&&n!==e){let t=ir[e];J(`brushSize`,t.size),J(`spacing`,t.spacing),J(`flow`,t.flow),J(`hardness`,t.hardness)}for(let e of[`shapeScatterControl`,`countControl`,`opacityControl`,`paintBlendIntensityControl`,`paintBlendModeControl`,`thicknessSection`,`colorJitterSection`,`positionJitterSection`])B(e).hidden=r;B(`blendControls`).hidden=!r}function sr(e){nr=e,Tn.hidden=!e,En.setAttribute(`aria-expanded`,String(e)),En.setAttribute(`aria-label`,e?`Nascondi pannelli`:`Mostra pannelli`),En.title=e?`Nascondi pannelli`:`Mostra pannelli`}function cr(){return{tool:B(`brushTool`).value===`blend`?`blend`:`paint`,shape:B(`brushShape`).value,shapeScatter:V(`shapeScatter`)/100,grainMode:B(`grainMode`).value,grainScale:V(`grainScale`)/100,grainDepth:V(`grainDepth`)/100,grainBrightness:V(`grainBrightness`)/100,grainContrast:V(`grainContrast`)/100,grainInvert:B(`grainInvert`).checked,grainFiltering:B(`grainFiltering`).value,grainBlendMode:B(`grainBlendMode`).value,color:B(`brushColor`).value,size:V(`brushSize`),spacingPercent:V(`spacing`),startThickness:V(`startThickness`)/100,endThickness:V(`endThickness`)/100,count:V(`count`),flow:V(`flow`)/100,opacity:V(`opacity`)/100,hardness:V(`hardness`)/100,blendIntensity:V(`blendIntensity`),blendMode:B(`blendMode`).value,blendStretch:V(`blendStretch`)/100,blendPaint:V(`blendPaint`)/100,jitterMaster:V(`jitterMaster`)/100,hueJitterDegrees:V(`hueJitter`),saturationJitter:V(`saturationJitter`)/100,lightnessJitter:V(`lightnessJitter`)/100,darknessJitter:V(`darknessJitter`)/100,jitterPerCopy:B(`jitterPerCopy`).checked,positionJitterLateral:V(`positionJitterLateral`)/100,positionJitterLinear:V(`positionJitterLinear`)/100}}function lr(){B(`shapeScatterOut`).value=`${V(`shapeScatter`).toFixed(0)}%`,B(`grainScaleOut`).value=`${V(`grainScale`).toFixed(0)}%`,B(`grainDepthOut`).value=`${V(`grainDepth`).toFixed(0)}%`;let e=V(`grainBrightness`);B(`grainBrightnessOut`).value=`${e>0?`+`:``}${e.toFixed(0)}%`;let t=V(`grainContrast`);B(`grainContrastOut`).value=`${t>0?`+`:``}${t.toFixed(0)}%`,B(`brushSizeOut`).value=`${V(`brushSize`).toFixed(0)} px`,B(`spacingOut`).value=`${V(`spacing`).toFixed(2)}%`,B(`startThicknessOut`).value=`${V(`startThickness`).toFixed(0)}%`,B(`endThicknessOut`).value=`${V(`endThickness`).toFixed(0)}%`,B(`countOut`).value=V(`count`).toFixed(0),B(`flowOut`).value=`${V(`flow`).toFixed(1).replace(`.0`,``)}%`,B(`opacityOut`).value=`${V(`opacity`).toFixed(1).replace(`.0`,``)}%`,B(`hardnessOut`).value=`${V(`hardness`).toFixed(0)}%`,B(`blendIntensityOut`).value=`${V(`blendIntensity`).toFixed(2)}×`,B(`blendStretchOut`).value=`${V(`blendStretch`).toFixed(0)}%`,B(`blendPaintOut`).value=`${V(`blendPaint`).toFixed(0)}%`,B(`jitterMasterOut`).value=`${V(`jitterMaster`).toFixed(0)}%`,B(`hueJitterOut`).value=`${V(`hueJitter`).toFixed(0)}°`,B(`saturationJitterOut`).value=`${V(`saturationJitter`).toFixed(0)}%`,B(`lightnessJitterOut`).value=`${V(`lightnessJitter`).toFixed(0)}%`,B(`darknessJitterOut`).value=`${V(`darknessJitter`).toFixed(0)}%`,B(`positionJitterLateralOut`).value=`${V(`positionJitterLateral`).toFixed(0)}%`,B(`positionJitterLinearOut`).value=`${V(`positionJitterLinear`).toFixed(0)}%`,B(`benchmarkStampsOut`).value=H(V(`benchmarkStamps`))}function ur(){ar(),lr(),zr(),K.setBrushSettings(cr())}function dr(e){return`${(e/1e3).toFixed(2)} s`}function fr(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function pr(){return new Promise(e=>requestAnimationFrame(e))}function mr(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function hr(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:fr(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function gr(){let e=navigator,t=K.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,controlsLayoutStrategy:`full-stage-overlay-drawer`,touchNavigationStrategy:`two-finger-pan-pinch`,performanceTelemetryRevision:29,...t}}async function _r(e){let t=await fetch(Kn,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function vr(e){if(typeof e!=`object`||!e)return null;let t=e;if(t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0)return null;let n=t,r=Number.isFinite(n.settings.opacity)?Math.min(1,Math.max(0,n.settings.opacity)):1,i=n.settings.blendMode===`additive`||n.settings.blendMode===`light-glaze`||n.settings.blendMode===`m1-glaze`?n.settings.blendMode:`normal`,a=n.settings.grainMode===`texturized`||n.settings.grainMode===`moving`?n.settings.grainMode:`off`,o=Number.isFinite(n.settings.grainScale)?Math.min(4,Math.max(.1,n.settings.grainScale)):1.4,s=Number.isFinite(n.settings.grainDepth)?Math.min(1,Math.max(0,n.settings.grainDepth)):1,c=Number.isFinite(n.settings.grainBrightness)?Math.min(1,Math.max(-1,n.settings.grainBrightness)):0,l=Number.isFinite(n.settings.grainContrast)?Math.min(1,Math.max(-1,n.settings.grainContrast)):0,u=n.settings.grainInvert===!0,d=n.settings.grainFiltering===`no`||n.settings.grainFiltering===`classic`?n.settings.grainFiltering:`improved`,f=Number.isFinite(n.settings.startThickness)?Math.min(2,Math.max(0,n.settings.startThickness)):1,p=Number.isFinite(n.settings.endThickness)?Math.min(2,Math.max(0,n.settings.endThickness)):1,m=Number.isFinite(n.settings.blendStretch)?Math.min(1,Math.max(0,n.settings.blendStretch)):.18,h=Number.isFinite(n.settings.blendPaint)?Math.min(1,Math.max(0,n.settings.blendPaint)):.14,g={...n.settings};return delete g.speedThickness,delete g.pressureSize,delete g.pressureOpacity,{...n,settings:{...g,tool:`paint`,shape:n.settings.shape===`shape`?`shape`:`circle`,shapeScatter:Number.isFinite(n.settings.shapeScatter)?Math.min(1,Math.max(0,n.settings.shapeScatter)):0,grainMode:a,grainScale:o,grainDepth:s,grainBrightness:c,grainContrast:l,grainInvert:u,grainFiltering:d,grainBlendMode:`multiply`,startThickness:f,endThickness:p,opacity:r,blendMode:i,blendStretch:m,blendPaint:h}}}function yr(){try{let e=window.localStorage.getItem(Wn);return e?vr(JSON.parse(e)):null}catch{return null}}function br(){try{window.localStorage.removeItem(Wn)}catch{}}async function xr(){let e=await fetch(Gn,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return vr(await e.json())}async function Sr(e){let t=await fetch(Gn,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=vr(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=vr(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function Cr(){Xn=!0,Y();try{let e=await xr();if(e){q=e,br(),W.textContent=Lr(e);return}let t=yr();if(t){W.textContent=`Fissaggio del tratto che avevi già registrato…`,q=await Sr(t),br(),W.textContent=Lr(q);return}W.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){W.textContent=e instanceof Error?e.message:String(e)}finally{Xn=!1,Y()}}function J(e,t){B(e).value=String(t)}function wr(e){or(e.tool===`blend`?`blend`:`paint`,!1),J(`brushShape`,e.shape===`shape`?`shape`:`circle`),J(`shapeScatter`,(e.shapeScatter??0)*100),J(`grainMode`,e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:`off`),J(`grainScale`,(e.grainScale??1.4)*100),J(`grainDepth`,(e.grainDepth??1)*100),J(`grainBrightness`,(e.grainBrightness??0)*100),J(`grainContrast`,(e.grainContrast??0)*100),B(`grainInvert`).checked=e.grainInvert===!0,J(`grainFiltering`,e.grainFiltering===`no`||e.grainFiltering===`classic`?e.grainFiltering:`improved`),J(`grainBlendMode`,`multiply`),J(`brushColor`,e.color),J(`brushSize`,e.size),J(`spacing`,e.spacingPercent),J(`startThickness`,(e.startThickness??1)*100),J(`endThickness`,(e.endThickness??1)*100),J(`count`,e.count),J(`flow`,e.flow*100),J(`opacity`,(e.opacity??1)*100),J(`hardness`,e.hardness*100),J(`blendIntensity`,e.blendIntensity),J(`blendMode`,e.blendMode),J(`blendStretch`,(e.blendStretch??.18)*100),J(`blendPaint`,(e.blendPaint??.14)*100),J(`jitterMaster`,e.jitterMaster*100),J(`hueJitter`,e.hueJitterDegrees),J(`saturationJitter`,e.saturationJitter*100),J(`lightnessJitter`,e.lightnessJitter*100),J(`darknessJitter`,e.darknessJitter*100),B(`jitterPerCopy`).checked=e.jitterPerCopy,J(`positionJitterLateral`,e.positionJitterLateral*100),J(`positionJitterLinear`,e.positionJitterLinear*100),ur()}function Tr(){return or(`paint`,!1),J(`brushShape`,`circle`),J(`shapeScatter`,0),J(`grainMode`,`off`),J(`grainScale`,140),J(`grainDepth`,100),J(`grainBrightness`,0),J(`grainContrast`,0),B(`grainInvert`).checked=!1,J(`grainFiltering`,`improved`),J(`grainBlendMode`,`multiply`),J(`brushSize`,750),J(`spacing`,1),J(`startThickness`,100),J(`endThickness`,100),J(`count`,16),J(`flow`,100),J(`opacity`,100),J(`hardness`,100),J(`blendIntensity`,4),J(`blendMode`,`normal`),J(`blendStretch`,18),J(`blendPaint`,14),J(`jitterMaster`,100),J(`hueJitter`,180),J(`saturationJitter`,100),B(`jitterPerCopy`).checked=!0,J(`positionJitterLateral`,100),J(`positionJitterLinear`,100),ur(),cr()}function Er(){return Nn.value===`fur`?`fur`:`base`}function Dr(){return Pn.value===`m1-glaze`?`m1-glaze`:`normal`}function Or(){return Fn.value===`texturized`?`texturized`:`off`}function kr(e,t,n,r){let i={...e.settings,tool:`paint`,opacity:1,blendIntensity:n===`m1-glaze`?1:4,blendMode:n,blendStretch:.18,blendPaint:.14,grainMode:r,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,shape:`circle`,shapeScatter:0,startThickness:1,endThickness:1,positionJitterLateral:1,positionJitterLinear:1};return t===`fur`?{...i,shape:`shape`,shapeScatter:1,positionJitterLateral:0,positionJitterLinear:0}:i}function Ar(e){return{...e.settings,tool:`blend`,shape:`circle`,shapeScatter:0,grainMode:`off`,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,size:e.settings.size,spacingPercent:1,startThickness:1,endThickness:1,count:1,flow:1,opacity:1,hardness:1,blendIntensity:1,blendMode:`normal`,blendStretch:.2,blendPaint:0,jitterMaster:0,hueJitterDegrees:0,saturationJitter:0,lightnessJitter:0,darknessJitter:0,jitterPerCopy:!1,positionJitterLateral:0,positionJitterLinear:0}}function jr(e,t,n){return`${e===`fur`?`Fur`:`Base`} · ${t===`m1-glaze`?`M1 Glaze non accumulativo · 1×`:`Normal accumulativo · 4×`} · ${n===`texturized`?`Grain Fixed M1`:`Grain Off`}`}var Mr=`Blend dry · sfondo multicolore · spacing 1% · flow 100% · hardness 100% · Paint 0% · Stretch 20%`;async function Nr(e){let t=[`#ff334f`,`#ff9f1c`,`#f4e04d`,`#20c997`,`#2d7ff9`,`#8b5cf6`],n={...e,tool:`paint`,shape:`circle`,shapeScatter:0,grainMode:`off`,size:1500,spacingPercent:15,startThickness:1,endThickness:1,count:1,flow:1,opacity:1,hardness:1,blendIntensity:1,blendMode:`normal`,jitterMaster:0,hueJitterDegrees:0,saturationJitter:0,lightnessJitter:0,darknessJitter:0,jitterPerCopy:!1,positionJitterLateral:0,positionJitterLinear:0};try{for(let e=0;e<t.length;e+=1){let r=K.layerSize*e/(t.length-1),i=e*10;K.setBrushSettings({...n,color:t[e]}),K.beginStrokeAtLayer({x:0,y:r,pressure:1,timeMs:i}),K.extendStrokeAtLayer([{x:K.layerSize,y:r,pressure:1,timeMs:i+1}]),K.endStroke(i+1),await K.waitForIdle()}}finally{K.setBrushSettings(e),await K.waitForIdle()}}function Y(){let e=!tr||er||G.busy||Qn||$n;An.disabled=e||Xn||Zn||Yn||!!q,An.textContent=Jn?`Annulla registrazione tratto`:q?`Tratto umano fissato`:`Registra tratto umano`,jn.disabled=e||!q||Xn||Zn||Yn,Mn.disabled=e||!q||Xn||Zn||Yn,Nn.disabled=e||Xn||Zn||Yn||Jn||!!qn,Pn.disabled=e||Xn||Zn||Yn||Jn||!!qn,Fn.disabled=e||Xn||Zn||Yn||Jn||!!qn}function Pr(){return!tr||er||G.busy||Qn||$n||Yn||Zn}function X(){return Pr()||Q!==null}function Z(){let e=X();Rn.disabled=e||!G.canUndo,zn.disabled=e||!G.canRedo,Ln.disabled=e;let t=rr===`blend`;On.disabled=e||t,Un.disabled=e||t,In.disabled=e,Bn.disabled=e,Vn.disabled=e,Hn.disabled=e,En.disabled=Qn||Yn;for(let t of Br)B(t).disabled=e;zr(e)}async function Fr(e){if(!(X()||Q!==null)&&!(e===`undo`?!G.canUndo:!G.canRedo)){er=!0,Z(),Y();try{e===`undo`?await K.undo():await K.redo()}catch(e){Dn.textContent=e instanceof Error?e.message:String(e),Dn.className=`status error`}finally{er=!1,G=K.getHistoryState(),Z(),Y()}}}async function Ir(){if(!(X()||Q!==null)){er=!0,Z(),Y();try{await K.clear()}catch(e){Dn.textContent=e instanceof Error?e.message:String(e),Dn.className=`status error`}finally{er=!1,G=K.getHistoryState(),Z(),Y()}}}function Lr(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${H(e.points.length)} campioni`,`durata ${dr(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}var Rr=[`grainScale`,`grainDepth`,`grainBrightness`,`grainContrast`,`grainInvert`,`grainFiltering`,`grainBlendMode`];function zr(e=X()){let t=B(`grainMode`).value,n=t===`texturized`||t===`moving`;B(`grainParameters`).hidden=!n;for(let r of Rr)B(r).disabled=e||!n||r===`grainScale`&&t===`moving`}var Br=[`brushTool`,`brushShape`,`shapeScatter`,`grainMode`,...Rr,`brushColor`,`brushSize`,`spacing`,`startThickness`,`endThickness`,`count`,`flow`,`opacity`,`hardness`,`blendIntensity`,`blendMode`,`blendStretch`,`blendPaint`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`];for(let e of Br)e!==`brushTool`&&(B(e).addEventListener(`input`,ur),B(e).addEventListener(`change`,ur));B(`brushTool`).addEventListener(`change`,()=>{or(B(`brushTool`).value===`blend`?`blend`:`paint`,!0),ur(),Z()}),Un.addEventListener(`input`,lr),En.addEventListener(`click`,()=>{En.disabled||sr(!nr)}),Ln.addEventListener(`click`,()=>{Ir()}),Rn.addEventListener(`click`,()=>{Fr(`undo`)}),zn.addEventListener(`click`,()=>{Fr(`redo`)}),Bn.addEventListener(`click`,()=>{!X()&&Q===null&&K.fitView()}),Vn.addEventListener(`click`,()=>{!X()&&Q===null&&K.zoomBy(1.35)}),Hn.addEventListener(`click`,()=>{!X()&&Q===null&&K.zoomBy(1/1.35)}),In.addEventListener(`change`,async()=>{if(X()||Q!==null){In.value=K.getStats().layerFormat;return}let e=In.value;$n=!0,In.disabled=!0,Z(),Y();try{await K.setLayerFormat(e)||(In.value=K.getStats().layerFormat)}catch{In.value=K.getStats().layerFormat}finally{$n=!1,G=K.getHistoryState(),Z(),Y()}}),On.addEventListener(`click`,async()=>{if(!X()){sr(!1),Qn=!0,On.disabled=!0,Z(),Y(),kn.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await K.runBenchmark(V(`benchmarkStamps`));kn.textContent=[`${H(e.baseStamps)} base stamps`,`${H(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){kn.textContent=e instanceof Error?e.message:String(e)}finally{Qn=!1,On.disabled=!1,G=K.getHistoryState(),Z(),Y()}}}),An.addEventListener(`click`,()=>{X()||Xn||Zn||Yn||qn||q||(Jn=!Jn,Jn?(Tr(),sr(!1),W.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):W.textContent=q?Lr(q):`Registrazione annullata.`,Y())}),jn.addEventListener(`click`,()=>{Gr()}),Mn.addEventListener(`click`,()=>{Gr(`blend`)});function Vr(e){B(`fpsStat`).textContent=`${e.fps}`,B(`cpuStat`).textContent=`${e.lastCpuFrameMs.toFixed(2)} ms`,B(`stampStat`).textContent=H(e.totalBaseStamps),B(`avoidedStat`).textContent=H(e.avoidedLogicalDraws),B(`memoryStat`).textContent=`${e.layerMemoryMiB} MiB`,B(`gpuStat`).textContent=e.gpuLabel}function Hr(e,t){let n=Tr(),r=K.toLayerPoint(t);qn={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},W.textContent=`Registrazione in corso…`}function Ur(e,t){let n=qn;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...K.toLayerPoint(t[r]),timeMs:a})}}async function Wr(e){let t=qn;if(qn=null,Jn=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};Zn=!0,W.textContent=`Fissaggio permanente del tratto di riferimento…`,Y();try{q=await Sr(e),br(),W.textContent=Lr(q)}catch(e){W.textContent=e instanceof Error?e.message:String(e)}finally{Zn=!1}}else t&&(W.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);Y()}async function Gr(e=`paint`){let t=q;if(!t||Yn||X())return;let n=e===`blend`?`blend`:Er(),r=e===`blend`?`normal`:Dr(),i=e===`blend`?`off`:Or(),a=e===`blend`?Ar(t):kr(t,n,r,i),o=e===`blend`?Mr:jr(n,r,i),s=e===`blend`?`multicolor-horizontal-stripes-v1`:`transparent`;sr(!1),Yn=!0,On.disabled=!0,Y(),Z(),wr(a),W.textContent=`Riproduzione test ${o} in corso…`;try{if(await K.waitForIdle(),K.resetStrokeRandomSeed(),!K.resetDocument())throw Error(`Il documento è occupato da un'operazione Undo/Redo.`);await K.waitForIdle(),e===`blend`&&(W.textContent=`Preparazione dello sfondo multicolore Blend…`,await Nr(a),K.resetStrokeRandomSeed(),W.textContent=`Riproduzione test ${o} in corso…`);let c=K.getBlendRuntimeState(),l=e===`blend`?c.scratchAllocated?`warm`:`cold`:`not-applicable`,u=K.getStats(),d=performance.now(),f=t.points[t.points.length-1],p=[],m=[],h=1;K.startStrokePerformanceProfile();let g=performance.now();K.beginStrokeAtLayer(t.points[0]),m.push(performance.now()-g),await new Promise(e=>{let n=r=>{let i=r-d,a=[];for(;h<t.points.length&&t.points[h].timeMs<=i;)p.push(Math.max(0,i-t.points[h].timeMs)),a.push(t.points[h]),h+=1;if(a.length>0){let e=performance.now();K.extendStrokeAtLayer(a),m.push(performance.now()-e)}if(h<t.points.length){requestAnimationFrame(n);return}K.endStroke(f.timeMs),e()};requestAnimationFrame(n)});let _=performance.now();await K.waitForIdle();let v=performance.now();await pr();let y=performance.now(),b=K.finishStrokePerformanceProfile();if(!b)throw Error(`Profilo del tratto non disponibile.`);let x=K.getStats(),S=K.getBlendRuntimeState(),C=Math.max(0,x.totalBaseStamps-u.totalBaseStamps),w=e===`blend`?C:C*a.count,T={inputDeliveryMs:_-d,inputDelayP50Ms:fr(p,.5),inputDelayP95Ms:fr(p,.95),inputDelayMaxMs:p.length===0?0:Math.max(...p),layerInputDispatchTotalMs:m.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:fr(m,.5),layerInputDispatchP95Ms:fr(m,.95),layerInputDispatchMaxMs:m.length===0?0:Math.max(...m),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,v-_),endToPresentedMs:Math.max(0,y-d)},E=await _r({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:t.capturedAt,traceFingerprint:mr(t.points),pointCount:t.points.length,traceDurationMs:f.timeMs,...hr(t.points),testVariant:n,testTool:e,testBlendMode:r,testGrainMode:i,backgroundStrategy:s,blendScratchStateBeforeReplay:l,blendScratchMemoryMiBBeforeReplay:c.scratchMemoryMiB,blendScratchMemoryMiBAfterReplay:S.scratchMemoryMiB,settings:a},playback:T,performance:b,environment:gr()});W.textContent=[`Test ${o}`,`Tratto ${dr(f.timeMs)}`,`${H(t.points.length)} campioni`,e===`blend`?`${H(C)} segmenti Blend dry`:`${H(C)} stamps base`,e===`blend`?`scratch ${l} → ${S.scratchMemoryMiB.toFixed(1)} MiB`:`${H(w)} copie fisiche`,`coda GPU ${T.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${b.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${b.submitImmediateP95Ms.toFixed(2)} ms`,`display mip ${b.paintDisplaySelectedMipLevel} / ${H(b.paintDisplayPyramidPasses)} pass`,e===`blend`?`preview tip n/a Blend`:b.adaptivePreviewActivations>0?`preview tip ${H(b.adaptivePreviewBaseStampsDrawn)} stamp / ${b.adaptivePreviewJsTotalMs.toFixed(2)} ms JS`:`preview tip non attivata`,e===`blend`?`spacing Blend ${a.spacingPercent.toFixed(2)}%`:`spacing adattivo ${b.adaptiveSpacingInitialPercent.toFixed(2)}→${b.adaptiveSpacingFinalPercent.toFixed(2)}% / ${b.adaptiveSpacingIncreaseCount} step`,`history CPU ${H(b.historyCapturedBaseStamps)} stamp / ${H(b.historyCapturedBatches)} batch`,`FPS medi ${b.averageRenderFps.toFixed(1)}`,`${H(b.delayedRenderFrames)} frame >20 ms`,`presentazione ${T.endToPresentedMs.toFixed(2)} ms`,E>0?`run #${E} salvata`:`run salvata`].join(` · `)}catch(e){K.finishStrokePerformanceProfile(),W.textContent=e instanceof Error?e.message:String(e)}finally{Yn=!1,On.disabled=!1,Y(),G=K.getHistoryState(),Z()}}function Kr(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function qr(e){return{clientX:e.clientX,clientY:e.clientY,pressure:Kr(e),timeMs:e.timeStamp}}var Q=null,$=null,Jr=0,Yr=0,Xr=new Map,Zr=null;function Qr(){let e=[...Xr.values()];if(e.length<2)return null;let t=e[0],n=e[1];return{centerX:(t.clientX+n.clientX)*.5,centerY:(t.clientY+n.clientY)*.5,distance:Math.max(1,Math.hypot(n.clientX-t.clientX,n.clientY-t.clientY))}}function $r(){qn&&(qn=null,Jn=!1,W.textContent=`Registrazione annullata dal gesto a due dita.`,Y())}function ei(){$!==`touch-navigation`&&($===`paint`&&(K.cancelStrokeBeforeRender()||K.endStroke(),$r()),$=`touch-navigation`,U.classList.add(`panning`)),Zr=Qr()}U.addEventListener(`pointerdown`,e=>{if(e.pointerType===`touch`&&Q!==null&&Xr.size>0&&!Pr()){e.preventDefault(),Xr.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),U.setPointerCapture(e.pointerId),Xr.size>=2&&ei();return}if(!(Q!==null||Pr())){if(e.preventDefault(),Q=e.pointerId,e.pointerType===`touch`&&Xr.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),$=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,U.setPointerCapture(e.pointerId),$===`pan`)U.classList.add(`panning`),Jr=e.clientX,Yr=e.clientY;else{let t=qr(e);Jn&&Hr(e,t),K.beginStroke(t)}requestAnimationFrame(()=>{Q===e.pointerId&&(Z(),Y())})}}),U.addEventListener(`pointermove`,e=>{if(e.pointerType===`touch`&&Xr.has(e.pointerId)&&(Xr.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),$===`touch-navigation`)){e.preventDefault();let t=Qr(),n=Zr;if(t&&n){let e=t.centerX-n.centerX,r=t.centerY-n.centerY;(Math.abs(e)>.01||Math.abs(r)>.01)&&K.panByClientDelta(e,r);let i=t.distance/n.distance;Number.isFinite(i)&&Math.abs(i-1)>1e-4&&K.zoomBy(Math.min(2,Math.max(.5,i)),t.centerX,t.centerY)}Zr=t;return}if(e.pointerId!==Q||$===null)return;if(e.preventDefault(),$===`pan`){K.panByClientDelta(e.clientX-Jr,e.clientY-Yr),Jr=e.clientX,Yr=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(qr);Ur(n,r),K.extendStroke(r)});function ti(e){if(e.pointerType===`touch`&&Xr.delete(e.pointerId),$===`touch-navigation`){e.preventDefault();let t=Xr.keys().next().value;Q=typeof t==`number`?t:null,Zr=Qr(),Xr.size===0&&(U.classList.remove(`panning`),$=null,G=K.getHistoryState(),Z(),Y());return}e.pointerId===Q&&($===`paint`&&(K.endStroke(e.timeStamp),Wr(e.type===`pointerup`)),U.classList.remove(`panning`),$=null,Q=null,Zr=null,G=K.getHistoryState(),Z(),Y())}U.addEventListener(`pointerup`,ti),U.addEventListener(`pointercancel`,ti),U.addEventListener(`lostpointercapture`,ti),U.addEventListener(`contextmenu`,e=>e.preventDefault()),window.addEventListener(`keydown`,e=>{if(e.defaultPrevented||e.repeat||e.isComposing||e.altKey||!e.ctrlKey&&!e.metaKey||e.key.toLowerCase()!==`z`||(e.target instanceof Element?e.target:null)?.closest(`input, textarea, select, [contenteditable]`))return;let t=e.shiftKey?`redo`:`undo`;!(t===`undo`?G.canUndo:G.canRedo)||X()||Q!==null||(e.preventDefault(),Fr(t))}),U.addEventListener(`wheel`,e=>{if(e.preventDefault(),X()||Q!==null)return;let t=Math.exp(-e.deltaY*.0015);K.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>K.resizeCanvas()).observe(U),sr(!0),or(`paint`,!1),lr(),K.setBrushSettings(cr()),Y(),Z(),Cr(),K.initialize().then(()=>{tr=!0,G=K.getHistoryState(),Z(),Y()}).catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;Dn.textContent=`${e instanceof Error?e.message:String(e)}${t}`,Dn.className=`status error`,On.disabled=!0,Z()}),window.setInterval(()=>Vr(K.getStats()),500);