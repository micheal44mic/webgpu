(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX non valido: ${e}`);let n=Number.parseInt(t.slice(0,2),16)/255,r=Number.parseInt(t.slice(2,4),16)/255,i=Number.parseInt(t.slice(4,6),16)/255,a=Math.max(n,r,i),o=Math.min(n,r,i),s=a-o,c=(a+o)*.5;if(s===0)return[0,0,c];let l=s/(1-Math.abs(2*c-1)),u;return u=a===n?(r-i)/s%6:a===r?(i-n)/s+2:(n-r)/s+4,u/=6,u<0&&(u+=1),[u,l,c]}function t(e,t,n){return Math.min(n,Math.max(t,e))}var n=new Uint8Array([137,80,78,71,13,10,26,10]),r=13;function i(e,t){return String.fromCharCode(e[t],e[t+1],e[t+2],e[t+3])}function a(e,t,n){let r=e+t-n,i=Math.abs(r-e),a=Math.abs(r-t),o=Math.abs(r-n);return i<=a&&i<=o?e:a<=o?t:n}function o(e,t,n){let r=t+1,i=r*n;if(e.byteLength!==i)throw Error(`Dati PNG decompressi non validi: attesi ${i} byte, trovati ${e.byteLength}.`);let o=new Uint8Array(t*n);for(let i=0;i<n;i+=1){let n=i*r,s=i*t,c=e[n];if(c>4)throw Error(`Filtro PNG non supportato: ${c}.`);for(let r=0;r<t;r+=1){let l=e[n+1+r],u=r>0?o[s+r-1]:0,d=i>0?o[s-t+r]:0,f=r>0&&i>0?o[s-t+r-1]:0,p=0;c===1?p=u:c===2?p=d:c===3?p=Math.floor((u+d)*.5):c===4&&(p=a(u,d,f)),o[s+r]=l+p&255}}return o}async function s(e){let t=new Uint8Array(e);if(t.byteLength<n.byteLength+12)throw Error(`PNG troppo corta.`);for(let e=0;e<n.byteLength;e+=1)if(t[e]!==n[e])throw Error(`Firma PNG non valida.`);let a=new DataView(e),s=[],c=0,l=0,u=0,d=!1,f=!1,p=n.byteLength;for(;p+12<=t.byteLength;){let e=a.getUint32(p,!1),n=p+4,o=p+8,m=o+e,h=m+4;if(m<o||h>t.byteLength)throw Error(`Chunk PNG oltre la fine del file.`);let g=i(t,n);if(g===`IHDR`){if(d||e!==r)throw Error(`Header PNG non valido.`);l=a.getUint32(o,!1),u=a.getUint32(o+4,!1);let n=t[o+8],i=t[o+9],s=t[o+10],c=t[o+11],f=t[o+12];if(l<=0||u<=0)throw Error(`Dimensioni PNG non valide.`);if(n!==8||i!==0||s!==0||c!==0||f!==0)throw Error(`La Shape richiede una PNG grayscale 8-bit, non interlacciata e con compressione standard.`);d=!0}else if(g===`IDAT`){if(!d||f)throw Error(`Ordine dei chunk PNG non valido.`);let e=t.slice(o,m);s.push(e),c+=e.byteLength}else if(g===`IEND`){f=!0;break}p=h}if(!d||!f||s.length===0)throw Error(`PNG incompleta.`);let m=new Uint8Array(c),h=0;for(let e of s)m.set(e,h),h+=e.byteLength;if(typeof DecompressionStream>`u`)throw Error(`DecompressionStream non disponibile.`);let g=new Blob([m]).stream().pipeThrough(new DecompressionStream(`deflate`)),_=new Uint8Array(await new Response(g).arrayBuffer());return{width:l,height:u,pixels:o(_,l,u)}}var c=`dry-blend-continuous-core-v1-pressure-inert`,l=.06,u=2.5,d=`allocate-on-tool-select-release-when-idle-deselected`,f=1/256,p=Object.freeze({size:64,strength:1,spacing:.15,flow:1,stretch:.18,paint:.14,aspect:1,angle:0,orientToStroke:!0,seed:1}),m=(e,t,n)=>Math.max(t,Math.min(n,e)),h=(e,t)=>{let n=Number(e);if(!Number.isFinite(n))throw TypeError(`${t} deve essere finito`);return n},g=(e,t)=>{let n=h(e,t);if(!(n>0))throw RangeError(`${t} deve essere > 0`);return n},_=(e,t)=>{let n=h(e,t);if(n<0||n>1)throw RangeError(`${t} deve stare fra 0 e 1`);return n},v=(e,t)=>{let n=Math.trunc(h(e,t));if(n<1)throw RangeError(`${t} deve essere >= 1`);return n},y=e=>Math.fround(e),b=(e,t,n)=>e+(t-e)*n;function x(e={}){if(!e||typeof e!=`object`)throw TypeError(`controlli Blend dry non validi`);return Object.freeze({size:m(g(e.size??p.size,`size`),1,1024),strength:_(e.strength??p.strength,`strength`),spacing:m(g(e.spacing??p.spacing,`spacing`),.01,4),flow:_(e.flow??p.flow,`flow`),stretch:_(e.stretch??p.stretch,`stretch`),paint:_(e.paint??p.paint,`paint`),aspect:m(g(e.aspect??p.aspect,`aspect`),.05,20),angle:h(e.angle??p.angle,`angle`),orientToStroke:!!(e.orientToStroke??p.orientToStroke),seed:Math.trunc(h(e.seed??p.seed,`seed`))>>>0})}function S(e=p.stretch){return Math.sqrt(_(e,`stretch`))}function C(e=p.paint){let t=_(e,`paint`);return t*t}function w(e){if(!e||typeof e!=`object`)throw TypeError(`campione Blend dry non valido`);return{x:Math.round(h(e.x,`sample.x`)*256)/256,y:Math.round(h(e.y,`sample.y`)*256)/256,timeMs:Math.round(h(e.timeMs??e.timeStamp??0,`sample.timeMs`)),pressure:1}}function T(e){return m(g(e,`diameter`)*l,u,48)}function E(){return{fromX:0,fromY:0,toX:0,toY:0,dirX:0,dirY:0,distance:0,fromDiameter:0,toDiameter:0,diameter:0,fromHalfWidth:0,fromHalfHeight:0,toHalfWidth:0,toHalfHeight:0,fromAngle:0,toAngle:0,angle:0,warpStrength:0,flow:1,spacing:.15,arcStart:0,arcEnd:0,speed:0,minX:0,minY:0,maxX:0,maxY:0,maxHalo:0}}function ee(e){return{...e}}function D(e,t){return e.x=t.x,e.y=t.y,e.timeMs=t.timeMs,e}function O(e,t,n,r){return e.x=y(b(t.x,n.x,r)),e.y=y(b(t.y,n.y,r)),e.timeMs=b(t.timeMs,n.timeMs,r),e}function k(e,t,n,r,i){return e.x=t,e.y=n,e.width=r,e.height=i,e}function A(e,t,n,r,i){if(t.width<=0||t.height<=0)return 0;let a=Math.ceil(n/i),o=Math.ceil(r/i),s=Math.floor(t.x/i),c=Math.floor(t.y/i),l=Math.ceil((t.x+t.width)/i),u=Math.ceil((t.y+t.height)/i),d=0;for(let t=c;t<u;t+=1)for(let n=s;n<l;n+=1)n>=0&&t>=0&&n<a&&t<o&&(e[d]=t*a+n,d+=1);return d}function te(e){let t=1/0,n=1/0,r=-1/0,i=-1/0;for(let a=0;a<5;a+=1){let o=a*.25,s=b(e.fromX,e.toX,o),c=b(e.fromY,e.toY,o),l=b(e.fromHalfWidth,e.toHalfWidth,o),u=b(e.fromHalfHeight,e.toHalfHeight,o),d=b(e.fromAngle,e.toAngle,o),f=Math.abs(Math.cos(d)),p=Math.abs(Math.sin(d)),m=f*l+p*u+2,h=p*l+f*u+2;t=Math.min(t,Math.floor(s-m)),n=Math.min(n,Math.floor(c-h)),r=Math.max(r,Math.ceil(s+m)),i=Math.max(i,Math.ceil(c+h))}e.minX=t,e.minY=n,e.maxX=r,e.maxY=i}function ne(e){let t={x:0,y:0,width:0,height:0};return{build:c,generation:0,stepCount:1,steps:[E()],empty:!0,maxHalo:0,readRect:{x:0,y:0,width:0,height:0},writeRect:t,localWriteRect:{x:0,y:0,width:0,height:0},clippedReadRect:{x:0,y:0,width:0,height:0},dirtyRect:t,readTiles:new Uint32Array(e),writeTiles:new Uint32Array(e),readTileCount:0,writeTileCount:0}}function j(e,t,n,r,i,a){let o=m(t.minX,0,n),s=m(t.minY,0,r),c=m(t.maxX,0,n),l=m(t.maxY,0,r),u=t.maxHalo;if(k(e.writeRect,o,s,Math.max(0,c-o),Math.max(0,l-s)),k(e.readRect,o-u,s-u,Math.max(0,c-o)+u*2,Math.max(0,l-s)+u*2),e.readRect.width>a||e.readRect.height>a)throw RangeError(`segmento Blend dry ${e.readRect.width}x${e.readRect.height} oltre scratch ${a}`);k(e.localWriteRect,u,u,e.writeRect.width,e.writeRect.height);let d=m(e.readRect.x,0,n),f=m(e.readRect.y,0,r),p=m(e.readRect.x+e.readRect.width,0,n),h=m(e.readRect.y+e.readRect.height,0,r);k(e.clippedReadRect,d,f,Math.max(0,p-d),Math.max(0,h-f)),e.writeTileCount=A(e.writeTiles,e.writeRect,n,r,i),e.readTileCount=A(e.readTiles,e.clippedReadRect,n,r,i),e.maxHalo=u,e.empty=e.writeRect.width<=0||e.writeRect.height<=0,e.dirtyRect=e.writeRect}function M(e={},t={}){let n=x(e),r=v(t.documentWidth??4096,`documentWidth`),i=v(t.documentHeight??4096,`documentHeight`),a=v(t.tileSize??256,`tileSize`),o=v(t.scratchSize??1664,`scratchSize`),s=v(t.maxSteps??8192,`maxSteps`),l=Math.ceil(r/a)*Math.ceil(i/a),u=Array.from({length:s},E),d=ne(l),p={x:0,y:0,timeMs:0,pressure:1},m={x:0,y:0,timeMs:0,pressure:1},h={x:0,y:0,timeMs:0,pressure:1},g=!1,_=!1,b=!1,S=0,C=0,k=0,A=0,M=0,N=()=>({steps:k,stepFree:s-k}),P=(e,t)=>({accepted:!0,steps:e,stationary:t,reason:null,requiredSteps:0,capacity:null}),re=e=>({accepted:!1,steps:0,stationary:!1,reason:`capacity`,requiredSteps:e,capacity:N()}),ie=()=>(g=!1,_=!1,b=!1,S=0,C=0,k=0,A=0,M=0,!0),ae=(e={})=>{if(k>0)throw Error(`configure Blend dry richiede una coda vuota`);return n=x(e),ie(),n},oe=e=>(ie(),D(p,w(e)),g=!0,{...p}),se=(e,t)=>{let r=u[C],i=t.x-e.x,a=t.y-e.y,o=Math.hypot(i,a),c=i/o,l=a/o,d=n.size,f=n.size,p=n.size,m=Math.atan2(l,c),h=n.angle+(n.orientToStroke?m:0),g=Math.max(.001,(t.timeMs-e.timeMs)/1e3);Object.assign(r,E(),{fromX:e.x,fromY:e.y,toX:t.x,toY:t.y,dirX:y(c),dirY:y(l),distance:y(o),fromDiameter:y(d),toDiameter:y(f),diameter:y(p),fromHalfWidth:y(d*.5),fromHalfHeight:y(d*.5*n.aspect),toHalfWidth:y(f*.5),toHalfHeight:y(f*.5*n.aspect),fromAngle:y(h),toAngle:y(h),angle:y(h),warpStrength:y(n.strength),flow:y(n.flow),spacing:y(n.spacing),arcStart:y(M),arcEnd:y(M+o),speed:y(o/g)}),r.maxHalo=Math.ceil(o*r.warpStrength)+2,te(r),M+=o,C=(C+1)%s,k+=1,b=!0},ce=e=>{if(!g)throw Error(`planner Blend dry non inizializzato: chiamare reset(down)`);if(_)throw Error(`planner Blend dry gia finalizzato`);let t=w(e),r=t.x-p.x,i=t.y-p.y,a=Math.hypot(r,i);if(a<f)return D(p,t),P(0,!0);let o=Math.max(1,Math.ceil(a/T(n.size)));if(o>s-k)return re(o);D(m,p);for(let e=1;e<=o;e+=1)O(h,p,t,e/o),se(m,h),D(m,h);return D(p,t),P(o,!1)};return{build:c,get controls(){return n},configure:ae,reset:oe,discardPending:ie,pushSample:ce,pushSamples:e=>{let t=0;for(let n of e){let e=ce(n);if(!e.accepted)return{...e,steps:t};t+=e.steps}return P(t,!1)},finish:()=>{if(!g)throw Error(`planner Blend dry non inizializzato: chiamare reset(down)`);return _||=!0,P(0,!b)},buildNextBatch:()=>{if(k===0)return null;let e=u[S],t=d.steps[0];return Object.assign(t,e),d.generation=++A,j(d,t,r,i,a,o),S=(S+1)%s,--k,d},snapshotSteps:()=>{let e=[];for(let t=0;t<k;t+=1)e.push(ee(u[(S+t)%s]));return e},capacity:N,sampleMovesFromLast:e=>{if(!g)return!0;let t=w(e);return t.x!==p.x||t.y!==p.y},pendingSteps:()=>k,lastSample:()=>g?{...p}:null,memoryLedger:()=>{let e=s*Object.keys(E()).length*8,t=d.readTiles.byteLength+d.writeTiles.byteLength;return{stepCapacity:s,stepBytes:e,batchBytes:t,totalBytes:e+t}}}}var N=`
struct BlendUniforms {
  documentAndRoi: vec4<f32>,      // document W,H; group ROI origin X,Y
  validAndFrom: vec4<f32>,        // group ROI size W,H; step from X,Y
  toAndFromHalfSize: vec4<f32>,   // step to X,Y; from half size W,H
  toHalfSizeAndAngles: vec4<f32>, // to half size W,H; from angle, to angle
  maskControls: vec4<f32>,        // hardness, flow, spacing, arc start
  transportControls: vec4<f32>,   // distance, diameter, strength, stretch
  grainControls: vec4<f32>,       // grain scale, paint, grain depth, grain brightness
  grainAffineAndPhase: vec4<f32>, // grain contrast, 0, 0, alpha floor
  paintColor: vec4<f32>,
  depositRect: vec4<f32>,         // step write rect in group-local pixels X,Y,W,H
  options: vec4<u32>,             // shape custom, grain mode, filtering, has previous
  slots: vec4<u32>,               // carrier read slot, carrier write slot, scratch row stride, 0
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

fn stateIndex(pixel: vec2<i32>) -> u32 {
  return u32(pixel.y) * blend.slots.z + u32(pixel.x);
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
`,P=`
fn cleanState(pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= validSize())
  ) {
    return vec4<f32>(0.0);
  }
  let value = stateBuffer[stateIndex(pixel)];
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
`,re=`
${N}

@group(0) @binding(1) var canonicalLayer: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> stateBuffer: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> coverageBuffer: array<f32>;

@compute @workgroup_size(8, 8)
fn gatherMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= validSize())) {
    return;
  }
  let index = stateIndex(pixel);
  coverageBuffer[index] = 0.0;
  let documentPixel = roiOrigin() + pixel;
  if (
    any(documentPixel < vec2<i32>(0))
    || any(documentPixel >= documentSize())
  ) {
    stateBuffer[index] = vec4<f32>(0.0);
    return;
  }

  // The target engine already stores authoritative premultiplied linear RGBA.
  // The source WebGL renderer's sRGB conversions must not be repeated here.
  let value = textureLoad(canonicalLayer, documentPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  stateBuffer[index] = vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`,ie=`
${N}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> carrierBuffer: array<vec4<f32>>;

${P}

var<workgroup> pickupSums: array<vec4<f32>, 64>;
var<workgroup> pickupTotals: array<f32, 64>;

@compute @workgroup_size(8, 8)
fn pickupMain(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(local_invocation_index) threadIndex: u32,
) {
  let angle = blend.toHalfSizeAndAngles.z;
  let cosine = cos(angle);
  let sine = sin(angle);
  let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;

  // One thread per tap of the 8x8 weighted footprint reduction.
  let uv = (vec2<f32>(f32(lid.x), f32(lid.y)) + vec2<f32>(0.5)) / 8.0;
  let normalized = uv * 2.0 - vec2<f32>(1.0);
  let radius = length(normalized);
  let weight = 1.0 - smoothstep(core, 1.0, radius);
  var tapSum = vec4<f32>(0.0);
  var tapTotal = 0.0;
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
      tapSum = sampleState(
        sampleDocumentPosition - blend.documentAndRoi.zw
      ) * weight;
      tapTotal = weight;
    }
  }
  pickupSums[threadIndex] = tapSum;
  pickupTotals[threadIndex] = tapTotal;
  workgroupBarrier();
  for (var reduction = 32u; reduction >= 1u; reduction = reduction / 2u) {
    if (threadIndex < reduction) {
      pickupSums[threadIndex] += pickupSums[threadIndex + reduction];
      pickupTotals[threadIndex] += pickupTotals[threadIndex + reduction];
    }
    workgroupBarrier();
  }
  if (threadIndex != 0u) {
    return;
  }

  let sum = pickupSums[0u];
  let total = pickupTotals[0u];
  let hasPickup = total > 0.0;
  var pigment = sum / max(total, 0.000001);
  if (blend.options.w != 0u) {
    let previous = carrierBuffer[blend.slots.x];
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
  carrierBuffer[blend.slots.y] = vec4<f32>(
    clamp(pigment.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
  );
}
`,ae=`
${N}

@group(0) @binding(1) var<storage, read_write> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> coverageBuffer: array<f32>;
@group(0) @binding(3) var<storage, read> carrierBuffer: array<vec4<f32>>;
@group(0) @binding(4) var shapeTexture: texture_2d<f32>;
@group(0) @binding(5) var shapeSampler: sampler;
@group(0) @binding(6) var grainTexture: texture_2d<f32>;
@group(0) @binding(7) var grainSampler: sampler;

${P}

const GRAIN_MIP_LEVEL_COUNT: u32 = 12u;

struct LocalSample {
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

struct CustomSample {
  coverage: f32,
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

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

// Compute shaders cannot use dpdx/dpdy, so the caller provides the analytic
// texture-space gradients of the grain UV instead.
fn adjustedGrainCoverage(
  grainUv: vec2<f32>,
  grainUvDx: vec2<f32>,
  grainUvDy: vec2<f32>,
) -> f32 {
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

@compute @workgroup_size(8, 8)
fn depositMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (
    f32(gid.x) >= blend.depositRect.z
    || f32(gid.y) >= blend.depositRect.w
  ) {
    return;
  }
  let pixel = vec2<i32>(blend.depositRect.xy) + vec2<i32>(gid.xy);
  // Pixel-center document position, matching gl_FragCoord in the render port.
  let documentPosition = blend.documentAndRoi.zw
    + vec2<f32>(pixel)
    + vec2<f32>(0.5);
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
    // Analytic stand-in for fwidth(normalizedRadius) * 1.35: the gradient of a
    // normalized distance field is 1 / radius per pixel.
    let antialiasWidth = max(
      1.6 / max(radius, 0.001),
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
    // The arc coordinate advances ~1 unit per pixel along the stroke.
    let antialiasWidth = 1.0;
    coverage *= 1.0 - smoothstep(
      support - antialiasWidth,
      support + antialiasWidth,
      phase
    );
  }

  var grainCoverage = 1.0;
  if (blend.options.y != 0u) {
    var grainUv: vec2<f32>;
    var grainUvDx: vec2<f32>;
    var grainUvDy: vec2<f32>;
    if (blend.options.y == 2u) {
      // Moving maps one complete grain image to the selected brush footprint.
      grainUv = bestLocal.uv;
      let halfSize = max(
        mix(
          blend.toAndFromHalfSize.zw,
          blend.toHalfSizeAndAngles.xy,
          bestInterpolation
        ),
        vec2<f32>(0.001)
      );
      grainUvDx = vec2<f32>(0.5 / halfSize.x, 0.0);
      grainUvDy = vec2<f32>(0.0, 0.5 / halfSize.y);
    } else {
      // Fixed is anchored to authoritative top-left layer coordinates.
      grainUv = documentPosition * blend.grainControls.x;
      grainUvDx = vec2<f32>(blend.grainControls.x, 0.0);
      grainUvDy = vec2<f32>(0.0, blend.grainControls.x);
    }
    grainCoverage = adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
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

  let index = stateIndex(pixel);
  if (finalCoverage > 0.0) {
    coverageBuffer[index] = max(coverageBuffer[index], finalCoverage);
  }
  let depositCoverage = clamp(
    finalCoverage * blend.transportControls.z,
    0.0,
    1.0
  );
  if (depositCoverage <= 0.0) {
    return;
  }

  let canvas = cleanState(pixel);
  let carrier = carrierBuffer[blend.slots.y];
  let loaded = vec4<f32>(clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  let pigment = mix(
    carrier,
    loaded,
    clamp(blend.grainControls.y, 0.0, 1.0)
  );
  let mixed = mix(canvas, pigment, depositCoverage);
  let resultAlpha = clamp(mixed.a, 0.0, 1.0);
  var result = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
    resultAlpha
  );
  if (resultAlpha <= blend.grainAffineAndPhase.w) {
    result = vec4<f32>(0.0);
  }
  stateBuffer[index] = result;
}
`,oe=`
${N}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> coverageBuffer: array<f32>;

@fragment
fn scatterFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = vec2<i32>(fragmentPosition.xy);
  let localPixel = documentPixel - roiOrigin();
  if (
    any(localPixel < vec2<i32>(0))
    || any(localPixel >= validSize())
    || coverageBuffer[stateIndex(localPixel)] <= 0.0
  ) {
    discard;
  }

  let value = stateBuffer[stateIndex(localPixel)];
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`,se=192,ce=256,F=4096,le=`dry-blend-webgpu-v3-compute-fused-sweep`;function ue(e,t,n){return Math.min(n,Math.max(t,e))}function de(e,t){if(!e)return{...t};let n=Math.min(e.x,t.x),r=Math.min(e.y,t.y),i=Math.max(e.x+e.width,t.x+t.width),a=Math.max(e.y+e.height,t.y+t.height);return{x:n,y:r,width:i-n,height:a-r}}function fe(e){let t=ue(e,0,1);return t<=.04045?t/12.92:((t+.055)/1.055)**2.4}function pe(e){let t=e.trim().replace(/^#/,``);if(!/^[0-9a-fA-F]{6}$/.test(t))throw Error(`Colore HEX Blend non valido: ${e}`);return[fe(Number.parseInt(t.slice(0,2),16)/255),fe(Number.parseInt(t.slice(2,4),16)/255),fe(Number.parseInt(t.slice(4,6),16)/255)]}function me(e){return{x:e.x,y:e.y,width:e.width,height:e.height}}function he(e){return{build:e.build,stepCount:1,steps:[{...e.steps[0]}],empty:e.empty,readRect:me(e.readRect),writeRect:me(e.writeRect)}}async function ge(e){let t=(await Promise.all(e.map(async({label:e,module:t})=>({label:e,messages:(await t.getCompilationInfo()).messages})))).flatMap(({label:e,messages:t})=>[...t].filter(e=>e.type===`error`).map(t=>`${e}:${t.lineNum}:${t.linePos} ${t.message}`));if(t.length>0)throw Error(`Shader Blend WGSL non valido:\n${t.join(`
`)}`)}var _e=class e{static async create(t){let n=new e(t);try{return await n.initialize(),n}catch(e){throw n.destroy(),e}}build=le;maximumBatchesPerSubmit=ce;device;documentWidth;documentHeight;layerFormat;layerView;layerSamplingView;shapeMaskView;shapeMaskSampler;grainTextureView;grainSamplers;scratchSize;uniformStride;uniformUpload;uniformBuffer;gatherBindGroupLayout;pickupBindGroupLayout;depositBindGroupLayout;scatterBindGroupLayout;gatherPipeline;pickupPipeline;depositPipeline;scatterPipeline;scratch=null;activeHistoryActionId=null;carrierCursor=0;carrierValid=!1;destroyed=!1;constructor(e){this.device=e.device,this.documentWidth=e.documentWidth,this.documentHeight=e.documentHeight,this.layerFormat=e.layerFormat,this.layerView=e.layerView,this.layerSamplingView=e.layerSamplingView,this.shapeMaskView=e.shapeMaskView,this.shapeMaskSampler=e.shapeMaskSampler,this.grainTextureView=e.grainTextureView,this.grainSamplers=e.grainSamplers,this.scratchSize=e.scratchSize??1664,this.uniformStride=Math.ceil(se/this.device.limits.minUniformBufferOffsetAlignment)*this.device.limits.minUniformBufferOffsetAlignment,this.uniformUpload=new ArrayBuffer(this.uniformStride*ce),this.uniformBuffer=this.device.createBuffer({label:`Blend dry dynamic uniforms`,size:this.uniformUpload.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}async initialize(){let e=e=>({binding:0,visibility:e,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:se}}),t=(e,t,n)=>({binding:e,visibility:t,buffer:{type:n?`read-only-storage`:`storage`}}),n=e=>({binding:e,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`,viewDimension:`2d`,multisampled:!1}}),r=e=>({binding:e,visibility:GPUShaderStage.COMPUTE,sampler:{type:`filtering`}});this.gatherBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry gather bind group layout`,entries:[e(GPUShaderStage.COMPUTE),n(1),t(2,GPUShaderStage.COMPUTE,!1),t(3,GPUShaderStage.COMPUTE,!1)]}),this.pickupBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry pickup bind group layout`,entries:[e(GPUShaderStage.COMPUTE),t(1,GPUShaderStage.COMPUTE,!0),t(2,GPUShaderStage.COMPUTE,!1)]}),this.depositBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry deposit bind group layout`,entries:[e(GPUShaderStage.COMPUTE),t(1,GPUShaderStage.COMPUTE,!1),t(2,GPUShaderStage.COMPUTE,!1),t(3,GPUShaderStage.COMPUTE,!0),n(4),r(5),n(6),r(7)]}),this.scatterBindGroupLayout=this.device.createBindGroupLayout({label:`Blend dry scatter bind group layout`,entries:[e(GPUShaderStage.FRAGMENT),t(1,GPUShaderStage.FRAGMENT,!0),t(2,GPUShaderStage.FRAGMENT,!0)]});let i=[{label:`Blend gather`,module:this.device.createShaderModule({label:`Blend gather WGSL`,code:re})},{label:`Blend pickup`,module:this.device.createShaderModule({label:`Blend pickup WGSL`,code:ie})},{label:`Blend deposit`,module:this.device.createShaderModule({label:`Blend deposit WGSL`,code:ae})},{label:`Blend scatter`,module:this.device.createShaderModule({label:`Blend scatter WGSL`,code:oe})}];await ge(i);let a=(e,t)=>this.device.createPipelineLayout({label:e,bindGroupLayouts:[t]}),o=(e,t,n,r)=>this.device.createComputePipeline({label:e,layout:a(`${e} pipeline layout`,t),compute:{module:n,entryPoint:r}});this.device.pushErrorScope(`validation`),this.gatherPipeline=o(`Blend dry gather ROI`,this.gatherBindGroupLayout,i[0].module,`gatherMain`),this.pickupPipeline=o(`Blend dry 8x8 weighted pigment pickup`,this.pickupBindGroupLayout,i[1].module,`pickupMain`),this.depositPipeline=o(`Blend dry fused sweep mask and pigment deposit`,this.depositBindGroupLayout,i[2].module,`depositMain`),this.scatterPipeline=this.device.createRenderPipeline({label:`Blend dry scatter to canonical layer`,layout:a(`Blend dry scatter pipeline layout`,this.scatterBindGroupLayout),vertex:{module:i[3].module,entryPoint:`fullscreenVertex`},fragment:{module:i[3].module,entryPoint:`scatterFragment`,targets:[{format:this.layerFormat}]},primitive:{topology:`triangle-list`}});let s=await this.device.popErrorScope();if(s)throw Error(`Pipeline Blend WebGPU non valida: ${s.message}`)}beginStroke(e){this.assertAlive(),this.activeHistoryActionId=e,this.carrierCursor=0,this.carrierValid=!1}submit(e,t,n,r){if(this.assertAlive(),e.length>ce)throw RangeError(`Blend dry accetta al massimo ${ce} batch per submit.`);this.activeHistoryActionId!==n&&this.beginStroke(n);let i=performance.now(),a=this.ensureScratchResources(),o=e.filter(e=>!e.empty);for(let e of o)this.validateBatch(e);let s=this.buildStepGroups(o);this.populateUniforms(o,s,t),o.length>0&&this.device.queue.writeBuffer(this.uniformBuffer,0,this.uniformUpload,0,o.length*this.uniformStride);let c=this.device.createCommandEncoder({label:`Blend dry frame encoder`}),l=0,u=null;r&&(c.beginRenderPass({label:`Blend dry clear canonical layer`,colorAttachments:[{view:this.layerView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),l+=1);let d=e=>Math.ceil(e/8),f=t.grainMode===`moving`?`moving`:`fixed`;for(let e of s){let n=e.start*this.uniformStride,r=c.beginComputePass({label:`Blend dry gather + fused sweep steps`});r.setPipeline(this.gatherPipeline),r.setBindGroup(0,a.gatherBindGroup,[n]),r.dispatchWorkgroups(d(e.readRect.width),d(e.readRect.height));for(let n=0;n<e.count;n+=1){let i=o[e.start+n],s=(e.start+n)*this.uniformStride;r.setPipeline(this.pickupPipeline),r.setBindGroup(0,a.pickupBindGroup,[s]),r.dispatchWorkgroups(1),r.setPipeline(this.depositPipeline),r.setBindGroup(0,a.depositBindGroups[f][t.grainFiltering],[s]),r.dispatchWorkgroups(d(i.writeRect.width),d(i.writeRect.height))}r.end();let i=c.beginRenderPass({label:`Blend dry scatter ROI to canonical layer`,colorAttachments:[{view:this.layerView,loadOp:`load`,storeOp:`store`}]});i.setPipeline(this.scatterPipeline),i.setBindGroup(0,a.scatterBindGroup,[n]),i.setScissorRect(e.writeRect.x,e.writeRect.y,e.writeRect.width,e.writeRect.height),i.draw(3),i.end(),l+=2,u=de(u,e.writeRect)}return(r||o.length>0)&&this.device.queue.submit([c.finish()]),o.length>0&&(this.carrierValid=!0),{dirtyRect:u,batchCount:o.length,passCount:l,scratchAllocated:this.scratch!==null,cpuMs:performance.now()-i}}memoryMiB(){if(!this.scratch)return 0;let e=this.scratchSize*this.scratchSize,t=e*16,n=e*4,r=F*16;return(t+n+r+this.uniformUpload.byteLength)/(1024*1024)}allocatedMemoryMiB(){return this.scratch?this.memoryMiB():this.uniformUpload.byteLength/(1024*1024)}prewarmScratch(){this.assertAlive();let e=this.scratch!==null;return this.ensureScratchResources(),!e}releaseScratch(){return this.destroyed||!this.scratch?!1:(this.scratch.stateBuffer.destroy(),this.scratch.coverageBuffer.destroy(),this.scratch.carrierBuffer.destroy(),this.scratch=null,this.carrierValid=!1,!0)}destroy(){this.destroyed||(this.destroyed=!0,this.uniformBuffer.destroy(),this.scratch&&=(this.scratch.stateBuffer.destroy(),this.scratch.coverageBuffer.destroy(),this.scratch.carrierBuffer.destroy(),null))}assertAlive(){if(this.destroyed)throw Error(`Renderer Blend dry già distrutto.`)}validateBatch(e){if(e.build!==`dry-blend-continuous-core-v1-pressure-inert`||e.stepCount!==1)throw Error(`Batch Blend dry incompatibile.`);if(![e.readRect.x,e.readRect.y,e.readRect.width,e.readRect.height,e.writeRect.x,e.writeRect.y,e.writeRect.width,e.writeRect.height].every(Number.isFinite))throw TypeError(`Rettangolo Blend dry non valido.`);if(e.readRect.width<=0||e.readRect.height<=0||e.readRect.width>this.scratchSize||e.readRect.height>this.scratchSize)throw RangeError(`ROI Blend dry oltre lo scratch WebGPU.`);if(e.writeRect.x<0||e.writeRect.y<0||e.writeRect.width<=0||e.writeRect.height<=0||e.writeRect.x+e.writeRect.width>this.documentWidth||e.writeRect.y+e.writeRect.height>this.documentHeight)throw RangeError(`Dirty rect Blend dry fuori dal layer.`)}buildStepGroups(e){let t=[],n=null;for(let r=0;r<e.length;r+=1){let i=e[r];if(n){let e=de(n.readRect,i.readRect);if(e.width<=this.scratchSize&&e.height<=this.scratchSize){n.count+=1,n.readRect=e,n.writeRect=de(n.writeRect,i.writeRect);continue}t.push(n)}n={start:r,count:1,readRect:me(i.readRect),writeRect:me(i.writeRect)}}return n&&t.push(n),t}populateUniforms(e,t,n){let r=pe(n.color),i=n.grainInvert?-1:1,a=ue(n.grainScale,.1,4),o=n.grainMode===`moving`?2:+(n.grainMode===`texturized`),s=n.grainFiltering===`no`?0:n.grainFiltering===`classic`?1:2;for(let c of t)for(let t=0;t<c.count;t+=1){let l=c.start+t,u=e[l],d=u.steps[0],f=this.carrierCursor,p=(this.carrierCursor+1)%F;this.carrierCursor=p;let m=l*this.uniformStride,h=new Float32Array(this.uniformUpload,m,se/4),g=new Uint32Array(this.uniformUpload,m,se/4);h.fill(0),h[0]=this.documentWidth,h[1]=this.documentHeight,h[2]=c.readRect.x,h[3]=c.readRect.y,h[4]=c.readRect.width,h[5]=c.readRect.height,h[6]=d.fromX,h[7]=d.fromY,h[8]=d.toX,h[9]=d.toY,h[10]=d.fromHalfWidth,h[11]=d.fromHalfHeight,h[12]=d.toHalfWidth,h[13]=d.toHalfHeight,h[14]=d.fromAngle,h[15]=d.toAngle,h[16]=ue(n.hardness,0,1),h[17]=ue(d.flow,0,1),h[18]=d.spacing,h[19]=d.arcStart,h[20]=d.distance,h[21]=d.diameter,h[22]=ue(d.warpStrength,0,1),h[23]=S(n.blendStretch),h[24]=1/(2500*a),h[25]=C(n.blendPaint),h[26]=ue(n.grainDepth,0,1),h[27]=ue(n.grainBrightness,-1,1)*i,h[28]=(1+ue(n.grainContrast,-1,1))*i,h[31]=0,h[32]=r[0],h[33]=r[1],h[34]=r[2],h[35]=1,h[36]=u.writeRect.x-c.readRect.x,h[37]=u.writeRect.y-c.readRect.y,h[38]=u.writeRect.width,h[39]=u.writeRect.height,g[40]=+(n.shape===`shape`),g[41]=o,g[42]=s,g[43]=this.carrierValid||l>0?1:0,g[44]=f,g[45]=p,g[46]=this.scratchSize,g[47]=0}}createDepositBindGroups(e,t,n){let r={binding:0,resource:{buffer:this.uniformBuffer,offset:0,size:se}},i={fixed:{},moving:{}};for(let a of[`fixed`,`moving`])for(let o of[`no`,`classic`,`improved`])i[a][o]=this.device.createBindGroup({label:`Blend dry deposit ${a} ${o}`,layout:this.depositBindGroupLayout,entries:[r,{binding:1,resource:{buffer:e}},{binding:2,resource:{buffer:t}},{binding:3,resource:{buffer:n}},{binding:4,resource:this.shapeMaskView},{binding:5,resource:this.shapeMaskSampler},{binding:6,resource:this.grainTextureView},{binding:7,resource:this.grainSamplers[a][o]}]});return i}setGrainTextureView(e){this.destroyed||this.grainTextureView===e||(this.grainTextureView=e,this.rebuildResidentDepositBindGroups())}setShapeMaskView(e){this.destroyed||this.shapeMaskView===e||(this.shapeMaskView=e,this.rebuildResidentDepositBindGroups())}rebuildResidentDepositBindGroups(){this.scratch&&(this.scratch.depositBindGroups=this.createDepositBindGroups(this.scratch.stateBuffer,this.scratch.coverageBuffer,this.scratch.carrierBuffer))}ensureScratchResources(){if(this.scratch)return this.scratch;let e=this.scratchSize*this.scratchSize,t=this.device.createBuffer({label:`Blend dry scratch state`,size:e*16,usage:GPUBufferUsage.STORAGE}),n=this.device.createBuffer({label:`Blend dry union coverage`,size:e*4,usage:GPUBufferUsage.STORAGE}),r=this.device.createBuffer({label:`Blend dry carrier ring`,size:F*16,usage:GPUBufferUsage.STORAGE}),i={binding:0,resource:{buffer:this.uniformBuffer,offset:0,size:se}},a=(e,t)=>({binding:e,resource:{buffer:t}}),o=this.device.createBindGroup({label:`Blend dry gather bind group`,layout:this.gatherBindGroupLayout,entries:[i,{binding:1,resource:this.layerSamplingView},a(2,t),a(3,n)]}),s=this.device.createBindGroup({label:`Blend dry pickup bind group`,layout:this.pickupBindGroupLayout,entries:[i,a(1,t),a(2,r)]}),c=this.createDepositBindGroups(t,n,r),l=this.device.createBindGroup({label:`Blend dry scatter bind group`,layout:this.scatterBindGroupLayout,entries:[i,a(1,t),a(2,n)]});return this.scratch={stateBuffer:t,coverageBuffer:n,carrierBuffer:r,gatherBindGroup:o,pickupBindGroup:s,depositBindGroups:c,scatterBindGroup:l},this.scratch}},ve=`
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
  // M1 Glaze stores only the exactly quantized red coverage channel in an
  // r8unorm attachment. The vec4 output keeps this entry point valid for WGSL;
  // the render target writes only its red component.
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
`,ye=`
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
`,be=`
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
`,xe=`
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
`,Se=`
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
`,Ce=`
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
@group(0) @binding(5) var compositedMipTexture: texture_2d<f32>;

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
    return round(clamp(value, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0) / 255.0;
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  // The previous RGBA16F accumulator stored the already R8-quantized coverage
  // as half-float. Reapply that storage conversion after loading the R8 mask
  // so both layer formats retain their exact previous compositing inputs.
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
}

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(accumulatedStroke.r);
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
    // Mip 1+ of compositedMipTexture stores box-filtered final compositing.
    // Sampling that pyramid avoids compose(filter(base), filter(stroke)),
    // which is not equivalent to filtering the per-pixel source-over result.
    paint = textureSampleLevel(
      compositedMipTexture,
      layerSampler,
      uv,
      display.selectedMipLevel - 1.0
    );
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`,we=`
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
    return round(clamp(value, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0) / 255.0;
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  // The previous RGBA16F accumulator stored the already R8-quantized coverage
  // as half-float. Reapply that storage conversion after loading the R8 mask
  // so both layer formats retain their exact previous compositing inputs.
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
}

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(accumulatedStroke.r);
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
`,Te=`
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

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
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
  let source = textureLoad(strokeTexture, vec2<i32>(fragmentPosition.xy), 0);
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(source.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return source * opacity;
}
`,Ee=`
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
`,De=`time-window-quadratic-ease-out-start-end-tail-holdback`;function Oe(e,t,n){return Math.min(n,Math.max(t,e))}function ke(e){let t=1-Oe(e,0,1);return 1-t*t}function Ae(e,t){let n=Oe(e,0,2),r=ke(t/100);return n+(1-n)*r}function je(e,t,n){let r=Oe(e,0,2),i=Oe(t,0,2),a=ke(n/100);return i+(r-i)*a}function Me(e,t,n,r){return Math.max(0,e)*je(t,n,r)}function Ne(e){return Math.abs(Oe(e,0,2)-1)>2**-52*8}function Pe(e,t){return Math.abs(Oe(e,0,2)-1)<=2**-52*8&&!Ne(t)}var Fe=`width-tiered-1024-through-128-otherwise-2048`,Ie=1024,Le=2048;function Re(e){return Math.min(512,Math.max(0,Number(e)||0))<=128?Ie:Le}var ze=[`inside`,`center`,`outside`],Be=Object.freeze([1,.643,.282,1]),Ve=Object.freeze({enabled:!1,width:14,position:`outside`,color:Be}),He=(e,t,n)=>Math.max(t,Math.min(n,e));function Ue(e){return e&&typeof e==`object`?e:{}}function We(e){return e&&typeof e.length==`number`?e:null}function Ge(e={}){let t=Ue(e),n=Number(t.width??Ve.width),r=Number.isFinite(n)?He(n,0,512):Ve.width,i=String(t.position??Ve.position).toLowerCase(),a=ze.includes(i)?i:Ve.position,o=We(t.color)??Be,s=Array.from({length:4},(e,t)=>{let n=Be[t],r=Number(o[t]??n);return Number.isFinite(r)?He(r,0,1):n});return{enabled:!!t.enabled,width:r,position:a,color:s}}function Ke(e={}){let t=Ge(e);return{...t,color:[...t.color]}}function qe(e,t){let n=Ge(e),r=Ge(t);return n.enabled===r.enabled&&n.width===r.width&&n.position===r.position&&n.color.every((e,t)=>e===r.color[t])}var Je=(e,t=1)=>{let n=Math.trunc(Number(e));return Number.isFinite(n)?n:t};function Ye(e,{plusOne:t=!0}={}){let n=Math.max(1,Je(e)),r=1;for(;r<n;)r*=2;r=Math.max(1,r>>1);let i=[];for(;r>=1;r>>=1)i.push(r);return t&&i.push(1),i}var Xe=1024,Ze=1408,Qe=[`inner`,`outer`,`emboss`,`pillow`],$e=[`smooth`,`chiselHard`,`chiselSoft`],et=[`up`,`down`],tt=[`linear`,`soft`,`gaussian`,`cone`,`ring`],nt=[`linear`,`cone`,`gaussian`,`ring`],rt=[1,.957,.875],it=[.141,.078,.035],I=Object.freeze({enabled:!1,mode:`inner`,technique:`smooth`,direction:`up`,size:32,soften:4,depth:100,angle:135,altitude:30,highlightColor:rt,highlightOpacity:75,shadowColor:it,shadowOpacity:75,gloss:`linear`,contourAA:!0,bevelContourEnabled:!1,bevelContour:`linear`,bevelRange:100,fill:100}),at=Object.freeze({smoothSigmaScale:.5,chiselSoftSigmaScale:.15,softenSigmaScale:1,smoothAmplitudeScale:.31,rangeHypothesis:`A`,adaptiveIso:!1,blurKernel:`gaussian`,defaultEffectOpacity:Object.freeze({highlight:.75,shadow:.75})});function L(e,t,n){return Math.max(t,Math.min(n,e))}function R(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function ot(e,t){return typeof t==`string`&&e.includes(t)}function st(e,t){let n=e;if(typeof n==`string`){let e=/^#?([0-9a-f]{6})$/i.exec(n);if(e){let t=Number.parseInt(e[1],16);n=[(t>>>16&255)/255,(t>>>8&255)/255,(t&255)/255]}}let r=Array.isArray(n)||ArrayBuffer.isView(n)?n:t;return[L(R(r[0],t[0]),0,1),L(R(r[1],t[1]),0,1),L(R(r[2],t[2]),0,1)]}function ct(e){let t=Math.max(1,Math.ceil(R(e,1))),n=1;for(;n<t;)n*=2;return n}function lt(e={}){let t=e&&typeof e==`object`?e:{},n=t,r=ot(Qe,t.mode)?t.mode:I.mode,i=ot($e,t.technique)?t.technique:I.technique,a=ot(et,t.direction)?t.direction:I.direction,o=ot(tt,t.gloss)?t.gloss:I.gloss,s=ot(nt,t.bevelContour)?t.bevelContour:I.bevelContour;return{enabled:!!t.enabled,mode:r,technique:i,direction:a,gloss:o,contourAA:t.contourAA!==!1,bevelContourEnabled:t.bevelContourEnabled===!0,bevelContour:s,size:L(R(t.size,I.size),.5,250),soften:L(R(t.soften,I.soften),0,64),bevelRange:L(R(t.bevelRange,I.bevelRange),1,100),fill:L(R(t.fill,I.fill),0,100),depth:L(R(t.depth,I.depth),1,1e3),angle:(R(t.angle,I.angle)%360+360)%360,altitude:L(R(t.altitude,I.altitude),0,90),highlightColor:st(t.highlightColor??n.highlight,rt),highlightOpacity:L(R(t.highlightOpacity,I.highlightOpacity),0,100),shadowColor:st(t.shadowColor??n.shadow,it),shadowOpacity:L(R(t.shadowOpacity,I.shadowOpacity),0,100)}}function ut(e={}){let t=lt(e);return{...t,highlightColor:[...t.highlightColor],shadowColor:[...t.shadowColor]}}function dt(e=I){let t=lt(e),n=t.technique===`smooth`,r=n?at.smoothSigmaScale*t.size:0,i=t.technique===`chiselSoft`?at.chiselSoftSigmaScale*t.size:0,a=at.softenSigmaScale*t.soften,o=Math.hypot(.5,i,a),s=(t.mode===`emboss`?2:1)*t.size;return{style:t,sigma1:r,sigmaTech:i,sigmaSoften:a,sigmaB:o,bandWidth:s,amplitudeScale:s*(n?at.smoothAmplitudeScale:1),apron:Math.ceil(Math.max(t.size,3*r)+3*o+2)}}function ft(e=I){return dt(e).apron}function pt(e=I){return L(ct(ft(e)),2,576)}function mt(e=I){let t=lt(e);return[t.mode,t.technique,t.size,t.soften,+!!t.bevelContourEnabled,t.bevelContour,t.bevelRange].join(`|`)}function ht(e,t){let n=lt(e),r=lt(t);return n.enabled===r.enabled&&n.mode===r.mode&&n.technique===r.technique&&n.direction===r.direction&&n.gloss===r.gloss&&n.contourAA===r.contourAA&&n.bevelContourEnabled===r.bevelContourEnabled&&n.bevelContour===r.bevelContour&&n.bevelRange===r.bevelRange&&n.fill===r.fill&&n.size===r.size&&n.soften===r.soften&&n.depth===r.depth&&n.angle===r.angle&&n.altitude===r.altitude&&n.highlightOpacity===r.highlightOpacity&&n.shadowOpacity===r.shadowOpacity&&n.highlightColor.every((e,t)=>e===r.highlightColor[t])&&n.shadowColor.every((e,t)=>e===r.shadowColor[t])}function gt(e,t,n=0){let r=lt(e),i=lt(t),a=Math.max(0,Math.trunc(R(n,0))),o=i.enabled?pt(i):0,s=mt(r)!==mt(i),c=i.enabled&&(!r.enabled||s||a<o);return{changed:!ht(r,i),geometryChanged:s,geometryRebuild:c,lutChanged:r.gloss!==i.gloss,requestedRadius:o,requestedBucket:o,currentBucket:a,release:r.enabled&&!i.enabled,hotOnly:!c}}function _t(e,t,n=4096,r=4096){if(!e)return null;let i=lt(t),a=i.enabled&&i.mode!==`inner`?Math.ceil(ft(i)+1):0,o=L(Math.floor(e.x-a),0,n),s=L(Math.floor(e.y-a),0,r),c=L(Math.ceil(e.x+e.width+a),0,n),l=L(Math.ceil(e.y+e.height+a),0,r);return c>o&&l>s?{x:o,y:s,width:c-o,height:l-s}:null}function vt(e,t,n=4096,r=4096){if(!e)return null;let i=lt(t),a=i.enabled?Math.ceil(ft(i)+1):0,o=L(Math.floor(e.x-a),0,n),s=L(Math.floor(e.y-a),0,r),c=L(Math.ceil(e.x+e.width+a),0,n),l=L(Math.ceil(e.y+e.height+a),0,r);return c>o&&l>s?{x:o,y:s,width:c-o,height:l-s}:null}function yt(e,t){let n=R(e,135)*Math.PI/180,r=L(R(t,30),0,90)*Math.PI/180,i=Math.cos(r);return[Math.cos(n)*i,Math.sin(n)*i,Math.sin(r)]}var bt=Object.freeze({linear:Object.freeze([{x:0,y:0},{x:1,y:1}]),cone:Object.freeze([{x:0,y:0},{x:.5,y:1,corner:!0},{x:1,y:0}]),gaussian:Object.freeze([{x:0,y:0},{x:.25,y:.06},{x:.75,y:.94},{x:1,y:1}]),ring:Object.freeze([{x:0,y:0},{x:.25,y:1},{x:.5,y:.1},{x:.75,y:.9},{x:1,y:1}])});function xt(e){let t=[[e[0]]];for(let n=1;n<e.length;n+=1)t[t.length-1].push(e[n]),e[n].corner&&n<e.length-1&&t.push([e[n]]);return t.map(e=>{let t=e.length,n=new Float64Array(t);if(t>=3){let r=new Float64Array(t),i=new Float64Array(t),a=new Float64Array(t),o=new Float64Array(t);i[0]=1,i[t-1]=1;for(let n=1;n<t-1;n+=1){let t=e[n].x-e[n-1].x,s=e[n+1].x-e[n].x;r[n]=t,i[n]=2*(t+s),a[n]=s,o[n]=6*((e[n+1].y-e[n].y)/s-(e[n].y-e[n-1].y)/t)}for(let e=1;e<t;e+=1){let t=r[e]/i[e-1];i[e]-=t*a[e-1],o[e]-=t*o[e-1]}for(let e=t-2;e>=1;--e)n[e]=(o[e]-a[e]*n[e+1])/i[e]}return{points:e,second:n}})}function St(e,t){let n=e.points;if(t<=n[0].x)return n[0].y;if(t>=n[n.length-1].x)return n[n.length-1].y;let r=0;for(;t>n[r+1].x;)r+=1;let i=n[r+1].x-n[r].x,a=(t-n[r].x)/i;return(1-a)*n[r].y+a*n[r+1].y+i*i/6*((1-a)*((1-a)**2-1)*e.second[r]+a*(a*a-1)*e.second[r+1])}function Ct(e=`linear`,t=Xe){let n=e===`soft`?`gaussian`:e,r=ot(nt,n)?n:`linear`,i=Math.max(2,Math.trunc(R(t,Xe))),a=xt(bt[r]),o=new Float32Array(i);for(let e=0;e<i;e+=1){let t=e/(i-1);o[e]=L(St(a.find(e=>t<=e.points[e.points.length-1].x+1e-9)??a[a.length-1],t),0,1)}return o}var wt=`style-stack-webgpu-v7-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even`,Tt=`persistent-packed-r8-style-coverage`,Et=`register-only-during-coverage-resolve`,Dt=`threshold-change-or-existing-coverage-one-pixel-halo`,Ot=`direct-lod0-plus-derived-mips-1-through-12`,kt=2048,z=8,At=80,jt=At,Mt=80,Nt=256,Pt=2048,Ft=4294967295,It=32,Lt=4,Rt=1,zt=3,Bt=zt*4,Vt=64;function Ht(e,t,n){return Math.max(t,Math.min(n,e))}function Ut(e){return e===`light-glaze`?1:e===`thickness-tail`?2:0}function Wt(e){return e===`inside`?0:e===`center`?1:2}function Gt(e,t,n){if(!e)return null;let r=Ht(Math.floor(e.x),0,t),i=Ht(Math.floor(e.y),0,n),a=Ht(Math.ceil(e.x+e.width),0,t),o=Ht(Math.ceil(e.y+e.height),0,n);return a>r&&o>i?{x:r,y:i,width:a-r,height:o-i}:null}function Kt(e,t,n){let r=Gt(e,t,n);if(!r)return null;let i=Math.floor(r.x/Lt)*Lt,a=Math.min(t,Math.ceil((r.x+r.width)/Lt)*Lt);return{x:i,y:r.y,width:a-i,height:r.height}}function qt(e,t,n){let r=Gt(e,t,n);return r?Gt({x:r.x-Rt,y:r.y-Rt,width:r.width+Rt*2,height:r.height+Rt*2},t,n):null}function Jt(e,t,n){let r=Gt(e,t*2,n*2);if(!r)return null;let i=Math.floor(r.x/2),a=Math.floor(r.y/2),o=Math.min(t,Math.ceil((r.x+r.width)/2)),s=Math.min(n,Math.ceil((r.y+r.height)/2));return o>i&&s>a?{x:i,y:a,width:o-i,height:s-a}:null}function Yt(e,t,n=0){return`
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  scratchExtent: u32,
  strokeEnabled: u32,
  styleColor: vec4<f32>,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  _pad0: u32,
  _pad1: vec2<u32>,
};

const DOCUMENT_SIZE = vec2<i32>(${e}, ${t});
const INVALID_SEED: u32 = ${Ft}u;

@group(${n}) @binding(0) var<uniform> parameters: StrokeParameters;
@group(${n}) @binding(1) var permanentTexture: texture_2d<f32>;
@group(${n}) @binding(2) var transientTexture: texture_2d<f32>;
@group(${n}) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(${n}) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < DOCUMENT_SIZE);
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return round(clamp(value, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0) / 255.0;
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
}

fn resolvedLightGlaze(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(accumulatedStroke.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn sourceTexel(position: vec2<i32>) -> vec4<f32> {
  if (!insideDocument(position)) {
    return vec4<f32>(0.0);
  }
  let permanentPaint = textureLoad(permanentTexture, position, 0);
  if (parameters.sourceMode == 1u) {
    let strokePaint = resolvedLightGlaze(textureLoad(transientTexture, position, 0));
    return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
  }
  if (parameters.sourceMode == 2u) {
    let tailOrigin = vec2<i32>(thicknessTail.origin);
    let tailPosition = position - tailOrigin;
    let tailSize = vec2<i32>(thicknessTail.textureSize);
    if (all(tailPosition >= vec2<i32>(0)) && all(tailPosition < tailSize)) {
      let transientPaint = textureLoad(transientTexture, tailPosition, 0);
      if (thicknessTail.compositionMode == 1u) {
        return vec4<f32>(
          permanentPaint.rgb + transientPaint.rgb,
          transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
        );
      }
      return transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }
  return permanentPaint;
}

fn packSeed(position: vec2<u32>) -> u32 {
  return (position.x & 65535u) | ((position.y & 65535u) << 16u);
}

fn unpackSeed(value: u32) -> vec2<u32> {
  return vec2<u32>(value & 65535u, value >> 16u);
}
`}function Xt(e,t){return`${Yt(e,t)}
@group(0) @binding(5) var<storage, read_write> outputSeeds: array<vec2<u32>>;

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let localPosition = globalId.xy;
  let documentPosition = parameters.buildOrigin + vec2<i32>(localPosition);
  let inside = sourceTexel(documentPosition).a >= 0.5;
  let packed = packSeed(localPosition);
  let value = select(
    vec2<u32>(INVALID_SEED, packed),
    vec2<u32>(packed, INVALID_SEED),
    inside
  );
  outputSeeds[localPosition.y * parameters.scratchExtent + localPosition.x] = value;
}
`}function Zt(){return`
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  scratchExtent: u32,
  strokeEnabled: u32,
  styleColor: vec4<f32>,
};

const INVALID_SEED: u32 = ${Ft}u;

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
@group(0) @binding(1) var<storage, read> inputSeeds: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> outputSeeds: array<vec2<u32>>;

fn unpackSeed(value: u32) -> vec2<u32> {
  return vec2<u32>(value & 65535u, value >> 16u);
}

fn tieLess(left: vec2<u32>, right: vec2<u32>) -> bool {
  return left.y < right.y || (left.y == right.y && left.x < right.x);
}

fn bestCandidate(position: vec2<u32>, candidateIndex: u32) -> u32 {
  var found = false;
  var bestDistance = 3.402823e38;
  var bestPosition = vec2<u32>(65535u);
  var best = INVALID_SEED;
  let signedPosition = vec2<i32>(position);
  let step = i32(parameters.step);

  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let samplePosition = signedPosition + vec2<i32>(offsetX, offsetY) * step;
      if (
        any(samplePosition < vec2<i32>(0))
        || any(samplePosition >= vec2<i32>(parameters.buildSize))
      ) {
        continue;
      }
      let pair = inputSeeds[
        u32(samplePosition.y) * parameters.scratchExtent + u32(samplePosition.x)
      ];
      let candidate = select(pair.x, pair.y, candidateIndex == 1u);
      if (candidate == INVALID_SEED) {
        continue;
      }
      let candidatePosition = unpackSeed(candidate);
      let delta = vec2<f32>(position) - vec2<f32>(candidatePosition);
      let distance = dot(delta, delta);
      if (
        !found
        || distance < bestDistance - 1e-5
        || (abs(distance - bestDistance) <= 1e-5
          && tieLess(candidatePosition, bestPosition))
      ) {
        found = true;
        bestDistance = distance;
        bestPosition = candidatePosition;
        best = candidate;
      }
    }
  }
  return best;
}

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let position = globalId.xy;
  outputSeeds[position.y * parameters.scratchExtent + position.x] = vec2<u32>(
    bestCandidate(position, 0u),
    bestCandidate(position, 1u)
  );
}
`}function Qt(e,t){return`${Yt(e,t)}
@group(0) @binding(5) var<storage, read> propagatedSeeds: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read_write> coverageField: array<u32>;

fn rampAt(offset: f32, signedDistance: f32) -> f32 {
  return clamp(offset + 0.5 - signedDistance, 0.0, 1.0);
}

fn resolveCoverageByte(
  documentPosition: vec2<u32>,
  localPosition: vec2<u32>
) -> u32 {
  let pair = propagatedSeeds[
    localPosition.y * parameters.scratchExtent + localPosition.x
  ];
  let alpha = sourceTexel(vec2<i32>(documentPosition)).a;
  let inside = alpha >= 0.5;
  let candidate = select(pair.x, pair.y, inside);
  if (candidate == INVALID_SEED) {
    return 0u;
  }
  let seedPosition = unpackSeed(candidate);
  let delta = vec2<f32>(seedPosition) - vec2<f32>(localPosition);
  let distance = sqrt(dot(delta, delta));
  let fixedDistance = u32(floor(min(distance, 1023.0) * 64.0 + 0.5));
  if (fixedDistance < 1u) {
    return 0u;
  }
  let quantizedDistance = f32(fixedDistance) / 64.0;
  let signedDistance = select(
    quantizedDistance - 0.5 - alpha,
    1.5 - alpha - quantizedDistance,
    inside
  );
  let f0 = rampAt(0.0, signedDistance);
  var coverage = 0.0;
  if (parameters.stylePosition == 2u) {
    coverage = rampAt(parameters.styleWidth, signedDistance) - f0;
  } else if (parameters.stylePosition == 0u) {
    coverage = f0 - rampAt(-parameters.styleWidth, signedDistance);
  } else {
    let radius = parameters.styleWidth * 0.5;
    coverage = rampAt(radius, signedDistance) - rampAt(-radius, signedDistance);
  }
  return u32(floor(clamp(coverage, 0.0, 1.0) * 255.0 + 0.5));
}

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.targetSize.y) {
    return;
  }
  let firstX = globalId.x * 4u;
  if (firstX >= parameters.targetSize.x) {
    return;
  }
  let firstOffset = vec2<u32>(firstX, globalId.y);
  let firstDocumentPosition = parameters.targetOrigin + firstOffset;
  var packedCoverage = 0u;
  for (var lane = 0u; lane < 4u; lane += 1u) {
    if (firstX + lane >= parameters.targetSize.x) {
      continue;
    }
    let offset = firstOffset + vec2<u32>(lane, 0u);
    let coverage = resolveCoverageByte(
      parameters.targetOrigin + offset,
      parameters.localTargetOrigin + offset
    );
    packedCoverage |= coverage << (lane * 8u);
  }
  let linearIndex = firstDocumentPosition.y * ${e}u
    + firstDocumentPosition.x;
  coverageField[linearIndex >> 2u] = packedCoverage;
}
`}function $t(e,t=0,n=5,r=7,i=8,a=9,o=`analytic`){return`
struct BevelUniforms {
  flags: vec4<u32>,
  scalars: vec4<f32>,
  light: vec4<f32>,
  highlight: vec4<f32>,
  shadow: vec4<f32>,
};

@group(${t}) @binding(${n})
var<storage, read> coverageField: array<u32>;
@group(${t}) @binding(${r}) var bevelHeight: texture_2d<f32>;
@group(${t}) @binding(${i}) var bevelGloss: texture_2d<f32>;
@group(${t}) @binding(${a}) var<uniform> bevel: BevelUniforms;

fn loadCoverageByte(position: vec2<i32>) -> u32 {
  let linearIndex = u32(position.y) * ${e}u + u32(position.x);
  let packed = coverageField[linearIndex >> 2u];
  let shift = (linearIndex & 3u) * 8u;
  return (packed >> shift) & 255u;
}

fn bevelHeightAt(position: vec2<i32>) -> f32 {
  let apron = vec2<i32>(1);
  if (
    any(position < -apron)
    || any(position >= DOCUMENT_SIZE + apron)
  ) {
    return 0.0;
  }
  return textureLoad(bevelHeight, position + apron, 0).r;
}

fn reliefResponse(normal: vec3<f32>, light: vec3<f32>) -> f32 {
  let value = clamp(dot(normal, light), -1.0, 1.0);
  let baseline = light.z;
  if (value >= baseline) {
    return clamp((value - baseline) / max(1e-5, 1.0 - baseline), -1.0, 1.0);
  }
  return clamp((value - baseline) / max(1e-5, 1.0 + baseline), -1.0, 1.0);
}

fn lightContour(value: f32) -> f32 {
  let size = textureDimensions(bevelGloss).x;
  let q = clamp(value, 0.0, 1.0) * f32(size - 1u);
  let first = u32(floor(q));
  let second = min(size - 1u, first + 1u);
  return mix(
    textureLoad(bevelGloss, vec2<i32>(i32(first), 0), 0).r,
    textureLoad(bevelGloss, vec2<i32>(i32(second), 0), 0).r,
    fract(q)
  );
}

fn bevelResponseAt(position: vec2<i32>) -> vec2<f32> {
  let nw = bevelHeightAt(position + vec2<i32>(-1, 1));
  let n = bevelHeightAt(position + vec2<i32>(0, 1));
  let ne = bevelHeightAt(position + vec2<i32>(1, 1));
  let w = bevelHeightAt(position + vec2<i32>(-1, 0));
  let e = bevelHeightAt(position + vec2<i32>(1, 0));
  let sw = bevelHeightAt(position + vec2<i32>(-1, -1));
  let s = bevelHeightAt(position + vec2<i32>(0, -1));
  let se = bevelHeightAt(position + vec2<i32>(1, -1));
  let gradient = vec2<f32>(
    (3.0 * (ne - nw) + 10.0 * (e - w) + 3.0 * (se - sw)) / 32.0,
    (3.0 * (nw - sw) + 10.0 * (n - s) + 3.0 * (ne - se)) / 32.0
  );
  let effectMask = smoothstep(1e-6, 2e-4, length(gradient));
  let normal = normalize(vec3<f32>(-bevel.scalars.x * gradient, 1.0));
  let response = reliefResponse(normal, normalize(bevel.light.xyz));
  return vec2<f32>(response * 0.5 + 0.5, effectMask);
}

fn overPlane(dst: vec4<f32>, color: vec3<f32>, sourceAlpha: f32) -> vec4<f32> {
  let alpha = clamp(sourceAlpha, 0.0, 1.0);
  return vec4<f32>(
    color * alpha + dst.rgb * (1.0 - alpha),
    alpha + dst.a * (1.0 - alpha)
  );
}

fn blendEffect(
  dst: vec4<f32>,
  color: vec3<f32>,
  sourceAlpha: f32,
  screenMode: bool,
) -> vec4<f32> {
  let alpha = clamp(sourceAlpha, 0.0, 1.0);
  if (alpha <= 0.0) {
    return dst;
  }
  if (dst.a <= 1e-6) {
    return overPlane(dst, color, alpha);
  }
  let base = dst.rgb / dst.a;
  let blended = select(base * color, base + color - base * color, screenMode);
  let outputAlpha = max(dst.a, alpha);
  return vec4<f32>(mix(base, blended, alpha) * outputAlpha, outputAlpha);
}

fn bevelNode(base: vec4<f32>, position: vec2<i32>) -> vec4<f32> {
  var node = vec4<f32>(base.rgb * bevel.scalars.y, base.a * bevel.scalars.y);
  let response = bevelResponseAt(position);
  let t = response.x;
  var contour = lightContour(t);
${o===`fragment`?`
    if (bevel.flags.z == 1u) {
      let dt = 0.5 * fwidth(t);
      contour = (
        lightContour(t - dt) + lightContour(t) + lightContour(t + dt)
      ) / 3.0;
    }`:`
    if (bevel.flags.z == 1u) {
      let quadOrigin = position - (position & vec2<i32>(1));
      let leftT = bevelResponseAt(vec2<i32>(quadOrigin.x, position.y)).x;
      let rightT = bevelResponseAt(vec2<i32>(quadOrigin.x + 1, position.y)).x;
      let topT = bevelResponseAt(vec2<i32>(position.x, quadOrigin.y)).x;
      let bottomT = bevelResponseAt(vec2<i32>(position.x, quadOrigin.y + 1)).x;
      let dt = 0.5 * (abs(rightT - leftT) + abs(bottomT - topT));
      contour = (
        lightContour(t - dt) + lightContour(t) + lightContour(t + dt)
      ) / 3.0;
    }`}
  let signedLight = 2.0 * contour - 1.0;
  let highlightWeight = max(signedLight, 0.0) * bevel.highlight.a * response.y;
  let shadowWeight = max(-signedLight, 0.0) * bevel.shadow.a * response.y;
  let insideWeight = select(base.a, 0.0, bevel.flags.y == 1u);
  let outsideWeight = select(1.0 - base.a, 0.0, bevel.flags.y == 0u);
  let innerHighlight = highlightWeight * insideWeight;
  let innerShadow = shadowWeight * insideWeight;
  let outerHighlight = highlightWeight * outsideWeight;
  let outerShadow = shadowWeight * outsideWeight;
  var straight = vec3<f32>(0.0);
  if (base.a > 1e-6) {
    straight = base.rgb / base.a;
  }
  var group = vec4<f32>(0.0);
  group = overPlane(group, bevel.shadow.rgb, outerShadow);
  group = overPlane(group, bevel.highlight.rgb, outerHighlight);
  group = overPlane(group, straight, base.a * bevel.scalars.y);
  group = blendEffect(group, bevel.shadow.rgb, innerShadow, false);
  group = blendEffect(group, bevel.highlight.rgb, innerHighlight, true);
  node = group;
  return node;
}

fn traceOnlyNode(base: vec4<f32>, coverage: f32) -> vec4<f32> {
  let alpha = base.a;
  var strokeWeight = coverage * parameters.styleColor.a;
  if (parameters.stylePosition == 2u) {
    strokeWeight = min(strokeWeight, 1.0 - alpha);
  }
  let baseWeight = select(
    max(0.0, alpha - strokeWeight),
    alpha,
    parameters.stylePosition == 2u
  );
  let finalAlpha = select(
    max(alpha, strokeWeight),
    min(1.0, alpha + strokeWeight),
    parameters.stylePosition == 2u
  );
  var baseStraight = vec3<f32>(0.0);
  if (alpha > 0.0) {
    baseStraight = base.rgb / alpha;
  }
  let result = vec4<f32>(
    parameters.styleColor.rgb * strokeWeight + baseStraight * baseWeight,
    clamp(finalAlpha, 0.0, 1.0)
  );
  return vec4<f32>(
    clamp(result.rgb, vec3<f32>(0.0), vec3<f32>(result.a)),
    result.a
  );
}

fn combinedStrokeNode(sourceAlpha: f32, inputNode: vec4<f32>, coverage: f32) -> vec4<f32> {
  var node = inputNode;
  var strokeWeight = coverage * parameters.styleColor.a;
  if (parameters.stylePosition == 2u) {
    strokeWeight = min(strokeWeight, 1.0 - node.a);
  }
  if (strokeWeight > 0.0) {
    if (parameters.stylePosition == 2u) {
      node.rgb = node.rgb + parameters.styleColor.rgb * strokeWeight * (1.0 - node.a);
      node.a += strokeWeight * (1.0 - node.a);
    } else {
      let alpha = node.a;
      let baseWeight = max(0.0, alpha - strokeWeight);
      var straight = vec3<f32>(0.0);
      if (alpha > 1e-6) {
        straight = node.rgb / alpha;
      }
      node.rgb = parameters.styleColor.rgb * strokeWeight + straight * baseWeight;
      node.a = max(alpha, strokeWeight);
    }
  }
  return node;
}

fn hash32(input: u32) -> u32 {
  var value = input;
  value ^= value >> 16u;
  value *= 2146121005u;
  value ^= value >> 15u;
  value *= 2221713035u;
  value ^= value >> 16u;
  return value;
}

fn random24(position: vec2<u32>, seed: u32) -> f32 {
  let value = hash32(
    (position.x * 2654435769u) ^ (position.y * 2246822507u) ^ seed
  );
  return f32(value & 16777215u) / 16777215.0;
}

fn styledTexel(position: vec2<i32>) -> vec4<f32> {
  let base = sourceTexel(position);
  var coverage = 0.0;
  if (parameters.strokeEnabled == 1u) {
    coverage = f32(loadCoverageByte(position)) / 255.0;
  }
  if (bevel.flags.x == 0u) {
    if (parameters.strokeEnabled == 0u) {
      return base;
    }
    return traceOnlyNode(base, coverage);
  }
  var node = bevelNode(base, position);
  if (parameters.strokeEnabled == 1u) {
    node = combinedStrokeNode(base.a, node, coverage);
  }
  node.a = clamp(node.a, 0.0, 1.0);
  node.rgb = clamp(node.rgb, vec3<f32>(0.0), vec3<f32>(node.a));
  if (node.a > 1e-6) {
    var straight = node.rgb / node.a;
    let documentPosition = vec2<u32>(position);
    let noise = random24(documentPosition, 4660u)
      + random24(documentPosition, 40503u) - 1.0;
    straight = clamp(straight + noise * (0.75 / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
    node.rgb = straight * node.a;
  }
  return node * bevel.scalars.z;
}
`}function en(e,t,n){return`${Yt(e,t)}
${$t(e)}
@group(0) @binding(6) var styledTexture: texture_storage_2d<${n}, write>;

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let position = vec2<i32>(parameters.targetOrigin + globalId.xy);
  textureStore(styledTexture, position, styledTexel(position));
}
`}function tn(e,t,n){return`${Yt(e,t)}
${$t(e)}
@group(0) @binding(6) var coarseStyledTexture: texture_storage_2d<${n}, write>;

fn quantizedStyledTexel(position: vec2<i32>) -> vec4<f32> {
  return quantizeLayer(styledTexel(clamp(position, vec2<i32>(0), DOCUMENT_SIZE - 1)));
}

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let coarsePosition = vec2<i32>(parameters.targetOrigin + globalId.xy);
  let sourceOrigin = coarsePosition * 2;
  let p00 = quantizedStyledTexel(sourceOrigin);
  let p10 = quantizedStyledTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = quantizedStyledTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = quantizedStyledTexel(sourceOrigin + vec2<i32>(1, 1));
  textureStore(coarseStyledTexture, coarsePosition, (p00 + p10 + p01 + p11) * 0.25);
}
`}function nn(e,t){return`
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
${Yt(e,t,1)}
${$t(e,1,5,8,9,10,`fragment`)}
@group(1) @binding(6) var coarseStyledTexture: texture_2d<f32>;
@group(1) @binding(7) var layerSampler: sampler;

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

fn directStyledSample(layerPosition: vec2<f32>) -> vec4<f32> {
  let origin = vec2<i32>(floor(layerPosition));
  let fraction = fract(layerPosition);
  let maximumCoordinate = DOCUMENT_SIZE - vec2<i32>(1);
  let p00 = quantizeLayer(styledTexel(clamp(origin, vec2<i32>(0), maximumCoordinate)));
  let p10 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(1, 0),
    vec2<i32>(0),
    maximumCoordinate
  )));
  let p01 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(0, 1),
    vec2<i32>(0),
    maximumCoordinate
  )));
  let p11 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(1, 1),
    vec2<i32>(0),
    maximumCoordinate
  )));
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
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

  var paint: vec4<f32>;
  if (display.selectedMipLevel < 0.5) {
    paint = directStyledSample(layerPosition);
  } else {
    let uv = clamp(
      (layerPosition + vec2<f32>(0.5)) / display.layerSize,
      vec2<f32>(0.0),
      vec2<f32>(1.0)
    );
    paint = textureSampleLevel(
      coarseStyledTexture,
      layerSampler,
      uv,
      display.selectedMipLevel - 1.0
    );
  }

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`}function rn(e,t){let n=Math.ceil(e/It);return`${Yt(e,t)}
@group(0) @binding(5) var<storage, read_write> thresholdMask: array<u32>;
@group(0) @binding(6) var<storage, read_write> changeState: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> coverageField: array<u32>;

const THRESHOLD_WORD_BITS = ${It}u;
const THRESHOLD_WORDS_PER_ROW = ${n}u;

fn loadCoverageByte(position: vec2<u32>) -> u32 {
  let linearIndex = position.y * ${e}u + position.x;
  let packed = coverageField[linearIndex >> 2u];
  let shift = (linearIndex & 3u) * 8u;
  return (packed >> shift) & 255u;
}

@compute @workgroup_size(${z}, ${z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let firstWord = parameters.targetOrigin.x / THRESHOLD_WORD_BITS;
  let firstBit = parameters.targetOrigin.x % THRESHOLD_WORD_BITS;
  let wordCount = (
    firstBit + parameters.targetSize.x + THRESHOLD_WORD_BITS - 1u
  ) / THRESHOLD_WORD_BITS;
  if (globalId.x >= wordCount || globalId.y >= parameters.targetSize.y) {
    return;
  }

  let wordX = firstWord + globalId.x;
  let documentY = parameters.targetOrigin.y + globalId.y;
  let wordOriginX = wordX * THRESHOLD_WORD_BITS;
  let targetRight = parameters.targetOrigin.x + parameters.targetSize.x;
  var writeMask = 0u;
  var nextBits = 0u;
  for (var lane = 0u; lane < THRESHOLD_WORD_BITS; lane += 1u) {
    let documentX = wordOriginX + lane;
    if (
      documentX < parameters.targetOrigin.x
      || documentX >= targetRight
      || documentX >= ${e}u
    ) {
      continue;
    }
    let bit = 1u << lane;
    writeMask |= bit;
    let documentPosition = vec2<u32>(documentX, documentY);
    if (sourceTexel(vec2<i32>(documentPosition)).a >= 0.5) {
      nextBits |= bit;
    }
    if (loadCoverageByte(documentPosition) != 0u) {
      atomicOr(&changeState[0], 2u);
    }
  }

  let maskIndex = documentY * THRESHOLD_WORDS_PER_ROW + wordX;
  let previousBits = thresholdMask[maskIndex];
  let updatedBits = (previousBits & ~writeMask) | (nextBits & writeMask);
  if (updatedBits != previousBits) {
    atomicOr(&changeState[0], 1u);
  }
  thresholdMask[maskIndex] = updatedBits;
}
`}function an(){return`
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  scratchExtent: u32,
  strokeEnabled: u32,
  styleColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
@group(0) @binding(1) var<storage, read_write> changeState: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirectArguments: array<u32>;

@compute @workgroup_size(${Vt})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let argumentIndex = globalId.x;
  if (argumentIndex >= parameters.targetSize.x) {
    return;
  }
  if (atomicLoad(&changeState[0]) != 0u) {
    return;
  }
  let word = argumentIndex * ${zt}u;
  indirectArguments[word] = 0u;
  indirectArguments[word + 1u] = 0u;
  indirectArguments[word + 2u] = 0u;
}
`}async function on(e){let t=(await Promise.all(e.map(async({label:e,module:t})=>({label:e,messages:(await t.getCompilationInfo()).messages})))).flatMap(({label:e,messages:t})=>[...t].filter(e=>e.type===`error`).map(t=>`${e}:${t.lineNum}:${t.linePos} ${t.message}`));if(t.length>0)throw Error(`Shader Traccia WGSL non valido:\n${t.join(`
`)}`)}var sn=class e{static async create(t){let n=new e(t);try{return await n.initialize(),n}catch(e){throw n.destroy(),e}}build=wt;samplingView;mipViews;styledMipLevelCount;persistentMemoryBytes;styledMemoryBytes;coverageMemoryBytes;thresholdMaskMemoryBytes;controlMemoryBytes;device;documentWidth;documentHeight;layerFormat;layerView;lightGlazeUniformBuffer;thicknessTailUniformBuffer;readbackEnabled;maximumScratchExtent;_scratchExtent;_scratchMemoryBytes;parameterBuffer;displayParameterBuffers;displayParameterUpload=new ArrayBuffer(jt);displayParameterUploadU32=new Uint32Array(this.displayParameterUpload);displayParameterUploadF32=new Float32Array(this.displayParameterUpload);parameterUpload=new ArrayBuffer(Pt*Nt);bevelUniformBuffer;bevelUniformUpload=new ArrayBuffer(Mt);bevelUniformUploadU32=new Uint32Array(this.bevelUniformUpload);bevelUniformUploadF32=new Float32Array(this.bevelUniformUpload);parameterUploadI32=new Int32Array(this.parameterUpload);parameterUploadU32=new Uint32Array(this.parameterUpload);parameterUploadF32=new Float32Array(this.parameterUpload);indirectTemplateUpload=new Uint32Array(Pt*zt);scratchBuffers;coverageBuffer;thresholdMaskBuffer;changeStateBuffer;indirectArgumentsBuffer;coarseStyledTexture;coarseStyledStorageView;readbackStyledTexture;readbackStyledStorageView;goldenMip0SamplingView;dummyTexture;dummyView;dummyBevelTexture;dummyBevelView;bevelHeightView;bevelGlossView;seedBindGroupLayout;jfaBindGroupLayout;resolveBindGroupLayout;composeBindGroupLayout;thresholdMaskBindGroupLayout;indirectGateBindGroupLayout;seedPipeline;jfaPipeline;resolvePipeline;composePipeline;readbackComposePipeline=null;thresholdMaskPipeline;indirectGatePipeline;jfaBindGroups;indirectGateBindGroup;sourceViews;seedBindGroups=new Map;resolveBindGroups=new Map;composeBindGroups=new Map;readbackComposeBindGroups=new Map;thresholdMaskBindGroups=new Map;destroyed=!1;constructor(e){if(this.device=e.device,this.documentWidth=e.documentWidth,this.documentHeight=e.documentHeight,this.documentWidth%Lt!==0)throw Error(`La larghezza documento Traccia deve essere divisibile per 4.`);this.layerFormat=e.layerFormat,this.layerView=e.layerView,this.lightGlazeUniformBuffer=e.lightGlazeUniformBuffer,this.thicknessTailUniformBuffer=e.thicknessTailUniformBuffer,this.readbackEnabled=e.readbackEnabled===!0;let t=Math.floor(Math.sqrt(Number(this.device.limits.maxStorageBufferBindingSize)/8)),n=Math.floor(Math.sqrt(Number(this.device.limits.maxBufferSize)/8));this.maximumScratchExtent=Math.floor(Math.min(t,n)/z)*z,this._scratchExtent=this.normalizeScratchExtent(e.scratchExtent??kt),this.scratchBuffers=this.createScratchBuffers(this._scratchExtent),this._scratchMemoryBytes=this._scratchExtent*this._scratchExtent*8*2;let r=Pt*Nt;this.parameterBuffer=this.device.createBuffer({label:`Traccia dynamic dispatch parameters`,size:r,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayParameterBuffers={0:this.device.createBuffer({label:`Traccia direct LOD 0 permanent display parameters`,size:jt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),1:this.device.createBuffer({label:`Traccia direct LOD 0 Light Glaze display parameters`,size:jt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),2:this.device.createBuffer({label:`Traccia direct LOD 0 thickness tail display parameters`,size:jt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.bevelUniformBuffer=this.device.createBuffer({label:`Style stack Smusso/Rilievo composition parameters`,size:Mt,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.updateBevelParameters(I);let i=Math.ceil(this.documentWidth*this.documentHeight/Lt);this.coverageBuffer=this.device.createBuffer({label:`Traccia persistent packed R8 coverage`,size:i*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});let a=Math.ceil(this.documentWidth/It)*this.documentHeight*4;this.thresholdMaskBuffer=this.device.createBuffer({label:`Traccia persistent alpha-threshold bit mask`,size:a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.changeStateBuffer=this.device.createBuffer({label:`Traccia threshold-or-coverage-overlap change flags`,size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|(this.readbackEnabled?GPUBufferUsage.COPY_SRC:0)});let o=Pt*Bt;this.indirectArgumentsBuffer=this.device.createBuffer({label:`Traccia threshold-or-coverage-gated indirect dispatch arguments`,size:o,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST});let s=Math.floor(Math.log2(Math.max(this.documentWidth,this.documentHeight)))+1;this.styledMipLevelCount=s;let c=Math.max(1,this.documentWidth>>1),l=Math.max(1,this.documentHeight>>1),u=s-1;this.coarseStyledTexture=this.device.createTexture({label:`Traccia styled derived mip 1+ ${this.layerFormat}`,size:{width:c,height:l,depthOrArrayLayers:1},mipLevelCount:u,format:this.layerFormat,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|(this.readbackEnabled?GPUTextureUsage.COPY_SRC:0)}),this.coarseStyledStorageView=this.coarseStyledTexture.createView({label:`Traccia styled derived logical mip 1 storage view`,baseMipLevel:0,mipLevelCount:1}),this.samplingView=this.coarseStyledTexture.createView({label:`Traccia styled derived mip 1+ sampling chain`,baseMipLevel:0,mipLevelCount:u}),this.mipViews=Array.from({length:u},(e,t)=>this.coarseStyledTexture.createView({label:`Traccia styled logical mip ${t+1}`,baseMipLevel:t,mipLevelCount:1})),this.readbackStyledTexture=this.readbackEnabled?this.device.createTexture({label:`Traccia golden logical mip 0 ${this.layerFormat}`,size:{width:this.documentWidth,height:this.documentHeight,depthOrArrayLayers:1},format:this.layerFormat,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING}):null,this.readbackStyledStorageView=this.readbackStyledTexture?.createView({label:`Traccia golden logical mip 0 storage view`})??null,this.goldenMip0SamplingView=this.readbackStyledTexture?.createView({label:`Traccia golden logical mip 0 sampling view`})??null,this.dummyTexture=this.device.createTexture({label:`Traccia transparent transient placeholder`,size:{width:1,height:1,depthOrArrayLayers:1},format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.device.queue.writeTexture({texture:this.dummyTexture},new Uint8Array(256),{bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1}),this.dummyView=this.dummyTexture.createView(),this.sourceViews={0:this.dummyView,1:this.dummyView,2:this.dummyView};let d=this.layerFormat===`rgba16float`?8:4;this.dummyBevelTexture=this.device.createTexture({label:`Style stack disabled Smusso R32F placeholder`,size:{width:1,height:1,depthOrArrayLayers:1},format:`r32float`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.device.queue.writeTexture({texture:this.dummyBevelTexture},new Float32Array(64),{bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1}),this.dummyBevelView=this.dummyBevelTexture.createView(),this.bevelHeightView=this.dummyBevelView,this.bevelGlossView=this.dummyBevelView;let f=0;for(let e=1;e<s;e+=1)f+=Math.max(1,this.documentWidth>>e)*Math.max(1,this.documentHeight>>e);this.styledMemoryBytes=f*d,this.coverageMemoryBytes=i*4,this.thresholdMaskMemoryBytes=a,this.controlMemoryBytes=549192,this.persistentMemoryBytes=this.coverageMemoryBytes+this.styledMemoryBytes+this.thresholdMaskMemoryBytes+this.controlMemoryBytes}get scratchExtent(){return this._scratchExtent}get scratchMemoryBytes(){return this._scratchMemoryBytes}createDisplayBindGroup(e,t,n){let r=Ut(n);return this.device.createBindGroup({label:`Traccia direct/coarse display source mode ${n}`,layout:e,entries:[{binding:0,resource:{buffer:this.displayParameterBuffers[r]}},{binding:1,resource:this.layerView},{binding:2,resource:this.sourceViews[r]},{binding:3,resource:{buffer:this.lightGlazeUniformBuffer}},{binding:4,resource:{buffer:this.thicknessTailUniformBuffer}},{binding:5,resource:{buffer:this.coverageBuffer}},{binding:6,resource:this.samplingView},{binding:7,resource:t},{binding:8,resource:this.bevelHeightView},{binding:9,resource:this.bevelGlossView},{binding:10,resource:{buffer:this.bevelUniformBuffer}}]})}normalizeScratchExtent(e){let t=Math.max(z,Math.trunc(Number(e)||kt)),n=Math.floor(Math.min(t,this.maximumScratchExtent)/z)*z;if(n<z)throw Error(`Limite storage GPU insufficiente per lo scratch Traccia.`);return n}createScratchBuffers(e){let t=e*e*8;return[this.device.createBuffer({label:`Traccia packed dual JFA scratch A ${e}²`,size:t,usage:GPUBufferUsage.STORAGE}),this.device.createBuffer({label:`Traccia packed dual JFA scratch B ${e}²`,size:t,usage:GPUBufferUsage.STORAGE})]}resizeScratch(e){if(this.destroyed)throw Error(`Renderer Traccia già distrutto.`);let t=this.normalizeScratchExtent(e);if(t===this._scratchExtent)return!1;let n=this.scratchBuffers;return this.scratchBuffers=this.createScratchBuffers(t),this._scratchExtent=t,this._scratchMemoryBytes=t*t*8*2,this.jfaBindGroupLayout&&this.rebuildScratchBindGroups(),n[0].destroy(),n[1].destroy(),!0}async readStyledPixels(e,t=0){if(this.destroyed)throw Error(`Renderer Traccia già distrutto.`);if(!this.readbackEnabled)throw Error(`Readback Traccia non abilitato per questo renderer.`);if(!Number.isInteger(t)||t<0||t>=this.styledMipLevelCount)throw Error(`Mip Traccia non valido per il readback: ${t}.`);let n=t===0?this.readbackStyledTexture:this.coarseStyledTexture;if(!n)throw Error(`Texture golden Traccia mip 0 non disponibile.`);let r=t===0?0:t-1,i=Math.max(1,this.documentWidth>>t),a=Math.max(1,this.documentHeight>>t),o=Gt(e??{x:0,y:0,width:i,height:a},i,a);if(!o)return new Uint8Array;let s=this.layerFormat===`rgba16float`?8:4,c=o.width*s,l=Math.ceil(c/256)*256,u=this.device.createBuffer({label:`Traccia golden styled mip ${t} readback`,size:l*o.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{let e=this.device.createCommandEncoder({label:`Traccia golden styled mip ${t} readback encoder`});e.copyTextureToBuffer({texture:n,mipLevel:r,origin:{x:o.x,y:o.y,z:0}},{buffer:u,bytesPerRow:l,rowsPerImage:o.height},{width:o.width,height:o.height,depthOrArrayLayers:1}),this.device.queue.submit([e.finish()]),await u.mapAsync(GPUMapMode.READ);let i=new Uint8Array(u.getMappedRange()),a=new Uint8Array(c*o.height);for(let e=0;e<o.height;e+=1)a.set(i.subarray(e*l,e*l+c),e*c);return u.unmap(),a}finally{u.destroy()}}async readChangeStateFlags(){if(this.destroyed)throw Error(`Renderer Traccia già distrutto.`);if(!this.readbackEnabled)throw Error(`Readback Traccia non abilitato per questo renderer.`);let e=this.device.createBuffer({label:`Traccia golden change-state flag readback`,size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{let t=this.device.createCommandEncoder({label:`Traccia golden change-state flag readback encoder`});t.copyBufferToBuffer(this.changeStateBuffer,0,e,0,4),this.device.queue.submit([t.finish()]),await e.mapAsync(GPUMapMode.READ);let n=new Uint32Array(e.getMappedRange())[0]??0;return e.unmap(),n}finally{e.destroy()}}async initialize(){this.seedBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia seed bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]}),this.jfaBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia JFA bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]}),this.resolveBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia resolve bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]}),this.composeBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia compose bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:6,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:this.layerFormat}},{binding:7,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`unfilterable-float`}},{binding:8,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`unfilterable-float`}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}}]}),this.thresholdMaskBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia alpha-threshold mask bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}}]}),this.indirectGateBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia indirect dispatch gate bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:At}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]});let e=this.device.createShaderModule({label:`Traccia dual seed WGSL`,code:Xt(this.documentWidth,this.documentHeight)}),t=this.device.createShaderModule({label:`Traccia packed dual JFA WGSL`,code:Zt()}),n=this.device.createShaderModule({label:`Traccia Q10.6 to packed R8 coverage WGSL`,code:Qt(this.documentWidth,this.documentHeight)}),r=this.device.createShaderModule({label:`Traccia styled logical mip 1 compose WGSL`,code:tn(this.documentWidth,this.documentHeight,this.layerFormat)}),i=this.readbackEnabled?this.device.createShaderModule({label:`Traccia golden logical mip 0 compose WGSL`,code:en(this.documentWidth,this.documentHeight,this.layerFormat)}):null,a=this.device.createShaderModule({label:`Traccia alpha-threshold mask WGSL`,code:rn(this.documentWidth,this.documentHeight)}),o=this.device.createShaderModule({label:`Traccia indirect dispatch gate WGSL`,code:an()});await on([{label:`seed`,module:e},{label:`jfa`,module:t},{label:`resolve`,module:n},{label:`coarse-compose`,module:r},...i?[{label:`golden-readback-compose`,module:i}]:[],{label:`threshold-mask`,module:a},{label:`indirect-gate`,module:o}]),this.device.pushErrorScope(`validation`),this.seedPipeline=this.device.createComputePipeline({label:`Traccia dual seed pipeline`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.seedBindGroupLayout]}),compute:{module:e,entryPoint:`main`}}),this.jfaPipeline=this.device.createComputePipeline({label:`Traccia packed dual JFA pipeline`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.jfaBindGroupLayout]}),compute:{module:t,entryPoint:`main`}}),this.resolvePipeline=this.device.createComputePipeline({label:`Traccia packed R8 coverage resolve pipeline`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.resolveBindGroupLayout]}),compute:{module:n,entryPoint:`main`}});let s=this.device.createPipelineLayout({label:`Traccia styled compose pipeline layout`,bindGroupLayouts:[this.composeBindGroupLayout]});this.composePipeline=this.device.createComputePipeline({label:`Traccia styled logical mip 1 compose pipeline`,layout:s,compute:{module:r,entryPoint:`main`}}),this.readbackComposePipeline=i?this.device.createComputePipeline({label:`Traccia golden logical mip 0 compose pipeline`,layout:s,compute:{module:i,entryPoint:`main`}}):null,this.thresholdMaskPipeline=this.device.createComputePipeline({label:`Traccia alpha-threshold mask pipeline`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.thresholdMaskBindGroupLayout]}),compute:{module:a,entryPoint:`main`}}),this.indirectGatePipeline=this.device.createComputePipeline({label:`Traccia indirect dispatch gate pipeline`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.indirectGateBindGroupLayout]}),compute:{module:o,entryPoint:`main`}});let c=await this.device.popErrorScope();if(c)throw Error(c.message);this.rebuildScratchBindGroups(),this.indirectGateBindGroup=this.device.createBindGroup({label:`Traccia indirect dispatch gate bind group`,layout:this.indirectGateBindGroupLayout,entries:[{binding:0,resource:{buffer:this.parameterBuffer,offset:0,size:At}},{binding:1,resource:{buffer:this.changeStateBuffer}},{binding:2,resource:{buffer:this.indirectArgumentsBuffer}}]})}setLightGlazeView(e){this.sourceViews[1]=e??this.dummyView,this.seedBindGroupLayout&&this.rebuildSourceBindGroups(1)}setThicknessTailView(e){this.sourceViews[2]=e??this.dummyView,this.seedBindGroupLayout&&this.rebuildSourceBindGroups(2)}setBevelResources(e,t){this.bevelHeightView=e??this.dummyBevelView,this.bevelGlossView=t??this.dummyBevelView,this.composeBindGroupLayout&&(this.rebuildSourceBindGroups(0),this.rebuildSourceBindGroups(1),this.rebuildSourceBindGroups(2))}updateBevelParameters(e){if(this.destroyed)throw Error(`Renderer style stack già distrutto.`);let t=lt(e),n=dt(t),r=yt(t.angle,t.altitude),i=t.mode===`inner`?0:t.mode===`outer`?1:t.mode===`emboss`?2:3;this.bevelUniformUploadU32.fill(0),this.bevelUniformUploadU32[0]=+!!t.enabled,this.bevelUniformUploadU32[1]=i,this.bevelUniformUploadU32[2]=+!!t.contourAA,this.bevelUniformUploadF32[4]=n.amplitudeScale*(t.depth/100)*(t.direction===`down`?-1:1),this.bevelUniformUploadF32[5]=t.fill/100,this.bevelUniformUploadF32[6]=1,this.bevelUniformUploadF32[8]=r[0],this.bevelUniformUploadF32[9]=r[1],this.bevelUniformUploadF32[10]=r[2],this.bevelUniformUploadF32[12]=t.highlightColor[0],this.bevelUniformUploadF32[13]=t.highlightColor[1],this.bevelUniformUploadF32[14]=t.highlightColor[2],this.bevelUniformUploadF32[15]=t.highlightOpacity/100,this.bevelUniformUploadF32[16]=t.shadowColor[0],this.bevelUniformUploadF32[17]=t.shadowColor[1],this.bevelUniformUploadF32[18]=t.shadowColor[2],this.bevelUniformUploadF32[19]=t.shadowOpacity/100,this.device.queue.writeBuffer(this.bevelUniformBuffer,0,this.bevelUniformUpload)}rebuildScratchBindGroups(){this.jfaBindGroups=[this.device.createBindGroup({label:`Traccia JFA A to B`,layout:this.jfaBindGroupLayout,entries:[{binding:0,resource:{buffer:this.parameterBuffer,offset:0,size:At}},{binding:1,resource:{buffer:this.scratchBuffers[0]}},{binding:2,resource:{buffer:this.scratchBuffers[1]}}]}),this.device.createBindGroup({label:`Traccia JFA B to A`,layout:this.jfaBindGroupLayout,entries:[{binding:0,resource:{buffer:this.parameterBuffer,offset:0,size:At}},{binding:1,resource:{buffer:this.scratchBuffers[1]}},{binding:2,resource:{buffer:this.scratchBuffers[0]}}]})],this.rebuildSourceBindGroups(0),this.rebuildSourceBindGroups(1),this.rebuildSourceBindGroups(2)}commonSourceEntries(e){return[{binding:0,resource:{buffer:this.parameterBuffer,offset:0,size:At}},{binding:1,resource:this.layerView},{binding:2,resource:this.sourceViews[e]},{binding:3,resource:{buffer:this.lightGlazeUniformBuffer}},{binding:4,resource:{buffer:this.thicknessTailUniformBuffer}}]}rebuildSourceBindGroups(e){this.seedBindGroups.set(e,this.device.createBindGroup({label:`Traccia seed source mode ${e}`,layout:this.seedBindGroupLayout,entries:[...this.commonSourceEntries(e),{binding:5,resource:{buffer:this.scratchBuffers[0]}}]}));for(let t of[0,1])this.resolveBindGroups.set(`${e}:${t}`,this.device.createBindGroup({label:`Traccia resolve source ${e}, scratch ${t}`,layout:this.resolveBindGroupLayout,entries:[...this.commonSourceEntries(e),{binding:5,resource:{buffer:this.scratchBuffers[t]}},{binding:6,resource:{buffer:this.coverageBuffer}}]}));this.composeBindGroups.set(e,this.device.createBindGroup({label:`Style stack logical mip 1 compose source mode ${e}`,layout:this.composeBindGroupLayout,entries:[...this.commonSourceEntries(e),{binding:5,resource:{buffer:this.coverageBuffer}},{binding:6,resource:this.coarseStyledStorageView},{binding:7,resource:this.bevelHeightView},{binding:8,resource:this.bevelGlossView},{binding:9,resource:{buffer:this.bevelUniformBuffer}}]})),this.readbackStyledStorageView&&this.readbackComposeBindGroups.set(e,this.device.createBindGroup({label:`Style stack golden logical mip 0 compose source mode ${e}`,layout:this.composeBindGroupLayout,entries:[...this.commonSourceEntries(e),{binding:5,resource:{buffer:this.coverageBuffer}},{binding:6,resource:this.readbackStyledStorageView},{binding:7,resource:this.bevelHeightView},{binding:8,resource:this.bevelGlossView},{binding:9,resource:{buffer:this.bevelUniformBuffer}}]})),this.thresholdMaskBindGroups.set(e,this.device.createBindGroup({label:`Traccia alpha-threshold mask source mode ${e}`,layout:this.thresholdMaskBindGroupLayout,entries:[...this.commonSourceEntries(e),{binding:5,resource:{buffer:this.thresholdMaskBuffer}},{binding:6,resource:{buffer:this.changeStateBuffer}},{binding:7,resource:{buffer:this.coverageBuffer}}]}))}buildJobs(e,t){let n=Math.ceil(t+2),r=Math.floor((this.scratchExtent-n*2)/Lt)*Lt;if(r<=0)throw Error(`Scratch Traccia ${this.scratchExtent}px insufficiente per width ${t}px.`);let i=[],a=e.x+e.width,o=e.y+e.height;for(let t=e.y;t<o;t+=r){let s=Math.min(r,o-t);for(let o=e.x;o<a;o+=r){let e=Math.min(r,a-o),c=Math.max(-1,o-n),l=Math.max(-1,t-n),u=Math.min(this.documentWidth+1,o+e+n),d=Math.min(this.documentHeight+1,t+s+n),f=u-c,p=d-l;if(f>this.scratchExtent||p>this.scratchExtent)throw Error(`Partizione scratch Traccia non valida: ${f}×${p} oltre ${this.scratchExtent}.`);i.push({buildOriginX:c,buildOriginY:l,buildWidth:f,buildHeight:p,targetX:o,targetY:t,targetWidth:e,targetHeight:s,localTargetX:o-c,localTargetY:t-l})}}return i}updateDisplayParameters(e,t,n=I){if(this.destroyed)throw Error(`Renderer Traccia già distrutto.`);let r=Ut(e);this.displayParameterUploadU32.fill(0),this.displayParameterUploadU32[11]=r,this.displayParameterUploadF32[12]=t.width,this.displayParameterUploadU32[13]=Wt(t.position),this.displayParameterUploadF32[16]=t.color[0],this.displayParameterUploadF32[17]=t.color[1],this.displayParameterUploadF32[18]=t.color[2],this.displayParameterUploadF32[19]=t.color[3],this.displayParameterUploadU32[15]=t.enabled&&t.width>0?1:0,this.updateBevelParameters(n),this.device.queue.writeBuffer(this.displayParameterBuffers[r],0,this.displayParameterUpload)}writeParameters(e,t,n,r,i){if(e>=Pt)throw Error(`Troppi dispatch Traccia in un frame: ${e+1}.`);let a=Nt/4*e;return this.parameterUploadI32[a]=t.buildOriginX??0,this.parameterUploadI32[a+1]=t.buildOriginY??0,this.parameterUploadU32[a+2]=t.buildWidth??0,this.parameterUploadU32[a+3]=t.buildHeight??0,this.parameterUploadU32[a+4]=t.targetX??0,this.parameterUploadU32[a+5]=t.targetY??0,this.parameterUploadU32[a+6]=t.targetWidth??0,this.parameterUploadU32[a+7]=t.targetHeight??0,this.parameterUploadU32[a+8]=t.localTargetX??0,this.parameterUploadU32[a+9]=t.localTargetY??0,this.parameterUploadU32[a+10]=n,this.parameterUploadU32[a+11]=r,this.parameterUploadF32[a+12]=i.width,this.parameterUploadU32[a+13]=Wt(i.position),this.parameterUploadU32[a+14]=this.scratchExtent,this.parameterUploadU32[a+15]=i.enabled&&i.width>0?1:0,this.parameterUploadF32[a+16]=i.color[0],this.parameterUploadF32[a+17]=i.color[1],this.parameterUploadF32[a+18]=i.color[2],this.parameterUploadF32[a+19]=i.color[3],e+1}dynamicOffset(e){return[e*Nt]}writeIndirectArgument(e,t,n,r=1){if(e>=Pt)throw Error(`Troppi argomenti indirect Traccia in un frame: ${e+1}.`);let i=e*zt;return this.indirectTemplateUpload[i]=t,this.indirectTemplateUpload[i+1]=n,this.indirectTemplateUpload[i+2]=r,e+1}encode(e){if(this.destroyed)throw Error(`Renderer Traccia già distrutto.`);let t=Kt(e.rebuildRect,this.documentWidth,this.documentHeight),n=qt(e.changeDetectionRect,this.documentWidth,this.documentHeight),r=Gt(e.composeRect,this.documentWidth,this.documentHeight),i=Gt(e.conditionalComposeRect,this.documentWidth,this.documentHeight),a=Ut(e.sourceMode);this.updateDisplayParameters(e.sourceMode,e.style,e.bevelStyle??I);let o=t?this.buildJobs(t,e.style.width):[],s=o.map(e=>Ye(Math.max(e.buildWidth,e.buildHeight),{plusOne:!0})),c=!!(o.length>0&&n&&!e.resetThresholdMask),l=o.length>0?c?n:t:null,u=c?i:null,d=[r,c?null:i].filter(e=>e!==null),f=Math.max(1,this.documentWidth>>1),p=Math.max(1,this.documentHeight>>1),m=d.map(e=>Jt(e,f,p)).filter(e=>e!==null),h=Jt(u,f,p),g=this.readbackEnabled?[r,i].filter(e=>e!==null):[],_=0,v=[];if(c)for(let e of o){let t=_;_=this.writeIndirectArgument(_,Math.ceil(e.buildWidth/z),Math.ceil(e.buildHeight/z));let n=_;_=this.writeIndirectArgument(_,Math.ceil(Math.ceil(e.targetWidth/Lt)/z),Math.ceil(e.targetHeight/z)),v.push({field:t,resolve:n})}let y=-1;h&&(y=_,_=this.writeIndirectArgument(_,Math.ceil(h.width/z),Math.ceil(h.height/z)));let b=s.reduce((e,t)=>e+t.length+2,0);if(b+=m.length,b+=+!!h,b+=g.length,b+=+!!l,b+=+!!c,b>Pt)throw Error(`La Traccia richiede ${b} dispatch, oltre il limite ${Pt}.`);let x=0,S=[];for(let t=0;t<o.length;t+=1){let n=o[t],r=x;x=this.writeParameters(x,n,0,a,e.style);let i=[];for(let r of s[t])i.push(x),x=this.writeParameters(x,n,r,a,e.style);let c=x;x=this.writeParameters(x,n,0,a,e.style),S.push({seed:r,jfa:i,resolve:c})}let C=-1;l&&(C=x,x=this.writeParameters(x,{targetX:l.x,targetY:l.y,targetWidth:l.width,targetHeight:l.height},0,a,e.style));let w=-1;c&&(w=x,x=this.writeParameters(x,{targetWidth:_,targetHeight:1},0,a,e.style));let T=m.map(t=>{let n=x;return x=this.writeParameters(x,{targetX:t.x,targetY:t.y,targetWidth:t.width,targetHeight:t.height},0,a,e.style),n}),E=-1;h&&(E=x,x=this.writeParameters(x,{targetX:h.x,targetY:h.y,targetWidth:h.width,targetHeight:h.height},0,a,e.style));let ee=g.map(t=>{let n=x;return x=this.writeParameters(x,{targetX:t.x,targetY:t.y,targetWidth:t.width,targetHeight:t.height},0,a,e.style),n});x>0&&this.device.queue.writeBuffer(this.parameterBuffer,0,this.parameterUpload,0,x*Nt),_>0&&this.device.queue.writeBuffer(this.indirectArgumentsBuffer,0,this.indirectTemplateUpload.buffer,0,_*Bt);let D=!!(e.resetThresholdMask||e.clearStyled||o.length>0&&!c);if(e.clearStyled&&e.encoder.clearBuffer(this.coverageBuffer),D&&e.encoder.clearBuffer(this.thresholdMaskBuffer),l){e.encoder.clearBuffer(this.changeStateBuffer);let t=l.x%It,n=Math.ceil((t+l.width)/It),r=e.encoder.beginComputePass({label:c?`Detect Traccia threshold changes or existing coverage overlap`:`Synchronize Traccia alpha-threshold mask`});r.setPipeline(this.thresholdMaskPipeline),r.setBindGroup(0,this.thresholdMaskBindGroups.get(a),this.dynamicOffset(C)),r.dispatchWorkgroups(Math.ceil(n/z),Math.ceil(l.height/z)),r.end()}if(c){let t=e.encoder.beginComputePass({label:`Gate Traccia field dispatches from threshold or coverage overlap`});t.setPipeline(this.indirectGatePipeline),t.setBindGroup(0,this.indirectGateBindGroup,this.dynamicOffset(w)),t.dispatchWorkgroups(Math.ceil(_/Vt)),t.end()}e.clearStyled&&(e.encoder.beginRenderPass({label:`Clear Traccia styled logical mip 1`,colorAttachments:[{view:this.mipViews[0],loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),this.readbackStyledStorageView&&e.encoder.beginRenderPass({label:`Clear Traccia golden logical mip 0`,colorAttachments:[{view:this.readbackStyledStorageView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end());let O=0;if(o.length>0){let t=e.encoder.beginComputePass({label:c?`Traccia gated seed + packed dual JFA + packed R8 coverage`:`Traccia seed + packed dual JFA + packed R8 coverage`});for(let e=0;e<o.length;e+=1){let n=o[e],r=S[e],i=v[e];t.setPipeline(this.seedPipeline),t.setBindGroup(0,this.seedBindGroups.get(a),this.dynamicOffset(r.seed)),c?t.dispatchWorkgroupsIndirect(this.indirectArgumentsBuffer,i.field*Bt):t.dispatchWorkgroups(Math.ceil(n.buildWidth/z),Math.ceil(n.buildHeight/z));let s=0;for(let e of r.jfa)t.setPipeline(this.jfaPipeline),t.setBindGroup(0,this.jfaBindGroups[s],this.dynamicOffset(e)),c?t.dispatchWorkgroupsIndirect(this.indirectArgumentsBuffer,i.field*Bt):t.dispatchWorkgroups(Math.ceil(n.buildWidth/z),Math.ceil(n.buildHeight/z)),s=+(s===0),O+=1;t.setPipeline(this.resolvePipeline),t.setBindGroup(0,this.resolveBindGroups.get(`${a}:${s}`),this.dynamicOffset(r.resolve)),c?t.dispatchWorkgroupsIndirect(this.indirectArgumentsBuffer,i.resolve*Bt):t.dispatchWorkgroups(Math.ceil(Math.ceil(n.targetWidth/Lt)/z),Math.ceil(n.targetHeight/z))}t.end()}let k=d.length+ +!!u;if(m.length+ +!!h>0){let t=e.encoder.beginComputePass({label:h?`Traccia logical mip 1 compose with gated coverage halo`:`Traccia logical mip 1 compose`});t.setPipeline(this.composePipeline);for(let e=0;e<m.length;e+=1){let n=m[e];t.setBindGroup(0,this.composeBindGroups.get(a),this.dynamicOffset(T[e])),t.dispatchWorkgroups(Math.ceil(n.width/z),Math.ceil(n.height/z))}h&&(t.setBindGroup(0,this.composeBindGroups.get(a),this.dynamicOffset(E)),t.dispatchWorkgroupsIndirect(this.indirectArgumentsBuffer,y*Bt)),t.end()}if(this.readbackComposePipeline&&g.length>0){let t=e.encoder.beginComputePass({label:`Traccia golden logical mip 0 compose`});t.setPipeline(this.readbackComposePipeline);for(let e=0;e<g.length;e+=1){let n=g[e];t.setBindGroup(0,this.readbackComposeBindGroups.get(a),this.dynamicOffset(ee[e])),t.dispatchWorkgroups(Math.ceil(n.width/z),Math.ceil(n.height/z))}t.end()}let A=c?o.reduce((e,t,n)=>e+s[n].length+2,0)+ +!!u:0;return{cleared:!!e.clearStyled,buildJobs:o.length,jfaDispatches:O,resolveDispatches:o.length,composeDispatches:k,buildPixels:o.reduce((e,t)=>e+t.buildWidth*t.buildHeight,0),resolvedPixels:o.reduce((e,t)=>e+t.targetWidth*t.targetHeight,0),composedPixels:d.reduce((e,t)=>e+t.width*t.height,u?u.width*u.height:0),thresholdDetectionDispatches:+!!l,thresholdDetectionPixels:l?l.width*l.height:0,indirectDispatches:A}}destroy(){this.destroyed||(this.destroyed=!0,this.scratchBuffers[0].destroy(),this.scratchBuffers[1].destroy(),this.parameterBuffer.destroy(),this.bevelUniformBuffer.destroy(),this.displayParameterBuffers[0].destroy(),this.displayParameterBuffers[1].destroy(),this.displayParameterBuffers[2].destroy(),this.coverageBuffer.destroy(),this.thresholdMaskBuffer.destroy(),this.changeStateBuffer.destroy(),this.indirectArgumentsBuffer.destroy(),this.coarseStyledTexture.destroy(),this.readbackStyledTexture?.destroy(),this.dummyTexture.destroy(),this.dummyBevelTexture.destroy(),this.seedBindGroups.clear(),this.resolveBindGroups.clear(),this.composeBindGroups.clear(),this.readbackComposeBindGroups.clear(),this.thresholdMaskBindGroups.clear())}},cn=`raster-bevel-webgpu-v2-heightfield-v2-r32f-segment-jfa-workgroup-gaussian-gpu-gate`,ln=`persistent-document-plus-one-pixel-apron-r32float-heightfield`,un=`subpixel-marching-squares-segment-jfa-r32float`,dn=`lazy-roi-split-common-segment-arenas-workgroup-gaussian-gpu-gated-grow-only`,B=8,fn=128,pn=256,mn=6144,hn=256,gn=384,_n=64,vn=832,yn=-1e8,bn=32,xn=3,Sn=xn*4;function Cn(e,t,n){return Math.max(t,Math.min(n,e))}function wn(e,t){return Math.ceil(e/t)*t}function Tn(e){return e===`light-glaze`?1:e===`thickness-tail`?2:0}function En(e,t,n){if(!e)return null;let r=Cn(Math.floor(e.x),0,t),i=Cn(Math.floor(e.y),0,n),a=Cn(Math.ceil(e.x+e.width),0,t),o=Cn(Math.ceil(e.y+e.height),0,n);return a>r&&o>i?{x:r,y:i,width:a-r,height:o-i}:null}function Dn(e,t){let n=e*e,r=e=>wn(e*4,hn)/4,i=0,a=i;i+=r(Math.ceil(n/4));let o=i;i+=r(n);let s=i;i+=r(n);let c=0,l=c;t&&(c+=r(n*4));let u=c;t&&(c+=r(n*4));let d=i*4,f=Math.max(hn,c*4);return{extent:e,segments:t,coverageOffsetWords:a,scalarAOffsetWords:o,scalarBOffsetWords:s,segmentAOffsetWords:l,segmentBOffsetWords:u,commonBytes:d,segmentBytes:f,totalBytes:d+f}}function On(e,t){return`
struct BevelParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  scratchExtent: u32,
  step: u32,
  sourceMode: u32,
  mode: u32,
  technique: u32,
  radius: u32,
  sigma: f32,
  size: f32,
  bevelRange: f32,
  useContour: u32,
  inputOffsetWords: u32,
  outputOffsetWords: u32,
  direction: vec2<i32>,
  sourceOffset: vec2<i32>,
  farDistance: f32,
  inputKind: u32,
  destinationOffset: vec2<i32>,
  _pad0: vec2<u32>,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  _pad0: u32,
  _pad1: vec2<u32>,
};

const DOCUMENT_SIZE = vec2<i32>(${e}, ${t});
const EMPTY_SEGMENT = ${yn};
const PROFILE_MAX_INDEX = ${Xe-1}u;

@group(0) @binding(0) var<uniform> parameters: BevelParameters;
@group(0) @binding(1) var permanentTexture: texture_2d<f32>;
@group(0) @binding(2) var transientTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;
@group(0) @binding(5) var<storage, read_write> arena: array<u32>;
@group(0) @binding(9) var<storage, read_write> alphaClassMask: array<u32>;
@group(0) @binding(10) var<storage, read_write> bevelGateState: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> segmentArena: array<u32>;
@group(0) @binding(6) var heightOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var bevelProfile: texture_2d<f32>;

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < DOCUMENT_SIZE);
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return round(clamp(value, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0) / 255.0;
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
}

fn resolvedLightGlaze(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(accumulatedStroke.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn sourceTexel(position: vec2<i32>) -> vec4<f32> {
  if (!insideDocument(position)) {
    return vec4<f32>(0.0);
  }
  let permanentPaint = textureLoad(permanentTexture, position, 0);
  if (parameters.sourceMode == 1u) {
    let strokePaint = resolvedLightGlaze(textureLoad(transientTexture, position, 0));
    return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
  }
  if (parameters.sourceMode == 2u) {
    let tailOrigin = vec2<i32>(thicknessTail.origin);
    let tailPosition = position - tailOrigin;
    let tailSize = vec2<i32>(thicknessTail.textureSize);
    if (all(tailPosition >= vec2<i32>(0)) && all(tailPosition < tailSize)) {
      let transientPaint = textureLoad(transientTexture, tailPosition, 0);
      if (thicknessTail.compositionMode == 1u) {
        return vec4<f32>(
          permanentPaint.rgb + transientPaint.rgb,
          transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
        );
      }
      return transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }
  return permanentPaint;
}

fn linearIndex(position: vec2<u32>) -> u32 {
  return position.y * parameters.scratchExtent + position.x;
}

fn loadFloat(offsetWords: u32, position: vec2<u32>) -> f32 {
  return bitcast<f32>(arena[offsetWords + linearIndex(position)]);
}

fn storeFloat(offsetWords: u32, position: vec2<u32>, value: f32) {
  arena[offsetWords + linearIndex(position)] = bitcast<u32>(value);
}

fn loadCoverage(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  let index = u32(clamped.y) * parameters.scratchExtent + u32(clamped.x);
  let packed = arena[index >> 2u];
  let shift = (index & 3u) * 8u;
  return f32((packed >> shift) & 255u) / 255.0;
}

fn loadSegment(offsetWords: u32, position: vec2<u32>) -> vec4<f32> {
  let index = offsetWords + linearIndex(position) * 4u;
  return vec4<f32>(
    bitcast<f32>(segmentArena[index]),
    bitcast<f32>(segmentArena[index + 1u]),
    bitcast<f32>(segmentArena[index + 2u]),
    bitcast<f32>(segmentArena[index + 3u])
  );
}

fn storeSegment(offsetWords: u32, position: vec2<u32>, value: vec4<f32>) {
  let index = offsetWords + linearIndex(position) * 4u;
  segmentArena[index] = bitcast<u32>(value.x);
  segmentArena[index + 1u] = bitcast<u32>(value.y);
  segmentArena[index + 2u] = bitcast<u32>(value.z);
  segmentArena[index + 3u] = bitcast<u32>(value.w);
}

fn profileValue(value: f32) -> f32 {
  let q = clamp(value, 0.0, 1.0) * f32(PROFILE_MAX_INDEX);
  let first = u32(floor(q));
  let second = min(PROFILE_MAX_INDEX, first + 1u);
  return mix(
    textureLoad(bevelProfile, vec2<i32>(i32(first), 0), 0).r,
    textureLoad(bevelProfile, vec2<i32>(i32(second), 0), 0).r,
    fract(q)
  );
}
`}function kn(e,t){return`${On(e,t)}
@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.buildSize.y) {
    return;
  }
  let firstX = globalId.x * 4u;
  if (firstX >= parameters.buildSize.x) {
    return;
  }
  var packed = 0u;
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let x = firstX + lane;
    if (x >= parameters.buildSize.x) {
      continue;
    }
    let documentPosition = parameters.buildOrigin + vec2<i32>(i32(x), i32(globalId.y));
    let alpha = clamp(sourceTexel(documentPosition).a, 0.0, 1.0);
    let byte = u32(round(alpha * 255.0));
    packed |= byte << (lane * 8u);
  }
  let index = globalId.y * parameters.scratchExtent + firstX;
  arena[parameters.outputOffsetWords + (index >> 2u)] = packed;
}
`}function An(e,t){return`${On(e,t)}
fn differentSides(left: f32, right: f32) -> bool {
  return (left >= 0.5) != (right >= 0.5);
}

@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let c = vec2<i32>(globalId.xy);
  let a00 = loadCoverage(c);
  let a10 = loadCoverage(c + vec2<i32>(1, 0));
  let a01 = loadCoverage(c + vec2<i32>(0, 1));
  let a11 = loadCoverage(c + vec2<i32>(1, 1));
  let mask = select(0u, 1u, a00 >= 0.5)
    | select(0u, 2u, a10 >= 0.5)
    | select(0u, 4u, a11 >= 0.5)
    | select(0u, 8u, a01 >= 0.5);
  if (mask == 0u || mask == 15u) {
    storeSegment(parameters.outputOffsetWords, globalId.xy, vec4<f32>(EMPTY_SEGMENT));
    return;
  }
  let base = vec2<f32>(c) + vec2<f32>(0.5);
  var points: array<vec2<f32>, 4>;
  var count = 0u;
  if (differentSides(a00, a10)) {
    points[count] = base + vec2<f32>((0.5 - a00) / (a10 - a00), 0.0);
    count += 1u;
  }
  if (differentSides(a10, a11)) {
    points[count] = base + vec2<f32>(1.0, (0.5 - a10) / (a11 - a10));
    count += 1u;
  }
  if (differentSides(a01, a11)) {
    points[count] = base + vec2<f32>((0.5 - a01) / (a11 - a01), 1.0);
    count += 1u;
  }
  if (differentSides(a00, a01)) {
    points[count] = base + vec2<f32>(0.0, (0.5 - a00) / (a01 - a00));
    count += 1u;
  }
  if (count == 2u) {
    storeSegment(
      parameters.outputOffsetWords,
      globalId.xy,
      vec4<f32>(points[0], points[1])
    );
    return;
  }
  let centerInside = 0.25 * (a00 + a10 + a01 + a11) >= 0.5;
  let chooseMiddle = centerInside == (a00 >= 0.5);
  let result = select(
    vec4<f32>(points[0], points[1]),
    vec4<f32>(points[1], points[2]),
    chooseMiddle
  );
  storeSegment(parameters.outputOffsetWords, globalId.xy, result);
}
`}function jn(e,t){return`${On(e,t)}
fn segmentDistance(point: vec2<f32>, segment: vec4<f32>) -> f32 {
  let ab = segment.zw - segment.xy;
  let t = clamp(
    dot(point - segment.xy, ab) / max(dot(ab, ab), 1.0e-9),
    0.0,
    1.0
  );
  return length(point - (segment.xy + t * ab));
}

fn orderedBefore(left: vec4<f32>, right: vec4<f32>) -> bool {
  return left.x < right.x
    || (left.x == right.x
      && (left.y < right.y
        || (left.y == right.y
          && (left.z < right.z
            || (left.z == right.z && left.w < right.w)))));
}

@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let signedPosition = vec2<i32>(globalId.xy);
  let point = vec2<f32>(globalId.xy) + vec2<f32>(0.5);
  var best = loadSegment(parameters.inputOffsetWords, globalId.xy);
  var bestDistance = select(1.0e30, segmentDistance(point, best), best.x >= -1.0e7);
  let step = i32(parameters.step);
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX == 0 && offsetY == 0) {
        continue;
      }
      let samplePosition = clamp(
        signedPosition + vec2<i32>(offsetX, offsetY) * step,
        vec2<i32>(0),
        vec2<i32>(parameters.buildSize) - vec2<i32>(1)
      );
      let candidate = loadSegment(
        parameters.inputOffsetWords,
        vec2<u32>(samplePosition)
      );
      if (candidate.x < -1.0e7) {
        continue;
      }
      let distance = segmentDistance(point, candidate);
      if (
        distance < bestDistance - 1.0e-6
        || (abs(distance - bestDistance) <= 1.0e-6 && orderedBefore(candidate, best))
      ) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  storeSegment(parameters.outputOffsetWords, globalId.xy, best);
}
`}function Mn(e,t){return`${On(e,t)}
fn segmentDistance(point: vec2<f32>, segment: vec4<f32>) -> f32 {
  let ab = segment.zw - segment.xy;
  let t = clamp(
    dot(point - segment.xy, ab) / max(dot(ab, ab), 1.0e-9),
    0.0,
    1.0
  );
  return length(point - (segment.xy + t * ab));
}

@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let segment = loadSegment(parameters.inputOffsetWords, globalId.xy);
  let signValue = select(
    -1.0,
    1.0,
    loadCoverage(vec2<i32>(globalId.xy)) >= 0.5
  );
  let distance = select(
    parameters.farDistance,
    segmentDistance(vec2<f32>(globalId.xy) + vec2<f32>(0.5), segment),
    segment.x >= -1.0e7
  );
  storeFloat(parameters.outputOffsetWords, globalId.xy, signValue * distance);
}
`}function Nn(e,t){return`${On(e,t)}
fn sampleInput(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  if (parameters.inputKind == 1u) {
    return loadCoverage(clamped);
  }
  return loadFloat(parameters.inputOffsetWords, vec2<u32>(clamped));
}

var<workgroup> gaussianCache: array<f32, ${vn}>;

fn outputPosition(groupId: vec3<u32>, lane: u32) -> vec2<u32> {
  if (parameters.direction.x != 0) {
    return vec2<u32>(
      groupId.x * ${_n}u + lane,
      groupId.y
    );
  }
  return vec2<u32>(
    groupId.y,
    groupId.x * ${_n}u + lane
  );
}

fn cacheSourcePosition(groupId: vec3<u32>, cacheIndex: u32) -> vec2<i32> {
  let along = i32(groupId.x * ${_n}u + cacheIndex)
    - ${gn};
  if (parameters.direction.x != 0) {
    return vec2<i32>(along, i32(groupId.y)) + parameters.sourceOffset;
  }
  return vec2<i32>(i32(groupId.y), along) + parameters.sourceOffset;
}

@compute @workgroup_size(${_n})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${vn}u;
    cacheIndex += ${_n}u
  ) {
    gaussianCache[cacheIndex] = sampleInput(cacheSourcePosition(groupId, cacheIndex));
  }
  workgroupBarrier();
  let output = outputPosition(groupId, localId.x);
  if (any(output >= parameters.targetSize)) {
    return;
  }
  let center = ${gn}u + localId.x;
  var value = gaussianCache[center];
  if (parameters.sigma >= 0.3) {
    let inverse = 0.5 / (parameters.sigma * parameters.sigma);
    var sum = value;
    var weightSum = 1.0;
    for (var index = 1u; index <= ${gn}u; index += 1u) {
      if (index > parameters.radius) {
        break;
      }
      let weight = exp(-f32(index * index) * inverse);
      sum += weight * gaussianCache[center + index];
      sum += weight * gaussianCache[center - index];
      weightSum += 2.0 * weight;
    }
    value = sum / weightSum;
  }
  storeFloat(parameters.outputOffsetWords, output, value);
}
`}function Pn(e,t){return`${On(e,t)}
@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let source = loadFloat(parameters.inputOffsetWords, globalId.xy);
  var x = 0.0;
  if (parameters.technique == 0u) {
    if (parameters.mode == 0u) {
      x = clamp(2.0 * source - 1.0, 0.0, 1.0);
    } else if (parameters.mode == 1u) {
      x = clamp(2.0 * source, 0.0, 1.0);
    } else if (parameters.mode == 2u) {
      x = clamp(source, 0.0, 1.0);
    } else {
      x = abs(2.0 * source - 1.0);
    }
  } else {
    let size = max(parameters.size, 1.0e-3);
    if (parameters.mode == 0u) {
      x = clamp(source / size, 0.0, 1.0);
    } else if (parameters.mode == 1u) {
      x = clamp(1.0 + source / size, 0.0, 1.0);
    } else if (parameters.mode == 2u) {
      x = clamp(0.5 + source / (2.0 * size), 0.0, 1.0);
    } else {
      x = clamp(abs(source) / size, 0.0, 1.0);
    }
  }
  if (parameters.useContour == 1u) {
    x = profileValue(min(x / max(parameters.bevelRange, 1.0e-3), 1.0));
  }
  storeFloat(parameters.outputOffsetWords, globalId.xy, x);
}
`}function Fn(e,t){return`${On(e,t)}
fn sampleInput(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  return loadFloat(parameters.inputOffsetWords, vec2<u32>(clamped));
}

var<workgroup> gaussianCache: array<f32, ${vn}>;

fn outputPosition(groupId: vec3<u32>, lane: u32) -> vec2<u32> {
  if (parameters.direction.x != 0) {
    return vec2<u32>(
      groupId.x * ${_n}u + lane,
      groupId.y
    );
  }
  return vec2<u32>(
    groupId.y,
    groupId.x * ${_n}u + lane
  );
}

fn cacheSourcePosition(groupId: vec3<u32>, cacheIndex: u32) -> vec2<i32> {
  let along = i32(groupId.x * ${_n}u + cacheIndex)
    - ${gn};
  if (parameters.direction.x != 0) {
    return vec2<i32>(along, i32(groupId.y)) + parameters.sourceOffset;
  }
  return vec2<i32>(i32(groupId.y), along) + parameters.sourceOffset;
}

@compute @workgroup_size(${_n})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${vn}u;
    cacheIndex += ${_n}u
  ) {
    gaussianCache[cacheIndex] = sampleInput(cacheSourcePosition(groupId, cacheIndex));
  }
  workgroupBarrier();
  let output = outputPosition(groupId, localId.x);
  if (any(output >= parameters.targetSize)) {
    return;
  }
  let center = ${gn}u + localId.x;
  var value = gaussianCache[center];
  if (parameters.sigma >= 0.3) {
    let inverse = 0.5 / (parameters.sigma * parameters.sigma);
    var sum = value;
    var weightSum = 1.0;
    for (var index = 1u; index <= ${gn}u; index += 1u) {
      if (index > parameters.radius) {
        break;
      }
      let weight = exp(-f32(index * index) * inverse);
      sum += weight * gaussianCache[center + index];
      sum += weight * gaussianCache[center - index];
      weightSum += 2.0 * weight;
    }
    value = sum / weightSum;
  }
  let documentPosition = vec2<i32>(parameters.targetOrigin)
    + vec2<i32>(output)
    + parameters.destinationOffset
    + vec2<i32>(1);
  textureStore(heightOutput, vec2<i32>(documentPosition), vec4<f32>(value, 0.0, 0.0, 0.0));
}
`}function In(e,t){let n=Math.ceil(e/bn),r=n*t;return`${On(e,t)}
const ALPHA_WORD_BITS = ${bn}u;
const ALPHA_WORDS_PER_ROW = ${n}u;
const ALPHA_WORD_COUNT = ${r}u;

@compute @workgroup_size(${B}, ${B})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let firstWord = parameters.targetOrigin.x / ALPHA_WORD_BITS;
  let firstBit = parameters.targetOrigin.x % ALPHA_WORD_BITS;
  let targetWordCount = (
    firstBit + parameters.targetSize.x + ALPHA_WORD_BITS - 1u
  ) / ALPHA_WORD_BITS;
  if (globalId.x >= targetWordCount || globalId.y >= parameters.targetSize.y) {
    return;
  }
  let wordX = firstWord + globalId.x;
  let documentY = parameters.targetOrigin.y + globalId.y;
  let wordOriginX = wordX * ALPHA_WORD_BITS;
  let targetRight = parameters.targetOrigin.x + parameters.targetSize.x;
  var writeMask = 0u;
  var thresholdBits = 0u;
  var fractionalBits = 0u;
  for (var lane = 0u; lane < ALPHA_WORD_BITS; lane += 1u) {
    let documentX = wordOriginX + lane;
    if (
      documentX < parameters.targetOrigin.x
      || documentX >= targetRight
      || documentX >= ${e}u
    ) {
      continue;
    }
    let bit = 1u << lane;
    writeMask |= bit;
    let alpha = clamp(
      sourceTexel(vec2<i32>(i32(documentX), i32(documentY))).a,
      0.0,
      1.0
    );
    let alphaByte = u32(round(alpha * 255.0));
    if (alphaByte >= 128u) {
      thresholdBits |= bit;
    }
    if (alphaByte > 0u && alphaByte < 255u) {
      fractionalBits |= bit;
    }
  }
  let maskIndex = documentY * ALPHA_WORDS_PER_ROW + wordX;
  let previousThreshold = alphaClassMask[maskIndex];
  let previousFractional = alphaClassMask[ALPHA_WORD_COUNT + maskIndex];
  let nextThreshold = (previousThreshold & ~writeMask) | (thresholdBits & writeMask);
  let nextFractional = (previousFractional & ~writeMask) | (fractionalBits & writeMask);
  if (
    nextThreshold != previousThreshold
    || nextFractional != previousFractional
    || (fractionalBits & writeMask) != 0u
  ) {
    atomicOr(&bevelGateState[0], 1u);
  }
  alphaClassMask[maskIndex] = nextThreshold;
  alphaClassMask[ALPHA_WORD_COUNT + maskIndex] = nextFractional;
}
`}function Ln(){return`
@group(0) @binding(0) var<storage, read_write> gateState: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> indirectArguments: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (atomicLoad(&gateState[0]) != 0u) {
    return;
  }
  let word = globalId.x * ${xn}u;
  if (word + 2u >= arrayLength(&indirectArguments)) {
    return;
  }
  indirectArguments[word] = 0u;
  indirectArguments[word + 1u] = 0u;
  indirectArguments[word + 2u] = 0u;
}
`}async function Rn(e){let t=[];for(let n of e){let e=await n.module.getCompilationInfo();for(let r of e.messages)r.type===`error`&&t.push(`${n.label}:${r.lineNum}:${r.linePos} ${r.message}`)}if(t.length>0)throw Error(`WGSL Smusso non valido:\n${t.join(`
`)}`)}var zn=class e{static async create(t){let n=new e(t);try{return await n.initialize(),n}catch(e){throw n.destroy(),e}}build=cn;heightView;glossView;heightMemoryBytes;lutMemoryBytes=Xe*4*2;controlMemoryBytes;device;documentWidth;documentHeight;layerView;lightGlazeUniformBuffer;thicknessTailUniformBuffer;heightTexture;profileTexture;profileView;glossTexture;parameterBuffer;parameterUpload=new ArrayBuffer(mn*pn);parameterUploadI32=new Int32Array(this.parameterUpload);parameterUploadU32=new Uint32Array(this.parameterUpload);parameterUploadF32=new Float32Array(this.parameterUpload);workspaceBuffer=null;segmentWorkspaceBuffer=null;alphaClassMaskBuffer;gateStateBuffer;indirectArgumentsBuffer;indirectTemplateUpload=new Uint32Array(mn*xn);workspace=null;bindGroupLayout;bindGroups=new Map;coveragePipeline;segmentPipeline;jfaPipeline;distancePipeline;gaussianPipeline;heightPipeline;resolveHeightPipeline;sourceViews;indirectGateBindGroupLayout;indirectGateBindGroup;profileKey=``;glossKey=``;destroyed=!1;_workspaceMemoryBytes=0;_workspaceExtent=0;alphaClassMaskPipeline;indirectGatePipeline;_totalBuilds=0;_totalJobs=0;_totalPasses=0;_lastEncode=null;constructor(e){this.device=e.device,this.documentWidth=e.documentWidth,this.documentHeight=e.documentHeight,this.layerView=e.layerView,this.lightGlazeUniformBuffer=e.lightGlazeUniformBuffer,this.thicknessTailUniformBuffer=e.thicknessTailUniformBuffer,this.heightMemoryBytes=(this.documentWidth+2)*(this.documentHeight+2)*4;let t=Math.ceil(this.documentWidth/bn)*this.documentHeight*2*4,n=mn*Sn;this.controlMemoryBytes=mn*pn+t+4+n,this.heightTexture=this.device.createTexture({label:`Smusso Heightfield V2 persistent R32F`,size:{width:this.documentWidth+2,height:this.documentHeight+2,depthOrArrayLayers:1},format:`r32float`,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),this.heightView=this.heightTexture.createView({label:`Smusso Heightfield V2 sampling/storage view`}),this.profileTexture=this.device.createTexture({label:`Smusso height contour LUT R32F`,size:{width:Xe,height:1,depthOrArrayLayers:1},format:`r32float`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.profileView=this.profileTexture.createView(),this.glossTexture=this.device.createTexture({label:`Smusso light contour LUT R32F`,size:{width:Xe,height:1,depthOrArrayLayers:1},format:`r32float`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.glossView=this.glossTexture.createView({label:`Smusso light contour LUT view`}),this.parameterBuffer=this.device.createBuffer({label:`Smusso dynamic dispatch parameters`,size:mn*pn,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.alphaClassMaskBuffer=this.device.createBuffer({label:`Smusso alpha threshold/fractional class mask`,size:t,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.gateStateBuffer=this.device.createBuffer({label:`Smusso GPU rebuild gate state`,size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.indirectArgumentsBuffer=this.device.createBuffer({label:`Smusso GPU indirect dispatch arguments`,size:n,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST}),this.sourceViews={0:this.layerView,1:this.layerView,2:this.layerView}}get workspaceMemoryBytes(){return this._workspaceMemoryBytes}get workspaceExtent(){return this._workspaceExtent}get totalBuilds(){return this._totalBuilds}get totalJobs(){return this._totalJobs}get totalPasses(){return this._totalPasses}get lastEncode(){return this._lastEncode?{...this._lastEncode}:null}setLightGlazeView(e){this.sourceViews[1]=e??this.layerView,this.rebuildBindGroups()}setThicknessTailView(e){this.sourceViews[2]=e??this.layerView,this.rebuildBindGroups()}updateStyleResources(e){let t=lt(e),n=`${+!!t.bevelContourEnabled}|${t.bevelContour}`;if(n!==this.profileKey){let e=Ct(t.bevelContour,Xe);this.device.queue.writeTexture({texture:this.profileTexture},e,{bytesPerRow:Xe*4,rowsPerImage:1},{width:Xe,height:1,depthOrArrayLayers:1}),this.profileKey=n}if(t.gloss!==this.glossKey){let e=Ct(t.gloss,Xe);this.device.queue.writeTexture({texture:this.glossTexture},e,{bytesPerRow:Xe*4,rowsPerImage:1},{width:Xe,height:1,depthOrArrayLayers:1}),this.glossKey=t.gloss}}async initialize(){this.bindGroupLayout=this.device.createBindGroupLayout({label:`Smusso Heightfield V2 universal compute layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`,hasDynamicOffset:!0,minBindingSize:fn}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:6,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:`r32float`}},{binding:7,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:`unfilterable-float`}},{binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:10,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]}),this.indirectGateBindGroupLayout=this.device.createBindGroupLayout({label:`Smusso indirect dispatch gate layout`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]});let e={coverage:this.device.createShaderModule({label:`Smusso coverage R8 packed WGSL`,code:kn(this.documentWidth,this.documentHeight)}),segment:this.device.createShaderModule({label:`Smusso marching squares segments WGSL`,code:An(this.documentWidth,this.documentHeight)}),jfa:this.device.createShaderModule({label:`Smusso subpixel segment JFA WGSL`,code:jn(this.documentWidth,this.documentHeight)}),distance:this.device.createShaderModule({label:`Smusso signed R32F distance WGSL`,code:Mn(this.documentWidth,this.documentHeight)}),gaussian:this.device.createShaderModule({label:`Smusso separable Gaussian WGSL`,code:Nn(this.documentWidth,this.documentHeight)}),height:this.device.createShaderModule({label:`Smusso Heightfield V2 profile WGSL`,code:Pn(this.documentWidth,this.documentHeight)}),resolve:this.device.createShaderModule({label:`Smusso final R32F height resolve WGSL`,code:Fn(this.documentWidth,this.documentHeight)}),alphaClass:this.device.createShaderModule({label:`Smusso alpha class change gate WGSL`,code:In(this.documentWidth,this.documentHeight)}),indirectGate:this.device.createShaderModule({label:`Smusso indirect dispatch gate WGSL`,code:Ln()})};await Rn(Object.entries(e).map(([e,t])=>({label:e,module:t})));let t=this.device.createPipelineLayout({label:`Smusso Heightfield V2 compute pipeline layout`,bindGroupLayouts:[this.bindGroupLayout]});this.device.pushErrorScope(`validation`),this.coveragePipeline=this.device.createComputePipeline({label:`Smusso alpha to packed R8`,layout:t,compute:{module:e.coverage,entryPoint:`main`}}),this.segmentPipeline=this.device.createComputePipeline({label:`Smusso marching squares subpixel`,layout:t,compute:{module:e.segment,entryPoint:`main`}}),this.jfaPipeline=this.device.createComputePipeline({label:`Smusso JFA on subpixel segments`,layout:t,compute:{module:e.jfa,entryPoint:`main`}}),this.distancePipeline=this.device.createComputePipeline({label:`Smusso signed R32F distance`,layout:t,compute:{module:e.distance,entryPoint:`main`}}),this.gaussianPipeline=this.device.createComputePipeline({label:`Smusso separable Gaussian`,layout:t,compute:{module:e.gaussian,entryPoint:`main`}}),this.heightPipeline=this.device.createComputePipeline({label:`Smusso Heightfield V2 profile`,layout:t,compute:{module:e.height,entryPoint:`main`}}),this.resolveHeightPipeline=this.device.createComputePipeline({label:`Smusso final R32F height resolve`,layout:t,compute:{module:e.resolve,entryPoint:`main`}}),this.alphaClassMaskPipeline=this.device.createComputePipeline({label:`Smusso alpha threshold/fractional class gate`,layout:t,compute:{module:e.alphaClass,entryPoint:`main`}}),this.indirectGatePipeline=this.device.createComputePipeline({label:`Smusso indirect dispatch gate`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.indirectGateBindGroupLayout]}),compute:{module:e.indirectGate,entryPoint:`main`}});let n=await this.device.popErrorScope();if(n)throw Error(n.message);this.indirectGateBindGroup=this.device.createBindGroup({label:`Smusso indirect dispatch gate bind group`,layout:this.indirectGateBindGroupLayout,entries:[{binding:0,resource:{buffer:this.gateStateBuffer}},{binding:1,resource:{buffer:this.indirectArgumentsBuffer}}]}),this.updateStyleResources({})}rebuildBindGroups(){if(!(!this.workspaceBuffer||!this.bindGroupLayout)){this.bindGroups.clear();for(let e of[0,1,2])this.bindGroups.set(e,this.device.createBindGroup({label:`Smusso Heightfield source mode ${e}`,layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:this.parameterBuffer,offset:0,size:fn}},{binding:1,resource:this.layerView},{binding:2,resource:this.sourceViews[e]},{binding:3,resource:{buffer:this.lightGlazeUniformBuffer}},{binding:4,resource:{buffer:this.thicknessTailUniformBuffer}},{binding:5,resource:{buffer:this.workspaceBuffer}},{binding:8,resource:{buffer:this.segmentWorkspaceBuffer??this.workspaceBuffer}},{binding:6,resource:this.heightView},{binding:7,resource:this.profileView},{binding:9,resource:{buffer:this.alphaClassMaskBuffer}},{binding:10,resource:{buffer:this.gateStateBuffer}}]}))}}ensureWorkspace(e,t){let n=Math.min(Ze,wn(Math.max(B,e),B)),r=Math.max(this.workspace?.extent??0,n),i=!!(this.workspace?.segments||t);if(this.workspace&&this.workspaceBuffer&&this.workspace.extent===r&&this.workspace.segments===i)return this.workspace;let a=Dn(r,i),o=Number(this.device.limits.maxBufferSize),s=Number(this.device.limits.maxStorageBufferBindingSize);for(let[e,t]of[[`comune`,a.commonBytes],[`segmenti`,a.segmentBytes]]){if(t>o)throw Error(`Scratch Smusso ${e} ${r}² oltre maxBufferSize.`);if(t>s)throw Error(`Scratch Smusso ${e} ${r}² oltre maxStorageBufferBindingSize.`)}let c=this.device.createBuffer({label:`Smusso lazy ROI arena comune ${r}²`,size:a.commonBytes,usage:GPUBufferUsage.STORAGE}),l=null;try{a.segmentBytes>0&&(l=this.device.createBuffer({label:`Smusso lazy ROI arena segmenti RGBA32F ${r}²`,size:a.segmentBytes,usage:GPUBufferUsage.STORAGE}))}catch(e){throw c.destroy(),e}let u=this.workspaceBuffer,d=this.segmentWorkspaceBuffer;return this.workspaceBuffer=c,this.segmentWorkspaceBuffer=l,this.workspace=a,this._workspaceMemoryBytes=a.totalBytes,this._workspaceExtent=r,this.rebuildBindGroups(),u?.destroy(),d?.destroy(),a}buildJobs(e,t){let n=Math.floor(e.x/256),r=Math.floor(e.y/256),i=Math.ceil((e.x+e.width)/256),a=Math.ceil((e.y+e.height)/256),o=[];for(let e=r;e<a;e+=1)for(let r=n;r<i;r+=1){let n=r*256,i=e*256,a=Math.min(256,this.documentWidth-n),s=Math.min(256,this.documentHeight-i);if(a<=0||s<=0)continue;let c=Math.max(a,s)+t*2;if(c>1408)throw Error(`ROI Smusso ${c} oltre il limite ${Ze}.`);o.push({buildOriginX:n-t,buildOriginY:i-t,buildSide:c,targetX:n,targetY:i,targetWidth:a,targetHeight:s,borderLeft:+(n===0),borderTop:+(i===0),borderRight:+(n+a===this.documentWidth),borderBottom:+(i+s===this.documentHeight),localTargetX:t,localTargetY:t})}return o}writeParameters(e,t,n,r,i={}){if(e>=mn)throw Error(`Troppi dispatch Smusso in un aggiornamento: ${e+1}.`);let a=pn/4*e,o=n.mode===`inner`?0:n.mode===`outer`?1:n.mode===`emboss`?2:3,s=n.technique===`smooth`?0:n.technique===`chiselHard`?1:2;return this.parameterUploadI32[a]=t.buildOriginX,this.parameterUploadI32[a+1]=t.buildOriginY,this.parameterUploadU32[a+2]=t.buildSide,this.parameterUploadU32[a+3]=t.buildSide,this.parameterUploadU32[a+4]=t.targetX,this.parameterUploadU32[a+5]=t.targetY,this.parameterUploadU32[a+6]=i.targetWidth??(i.targetFullBuild?t.buildSide:t.targetWidth),this.parameterUploadU32[a+7]=i.targetHeight??(i.targetFullBuild?t.buildSide:t.targetHeight),this.parameterUploadU32[a+8]=t.localTargetX,this.parameterUploadU32[a+9]=t.localTargetY,this.parameterUploadU32[a+10]=this.workspace.extent,this.parameterUploadU32[a+11]=i.step??0,this.parameterUploadU32[a+12]=r,this.parameterUploadU32[a+13]=o,this.parameterUploadU32[a+14]=s,this.parameterUploadU32[a+15]=i.radius??0,this.parameterUploadF32[a+16]=i.sigma??0,this.parameterUploadF32[a+17]=n.size,this.parameterUploadF32[a+18]=n.bevelRange/100,this.parameterUploadU32[a+19]=+!!n.bevelContourEnabled,this.parameterUploadU32[a+20]=i.inputOffsetWords??0,this.parameterUploadU32[a+21]=i.outputOffsetWords??0,this.parameterUploadI32[a+22]=i.directionX??0,this.parameterUploadI32[a+23]=i.directionY??0,this.parameterUploadI32[a+24]=i.sourceOffsetX??0,this.parameterUploadI32[a+25]=i.sourceOffsetY??0,this.parameterUploadF32[a+26]=dt(n).apron+2,this.parameterUploadU32[a+27]=i.inputKind??0,this.parameterUploadI32[a+28]=i.destinationOffsetX??0,this.parameterUploadI32[a+29]=i.destinationOffsetY??0,e+1}dynamicOffset(e){return[e*pn]}writeIndirectArgument(e,t,n,r=1){if(e>=mn)throw Error(`Troppi argomenti indirect Smusso in un aggiornamento: ${e+1}.`);let i=e*xn;return this.indirectTemplateUpload[i]=t,this.indirectTemplateUpload[i+1]=n,this.indirectTemplateUpload[i+2]=r,e+1}encode(e){if(this.destroyed)throw Error(`Renderer Smusso già distrutto.`);let t=lt(e.style);this.updateStyleResources(t);let n=En(e.rebuildRect,this.documentWidth,this.documentHeight),r=En(e.changeDetectionRect,this.documentWidth,this.documentHeight),i=dt(t),a=n?this.buildJobs(n,i.apron):[],o=t.technique!==`smooth`;a.length>0&&this.ensureWorkspace(Math.max(...a.map(e=>e.buildSide)),o);let s=this.workspace,c=Tn(e.sourceMode),l=!!(a.length>0&&r&&!e.clearHeight),u=a.length>0?l?r:n:null,d=a.map(e=>o?Ye(e.buildSide,{plusOne:!0}):[]),f=[],p=0,m=[];if(l)for(let e of a){let t=Math.ceil(e.buildSide/B),n=Math.ceil(e.buildSide/B),r=p;p=this.writeIndirectArgument(p,Math.ceil(Math.ceil(e.buildSide/4)/B),n);let i=p;p=this.writeIndirectArgument(p,t,n);let a=p;p=this.writeIndirectArgument(p,Math.ceil(e.buildSide/_n),e.buildSide);let o=p;p=this.writeIndirectArgument(p,Math.ceil((e.targetHeight+e.borderTop+e.borderBottom)/_n),e.targetWidth+e.borderLeft+e.borderRight),m.push({coverage:r,full:i,gaussian:a,resolve:o})}let h=0;if(a.length>0&&!s)throw Error(`Arena Smusso non disponibile.`);let g=-1;if(u){g=h;let e={buildOriginX:u.x,buildOriginY:u.y,buildSide:Math.max(u.width,u.height),targetX:u.x,targetY:u.y,targetWidth:u.width,targetHeight:u.height,localTargetX:0,localTargetY:0,borderLeft:0,borderTop:0,borderRight:0,borderBottom:0};h=this.writeParameters(h,e,t,c)}for(let e=0;e<a.length;e+=1){let n=a[e],r=h;if(h=this.writeParameters(h,n,t,c,{outputOffsetWords:s.coverageOffsetWords,targetFullBuild:!0}),o){let a=h;h=this.writeParameters(h,n,t,c,{inputOffsetWords:s.coverageOffsetWords,outputOffsetWords:s.segmentAOffsetWords,targetFullBuild:!0});let o=[],l=s.segmentAOffsetWords,u=s.segmentBOffsetWords;for(let r of d[e])o.push(h),h=this.writeParameters(h,n,t,c,{step:r,inputOffsetWords:l,outputOffsetWords:u,targetFullBuild:!0}),[l,u]=[u,l];let p=h;h=this.writeParameters(h,n,t,c,{inputOffsetWords:l,outputOffsetWords:s.scalarAOffsetWords,targetFullBuild:!0});let m=h;h=this.writeParameters(h,n,t,c,{inputOffsetWords:s.scalarAOffsetWords,outputOffsetWords:s.scalarBOffsetWords,targetFullBuild:!0});let g=Math.min(gn,Math.ceil(3*i.sigmaB)),_=h;h=this.writeParameters(h,n,t,c,{radius:g,sigma:i.sigmaB,inputOffsetWords:s.scalarBOffsetWords,outputOffsetWords:s.scalarAOffsetWords,directionX:1,directionY:0,targetFullBuild:!0});let v=h;h=this.writeParameters(h,n,t,c,{radius:g,sigma:i.sigmaB,inputOffsetWords:s.scalarAOffsetWords,directionX:0,directionY:1,sourceOffsetX:n.localTargetX-n.borderLeft,sourceOffsetY:n.localTargetY-n.borderTop,targetWidth:n.targetWidth+n.borderLeft+n.borderRight,targetHeight:n.targetHeight+n.borderTop+n.borderBottom,destinationOffsetX:-n.borderLeft,destinationOffsetY:-n.borderTop}),f.push({coverage:r,segment:a,jfa:o,distance:p,height:m,finalGaussianHorizontal:_,resolve:v})}else{let e=Math.min(gn,Math.ceil(3*i.sigma1)),a=h;h=this.writeParameters(h,n,t,c,{radius:e,sigma:i.sigma1,inputOffsetWords:s.coverageOffsetWords,outputOffsetWords:s.scalarAOffsetWords,directionX:1,directionY:0,inputKind:1,targetFullBuild:!0});let o=h;h=this.writeParameters(h,n,t,c,{radius:e,sigma:i.sigma1,inputOffsetWords:s.scalarAOffsetWords,outputOffsetWords:s.scalarBOffsetWords,directionX:0,directionY:1,targetFullBuild:!0});let l=h;h=this.writeParameters(h,n,t,c,{inputOffsetWords:s.scalarBOffsetWords,outputOffsetWords:s.scalarAOffsetWords,targetFullBuild:!0});let u=Math.min(gn,Math.ceil(3*i.sigmaB)),d=h;h=this.writeParameters(h,n,t,c,{radius:u,sigma:i.sigmaB,inputOffsetWords:s.scalarAOffsetWords,outputOffsetWords:s.scalarBOffsetWords,directionX:1,directionY:0,targetFullBuild:!0});let p=h;h=this.writeParameters(h,n,t,c,{radius:u,sigma:i.sigmaB,inputOffsetWords:s.scalarBOffsetWords,directionX:0,directionY:1,sourceOffsetX:n.localTargetX-n.borderLeft,sourceOffsetY:n.localTargetY-n.borderTop,targetWidth:n.targetWidth+n.borderLeft+n.borderRight,targetHeight:n.targetHeight+n.borderTop+n.borderBottom,destinationOffsetX:-n.borderLeft,destinationOffsetY:-n.borderTop}),f.push({coverage:r,firstGaussian:a,secondGaussian:o,jfa:[],height:l,finalGaussianHorizontal:d,resolve:p})}}h>0&&this.device.queue.writeBuffer(this.parameterBuffer,0,this.parameterUpload,0,h*pn),p>0&&this.device.queue.writeBuffer(this.indirectArgumentsBuffer,0,this.indirectTemplateUpload.buffer,0,p*Sn),(e.clearHeight||a.length>0&&!l)&&e.encoder.clearBuffer(this.alphaClassMaskBuffer);let _=0;if(u){let t=this.bindGroups.get(c);if(!t)throw Error(`Bind group gate alpha Smusso non disponibile.`);e.encoder.clearBuffer(this.gateStateBuffer);let n=u.x%bn,r=Math.ceil((n+u.width)/bn),i=e.encoder.beginComputePass({label:l?`Detect Smusso alpha geometry changes`:`Synchronize Smusso alpha geometry classes`});i.setPipeline(this.alphaClassMaskPipeline),i.setBindGroup(0,t,this.dynamicOffset(g)),i.dispatchWorkgroups(Math.ceil(r/B),Math.ceil(u.height/B)),i.end(),_=1}if(l){let t=e.encoder.beginComputePass({label:`Gate Smusso Heightfield dispatches on GPU`});t.setPipeline(this.indirectGatePipeline),t.setBindGroup(0,this.indirectGateBindGroup),t.dispatchWorkgroups(Math.ceil(p/64)),t.end()}e.clearHeight&&e.encoder.beginRenderPass({label:`Clear Smusso persistent R32F heightfield`,colorAttachments:[{view:this.heightView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end();let v=0,y=0;if(a.length>0){let t=this.bindGroups.get(c);if(!t)throw Error(`Bind group sorgente Smusso non disponibile.`);let n=e.encoder.beginComputePass({label:o?`Smusso Scalpello Heightfield V2 update`:`Smusso Morbida Heightfield V2 update`});for(let e=0;e<a.length;e+=1){let r=a[e],i=f[e],s=m[e],c=(e,t,r)=>{if(l){if(e===void 0)throw Error(`Argomento indirect Smusso mancante.`);n.dispatchWorkgroupsIndirect(this.indirectArgumentsBuffer,e*Sn)}else n.dispatchWorkgroups(t,r)},u=Math.ceil(r.buildSide/B),d=Math.ceil(r.buildSide/B),p=Math.ceil(r.buildSide/_n),h=r.targetWidth+r.borderLeft+r.borderRight,g=r.targetHeight+r.borderTop+r.borderBottom,_=Math.ceil(g/_n),b=h;if(n.setPipeline(this.coveragePipeline),n.setBindGroup(0,t,this.dynamicOffset(i.coverage)),c(s?.coverage,Math.ceil(Math.ceil(r.buildSide/4)/B),d),v+=1,!o)n.setPipeline(this.gaussianPipeline),n.setBindGroup(0,t,this.dynamicOffset(i.firstGaussian)),c(s?.gaussian,p,r.buildSide),n.setBindGroup(0,t,this.dynamicOffset(i.secondGaussian)),c(s?.gaussian,p,r.buildSide),v+=2;else{n.setPipeline(this.segmentPipeline),n.setBindGroup(0,t,this.dynamicOffset(i.segment)),c(s?.full,u,d),v+=1,n.setPipeline(this.jfaPipeline);for(let e of i.jfa)n.setBindGroup(0,t,this.dynamicOffset(e)),c(s?.full,u,d),v+=1,y+=1;n.setPipeline(this.distancePipeline),n.setBindGroup(0,t,this.dynamicOffset(i.distance)),c(s?.full,u,d),v+=1}n.setPipeline(this.heightPipeline),n.setBindGroup(0,t,this.dynamicOffset(i.height)),c(s?.full,u,d),n.setPipeline(this.gaussianPipeline),n.setBindGroup(0,t,this.dynamicOffset(i.finalGaussianHorizontal)),c(s?.gaussian,p,r.buildSide),n.setPipeline(this.resolveHeightPipeline),n.setBindGroup(0,t,this.dynamicOffset(i.resolve)),c(s?.resolve,_,b),v+=3}n.end()}let b={cleared:!!e.clearHeight,jobs:a.length,passes:v,jfaDispatches:y,workPixels:a.reduce((e,t)=>e+t.buildSide*t.buildSide,0),resolvedPixels:a.reduce((e,t)=>e+t.targetWidth*t.targetHeight,0),workSide:s?.extent??0,apron:i.apron,technique:t.technique,gateScans:_,indirectDispatches:l?v:0};return(a.length>0||e.clearHeight)&&(this._totalBuilds+=1,this._totalJobs+=a.length,this._totalPasses+=v),this._lastEncode=b,b}destroy(){this.destroyed||(this.destroyed=!0,this.segmentWorkspaceBuffer?.destroy(),this.segmentWorkspaceBuffer=null,this.workspaceBuffer?.destroy(),this.workspaceBuffer=null,this.heightTexture.destroy(),this.profileTexture.destroy(),this.glossTexture.destroy(),this.parameterBuffer.destroy(),this.alphaClassMaskBuffer.destroy(),this.gateStateBuffer.destroy(),this.indirectArgumentsBuffer.destroy(),this.bindGroups.clear())}},Bn=`modulepreload`,Vn=function(e,t){return new URL(e,t).href},Hn={},Un=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=Vn(t,n),t=s(t),t in Hn)return;Hn[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:Bn,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},V=4096,H=1024*1024,Wn=Math.floor(Math.log2(V))+1,Gn=32,Kn=65536,qn=24e6,Jn=256,Yn=4,Xn=`quad`,Zn=`generic-smoothstep`,Qn=`shape-alpha-mask-2k`,$n=`coarse-occupancy-bitmask`,er=`legacy-full-mask`,tr=`png-gray8-direct`,nr=`canvas-fallback`,rr=`reuse-position-copy-seed`,ir=`directional-jitter-bounds`,ar=`persistent-full-resolution-screen-cache`,or=`copy-texture-to-current-texture`,sr=`live-dirty-box-filter-mip-chain`,cr=`largest-power-of-two-without-upscaling`,lr=`per-stamp-uniform-alpha-multiplier`,ur=`disabled-legacy-pipeline`,dr=`rgba8-native-2500-fixed-coverage-multiply`,fr=`rgba8-native-2500-moving-coverage-multiply`,pr=`authoritative-layer-position`,mr=`stamp-local-position`,hr=`webgpu-wgsl-linear-full-chain`,gr=`separate-opt-in-pipelines`,_r=`post-tip-coverage-pre-alpha-multiply`,vr=`disabled-semantic-mismatch-probe-spacing-active`,yr=`lazy-stroke-mip0-format-quantized-composite-mips-single-commit`,br=`m1-r8-quantized-max-coverage-plus-composited-mips-single-commit`,xr=`disabled-semantic-mismatch`,Sr=`allocate-on-glaze-select-release-when-idle-deselected`,Cr=`allocate-on-grain-select-release-when-idle-unused`,wr=`allocate-on-shape-select-release-when-idle-unused`,Tr=`queue-lag-canvas2d-tip-patch`,Er=`predictive-webgpu-tail-overlay`,Dr=`single-sampled-queue-prefix-latency`,Or=`hide-confirmed-stale-bitmap-and-single-raf-retry`,kr=`iphone-desynchronized-others-synchronized-canvas2d`,Ar=.5,jr=1.25,Mr=.2,Nr=2,Pr=256,Fr=V,Ir=384,Lr=32,Rr=32,zr=3,Br=.86,Vr=12,Hr=4,Ur=60,Wr=58,Gr=2,Kr=45,qr=`queue-lag-step-up-per-stroke`,Jr=.25,Yr=1.5,Xr=4,Zr=!1;function Qr(e){if(!e||typeof e.getContextAttributes!=`function`)return{alpha:null,desynchronized:null,colorSpace:null};let t=e.getContextAttributes();return{alpha:typeof t.alpha==`boolean`?t.alpha:null,desynchronized:typeof t.desynchronized==`boolean`?t.desynchronized:null,colorSpace:typeof t.colorSpace==`string`?t.colorSpace:null}}function $r(){return navigator.platform===`iPhone`||/\biPhone\b/.test(navigator.userAgent)}function ei(){return/\bAndroid\b/i.test(navigator.userAgent)?Xr:Yr}var ti=`cpu-render-batch-journal`,ni=`clear-and-stable-gpu-replay`,ri=`shared-immutable-references`,U=2048,ii=2500,ai=Math.floor(Math.log2(ii))+1,oi=Array.from({length:ai},(e,t)=>{let n=Math.max(1,Math.floor(ii/2**t));return n*n}).reduce((e,t)=>e+t,0),si=Array.from({length:Math.log2(U)+1},(e,t)=>{let n=Math.max(1,U>>t);return n*n}).reduce((e,t)=>e+t,0),ci=256,li=U/ci,ui=ci*ci,di=ui/32,fi=4,pi=5,mi=128,hi=.5,gi=di*4,_i=96,vi=32,yi=48,bi=32,xi=32,Si=4235600;function Ci(e){return e===`light-glaze`||e===`m1-glaze`}function wi(e){return e===`m1-glaze`?br:yr}function Ti(e){let t=e===`rgba16float`?8:4,n=0;for(let e=1;e<Wn;e+=1){let t=Math.max(1,V>>e);n+=t*t}return n*t/(1024*1024)}function Ei(e){return e===`rgba16float`?128:64}function Di(e,t){return t===`none`?0:(t===`r8-coverage`?V*V/H:Ei(e))+Ti(e)}function Oi(){return si/H}function ki(){return Si/H}function W(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function Ai(e){let t=2166136261;for(let n=0;n<e.length;n+=1)t=Math.imul(t^e[n],16777619)>>>0;return t}function ji(e){return e.length===0?0:Math.max(...e)}function Mi(e){return e.length===0?0:e.reduce((e,t)=>e+t,0)/e.length}function Ni(e){let t=e>>>0;return t=(t^t>>>16)>>>0,t=Math.imul(t,2146121005)>>>0,t=(t^t>>>15)>>>0,t=Math.imul(t,2221713035)>>>0,t=(t^t>>>16)>>>0,t}function Pi(e,t){return(Ni((e^Math.imul(t,2654435769))>>>0)&16777215)/16777216}function Fi(e,t,n){let r=(n%1+1)%1;return r<1/6?e+(t-e)*6*r:r<1/2?t:r<2/3?e+(t-e)*(2/3-r)*6:e}function Ii(e,n,r){let i=(e%1+1)%1,a=t(n,0,1),o=t(r,0,1);if(a<=1e-5){let e=Math.round(o*255);return[e,e,e]}let s=o<.5?o*(1+a):o+a-o*a,c=2*o-s;return[Math.round(t(Fi(c,s,i+1/3),0,1)*255),Math.round(t(Fi(c,s,i),0,1)*255),Math.round(t(Fi(c,s,i-1/3),0,1)*255)]}function Li(e){let n=t(e/255,0,1);return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}function Ri(e){let t=new Uint32Array(di*pi),n=new Uint8Array(ui),r=[],i=[];for(let a=0;a<pi;a+=1){let o=e[a],s=U>>a,c=1<<a;for(let e=0;e<s;e+=1)for(let t=0;t<s;t+=1){if(o[e*s+t]===0)continue;let r=Math.max(0,(t-.5)*c),i=Math.min(U,(t+1.5)*c),a=Math.max(0,(e-.5)*c),l=Math.min(U,(e+1.5)*c),u=Math.max(0,Math.floor(r/li)),d=Math.min(ci-1,Math.ceil(i/li)-1),f=Math.max(0,Math.floor(a/li)),p=Math.min(ci-1,Math.ceil(l/li)-1);for(let e=f;e<=p;e+=1){let t=e*ci;for(let e=u;e<=d;e+=1)n[t+e]=1}}let l=0,u=a*di;for(let e=0;e<n.length;e+=1){if(n[e]===0)continue;l+=1;let r=u+(e>>>5);t[r]|=1<<(e&31)>>>0}r.push(l),i.push(l/ui)}return{words:t,activeCells:r,coverageRatios:i}}var zi={tool:`paint`,shape:`circle`,shapeScatter:0,grainMode:`off`,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,color:`#ff5b35`,size:96,spacingPercent:1,startThickness:1,endThickness:1,count:24,flow:.07,opacity:1,hardness:.88,blendIntensity:1,blendMode:`normal`,blendStretch:.18,blendPaint:.14,jitterMaster:1,hueJitterDegrees:12,saturationJitter:.18,lightnessJitter:.12,darknessJitter:.18,jitterPerCopy:!1,positionJitterLateral:1,positionJitterLinear:1},Bi=class{layerSize=V;canvas;callbacks;adapter;device;context;canvasFormat;layerFormat=`rgba8unorm`;layerTexture;layerView;layerSamplingView;blendRenderer=null;rasterStrokeRenderer=null;rasterStrokeStyle=Ke(Ve);rasterStrokeCoverageValid=!1;rasterStrokeStyledInitialized=!1;rasterStrokeMipValidThroughLevel=0;rasterStrokeMipDownsampleBindGroups=[];rasterStrokeDisplayBindGroups=new Map;rasterStrokePendingComposeRect=null;rasterStrokeBusy=!1;rasterStrokeLastEncode=null;rasterBevelRenderer=null;rasterBevelStyle=ut(I);rasterBevelHeightValid=!1;rasterBevelHeightSourceMode=null;rasterBevelPendingComposeRect=null;rasterBevelBusy=!1;rasterBevelLastEncode=null;rasterBevelTotalBuilds=0;rasterBevelTotalPasses=0;rasterStrokeTotalBuilds=0;rasterStrokeTotalComposes=0;layerContentBounds=null;paintMipViews=[];paintMipDownsampleBindGroups=[];paintDisplayMipValidThroughLevel=0;paintDisplaySelectedMipLevel=0;presentationCacheTexture=null;presentationCacheView=null;presentationCacheWidth=0;presentationCacheHeight=0;presentationCacheNeedsFullRebuild=!0;lightGlazeTexture=null;lightGlazeCompositeMipTexture=null;lightGlazeView=null;lightGlazeSamplingView=null;lightGlazeMipViews=[];lightGlazeMipDownsampleBindGroups=[];lightGlazeCompositeMipBindGroup=null;lightGlazeDisplayBindGroup=null;lightGlazeCompositeBindGroup=null;lightGlazeSession=null;lightGlazeStorageAllocated=!1;lightGlazeStorageMode=`none`;thicknessTailTexture=null;thicknessTailView=null;thicknessTailDisplayBindGroup=null;thicknessTailTextureWidth=0;thicknessTailTextureHeight=0;thicknessTailPresentedRect=null;adaptivePreviewCanvas;adaptivePreviewContext;adaptivePreviewScratchCanvas;adaptivePreviewScratchContext;adaptiveSpacingMaxExtraPercentPoints;adaptivePreviewVisibleCanvasRequestedDesynchronized;adaptivePreviewVisibleContextAttributes;adaptivePreviewScratchContextAttributes;adaptivePreviewShapeSprite=null;adaptivePreviewShapePalette=[];adaptivePreviewShapePaletteKey=``;adaptivePreviewGeneration=1;adaptivePreviewSubmissionsSinceProbe=0;adaptivePreviewSubmittedSerial=0;adaptivePreviewConfirmedSerial=0;adaptivePreviewLastPresentedSerial=0;adaptivePreviewLastIncompleteRetrySerial=0;adaptivePreviewCandidates=[];adaptivePreviewProbe=null;adaptivePreviewConsecutiveSlowProbes=0;adaptivePreviewActive=!1;adaptivePreviewFrozen=!1;adaptivePreviewForceStroke=!1;adaptivePreviewStartedAt=0;adaptivePreviewRetirementTargetSerial=0;adaptivePreviewFrameRequest=null;adaptivePreviewRetirementFrame=null;adaptivePreviewCssWidth=0;adaptivePreviewCssHeight=0;canvasCssWidth=1;canvasCssHeight=1;brushUniformBuffer;thicknessTailBrushUniformBuffer;grainUniformBuffer;displayUniformBuffer;thicknessTailDisplayUniformBuffer;lightGlazeUniformBuffer;instanceBuffer;thicknessTailInstanceBuffer;shapeOccupancyUniformBuffers=[];sampler;shapeMaskTexture=null;shapeMaskView;shapeMaskPlaceholderTexture;shapeMaskPlaceholderView;shapeResident=!1;shapeLoadingPromise=null;shapeMaskSampler;grainTexture=null;grainTextureView;grainPlaceholderTexture;grainPlaceholderView;grainResident=!1;grainLoadingPromise=null;grainSamplers;grainTextureIdentity=0;grainStartupDecodeMs=0;grainStartupMipBuildMs=0;grainStartupUploadMs=0;shapeMaskDecodeStrategy=nr;shapeMaskIdentity=0;shapeOccupancyActiveCells=Array(pi).fill(0);shapeOccupancyCoverageRatios=Array(pi).fill(1);packedMinimumRadius=1/0;brushBindGroupLayout;brushOccupancyBindGroupLayout;grainBrushBindGroupLayout;grainBrushOccupancyBindGroupLayout;displayBindGroupLayout;rasterStrokeDisplayScreenBindGroupLayout;rasterStrokeDisplaySourceBindGroupLayout;thicknessTailDisplayBindGroupLayout;lightGlazeDisplayBindGroupLayout;lightGlazeCompositeMipBindGroupLayout;lightGlazeCompositeBindGroupLayout;paintMipDownsampleBindGroupLayout;brushBindGroup;thicknessTailBrushBindGroup;brushOccupancyBindGroups=[];thicknessTailBrushOccupancyBindGroups=[];grainBrushBindGroups;grainBrushOccupancyBindGroups;thicknessTailGrainBrushBindGroups;thicknessTailGrainBrushOccupancyBindGroups;displayBindGroup;rasterStrokeDisplayScreenBindGroup;brushShaderModule;texturizedGrainShaderModule;displayShaderModule;rasterStrokeDisplayShaderModule;thicknessTailDisplayShaderModule;lightGlazeDisplayShaderModule;lightGlazeCompositeMipShaderModule;lightGlazeCompositeShaderModule;paintMipDownsampleShaderModule;normalPipeline;additivePipeline;shapeNormalPipeline;shapeAdditivePipeline;shapeOccupancyNormalPipeline;shapeOccupancyAdditivePipeline;grainNormalPipeline;grainAdditivePipeline;grainShapeNormalPipeline;grainShapeAdditivePipeline;grainShapeOccupancyNormalPipeline;grainShapeOccupancyAdditivePipeline;m1GlazePipeline;m1GlazeShapePipeline;m1GlazeShapeOccupancyPipeline;grainM1GlazePipeline;grainM1GlazeShapePipeline;grainM1GlazeShapeOccupancyPipeline;displayPipeline;rasterStrokeDisplayPipeline;thicknessTailDisplayPipeline;lightGlazeDisplayPipeline;lightGlazeCompositeMipPipeline;lightGlazeCompositePipeline;paintMipDownsamplePipeline;instanceUpload=new ArrayBuffer(Kn*Gn);instanceUploadF32=new Float32Array(this.instanceUpload);instanceUploadU32=new Uint32Array(this.instanceUpload);thicknessTailInstanceUpload=new ArrayBuffer(Kn*Gn);thicknessTailInstanceUploadF32=new Float32Array(this.thicknessTailInstanceUpload);thicknessTailInstanceUploadU32=new Uint32Array(this.thicknessTailInstanceUpload);brushUniformUpload=new ArrayBuffer(_i);thicknessTailBrushUniformUpload=new ArrayBuffer(_i);grainUniformUpload=new Float32Array(vi/4);displayUniformUpload=new Float32Array(yi/4);thicknessTailDisplayUniformUpload=new ArrayBuffer(xi);settings={...zi};pendingStamps=[];pendingBlendBatches=[];activeStroke=null;seedSequence=1;historyActions=[];historyCursor=0;nextHistoryActionId=1;historyBatches=[];historyStoredBaseStamps=0;historyCompactionPending=!1;historyBusy=!1;layerHasContent=!1;frameRequest=null;clearRequested=!0;displayDirty=!0;initialized=!1;viewCenterX=V*.5;viewCenterY=V*.5;zoom=1;hasFittedView=!1;totalBaseStamps=0;avoidedLogicalDraws=0;lastCpuFrameMs=0;renderTimestamps=[];gpuLabel=`GPU WebGPU`;activeStrokeProfile=null;lastStampGeometry=Xn;lastStampVerticesPerCopy=Yn;lastShapeSamplingStrategy=`none`;lastShapeOccupancyFallbackReason=`none`;lastShapeOccupancyMipLevel=-1;lastShapeOccupancyActiveCells=0;lastShapeOccupancyCoverageRatio=0;lastShapeOccupancyCandidateMipLevel=-1;lastShapeOccupancyCandidateActiveCells=0;lastShapeOccupancyCandidateCoverageRatio=0;constructor(e,t={},n=null){this.canvas=e,this.callbacks=t,this.adaptivePreviewCanvas=n,this.adaptiveSpacingMaxExtraPercentPoints=ei(),this.adaptivePreviewVisibleCanvasRequestedDesynchronized=$r(),this.adaptivePreviewContext=n?.getContext(`2d`,{alpha:!0,desynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized})??null,this.adaptivePreviewScratchCanvas=this.adaptivePreviewContext?document.createElement(`canvas`):null,this.adaptivePreviewScratchContext=this.adaptivePreviewScratchCanvas?.getContext(`2d`,{alpha:!0,desynchronized:!0})??null,this.adaptivePreviewVisibleContextAttributes=Qr(this.adaptivePreviewContext),this.adaptivePreviewScratchContextAttributes=Qr(this.adaptivePreviewScratchContext)}async initialize(){if(this.callbacks.onStatus?.(`Richiesta adapter WebGPU…`,`working`),!navigator.gpu)throw Error(`WebGPU non è disponibile in questo browser o in questo contesto.`);let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e)throw Error(`Nessun adapter WebGPU compatibile trovato.`);if(this.adapter=e,e.limits.maxTextureDimension2D<V)throw Error(`La GPU supporta texture fino a ${e.limits.maxTextureDimension2D}px, meno dei ${V}px richiesti.`);this.device=await e.requestDevice(),this.device.lost.then(e=>{this.invalidateAdaptivePreview();let t=e.message||e.reason;this.callbacks.onStatus?.(`Device WebGPU perso: ${t}`,`error`)});let t=this.canvas.getContext(`webgpu`);if(!t)throw Error(`Impossibile ottenere GPUCanvasContext.`);this.context=t,this.canvasFormat=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST,alphaMode:`opaque`,colorSpace:`srgb`}),this.gpuLabel=this.describeAdapter(e),await this.createStaticResources(),this.prepareAdaptivePreviewShapePalette(this.settings),await this.recreateLayerResources(this.layerFormat),this.resizeCanvas(),this.fitView(),this.writeBrushUniforms(),this.initialized=!0,this.settings.grainMode!==`off`&&this.requestGrainLoad(),this.settings.shape===`shape`&&this.requestShapeLoad(),this.clearAdaptivePreviewCanvas(),this.requestRender(),this.callbacks.onStatus?.(`WebGPU pronto. Disegna sul canvas.`,`ok`),this.publishStats(),this.publishHistoryState()}getSettings(){return{...this.settings}}setBrushSettings(e){this.flushPendingWorkBeforeSettingsChange();let n=this.settings.tool,r=e.tool===`paint`||e.tool===`blend`?e.tool:this.settings.tool;this.settings={...this.settings,...e,tool:r,shape:e.shape===`shape`||e.shape===`circle`?e.shape:this.settings.shape,shapeScatter:t(e.shapeScatter??this.settings.shapeScatter,0,1),grainMode:e.grainMode===`off`||e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:this.settings.grainMode,grainScale:t(e.grainScale??this.settings.grainScale,.1,4),grainDepth:t(e.grainDepth??this.settings.grainDepth,0,1),grainBrightness:t(e.grainBrightness??this.settings.grainBrightness,-1,1),grainContrast:t(e.grainContrast??this.settings.grainContrast,-1,1),grainInvert:typeof e.grainInvert==`boolean`?e.grainInvert:this.settings.grainInvert,grainFiltering:e.grainFiltering===`no`||e.grainFiltering===`classic`||e.grainFiltering===`improved`?e.grainFiltering:this.settings.grainFiltering,grainBlendMode:e.grainBlendMode===`multiply`?e.grainBlendMode:this.settings.grainBlendMode,count:t(Math.round(e.count??this.settings.count),1,24),size:t(e.size??this.settings.size,r===`blend`?1:4,r===`blend`?1024:1500),spacingPercent:t(e.spacingPercent??this.settings.spacingPercent,r===`blend`?1:.25,r===`blend`?400:25),startThickness:t(e.startThickness??this.settings.startThickness,0,2),endThickness:t(e.endThickness??this.settings.endThickness,0,2),flow:t(e.flow??this.settings.flow,.001,1),opacity:t(e.opacity??this.settings.opacity,0,1),hardness:t(e.hardness??this.settings.hardness,0,1),blendIntensity:t(e.blendIntensity??this.settings.blendIntensity,.1,4),blendMode:e.blendMode===`normal`||e.blendMode===`additive`||e.blendMode===`light-glaze`||e.blendMode===`m1-glaze`?e.blendMode:this.settings.blendMode,blendStretch:t(e.blendStretch??this.settings.blendStretch,0,1),blendPaint:t(e.blendPaint??this.settings.blendPaint,0,1),jitterMaster:t(e.jitterMaster??this.settings.jitterMaster,0,1),hueJitterDegrees:t(e.hueJitterDegrees??this.settings.hueJitterDegrees,0,180),saturationJitter:t(e.saturationJitter??this.settings.saturationJitter,0,1),lightnessJitter:t(e.lightnessJitter??this.settings.lightnessJitter,0,1),darknessJitter:t(e.darknessJitter??this.settings.darknessJitter,0,1),positionJitterLateral:t(e.positionJitterLateral??this.settings.positionJitterLateral,0,1),positionJitterLinear:t(e.positionJitterLinear??this.settings.positionJitterLinear,0,1)},this.prepareAdaptivePreviewShapePalette(this.settings),this.initialized&&(r!==n&&(r===`blend`?this.blendRenderer?.prewarmScratch():this.maybeReleaseIdleBlendScratch()),r===`paint`&&Ci(this.settings.blendMode)?!this.lightGlazeSession&&!this.activeStroke&&this.ensureLightGlazeResources(this.settings.blendMode):this.maybeReleaseIdleLightGlazeResources(),this.settings.grainMode===`off`?this.maybeReleaseIdleGrainResources():this.requestGrainLoad(),this.settings.shape===`shape`?this.requestShapeLoad():this.maybeReleaseIdleShapeResources(),this.invalidateAdaptivePreview(),this.writeBrushUniforms(),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),this.displayDirty=!0,this.requestRender())}getRasterStrokeStyle(){return Ke(this.rasterStrokeStyle)}isRasterStrokeBusy(){return this.rasterStrokeBusy}getRasterBevelStyle(){return ut(this.rasterBevelStyle)}isRasterBevelBusy(){return this.rasterBevelBusy}rasterStrokeActive(){return!!(this.rasterStrokeRenderer&&this.rasterStrokeStyle.enabled&&this.rasterStrokeStyle.width>0)}rasterBevelActive(){return!!(this.rasterBevelRenderer&&this.rasterBevelStyle.enabled)}styleStackActive(){return!!(this.rasterStrokeRenderer&&(this.rasterStrokeStyle.enabled&&this.rasterStrokeStyle.width>0||this.rasterBevelStyle.enabled))}rebuildRasterStrokeDisplayBindGroups(){let e=this.rasterStrokeRenderer;if(this.rasterStrokeDisplayBindGroups.clear(),e)for(let t of[`permanent`,`light-glaze`,`thickness-tail`])this.rasterStrokeDisplayBindGroups.set(t,e.createDisplayBindGroup(this.rasterStrokeDisplaySourceBindGroupLayout,this.sampler,t))}async ensureRasterStrokeRenderer(e=this.rasterStrokeStyle.width){if(this.rasterStrokeRenderer)return this.rasterStrokeRenderer;let t=Re(e),n=await sn.create({device:this.device,documentWidth:V,documentHeight:V,layerFormat:this.layerFormat,layerView:this.layerView,lightGlazeUniformBuffer:this.lightGlazeUniformBuffer,thicknessTailUniformBuffer:this.thicknessTailDisplayUniformBuffer,scratchExtent:t});return n.setLightGlazeView(this.lightGlazeView),n.setThicknessTailView(this.thicknessTailView),n.setBevelResources(this.rasterBevelRenderer?.heightView??null,this.rasterBevelRenderer?.glossView??null),n.updateBevelParameters(this.rasterBevelStyle),this.rasterStrokeRenderer=n,this.rebuildRasterStrokeDisplayBindGroups(),this.rasterStrokeMipDownsampleBindGroups=n.mipViews.slice(0,-1).map((e,t)=>this.device.createBindGroup({label:`Traccia styled logical mip ${t+1} to ${t+2}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:e}]})),this.rasterStrokeCoverageValid=!1,this.rasterStrokeStyledInitialized=!1,this.rasterStrokeMipValidThroughLevel=0,this.rasterStrokeLastEncode=null,n}releaseRasterStrokeRenderer(){this.rasterStrokeRenderer?.destroy(),this.rasterStrokeRenderer=null,this.rasterStrokeDisplayBindGroups.clear(),this.rasterStrokeMipDownsampleBindGroups=[],this.rasterStrokeCoverageValid=!1,this.rasterStrokeStyledInitialized=!1,this.rasterStrokeMipValidThroughLevel=0,this.rasterStrokePendingComposeRect=null,this.rasterStrokeLastEncode=null}async ensureRasterBevelRenderer(){if(this.rasterBevelRenderer)return this.rasterBevelRenderer;let e=await zn.create({device:this.device,documentWidth:V,documentHeight:V,layerView:this.layerView,lightGlazeUniformBuffer:this.lightGlazeUniformBuffer,thicknessTailUniformBuffer:this.thicknessTailDisplayUniformBuffer});return e.setLightGlazeView(this.lightGlazeView),e.setThicknessTailView(this.thicknessTailView),e.updateStyleResources(this.rasterBevelStyle),this.rasterBevelRenderer=e,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null,this.rasterBevelLastEncode=null,this.rasterStrokeRenderer&&(this.rasterStrokeRenderer.setBevelResources(e.heightView,e.glossView),this.rasterStrokeRenderer.updateBevelParameters(this.rasterBevelStyle),this.rebuildRasterStrokeDisplayBindGroups()),e}releaseRasterBevelRenderer(){this.rasterBevelRenderer?.destroy(),this.rasterBevelRenderer=null,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null,this.rasterBevelLastEncode=null,this.rasterStrokeRenderer&&(this.rasterStrokeRenderer.setBevelResources(null,null),this.rasterStrokeRenderer.updateBevelParameters(this.rasterBevelStyle),this.rebuildRasterStrokeDisplayBindGroups())}async setRasterStrokeStyle(e){let t=Ge(e),n=t.enabled&&t.width>0;if(qe(t,this.rasterStrokeStyle)&&(!n||this.rasterStrokeRenderer))return!0;if(!this.initialized)return this.rasterStrokeStyle=t,!0;if(this.activeStroke||this.historyBusy||this.rasterStrokeBusy||this.rasterBevelBusy)return!1;this.flushPendingWorkBeforeSettingsChange();let r=Ke(this.rasterStrokeStyle),i=r.enabled&&r.width>0,a=t.enabled&&t.width>0;this.rasterStrokeBusy=!0;try{if(a){let e=Re(t.width);this.rasterStrokeRenderer?this.rasterStrokeRenderer.scratchExtent!==e&&(this.callbacks.onStatus?.(`Adatto la memoria scratch della Traccia…`,`working`),await this.waitForIdle(),this.rasterStrokeRenderer.resizeScratch(e)):(this.callbacks.onStatus?.(`Preparo la Traccia WebGPU…`,`working`),await this.waitForIdle(),await this.ensureRasterStrokeRenderer(t.width))}if(this.rasterStrokeStyle=t,a){let e=t.width!==r.width||t.position!==r.position;(!i||e)&&(this.rasterStrokeCoverageValid=!1),this.rasterStrokePendingComposeRect=this.rasterStrokeEffectRect(this.layerContentBounds,Math.max(r.width,t.width)),this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0,this.requestRender(),this.callbacks.onStatus?.(`Traccia WebGPU attiva.`,`ok`)}else await this.waitForIdle(),this.rasterBevelStyle.enabled?this.rasterStrokePendingComposeRect=this.rasterStrokeEffectRect(this.layerContentBounds,r.width):this.releaseRasterStrokeRenderer(),this.paintDisplayMipValidThroughLevel=0,this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0,this.requestRender(),i&&this.callbacks.onStatus?.(this.rasterBevelStyle.enabled?`Traccia disattivata; il compositore condiviso resta per lo Smusso/Rilievo.`:`Traccia disattivata; memoria GPU liberata.`,`ok`);return this.publishStats(),!0}catch(e){this.rasterStrokeStyle=r,!i&&!this.rasterBevelStyle.enabled&&this.releaseRasterStrokeRenderer();let t=e instanceof Error?e.message:String(e);throw this.callbacks.onStatus?.(`Traccia WebGPU non disponibile: ${t}`,`error`),e}finally{this.rasterStrokeBusy=!1}}async setRasterBevelStyle(e){let t=lt(e),n=gt(this.rasterBevelStyle,t,this.rasterBevelHeightValid?pt(this.rasterBevelStyle):0);if(ht(t,this.rasterBevelStyle)&&(!t.enabled||this.rasterBevelRenderer&&this.rasterStrokeRenderer))return!0;if(!this.initialized)return this.rasterBevelStyle=t,!0;if(this.activeStroke||this.historyBusy||this.rasterStrokeBusy||this.rasterBevelBusy)return!1;this.flushPendingWorkBeforeSettingsChange();let r=ut(this.rasterBevelStyle),i=r.enabled,a=_t(this.layerContentBounds,r,V,V);this.rasterBevelBusy=!0;try{if(await this.waitForIdle(),this.rasterBevelStyle=t,t.enabled){this.rasterBevelRenderer||(this.callbacks.onStatus?.(`Preparo lo Smusso/Rilievo Heightfield V2…`,`working`),await this.ensureRasterBevelRenderer()),this.rasterStrokeRenderer||await this.ensureRasterStrokeRenderer(),this.rasterBevelRenderer.updateStyleResources(t),this.rasterStrokeRenderer.setBevelResources(this.rasterBevelRenderer.heightView,this.rasterBevelRenderer.glossView),this.rasterStrokeRenderer.updateBevelParameters(t),this.rebuildRasterStrokeDisplayBindGroups(),(!i||n.geometryRebuild)&&(this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null);let e=_t(this.layerContentBounds,t,V,V);this.rasterBevelPendingComposeRect=this.mergeDirtyRects(a,e),this.callbacks.onStatus?.(`Smusso/Rilievo Heightfield V2 attivo.`,`ok`)}else this.rasterBevelPendingComposeRect=a,this.releaseRasterBevelRenderer(),this.rasterStrokeStyle.enabled&&this.rasterStrokeStyle.width>0||this.releaseRasterStrokeRenderer(),i&&this.callbacks.onStatus?.(`Smusso/Rilievo disattivato; memoria Heightfield liberata.`,`ok`);return this.paintDisplayMipValidThroughLevel=0,this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0,this.requestRender(),this.publishStats(),!0}catch(e){this.rasterBevelStyle=r,i?(this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null,this.rasterBevelRenderer?.updateStyleResources(r),this.rasterStrokeRenderer?.updateBevelParameters(r)):(this.releaseRasterBevelRenderer(),this.rasterStrokeStyle.enabled&&this.rasterStrokeStyle.width>0||this.releaseRasterStrokeRenderer());let t=e instanceof Error?e.message:String(e);throw this.callbacks.onStatus?.(`Smusso/Rilievo WebGPU non disponibile: ${t}`,`error`),e}finally{this.rasterBevelBusy=!1}}async setLayerFormat(e){if(e===this.layerFormat)return!0;if(!this.initialized||this.historyBusy||this.activeStroke)return!1;let t=this.layerFormat;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(`Ricreo il layer in formato ${e}…`,`working`);try{await this.waitForIdle(),await this.recreateLayerResources(e),this.layerFormat=e,this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.layerHasContent=!1,this.layerContentBounds=null;try{this.rasterBevelStyle.enabled&&await this.ensureRasterBevelRenderer(),(this.rasterStrokeStyle.enabled&&this.rasterStrokeStyle.width>0||this.rasterBevelStyle.enabled)&&await this.ensureRasterStrokeRenderer()}catch(e){this.rasterStrokeStyle={...this.rasterStrokeStyle,enabled:!1},this.rasterBevelStyle={...this.rasterBevelStyle,enabled:!1},this.releaseRasterBevelRenderer(),this.releaseRasterStrokeRenderer(),console.error(`Ricreazione style stack dopo cambio formato non riuscita`,e)}return this.requestRender(),this.callbacks.onStatus?.(`Layer ${e} pronto. Il contenuto è stato azzerato.`,`ok`),this.publishStats(),!0}catch(n){this.layerFormat=t;let r=n instanceof Error?n.message:String(n);throw this.callbacks.onStatus?.(`Formato ${e} non disponibile: ${r}`,`error`),n}finally{this.historyBusy=!1,this.publishHistoryState()}}resizeCanvas(){if(!this.device||!this.context)return;let e=this.canvas.getBoundingClientRect();this.canvasCssWidth=Math.max(1,e.width),this.canvasCssHeight=Math.max(1,e.height);let t=Math.min(window.devicePixelRatio||1,2),n=Math.max(1,Math.floor(e.width*t)),r=Math.max(1,Math.floor(e.height*t));this.canvas.width===n&&this.canvas.height===r||(this.invalidateAdaptivePreview(),this.canvas.width=n,this.canvas.height=r,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.hasFittedView?this.requestRender():this.fitView())}fitView(){this.invalidateAdaptivePreview();let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.viewCenterX=V*.5,this.viewCenterY=V*.5,this.zoom=Math.max(.01,Math.min(e/V,t/V)*.94),this.hasFittedView=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}zoomBy(e,n,r){this.invalidateAdaptivePreview();let i=this.canvas.getBoundingClientRect(),a=n??i.left+i.width*.5,o=r??i.top+i.height*.5,s=this.clientToLayer(a,o);this.zoom=t(this.zoom*e,.02,64);let c=this.clientToCanvasPixels(a,o);this.viewCenterX=s.x-(c.x-this.canvas.width*.5)/this.zoom,this.viewCenterY=s.y-(c.y-this.canvas.height*.5)/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}panByClientDelta(e,t){this.invalidateAdaptivePreview();let n=this.canvas.getBoundingClientRect(),r=this.canvas.width/Math.max(1,n.width),i=this.canvas.height/Math.max(1,n.height);this.viewCenterX-=e*r/this.zoom,this.viewCenterY-=t*i/this.zoom,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.requestRender()}beginStroke(e){this.beginStrokeAtLayer(this.toLayerPoint(e))}beginStrokeAtLayer(e){if(this.historyBusy)return;if(this.settings.grainMode!==`off`&&!this.grainResident){this.requestGrainLoad(),this.callbacks.onStatus?.(`Grain M1 in caricamento: riprova tra un istante…`,`working`);return}if(this.settings.shape===`shape`&&!this.shapeResident){this.requestShapeLoad(),this.callbacks.onStatus?.(`Shape 2K in caricamento: riprova tra un istante…`,`working`);return}let t={...e,timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()};this.flushPendingWorkBeforeSettingsChange(),this.flushClosingLightGlazeSessionBeforeNewStroke(),this.invalidateAdaptivePreview();let n=this.settings.tool,r=n===`paint`&&Ci(this.settings.blendMode)?{...this.settings}:null;r&&this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0,this.displayDirty=!0),this.adaptivePreviewForceStroke=n===`paint`&&Zr;let i=this.nextHistoryActionId++,a=r??this.settings,o={startThickness:a.startThickness,endThickness:a.endThickness},s=n===`blend`?M({size:this.settings.size,strength:1,spacing:this.settings.spacingPercent/100,flow:this.settings.flow,stretch:this.settings.blendStretch,paint:this.settings.blendPaint,aspect:1,angle:0,orientToStroke:!0,seed:i},{documentWidth:V,documentHeight:V}):null;s?.reset(t),this.activeStroke={tool:n,lastInput:t,startedAtMs:t.timeMs,thicknessSettings:o,thicknessDynamicsNeutral:n===`blend`||Pe(o.startThickness,o.endThickness),thicknessTailHoldback:n===`paint`&&Ne(o.endThickness),heldThicknessStamps:[],heldThicknessHead:0,distanceSinceStamp:0,adaptiveSpacingInitialPercent:r?.spacingPercent??this.settings.spacingPercent,adaptiveSpacingPercent:r?.spacingPercent??this.settings.spacingPercent,historyActionId:i,historyCommitted:!1,submitted:!1,seedSequenceBeforeStroke:this.seedSequence,historyCursorBeforeStroke:this.historyCursor,redoActionsBeforeStroke:this.historyCursor<this.historyActions.length?this.historyActions.slice(this.historyCursor):null,historyCompactionPendingBeforeStroke:this.historyCompactionPending,lightGlazeSettings:r,blendSettings:n===`blend`?{...this.settings}:null,blendPlanner:s},r&&this.startLightGlazeSession(i,r),n===`blend`?this.blendRenderer?.beginStroke(i):this.emitStamp(t,1,0)}extendStroke(e){this.extendStrokeAtLayer(e.map(e=>this.toLayerPoint(e)))}extendStrokeAtLayer(e){if(this.activeStroke)for(let t of e)this.appendPoint(t)}endStroke(e){let t=this.activeStroke;if(t?.tool===`blend`){t.blendPlanner?.finish(),this.drainBlendPlanner(t);let e=t.historyCommitted;this.activeStroke=null,this.pendingBlendBatches.length>0&&(this.displayDirty=!0,this.requestRender()),e&&this.publishHistoryState();return}let n=!!(t?.thicknessTailHoldback&&!t.lightGlazeSettings&&(this.settings.blendMode===`normal`||this.settings.blendMode===`additive`));if(t){let n=Number.isFinite(e)?e:t.lastInput.timeMs,r=Math.max(t.lastInput.timeMs,n);this.releaseHeldThicknessStamps(r,!0)}let r=t?.historyCommitted??!1;t?.lightGlazeSettings&&this.lightGlazeSession?.historyActionId===t.historyActionId&&(this.lightGlazeSession.endRequested=!0,this.displayDirty=!0,this.requestRender()),this.freezeAdaptivePreviewAtLift(),this.activeStroke=null,(n||this.thicknessTailPresentedRect)&&(this.displayDirty=!0,this.requestRender()),r&&this.publishHistoryState()}cancelStrokeBeforeRender(){let e=this.activeStroke;if(!e||e.submitted)return!1;let t=0;this.pendingStamps=this.pendingStamps.filter(n=>{let r=n.historyActionId===e.historyActionId;return r&&(t+=1),!r});let n=this.pendingBlendBatches.length;return this.pendingBlendBatches=this.pendingBlendBatches.filter(t=>t.actionId!==e.historyActionId),t+=n-this.pendingBlendBatches.length,e.blendPlanner?.discardPending(),this.seedSequence=e.seedSequenceBeforeStroke,e.historyCommitted&&(this.historyActions.length=e.historyCursorBeforeStroke,e.redoActionsBeforeStroke&&this.historyActions.push(...e.redoActionsBeforeStroke),this.historyCursor=e.historyCursorBeforeStroke,this.historyCompactionPending=e.historyCompactionPendingBeforeStroke,this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps=Math.max(0,this.activeStrokeProfile.baseStamps-t),this.activeStrokeProfile.historyCommittedActions=Math.max(0,this.activeStrokeProfile.historyCommittedActions-1))),this.activeStroke=null,this.lightGlazeSession?.historyActionId===e.historyActionId&&this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.thicknessTailPresentedRect&&(this.displayDirty=!0,this.requestRender()),e.historyCommitted&&this.publishHistoryState(),!0}async clear(){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;this.historyBusy=!0,this.invalidateAdaptivePreview(),this.publishHistoryState(),this.callbacks.onStatus?.(`Pulizia del layer…`,`working`);try{return await this.waitForIdle(),this.layerHasContent?(this.submitImmediate([],!0,this.settings,!0,null),this.clearRequested=!1,this.displayDirty=!1,await this.device.queue.onSubmittedWorkDone(),this.layerHasContent=!1,this.hasVisibleHistoryContent()?(this.truncateRedoHistory(),this.historyActions.push({id:this.nextHistoryActionId++,kind:`clear`}),this.historyCursor=this.historyActions.length,this.compactDiscardedHistory(),this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)):this.resetHistoryState(),this.callbacks.onStatus?.(`Layer pulito.`,`ok`),!0):(this.callbacks.onStatus?.(`Il layer è già vuoto.`,`ok`),!1)}finally{this.historyBusy=!1,this.publishHistoryState()}}resetDocument(){return this.historyBusy?!1:(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.pendingStamps.length=0,this.pendingBlendBatches.length=0,this.activeStroke=null,this.abandonLightGlazeSession(),this.invalidateAdaptivePreview(),this.resetHistoryState(),this.clearRequested=!0,this.displayDirty=!0,this.presentationCacheNeedsFullRebuild=!0,this.layerHasContent=!1,this.layerContentBounds=null,this.requestRender(),this.publishHistoryState(),!0)}async undo(){return this.moveHistoryCursor(-1)}async redo(){return this.moveHistoryCursor(1)}async runBenchmark(e){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);if(this.historyBusy||this.activeStroke)throw Error(`Concludi prima il tratto o l'operazione Undo/Redo.`);if(this.settings.tool===`blend`)throw Error(`Il benchmark GPU sintetico misura Paint: seleziona Pennello Paint.`);this.lightGlazeSession&&await this.waitForIdle(),this.settings.shape===`shape`&&await this.ensureShapeResources(),this.settings.grainMode!==`off`&&await this.ensureGrainResources();let n=t(Math.round(e),1,Math.min(12e3,Kn));this.invalidateAdaptivePreview(),this.pendingStamps.length=0,this.pendingBlendBatches.length=0,this.activeStroke=null,this.resetHistoryState(),this.publishHistoryState(),this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),await this.device.queue.onSubmittedWorkDone();let r=this.settings,i=this.generateBenchmarkStamps(n,r);Ci(r.blendMode)&&(this.startLightGlazeSession(0,r),this.lightGlazeSession.endRequested=!0,this.lightGlazeSession.commitRequested=!0);let a=performance.now(),o=this.submitImmediate(i,!0,r),s=o.totalCpuMs;this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=!0,await this.device.queue.onSubmittedWorkDone();let c=performance.now()-a,l=this.nextHistoryActionId++;for(let e of i)e.historyActionId=l;this.historyActions.push({id:l,kind:`stroke`}),this.historyCursor=this.historyActions.length,this.recordHistoryBatch(i,r,o,!0),this.totalBaseStamps+=i.length,this.avoidedLogicalDraws+=i.length*Math.max(0,r.count-1),this.recordRenderedFrame(performance.now()),this.publishStats(),this.publishHistoryState();let u=i.reduce((e,t)=>e+t.radius*t.radius,0)/i.length,d=Math.round(Math.PI*u*i.length*r.count),f=[`1 draw instanziata`,`${r.count} copie fisiche GPU per stamp base`,r.shape===`shape`?this.lastShapeSamplingStrategy===$n?`bitmask alpha ${ci}², mip ${this.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(this.lastShapeOccupancyCoverageRatio*100).toFixed(1)}%`:`quad Shape legacy da 4 vertici, fallback ${this.lastShapeOccupancyFallbackReason}, mappa candidata ${(this.lastShapeOccupancyCandidateCoverageRatio*100).toFixed(1)}%`:`geometria quad triangle-strip (4 vertici)`,r.shape===`shape`?`coverage da maschera alpha 2048²`:`coverage fragment smoothstep generica`,r.shape===`shape`?this.shapeMaskDecodeStrategy===tr?`PNG grayscale decodificata direttamente`:`PNG decodificata tramite fallback canvas`:`nessuna maschera Shape`,r.shape===`shape`?`scatter rotazione ${(r.shapeScatter*100).toFixed(0)}%`:`orientamento circolare invariato`,`riuso copySeed per jitter colore per copia`,`dirty rect direzionale conservativo`,this.isTexturizedGrainActive(r)?`grain Cotton Fleece M1 2500 ${r.grainMode} ${r.grainFiltering}, scale ${(r.grainScale*100).toFixed(0)}%, depth ${(r.grainDepth*100).toFixed(0)}%`:`grain Off, pipeline legacy`].join(` · `);return{baseStamps:i.length,logicalCopies:i.length*r.count,cpuSubmitMs:s,gpuCompletionMs:c,estimatedCoveredFragments:d,strategy:f}}getGpuMemoryStats(){let e=this.initialized,t=this.layerFormat===`rgba16float`?8:4,n=this.rasterStrokeRenderer,r=this.rasterBevelRenderer,i=e?Ei(this.layerFormat):0,a=e?Ti(this.layerFormat):0,o=e&&this.grainResident?oi*4/H:0,s=e&&this.shapeResident?Oi():0,c=e?ki():0,l=this.presentationCacheTexture?this.presentationCacheWidth*this.presentationCacheHeight*4/H:0,u=(n?.styledMemoryBytes??0)/H,d=(n?.coverageMemoryBytes??0)/H,f=((n?.thresholdMaskMemoryBytes??0)+(n?.controlMemoryBytes??0))/H,p=(n?.scratchMemoryBytes??0)/H,m=n?.scratchExtent??0,h=(r?.heightMemoryBytes??0)/H,g=((r?.lutMemoryBytes??0)+(r?.controlMemoryBytes??0))/H,_=(r?.workspaceMemoryBytes??0)/H,v=r?.workspaceExtent??0,y=this.blendRenderer?.allocatedMemoryMiB()??0,b=this.lightGlazeStorageAllocated?Di(this.layerFormat,this.lightGlazeStorageMode):0,x=this.thicknessTailTexture?this.thicknessTailTextureWidth*this.thicknessTailTextureHeight*t/H:0;return{layerBaseMiB:i,layerMipChainMiB:a,grainTextureMiB:o,shapeTextureMiB:s,paintBuffersMiB:c,presentationCacheMiB:l,rasterStrokeStyledMiB:u,rasterStrokeCoverageMiB:d,rasterStrokeMaskAndControlMiB:f,rasterStrokeScratchMiB:p,blendRendererMiB:y,rasterBevelHeightMiB:h,rasterBevelLutAndControlMiB:g,rasterBevelScratchMiB:_,rasterBevelScratchExtent:v,lightGlazeMiB:b,thicknessTailMiB:x,historyCpuMiB:this.historyStoredBaseStamps*Gn/H,rasterStrokeScratchExtent:m,countedTotalMiB:[i,a,o,s,c,l,u,d,f,p,y,b,x,h,g,_].reduce((e,t)=>e+t,0)}}getStats(){let e=performance.now();this.renderTimestamps=this.renderTimestamps.filter(t=>e-t<=1e3);let t=this.getGpuMemoryStats();return{fps:this.renderTimestamps.length,lastCpuFrameMs:this.lastCpuFrameMs,totalBaseStamps:this.totalBaseStamps,avoidedLogicalDraws:this.avoidedLogicalDraws,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,rasterStrokeStyle:Ke(this.rasterStrokeStyle),rasterStrokePersistentMemoryMiB:(this.rasterStrokeRenderer?.persistentMemoryBytes??0)/H,rasterStrokeScratchMemoryMiB:(this.rasterStrokeRenderer?.scratchMemoryBytes??0)/H,rasterStrokeBuilds:this.rasterStrokeTotalBuilds,rasterStrokeComposes:this.rasterStrokeTotalComposes,rasterStrokeRendererBuild:this.rasterStrokeRenderer?.build??null,rasterBevelStyle:ut(this.rasterBevelStyle),rasterBevelPersistentMemoryMiB:((this.rasterBevelRenderer?.heightMemoryBytes??0)+(this.rasterBevelRenderer?.lutMemoryBytes??0)+(this.rasterBevelRenderer?.controlMemoryBytes??0))/H,rasterBevelScratchMemoryMiB:(this.rasterBevelRenderer?.workspaceMemoryBytes??0)/H,rasterBevelBuilds:this.rasterBevelTotalBuilds,rasterBevelPasses:this.rasterBevelTotalPasses,rasterBevelRendererBuild:this.rasterBevelRenderer?.build??null,gpuMemory:t,gpuLabel:this.gpuLabel,layerFormat:this.layerFormat}}getBlendRuntimeState(){let e=this.blendRenderer?.memoryMiB()??0;return{scratchAllocated:e>0,scratchMemoryMiB:e}}maybeReleaseIdleBlendScratch(){!this.initialized||this.settings.tool===`blend`||this.activeStroke!==null||this.historyBusy||this.pendingBlendBatches.length>0||this.blendRenderer?.releaseScratch()&&this.publishStats()}maybeReleaseIdleLightGlazeResources(){!this.initialized||!this.lightGlazeStorageAllocated||this.settings.tool===`paint`&&Ci(this.settings.blendMode)||this.lightGlazeSession!==null||this.activeStroke!==null||this.historyBusy||this.pendingStamps.length>0||(this.destroyLightGlazeResources(),this.publishStats())}requestGrainLoad(){this.grainResident||this.grainLoadingPromise||this.ensureGrainResources().catch(e=>{let t=e instanceof Error?e.message:String(e);this.callbacks.onStatus?.(`Grain M1 non disponibile: ${t}`,`error`)})}ensureGrainResources(){if(this.grainResident)return Promise.resolve();if(this.grainLoadingPromise)return this.grainLoadingPromise;this.callbacks.onStatus?.(`Carico la texture Grain M1…`,`working`);let e=(async()=>{let e=await this.createGrainTextureResources();this.grainTexture=e.texture,this.grainTextureView=this.grainTexture.createView({label:`Cotton Fleece M1 native grain full mip view`}),this.grainTextureIdentity=e.identity,this.grainStartupDecodeMs=e.decodeMs,this.grainStartupMipBuildMs=e.mipBuildMs,this.grainStartupUploadMs=e.uploadMs,this.rebuildGrainBrushBindGroups(),this.blendRenderer?.setGrainTextureView(this.grainTextureView),this.grainResident=!0,this.callbacks.onStatus?.(`Grain M1 pronto.`,`ok`),this.publishStats()})();return this.grainLoadingPromise=e.finally(()=>{this.grainLoadingPromise=null}),this.grainLoadingPromise}maybeReleaseIdleGrainResources(){!this.initialized||!this.grainResident||this.grainLoadingPromise!==null||this.settings.grainMode!==`off`||this.activeStroke!==null||this.lightGlazeSession!==null||this.historyBusy||this.pendingStamps.length>0||this.pendingBlendBatches.length>0||(this.grainTexture?.destroy(),this.grainTexture=null,this.grainTextureView=this.grainPlaceholderView,this.rebuildGrainBrushBindGroups(),this.blendRenderer?.setGrainTextureView(this.grainPlaceholderView),this.grainResident=!1,this.publishStats())}requestShapeLoad(){this.shapeResident||this.shapeLoadingPromise||this.ensureShapeResources().catch(e=>{let t=e instanceof Error?e.message:String(e);this.callbacks.onStatus?.(`Shape 2K non disponibile: ${t}`,`error`)})}ensureShapeResources(){if(this.shapeResident)return Promise.resolve();if(this.shapeLoadingPromise)return this.shapeLoadingPromise;this.callbacks.onStatus?.(`Carico la maschera Shape 2K…`,`working`);let e=(async()=>{let e=await this.createShapeMaskResources();this.shapeMaskTexture=e.texture,this.shapeMaskView=this.shapeMaskTexture.createView({label:`Shape 2K mask view`}),this.shapeMaskDecodeStrategy=e.decodeStrategy,this.shapeMaskIdentity=e.identity,this.shapeOccupancyActiveCells=e.occupancyActiveCells,this.shapeOccupancyCoverageRatios=e.occupancyCoverageRatios,this.adaptivePreviewShapeSprite=e.previewSprite,this.shapeOccupancyUniformBuffers.forEach((t,n)=>{let r=n*di;this.device.queue.writeBuffer(t,0,e.occupancyWords.subarray(r,r+di))}),this.rebuildShapeBrushBindGroups(),this.rebuildGrainBrushBindGroups(),this.blendRenderer?.setShapeMaskView(this.shapeMaskView),this.prepareAdaptivePreviewShapePalette(this.settings),this.shapeResident=!0,this.callbacks.onStatus?.(`Shape 2K pronta.`,`ok`),this.publishStats()})();return this.shapeLoadingPromise=e.finally(()=>{this.shapeLoadingPromise=null}),this.shapeLoadingPromise}maybeReleaseIdleShapeResources(){!this.initialized||!this.shapeResident||this.shapeLoadingPromise!==null||this.settings.shape===`shape`||this.activeStroke!==null||this.lightGlazeSession!==null||this.historyBusy||this.pendingStamps.length>0||this.pendingBlendBatches.length>0||(this.shapeMaskTexture?.destroy(),this.shapeMaskTexture=null,this.shapeMaskView=this.shapeMaskPlaceholderView,this.rebuildShapeBrushBindGroups(),this.rebuildGrainBrushBindGroups(),this.blendRenderer?.setShapeMaskView(this.shapeMaskPlaceholderView),this.shapeResident=!1,this.publishStats())}getHistoryState(){return{canUndo:!this.historyBusy&&this.historyCursor>0,canRedo:!this.historyBusy&&this.historyCursor<this.historyActions.length,busy:this.historyBusy,actionCount:this.historyActions.length,cursor:this.historyCursor,storedBaseStamps:this.historyStoredBaseStamps,logicalStampBytes:this.historyStoredBaseStamps*Gn}}getAdaptivePreviewDiagnostics(){return{active:this.adaptivePreviewActive,frozen:this.adaptivePreviewFrozen,visible:this.adaptivePreviewCanvas?.style.opacity===`1`,submittedSerial:this.adaptivePreviewSubmittedSerial,confirmedSerial:this.adaptivePreviewConfirmedSerial,lastPresentedSerial:this.adaptivePreviewLastPresentedSerial,retirementTargetSerial:this.adaptivePreviewRetirementTargetSerial,candidateCount:this.adaptivePreviewCandidates.length,presentedUnboundCandidates:this.adaptivePreviewCandidates.filter(e=>e.presented&&e.serial===null).length,drawFramePending:this.adaptivePreviewFrameRequest!==null,retirementFramePending:this.adaptivePreviewRetirementFrame!==null}}async waitForGpu(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);await this.device.queue.onSubmittedWorkDone()}async runRasterStrokeGolden(){if(!this.initialized)throw Error(`WebGPU non ancora inizializzato.`);if(this.activeStroke)throw Error(`Termina prima la pennellata attiva.`);await this.waitForIdle();let{runRasterStrokeGolden:e}=await Un(async()=>{let{runRasterStrokeGolden:e}=await import(`./stroke-golden-CDKh0Bfx.js`);return{runRasterStrokeGolden:e}},[],import.meta.url);return e(this.device)}async waitForIdle(){if(!this.initialized)throw Error(`Il motore non è ancora inizializzato.`);for(;this.grainLoadingPromise;)await this.grainLoadingPromise;for(;this.shapeLoadingPromise;)await this.shapeLoadingPromise;for(;this.frameRequest!==null||this.pendingStamps.length>0||this.pendingBlendBatches.length>0||this.clearRequested||this.displayDirty||this.lightGlazeSession?.commitRequested;)await new Promise(e=>requestAnimationFrame(()=>e()));await this.device.queue.onSubmittedWorkDone(),this.retireAdaptivePreviewAfterGpuIdle()}resetStrokeRandomSeed(){this.seedSequence=1}startStrokePerformanceProfile(){this.activeStrokeProfile={startedAt:performance.now(),stampGeometry:Xn,stampVerticesPerCopy:Yn,fragmentCoverageStrategy:this.settings.shape===`shape`?Qn:Zn,shapeSamplingStrategy:`none`,shapeOccupancyFallbackReason:`none`,shapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:0,historyCapturedBaseStamps:0,historyCapturedBatches:0,historyCommittedActions:0,historyReplayOperations:0,baseStamps:0,physicalCopies:0,renderFrames:0,brushBatches:0,largestBatchStamps:0,estimatedScissorPixels:0,thicknessDynamicsHeldBaseStamps:0,thicknessDynamicsMaximumHeldBaseStamps:0,thicknessDynamicsReleasedDuringStroke:0,thicknessDynamicsReleasedAtLift:0,thicknessDynamicsPreviewFrames:0,thicknessDynamicsPreviewBaseStamps:0,thicknessDynamicsPreviewPhysicalCopies:0,thicknessDynamicsPreviewMaximumTexturePixels:0,presentationCacheFullRebuilds:0,presentationCachePartialUpdates:0,presentationCacheOffscreenSkips:0,presentationCacheLod0FullRebuildTraceEnabledPasses:0,presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs:0,presentationCacheLod0FullRebuildTraceDisabledPasses:0,presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs:0,presentationCacheUpdatedPixels:0,legacyDisplayShaderPixels:0,presentationCopiedPixels:0,paintDisplayMaximumSelectedMipLevel:0,paintDisplayPyramidMaintenanceFrames:0,paintDisplayPyramidFullLevelBuilds:0,paintDisplayPyramidDirtyLevelUpdates:0,paintDisplayPyramidPasses:0,paintDisplayPyramidBaseDirtyPixels:0,paintDisplayPyramidUpdatedPixels:0,paintDisplayPyramidEncodingMs:0,adaptivePreviewProbeStarts:0,adaptivePreviewProbeResolvedFast:0,adaptivePreviewProbeResolvedSlow:0,adaptivePreviewProbeTimeouts:0,adaptivePreviewProbeCancellations:0,adaptivePreviewProbeRejections:0,adaptivePreviewProbeNearMisses:0,adaptivePreviewProbeLatencyMs:[],adaptivePreviewProbeBacklogBaseStamps:[],adaptivePreviewProbeTimeoutLatenessMs:[],adaptiveSpacingInitialPercent:this.settings.spacingPercent,adaptiveSpacingFinalPercent:this.settings.spacingPercent,adaptiveSpacingEvents:[],grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?_r:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?vr:`legacy`,grainBatches:0,grainBaseStamps:0,grainPhysicalCopies:0,grainCircleBatches:0,grainShapeBatches:0,grainAdaptivePreviewSkips:0,lightGlazeStrategy:wi(this.settings.blendMode),lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,adaptivePreviewActivations:0,adaptivePreviewActivationReason:`none`,adaptivePreviewFirstActivationReason:null,adaptivePreviewFirstActivationMs:null,adaptivePreviewSecondActivationReason:null,adaptivePreviewSecondActivationMs:null,adaptivePreviewFrames:0,adaptivePreviewBaseStampsDrawn:0,adaptivePreviewPhysicalCopiesDrawn:0,adaptivePreviewBudgetSkips:0,adaptivePreviewConfirmedStaleBitmapHides:0,adaptivePreviewIncompleteFrameRetryRequests:0,adaptivePreviewOversizedSkips:0,adaptivePreviewPatchPixels:0,adaptivePreviewMaxPatchBackingPixels:0,adaptivePreviewJsTotalMs:0,adaptivePreviewJsFrameMs:[],adaptivePreviewMaxLifetimeMs:0,adaptivePreviewMaxQueueProbeLatencyMs:0,adaptivePreviewMaxUnconfirmedBaseStamps:0,adaptivePreviewRetirements:0,adaptivePreviewFrozenAtLift:0,adaptivePreviewLiftPendingBaseStamps:0,adaptivePreviewLiftPendingSerialBindings:0,adaptivePreviewUnsupportedBlendSkips:0,adaptivePreviewExactBaseStampsSubmitted:0,adaptivePreviewExactBatchesSubmitted:0,stampGenerationMs:0,stampPackingMs:0,instanceUploadMs:0,brushEncodingMs:0,displayEncodingMs:0,commandSubmitMs:0,cpuFrameMs:[],renderFrameTotalMs:[],renderFrameOverheadMs:[],resizeCanvasMs:0,batchExtractionMs:0,statsPublishMs:0,renderIntervalMs:[],previousFrameTimestamp:null}}finishStrokePerformanceProfile(){let e=this.activeStrokeProfile;if(this.activeStrokeProfile=null,!e)return null;let t=Mi(e.renderIntervalMs);return{stampGeometry:e.stampGeometry,stampVerticesPerCopy:e.stampVerticesPerCopy,fragmentCoverageStrategy:e.fragmentCoverageStrategy,shapeSamplingStrategy:e.shapeSamplingStrategy,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:e.shapeOccupancyFallbackReason,shapeOccupancyGridSize:ci,shapeOccupancyMipLevel:e.shapeOccupancyMipLevel,shapeOccupancyActiveCells:e.shapeOccupancyActiveCells,shapeOccupancyCoverageRatio:e.shapeOccupancyCoverageRatio,shapeOccupancyCandidateMipLevel:e.shapeOccupancyCandidateMipLevel,shapeOccupancyCandidateActiveCells:e.shapeOccupancyCandidateActiveCells,shapeOccupancyCandidateCoverageRatio:e.shapeOccupancyCandidateCoverageRatio,shapeOccupancyMaximumMip:fi,shapeOccupancyMinimumRadius:mi,shapeOccupancyMaximumCoverageRatio:hi,shapeOccupancyBitmaskBytes:gi,colorSeedStrategy:rr,dirtyRectStrategy:ir,thicknessDynamicsStrategy:De,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsHeldBaseStamps:e.thicknessDynamicsHeldBaseStamps,thicknessDynamicsMaximumHeldBaseStamps:e.thicknessDynamicsMaximumHeldBaseStamps,thicknessDynamicsReleasedDuringStroke:e.thicknessDynamicsReleasedDuringStroke,thicknessDynamicsReleasedAtLift:e.thicknessDynamicsReleasedAtLift,thicknessDynamicsPreviewStrategy:Er,thicknessDynamicsPreviewTextureQuantum:Pr,thicknessDynamicsPreviewMaximumTextureDimension:Fr,thicknessDynamicsPreviewFrames:e.thicknessDynamicsPreviewFrames,thicknessDynamicsPreviewBaseStamps:e.thicknessDynamicsPreviewBaseStamps,thicknessDynamicsPreviewPhysicalCopies:e.thicknessDynamicsPreviewPhysicalCopies,thicknessDynamicsPreviewMaximumTexturePixels:e.thicknessDynamicsPreviewMaximumTexturePixels,thicknessDynamicsPreviewAdditionalMemoryMiB:e.thicknessDynamicsPreviewMaximumTexturePixels*(this.layerFormat===`rgba16float`?8:4)/(1024*1024),presentationCacheStrategy:ar,presentationTransferStrategy:or,presentationCacheFullRebuilds:e.presentationCacheFullRebuilds,presentationCachePartialUpdates:e.presentationCachePartialUpdates,presentationCacheOffscreenSkips:e.presentationCacheOffscreenSkips,presentationCacheLod0FullRebuildTraceEnabledPasses:e.presentationCacheLod0FullRebuildTraceEnabledPasses,presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs:e.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs,presentationCacheLod0FullRebuildTraceDisabledPasses:e.presentationCacheLod0FullRebuildTraceDisabledPasses,presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs:e.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs,presentationCacheUpdatedPixels:e.presentationCacheUpdatedPixels,legacyDisplayShaderPixels:e.legacyDisplayShaderPixels,presentationCopiedPixels:e.presentationCopiedPixels,paintDisplayPyramidStrategy:sr,paintDisplayLodSelectionStrategy:cr,paintDisplayMipLevelCount:Wn,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayMaximumSelectedMipLevel:e.paintDisplayMaximumSelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:Ti(this.layerFormat),paintDisplayPyramidMaintenanceFrames:e.paintDisplayPyramidMaintenanceFrames,paintDisplayPyramidFullLevelBuilds:e.paintDisplayPyramidFullLevelBuilds,paintDisplayPyramidDirtyLevelUpdates:e.paintDisplayPyramidDirtyLevelUpdates,paintDisplayPyramidPasses:e.paintDisplayPyramidPasses,paintDisplayPyramidBaseDirtyPixels:e.paintDisplayPyramidBaseDirtyPixels,paintDisplayPyramidUpdatedPixels:e.paintDisplayPyramidUpdatedPixels,paintDisplayPyramidEncodingMs:e.paintDisplayPyramidEncodingMs,brushOpacityStrategy:lr,grainStrategy:e.grainStrategy,grainCoordinateStrategy:e.grainCoordinateStrategy,grainSamplingStrategy:e.grainSamplingStrategy,grainMipStrategy:hr,grainTextureFormat:`rgba8unorm`,grainTextureWidth:ii,grainTextureHeight:ii,grainTextureMipLevelCount:ai,grainTextureMemoryMiB:oi*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:gr,grainCoverageStrategy:e.grainCoverageStrategy,grainAdaptivePreviewStrategy:e.grainAdaptivePreviewStrategy,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,grainBatches:e.grainBatches,grainBaseStamps:e.grainBaseStamps,grainPhysicalCopies:e.grainPhysicalCopies,grainCircleBatches:e.grainCircleBatches,grainShapeBatches:e.grainShapeBatches,grainAdaptivePreviewSkips:e.grainAdaptivePreviewSkips,lightGlazeStrategy:e.lightGlazeStrategy,lightGlazeAdaptivePreviewStrategy:xr,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeStorageMode:this.lightGlazeStorageMode,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?Di(this.layerFormat,this.lightGlazeStorageMode):0,lightGlazeBatches:e.lightGlazeBatches,lightGlazeCommits:e.lightGlazeCommits,lightGlazeCompositePixels:e.lightGlazeCompositePixels,lightGlazePyramidPasses:e.lightGlazePyramidPasses,lightGlazePyramidUpdatedPixels:e.lightGlazePyramidUpdatedPixels,adaptivePreviewStrategy:Tr,adaptivePreviewTriggerStrategy:Dr,adaptivePreviewStaleFrameStrategy:Or,adaptivePreviewVisibleCanvasStrategy:kr,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:Ar,adaptivePreviewJsBudgetMs:jr,adaptivePreviewMaxTipBaseStamps:Nr,adaptivePreviewMaxPatchCssPixels:Ir,adaptivePreviewProbeIntervalSubmissions:Hr,adaptivePreviewTriggerThresholdMs:Ur,adaptivePreviewSlowCompletionThresholdMs:Wr,adaptivePreviewTriggerConsecutiveProbes:Gr,adaptivePreviewProbeNearMissMinimumMs:Kr,adaptivePreviewProbeStarts:e.adaptivePreviewProbeStarts,adaptivePreviewProbeResolvedFast:e.adaptivePreviewProbeResolvedFast,adaptivePreviewProbeResolvedSlow:e.adaptivePreviewProbeResolvedSlow,adaptivePreviewProbeTimeouts:e.adaptivePreviewProbeTimeouts,adaptivePreviewProbeCancellations:e.adaptivePreviewProbeCancellations,adaptivePreviewProbeRejections:e.adaptivePreviewProbeRejections,adaptivePreviewProbeNearMisses:e.adaptivePreviewProbeNearMisses,adaptiveSpacingStrategy:qr,adaptiveSpacingStepPercentPoints:Jr,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,adaptiveSpacingInitialPercent:e.adaptiveSpacingInitialPercent,adaptiveSpacingFinalPercent:e.adaptiveSpacingFinalPercent,adaptiveSpacingIncreaseCount:e.adaptiveSpacingEvents.length,adaptiveSpacingReachedMaximum:e.adaptiveSpacingFinalPercent>=e.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints-2**-52*8,adaptiveSpacingEvents:e.adaptiveSpacingEvents,adaptivePreviewActivations:e.adaptivePreviewActivations,adaptivePreviewActivationReason:e.adaptivePreviewActivationReason,adaptivePreviewFirstActivationReason:e.adaptivePreviewFirstActivationReason,adaptivePreviewFirstActivationMs:e.adaptivePreviewFirstActivationMs,adaptivePreviewSecondActivationReason:e.adaptivePreviewSecondActivationReason,adaptivePreviewSecondActivationMs:e.adaptivePreviewSecondActivationMs,adaptivePreviewFrames:e.adaptivePreviewFrames,adaptivePreviewBaseStampsDrawn:e.adaptivePreviewBaseStampsDrawn,adaptivePreviewPhysicalCopiesDrawn:e.adaptivePreviewPhysicalCopiesDrawn,adaptivePreviewBudgetSkips:e.adaptivePreviewBudgetSkips,adaptivePreviewConfirmedStaleBitmapHides:e.adaptivePreviewConfirmedStaleBitmapHides,adaptivePreviewIncompleteFrameRetryRequests:e.adaptivePreviewIncompleteFrameRetryRequests,adaptivePreviewOversizedSkips:e.adaptivePreviewOversizedSkips,adaptivePreviewPatchPixels:e.adaptivePreviewPatchPixels,adaptivePreviewMaxPatchBackingPixels:e.adaptivePreviewMaxPatchBackingPixels,adaptivePreviewJsTotalMs:e.adaptivePreviewJsTotalMs,adaptivePreviewJsP50Ms:W(e.adaptivePreviewJsFrameMs,.5),adaptivePreviewJsP95Ms:W(e.adaptivePreviewJsFrameMs,.95),adaptivePreviewJsMaxMs:ji(e.adaptivePreviewJsFrameMs),adaptivePreviewMaxLifetimeMs:e.adaptivePreviewMaxLifetimeMs,adaptivePreviewProbeLatencyP50Ms:W(e.adaptivePreviewProbeLatencyMs,.5),adaptivePreviewProbeLatencyP95Ms:W(e.adaptivePreviewProbeLatencyMs,.95),adaptivePreviewMaxQueueProbeLatencyMs:e.adaptivePreviewMaxQueueProbeLatencyMs,adaptivePreviewProbeBacklogP50BaseStamps:W(e.adaptivePreviewProbeBacklogBaseStamps,.5),adaptivePreviewProbeBacklogP95BaseStamps:W(e.adaptivePreviewProbeBacklogBaseStamps,.95),adaptivePreviewProbeBacklogMaxBaseStamps:ji(e.adaptivePreviewProbeBacklogBaseStamps),adaptivePreviewProbeTimeoutLatenessP50Ms:W(e.adaptivePreviewProbeTimeoutLatenessMs,.5),adaptivePreviewProbeTimeoutLatenessP95Ms:W(e.adaptivePreviewProbeTimeoutLatenessMs,.95),adaptivePreviewProbeTimeoutLatenessMaxMs:ji(e.adaptivePreviewProbeTimeoutLatenessMs),adaptivePreviewMaxUnconfirmedBaseStamps:e.adaptivePreviewMaxUnconfirmedBaseStamps,adaptivePreviewRetirements:e.adaptivePreviewRetirements,adaptivePreviewFrozenAtLift:e.adaptivePreviewFrozenAtLift,adaptivePreviewLiftPendingBaseStamps:e.adaptivePreviewLiftPendingBaseStamps,adaptivePreviewLiftPendingSerialBindings:e.adaptivePreviewLiftPendingSerialBindings,adaptivePreviewUnsupportedBlendSkips:e.adaptivePreviewUnsupportedBlendSkips,adaptivePreviewDeferredBaseStamps:0,adaptivePreviewResolvedBaseStamps:0,adaptivePreviewExactReplayBatches:0,adaptivePreviewLiftGpuSubmissions:0,adaptivePreviewExactBaseStampsSubmitted:e.adaptivePreviewExactBaseStampsSubmitted,adaptivePreviewExactBatchesSubmitted:e.adaptivePreviewExactBatchesSubmitted,historyStorageStrategy:ti,historyReplayStrategy:ni,historyStampRetentionStrategy:ri,historyCapturedBaseStamps:e.historyCapturedBaseStamps,historyCapturedBatches:e.historyCapturedBatches,historyCommittedActions:e.historyCommittedActions,historyStoredBaseStampsAtEnd:this.historyStoredBaseStamps,historyLogicalStampBytesAtEnd:this.historyStoredBaseStamps*Gn,historyReplayOperations:e.historyReplayOperations,baseStamps:e.baseStamps,physicalCopies:e.physicalCopies,renderFrames:e.renderFrames,brushBatches:e.brushBatches,largestBatchStamps:e.largestBatchStamps,estimatedScissorPixels:e.estimatedScissorPixels,stampGenerationMs:e.stampGenerationMs,stampPackingMs:e.stampPackingMs,instanceUploadMs:e.instanceUploadMs,brushEncodingMs:e.brushEncodingMs,displayEncodingMs:e.displayEncodingMs,commandSubmitMs:e.commandSubmitMs,submitImmediateP50Ms:W(e.cpuFrameMs,.5),submitImmediateP95Ms:W(e.cpuFrameMs,.95),submitImmediateMaxMs:ji(e.cpuFrameMs),renderFrameTotalP50Ms:W(e.renderFrameTotalMs,.5),renderFrameTotalP95Ms:W(e.renderFrameTotalMs,.95),renderFrameTotalMaxMs:ji(e.renderFrameTotalMs),renderFrameOverheadP50Ms:W(e.renderFrameOverheadMs,.5),renderFrameOverheadP95Ms:W(e.renderFrameOverheadMs,.95),renderFrameOverheadMaxMs:ji(e.renderFrameOverheadMs),resizeCanvasTotalMs:e.resizeCanvasMs,batchExtractionTotalMs:e.batchExtractionMs,statsPublishTotalMs:e.statsPublishMs,cpuFrameP50Ms:W(e.cpuFrameMs,.5),cpuFrameP95Ms:W(e.cpuFrameMs,.95),cpuFrameMaxMs:ji(e.cpuFrameMs),renderIntervalP50Ms:W(e.renderIntervalMs,.5),renderIntervalP95Ms:W(e.renderIntervalMs,.95),renderIntervalMaxMs:ji(e.renderIntervalMs),averageRenderFps:t>0?1e3/t:0,delayedRenderFrames:e.renderIntervalMs.filter(e=>e>20).length}}getBenchmarkEnvironment(){return{canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,layerSize:V,layerFormat:this.layerFormat,layerMemoryMiB:this.layerFormat===`rgba16float`?128:64,gpuLabel:this.gpuLabel,timestampQueriesSupported:this.device?.features.has(`timestamp-query`)??!1,rasterStrokeRendererBuild:this.rasterStrokeRenderer?.build??null,rasterStrokeStyle:Ke(this.rasterStrokeStyle),rasterStrokePersistentMemoryMiB:(this.rasterStrokeRenderer?.persistentMemoryBytes??0)/(1024*1024),rasterStrokeCoverageMemoryMiB:(this.rasterStrokeRenderer?.coverageMemoryBytes??0)/(1024*1024),rasterStrokeScratchMemoryMiB:(this.rasterStrokeRenderer?.scratchMemoryBytes??0)/(1024*1024),rasterStrokeCoverageStrategy:Tt,rasterStrokeStyledStorageStrategy:Ot,rasterStrokeDistanceStorageStrategy:Et,rasterStrokeMutationGateStrategy:Dt,rasterStrokeScratchStrategy:Fe,rasterStrokeScratchExtent:this.rasterStrokeRenderer?.scratchExtent??0,rasterStrokeScratchCompactMaxWidth:128,dryBlendScratchLifecycleStrategy:d,rasterBevelRendererBuild:this.rasterBevelRenderer?.build??null,rasterBevelStyle:ut(this.rasterBevelStyle),rasterBevelHeightMemoryMiB:(this.rasterBevelRenderer?.heightMemoryBytes??0)/H,rasterBevelScratchMemoryMiB:(this.rasterBevelRenderer?.workspaceMemoryBytes??0)/H,rasterBevelScratchExtent:this.rasterBevelRenderer?.workspaceExtent??0,rasterBevelFieldStrategy:ln,rasterBevelDistanceStrategy:un,rasterBevelWorkspaceStrategy:dn,rasterBevelHeightSourceMode:this.rasterBevelHeightSourceMode,stampGeometry:this.settings.shape===`shape`?this.lastStampGeometry:Xn,stampVerticesPerCopy:this.settings.shape===`shape`?this.lastStampVerticesPerCopy:Yn,fragmentCoverageStrategy:this.settings.shape===`shape`?Qn:Zn,shapeSamplingStrategy:this.settings.shape===`shape`?this.lastShapeSamplingStrategy:`none`,shapeMaskDecodeStrategy:this.shapeMaskDecodeStrategy,shapeOccupancyFallbackReason:this.settings.shape===`shape`?this.lastShapeOccupancyFallbackReason:`none`,shapeOccupancyGridSize:ci,shapeOccupancyMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyMipLevel:-1,shapeOccupancyActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyActiveCells:0,shapeOccupancyCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCoverageRatio:0,shapeOccupancyCandidateMipLevel:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateMipLevel:-1,shapeOccupancyCandidateActiveCells:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateActiveCells:0,shapeOccupancyCandidateCoverageRatio:this.settings.shape===`shape`?this.lastShapeOccupancyCandidateCoverageRatio:0,shapeOccupancyMaximumMip:fi,shapeOccupancyMinimumRadius:mi,shapeOccupancyMaximumCoverageRatio:hi,shapeOccupancyBitmaskBytes:gi,shapeMaskResident:this.shapeResident,shapeStorageLifecycleStrategy:wr,colorSeedStrategy:rr,dirtyRectStrategy:ir,thicknessDynamicsStrategy:De,thicknessDynamicsTaperWindowMs:100,thicknessDynamicsPreviewStrategy:Er,thicknessDynamicsPreviewTextureQuantum:Pr,thicknessDynamicsPreviewMaximumTextureDimension:Fr,presentationCacheStrategy:ar,presentationTransferStrategy:or,paintDisplayPyramidStrategy:sr,paintDisplayLodSelectionStrategy:cr,paintDisplayMipLevelCount:Wn,paintDisplaySelectedMipLevel:this.paintDisplaySelectedMipLevel,paintDisplayPyramidAdditionalMemoryMiB:Ti(this.layerFormat),brushOpacityStrategy:lr,grainStrategy:this.grainStrategy(this.settings),grainCoordinateStrategy:this.grainCoordinateStrategy(this.settings),grainSamplingStrategy:this.grainSamplingStrategy(this.settings),grainMipStrategy:hr,grainTextureFormat:`rgba8unorm`,grainTextureWidth:ii,grainTextureHeight:ii,grainTextureMipLevelCount:ai,grainTextureMemoryMiB:oi*4/(1024*1024),grainTextureIdentity:this.grainTextureIdentity,grainPipelineStrategy:gr,grainCoverageStrategy:this.isTexturizedGrainActive(this.settings)?_r:`none`,grainAdaptivePreviewStrategy:this.isTexturizedGrainActive(this.settings)?vr:`legacy`,grainStartupDecodeMs:this.grainStartupDecodeMs,grainStartupMipBuildMs:this.grainStartupMipBuildMs,grainStartupUploadMs:this.grainStartupUploadMs,grainTextureResident:this.grainResident,grainStorageLifecycleStrategy:Cr,lightGlazeStrategy:wi(this.settings.blendMode),lightGlazeAdaptivePreviewStrategy:xr,lightGlazeStorageAllocated:this.lightGlazeStorageAllocated,lightGlazeStorageMode:this.lightGlazeStorageMode,lightGlazeAdditionalMemoryMiB:this.lightGlazeStorageAllocated?Di(this.layerFormat,this.lightGlazeStorageMode):0,lightGlazeStorageLifecycleStrategy:Sr,adaptivePreviewStrategy:Tr,adaptivePreviewTriggerStrategy:Dr,adaptivePreviewStaleFrameStrategy:Or,adaptivePreviewVisibleCanvasStrategy:kr,adaptivePreviewVisibleCanvasRequestedDesynchronized:this.adaptivePreviewVisibleCanvasRequestedDesynchronized,adaptivePreviewVisibleCanvasAlpha:this.adaptivePreviewVisibleContextAttributes.alpha,adaptivePreviewVisibleCanvasDesynchronized:this.adaptivePreviewVisibleContextAttributes.desynchronized,adaptivePreviewVisibleCanvasColorSpace:this.adaptivePreviewVisibleContextAttributes.colorSpace,adaptivePreviewScratchCanvasAlpha:this.adaptivePreviewScratchContextAttributes.alpha,adaptivePreviewScratchCanvasDesynchronized:this.adaptivePreviewScratchContextAttributes.desynchronized,adaptivePreviewScratchCanvasColorSpace:this.adaptivePreviewScratchContextAttributes.colorSpace,adaptivePreviewExactLinearScale:Ar,adaptivePreviewJsBudgetMs:jr,adaptivePreviewMaxTipBaseStamps:Nr,adaptivePreviewMaxPatchCssPixels:Ir,adaptivePreviewProbeIntervalSubmissions:Hr,adaptivePreviewTriggerThresholdMs:Ur,adaptivePreviewSlowCompletionThresholdMs:Wr,adaptivePreviewTriggerConsecutiveProbes:Gr,adaptivePreviewProbeNearMissMinimumMs:Kr,adaptiveSpacingStrategy:qr,adaptiveSpacingStepPercentPoints:Jr,adaptiveSpacingMaxExtraPercentPoints:this.adaptiveSpacingMaxExtraPercentPoints,historyStorageStrategy:ti,historyReplayStrategy:ni,historyStampRetentionStrategy:ri}}async createStaticResources(){this.brushUniformBuffer=this.device.createBuffer({label:`Brush uniforms`,size:_i,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailBrushUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail brush uniforms`,size:_i,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.grainUniformBuffer=this.device.createBuffer({label:`Texturized grain uniforms`,size:vi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayUniformBuffer=this.device.createBuffer({label:`Display uniforms`,size:yi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.thicknessTailDisplayUniformBuffer=this.device.createBuffer({label:`Predictive thickness tail display uniforms`,size:xi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.lightGlazeUniformBuffer=this.device.createBuffer({label:`Light Glaze stroke opacity`,size:bi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.instanceBuffer=this.device.createBuffer({label:`Stamp instance storage`,size:Kn*Gn,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.thicknessTailInstanceBuffer=this.device.createBuffer({label:`Predictive thickness tail instance storage`,size:Kn*Gn,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=this.device.createSampler({label:`Layer linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.shapeMaskSampler=this.device.createSampler({label:`Shape 2K mask sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`});let e=(e,t)=>({no:this.device.createSampler({label:`Cotton Fleece M1 ${e} no filtering`,magFilter:`nearest`,minFilter:`nearest`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t}),classic:this.device.createSampler({label:`Cotton Fleece M1 ${e} classic filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:t,addressModeV:t}),improved:this.device.createSampler({label:`Cotton Fleece M1 ${e} improved filtering`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:t,addressModeV:t})});this.grainSamplers={fixed:e(`fixed`,`repeat`),moving:e(`moving`,`clamp-to-edge`)},this.grainPlaceholderTexture=this.device.createTexture({label:`Grain placeholder 1×1 while released`,size:{width:1,height:1,depthOrArrayLayers:1},format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.device.queue.writeTexture({texture:this.grainPlaceholderTexture},new Uint8Array([255,255,255,255]),{bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1}),this.grainPlaceholderView=this.grainPlaceholderTexture.createView({label:`Grain placeholder view`}),this.grainTextureView=this.grainPlaceholderView,this.shapeMaskPlaceholderTexture=this.device.createTexture({label:`Shape placeholder 1×1 while released`,size:{width:1,height:1,depthOrArrayLayers:1},format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.device.queue.writeTexture({texture:this.shapeMaskPlaceholderTexture},new Uint8Array(256).fill(255),{bytesPerRow:256,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1}),this.shapeMaskPlaceholderView=this.shapeMaskPlaceholderTexture.createView({label:`Shape placeholder view`}),this.shapeMaskView=this.shapeMaskPlaceholderView,this.shapeOccupancyUniformBuffers=Array.from({length:pi},(e,t)=>this.device.createBuffer({label:`Shape conservative occupancy bitmask mip ${t}`,size:gi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));let t=[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}];this.brushBindGroupLayout=this.device.createBindGroupLayout({label:`Brush legacy bind group layout`,entries:t}),this.brushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Brush occupancy bind group layout`,entries:[...t,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.displayBindGroupLayout=this.device.createBindGroupLayout({label:`Display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.rasterStrokeDisplayScreenBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia display screen bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.rasterStrokeDisplaySourceBindGroupLayout=this.device.createBindGroupLayout({label:`Traccia direct LOD 0 and coarse mip display source layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`read-only-storage`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:8,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:9,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:10,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.rasterStrokeDisplayScreenBindGroup=this.device.createBindGroup({label:`Traccia display screen bind group`,layout:this.rasterStrokeDisplayScreenBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}}]}),this.lightGlazeDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze live display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}}]}),this.thicknessTailDisplayBindGroupLayout=this.device.createBindGroupLayout({label:`Predictive thickness tail display bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]});let n=[...t,{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:7,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}];this.grainBrushBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain brush bind group layout`,entries:n}),this.grainBrushOccupancyBindGroupLayout=this.device.createBindGroupLayout({label:`Texturized grain occupancy brush bind group layout`,entries:[...n,{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeMipBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze composited mip 1 bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.lightGlazeCompositeBindGroupLayout=this.device.createBindGroupLayout({label:`Light Glaze final composite bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),this.paintMipDownsampleBindGroupLayout=this.device.createBindGroupLayout({label:`Paint display mip downsample bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}}]}),this.rebuildShapeBrushBindGroups(),this.rebuildGrainBrushBindGroups(),await this.finishStaticResourceCreation()}rebuildShapeBrushBindGroups(){this.brushBindGroup=this.device.createBindGroup({label:`Brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.brushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]})),this.thicknessTailBrushBindGroup=this.device.createBindGroup({label:`Predictive thickness tail brush legacy bind group`,layout:this.brushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler}]}),this.thicknessTailBrushOccupancyBindGroups=this.shapeOccupancyUniformBuffers.map((e,t)=>this.device.createBindGroup({label:`Predictive thickness tail brush occupancy bind group mip ${t}`,layout:this.brushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:e}}]}))}rebuildGrainBrushBindGroups(){let e=[`no`,`classic`,`improved`],t=[`fixed`,`moving`];this.grainBrushBindGroups=Object.fromEntries(t.map(t=>[t,Object.fromEntries(e.map(e=>[e,this.device.createBindGroup({label:`Texturized M1 ${t} brush bind group ${e}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[t][e]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.grainBrushOccupancyBindGroups=Object.fromEntries(t.map(t=>[t,Object.fromEntries(e.map(e=>[e,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Texturized M1 ${t} occupancy bind group ${e} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.brushUniformBuffer}},{binding:1,resource:{buffer:this.instanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[t][e]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))])),this.thicknessTailGrainBrushBindGroups=Object.fromEntries(t.map(t=>[t,Object.fromEntries(e.map(e=>[e,this.device.createBindGroup({label:`Predictive thickness tail ${t} grain bind group ${e}`,layout:this.grainBrushBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[t][e]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]})]))])),this.thicknessTailGrainBrushOccupancyBindGroups=Object.fromEntries(t.map(t=>[t,Object.fromEntries(e.map(e=>[e,this.shapeOccupancyUniformBuffers.map((n,r)=>this.device.createBindGroup({label:`Predictive thickness tail ${t} grain occupancy ${e} mip ${r}`,layout:this.grainBrushOccupancyBindGroupLayout,entries:[{binding:0,resource:{buffer:this.thicknessTailBrushUniformBuffer}},{binding:1,resource:{buffer:this.thicknessTailInstanceBuffer}},{binding:2,resource:this.shapeMaskView},{binding:3,resource:this.shapeMaskSampler},{binding:4,resource:{buffer:n}},{binding:5,resource:this.grainTextureView},{binding:6,resource:this.grainSamplers[t][e]},{binding:7,resource:{buffer:this.grainUniformBuffer}}]}))]))]))}async finishStaticResourceCreation(){this.brushShaderModule=this.device.createShaderModule({label:`Brush WGSL`,code:ve}),this.texturizedGrainShaderModule=this.device.createShaderModule({label:`Texturized grain fragment WGSL`,code:ye}),this.displayShaderModule=this.device.createShaderModule({label:`Display WGSL`,code:xe}),this.rasterStrokeDisplayShaderModule=this.device.createShaderModule({label:`Traccia direct LOD 0 and coarse mip display WGSL`,code:nn(V,V)}),this.thicknessTailDisplayShaderModule=this.device.createShaderModule({label:`Predictive thickness tail display WGSL`,code:Se}),this.lightGlazeDisplayShaderModule=this.device.createShaderModule({label:`Light Glaze live display WGSL`,code:Ce}),this.lightGlazeCompositeMipShaderModule=this.device.createShaderModule({label:`Light Glaze composited mip 1 WGSL`,code:we}),this.lightGlazeCompositeShaderModule=this.device.createShaderModule({label:`Light Glaze final composite WGSL`,code:Te}),this.paintMipDownsampleShaderModule=this.device.createShaderModule({label:`Paint display mip downsample WGSL`,code:Ee}),await Promise.all([this.assertShaderCompiled(this.brushShaderModule,`brush`),this.assertShaderCompiled(this.texturizedGrainShaderModule,`Texturized grain fragment`),this.assertShaderCompiled(this.displayShaderModule,`display`),this.assertShaderCompiled(this.rasterStrokeDisplayShaderModule,`Traccia display`),this.assertShaderCompiled(this.thicknessTailDisplayShaderModule,`predictive thickness tail display`),this.assertShaderCompiled(this.lightGlazeDisplayShaderModule,`Light Glaze live display`),this.assertShaderCompiled(this.lightGlazeCompositeMipShaderModule,`Light Glaze composited mip 1`),this.assertShaderCompiled(this.lightGlazeCompositeShaderModule,`Light Glaze final composite`),this.assertShaderCompiled(this.paintMipDownsampleShaderModule,`paint display mip downsample`)]);let e=this.device.createPipelineLayout({label:`Display pipeline layout`,bindGroupLayouts:[this.displayBindGroupLayout]});this.displayPipeline=this.device.createRenderPipeline({label:`Display pipeline`,layout:e,vertex:{module:this.displayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.displayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let t=this.device.createPipelineLayout({label:`Traccia display pipeline layout`,bindGroupLayouts:[this.rasterStrokeDisplayScreenBindGroupLayout,this.rasterStrokeDisplaySourceBindGroupLayout]});this.rasterStrokeDisplayPipeline=this.device.createRenderPipeline({label:`Traccia direct LOD 0 and coarse mip display pipeline`,layout:t,vertex:{module:this.rasterStrokeDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.rasterStrokeDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let n=this.device.createPipelineLayout({label:`Predictive thickness tail display pipeline layout`,bindGroupLayouts:[this.thicknessTailDisplayBindGroupLayout]});this.thicknessTailDisplayPipeline=this.device.createRenderPipeline({label:`Predictive thickness tail display pipeline`,layout:n,vertex:{module:this.thicknessTailDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.thicknessTailDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}});let r=this.device.createPipelineLayout({label:`Light Glaze live display pipeline layout`,bindGroupLayouts:[this.lightGlazeDisplayBindGroupLayout]});this.lightGlazeDisplayPipeline=this.device.createRenderPipeline({label:`Light Glaze live display pipeline`,layout:r,vertex:{module:this.lightGlazeDisplayShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeDisplayShaderModule,entryPoint:`fragmentMain`,targets:[{format:this.canvasFormat}]},primitive:{topology:`triangle-list`}})}async createGrainTextureResources(){let e=await fetch(new URL(``+new URL(`graincottonfleece-P6Krz_AB.PNG`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Cotton Fleece M1 originale (${e.status}).`);let t=await e.arrayBuffer(),n=performance.now(),r=await createImageBitmap(new Blob([t],{type:`image/png`}),{colorSpaceConversion:`default`,premultiplyAlpha:`none`}),i=performance.now()-n;if(r.width!==ii||r.height!==ii)throw r.close(),Error(`Il grain M1 originale deve restare ${ii}×${ii}px; trovata ${r.width}×${r.height}px.`);let a=this.device.createTexture({label:`Cotton Fleece M1 original 2500 RGBA grain`,size:{width:ii,height:ii,depthOrArrayLayers:1},mipLevelCount:ai,format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),o=performance.now();this.device.queue.copyExternalImageToTexture({source:r},{texture:a,mipLevel:0,premultipliedAlpha:!1,colorSpace:`srgb`},{width:ii,height:ii,depthOrArrayLayers:1});let s=performance.now()-o;r.close();let c=performance.now(),l=this.device.createShaderModule({label:`Cotton Fleece M1 mip generation WGSL`,code:be});await this.assertShaderCompiled(l,`Cotton Fleece M1 mip generation`);let u=this.device.createBindGroupLayout({label:`Cotton Fleece M1 mip generation bind group layout`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),d=this.device.createRenderPipeline({label:`Cotton Fleece M1 mip generation pipeline`,layout:this.device.createPipelineLayout({label:`Cotton Fleece M1 mip generation pipeline layout`,bindGroupLayouts:[u]}),vertex:{module:l,entryPoint:`vertexMain`},fragment:{module:l,entryPoint:`fragmentMain`,targets:[{format:`rgba8unorm`}]},primitive:{topology:`triangle-list`}}),f=this.device.createSampler({label:`Cotton Fleece M1 mip generation linear sampler`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),p=this.device.createCommandEncoder({label:`Cotton Fleece M1 full mip chain encoder`});for(let e=1;e<ai;e+=1){let t=a.createView({label:`Cotton Fleece M1 mip ${e-1} source`,baseMipLevel:e-1,mipLevelCount:1}),n=a.createView({label:`Cotton Fleece M1 mip ${e} target`,baseMipLevel:e,mipLevelCount:1}),r=this.device.createBindGroup({label:`Cotton Fleece M1 mip ${e} bind group`,layout:u,entries:[{binding:0,resource:t},{binding:1,resource:f}]}),i=p.beginRenderPass({label:`Cotton Fleece M1 build mip ${e}`,colorAttachments:[{view:n,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});i.setPipeline(d),i.setBindGroup(0,r),i.draw(3,1,0,0),i.end()}this.device.queue.submit([p.finish()]),await this.device.queue.onSubmittedWorkDone();let m=performance.now()-c;return{texture:a,identity:Ai(new Uint8Array(t)),decodeMs:i,mipBuildMs:m,uploadMs:s}}async decodeShapeMaskWithCanvas(e){let t=await createImageBitmap(new Blob([e],{type:`image/png`}),{colorSpaceConversion:`none`,premultiplyAlpha:`none`});try{if(t.width!==U||t.height!==U)throw Error(`Shape.png deve restare ${U}×${U}px; trovata ${t.width}×${t.height}px.`);let e=document.createElement(`canvas`);e.width=U,e.height=U;let n=e.getContext(`2d`,{willReadFrequently:!0});if(!n)throw Error(`Impossibile leggere la maschera Shape.png.`);n.drawImage(t,0,0);let r=n.getImageData(0,0,U,U).data,i=new Uint8Array(U*U);for(let e=0,t=0;e<i.length;e+=1,t+=4){let n=Math.round(r[t]*.2126+r[t+1]*.7152+r[t+2]*.0722);i[e]=Math.round(n*r[t+3]/255)}return i}finally{t.close()}}async createShapeMaskResources(){let e=await fetch(new URL(``+new URL(`Shape-BcXQOKCm.png`,import.meta.url).href,``+import.meta.url));if(!e.ok)throw Error(`Impossibile caricare Shape.png (${e.status}).`);let t=await e.arrayBuffer(),n,r;try{let e=await s(t);if(e.width!==U||e.height!==U)throw Error(`Shape.png deve restare ${U}×${U}px; trovata ${e.width}×${e.height}px.`);n=e.pixels,r=tr}catch{n=await this.decodeShapeMaskWithCanvas(t),r=nr}let i=Math.log2(U)+1,a=this.device.createTexture({label:`Shape 2K white-times-alpha mask`,size:{width:U,height:U,depthOrArrayLayers:1},mipLevelCount:i,format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),o=n,c=U,l=[];for(let e=0;e<i;e+=1){e<=fi&&l.push(o);let t=Math.ceil(c/256)*256,n=o;if(t!==c){n=new Uint8Array(t*c);for(let e=0;e<c;e+=1)n.set(o.subarray(e*c,(e+1)*c),e*t)}if(this.device.queue.writeTexture({texture:a,mipLevel:e},n,{offset:0,bytesPerRow:t,rowsPerImage:c},{width:c,height:c,depthOrArrayLayers:1}),c===1)continue;let r=c/2,i=new Uint8Array(r*r);for(let e=0;e<r;e+=1)for(let t=0;t<r;t+=1){let n=e*2*c+t*2;i[e*r+t]=Math.round((o[n]+o[n+1]+o[n+c]+o[n+c+1])/4)}o=i,c=r}let u=Ri(l),d=l[fi],f=document.createElement(`canvas`);f.width=128,f.height=128;let p=f.getContext(`2d`);if(p&&d){let e=p.createImageData(128,128);for(let t=0;t<d.length;t+=1){let n=t*4;e.data[n]=255,e.data[n+1]=255,e.data[n+2]=255,e.data[n+3]=d[t]}p.putImageData(e,0,0)}return{texture:a,decodeStrategy:r,identity:Ai(n),occupancyWords:u.words,occupancyActiveCells:u.activeCells,occupancyCoverageRatios:u.coverageRatios,previewSprite:f}}async recreateLayerResources(e){let t=this.layerTexture,n=this.blendRenderer,r=this.device.createTexture({label:`4096² paint layer ${e}`,size:{width:V,height:V,depthOrArrayLayers:1},mipLevelCount:Wn,format:e,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}),i=r.createView({label:`Paint layer authoritative mip 0 ${e}`,baseMipLevel:0,mipLevelCount:1}),a=r.createView({label:`Paint layer display mip chain ${e}`,baseMipLevel:0,mipLevelCount:Wn}),o=Array.from({length:Wn},(t,n)=>r.createView({label:`Paint layer mip ${n} ${e}`,baseMipLevel:n,mipLevelCount:1})),s=this.device.createPipelineLayout({label:`Brush legacy pipeline layout ${e}`,bindGroupLayouts:[this.brushBindGroupLayout]}),c=this.device.createPipelineLayout({label:`Brush occupancy pipeline layout ${e}`,bindGroupLayouts:[this.brushOccupancyBindGroupLayout]}),l=this.device.createPipelineLayout({label:`Texturized grain brush pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushBindGroupLayout]}),u=this.device.createPipelineLayout({label:`Texturized grain occupancy pipeline layout ${e}`,bindGroupLayouts:[this.grainBrushOccupancyBindGroupLayout]}),d=this.device.createPipelineLayout({label:`Paint display mip downsample pipeline layout ${e}`,bindGroupLayouts:[this.paintMipDownsampleBindGroupLayout]}),f=this.device.createPipelineLayout({label:`Light Glaze composited mip 1 pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeMipBindGroupLayout]}),p=this.device.createPipelineLayout({label:`Light Glaze final composite pipeline layout ${e}`,bindGroupLayouts:[this.lightGlazeCompositeBindGroupLayout]});this.device.pushErrorScope(`validation`);let m=this.device.createRenderPipeline({label:`Brush normal ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),h=this.device.createRenderPipeline({label:`Brush additive ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),g=this.device.createRenderPipeline({label:`Brush shape 2K legacy normal ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),_=this.device.createRenderPipeline({label:`Brush shape 2K legacy additive ${e}`,layout:s,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),v=this.device.createRenderPipeline({label:`Brush shape 2K occupancy normal ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),y=this.device.createRenderPipeline({label:`Brush shape 2K occupancy additive ${e}`,layout:c,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.brushShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),b=this.device.createRenderPipeline({label:`Brush Texturized grain normal ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),x=this.device.createRenderPipeline({label:`Brush Texturized grain additive ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`vertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),S=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain normal ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),C=this.device.createRenderPipeline({label:`Brush Shape 2K Texturized grain additive ${e}`,layout:l,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),w=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain normal ${e}`,layout:u,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),T=this.device.createRenderPipeline({label:`Brush Shape 2K occupancy Texturized grain additive ${e}`,layout:u,vertex:{module:this.brushShaderModule,entryPoint:`shapeVertexMain`},fragment:{module:this.texturizedGrainShaderModule,entryPoint:`shapeOccupancyFragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}}),E=(e,t,n,r,i)=>this.device.createRenderPipeline({label:e,layout:t,vertex:{module:this.brushShaderModule,entryPoint:r},fragment:{module:n,entryPoint:i,targets:[{format:`r8unorm`,blend:{color:{operation:`max`,srcFactor:`one`,dstFactor:`one`},alpha:{operation:`max`,srcFactor:`one`,dstFactor:`one`}}}]},primitive:{topology:`triangle-strip`}}),ee=E(`Brush M1 Glaze circle MAX coverage r8unorm`,s,this.brushShaderModule,`vertexMain`,`coverageFragmentMain`),D=E(`Brush M1 Glaze Shape MAX coverage r8unorm`,s,this.brushShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),O=E(`Brush M1 Glaze Shape occupancy MAX coverage r8unorm`,c,this.brushShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),k=E(`Brush M1 Glaze Texturized circle MAX coverage r8unorm`,l,this.texturizedGrainShaderModule,`vertexMain`,`coverageFragmentMain`),A=E(`Brush M1 Glaze Texturized Shape MAX coverage r8unorm`,l,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeCoverageFragmentMain`),te=E(`Brush M1 Glaze Texturized Shape occupancy MAX coverage r8unorm`,u,this.texturizedGrainShaderModule,`shapeVertexMain`,`shapeOccupancyCoverageFragmentMain`),ne=this.device.createRenderPipeline({label:`Light Glaze composited mip 1 ${e}`,layout:f,vertex:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeMipShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),j=this.device.createRenderPipeline({label:`Light Glaze final source-over composite ${e}`,layout:p,vertex:{module:this.lightGlazeCompositeShaderModule,entryPoint:`vertexMain`},fragment:{module:this.lightGlazeCompositeShaderModule,entryPoint:`fragmentMain`,targets:[{format:e,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-list`}}),M=this.device.createRenderPipeline({label:`Paint display mip downsample ${e}`,layout:d,vertex:{module:this.paintMipDownsampleShaderModule,entryPoint:`vertexMain`},fragment:{module:this.paintMipDownsampleShaderModule,entryPoint:`fragmentMain`,targets:[{format:e}]},primitive:{topology:`triangle-list`}}),N=await this.device.popErrorScope();if(N)throw r.destroy(),Error(N.message);let P=this.device.createBindGroup({label:`Display bind group ${e}`,layout:this.displayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:a},{binding:2,resource:this.sampler}]}),re=o.slice(0,Wn-1).map((t,n)=>this.device.createBindGroup({label:`Paint display mip ${n} to ${n+1} ${e}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:t}]})),ie;try{ie=await _e.create({device:this.device,documentWidth:V,documentHeight:V,layerFormat:e,layerView:i,layerSamplingView:a,shapeMaskView:this.shapeMaskView,shapeMaskSampler:this.shapeMaskSampler,grainTextureView:this.grainTextureView,grainSamplers:this.grainSamplers})}catch(e){throw r.destroy(),e}this.destroyLightGlazeResources(),this.destroyThicknessTailOverlayResources(),this.layerTexture=r,this.layerView=i,this.layerSamplingView=a,this.blendRenderer=ie,this.paintMipViews=o,this.paintMipDownsampleBindGroups=re,this.normalPipeline=m,this.additivePipeline=h,this.shapeNormalPipeline=g,this.shapeAdditivePipeline=_,this.shapeOccupancyNormalPipeline=v,this.shapeOccupancyAdditivePipeline=y,this.grainNormalPipeline=b,this.grainAdditivePipeline=x,this.grainShapeNormalPipeline=S,this.grainShapeAdditivePipeline=C,this.grainShapeOccupancyNormalPipeline=w,this.grainShapeOccupancyAdditivePipeline=T,this.m1GlazePipeline=ee,this.m1GlazeShapePipeline=D,this.m1GlazeShapeOccupancyPipeline=O,this.grainM1GlazePipeline=k,this.grainM1GlazeShapePipeline=A,this.grainM1GlazeShapeOccupancyPipeline=te,this.lightGlazeCompositeMipPipeline=ne,this.lightGlazeCompositePipeline=j,this.paintMipDownsamplePipeline=M,this.displayBindGroup=P,this.layerFormat=e,this.writeLightGlazeUniforms(1,`source-over`,null),this.paintDisplayMipValidThroughLevel=0,this.paintDisplaySelectedMipLevel=0,this.presentationCacheNeedsFullRebuild=!0,this.releaseRasterStrokeRenderer(),this.releaseRasterBevelRenderer(),n?.destroy(),t?.destroy()}ensureThicknessTailOverlayResources(e,n){let r=t(Math.ceil(Math.max(1,e)/Pr)*Pr,Pr,Fr),i=t(Math.ceil(Math.max(1,n)/Pr)*Pr,Pr,Fr);if(this.thicknessTailTexture&&this.thicknessTailView&&this.thicknessTailDisplayBindGroup&&this.thicknessTailTextureWidth>=r&&this.thicknessTailTextureHeight>=i)return;let a=Math.max(this.thicknessTailTextureWidth,r),o=Math.max(this.thicknessTailTextureHeight,i),s=this.device.createTexture({label:`Predictive thickness tail ${a}×${o} ${this.layerFormat}`,size:{width:a,height:o,depthOrArrayLayers:1},format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),c=s.createView({label:`Predictive thickness tail view`}),l=this.device.createBindGroup({label:`Predictive thickness tail display bind group`,layout:this.thicknessTailDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:this.sampler},{binding:3,resource:c},{binding:4,resource:{buffer:this.thicknessTailDisplayUniformBuffer}}]}),u=this.thicknessTailTexture;this.thicknessTailTexture=s,this.thicknessTailView=c,this.thicknessTailDisplayBindGroup=l,this.thicknessTailTextureWidth=a,this.thicknessTailTextureHeight=o,this.rasterStrokeRenderer?.setThicknessTailView(c),this.rasterBevelRenderer?.setThicknessTailView(c),this.rebuildRasterStrokeDisplayBindGroups(),u?.destroy()}destroyThicknessTailOverlayResources(){this.rasterStrokeRenderer?.setThicknessTailView(null),this.rasterBevelRenderer?.setThicknessTailView(null),this.rebuildRasterStrokeDisplayBindGroups(),this.thicknessTailTexture?.destroy(),this.thicknessTailTexture=null,this.thicknessTailView=null,this.thicknessTailDisplayBindGroup=null,this.thicknessTailTextureWidth=0,this.thicknessTailTextureHeight=0,this.thicknessTailPresentedRect=null}ensureLightGlazeResources(e){let t=e===`m1-glaze`?`r8-coverage`:`rgba-stroke`;if(this.lightGlazeTexture&&this.lightGlazeCompositeMipTexture&&this.lightGlazeView&&this.lightGlazeSamplingView&&this.lightGlazeCompositeMipBindGroup&&this.lightGlazeDisplayBindGroup&&this.lightGlazeCompositeBindGroup&&this.lightGlazeStorageMode===t)return;(this.lightGlazeTexture||this.lightGlazeCompositeMipTexture)&&this.destroyLightGlazeResources();let n=t===`r8-coverage`?`r8unorm`:this.layerFormat,r=this.device.createTexture({label:`Lazy Light Glaze stroke accumulator ${n}`,size:{width:V,height:V,depthOrArrayLayers:1},format:n,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),i=this.device.createTexture({label:`Lazy Light Glaze composited logical mip 1+ ${this.layerFormat}`,size:{width:2048,height:2048,depthOrArrayLayers:1},mipLevelCount:Wn-1,format:this.layerFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),a=r.createView({label:`Light Glaze authoritative stroke mip 0`}),o=i.createView({label:`Light Glaze final-composite logical mip 1+ sampling chain`,baseMipLevel:0,mipLevelCount:Wn-1}),s=Array.from({length:Wn-1},(e,t)=>i.createView({label:`Light Glaze final-composite logical mip ${t+1}`,baseMipLevel:t,mipLevelCount:1})),c=s.slice(0,-1).map((e,t)=>this.device.createBindGroup({label:`Light Glaze logical mip ${t+1} to ${t+2}`,layout:this.paintMipDownsampleBindGroupLayout,entries:[{binding:0,resource:e}]})),l=this.device.createBindGroup({label:`Light Glaze permanent + stroke to composited logical mip 1`,layout:this.lightGlazeCompositeMipBindGroupLayout,entries:[{binding:0,resource:this.layerView},{binding:1,resource:a},{binding:2,resource:{buffer:this.lightGlazeUniformBuffer}}]}),u=this.device.createBindGroup({label:`Light Glaze live display bind group`,layout:this.lightGlazeDisplayBindGroupLayout,entries:[{binding:0,resource:{buffer:this.displayUniformBuffer}},{binding:1,resource:this.layerSamplingView},{binding:2,resource:a},{binding:3,resource:this.sampler},{binding:4,resource:{buffer:this.lightGlazeUniformBuffer}},{binding:5,resource:o}]}),d=this.device.createBindGroup({label:`Light Glaze final composite bind group`,layout:this.lightGlazeCompositeBindGroupLayout,entries:[{binding:0,resource:a},{binding:1,resource:{buffer:this.lightGlazeUniformBuffer}}]});this.lightGlazeTexture=r,this.lightGlazeCompositeMipTexture=i,this.lightGlazeView=a,this.lightGlazeSamplingView=o,this.lightGlazeMipViews=[a,...s],this.lightGlazeMipDownsampleBindGroups=c,this.lightGlazeCompositeMipBindGroup=l,this.lightGlazeDisplayBindGroup=u,this.lightGlazeCompositeBindGroup=d,this.lightGlazeStorageAllocated=!0,this.lightGlazeStorageMode=t,this.rasterStrokeRenderer?.setLightGlazeView(a),this.rasterBevelRenderer?.setLightGlazeView(a),this.rebuildRasterStrokeDisplayBindGroups()}destroyLightGlazeResources(){this.rasterStrokeRenderer?.setLightGlazeView(null),this.rasterBevelRenderer?.setLightGlazeView(null),this.rebuildRasterStrokeDisplayBindGroups(),this.lightGlazeSession=null,this.lightGlazeTexture?.destroy(),this.lightGlazeCompositeMipTexture?.destroy(),this.lightGlazeTexture=null,this.lightGlazeCompositeMipTexture=null,this.lightGlazeView=null,this.lightGlazeSamplingView=null,this.lightGlazeMipViews=[],this.lightGlazeMipDownsampleBindGroups=[],this.lightGlazeCompositeMipBindGroup=null,this.lightGlazeDisplayBindGroup=null,this.lightGlazeCompositeBindGroup=null,this.lightGlazeStorageAllocated=!1,this.lightGlazeStorageMode=`none`}startLightGlazeSession(e,n){if(this.lightGlazeSession)throw Error(`Un tratto Light Glaze precedente non è ancora stato finalizzato.`);this.ensureLightGlazeResources(n.blendMode),this.lightGlazeSession={historyActionId:e,settings:{...n,opacity:Number.isFinite(n.opacity)?t(n.opacity,0,1):1,blendMode:n.blendMode===`m1-glaze`?`m1-glaze`:`light-glaze`},dirtyRect:null,needsClear:!0,hasContent:!1,endRequested:!1,commitRequested:!1,mipValidThroughLevel:0,tintLinear:null}}abandonLightGlazeSession(){this.lightGlazeSession&&(this.lightGlazeSession=null,this.presentationCacheNeedsFullRebuild=!0,this.deferRasterStrokeMutation(!1))}flushClosingLightGlazeSessionBeforeNewStroke(){if(!this.lightGlazeSession?.endRequested)return;let e=0,t=Math.ceil(this.pendingStamps.length/Kn)+2;for(;this.lightGlazeSession?.endRequested;)if(this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null),this.renderFrame(performance.now()),e+=1,e>t)throw Error(`Impossibile finalizzare il tratto Light Glaze precedente.`)}flushPendingWorkBeforeSettingsChange(){if(!this.initialized||this.activeStroke||this.historyBusy||(this.flushClosingLightGlazeSessionBeforeNewStroke(),this.lightGlazeSession||this.pendingStamps.length===0&&this.pendingBlendBatches.length===0))return;let e=0,t=Math.ceil(this.pendingStamps.length/Kn)+this.pendingBlendBatches.length+2;for(;this.pendingStamps.length>0||this.pendingBlendBatches.length>0;){this.frameRequest!==null&&(cancelAnimationFrame(this.frameRequest),this.frameRequest=null);let n=this.pendingStamps.length+this.pendingBlendBatches.length;if(this.renderFrame(performance.now()),e+=1,this.pendingStamps.length+this.pendingBlendBatches.length>=n||e>t)throw Error(`Impossibile finalizzare gli stamp prima del cambio impostazioni.`)}}writeLightGlazeUniforms(e,n,r){let i=new ArrayBuffer(bi),a=new Float32Array(i),o=new Uint32Array(i);a[0]=Number.isFinite(e)?t(e,0,1):1,o[1]=+(this.layerFormat===`rgba16float`),o[2]=+(n===`m1-max-coverage`),a[4]=r?.[0]??0,a[5]=r?.[1]??0,a[6]=r?.[2]??0,a[7]=1,this.device.queue.writeBuffer(this.lightGlazeUniformBuffer,0,i)}mergeDirtyRects(e,t){if(!e)return t?{...t}:null;if(!t)return{...e};let n=Math.min(e.x,t.x),r=Math.min(e.y,t.y),i=Math.max(e.x+e.width,t.x+t.width),a=Math.max(e.y+e.height,t.y+t.height);return{x:n,y:r,width:i-n,height:a-r}}rasterStrokeEffectRect(e,t=this.rasterStrokeStyle.width){if(!e)return null;let n=Math.ceil(Math.max(0,t)+1.5),r=Math.max(0,Math.floor(e.x)-n),i=Math.max(0,Math.floor(e.y)-n),a=Math.min(V,Math.ceil(e.x+e.width)+n),o=Math.min(V,Math.ceil(e.y+e.height)+n);return a>r&&o>i?{x:r,y:i,width:a-r,height:o-i}:null}rasterBevelEffectRect(e,t=this.rasterBevelStyle){return _t(e,t,V,V)}rasterBevelInfluenceRect(e,t=this.rasterBevelStyle){return vt(e,t,V,V)}noteLayerMutation(e,t){t&&(this.layerContentBounds=null,this.rasterStrokeCoverageValid=!1,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null),e&&(this.layerContentBounds=this.mergeDirtyRects(this.layerContentBounds,e)),this.rasterStrokeActive()||(this.rasterStrokeCoverageValid=!1)}deferRasterStrokeMutation(e){this.rasterStrokeCoverageValid=!1,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null,e&&(this.rasterStrokeStyledInitialized=!1,this.rasterStrokeMipValidThroughLevel=0)}encodeRasterStrokeUpdate(e,t,n,r=this.layerContentBounds,i=!1){let a=this.rasterStrokeRenderer;if(!a||!this.styleStackActive())return(n||i)&&(this.rasterStrokeCoverageValid=!1,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null),{dirtyRect:n,timing:null};i&&(this.rasterStrokeCoverageValid=!1,this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null,this.rasterStrokeMipValidThroughLevel=0);let o=i||!this.rasterStrokeStyledInitialized,s=null,c=this.rasterBevelActive();if(c){let i=this.rasterBevelRenderer,a=this.rasterBevelHeightSourceMode!==t,o=!this.rasterBevelHeightValid||a,c=o?this.rasterBevelInfluenceRect(r):n?this.rasterBevelInfluenceRect(n):null,l=i.encode({encoder:e,style:this.rasterBevelStyle,sourceMode:t,rebuildRect:c,changeDetectionRect:o?null:n,clearHeight:o});this.rasterBevelLastEncode=l,this.rasterBevelHeightValid=!0,this.rasterBevelHeightSourceMode=t,(l.jobs>0||l.cleared)&&(this.rasterBevelTotalBuilds+=1,this.rasterBevelTotalPasses+=l.passes),s=this.mergeDirtyRects(s,c)}else this.rasterBevelHeightValid=!1,this.rasterBevelHeightSourceMode=null;s=this.mergeDirtyRects(s,this.rasterBevelPendingComposeRect);let l=this.rasterStrokeActive(),u=l&&this.rasterStrokeCoverageValid,d=null,f=null,p=null;l?u?n&&(d=this.rasterStrokeEffectRect(n,this.rasterStrokeStyle.width),f=n,s=this.mergeDirtyRects(s,n),p=d):(d=this.mergeDirtyRects(this.rasterStrokeEffectRect(r,this.rasterStrokeStyle.width),this.rasterStrokePendingComposeRect),s=this.mergeDirtyRects(s,d)):this.rasterStrokeCoverageValid=!1,s=this.mergeDirtyRects(s,this.rasterStrokePendingComposeRect),n&&!c&&!l&&(s=this.mergeDirtyRects(s,n));let m=a.encode({encoder:e,style:this.rasterStrokeStyle,bevelStyle:this.rasterBevelStyle,sourceMode:t,rebuildRect:d,changeDetectionRect:f,composeRect:s,conditionalComposeRect:p,clearStyled:o,resetThresholdMask:l&&!u});return this.rasterStrokeLastEncode=m,this.rasterStrokeStyledInitialized=!0,this.rasterStrokePendingComposeRect=null,this.rasterBevelPendingComposeRect=null,o&&(this.rasterStrokeMipValidThroughLevel=0),l&&(d||!r)&&(this.rasterStrokeCoverageValid=!0),m.buildJobs>0&&(this.rasterStrokeTotalBuilds+=1),(m.composeDispatches>0||m.cleared)&&(this.rasterStrokeTotalComposes+=1),{dirtyRect:o?{x:0,y:0,width:V,height:V}:this.mergeDirtyRects(s,p),timing:m}}encodeRasterStrokeDisplayPyramid(e,t,n){let r=this.rasterStrokeRenderer;if(!r||!this.styleStackActive())return{passes:0,updatedPixels:0};let i=this.rasterStrokeMipValidThroughLevel,a=t!==null,o=t?this.downsampleDirtyRect(t,1):null,s=0,c=0;for(let t=2;t<=n;t+=1){let n=this.paintMipDimensions(t),a=t>i,l=a?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null;if(!l||l.width<=0||l.height<=0){o=null;continue}let u=e.beginRenderPass({label:a?`Build full Traccia styled logical mip ${t}`:`Update Traccia styled logical mip ${t} dirty rect`,colorAttachments:[{view:r.mipViews[t-1],loadOp:a?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});u.setPipeline(this.paintMipDownsamplePipeline),u.setBindGroup(0,this.rasterStrokeMipDownsampleBindGroups[t-2]),a||u.setScissorRect(l.x,l.y,l.width,l.height),u.draw(3,1,0,0),u.end(),s+=1,c+=l.width*l.height,o=l}return a?this.rasterStrokeMipValidThroughLevel=Math.max(1,n):n>i&&(this.rasterStrokeMipValidThroughLevel=n),{passes:s,updatedPixels:c}}encodeLightGlazeDisplayPyramid(e,t,n,r){let i=t.mipValidThroughLevel,a=n!==null,o=n,s=0,c=0;for(let t=1;t<=r;t+=1){let n=this.paintMipDimensions(t),r=t>i,a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null;if(!a||a.width<=0||a.height<=0)continue;let l=e.beginRenderPass({label:r?`Build full Light Glaze final-composite mip ${t}`:`Update Light Glaze final-composite mip ${t} dirty rect`,colorAttachments:[{view:this.lightGlazeMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});t===1?(l.setPipeline(this.lightGlazeCompositeMipPipeline),l.setBindGroup(0,this.lightGlazeCompositeMipBindGroup)):(l.setPipeline(this.paintMipDownsamplePipeline),l.setBindGroup(0,this.lightGlazeMipDownsampleBindGroups[t-2])),r||l.setScissorRect(a.x,a.y,a.width,a.height),l.draw(3,1,0,0),l.end(),s+=1,c+=a.width*a.height,o=a}return(a||r>i)&&(t.mipValidThroughLevel=r),{passes:s,updatedPixels:c}}isTexturizedGrainActive(e){return(e.grainMode===`texturized`||e.grainMode===`moving`)&&e.grainBlendMode===`multiply`&&e.grainDepth>0}grainCoordinateMode(e){return e.grainMode===`moving`?`moving`:`fixed`}grainStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?fr:dr:ur}grainCoordinateStrategy(e){return this.isTexturizedGrainActive(e)?e.grainMode===`moving`?mr:pr:`none`}grainSamplingStrategy(e){if(!this.isTexturizedGrainActive(e))return`none`;let t=e.grainMode===`moving`;return e.grainFiltering===`no`?t?`clamp-nearest`:`repeat-nearest`:e.grainFiltering===`classic`?t?`clamp-linear-mip-nearest`:`repeat-linear-mip-nearest`:t?`clamp-linear-trilinear`:`repeat-linear-trilinear`}writeGrainUniforms(e){let n=this.grainUniformUpload,r=new Uint32Array(n.buffer);n.fill(0);let i=t(e.grainScale,.1,4),a=e.grainInvert?-1:1;n[0]=1/(ii*i),n[1]=t(e.grainDepth,0,1),n[2]=t(e.grainBrightness,-1,1)*a,n[3]=(1+t(e.grainContrast,-1,1))*a,r[4]=e.grainFiltering===`no`?0:e.grainFiltering===`classic`?1:2,r[5]=+(e.grainMode===`moving`),this.device.queue.writeBuffer(this.grainUniformBuffer,0,n)}populateBrushUniformUpload(n,r,i,a,o,s){let c=new Float32Array(n),l=new Uint32Array(n);c.fill(0);let[u,d,f]=e(r.color),p=r.jitterMaster;c[0]=i,c[1]=a,c[2]=o,c[3]=s,c[4]=u,c[5]=d,c[6]=f,c[7]=Number.isFinite(r.opacity)?t(r.opacity,0,1):1,c[8]=r.hueJitterDegrees/360*p,c[9]=r.saturationJitter*p,c[10]=r.lightnessJitter*p,c[11]=r.darknessJitter*p,c[12]=r.flow,c[13]=r.hardness,c[14]=r.blendIntensity,c[15]=0,c[16]=r.positionJitterLinear,c[17]=r.positionJitterLateral,c[18]=r.shapeScatter,l[20]=r.count>>>0,l[21]=+!!r.jitterPerCopy,l[22]=+(r.blendMode===`additive`),l[23]=0}writeBrushUniforms(e=this.settings){this.populateBrushUniformUpload(this.brushUniformUpload,e,V,V,0,0),this.device.queue.writeBuffer(this.brushUniformBuffer,0,this.brushUniformUpload)}writeThicknessTailBrushUniforms(e,t,n,r,i){this.populateBrushUniformUpload(this.thicknessTailBrushUniformUpload,e,t,n,r,i),this.device.queue.writeBuffer(this.thicknessTailBrushUniformBuffer,0,this.thicknessTailBrushUniformUpload)}desiredPaintDisplayMipLevel(){return!Number.isFinite(this.zoom)||this.zoom>=1?0:t(Math.floor(Math.log2(1/Math.max(this.zoom,2**-52))+1e-6),0,Wn-1)}paintMipDimensions(e){let t=Math.max(1,V>>e);return{width:t,height:t}}downsampleDirtyRect(e,t){let{width:n,height:r}=this.paintMipDimensions(t),i=Math.max(0,Math.floor(e.x/2)),a=Math.max(0,Math.floor(e.y/2)),o=Math.min(n,Math.ceil((e.x+e.width)/2)),s=Math.min(r,Math.ceil((e.y+e.height)/2));return{x:i,y:a,width:Math.max(0,o-i),height:Math.max(0,s-a)}}encodePaintDisplayPyramid(e,t,n){let r=performance.now(),i=this.paintDisplayMipValidThroughLevel,a=t!==null,o=t,s=0,c=0,l=0,u=0;for(let t=1;t<=n;t+=1){let n=this.paintMipDimensions(t),r=t>i,a;if(a=r?{x:0,y:0,...n}:o?this.downsampleDirtyRect(o,t):null,!a||a.width<=0||a.height<=0)continue;let d=e.beginRenderPass({label:r?`Build full paint display mip ${t}`:`Update paint display mip ${t} dirty rect`,colorAttachments:[{view:this.paintMipViews[t],loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});d.setPipeline(this.paintMipDownsamplePipeline),d.setBindGroup(0,this.paintMipDownsampleBindGroups[t-1]),r||d.setScissorRect(a.x,a.y,a.width,a.height),d.draw(3,1,0,0),d.end(),l+=1,u+=a.width*a.height,r?s+=1:c+=1,o=a}return(a||n>i)&&(this.paintDisplayMipValidThroughLevel=n),{maintenanceFrames:+(l>0),fullLevelBuilds:s,dirtyLevelUpdates:c,passes:l,baseDirtyPixels:t?t.width*t.height:0,updatedPixels:u,encodingMs:l>0?performance.now()-r:0}}writeDisplayUniforms(e=this.paintDisplaySelectedMipLevel){this.displayUniformUpload[0]=this.canvas.width,this.displayUniformUpload[1]=this.canvas.height,this.displayUniformUpload[2]=V,this.displayUniformUpload[3]=V,this.displayUniformUpload[4]=this.viewCenterX,this.displayUniformUpload[5]=this.viewCenterY,this.displayUniformUpload[6]=this.zoom,this.displayUniformUpload[7]=96,this.displayUniformUpload[8]=e,this.device.queue.writeBuffer(this.displayUniformBuffer,0,this.displayUniformUpload)}writeThicknessTailDisplayUniforms(e,t,n){let r=new Float32Array(this.thicknessTailDisplayUniformUpload),i=new Uint32Array(this.thicknessTailDisplayUniformUpload);r.fill(0),r[0]=e,r[1]=t,r[2]=this.thicknessTailTextureWidth,r[3]=this.thicknessTailTextureHeight,i[4]=+(n.blendMode===`additive`),this.device.queue.writeBuffer(this.thicknessTailDisplayUniformBuffer,0,this.thicknessTailDisplayUniformUpload)}ensurePresentationCacheTexture(){let e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);if(this.presentationCacheTexture&&this.presentationCacheView&&this.presentationCacheWidth===e&&this.presentationCacheHeight===t)return;let n=this.presentationCacheTexture,r=this.device.createTexture({label:`Persistent presentation cache ${e}×${t}`,size:{width:e,height:t,depthOrArrayLayers:1},format:this.canvasFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});this.presentationCacheTexture=r,this.presentationCacheView=r.createView({label:`Persistent presentation cache view`}),this.presentationCacheWidth=e,this.presentationCacheHeight=t,this.presentationCacheNeedsFullRebuild=!0,n?.destroy()}layerDirtyRectToPresentationRect(e,t){let n=this.canvas.width,r=this.canvas.height;if(n<=0||r<=0)return null;let i=Math.max(2,2**(t+1)),a=e.x-i,o=e.y-i,s=e.x+e.width+i,c=e.y+e.height+i,l=(a-this.viewCenterX)*this.zoom+n*.5,u=(o-this.viewCenterY)*this.zoom+r*.5,d=(s-this.viewCenterX)*this.zoom+n*.5,f=(c-this.viewCenterY)*this.zoom+r*.5,p=Math.max(0,Math.floor(Math.min(l,d))-1),m=Math.max(0,Math.floor(Math.min(u,f))-1),h=Math.min(n,Math.ceil(Math.max(l,d))+1),g=Math.min(r,Math.ceil(Math.max(u,f))+1),_=Math.max(0,h-p),v=Math.max(0,g-m);return _>0&&v>0?{x:p,y:m,width:_,height:v}:null}toLayerPoint(e){let n=this.clientToLayer(e.clientX,e.clientY);return{x:n.x,y:n.y,pressure:t(e.pressure,.01,1),timeMs:Number.isFinite(e.timeMs)?e.timeMs:performance.now()}}clientToCanvasPixels(e,t){let n=this.canvas.getBoundingClientRect();return{x:(e-n.left)/Math.max(1,n.width)*this.canvas.width,y:(t-n.top)/Math.max(1,n.height)*this.canvas.height}}clientToLayer(e,t){let n=this.clientToCanvasPixels(e,t);return{x:this.viewCenterX+(n.x-this.canvas.width*.5)/this.zoom,y:this.viewCenterY+(n.y-this.canvas.height*.5)/this.zoom}}appendPoint(e){let n=this.activeStrokeProfile?performance.now():0,r=this.activeStroke;if(!r)return;if(r.tool===`blend`){let t={...e,timeMs:Math.max(r.lastInput.timeMs,Number.isFinite(e.timeMs)?e.timeMs:r.lastInput.timeMs)},i=r.blendPlanner?.pushSample(t);if(i&&!i.accepted)throw Error(`Coda Blend dry piena: servono ${i.requiredSteps} segmenti.`);r.lastInput=t,this.drainBlendPlanner(r),this.recordStampGenerationTime(n);return}let i=r.lastInput,a={...e,timeMs:Math.max(i.timeMs,Number.isFinite(e.timeMs)?e.timeMs:i.timeMs)},o=a.x-i.x,s=a.y-i.y,c=Math.hypot(o,s),l=a.timeMs-i.timeMs;if(this.releaseHeldThicknessStamps(a.timeMs,!1),c<=1e-4){r.lastInput=a,this.recordStampGenerationTime(n);return}let u=r.lightGlazeSettings??this.settings,d=Math.max(.1,u.size*(r.adaptiveSpacingPercent/100)),f=o/c,p=s/c,m=0,h=r.distanceSinceStamp,g=0;for(;h+(c-m)>=d;){let e=d-h;m+=e;let n=t(m/c,0,1);if(this.emitStamp({x:i.x+o*n,y:i.y+s*n,pressure:i.pressure+(a.pressure-i.pressure)*n,timeMs:i.timeMs+l*n},f,p),h=0,g+=1,g>=Kn)break}h+=Math.max(0,c-m),r.lastInput=a,r.distanceSinceStamp=h,this.releaseHeldThicknessStamps(a.timeMs,!1),this.recordStampGenerationTime(n)}drainBlendPlanner(e){let t=e.blendPlanner,n=e.blendSettings;if(!t||!n)return;let r=t.buildNextBatch();for(;r;)r.empty||(e.historyCommitted||(this.truncateRedoHistory(),this.historyActions.push({id:e.historyActionId,kind:`stroke`}),this.historyCursor=this.historyActions.length,e.historyCommitted=!0,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)),this.pendingBlendBatches.push({actionId:e.historyActionId,settings:n,batch:he(r)}),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1)),r=t.buildNextBatch();this.pendingBlendBatches.length>0&&(this.displayDirty=!0,this.requestRender())}emitStamp(e,n,r){let i=this.activeStroke;if(!i)return;let a=i.lightGlazeSettings??this.settings,o=t(e.pressure,.01,1),s=Math.max(.5,a.size*.5),c=i.thicknessDynamicsNeutral?1:Ae(i.thicknessSettings.startThickness,Math.max(0,e.timeMs-i.startedAtMs)),l=i.thicknessDynamicsNeutral?s:s*c,u=(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,d={x:e.x,y:e.y,radius:l,pressure:o,seed:u,directionX:n,directionY:r,historyActionId:i.historyActionId};if(i.thicknessTailHoldback){i.heldThicknessStamps.push({stamp:d,timeMs:e.timeMs,baseRadius:s,liveThicknessFactor:c}),this.activeStrokeProfile&&(this.activeStrokeProfile.thicknessDynamicsHeldBaseStamps+=1,this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps=Math.max(this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps,i.heldThicknessStamps.length-i.heldThicknessHead)),this.displayDirty=!0,this.requestRender();return}this.commitThicknessStamp(d,i)}releaseHeldThicknessStamps(e,t){let n=this.activeStroke;if(!n||!n.thicknessTailHoldback)return;let r=n.heldThicknessStamps,i=0;for(;n.heldThicknessHead<r.length;){let a=r[n.heldThicknessHead],o=Math.max(0,e-a.timeMs);if(!t&&o<100)break;a.stamp.radius=t?Me(a.baseRadius,a.liveThicknessFactor,n.thicknessSettings.endThickness,o):a.baseRadius*a.liveThicknessFactor,this.commitThicknessStamp(a.stamp,n),n.heldThicknessHead+=1,i+=1}i>0&&this.activeStrokeProfile&&(t?this.activeStrokeProfile.thicknessDynamicsReleasedAtLift+=i:this.activeStrokeProfile.thicknessDynamicsReleasedDuringStroke+=i),n.heldThicknessHead===r.length?(n.heldThicknessStamps=[],n.heldThicknessHead=0):n.heldThicknessHead>=1024&&(n.heldThicknessStamps=r.slice(n.heldThicknessHead),n.heldThicknessHead=0)}thicknessTailReferenceTimeMs(){let e=this.activeStroke;return e?Math.max(e.lastInput.timeMs,performance.now()):performance.now()}thicknessTailPreviewEligible(){let e=this.activeStroke;return!e||!e.thicknessTailHoldback||e.lightGlazeSettings||e.heldThicknessHead>=e.heldThicknessStamps.length?!1:this.settings.blendMode===`normal`||this.settings.blendMode===`additive`}prepareThicknessTailFrame(){let e=this.activeStroke;if(!e||!this.thicknessTailPreviewEligible())return null;let t=this.settings,n=e.heldThicknessStamps,r=Math.max(e.heldThicknessHead,n.length-Kn),i=this.thicknessTailReferenceTimeMs(),a=[];for(let t=r;t<n.length;t+=1){let r=n[t],o=Me(r.baseRadius,r.liveThicknessFactor,e.thicknessSettings.endThickness,Math.max(0,i-r.timeMs));!Number.isFinite(o)||o<=0||a.push({...r.stamp,radius:o})}if(a.length===0)return null;let o=this.packThicknessTailStamps(a,t);return o.dirtyRect?(this.ensureThicknessTailOverlayResources(o.dirtyRect.width,o.dirtyRect.height),this.writeThicknessTailBrushUniforms(t,this.thicknessTailTextureWidth,this.thicknessTailTextureHeight,o.dirtyRect.x,o.dirtyRect.y),this.writeThicknessTailDisplayUniforms(o.dirtyRect.x,o.dirtyRect.y,t),this.device.queue.writeBuffer(this.thicknessTailInstanceBuffer,0,this.thicknessTailInstanceUpload,0,a.length*Gn),{settings:t,stamps:a,dirtyRect:o.dirtyRect,shapeOccupancySelection:t.shape===`shape`?this.selectShapeOccupancy(o.minimumRadius):null,grainActive:this.isTexturizedGrainActive(t)}):null}encodeThicknessTailFrame(e,t){let n=t.settings,r=n.shape===`shape`,i=t.shapeOccupancySelection?.selectedMipLevel??null,a=r&&i!==null,o=t.grainActive?r?a?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:r?a?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline,s=t.grainActive?a?this.thicknessTailGrainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][i]:this.thicknessTailGrainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.thicknessTailBrushOccupancyBindGroups[i]:this.thicknessTailBrushBindGroup,c=e.beginRenderPass({label:`Rebuild predictive thickness tail`,colorAttachments:[{view:this.thicknessTailView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});c.setPipeline(o),c.setBindGroup(0,s),c.setScissorRect(0,0,t.dirtyRect.width,t.dirtyRect.height),c.draw(Yn,t.stamps.length*n.count,0,0),c.end();let l=this.activeStrokeProfile;l&&(l.thicknessDynamicsPreviewFrames+=1,l.thicknessDynamicsPreviewBaseStamps+=t.stamps.length,l.thicknessDynamicsPreviewPhysicalCopies+=t.stamps.length*n.count,l.thicknessDynamicsPreviewMaximumTexturePixels=Math.max(l.thicknessDynamicsPreviewMaximumTexturePixels,this.thicknessTailTextureWidth*this.thicknessTailTextureHeight))}commitThicknessStamp(e,t){if(e.radius<=0)return;let n=t.lightGlazeSettings??this.settings,r=e.radius*2*(n.positionJitterLinear+n.positionJitterLateral);e.x+e.radius+r<0||e.y+e.radius+r<0||e.x-e.radius-r>=V||e.y-e.radius-r>=V||(t.historyCommitted||(this.truncateRedoHistory(),this.historyActions.push({id:t.historyActionId,kind:`stroke`}),this.historyCursor=this.historyActions.length,t.historyCommitted=!0,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCommittedActions+=1)),this.pendingStamps.push(e),this.activeStrokeProfile&&(this.activeStrokeProfile.baseStamps+=1),this.displayDirty=!0,this.requestRender())}requestRender(){this.initialized&&this.frameRequest===null&&(this.frameRequest=requestAnimationFrame(e=>this.renderFrame(e)))}renderFrame(e){let t=performance.now();if(this.frameRequest=null,!this.initialized)return;let n=performance.now();this.resizeCanvas();let r=performance.now()-n;this.activeStroke?.thicknessTailHoldback&&this.releaseHeldThicknessStamps(this.thicknessTailReferenceTimeMs(),!1);let i=performance.now(),a=this.pendingStamps.length,o=this.lightGlazeSession;if(o)for(a=0;a<this.pendingStamps.length&&this.pendingStamps[a].historyActionId===o.historyActionId;)a+=1;let s=Math.min(a,Kn),c=s>0?this.pendingStamps.splice(0,s):[],l=[];if(!o&&c.length===0&&this.pendingBlendBatches.length>0){let e=this.pendingBlendBatches[0],t=qn,n=0;for(;n<this.pendingBlendBatches.length&&n<Jn&&this.pendingBlendBatches[n].actionId===e.actionId;){let e=this.pendingBlendBatches[n].batch.readRect,r=e.width*e.height*2;if(n>0&&r>t)break;t-=r,n+=1}l=this.pendingBlendBatches.splice(0,n)}o&&(o.commitRequested=o.endRequested&&!this.pendingStamps.some(e=>e.historyActionId===o.historyActionId));let u=performance.now()-i;if(!(this.clearRequested||c.length>0||l.length>0||this.displayDirty||o?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)||this.canvas.width<=0||this.canvas.height<=0)return;let d=this.clearRequested,f=l[0]?.settings??o?.settings??this.settings,p=performance.now(),m=l.length>0?this.submitBlendImmediate(l.map(e=>e.batch),d,f,l[0].actionId):this.submitImmediate(c,d,f);this.lastCpuFrameMs=performance.now()-p,l.length>0?(this.recordBlendHistoryBatch(l,m,d),this.layerHasContent=!0):c.length>0?(this.trackAdaptivePreviewExactSubmission(c,f),this.recordHistoryBatch(c,f,m,d),this.layerHasContent=!0):d&&(this.layerHasContent=!1),this.clearRequested=!1,this.displayDirty=!1,this.totalBaseStamps+=c.length+l.length,c.length>0&&(this.avoidedLogicalDraws+=c.length*Math.max(0,f.count-1)),this.recordRenderedFrame(e);let h=performance.now();this.publishStats();let g=performance.now()-h;(this.pendingStamps.length>0||this.pendingBlendBatches.length>0||this.displayDirty||this.clearRequested||this.lightGlazeSession?.commitRequested||this.thicknessTailPreviewEligible()||this.thicknessTailPresentedRect!==null)&&this.requestRender(),this.recordStrokeFrameTiming(e,c.length+l.length,l.length>0?1:f.count,m,{totalCpuMs:performance.now()-t,resizeCanvasMs:r,batchExtractionMs:u,statsPublishMs:g}),this.maybeReleaseIdleBlendScratch(),this.maybeReleaseIdleLightGlazeResources(),this.maybeReleaseIdleGrainResources(),this.maybeReleaseIdleShapeResources()}recordHistoryBatch(e,t,n,r){e.length===0||e[0].historyActionId===0||(this.activeStroke&&e.some(e=>e.historyActionId===this.activeStroke?.historyActionId)&&(this.activeStroke.submitted=!0),this.historyBatches.push({kind:`paint`,settings:t,stamps:e,clearLayer:r,dirtyRect:n.dirtyRect,shapeOccupancySelection:n.shapeOccupancySelection,shapeMaskIdentity:this.shapeMaskIdentity,grainTextureIdentity:this.isTexturizedGrainActive(t)?this.grainTextureIdentity:null}),this.historyStoredBaseStamps+=e.length,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCapturedBaseStamps+=e.length,this.activeStrokeProfile.historyCapturedBatches+=1))}truncateRedoHistory(){this.historyCursor>=this.historyActions.length||(this.historyActions.length=this.historyCursor,this.historyCompactionPending=!0)}compactDiscardedHistory(){if(!this.historyCompactionPending)return;let e=new Set(this.historyActions.filter(e=>e.kind===`stroke`).map(e=>e.id)),t=[],n=0;for(let r of this.historyBatches){if(r.kind===`blend`){if(!e.has(r.actionId))continue;t.push(r),n+=r.batches.length;continue}let i=r.stamps.filter(t=>e.has(t.historyActionId));i.length!==0&&(t.push(i.length===r.stamps.length?r:{...r,stamps:i}),n+=i.length)}this.historyBatches=t,this.historyStoredBaseStamps=n,this.historyCompactionPending=!1}visibleHistoryStrokeIds(){let e=0;for(let t=this.historyCursor-1;t>=0;--t)if(this.historyActions[t].kind===`clear`){e=t+1;break}let t=new Set;for(let n=e;n<this.historyCursor;n+=1){let e=this.historyActions[n];e.kind===`stroke`&&t.add(e.id)}return t}hasVisibleHistoryContent(){return this.visibleHistoryStrokeIds().size>0}resetHistoryState(){this.historyActions=[],this.historyCursor=0,this.nextHistoryActionId=1,this.historyBatches=[],this.historyStoredBaseStamps=0,this.historyCompactionPending=!1}async moveHistoryCursor(e){if(!this.initialized||this.activeStroke||this.historyBusy)return!1;let t=this.historyCursor+e;if(t<0||t>this.historyActions.length)return!1;let n=this.historyCursor;this.invalidateAdaptivePreview(),this.historyBusy=!0,this.publishHistoryState(),this.callbacks.onStatus?.(e<0?`Undo: ricostruzione del layer…`:`Redo: ricostruzione del layer…`,`working`);try{await this.waitForIdle(),this.compactDiscardedHistory(),this.historyCursor=t;try{await this.rebuildLayerFromHistory()}catch(e){this.historyCursor=n;try{await this.rebuildLayerFromHistory()}catch(t){let n=e instanceof Error?e.message:String(e),r=t instanceof Error?t.message:String(t);throw Error(`Undo/Redo non riuscito (${n}) e ripristino fallito (${r}).`)}throw e}return this.activeStrokeProfile&&(this.activeStrokeProfile.historyReplayOperations+=1),this.callbacks.onStatus?.(e<0?`Undo completato.`:`Redo completato.`,`ok`),!0}finally{this.historyBusy=!1,this.publishHistoryState()}}async rebuildLayerFromHistory(){this.historyBatches.some(e=>e.grainTextureIdentity!==null)&&await this.ensureGrainResources(),this.historyBatches.some(e=>e.settings.shape===`shape`)&&await this.ensureShapeResources(),this.blendRenderer?.beginStroke(0);let e=this.visibleHistoryStrokeIds(),t=-1,n=-1;for(let r=0;r<this.historyBatches.length;r+=1){let i=this.historyBatches[r];(i.kind===`blend`?e.has(i.actionId):i.stamps.some(t=>e.has(t.historyActionId)))&&(t<0&&(t=r),n=r)}try{if(n<0)this.submitImmediate([],!0,this.settings,!0,null);else{let r=this.historyBatches[t];r.clearLayer||this.submitImmediate([],!0,r.settings,!1,null);for(let r=t;r<=n;r+=1){let t=this.historyBatches[r];if(t.kind===`blend`){if(!e.has(t.actionId))continue;this.submitBlendImmediate(t.batches,t.clearLayer,t.settings,t.actionId,r===n,t);continue}let i=t.stamps.every(t=>e.has(t.historyActionId))?t.stamps:t.stamps.filter(t=>e.has(t.historyActionId));if(i.length!==0){if(Ci(t.settings.blendMode)){let a=i[0].historyActionId;if(i.some(e=>e.historyActionId!==a))throw Error(`Un batch Light Glaze storico contiene più pennellate.`);if(!this.lightGlazeSession)this.startLightGlazeSession(a,t.settings);else if(this.lightGlazeSession.historyActionId!==a)throw Error(`Ordine storico Light Glaze non valido.`);let o=!1;for(let t=r+1;t<=n;t+=1){let n=this.historyBatches[t];if(n.kind===`paint`&&n.stamps.some(t=>t.historyActionId===a&&e.has(a))){o=!0;break}}let s=this.lightGlazeSession;if(!s)throw Error(`Sessione Light Glaze storica non inizializzata.`);s.endRequested=!o,s.commitRequested=!o}this.writeBrushUniforms(t.settings),this.submitImmediate(i,t.clearLayer,t.settings,r===n,t)}}if(this.lightGlazeSession)throw Error(`La ricostruzione storica ha lasciato un tratto Light Glaze aperto.`)}}finally{this.lightGlazeSession&&this.abandonLightGlazeSession(),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings)}this.clearRequested=!1,this.displayDirty=!1,this.layerHasContent=n>=0,await this.device.queue.onSubmittedWorkDone()}selectShapeOccupancy(e){let t=Number.isFinite(e),n=t?Math.log2(U/Math.max(1,e*2)):1/0,r=t?Math.max(0,Math.ceil(n+1e-4)):-1,i=r>=0&&r<=fi,a=i?this.shapeOccupancyActiveCells[r]:0,o=i?this.shapeOccupancyCoverageRatios[r]:0;return!t||e<mi?{selectedMipLevel:null,fallbackReason:`minimum-radius`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:i?o>hi?{selectedMipLevel:null,fallbackReason:`coverage-too-dense`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:r,fallbackReason:`none`,candidateMipLevel:r,candidateActiveCells:a,candidateCoverageRatio:o}:{selectedMipLevel:null,fallbackReason:`mip-out-of-range`,candidateMipLevel:r,candidateActiveCells:0,candidateCoverageRatio:0}}recordShapeSampling(e){let t=e.selectedMipLevel,n=t===null?er:$n,r=t===null?0:this.shapeOccupancyActiveCells[t],i=t===null?0:this.shapeOccupancyCoverageRatios[t];this.lastStampGeometry=Xn,this.lastStampVerticesPerCopy=Yn,this.lastShapeSamplingStrategy=n,this.lastShapeOccupancyFallbackReason=e.fallbackReason,this.lastShapeOccupancyMipLevel=t??-1,this.lastShapeOccupancyActiveCells=r,this.lastShapeOccupancyCoverageRatio=i,this.lastShapeOccupancyCandidateMipLevel=e.candidateMipLevel,this.lastShapeOccupancyCandidateActiveCells=e.candidateActiveCells,this.lastShapeOccupancyCandidateCoverageRatio=e.candidateCoverageRatio;let a=this.activeStrokeProfile;if(!a)return;a.stampGeometry=Xn,a.stampVerticesPerCopy=Yn;let o=a.shapeSamplingStrategy;a.shapeSamplingStrategy=a.shapeSamplingStrategy===`none`||a.shapeSamplingStrategy===n?n:`mixed`,o!==`none`&&o!==n?a.shapeOccupancyFallbackReason=`mixed`:e.fallbackReason!==`none`&&(a.shapeOccupancyFallbackReason=a.shapeOccupancyFallbackReason===`none`||a.shapeOccupancyFallbackReason===e.fallbackReason?e.fallbackReason:`mixed`),a.shapeOccupancyCandidateMipLevel=Math.max(a.shapeOccupancyCandidateMipLevel,e.candidateMipLevel),a.shapeOccupancyCandidateActiveCells=Math.max(a.shapeOccupancyCandidateActiveCells,e.candidateActiveCells),a.shapeOccupancyCandidateCoverageRatio=Math.max(a.shapeOccupancyCandidateCoverageRatio,e.candidateCoverageRatio),t!==null&&(a.shapeOccupancyMipLevel=Math.max(a.shapeOccupancyMipLevel,t),a.shapeOccupancyActiveCells=Math.max(a.shapeOccupancyActiveCells,r),a.shapeOccupancyCoverageRatio=Math.max(a.shapeOccupancyCoverageRatio,i))}recordBlendHistoryBatch(e,t,n){if(e.length===0||e[0].actionId===0)return;let r=e[0].actionId;if(e.some(e=>e.actionId!==r))throw Error(`Un batch storico Blend contiene più pennellate.`);this.activeStroke?.historyActionId===r&&(this.activeStroke.submitted=!0);let i=e[0].settings;this.historyBatches.push({kind:`blend`,actionId:r,settings:i,batches:e.map(e=>e.batch),clearLayer:n,dirtyRect:t.dirtyRect,shapeMaskIdentity:this.shapeMaskIdentity,grainTextureIdentity:this.isTexturizedGrainActive(i)?this.grainTextureIdentity:null}),this.historyStoredBaseStamps+=e.length,this.activeStrokeProfile&&(this.activeStrokeProfile.historyCapturedBaseStamps+=e.length,this.activeStrokeProfile.historyCapturedBatches+=1)}adaptivePreviewRgb(n,r,i=e(r.color)){let a=r.jitterMaster,o=(Pi(n,1)-.5)*2*(r.hueJitterDegrees/360)*a,s=(Pi(n,2)-.5)*2*r.saturationJitter*a,c=(Pi(n,3)-.5)*2*r.lightnessJitter*a,l=Pi(n,4)*r.darknessJitter*a,u=t(i[2]+c,0,1);return Ii(i[0]+o,i[1]+s,u*(1-l))}prepareAdaptivePreviewShapePalette(n){let r=this.adaptivePreviewShapeSprite;if(n.shape!==`shape`||!r||!this.adaptivePreviewContext)return;let i=[n.color,n.jitterMaster,n.hueJitterDegrees,n.saturationJitter,n.lightnessJitter,n.darknessJitter,n.hardness].join(`|`);if(i===this.adaptivePreviewShapePaletteKey)return;let a=e(n.color),o=document.createElement(`canvas`);o.width=r.width,o.height=r.height;let s=o.getContext(`2d`),c=r.getContext(`2d`);if(!s||!c){this.adaptivePreviewShapePalette=[],this.adaptivePreviewShapePaletteKey=i;return}let l=c.getImageData(0,0,r.width,r.height),u=t(n.hardness,0,1);for(let e=3;e<l.data.length;e+=4){let n=l.data[e]/255,r=n*n*(1-u)+n*u;l.data[e]=Math.round(t(r,0,1)*255)}s.putImageData(l,0,0);let d=[],f=new Set;for(let e=0;e<Vr;e+=1){let t=Ni(Math.imul(e+1,2654435761)^2769414579),[i,s,c]=this.adaptivePreviewRgb(t,n,a),l=`rgb(${i} ${s} ${c})`;if(f.has(l))continue;let u=document.createElement(`canvas`);u.width=r.width,u.height=r.height;let p=u.getContext(`2d`);p&&(p.drawImage(o,0,0),p.globalCompositeOperation=`source-in`,p.fillStyle=l,p.fillRect(0,0,u.width,u.height),d.push({red:i,green:s,blue:c,sprite:u}),f.add(l))}this.adaptivePreviewShapePalette=d,this.adaptivePreviewShapePaletteKey=i}nearestAdaptivePreviewShapeSprite(e){let t=null,n=1/0;for(let r of this.adaptivePreviewShapePalette){let i=r.red-e.red,a=r.green-e.green,o=r.blue-e.blue,s=i*i+a*a+o*o;s<n&&(t=r,n=s)}return t?.sprite??null}adaptivePreviewCandidatesForFrame(){return this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2)}finishAdaptivePreviewLifetime(e=performance.now()){this.adaptivePreviewStartedAt<=0||(this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs=Math.max(this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs,e-this.adaptivePreviewStartedAt)),this.adaptivePreviewStartedAt=0)}clearAdaptivePreviewCanvas(){let e=this.adaptivePreviewCanvas,t=this.adaptivePreviewContext;if(!(!e||!t)){if(!(e.style.opacity===`1`||this.adaptivePreviewLastPresentedSerial>0||this.adaptivePreviewCandidates.some(e=>e.presented))){this.adaptivePreviewLastPresentedSerial=0;return}t.setTransform(1,0,0,1,0,0),t.globalAlpha=1,t.globalCompositeOperation=`source-over`,t.clearRect(0,0,e.width,e.height),e.style.opacity=`0`,e.style.left=`-10000px`,e.style.top=`-10000px`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1}}hideConfirmedStaleAdaptivePreviewBitmap(){let e=this.adaptivePreviewCanvas;if(!e||e.style.opacity!==`1`||this.adaptivePreviewLastPresentedSerial<=0||this.adaptivePreviewLastPresentedSerial>this.adaptivePreviewConfirmedSerial||this.hasAdaptivePreviewPresentedUnboundCandidate())return!1;e.style.opacity=`0`,this.adaptivePreviewLastPresentedSerial=0;for(let e of this.adaptivePreviewCandidates)e.presented=!1;return this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewConfirmedStaleBitmapHides+=1),!0}requestAdaptivePreviewIncompleteFrameRetry(e){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen)return;let t=0;for(let n of e)n.serial!==null&&(t=Math.max(t,n.serial));t<=0||t<=this.adaptivePreviewLastIncompleteRetrySerial||(this.adaptivePreviewLastIncompleteRetrySerial=t,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewIncompleteFrameRetryRequests+=1),this.requestAdaptivePreviewDraw())}finishIncompleteAdaptivePreviewFrame(e,t,n,r){this.hideConfirmedStaleAdaptivePreviewBitmap(),r&&this.requestAdaptivePreviewIncompleteFrameRetry(n),this.recordAdaptivePreviewJsFrame(e,t)}cancelAdaptivePreviewProbe(){let e=this.adaptivePreviewProbe;e&&(window.clearTimeout(e.timeout),this.adaptivePreviewProbe=null,e.telemetryProfile&&(e.telemetryProfile.adaptivePreviewProbeCancellations+=1))}invalidateAdaptivePreview(){this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewSubmittedSerial=0,this.adaptivePreviewConfirmedSerial=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewCandidates.length=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.clearAdaptivePreviewCanvas()}activateAdaptivePreview(e){if(this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewCandidates.length===0)return;if(this.adaptivePreviewCandidates[this.adaptivePreviewCandidates.length-1].settings.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1);return}this.adaptivePreviewActive=!0;let t=performance.now();this.adaptivePreviewStartedAt=t;let n=this.activeStrokeProfile;if(n){let r=t-n.startedAt;n.adaptivePreviewActivations===0?(n.adaptivePreviewFirstActivationReason=e,n.adaptivePreviewFirstActivationMs=r):n.adaptivePreviewActivations===1&&(n.adaptivePreviewSecondActivationReason=e,n.adaptivePreviewSecondActivationMs=r),n.adaptivePreviewActivations+=1,n.adaptivePreviewActivationReason=n.adaptivePreviewActivationReason===`none`||n.adaptivePreviewActivationReason===e?e:`mixed`}this.requestAdaptivePreviewDraw()}retireAdaptivePreview(e){let t=this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0;this.finishAdaptivePreviewLifetime(),this.adaptivePreviewGeneration+=1,this.cancelAdaptivePreviewProbe(),this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null),this.adaptivePreviewCandidates.length=0,this.adaptivePreviewActive=!1,this.adaptivePreviewFrozen=!1,this.adaptivePreviewForceStroke=!1,this.adaptivePreviewRetirementTargetSerial=0,this.adaptivePreviewSubmissionsSinceProbe=0,this.adaptivePreviewLastIncompleteRetrySerial=0,this.adaptivePreviewConsecutiveSlowProbes=0,this.clearAdaptivePreviewCanvas(),t&&e&&this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewRetirements+=1)}retireAdaptivePreviewAfterGpuIdle(){this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewLastPresentedSerial>0?(this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,this.adaptivePreviewSubmittedSerial),this.adaptivePreviewFrozen?this.scheduleAdaptivePreviewRetirement():this.scheduleAdaptivePreviewCatchUpClear()):this.clearAdaptivePreviewCanvas()}hasAdaptivePreviewPresentedUnboundCandidate(){return this.adaptivePreviewCandidates.some(e=>e.presented&&e.serial===null)}hasAdaptivePreviewUnconfirmedCandidate(){return this.adaptivePreviewCandidates.some(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial)}scheduleAdaptivePreviewRetirement(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null;let t=this.adaptivePreviewRetirementTargetSerial;e!==this.adaptivePreviewGeneration||!this.adaptivePreviewFrozen||this.hasAdaptivePreviewPresentedUnboundCandidate()||t<=0||this.adaptivePreviewConfirmedSerial<t||this.retireAdaptivePreview(!0)})}scheduleAdaptivePreviewCatchUpClear(){if(this.adaptivePreviewRetirementFrame!==null)return;let e=this.adaptivePreviewGeneration,t=this.adaptivePreviewLastPresentedSerial;this.adaptivePreviewRetirementFrame=requestAnimationFrame(()=>{this.adaptivePreviewRetirementFrame=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen||this.adaptivePreviewConfirmedSerial<t||this.hasAdaptivePreviewUnconfirmedCandidate())&&(this.adaptivePreviewForceStroke&&this.activeStroke?this.clearAdaptivePreviewCanvas():this.retireAdaptivePreview(!0))})}freezeAdaptivePreviewAtLift(){if(!this.adaptivePreviewActive){this.invalidateAdaptivePreview();return}this.adaptivePreviewFrameRequest!==null&&(cancelAnimationFrame(this.adaptivePreviewFrameRequest),this.adaptivePreviewFrameRequest=null),this.adaptivePreviewRetirementFrame!==null&&(cancelAnimationFrame(this.adaptivePreviewRetirementFrame),this.adaptivePreviewRetirementFrame=null);let e=this.activeStroke;if(e){let t=[],n=0,r=Nr;for(let n=this.pendingStamps.length-1;n>=0&&t.length<r;--n){let r=this.pendingStamps[n];r.historyActionId===e.historyActionId&&t.unshift(r)}for(let e of t)this.adaptivePreviewCandidates.some(t=>t.stamp===e)||(this.adaptivePreviewCandidates.push({serial:null,stamp:e,settings:this.settings,presented:!1}),n+=1);this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.slice(-2),this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewLiftPendingBaseStamps+=n)}if(this.adaptivePreviewFrozen=!0,this.drawAdaptivePreviewFrame(),this.adaptivePreviewLastPresentedSerial<=0&&!this.hasAdaptivePreviewPresentedUnboundCandidate()){this.invalidateAdaptivePreview();return}if(this.adaptivePreviewRetirementTargetSerial=this.adaptivePreviewLastPresentedSerial,this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewFrozenAtLift+=1),!this.hasAdaptivePreviewPresentedUnboundCandidate()){if(this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial){this.scheduleAdaptivePreviewRetirement();return}this.startAdaptivePreviewProbe(!0)}}requestAdaptivePreviewDraw(){if(!this.adaptivePreviewActive||this.adaptivePreviewFrozen||!this.adaptivePreviewContext||this.adaptivePreviewFrameRequest!==null)return;let e=this.adaptivePreviewGeneration;this.adaptivePreviewFrameRequest=requestAnimationFrame(()=>{this.adaptivePreviewFrameRequest=null,!(e!==this.adaptivePreviewGeneration||!this.adaptivePreviewActive||this.adaptivePreviewFrozen)&&this.drawAdaptivePreviewFrame()})}increaseAdaptiveSpacing(e){let t=this.activeStroke;if(!t||this.adaptivePreviewFrozen)return;let n=t.adaptiveSpacingInitialPercent+this.adaptiveSpacingMaxExtraPercentPoints,r=Math.min(n,t.adaptiveSpacingPercent+Jr);if(r<=t.adaptiveSpacingPercent)return;t.adaptiveSpacingPercent=r;let i=this.activeStrokeProfile;i&&(i.adaptiveSpacingFinalPercent=r,i.adaptiveSpacingEvents.push({offsetMs:Math.max(0,performance.now()-i.startedAt),reason:e,spacingPercent:r,extraPercentPoints:r-t.adaptiveSpacingInitialPercent,backlogBaseStamps:Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),generatedBaseStamps:i.baseStamps}))}startAdaptivePreviewProbe(e){if(!this.adaptivePreviewContext||this.adaptivePreviewProbe||this.adaptivePreviewSubmittedSerial<=this.adaptivePreviewConfirmedSerial||!this.activeStroke&&!this.adaptivePreviewFrozen||!e&&this.adaptivePreviewSubmissionsSinceProbe<Hr)return;let t=performance.now(),n=this.activeStrokeProfile,r=Math.max(0,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial),i={generation:this.adaptivePreviewGeneration,startedAt:t,prefixSerial:this.adaptivePreviewSubmittedSerial,timeout:0,spacingIncreaseApplied:!1,telemetryProfile:n};n&&(n.adaptivePreviewProbeStarts+=1,n.adaptivePreviewProbeBacklogBaseStamps.push(r)),this.adaptivePreviewSubmissionsSinceProbe=0,i.timeout=window.setTimeout(()=>{let e=performance.now();this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration||!this.activeStroke||this.adaptivePreviewFrozen||(i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeTimeouts+=1,i.telemetryProfile.adaptivePreviewProbeTimeoutLatenessMs.push(Math.max(0,e-(i.startedAt+Ur)))),i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`probe-timeout`),this.activateAdaptivePreview(`probe-timeout`))},Ur),this.adaptivePreviewProbe=i,this.device.queue.onSubmittedWorkDone().then(()=>{if(this.adaptivePreviewProbe!==i||i.generation!==this.adaptivePreviewGeneration)return;window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null;let e=performance.now()-i.startedAt;e>=Wr&&!i.spacingIncreaseApplied&&(i.spacingIncreaseApplied=!0,this.increaseAdaptiveSpacing(`slow-completion`)),this.adaptivePreviewConfirmedSerial=Math.max(this.adaptivePreviewConfirmedSerial,i.prefixSerial);let t=i.telemetryProfile;if(t&&(t.adaptivePreviewProbeLatencyMs.push(e),e>=Wr?t.adaptivePreviewProbeResolvedSlow+=1:t.adaptivePreviewProbeResolvedFast+=1,e>=Kr&&e<Ur&&(t.adaptivePreviewProbeNearMisses+=1),t.adaptivePreviewMaxQueueProbeLatencyMs=Math.max(t.adaptivePreviewMaxQueueProbeLatencyMs,e)),this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial),this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0);return}if(e>=Wr?this.adaptivePreviewConsecutiveSlowProbes+=1:this.adaptivePreviewConsecutiveSlowProbes=0,!this.adaptivePreviewActive&&this.activeStroke&&this.adaptivePreviewConsecutiveSlowProbes>=Gr&&this.activateAdaptivePreview(`consecutive-slow`),this.adaptivePreviewActive)if(this.adaptivePreviewCandidates.length>0)this.requestAdaptivePreviewDraw();else{this.scheduleAdaptivePreviewCatchUpClear();return}this.activeStroke&&this.adaptivePreviewSubmittedSerial>this.adaptivePreviewConfirmedSerial&&this.startAdaptivePreviewProbe(this.adaptivePreviewActive||this.adaptivePreviewSubmissionsSinceProbe>=Hr)}).catch(()=>{i.telemetryProfile&&(i.telemetryProfile.adaptivePreviewProbeRejections+=1),this.adaptivePreviewProbe===i&&(window.clearTimeout(i.timeout),this.adaptivePreviewProbe=null),i.generation===this.adaptivePreviewGeneration&&this.invalidateAdaptivePreview()})}trackAdaptivePreviewExactSubmission(e,t){let n=this.activeStrokeProfile;n&&(n.adaptivePreviewExactBaseStampsSubmitted+=e.length,n.adaptivePreviewExactBatchesSubmitted+=1);let r=this.adaptivePreviewSubmittedSerial;this.adaptivePreviewSubmittedSerial+=e.length,this.adaptivePreviewSubmissionsSinceProbe+=1,n&&(n.adaptivePreviewMaxUnconfirmedBaseStamps=Math.max(n.adaptivePreviewMaxUnconfirmedBaseStamps,this.adaptivePreviewSubmittedSerial-this.adaptivePreviewConfirmedSerial));for(let t of this.adaptivePreviewCandidates){if(t.serial!==null)continue;let i=e.indexOf(t.stamp);i<0||(t.serial=r+i+1,n&&(n.adaptivePreviewLiftPendingSerialBindings+=1),t.presented&&(this.adaptivePreviewLastPresentedSerial=Math.max(this.adaptivePreviewLastPresentedSerial,t.serial),this.adaptivePreviewRetirementTargetSerial=Math.max(this.adaptivePreviewRetirementTargetSerial,t.serial)))}if(this.adaptivePreviewFrozen||!this.activeStroke){if(this.adaptivePreviewFrozen){if(this.hasAdaptivePreviewPresentedUnboundCandidate())return;this.adaptivePreviewRetirementTargetSerial>0&&this.adaptivePreviewConfirmedSerial>=this.adaptivePreviewRetirementTargetSerial?this.scheduleAdaptivePreviewRetirement():this.startAdaptivePreviewProbe(!0)}return}if(this.isTexturizedGrainActive(t)){n&&(n.grainAdaptivePreviewSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),this.startAdaptivePreviewProbe(!1);return}if(t.blendMode!==`normal`){n&&(n.adaptivePreviewUnsupportedBlendSkips+=1),this.adaptivePreviewCandidates.length=0,this.clearAdaptivePreviewCanvas(),Ci(t.blendMode)&&this.startAdaptivePreviewProbe(!1);return}let i=Nr,a=Math.max(0,e.length-i);for(let n=a;n<e.length;n+=1)this.adaptivePreviewCandidates.some(t=>t.stamp===e[n])||this.adaptivePreviewCandidates.push({serial:r+n+1,stamp:e[n],settings:t,presented:!1});this.adaptivePreviewCandidates=this.adaptivePreviewCandidates.filter(e=>e.serial===null||e.serial>this.adaptivePreviewConfirmedSerial).slice(-2),this.adaptivePreviewForceStroke&&this.activateAdaptivePreview(`diagnostic-force`),this.adaptivePreviewActive&&this.requestAdaptivePreviewDraw(),this.startAdaptivePreviewProbe(this.adaptivePreviewActive)}recordAdaptivePreviewJsFrame(e,t){let n=performance.now()-e,r=this.activeStrokeProfile;r&&(r.adaptivePreviewJsTotalMs+=n,r.adaptivePreviewJsFrameMs.push(n),!t&&n>jr&&(r.adaptivePreviewBudgetSkips+=1))}drawAdaptivePreviewFrame(){let n=performance.now(),r=this.adaptivePreviewCanvas,i=this.adaptivePreviewContext,a=this.adaptivePreviewScratchCanvas,o=this.adaptivePreviewScratchContext,s=this.adaptivePreviewCandidatesForFrame();if(!r||!i||!a||!o||s.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let c=s[s.length-1].settings;if(this.isTexturizedGrainActive(c)){this.activeStrokeProfile&&(this.activeStrokeProfile.grainAdaptivePreviewSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.blendMode!==`normal`){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(c.shape===`shape`&&(this.prepareAdaptivePreviewShapePalette(c),this.adaptivePreviewShapePalette.length===0)){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let l=this.canvasCssWidth,u=this.canvasCssHeight,d=Math.max(1,this.canvas.width),f=Math.max(1,this.canvas.height),p=this.zoom*l/d,m=this.zoom*u/f,h=(Math.abs(p)+Math.abs(m))*.5;if(l<=0||u<=0||!Number.isFinite(h)||h<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let g=[];for(let n=0;n<s.length;n+=1){let r=s[n],i=r.settings;if(i.shape!==c.shape||i.blendMode!==c.blendMode)continue;let a=r.stamp,o=Math.fround(a.x),d=Math.fround(a.y),f=Math.fround(a.radius);if(f<=0)continue;let _=Math.fround(a.directionX),v=Math.fround(a.directionY),y=Math.hypot(_,v),b=y>1e-4?_/y:1,x=y>1e-4?v/y:0,S=e(i.color),C=t(i.flow*i.opacity*i.blendIntensity,0,.999999)*Br,w=t(Math.round(i.count),1,24);for(let e=0;e<w;e+=1){let t=Ni((a.seed^Math.imul(e,2246822507))>>>0),r=(Pi(t,5)-.5)*4*f*Math.fround(i.positionJitterLinear),s=(Pi(t,6)-.5)*4*f*Math.fround(i.positionJitterLateral),c=o+b*r-x*s,_=d+x*r+b*s,v=i.shape===`shape`?(Pi(t,7)-.5)*Math.PI*2*i.shapeScatter:0,y=i.jitterPerCopy?t:Ni(a.seed),[w,T,E]=this.adaptivePreviewRgb(y,i,S);g.push({x:(c-this.viewCenterX)*p+l*.5,y:(_-this.viewCenterY)*m+u*.5,radius:Math.max(.25,f*h),rotation:v,alpha:C,candidateIndex:n,red:w,green:T,blue:E,color:`rgb(${w} ${T} ${E})`})}}if(g.length===0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(performance.now()-n>jr){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}let _=1/0,v=1/0,y=-1/0,b=-1/0;for(let e of g){let t=c.shape===`shape`?e.radius*(Math.abs(Math.cos(e.rotation))+Math.abs(Math.sin(e.rotation))):e.radius;_=Math.min(_,e.x-t),v=Math.min(v,e.y-t),y=Math.max(y,e.x+t),b=Math.max(b,e.y+t)}let x=Math.max(0,_-zr),S=Math.max(0,v-zr),C=Math.min(l,y+zr),w=Math.min(u,b+zr),T=Math.max(0,C-x),E=Math.max(0,w-S);if(T<=0||E<=0){this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}if(T>Ir||E>Ir){let e=this.activeStrokeProfile;e&&(e.adaptivePreviewOversizedSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!1,s,!1);return}let ee=(e,t)=>Math.min(t,Math.max(Lr,Math.ceil(e/Rr)*Rr)),D=ee(T,Math.min(Ir,Math.ceil(l))),O=ee(E,Math.min(Ir,Math.ceil(u))),k=t(Math.floor((x+C-D)*.5),0,Math.max(0,Math.ceil(l)-D)),A=t(Math.floor((S+w-O)*.5),0,Math.max(0,Math.ceil(u)-O)),te=d/l*Ar,ne=f/u*Ar,j=Math.max(1,Math.ceil(D*te)),M=Math.max(1,Math.ceil(O*ne));(a.width!==j||a.height!==M)&&(a.width=j,a.height=M),o.setTransform(1,0,0,1,0,0),o.globalCompositeOperation=`source-over`,o.globalAlpha=1,o.clearRect(0,0,j,M),o.imageSmoothingEnabled=!0,o.imageSmoothingQuality=`low`;let N=j/D,P=M/O,re=new Set,ie=0,ae=!1,oe=!0,se=Math.max(0,jr-Mr);for(let e of g){if(performance.now()-n>se){ae=!0,oe=!1;break}let r=(e.x-k)*N,i=(e.y-A)*P,a=e.radius*N,s=e.radius*P;if(o.globalAlpha=e.alpha,c.shape===`shape`){let t=this.nearestAdaptivePreviewShapeSprite(e);if(!t){oe=!1;break}o.save(),o.translate(r,i),o.rotate(e.rotation),o.drawImage(t,-a,-s,a*2,s*2),o.restore()}else if(o.beginPath(),o.ellipse(r,i,a,s,0,0,Math.PI*2),o.fillStyle=e.color,c.hardness>=.995)o.fill();else{let n=o.createRadialGradient(r,i,0,r,i,Math.max(a,s)),l=t(c.hardness,0,.999);n.addColorStop(0,e.color),n.addColorStop(l,e.color),n.addColorStop(1,`rgb(${e.red} ${e.green} ${e.blue} / 0)`),o.fillStyle=n,o.fill()}re.add(e.candidateIndex),ie+=1}if(o.globalAlpha=1,!oe||ae||ie!==g.length||performance.now()-n>se){this.activeStrokeProfile&&(this.activeStrokeProfile.adaptivePreviewBudgetSkips+=1),this.finishIncompleteAdaptivePreviewFrame(n,!0,s,!0);return}(r.width!==j||r.height!==M)&&(r.width=j,r.height=M),(this.adaptivePreviewCssWidth!==D||this.adaptivePreviewCssHeight!==O)&&(r.style.width=`${D}px`,r.style.height=`${O}px`,this.adaptivePreviewCssWidth=D,this.adaptivePreviewCssHeight=O),r.style.left=`${k}px`,r.style.top=`${A}px`,i.setTransform(1,0,0,1,0,0),i.globalCompositeOperation=`copy`,i.globalAlpha=1,i.drawImage(a,0,0),i.globalCompositeOperation=`source-over`;for(let e of this.adaptivePreviewCandidates)e.presented=!1;let ce=0;for(let e of re){let t=s[e];t.presented=!0,t.serial!==null&&(ce=Math.max(ce,t.serial))}this.adaptivePreviewLastPresentedSerial=ce,r.style.opacity=`1`;let F=this.activeStrokeProfile;F&&(F.adaptivePreviewFrames+=1,F.adaptivePreviewBaseStampsDrawn+=re.size,F.adaptivePreviewPhysicalCopiesDrawn+=ie,F.adaptivePreviewPatchPixels+=j*M,F.adaptivePreviewMaxPatchBackingPixels=Math.max(F.adaptivePreviewMaxPatchBackingPixels,j*M)),this.recordAdaptivePreviewJsFrame(n,!1)}submitLightGlazeImmediate(e,t,n,r,i){this.thicknessTailPresentedRect&&(this.thicknessTailPresentedRect=null,this.presentationCacheNeedsFullRebuild=!0);let a=this.lightGlazeSession;if(!a||!Ci(a.settings.blendMode))throw Error(`Sessione Light Glaze mancante durante il rendering.`);if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let o=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==o)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);this.ensureLightGlazeResources(n.blendMode);let s=this.isTexturizedGrainActive(n),c=n.blendMode===`m1-glaze`,l=performance.now();if(r&&this.ensurePresentationCacheTexture(),this.writeBrushUniforms({...n,opacity:1,blendMode:`normal`}),s&&this.writeGrainUniforms(n),c&&a.tintLinear===null&&e.length>0){let[t,r,i]=this.adaptivePreviewRgb(Ni(e[0].seed),n);a.tintLinear=[Li(t),Li(r),Li(i)]}this.writeLightGlazeUniforms(n.opacity,c?`m1-max-coverage`:`source-over`,a.tintLinear);let u=this.device.createCommandEncoder({label:`Light Glaze frame encoder`}),d=0,f=0,p=0,m=0,h=0,g=0,_=null,v=null,y=0,b=0,x=0,S=0,C=0,w=0,T=0,E=0,ee=0,D=0,O=!1,k=this.paintDisplaySelectedMipLevel,A=0,te=0,ne=0,j=0,M=0,N=0,P=0,re=0,ie=0,ae=0,oe=0,se=0,ce=0,F=0,le=0,ue=0,de=0,fe=performance.now();if(t&&(u.beginRenderPass({label:`Clear permanent layer before Light Glaze`,colorAttachments:[{view:this.layerView,loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]}).end(),this.paintDisplayMipValidThroughLevel=0,this.noteLayerMutation(null,!0)),e.length>0){let t=performance.now(),r=this.packStamps(e,n);_=i?i.dirtyRect:r,d=performance.now()-t;let o=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*Gn),n.shape===`shape`&&(v=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),f=performance.now()-o;let l=u.beginRenderPass({label:`Accumulate Light Glaze stroke`,colorAttachments:[{view:this.lightGlazeView,loadOp:a.needsClear?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(_){g=_.width*_.height;let t=n.shape===`shape`,r=v?.selectedMipLevel??null,a=t&&r!==null,o=c?s?t?a?this.grainM1GlazeShapeOccupancyPipeline:this.grainM1GlazeShapePipeline:this.grainM1GlazePipeline:t?a?this.m1GlazeShapeOccupancyPipeline:this.m1GlazeShapePipeline:this.m1GlazePipeline:s?t?a?this.grainShapeOccupancyNormalPipeline:this.grainShapeNormalPipeline:this.grainNormalPipeline:t?a?this.shapeOccupancyNormalPipeline:this.shapeNormalPipeline:this.normalPipeline;l.setPipeline(o),l.setBindGroup(0,s?a?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][r]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:a?this.brushOccupancyBindGroups[r]:this.brushBindGroup),l.setScissorRect(_.x,_.y,_.width,_.height),t&&v&&!i&&this.recordShapeSampling(v),l.draw(Yn,e.length*n.count,0,0),s&&(ce=1,F=e.length,le=e.length*n.count,ue=+!t,de=+!!t)}l.end(),a.needsClear=!1,a.hasContent=a.hasContent||_!==null,a.dirtyRect=this.mergeDirtyRects(a.dirtyRect,_),re=1}if(p+=performance.now()-fe,!r&&(t||e.length>0||a.commitRequested)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0,this.deferRasterStrokeMutation(t)),r){let e=performance.now();k=this.desiredPaintDisplayMipLevel(),k!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=k;let n=this.canvas.width*this.canvas.height;if(ee=n,D=n,!a.commitRequested){let e=this.styleStackActive(),n=e?this.encodeRasterStrokeUpdate(u,`light-glaze`,_,this.mergeDirtyRects(this.layerContentBounds,a.dirtyRect),t):{dirtyRect:null,timing:null};if(e){(t||_)&&(this.paintDisplayMipValidThroughLevel=0);let e=performance.now(),r=this.encodeRasterStrokeDisplayPyramid(u,n.dirtyRect,k);A+=+(r.passes>0),j+=r.passes,M+=n.dirtyRect?n.dirtyRect.width*n.dirtyRect.height:0,N+=r.updatedPixels,P+=performance.now()-e}else if(a.hasContent){let e=this.encodeLightGlazeDisplayPyramid(u,a,_,k);oe+=e.passes,se+=e.updatedPixels}else{let e=this.encodePaintDisplayPyramid(u,t?{x:0,y:0,width:V,height:V}:null,k);A+=e.maintenanceFrames,te+=e.fullLevelBuilds,ne+=e.dirtyLevelUpdates,j+=e.passes,M+=e.baseDirtyPixels,N+=e.updatedPixels,P+=e.encodingMs}let r=this.presentationCacheNeedsFullRebuild||t,i=e?n.dirtyRect:_,o=r?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:i?this.layerDirtyRectToPresentationRect(i,k):null;if(o){this.writeDisplayUniforms(k),e&&this.rasterStrokeRenderer.updateDisplayParameters(`light-glaze`,this.rasterStrokeStyle,this.rasterBevelStyle);let t=r&&k===0?performance.now():0,n=u.beginRenderPass({label:r?`Rebuild presentation cache with live Light Glaze`:`Update presentation cache with live Light Glaze`,colorAttachments:[{view:this.presentationCacheView,loadOp:r?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});if(n.setPipeline(e?this.rasterStrokeDisplayPipeline:a.hasContent?this.lightGlazeDisplayPipeline:this.displayPipeline),e?(n.setBindGroup(0,this.rasterStrokeDisplayScreenBindGroup),n.setBindGroup(1,this.rasterStrokeDisplayBindGroups.get(`light-glaze`))):n.setBindGroup(0,a.hasContent?this.lightGlazeDisplayBindGroup:this.displayBindGroup),r||n.setScissorRect(o.x,o.y,o.width,o.height),n.draw(3,1,0,0),n.end(),O=!0,t>0){let n=performance.now()-t;e?(S+=1,C+=n):(w+=1,T+=n)}E=o.width*o.height,r?y=1:b=1}else i&&(x=1)}m+=performance.now()-e}if(a.commitRequested){if(a.hasContent&&a.dirtyRect){let e=performance.now(),t=u.beginRenderPass({label:`Commit complete Light Glaze stroke once`,colorAttachments:[{view:this.layerView,loadOp:`load`,storeOp:`store`}]});t.setPipeline(this.lightGlazeCompositePipeline),t.setBindGroup(0,this.lightGlazeCompositeBindGroup),t.setScissorRect(a.dirtyRect.x,a.dirtyRect.y,a.dirtyRect.width,a.dirtyRect.height),t.draw(3,1,0,0),t.end(),p+=performance.now()-e,ie=1,ae=a.dirtyRect.width*a.dirtyRect.height}if(this.noteLayerMutation(a.dirtyRect,!1),r){let e=performance.now(),n=this.styleStackActive(),r=n?this.encodeRasterStrokeUpdate(u,`permanent`,a.dirtyRect,this.layerContentBounds,t):{dirtyRect:null,timing:null},i=t?{x:0,y:0,width:V,height:V}:a.dirtyRect;if(n){this.paintDisplayMipValidThroughLevel=0;let e=performance.now(),t=this.encodeRasterStrokeDisplayPyramid(u,r.dirtyRect,k);A+=+(t.passes>0),j+=t.passes,M+=r.dirtyRect?r.dirtyRect.width*r.dirtyRect.height:0,N+=t.updatedPixels,P+=performance.now()-e}else{let e=this.encodePaintDisplayPyramid(u,i,k);A+=e.maintenanceFrames,te+=e.fullLevelBuilds,ne+=e.dirtyLevelUpdates,j+=e.passes,M+=e.baseDirtyPixels,N+=e.updatedPixels,P+=e.encodingMs}let o=this.presentationCacheNeedsFullRebuild||t,s=n?r.dirtyRect:a.dirtyRect,c=o?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:s?this.layerDirtyRectToPresentationRect(s,k):null;if(c){this.writeDisplayUniforms(k),n&&this.rasterStrokeRenderer.updateDisplayParameters(`permanent`,this.rasterStrokeStyle,this.rasterBevelStyle);let e=o&&k===0?performance.now():0,t=u.beginRenderPass({label:o?`Rebuild canonical presentation cache after Light Glaze commit`:`Canonicalize Light Glaze presentation cache after commit`,colorAttachments:[{view:this.presentationCacheView,loadOp:o?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});if(t.setPipeline(n?this.rasterStrokeDisplayPipeline:this.displayPipeline),n?(t.setBindGroup(0,this.rasterStrokeDisplayScreenBindGroup),t.setBindGroup(1,this.rasterStrokeDisplayBindGroups.get(`permanent`))):t.setBindGroup(0,this.displayBindGroup),o||t.setScissorRect(c.x,c.y,c.width,c.height),t.draw(3,1,0,0),t.end(),O=!0,e>0){let t=performance.now()-e;n?(S+=1,C+=t):(w+=1,T+=t)}E=c.width*c.height,o?y=1:b=1}else s&&(x=1);m+=performance.now()-e}}if(r){let e=performance.now(),t=this.context.getCurrentTexture();u.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:t},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),m+=performance.now()-e}let pe=performance.now();return this.device.queue.submit([u.finish()]),h=performance.now()-pe,r&&O&&(this.presentationCacheNeedsFullRebuild=!1),a.commitRequested&&(this.lightGlazeSession=null),this.writeBrushUniforms(this.settings),this.isTexturizedGrainActive(this.settings)&&this.writeGrainUniforms(this.settings),{totalCpuMs:performance.now()-l,stampPackingMs:d,instanceUploadMs:f,brushEncodingMs:p,displayEncodingMs:m,commandSubmitMs:h,scissorPixels:g,dirtyRect:_,shapeOccupancySelection:v,presentationCacheFullRebuilds:y,presentationCachePartialUpdates:b,presentationCacheOffscreenSkips:x,presentationCacheLod0FullRebuildTraceEnabledPasses:S,presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs:C,presentationCacheLod0FullRebuildTraceDisabledPasses:w,presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs:T,presentationCacheUpdatedPixels:E,legacyDisplayShaderPixels:ee,presentationCopiedPixels:D,displaySelectedMipLevel:k,paintDisplayPyramidMaintenanceFrames:A,paintDisplayPyramidFullLevelBuilds:te,paintDisplayPyramidDirtyLevelUpdates:ne,paintDisplayPyramidPasses:j,paintDisplayPyramidBaseDirtyPixels:M,paintDisplayPyramidUpdatedPixels:N,paintDisplayPyramidEncodingMs:P,lightGlazeBatches:re,lightGlazeCommits:ie,lightGlazeCompositePixels:ae,lightGlazePyramidPasses:oe,lightGlazePyramidUpdatedPixels:se,grainBatches:ce,grainBaseStamps:F,grainPhysicalCopies:le,grainCircleBatches:ue,grainShapeBatches:de}}submitBlendImmediate(e,t,n,r,i=!0,a=null){let o=this.blendRenderer;if(!o)throw Error(`Renderer WebGPU Blend dry non inizializzato.`);if(a&&a.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape Blend usata dalla cronologia non corrisponde alla risorsa corrente.`);let s=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(a&&a.grainTextureIdentity!==s)throw Error(`Il Grain Blend usato dalla cronologia non corrisponde alla risorsa corrente.`);let c=0,l=null;if(e.length===0){let i=o.submit(e,n,r,t);c=i.cpuMs,l=i.dirtyRect}else for(let i=0;i<e.length;i+=o.maximumBatchesPerSubmit){let a=e.slice(i,i+o.maximumBatchesPerSubmit),s=o.submit(a,n,r,t&&i===0);c+=s.cpuMs,l=this.mergeDirtyRects(l,s.dirtyRect)}t&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0);let u=this.submitImmediate([],!1,n,i,null,l,t);return{...u,totalCpuMs:u.totalCpuMs+c,brushEncodingMs:u.brushEncodingMs+c,scissorPixels:e.reduce((e,t)=>e+t.readRect.width*t.readRect.height,0),dirtyRect:l,shapeOccupancySelection:null}}submitImmediate(e,t,n=this.settings,r=!0,i=null,a=null,o=!1){if(Ci(n.blendMode)){if(this.lightGlazeSession)return this.submitLightGlazeImmediate(e,t,n,r,i);if(e.length>0)throw Error(`Stamp Light Glaze senza sessione per-stroke.`)}let s=this.isTexturizedGrainActive(n);s&&this.writeGrainUniforms(n);let c=performance.now();r&&this.ensurePresentationCacheTexture();let l=r?this.prepareThicknessTailFrame():null;l?.grainActive&&!s&&this.writeGrainUniforms(l.settings);let u=this.device.createCommandEncoder({label:`Brush frame encoder`}),d=0,f=0,p=0,m=0,h=0,g=0,_=a,v=null,y=0,b=0,x=0,S=0,C=0,w=0,T=0,E=0,ee=0,D=0,O=!1,k=this.paintDisplaySelectedMipLevel,A=0,te=0,ne=0,j=0,M=0,N=0,P=0,re=0,ie=0,ae=0,oe=0,se=0;if(i&&i.shapeMaskIdentity!==this.shapeMaskIdentity)throw Error(`La Shape usata dalla cronologia non corrisponde alla risorsa corrente.`);let ce=this.isTexturizedGrainActive(n)?this.grainTextureIdentity:null;if(i&&i.grainTextureIdentity!==ce)throw Error(`Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.`);if(t||e.length>0){let r=null,a=null;if(e.length>0){let t=performance.now(),o=this.packStamps(e,n);r=i?i.dirtyRect:o,d=performance.now()-t;let s=performance.now();this.device.queue.writeBuffer(this.instanceBuffer,0,this.instanceUpload,0,e.length*Gn),n.shape===`shape`&&(a=i?i.shapeOccupancySelection:this.selectShapeOccupancy(this.packedMinimumRadius)),f=performance.now()-s}_=r,v=a;let o=performance.now(),c=u.beginRenderPass({label:`Paint into 4096² layer`,colorAttachments:[{view:this.layerView,loadOp:t?`clear`:`load`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:0}}]});if(e.length>0&&r){g=r.width*r.height;let t=n.shape===`shape`,o=a?.selectedMipLevel??null,l=t&&o!==null,u=s?t?l?n.blendMode===`additive`?this.grainShapeOccupancyAdditivePipeline:this.grainShapeOccupancyNormalPipeline:n.blendMode===`additive`?this.grainShapeAdditivePipeline:this.grainShapeNormalPipeline:n.blendMode===`additive`?this.grainAdditivePipeline:this.grainNormalPipeline:t?l?n.blendMode===`additive`?this.shapeOccupancyAdditivePipeline:this.shapeOccupancyNormalPipeline:n.blendMode===`additive`?this.shapeAdditivePipeline:this.shapeNormalPipeline:n.blendMode===`additive`?this.additivePipeline:this.normalPipeline;c.setPipeline(u),c.setBindGroup(0,s?l?this.grainBrushOccupancyBindGroups[this.grainCoordinateMode(n)][n.grainFiltering][o]:this.grainBrushBindGroups[this.grainCoordinateMode(n)][n.grainFiltering]:l?this.brushOccupancyBindGroups[o]:this.brushBindGroup),c.setScissorRect(r.x,r.y,r.width,r.height),t&&a&&!i&&this.recordShapeSampling(a),c.draw(Yn,e.length*n.count,0,0),s&&(re=1,ie=e.length,ae=e.length*n.count,oe=+!t,se=+!!t)}c.end(),p=performance.now()-o}let F=t||o;if((F||_)&&this.noteLayerMutation(_,F),l){let e=performance.now();this.encodeThicknessTailFrame(u,l),p+=performance.now()-e}if(!r&&(t||e.length>0||a||o)&&(this.presentationCacheNeedsFullRebuild=!0,this.paintDisplayMipValidThroughLevel=0,this.deferRasterStrokeMutation(F)),r){let e=performance.now();k=this.desiredPaintDisplayMipLevel(),k!==this.paintDisplaySelectedMipLevel&&(this.presentationCacheNeedsFullRebuild=!0),this.paintDisplaySelectedMipLevel=k;let t=this.styleStackActive(),n=this.mergeDirtyRects(this.thicknessTailPresentedRect,l?.dirtyRect??null),r=this.mergeDirtyRects(_,n),i=l?this.mergeDirtyRects(this.layerContentBounds,l.dirtyRect):this.layerContentBounds,a=t?this.encodeRasterStrokeUpdate(u,l?`thickness-tail`:`permanent`,r,i,F):{dirtyRect:null,timing:null},o=F?{x:0,y:0,width:V,height:V}:_;if((F||t&&_)&&(this.paintDisplayMipValidThroughLevel=0),t){let e=performance.now(),t=this.encodeRasterStrokeDisplayPyramid(u,a.dirtyRect,k);A=+(t.passes>0),j=t.passes,M=a.dirtyRect?a.dirtyRect.width*a.dirtyRect.height:0,N=t.updatedPixels,P=performance.now()-e}else{let e=this.encodePaintDisplayPyramid(u,o,k);A=e.maintenanceFrames,te=e.fullLevelBuilds,ne=e.dirtyLevelUpdates,j=e.passes,M=e.baseDirtyPixels,N=e.updatedPixels,P=e.encodingMs}let s=this.canvas.width*this.canvas.height;ee=s,D=s;let c=this.presentationCacheNeedsFullRebuild||F,d=t?a.dirtyRect:this.mergeDirtyRects(_,this.mergeDirtyRects(this.thicknessTailPresentedRect,l?.dirtyRect??null)),f=c?{x:0,y:0,width:this.canvas.width,height:this.canvas.height}:d?this.layerDirtyRectToPresentationRect(d,k):null;if(f){this.writeDisplayUniforms(k),t&&this.rasterStrokeRenderer.updateDisplayParameters(l?`thickness-tail`:`permanent`,this.rasterStrokeStyle,this.rasterBevelStyle);let e=c&&k===0?performance.now():0,n=u.beginRenderPass({label:c?`Rebuild persistent presentation cache`:`Update persistent presentation cache dirty rect`,colorAttachments:[{view:this.presentationCacheView,loadOp:c?`clear`:`load`,storeOp:`store`,clearValue:{r:.02,g:.02,b:.025,a:1}}]});if(n.setPipeline(t?this.rasterStrokeDisplayPipeline:l?this.thicknessTailDisplayPipeline:this.displayPipeline),t?(n.setBindGroup(0,this.rasterStrokeDisplayScreenBindGroup),n.setBindGroup(1,this.rasterStrokeDisplayBindGroups.get(l?`thickness-tail`:`permanent`))):n.setBindGroup(0,l?this.thicknessTailDisplayBindGroup:this.displayBindGroup),c||n.setScissorRect(f.x,f.y,f.width,f.height),n.draw(3,1,0,0),n.end(),O=!0,e>0){let n=performance.now()-e;t?(S+=1,C+=n):(w+=1,T+=n)}E=f.width*f.height,c?y=1:b=1}else d&&(x=1);let p=this.context.getCurrentTexture();u.copyTextureToTexture({texture:this.presentationCacheTexture},{texture:p},{width:this.canvas.width,height:this.canvas.height,depthOrArrayLayers:1}),m=performance.now()-e}let le=performance.now();return this.device.queue.submit([u.finish()]),h=performance.now()-le,r&&O&&(this.presentationCacheNeedsFullRebuild=!1),r&&(this.thicknessTailPresentedRect=l?{...l.dirtyRect}:null),{totalCpuMs:performance.now()-c,stampPackingMs:d,instanceUploadMs:f,brushEncodingMs:p,displayEncodingMs:m,commandSubmitMs:h,scissorPixels:g,dirtyRect:_,shapeOccupancySelection:v,presentationCacheFullRebuilds:y,presentationCachePartialUpdates:b,presentationCacheOffscreenSkips:x,presentationCacheLod0FullRebuildTraceEnabledPasses:S,presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs:C,presentationCacheLod0FullRebuildTraceDisabledPasses:w,presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs:T,presentationCacheUpdatedPixels:E,legacyDisplayShaderPixels:ee,presentationCopiedPixels:D,displaySelectedMipLevel:k,paintDisplayPyramidMaintenanceFrames:A,paintDisplayPyramidFullLevelBuilds:te,paintDisplayPyramidDirtyLevelUpdates:ne,paintDisplayPyramidPasses:j,paintDisplayPyramidBaseDirtyPixels:M,paintDisplayPyramidUpdatedPixels:N,paintDisplayPyramidEncodingMs:P,lightGlazeBatches:0,lightGlazeCommits:0,lightGlazeCompositePixels:0,lightGlazePyramidPasses:0,lightGlazePyramidUpdatedPixels:0,grainBatches:re,grainBaseStamps:ie,grainPhysicalCopies:ae,grainCircleBatches:oe,grainShapeBatches:se}}packStampsIntoUpload(e,n,r,i){let a=V,o=V,s=0,c=0,l=1/0,u=Math.PI*n.shapeScatter,d=n.shape===`shape`?u>=Math.PI*.25?Math.SQRT2:Math.cos(u)+Math.sin(u):1;for(let t=0;t<e.length;t+=1){let u=e[t],f=Gn/4*t;r[f]=u.x,r[f+1]=u.y,r[f+2]=u.radius,r[f+3]=u.pressure,i[f+4]=u.seed,i[f+5]=0,r[f+6]=u.directionX,r[f+7]=u.directionY;let p=r[f],m=r[f+1],h=r[f+2];l=Math.min(l,h);let g=r[f+6],_=r[f+7],v=Math.hypot(g,_),y=h*2*n.positionJitterLinear,b=h*2*n.positionJitterLateral,x=h*d,S,C;if(v>2e-4){let e=g/v,t=_/v;S=x+Math.abs(e)*y+Math.abs(t)*b+2,C=x+Math.abs(t)*y+Math.abs(e)*b+2}else{let e=x+y+b+2;S=e,C=e}a=Math.min(a,p-S),o=Math.min(o,m-C),s=Math.max(s,p+S),c=Math.max(c,m+C)}let f=t(Math.floor(a),0,V-1),p=t(Math.floor(o),0,V-1),m=t(Math.ceil(s),1,V),h=t(Math.ceil(c),1,V),g=Math.max(0,m-f),_=Math.max(0,h-p);return{dirtyRect:g>0&&_>0?{x:f,y:p,width:g,height:_}:null,minimumRadius:l}}packStamps(e,t){let n=this.packStampsIntoUpload(e,t,this.instanceUploadF32,this.instanceUploadU32);return this.packedMinimumRadius=n.minimumRadius,n.dirtyRect}packThicknessTailStamps(e,t){return this.packStampsIntoUpload(e,t,this.thicknessTailInstanceUploadF32,this.thicknessTailInstanceUploadU32)}generateBenchmarkStamps(e,n){let r=Array(e),i=V*.5,a=V*.39;for(let o=0;o<e;o+=1){let s=e<=1?0:o/(e-1),c=s*Math.PI*18,l=a*(.12+s*.88),u=t(.58+Math.sin(s*Math.PI*15)*.28,.1,1),d=Math.max(.5,n.size*.5);r[o]={x:i+Math.cos(c)*l,y:i+Math.sin(c*1.037)*l,radius:d,pressure:u,seed:(Math.imul(this.seedSequence++,2654435761)^2769414579)>>>0,directionX:-Math.sin(c),directionY:Math.cos(c*1.037),historyActionId:0}}return r}recordRenderedFrame(e){this.renderTimestamps.push(e);let t=e-1e3;for(;this.renderTimestamps.length>0&&this.renderTimestamps[0]<t;)this.renderTimestamps.shift()}recordStampGenerationTime(e){e>0&&this.activeStrokeProfile&&(this.activeStrokeProfile.stampGenerationMs+=performance.now()-e)}recordStrokeFrameTiming(e,t,n,r,i){let a=this.activeStrokeProfile;a&&(a.previousFrameTimestamp!==null&&a.renderIntervalMs.push(Math.max(0,e-a.previousFrameTimestamp)),a.previousFrameTimestamp=e,a.renderFrames+=1,a.cpuFrameMs.push(this.lastCpuFrameMs),a.renderFrameTotalMs.push(i.totalCpuMs),a.renderFrameOverheadMs.push(Math.max(0,i.totalCpuMs-r.totalCpuMs)),a.resizeCanvasMs+=i.resizeCanvasMs,a.batchExtractionMs+=i.batchExtractionMs,a.statsPublishMs+=i.statsPublishMs,a.stampPackingMs+=r.stampPackingMs,a.instanceUploadMs+=r.instanceUploadMs,a.brushEncodingMs+=r.brushEncodingMs,a.displayEncodingMs+=r.displayEncodingMs,a.commandSubmitMs+=r.commandSubmitMs,a.estimatedScissorPixels+=r.scissorPixels,a.presentationCacheFullRebuilds+=r.presentationCacheFullRebuilds,a.presentationCachePartialUpdates+=r.presentationCachePartialUpdates,a.presentationCacheOffscreenSkips+=r.presentationCacheOffscreenSkips,a.presentationCacheLod0FullRebuildTraceEnabledPasses+=r.presentationCacheLod0FullRebuildTraceEnabledPasses,a.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs+=r.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs,a.presentationCacheLod0FullRebuildTraceDisabledPasses+=r.presentationCacheLod0FullRebuildTraceDisabledPasses,a.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs+=r.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs,a.presentationCacheUpdatedPixels+=r.presentationCacheUpdatedPixels,a.legacyDisplayShaderPixels+=r.legacyDisplayShaderPixels,a.presentationCopiedPixels+=r.presentationCopiedPixels,a.paintDisplayMaximumSelectedMipLevel=Math.max(a.paintDisplayMaximumSelectedMipLevel,r.displaySelectedMipLevel),a.paintDisplayPyramidMaintenanceFrames+=r.paintDisplayPyramidMaintenanceFrames,a.paintDisplayPyramidFullLevelBuilds+=r.paintDisplayPyramidFullLevelBuilds,a.paintDisplayPyramidDirtyLevelUpdates+=r.paintDisplayPyramidDirtyLevelUpdates,a.paintDisplayPyramidPasses+=r.paintDisplayPyramidPasses,a.paintDisplayPyramidBaseDirtyPixels+=r.paintDisplayPyramidBaseDirtyPixels,a.paintDisplayPyramidUpdatedPixels+=r.paintDisplayPyramidUpdatedPixels,a.paintDisplayPyramidEncodingMs+=r.paintDisplayPyramidEncodingMs,a.lightGlazeBatches+=r.lightGlazeBatches,a.lightGlazeCommits+=r.lightGlazeCommits,a.lightGlazeCompositePixels+=r.lightGlazeCompositePixels,a.lightGlazePyramidPasses+=r.lightGlazePyramidPasses,a.lightGlazePyramidUpdatedPixels+=r.lightGlazePyramidUpdatedPixels,a.grainBatches+=r.grainBatches,a.grainBaseStamps+=r.grainBaseStamps,a.grainPhysicalCopies+=r.grainPhysicalCopies,a.grainCircleBatches+=r.grainCircleBatches,a.grainShapeBatches+=r.grainShapeBatches,t>0&&(a.brushBatches+=1,a.physicalCopies+=t*n,a.largestBatchStamps=Math.max(a.largestBatchStamps,t)))}publishStats(){this.callbacks.onStats?.(this.getStats())}publishHistoryState(){this.callbacks.onHistoryChange?.(this.getHistoryState())}async assertShaderCompiled(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length===0)return;let r=n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(`
`);throw Error(`Errore WGSL nel modulo ${t}:\n${r}`)}describeAdapter(e){let t=e.info,n=[t.vendor,t.architecture,t.device,t.description].map(e=>e?.trim()).filter(e=>!!e);return[...new Set(n)].join(` · `)||`GPU WebGPU`}};function G(e){let t=document.getElementById(e);if(!t)throw Error(`Elemento #${e} non trovato.`);return t}function K(e){return Number(G(e).value)}function Vi(e){return new Intl.NumberFormat(`it-IT`,{maximumFractionDigits:0}).format(e)}var Hi=new Intl.NumberFormat(`it-IT`,{minimumFractionDigits:1,maximumFractionDigits:1});function Ui(e){return e===0?`0 MiB`:e>0&&e<.05?`<0,1 MiB`:`${Hi.format(e)} MiB`}var Wi=G(`gpuCanvas`),Gi=G(`tipPreviewCanvas`),Ki=G(`controlsPanel`),qi=G(`toggleControls`),Ji=G(`status`),Yi=G(`runBenchmark`),Xi=G(`benchmarkResult`),Zi=G(`rasterStrokeGoldenSection`),Qi=G(`runRasterStrokeGolden`),$i=G(`rasterStrokeGoldenResult`),ea=G(`rasterStrokeGoldenDetails`),ta=G(`rasterStrokeGoldenReport`),na=G(`recordHumanStroke`),ra=G(`playHumanStroke`),ia=G(`playBlendHumanStroke`),q=G(`humanStrokeResult`),aa=G(`humanStrokeTestVariant`),oa=G(`humanStrokeTestBlendMode`),sa=G(`humanStrokeTestGrainMode`),ca=G(`layerFormat`),la=G(`clearLayer`),ua=G(`undoStroke`),da=G(`redoStroke`),fa=G(`fitView`),pa=G(`zoomIn`),ma=G(`zoomOut`),ha=G(`benchmarkStamps`),ga=G(`gpuMemoryPanel`),_a=G(`gpuMemoryToggle`),va=G(`gpuMemoryClose`),ya=G(`gpuMemoryChevron`),ba=G(`gpuMemoryDelta`),xa=`webgpu-brush-engine.human-stroke.v1`,Sa=`/api/human-stroke`,Ca=`/api/benchmark-runs`,J={canUndo:!1,canRedo:!1,busy:!1,actionCount:0,cursor:0,storedBaseStamps:0,logicalStampBytes:0},Y=new Bi(Wi,{onStatus(e,t){Ji.textContent=e,Ji.className=`status ${t===`working`?``:t}`},onStats(e){Go(e)},onHistoryChange(e){J=e,Q(),Z()}},Gi),wa=null,Ta=null,Ea=!1,Da=!1,Oa=!0,ka=!1,Aa=!1,ja=!1,Ma=!1,Na=!1,Pa=!1,Fa=!1,Ia=!1,La=!0,Ra=!1,za=null,Ba=null,Va=`paint`,Ha=[[`gpuMemoryLayerBase`,`layerBaseMiB`],[`gpuMemoryLayerMips`,`layerMipChainMiB`],[`gpuMemoryGrain`,`grainTextureMiB`],[`gpuMemoryShape`,`shapeTextureMiB`],[`gpuMemoryPaintBuffers`,`paintBuffersMiB`],[`gpuMemoryPresentation`,`presentationCacheMiB`],[`gpuMemoryStrokeStyled`,`rasterStrokeStyledMiB`],[`gpuMemoryStrokeCoverage`,`rasterStrokeCoverageMiB`],[`gpuMemoryStrokeControl`,`rasterStrokeMaskAndControlMiB`],[`gpuMemoryStrokeScratch`,`rasterStrokeScratchMiB`],[`gpuMemoryBevelHeight`,`rasterBevelHeightMiB`],[`gpuMemoryBevelControl`,`rasterBevelLutAndControlMiB`],[`gpuMemoryBevelScratch`,`rasterBevelScratchMiB`],[`gpuMemoryBlend`,`blendRendererMiB`],[`gpuMemoryLightGlaze`,`lightGlazeMiB`],[`gpuMemoryThicknessTail`,`thicknessTailMiB`],[`gpuMemoryHistory`,`historyCpuMiB`]],Ua={paint:{size:96,spacing:1,flow:7,hardness:88},blend:{size:100,spacing:10,flow:45,hardness:8}};function Wa(){Ua[Va]={size:K(`brushSize`),spacing:K(`spacing`),flow:K(`flow`),hardness:K(`hardness`)}}function Ga(e,t){let n=Va;t&&n!==e&&Wa(),Va=e,X(`brushTool`,e);let r=e===`blend`,i=G(`brushSize`),a=G(`spacing`);if(i.min=r?`1`:`4`,i.max=r?`1024`:`1500`,a.min=r?`1`:`0.25`,a.max=r?`400`:`25`,a.step=r?`1`:`0.25`,t&&n!==e){let t=Ua[e];X(`brushSize`,t.size),X(`spacing`,t.spacing),X(`flow`,t.flow),X(`hardness`,t.hardness)}for(let e of[`shapeScatterControl`,`countControl`,`opacityControl`,`paintBlendIntensityControl`,`paintBlendModeControl`,`thicknessSection`,`colorJitterSection`,`positionJitterSection`])G(e).hidden=r;G(`blendControls`).hidden=!r}function Ka(e){La=e,Ki.hidden=!e,qi.setAttribute(`aria-expanded`,String(e)),qi.setAttribute(`aria-label`,e?`Nascondi pannelli`:`Mostra pannelli`),qi.title=e?`Nascondi pannelli`:`Mostra pannelli`}function qa(e){Ra=e,ga.hidden=!e,_a.setAttribute(`aria-expanded`,String(e)),_a.title=e?`Chiudi dettaglio memoria GPU`:`Apri dettaglio memoria GPU`,ya.textContent=e?`▾`:`▴`}function Ja(){return{tool:G(`brushTool`).value===`blend`?`blend`:`paint`,shape:G(`brushShape`).value,shapeScatter:K(`shapeScatter`)/100,grainMode:G(`grainMode`).value,grainScale:K(`grainScale`)/100,grainDepth:K(`grainDepth`)/100,grainBrightness:K(`grainBrightness`)/100,grainContrast:K(`grainContrast`)/100,grainInvert:G(`grainInvert`).checked,grainFiltering:G(`grainFiltering`).value,grainBlendMode:G(`grainBlendMode`).value,color:G(`brushColor`).value,size:K(`brushSize`),spacingPercent:K(`spacing`),startThickness:K(`startThickness`)/100,endThickness:K(`endThickness`)/100,count:K(`count`),flow:K(`flow`)/100,opacity:K(`opacity`)/100,hardness:K(`hardness`)/100,blendIntensity:K(`blendIntensity`),blendMode:G(`blendMode`).value,blendStretch:K(`blendStretch`)/100,blendPaint:K(`blendPaint`)/100,jitterMaster:K(`jitterMaster`)/100,hueJitterDegrees:K(`hueJitter`),saturationJitter:K(`saturationJitter`)/100,lightnessJitter:K(`lightnessJitter`)/100,darknessJitter:K(`darknessJitter`)/100,jitterPerCopy:G(`jitterPerCopy`).checked,positionJitterLateral:K(`positionJitterLateral`)/100,positionJitterLinear:K(`positionJitterLinear`)/100}}function Ya(){G(`shapeScatterOut`).value=`${K(`shapeScatter`).toFixed(0)}%`,G(`grainScaleOut`).value=`${K(`grainScale`).toFixed(0)}%`,G(`grainDepthOut`).value=`${K(`grainDepth`).toFixed(0)}%`;let e=K(`grainBrightness`);G(`grainBrightnessOut`).value=`${e>0?`+`:``}${e.toFixed(0)}%`;let t=K(`grainContrast`);G(`grainContrastOut`).value=`${t>0?`+`:``}${t.toFixed(0)}%`,G(`brushSizeOut`).value=`${K(`brushSize`).toFixed(0)} px`,G(`spacingOut`).value=`${K(`spacing`).toFixed(2)}%`,G(`startThicknessOut`).value=`${K(`startThickness`).toFixed(0)}%`,G(`endThicknessOut`).value=`${K(`endThickness`).toFixed(0)}%`,G(`countOut`).value=K(`count`).toFixed(0),G(`flowOut`).value=`${K(`flow`).toFixed(1).replace(`.0`,``)}%`,G(`opacityOut`).value=`${K(`opacity`).toFixed(1).replace(`.0`,``)}%`,G(`hardnessOut`).value=`${K(`hardness`).toFixed(0)}%`,G(`blendIntensityOut`).value=`${K(`blendIntensity`).toFixed(2)}×`,G(`blendStretchOut`).value=`${K(`blendStretch`).toFixed(0)}%`,G(`blendPaintOut`).value=`${K(`blendPaint`).toFixed(0)}%`,G(`jitterMasterOut`).value=`${K(`jitterMaster`).toFixed(0)}%`,G(`hueJitterOut`).value=`${K(`hueJitter`).toFixed(0)}°`,G(`saturationJitterOut`).value=`${K(`saturationJitter`).toFixed(0)}%`,G(`lightnessJitterOut`).value=`${K(`lightnessJitter`).toFixed(0)}%`,G(`darknessJitterOut`).value=`${K(`darknessJitter`).toFixed(0)}%`,G(`positionJitterLateralOut`).value=`${K(`positionJitterLateral`).toFixed(0)}%`,G(`rasterStrokeWidthOut`).value=`${K(`rasterStrokeWidth`).toFixed(0)} px`,G(`rasterBevelSizeOut`).value=`${K(`rasterBevelSize`).toFixed(1).replace(`.0`,``)} px`,G(`rasterBevelSoftenOut`).value=`${K(`rasterBevelSoften`).toFixed(1).replace(`.0`,``)} px`,G(`rasterBevelDepthOut`).value=`${K(`rasterBevelDepth`).toFixed(0)}%`,G(`rasterBevelAngleOut`).value=`${K(`rasterBevelAngle`).toFixed(0)}°`,G(`rasterBevelAltitudeOut`).value=`${K(`rasterBevelAltitude`).toFixed(0)}°`,G(`rasterBevelRangeOut`).value=`${K(`rasterBevelRange`).toFixed(0)}%`,G(`rasterBevelFillOut`).value=`${K(`rasterBevelFill`).toFixed(0)}%`,G(`rasterBevelHighlightOpacityOut`).value=`${K(`rasterBevelHighlightOpacity`).toFixed(0)}%`,G(`rasterBevelShadowOpacityOut`).value=`${K(`rasterBevelShadowOpacity`).toFixed(0)}%`,G(`positionJitterLinearOut`).value=`${K(`positionJitterLinear`).toFixed(0)}%`,G(`benchmarkStampsOut`).value=Vi(K(`benchmarkStamps`))}function Xa(){Wa(),Ya(),Ho(),Y.setBrushSettings(Ja())}function Za(e){return`${(e/1e3).toFixed(2)} s`}function Qa(e,t){if(e.length===0)return 0;let n=[...e].sort((e,t)=>e-t);return n[Math.min(n.length-1,Math.max(0,Math.ceil(n.length*t)-1))]}function $a(){return new Promise(e=>requestAnimationFrame(e))}function eo(e){let t=2166136261;for(let n of e)for(let e of[Math.round(n.x*10),Math.round(n.y*10),Math.round(n.pressure*1e3),Math.round(n.timeMs*10)])t=Math.imul(t^e,16777619)>>>0;return t.toString(16).padStart(8,`0`)}function to(e){let t=0,n=0,r=[];for(let i=1;i<e.length;i+=1){let a=e[i-1],o=e[i],s=Math.max(0,o.timeMs-a.timeMs),c=Math.hypot(o.x-a.x,o.y-a.y);t+=c,r.push(s),s>0&&(n=Math.max(n,c/s*1e3))}let i=e.at(-1)?.timeMs??0;return{pathLengthPx:t,averageSpeedPxPerSecond:i>0?t/i*1e3:0,peakSpeedPxPerSecond:n,sampleGapP95Ms:Qa(r,.95),sampleGapMaxMs:r.length===0?0:Math.max(...r),inputGapsOver33Ms:r.filter(e=>e>33).length}}function no(){let e=navigator,t=Y.getBenchmarkEnvironment();return{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio:window.devicePixelRatio||1,screenWidth:window.screen.width,screenHeight:window.screen.height,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGiB:e.deviceMemory??null,connection:e.connection?.effectiveType??e.connection?.type??null,controlsLayoutStrategy:`full-stage-overlay-drawer`,touchNavigationStrategy:`two-finger-pan-pinch`,performanceTelemetryRevision:40,...t}}async function ro(e){let t=await fetch(Ca,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.`);let n=await t.json();return typeof n.id==`number`?n.id:0}function io(e){if(typeof e!=`object`||!e)return null;let t=e;if(t.version!==1||!t.settings||!Array.isArray(t.points)||t.points.length===0)return null;let n=t,r=Number.isFinite(n.settings.opacity)?Math.min(1,Math.max(0,n.settings.opacity)):1,i=n.settings.blendMode===`additive`||n.settings.blendMode===`light-glaze`||n.settings.blendMode===`m1-glaze`?n.settings.blendMode:`normal`,a=n.settings.grainMode===`texturized`||n.settings.grainMode===`moving`?n.settings.grainMode:`off`,o=Number.isFinite(n.settings.grainScale)?Math.min(4,Math.max(.1,n.settings.grainScale)):1.4,s=Number.isFinite(n.settings.grainDepth)?Math.min(1,Math.max(0,n.settings.grainDepth)):1,c=Number.isFinite(n.settings.grainBrightness)?Math.min(1,Math.max(-1,n.settings.grainBrightness)):0,l=Number.isFinite(n.settings.grainContrast)?Math.min(1,Math.max(-1,n.settings.grainContrast)):0,u=n.settings.grainInvert===!0,d=n.settings.grainFiltering===`no`||n.settings.grainFiltering===`classic`?n.settings.grainFiltering:`improved`,f=Number.isFinite(n.settings.startThickness)?Math.min(2,Math.max(0,n.settings.startThickness)):1,p=Number.isFinite(n.settings.endThickness)?Math.min(2,Math.max(0,n.settings.endThickness)):1,m=Number.isFinite(n.settings.blendStretch)?Math.min(1,Math.max(0,n.settings.blendStretch)):.18,h=Number.isFinite(n.settings.blendPaint)?Math.min(1,Math.max(0,n.settings.blendPaint)):.14,g={...n.settings};return delete g.speedThickness,delete g.pressureSize,delete g.pressureOpacity,{...n,settings:{...g,tool:`paint`,shape:n.settings.shape===`shape`?`shape`:`circle`,shapeScatter:Number.isFinite(n.settings.shapeScatter)?Math.min(1,Math.max(0,n.settings.shapeScatter)):0,grainMode:a,grainScale:o,grainDepth:s,grainBrightness:c,grainContrast:l,grainInvert:u,grainFiltering:d,grainBlendMode:`multiply`,startThickness:f,endThickness:p,opacity:r,blendMode:i,blendStretch:m,blendPaint:h}}}function ao(){try{let e=window.localStorage.getItem(xa);return e?io(JSON.parse(e)):null}catch{return null}}function oo(){try{window.localStorage.removeItem(xa)}catch{}}async function so(){let e=await fetch(Sa,{cache:`no-store`});if(e.status===404)return null;if(!e.ok)throw Error(`Impossibile caricare il tratto umano di riferimento.`);return io(await e.json())}async function co(e){let t=await fetch(Sa,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(t.status===409){let e=io(await t.json());if(e)return e}if(!t.ok)throw Error(`Impossibile fissare il tratto umano di riferimento.`);let n=io(await t.json());if(!n)throw Error(`Il tratto umano salvato non è valido.`);return n}async function lo(){Oa=!0,Z();try{let e=await so();if(e){wa=e,oo(),q.textContent=Bo(e);return}let t=ao();if(t){q.textContent=`Fissaggio del tratto che avevi già registrato…`,wa=await co(t),oo(),q.textContent=Bo(wa);return}q.textContent=`Nessun tratto di riferimento: registralo una sola volta.`}catch(e){q.textContent=e instanceof Error?e.message:String(e)}finally{Oa=!1,Z()}}function X(e,t){G(e).value=String(t)}function uo(e){let t=/^#([0-9a-f]{6})$/i.exec(e);if(!t)return[1,.643,.282,1];let n=Number.parseInt(t[1],16);return[(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255,1]}function fo(e){let t=e=>Math.round(Math.max(0,Math.min(1,e))*255).toString(16).padStart(2,`0`);return`#${t(e[0])}${t(e[1])}${t(e[2])}`}function po(){return{enabled:G(`rasterStrokeEnabled`).checked,width:K(`rasterStrokeWidth`),position:G(`rasterStrokePosition`).value,color:uo(G(`rasterStrokeColor`).value)}}function mo(e){G(`rasterStrokeEnabled`).checked=e.enabled,X(`rasterStrokeWidth`,e.width),X(`rasterStrokePosition`,e.position),X(`rasterStrokeColor`,fo(e.color)),G(`rasterStrokeWidthOut`).value=`${e.width.toFixed(0)} px`,G(`rasterStrokeParameters`).hidden=!e.enabled}var ho=[`rasterStrokeEnabled`,`rasterStrokeWidth`,`rasterStrokePosition`,`rasterStrokeColor`];function go(e=Lo()){let t=G(`rasterStrokeEnabled`).checked;G(`rasterStrokeParameters`).hidden=!t;for(let n of ho)G(n).disabled=e||Na||n!==`rasterStrokeEnabled`&&!t}async function _o(){if(!Ia||Na||$!==null){mo(Y.getRasterStrokeStyle()),go();return}Na=!0,Q(),Z();try{await Y.setRasterStrokeStyle(po())||mo(Y.getRasterStrokeStyle())}catch{mo(Y.getRasterStrokeStyle())}finally{Na=!1,Q(),Z()}}function vo(e,t){let n=/^#([0-9a-f]{6})$/i.exec(e);if(!n)return[...t];let r=Number.parseInt(n[1],16);return[(r>>>16&255)/255,(r>>>8&255)/255,(r&255)/255]}function yo(e){let t=e=>Math.round(Math.max(0,Math.min(1,e))*255).toString(16).padStart(2,`0`);return`#${t(e[0])}${t(e[1])}${t(e[2])}`}function bo(){return{enabled:G(`rasterBevelEnabled`).checked,mode:G(`rasterBevelMode`).value,technique:G(`rasterBevelTechnique`).value,direction:G(`rasterBevelDirection`).value,size:K(`rasterBevelSize`),soften:K(`rasterBevelSoften`),depth:K(`rasterBevelDepth`),angle:K(`rasterBevelAngle`),altitude:K(`rasterBevelAltitude`),highlightColor:vo(G(`rasterBevelHighlightColor`).value,[1,.957,.875]),highlightOpacity:K(`rasterBevelHighlightOpacity`),shadowColor:vo(G(`rasterBevelShadowColor`).value,[.141,.078,.035]),shadowOpacity:K(`rasterBevelShadowOpacity`),gloss:G(`rasterBevelGloss`).value,contourAA:G(`rasterBevelContourAA`).checked,bevelContourEnabled:G(`rasterBevelContourEnabled`).checked,bevelContour:G(`rasterBevelContour`).value,bevelRange:K(`rasterBevelRange`),fill:K(`rasterBevelFill`)}}function xo(){G(`rasterBevelSizeOut`).value=`${K(`rasterBevelSize`).toFixed(1).replace(`.0`,``)} px`,G(`rasterBevelSoftenOut`).value=`${K(`rasterBevelSoften`).toFixed(1).replace(`.0`,``)} px`;for(let e of[`Depth`,`Range`,`Fill`,`HighlightOpacity`,`ShadowOpacity`])G(`rasterBevel${e}Out`).value=`${K(`rasterBevel${e}`).toFixed(0)}%`;G(`rasterBevelAngleOut`).value=`${K(`rasterBevelAngle`).toFixed(0)}°`,G(`rasterBevelAltitudeOut`).value=`${K(`rasterBevelAltitude`).toFixed(0)}°`}function So(e){G(`rasterBevelEnabled`).checked=e.enabled,X(`rasterBevelMode`,e.mode),X(`rasterBevelTechnique`,e.technique),X(`rasterBevelDirection`,e.direction),X(`rasterBevelSize`,e.size),X(`rasterBevelSoften`,e.soften),X(`rasterBevelDepth`,e.depth),X(`rasterBevelAngle`,e.angle),X(`rasterBevelAltitude`,e.altitude),X(`rasterBevelHighlightColor`,yo(e.highlightColor)),X(`rasterBevelHighlightOpacity`,e.highlightOpacity),X(`rasterBevelShadowColor`,yo(e.shadowColor)),X(`rasterBevelShadowOpacity`,e.shadowOpacity),X(`rasterBevelGloss`,e.gloss),G(`rasterBevelContourAA`).checked=e.contourAA,G(`rasterBevelContourEnabled`).checked=e.bevelContourEnabled,X(`rasterBevelContour`,e.bevelContour),X(`rasterBevelRange`,e.bevelRange),X(`rasterBevelFill`,e.fill),G(`rasterBevelParameters`).hidden=!e.enabled,xo()}var Co=[`rasterBevelEnabled`,`rasterBevelMode`,`rasterBevelTechnique`,`rasterBevelDirection`,`rasterBevelSize`,`rasterBevelSoften`,`rasterBevelDepth`,`rasterBevelAngle`,`rasterBevelAltitude`,`rasterBevelGloss`,`rasterBevelContourAA`,`rasterBevelContourEnabled`,`rasterBevelContour`,`rasterBevelRange`,`rasterBevelFill`,`rasterBevelHighlightColor`,`rasterBevelHighlightOpacity`,`rasterBevelShadowColor`,`rasterBevelShadowOpacity`];function wo(e=Lo()){let t=G(`rasterBevelEnabled`).checked,n=G(`rasterBevelContourEnabled`).checked;G(`rasterBevelParameters`).hidden=!t;for(let r of Co){let i=r===`rasterBevelContour`||r===`rasterBevelRange`;G(r).disabled=e||Fa||r!==`rasterBevelEnabled`&&!t||i&&!n}}async function To(){if(!Ia||Fa||$!==null){So(Y.getRasterBevelStyle()),wo();return}Fa=!0,Q(),Z();try{await Y.setRasterBevelStyle(bo())||So(Y.getRasterBevelStyle())}catch{So(Y.getRasterBevelStyle())}finally{Fa=!1,Q(),Z()}}function Eo(e){Ga(e.tool===`blend`?`blend`:`paint`,!1),X(`brushShape`,e.shape===`shape`?`shape`:`circle`),X(`shapeScatter`,(e.shapeScatter??0)*100),X(`grainMode`,e.grainMode===`texturized`||e.grainMode===`moving`?e.grainMode:`off`),X(`grainScale`,(e.grainScale??1.4)*100),X(`grainDepth`,(e.grainDepth??1)*100),X(`grainBrightness`,(e.grainBrightness??0)*100),X(`grainContrast`,(e.grainContrast??0)*100),G(`grainInvert`).checked=e.grainInvert===!0,X(`grainFiltering`,e.grainFiltering===`no`||e.grainFiltering===`classic`?e.grainFiltering:`improved`),X(`grainBlendMode`,`multiply`),X(`brushColor`,e.color),X(`brushSize`,e.size),X(`spacing`,e.spacingPercent),X(`startThickness`,(e.startThickness??1)*100),X(`endThickness`,(e.endThickness??1)*100),X(`count`,e.count),X(`flow`,e.flow*100),X(`opacity`,(e.opacity??1)*100),X(`hardness`,e.hardness*100),X(`blendIntensity`,e.blendIntensity),X(`blendMode`,e.blendMode),X(`blendStretch`,(e.blendStretch??.18)*100),X(`blendPaint`,(e.blendPaint??.14)*100),X(`jitterMaster`,e.jitterMaster*100),X(`hueJitter`,e.hueJitterDegrees),X(`saturationJitter`,e.saturationJitter*100),X(`lightnessJitter`,e.lightnessJitter*100),X(`darknessJitter`,e.darknessJitter*100),G(`jitterPerCopy`).checked=e.jitterPerCopy,X(`positionJitterLateral`,e.positionJitterLateral*100),X(`positionJitterLinear`,e.positionJitterLinear*100),Xa()}function Do(){return Ga(`paint`,!1),X(`brushShape`,`circle`),X(`shapeScatter`,0),X(`grainMode`,`off`),X(`grainScale`,140),X(`grainDepth`,100),X(`grainBrightness`,0),X(`grainContrast`,0),G(`grainInvert`).checked=!1,X(`grainFiltering`,`improved`),X(`grainBlendMode`,`multiply`),X(`brushSize`,750),X(`spacing`,1),X(`startThickness`,100),X(`endThickness`,100),X(`count`,16),X(`flow`,100),X(`opacity`,100),X(`hardness`,100),X(`blendIntensity`,4),X(`blendMode`,`normal`),X(`blendStretch`,18),X(`blendPaint`,14),X(`jitterMaster`,100),X(`hueJitter`,180),X(`saturationJitter`,100),G(`jitterPerCopy`).checked=!0,X(`positionJitterLateral`,100),X(`positionJitterLinear`,100),Xa(),Ja()}function Oo(){return aa.value===`fur`?`fur`:`base`}function ko(){return oa.value===`m1-glaze`?`m1-glaze`:`normal`}function Ao(){return sa.value===`texturized`?`texturized`:`off`}function jo(e,t,n,r){let i={...e.settings,tool:`paint`,opacity:1,blendIntensity:n===`m1-glaze`?1:4,blendMode:n,blendStretch:.18,blendPaint:.14,grainMode:r,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,shape:`circle`,shapeScatter:0,startThickness:1,endThickness:1,positionJitterLateral:1,positionJitterLinear:1};return t===`fur`?{...i,shape:`shape`,shapeScatter:1,positionJitterLateral:0,positionJitterLinear:0}:i}function Mo(e){return{...e.settings,tool:`blend`,shape:`circle`,shapeScatter:0,grainMode:`off`,grainScale:1.4,grainDepth:1,grainBrightness:0,grainContrast:0,grainInvert:!1,grainFiltering:`improved`,grainBlendMode:`multiply`,size:e.settings.size,spacingPercent:1,startThickness:1,endThickness:1,count:1,flow:1,opacity:1,hardness:1,blendIntensity:1,blendMode:`normal`,blendStretch:.2,blendPaint:0,jitterMaster:0,hueJitterDegrees:0,saturationJitter:0,lightnessJitter:0,darknessJitter:0,jitterPerCopy:!1,positionJitterLateral:0,positionJitterLinear:0}}function No(e,t,n){return`${e===`fur`?`Fur`:`Base`} · ${t===`m1-glaze`?`M1 Glaze non accumulativo · 1×`:`Normal accumulativo · 4×`} · ${n===`texturized`?`Grain Fixed M1`:`Grain Off`}`}var Po=`Blend dry · sfondo multicolore · spacing 1% · flow 100% · hardness 100% · Paint 0% · Stretch 20%`;async function Fo(e){let t=[`#ff334f`,`#ff9f1c`,`#f4e04d`,`#20c997`,`#2d7ff9`,`#8b5cf6`],n={...e,tool:`paint`,shape:`circle`,shapeScatter:0,grainMode:`off`,size:1500,spacingPercent:15,startThickness:1,endThickness:1,count:1,flow:1,opacity:1,hardness:1,blendIntensity:1,blendMode:`normal`,jitterMaster:0,hueJitterDegrees:0,saturationJitter:0,lightnessJitter:0,darknessJitter:0,jitterPerCopy:!1,positionJitterLateral:0,positionJitterLinear:0};try{for(let e=0;e<t.length;e+=1){let r=Y.layerSize*e/(t.length-1),i=e*10;Y.setBrushSettings({...n,color:t[e]}),Y.beginStrokeAtLayer({x:0,y:r,pressure:1,timeMs:i}),Y.extendStrokeAtLayer([{x:Y.layerSize,y:r,pressure:1,timeMs:i+1}]),Y.endStroke(i+1),await Y.waitForIdle()}}finally{Y.setBrushSettings(e),await Y.waitForIdle()}}function Z(){let e=!Ia||Pa||J.busy||Aa||ja||Ma||Na||Fa;na.disabled=e||Oa||ka||Da||!!wa,na.textContent=Ea?`Annulla registrazione tratto`:wa?`Tratto umano fissato`:`Registra tratto umano`,ra.disabled=e||!wa||Oa||ka||Da,ia.disabled=e||!wa||Oa||ka||Da,aa.disabled=e||Oa||ka||Da||Ea||!!Ta,oa.disabled=e||Oa||ka||Da||Ea||!!Ta,sa.disabled=e||Oa||ka||Da||Ea||!!Ta}function Io(){return!Ia||Pa||J.busy||Aa||ja||Ma||Na||Fa||Da||ka}function Lo(){return Io()||$!==null}function Q(){let e=Lo();ua.disabled=e||!J.canUndo,da.disabled=e||!J.canRedo,la.disabled=e;let t=Va===`blend`;Yi.disabled=e||t,ha.disabled=e||t,Qi.disabled=e,ca.disabled=e,fa.disabled=e,pa.disabled=e,ma.disabled=e,qi.disabled=Aa||ja||Da;for(let t of Uo)G(t).disabled=e;Ho(e),go(e),wo(e)}async function Ro(e){if(!(Lo()||$!==null)&&!(e===`undo`?!J.canUndo:!J.canRedo)){Pa=!0,Q(),Z();try{e===`undo`?await Y.undo():await Y.redo()}catch(e){Ji.textContent=e instanceof Error?e.message:String(e),Ji.className=`status error`}finally{Pa=!1,J=Y.getHistoryState(),Q(),Z()}}}async function zo(){if(!(Lo()||$!==null)){Pa=!0,Q(),Z();try{await Y.clear()}catch(e){Ji.textContent=e instanceof Error?e.message:String(e),Ji.className=`status error`}finally{Pa=!1,J=Y.getHistoryState(),Q(),Z()}}}function Bo(e){let t=e.points.at(-1)?.timeMs??0;return[`Tratto salvato: ${Vi(e.points.length)} campioni`,`durata ${Za(t)}`,`size ${e.settings.size.toFixed(0)} px`,`Count ${e.settings.count}`].join(` · `)}var Vo=[`grainScale`,`grainDepth`,`grainBrightness`,`grainContrast`,`grainInvert`,`grainFiltering`,`grainBlendMode`];function Ho(e=Lo()){let t=G(`grainMode`).value,n=t===`texturized`||t===`moving`;G(`grainParameters`).hidden=!n;for(let r of Vo)G(r).disabled=e||!n||r===`grainScale`&&t===`moving`}var Uo=[`brushTool`,`brushShape`,`shapeScatter`,`grainMode`,...Vo,`brushColor`,`brushSize`,`spacing`,`startThickness`,`endThickness`,`count`,`flow`,`opacity`,`hardness`,`blendIntensity`,`blendMode`,`blendStretch`,`blendPaint`,`jitterMaster`,`hueJitter`,`saturationJitter`,`lightnessJitter`,`darknessJitter`,`jitterPerCopy`,`positionJitterLateral`,`positionJitterLinear`];for(let e of Uo)e!==`brushTool`&&(G(e).addEventListener(`input`,Xa),G(e).addEventListener(`change`,Xa));G(`rasterStrokeEnabled`).addEventListener(`change`,()=>{go(),_o()}),G(`rasterStrokeWidth`).addEventListener(`input`,()=>{G(`rasterStrokeWidthOut`).value=`${K(`rasterStrokeWidth`).toFixed(0)} px`}),G(`rasterStrokeWidth`).addEventListener(`change`,()=>{_o()}),G(`rasterStrokePosition`).addEventListener(`change`,()=>{_o()}),G(`rasterStrokeColor`).addEventListener(`change`,()=>{_o()}),G(`rasterBevelEnabled`).addEventListener(`change`,()=>{wo(),To()}),G(`rasterBevelContourEnabled`).addEventListener(`change`,()=>{wo(),To()});for(let e of[`rasterBevelSize`,`rasterBevelSoften`,`rasterBevelDepth`,`rasterBevelAngle`,`rasterBevelAltitude`,`rasterBevelRange`,`rasterBevelFill`,`rasterBevelHighlightOpacity`,`rasterBevelShadowOpacity`])G(e).addEventListener(`input`,xo),G(e).addEventListener(`change`,()=>{To()});for(let e of[`rasterBevelMode`,`rasterBevelTechnique`,`rasterBevelDirection`,`rasterBevelGloss`,`rasterBevelContourAA`,`rasterBevelContour`,`rasterBevelHighlightColor`,`rasterBevelShadowColor`])G(e).addEventListener(`change`,()=>{To()});G(`brushTool`).addEventListener(`change`,()=>{Ga(G(`brushTool`).value===`blend`?`blend`:`paint`,!0),Xa(),Q()}),ha.addEventListener(`input`,Ya),qi.addEventListener(`click`,()=>{qi.disabled||Ka(!La)}),_a.addEventListener(`click`,()=>{qa(!Ra)}),va.addEventListener(`click`,()=>{qa(!1),_a.focus()}),la.addEventListener(`click`,()=>{zo()}),ua.addEventListener(`click`,()=>{Ro(`undo`)}),da.addEventListener(`click`,()=>{Ro(`redo`)}),fa.addEventListener(`click`,()=>{!Lo()&&$===null&&Y.fitView()}),pa.addEventListener(`click`,()=>{!Lo()&&$===null&&Y.zoomBy(1.35)}),ma.addEventListener(`click`,()=>{!Lo()&&$===null&&Y.zoomBy(1/1.35)}),ca.addEventListener(`change`,async()=>{if(Lo()||$!==null){ca.value=Y.getStats().layerFormat;return}let e=ca.value;Ma=!0,ca.disabled=!0,Q(),Z();try{await Y.setLayerFormat(e)||(ca.value=Y.getStats().layerFormat)}catch{ca.value=Y.getStats().layerFormat}finally{Ma=!1,mo(Y.getRasterStrokeStyle()),So(Y.getRasterBevelStyle()),J=Y.getHistoryState(),Q(),Z()}}),Yi.addEventListener(`click`,async()=>{if(!Lo()){Ka(!1),Aa=!0,Yi.disabled=!0,Q(),Z(),Xi.textContent=`Benchmark in esecuzione sulla GPU…`;try{let e=await Y.runBenchmark(K(`benchmarkStamps`));Xi.textContent=[`${Vi(e.baseStamps)} base stamps`,`${Vi(e.logicalCopies)} copie logiche`,`CPU submit ${e.cpuSubmitMs.toFixed(2)} ms`,`GPU completion ${e.gpuCompletionMs.toFixed(2)} ms`,`copertura teorica ${(e.estimatedCoveredFragments/1e6).toFixed(1)} Mpx`,e.strategy].join(` · `)}catch(e){Xi.textContent=e instanceof Error?e.message:String(e)}finally{Aa=!1,Yi.disabled=!1,J=Y.getHistoryState(),Q(),Z()}}}),Zi.hidden=!1,Qi.addEventListener(`click`,async()=>{if(!Lo()){ja=!0,ea.hidden=!0,Qi.disabled=!0,$i.textContent=`Cattura golden pixel sulla GPU…`,Q(),Z();try{let e=await Y.runRasterStrokeGolden(),t=JSON.stringify(e,null,2);ta.textContent=t,ea.hidden=!1;let n=!1;try{await navigator.clipboard.writeText(t),n=!0}catch{}window.__rasterStrokeGoldenReport=e,$i.textContent=(e.baselineMatches?`Golden identico`:`Golden diverso`)+` · v`+e.version+` · `+e.combinedSha256+` · `+e.cases.length+` casi · diagnostica `+(e.diagnosticsMatch?`OK`:`fallita`)+` (`+e.diagnostics.length+`)`+(e.baselineMatches?``:` · differenze: `+e.baselineMismatches.join(`, `))+(n?` · report copiato`:``)}catch(e){$i.textContent=e instanceof Error?e.message:String(e)}finally{ja=!1,Q(),Z()}}}),na.addEventListener(`click`,()=>{Lo()||Oa||ka||Da||Ta||wa||(Ea=!Ea,Ea?(Do(),Ka(!1),q.textContent=`Preset umano applicato. Disegna ora una sola pennellata sul canvas.`):q.textContent=wa?Bo(wa):`Registrazione annullata.`,Z())}),ra.addEventListener(`click`,()=>{Yo()}),ia.addEventListener(`click`,()=>{Yo(`blend`)});function Wo(e){for(let[t,n]of Ha){let r=G(t),i=e.gpuMemory[n];r.textContent=Ui(i),r.parentElement?.classList.toggle(`memory-zero`,i<.05)}let t=e.gpuMemory.rasterStrokeScratchExtent;G(`gpuMemoryStrokeScratchLabel`).textContent=t>0?`Traccia · scratch JFA ${t}²`:`Traccia · scratch JFA`;let n=e.gpuMemory.rasterBevelScratchExtent;G(`gpuMemoryBevelScratchLabel`).textContent=n>0?`Smusso · scratch ROI ${n}²`:`Smusso · scratch ROI`;let r=e.gpuMemory.countedTotalMiB,i=Ui(r);if(G(`gpuMemoryTotal`).textContent=i,G(`gpuMemoryCompact`).textContent=i,G(`memoryStat`).textContent=i,!Ia){za=null,ba.hidden=!0;return}if(za!==null){let e=r-za;Math.abs(e)>=.05&&(ba.textContent=(e>0?`+`:`−`)+Hi.format(Math.abs(e))+` MiB`,ba.classList.toggle(`decrease`,e<0),ba.hidden=!1,Ba!==null&&window.clearTimeout(Ba),Ba=window.setTimeout(()=>{ba.hidden=!0,Ba=null},3500))}za=r}function Go(e){G(`fpsStat`).textContent=String(e.fps),G(`cpuStat`).textContent=e.lastCpuFrameMs.toFixed(2)+` ms`,G(`stampStat`).textContent=Vi(e.totalBaseStamps),G(`avoidedStat`).textContent=Vi(e.avoidedLogicalDraws),Wo(e),G(`gpuStat`).textContent=e.gpuLabel}function Ko(e,t){let n=Do(),r=Y.toLayerPoint(t);Ta={settings:n,startTimestamp:e.timeStamp,points:[{...r,timeMs:0}]},q.textContent=`Registrazione in corso…`}function qo(e,t){let n=Ta;if(n)for(let r=0;r<t.length;r+=1){let i=n.points[n.points.length-1]?.timeMs??0,a=Math.max(i,e[r].timeStamp-n.startTimestamp,0);n.points.push({...Y.toLayerPoint(t[r]),timeMs:a})}}async function Jo(e){let t=Ta;if(Ta=null,Ea=!1,t&&e&&t.points.length>1){let e={version:1,capturedAt:new Date().toISOString(),settings:t.settings,points:t.points};ka=!0,q.textContent=`Fissaggio permanente del tratto di riferimento…`,Z();try{wa=await co(e),oo(),q.textContent=Bo(wa)}catch(e){q.textContent=e instanceof Error?e.message:String(e)}finally{ka=!1}}else t&&(q.textContent=`Tratto troppo breve: registra una pennellata con almeno un movimento.`);Z()}async function Yo(e=`paint`){let t=wa;if(!t||Da||Lo())return;let n=e===`blend`?`blend`:Oo(),r=e===`blend`?`normal`:ko(),i=e===`blend`?`off`:Ao(),a=e===`blend`?Mo(t):jo(t,n,r,i),o=e===`blend`?Po:No(n,r,i),s=e===`blend`?`multicolor-horizontal-stripes-v1`:`transparent`;Ka(!1),Da=!0,Yi.disabled=!0,Z(),Q(),Eo(a),q.textContent=`Riproduzione test ${o} in corso…`;try{if(await Y.waitForIdle(),Y.resetStrokeRandomSeed(),!Y.resetDocument())throw Error(`Il documento è occupato da un'operazione Undo/Redo.`);await Y.waitForIdle(),e===`blend`&&(q.textContent=`Preparazione dello sfondo multicolore Blend…`,await Fo(a),Y.resetStrokeRandomSeed(),q.textContent=`Riproduzione test ${o} in corso…`);let c=Y.getBlendRuntimeState(),l=e===`blend`?c.scratchAllocated?`warm`:`cold`:`not-applicable`,u=Y.getStats(),d=performance.now(),f=t.points[t.points.length-1],p=[],m=[],h=1;Y.startStrokePerformanceProfile();let g=performance.now();Y.beginStrokeAtLayer(t.points[0]),m.push(performance.now()-g),await new Promise(e=>{let n=r=>{let i=r-d,a=[];for(;h<t.points.length&&t.points[h].timeMs<=i;)p.push(Math.max(0,i-t.points[h].timeMs)),a.push(t.points[h]),h+=1;if(a.length>0){let e=performance.now();Y.extendStrokeAtLayer(a),m.push(performance.now()-e)}if(h<t.points.length){requestAnimationFrame(n);return}Y.endStroke(f.timeMs),e()};requestAnimationFrame(n)});let _=performance.now();await Y.waitForIdle();let v=performance.now();await $a();let y=performance.now(),b=Y.finishStrokePerformanceProfile();if(!b)throw Error(`Profilo del tratto non disponibile.`);let x=Y.getStats(),S=Y.getBlendRuntimeState(),C=Math.max(0,x.totalBaseStamps-u.totalBaseStamps),w=e===`blend`?C:C*a.count,T={inputDeliveryMs:_-d,inputDelayP50Ms:Qa(p,.5),inputDelayP95Ms:Qa(p,.95),inputDelayMaxMs:p.length===0?0:Math.max(...p),layerInputDispatchTotalMs:m.reduce((e,t)=>e+t,0),layerInputDispatchP50Ms:Qa(m,.5),layerInputDispatchP95Ms:Qa(m,.95),layerInputDispatchMaxMs:m.length===0?0:Math.max(...m),inputDeliveryPath:`preconverted-layer-points`,pointerPipelineMeasured:!1,inputToGpuCompletionMs:Math.max(0,v-_),endToPresentedMs:Math.max(0,y-d)},E=await ro({version:1,recordedAt:new Date().toISOString(),benchmark:{capturedAt:t.capturedAt,traceFingerprint:eo(t.points),pointCount:t.points.length,traceDurationMs:f.timeMs,...to(t.points),testVariant:n,testTool:e,testBlendMode:r,testGrainMode:i,backgroundStrategy:s,blendScratchStateBeforeReplay:l,blendScratchMemoryMiBBeforeReplay:c.scratchMemoryMiB,blendScratchMemoryMiBAfterReplay:S.scratchMemoryMiB,settings:a},playback:T,performance:b,environment:no()});q.textContent=[`Test ${o}`,`Tratto ${Za(f.timeMs)}`,`${Vi(t.points.length)} campioni`,e===`blend`?`${Vi(C)} segmenti Blend dry`:`${Vi(C)} stamps base`,e===`blend`?`scratch ${l} → ${S.scratchMemoryMiB.toFixed(1)} MiB`:`${Vi(w)} copie fisiche`,`coda GPU ${T.inputToGpuCompletionMs.toFixed(2)} ms`,`CPU frame p95 ${b.renderFrameTotalP95Ms.toFixed(2)} ms`,`submit p95 ${b.submitImmediateP95Ms.toFixed(2)} ms`,`display mip ${b.paintDisplaySelectedMipLevel} / ${Vi(b.paintDisplayPyramidPasses)} pass`,e===`blend`?`preview tip n/a Blend`:b.adaptivePreviewActivations>0?`preview tip ${Vi(b.adaptivePreviewBaseStampsDrawn)} stamp / ${b.adaptivePreviewJsTotalMs.toFixed(2)} ms JS`:`preview tip non attivata`,e===`blend`?`spacing Blend ${a.spacingPercent.toFixed(2)}%`:`spacing adattivo ${b.adaptiveSpacingInitialPercent.toFixed(2)}→${b.adaptiveSpacingFinalPercent.toFixed(2)}% / ${b.adaptiveSpacingIncreaseCount} step`,`history CPU ${Vi(b.historyCapturedBaseStamps)} stamp / ${Vi(b.historyCapturedBatches)} batch`,`FPS medi ${b.averageRenderFps.toFixed(1)}`,`${Vi(b.delayedRenderFrames)} frame >20 ms`,`presentazione ${T.endToPresentedMs.toFixed(2)} ms`,E>0?`run #${E} salvata`:`run salvata`].join(` · `)}catch(e){Y.finishStrokePerformanceProfile(),q.textContent=e instanceof Error?e.message:String(e)}finally{Da=!1,Yi.disabled=!1,Z(),J=Y.getHistoryState(),Q()}}function Xo(e){return e.pointerType===`mouse`?1:e.pressure>0?e.pressure:e.pointerType===`pen`?.5:.65}function Zo(e){return{clientX:e.clientX,clientY:e.clientY,pressure:Xo(e),timeMs:e.timeStamp}}var $=null,Qo=null,$o=0,es=0,ts=new Map,ns=null;function rs(){let e=[...ts.values()];if(e.length<2)return null;let t=e[0],n=e[1];return{centerX:(t.clientX+n.clientX)*.5,centerY:(t.clientY+n.clientY)*.5,distance:Math.max(1,Math.hypot(n.clientX-t.clientX,n.clientY-t.clientY))}}function is(){Ta&&(Ta=null,Ea=!1,q.textContent=`Registrazione annullata dal gesto a due dita.`,Z())}function as(){Qo!==`touch-navigation`&&(Qo===`paint`&&(Y.cancelStrokeBeforeRender()||Y.endStroke(),is()),Qo=`touch-navigation`,Wi.classList.add(`panning`)),ns=rs()}Wi.addEventListener(`pointerdown`,e=>{if(e.pointerType===`touch`&&$!==null&&ts.size>0&&!Io()){e.preventDefault(),ts.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),Wi.setPointerCapture(e.pointerId),ts.size>=2&&as();return}if(!($!==null||Io())){if(e.preventDefault(),$=e.pointerId,e.pointerType===`touch`&&ts.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),Qo=e.shiftKey||e.button===1||e.button===2?`pan`:`paint`,Wi.setPointerCapture(e.pointerId),Qo===`pan`)Wi.classList.add(`panning`),$o=e.clientX,es=e.clientY;else{let t=Zo(e);Ea&&Ko(e,t),Y.beginStroke(t)}requestAnimationFrame(()=>{$===e.pointerId&&(Q(),Z())})}}),Wi.addEventListener(`pointermove`,e=>{if(e.pointerType===`touch`&&ts.has(e.pointerId)&&(ts.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY}),Qo===`touch-navigation`)){e.preventDefault();let t=rs(),n=ns;if(t&&n){let e=t.centerX-n.centerX,r=t.centerY-n.centerY;(Math.abs(e)>.01||Math.abs(r)>.01)&&Y.panByClientDelta(e,r);let i=t.distance/n.distance;Number.isFinite(i)&&Math.abs(i-1)>1e-4&&Y.zoomBy(Math.min(2,Math.max(.5,i)),t.centerX,t.centerY)}ns=t;return}if(e.pointerId!==$||Qo===null)return;if(e.preventDefault(),Qo===`pan`){Y.panByClientDelta(e.clientX-$o,e.clientY-es),$o=e.clientX,es=e.clientY;return}let t=e.getCoalescedEvents?.()??[],n=t.length>0?t:[e],r=n.map(Zo);qo(n,r),Y.extendStroke(r)});function os(e){if(e.pointerType===`touch`&&ts.delete(e.pointerId),Qo===`touch-navigation`){e.preventDefault();let t=ts.keys().next().value;$=typeof t==`number`?t:null,ns=rs(),ts.size===0&&(Wi.classList.remove(`panning`),Qo=null,J=Y.getHistoryState(),Q(),Z());return}e.pointerId===$&&(Qo===`paint`&&(Y.endStroke(e.timeStamp),Jo(e.type===`pointerup`)),Wi.classList.remove(`panning`),Qo=null,$=null,ns=null,J=Y.getHistoryState(),Q(),Z())}Wi.addEventListener(`pointerup`,os),Wi.addEventListener(`pointercancel`,os),Wi.addEventListener(`lostpointercapture`,os),Wi.addEventListener(`contextmenu`,e=>e.preventDefault()),window.addEventListener(`keydown`,e=>{if(e.defaultPrevented||e.repeat||e.isComposing||e.altKey||!e.ctrlKey&&!e.metaKey||e.key.toLowerCase()!==`z`||(e.target instanceof Element?e.target:null)?.closest(`input, textarea, select, [contenteditable]`))return;let t=e.shiftKey?`redo`:`undo`;!(t===`undo`?J.canUndo:J.canRedo)||Lo()||$!==null||(e.preventDefault(),Ro(t))}),Wi.addEventListener(`wheel`,e=>{if(e.preventDefault(),Lo()||$!==null)return;let t=Math.exp(-e.deltaY*.0015);Y.zoomBy(Math.min(2,Math.max(.5,t)),e.clientX,e.clientY)},{passive:!1}),new ResizeObserver(()=>Y.resizeCanvas()).observe(Wi),mo(Y.getRasterStrokeStyle()),So(Y.getRasterBevelStyle()),qa(!1),Ka(!0),Ga(`paint`,!1),Ya(),Y.setBrushSettings(Ja()),Z(),Q(),lo(),Y.initialize().then(()=>{Ia=!0,J=Y.getHistoryState(),Q(),Z()}).catch(e=>{let t=window.isSecureContext?``:` WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente.`;Ji.textContent=`${e instanceof Error?e.message:String(e)}${t}`,Ji.className=`status error`,Yi.disabled=!0,Q()}),window.setInterval(()=>Go(Y.getStats()),500);export{sn as n,Ee as r,wt as t};