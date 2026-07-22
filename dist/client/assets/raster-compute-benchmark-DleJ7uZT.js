var e=2048,t=64,n=16,r=n*n,i=t/n,a=i*i,o=3,s=4,c=16,l=4,u=4,d=e*u,f=e*d,p=`readonly_and_readwrite_storage_textures`;function m(e){let t=e>>>0;return t=(t^t>>>16)>>>0,t=Math.imul(t,2146121005)>>>0,t=(t^t>>>15)>>>0,t=Math.imul(t,2221713035)>>>0,(t^t>>>16)>>>0}function h(e,t){return(m(e^Math.imul(t,2654435769))&16777215)/16777216}function g(e,t,n,r){return(e&255|(t&255)<<8|(n&255)<<16|(r&255)<<24)>>>0}function _(e){if(e.length===0)return 0;let t=[...e].sort((e,t)=>e-t),n=Math.floor(t.length/2);return t.length%2==0?(t[n-1]+t[n])*.5:t[n]}function v(){let n=[],r=e*.5;for(let e=0;e<32;e+=1){let t=e/31*Math.PI*2,i=r+(e-31*.5)*7.5,a=r+Math.sin(t)*55,o=Math.cos(t)*55*Math.PI*2/232.5,s=Math.hypot(1,o),c=1/s,l=o/s,u=m(Math.imul(e+1,2654435761)^2769414579);for(let e=0;e<16;e+=1){let t=m(u^Math.imul(e,2246822507)),r=(h(t,5)-.5)*4*375,o=(h(t,6)-.5)*4*375,s=i+c*r-l*o,d=a+l*r+c*o,f=32+Math.floor(h(t,1)*224),p=32+Math.floor(h(t,2)*224),_=32+Math.floor(h(t,3)*224);n.push({centerX:s,centerY:d,radius:375,packedColor:g(f,p,_,255)})}}let i=e/t,a=i*i,o=new Uint32Array(a),s=new Int16Array(n.length*4);s.fill(-1);for(let r=0;r<n.length;r+=1){let a=n[r],c=Math.max(0,Math.floor(a.centerX-a.radius)),l=Math.max(0,Math.floor(a.centerY-a.radius)),u=Math.min(e,Math.ceil(a.centerX+a.radius)),d=Math.min(e,Math.ceil(a.centerY+a.radius));if(u<=c||d<=l)continue;let f=Math.floor(c/t),p=Math.floor(l/t),m=Math.floor((u-1)/t),h=Math.floor((d-1)/t),g=r*4;s[g]=f,s[g+1]=p,s[g+2]=m,s[g+3]=h;for(let e=p;e<=h;e+=1)for(let t=f;t<=m;t+=1)o[e*i+t]+=1}let u=new Uint32Array(1025),d=0,f=0;for(let e=0;e<a;e+=1){let t=o[e];u[e+1]=u[e]+t,d+=+(t>0),f=Math.max(f,t)}let p=new Uint32Array(d*l),_=0;for(let e=0;e<a;e+=1){let t=o[e];if(t===0)continue;let n=_*l;p[n]=e%i,p[n+1]=Math.floor(e/i),p[n+2]=u[e],p[n+3]=t,_+=1}let v=new Uint32Array(u[a]),y=u.slice(0,a);for(let e=0;e<n.length;e+=1){let t=e*4,n=s[t];if(n<0)continue;let r=s[t+1],a=s[t+2],o=s[t+3];for(let t=r;t<=o;t+=1)for(let r=n;r<=a;r+=1){let n=t*i+r;v[y[n]]=e,y[n]+=1}}let b=new ArrayBuffer(n.length*c),x=new Float32Array(b),S=new Uint32Array(b);for(let e=0;e<n.length;e+=1){let t=c/4*e,r=n[e];x[t]=r.centerX,x[t+1]=r.centerY,x[t+2]=r.radius,S[t+3]=r.packedColor}return{copies:n,packedCopies:b,packedTileHeaders:p,packedTileReferences:v,activeTiles:d,tileReferences:v.length,averageReferencesPerTile:d>0?v.length/d:0,maximumReferencesPerTile:f}}var y=`
const TARGET_SIZE: f32 = ${e}.0;

struct PhysicalCopy {
  center: vec2<f32>,
  radius: f32,
  packedColor: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) copyIndex: u32,
};

@group(0) @binding(0) var<storage, read> copies: array<PhysicalCopy>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let copy = copies[instanceIndex];
  let pixelPosition = copy.center + corners[vertexIndex] * copy.radius;

  var output: VertexOutput;
  output.position = vec4<f32>(
    pixelPosition.x / TARGET_SIZE * 2.0 - 1.0,
    1.0 - pixelPosition.y / TARGET_SIZE * 2.0,
    0.0,
    1.0,
  );
  output.copyIndex = instanceIndex;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let copy = copies[input.copyIndex];
  let localPosition = (input.position.xy - copy.center) / copy.radius;
  if (dot(localPosition, localPosition) > 1.0) {
    discard;
  }
  return unpack4x8unorm(copy.packedColor);
}
`;function b(o){return`${o===`r32uint-read-write-storage-texture`?`requires ${p};\n`:``}
const TARGET_SIZE: u32 = ${e}u;
const TILE_SIZE: u32 = ${t}u;
const WORKGROUP_EDGE: u32 = ${n}u;
const PIXELS_PER_INVOCATION_AXIS: u32 = ${i}u;
const PIXELS_PER_INVOCATION: u32 = ${a}u;
const WORKGROUP_INVOCATIONS: u32 = ${r}u;

struct PhysicalCopy {
  center: vec2<f32>,
  radius: f32,
  packedColor: u32,
};

struct TileHeader {
  tileX: u32,
  tileY: u32,
  referenceOffset: u32,
  referenceCount: u32,
};

@group(0) @binding(0) var<storage, read> copies: array<PhysicalCopy>;
@group(0) @binding(1) var<storage, read> tiles: array<TileHeader>;
@group(0) @binding(2) var<storage, read> references: array<u32>;
${o===`r32uint-read-write-storage-texture`?`@group(0) @binding(3) var packedTarget: texture_storage_2d<r32uint, read_write>;`:`@group(0) @binding(3) var<storage, read_write> packedTarget: array<u32>;`}

var<workgroup> cachedCopies: array<PhysicalCopy, ${r}>;

fn loadTarget(pixelPosition: vec2<u32>) -> vec4<f32> {
  return unpack4x8unorm(${o===`r32uint-read-write-storage-texture`?`textureLoad(packedTarget, vec2<i32>(pixelPosition)).x`:`packedTarget[pixelPosition.y * TARGET_SIZE + pixelPosition.x]`});
}

fn storeTarget(pixelPosition: vec2<u32>, color: vec4<f32>) {
  let packed = pack4x8unorm(color);
  ${o===`r32uint-read-write-storage-texture`?`textureStore(packedTarget, vec2<i32>(pixelPosition), vec4<u32>(packed, 0u, 0u, 0u));`:`packedTarget[pixelPosition.y * TARGET_SIZE + pixelPosition.x] = packed;`}
}

fn blendCopy(
  destination: vec4<f32>,
  copy: PhysicalCopy,
  pixelPosition: vec2<u32>,
) -> vec4<f32> {
  let samplePosition = vec2<f32>(pixelPosition) + vec2<f32>(0.5);
  let localPosition = (samplePosition - copy.center) / copy.radius;
  if (dot(localPosition, localPosition) > 1.0) {
    return destination;
  }

  let source = unpack4x8unorm(copy.packedColor);
  let blended = source + destination * (1.0 - source.a);
  // rgba8unorm quantizza l'attachment dopo ogni fragment. Il round-trip
  // riproduce quella quantizzazione dopo ogni copia, non soltanto alla fine.
  return unpack4x8unorm(pack4x8unorm(blended));
}

@compute @workgroup_size(${n}, ${n}, 1)
fn computeMain(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let tile = tiles[workgroupId.x];
  let tileOrigin = vec2<u32>(tile.tileX, tile.tileY) * TILE_SIZE;
  var pixelPositions: array<vec2<u32>, ${a}>;
  var destinations: array<vec4<f32>, ${a}>;
  for (var localPixelY = 0u; localPixelY < PIXELS_PER_INVOCATION_AXIS; localPixelY += 1u) {
    for (var localPixelX = 0u; localPixelX < PIXELS_PER_INVOCATION_AXIS; localPixelX += 1u) {
      let pixelIndex = localPixelY * PIXELS_PER_INVOCATION_AXIS + localPixelX;
      pixelPositions[pixelIndex] = tileOrigin
        + localId.xy
        + vec2<u32>(localPixelX, localPixelY) * WORKGROUP_EDGE;
    }
  }
  for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
    destinations[pixelIndex] = loadTarget(pixelPositions[pixelIndex]);
  }

  var chunkStart = 0u;
  loop {
    if (chunkStart >= tile.referenceCount) {
      break;
    }
    let chunkCount = min(WORKGROUP_INVOCATIONS, tile.referenceCount - chunkStart);
    if (localIndex < chunkCount) {
      let referenceIndex = references[tile.referenceOffset + chunkStart + localIndex];
      cachedCopies[localIndex] = copies[referenceIndex];
    }
    workgroupBarrier();

    for (var copyIndex = 0u; copyIndex < chunkCount; copyIndex += 1u) {
      let copy = cachedCopies[copyIndex];
      for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
        destinations[pixelIndex] = blendCopy(
          destinations[pixelIndex],
          copy,
          pixelPositions[pixelIndex],
        );
      }
    }
    workgroupBarrier();
    chunkStart += chunkCount;
  }

  for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
    storeTarget(pixelPositions[pixelIndex], destinations[pixelIndex]);
  }
}
`}async function x(e,t){e.pushErrorScope(`validation`);let n=null,r=null;try{n=await t()}catch(e){r=e}let i=await e.popErrorScope();if(r)throw r;if(i)throw Error(i.message);if(!n)throw Error(`Creazione pipeline non riuscita.`);return n}async function S(e,t){let n=(await e.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(n.length!==0)throw Error(`${t}: ${n.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join(` | `)}`)}function C(e){return e instanceof Error?e.message:String(e)}function w(e,t,n){return e.createBuffer({label:t,size:Math.max(4,Math.ceil(n/4)*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST})}function T(t,n){let r=e*e,i=new DataView(n.buffer,n.byteOffset,n.byteLength),a=0,o=0,s=0;for(let e=0;e<r;e+=1){let n=e*u,r=i.getUint32(n,!0),c=!1;for(let e=0;e<4;e+=1){let i=t[n+e],a=r>>>e*8&255,l=Math.abs(i-a);o+=l,s=Math.max(s,l),c||=l!==0}a+=+!!c}return{exactPixelRatio:(r-a)/r,differentPixels:a,meanAbsoluteChannelError:o/(r*4),maximumChannelError:s}}async function E(n,r){await n.queue.onSubmittedWorkDone(),v();let i=[],a=null;for(let e=0;e<3;e+=1){let e=performance.now();a=v(),i.push(performance.now()-e)}if(!a)throw Error(`Preparazione workload raster/compute non riuscita.`);let c=_(i),l=[],u=null,m=null;try{let i=w(n,`Raster/compute benchmark physical copies`,a.packedCopies.byteLength),h=w(n,`Raster/compute benchmark tile headers`,a.packedTileHeaders.byteLength),g=w(n,`Raster/compute benchmark tile references`,a.packedTileReferences.byteLength);l.push(i,h,g);let v=performance.now();n.queue.writeBuffer(i,0,a.packedCopies),n.queue.writeBuffer(h,0,a.packedTileHeaders),n.queue.writeBuffer(g,0,a.packedTileReferences);let E=performance.now()-v,D=n.createTexture({label:`Raster/compute benchmark raster RGBA8 target`,size:{width:e,height:e},format:`rgba8unorm`,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});l.push(D);let O=n.createShaderModule({label:`Raster/compute benchmark raster WGSL`,code:y});await S(O,`Shader raster benchmark non valido`);let k=await x(n,()=>n.createRenderPipelineAsync({label:`Raster/compute benchmark raster pipeline`,layout:`auto`,vertex:{module:O,entryPoint:`vertexMain`},fragment:{module:O,entryPoint:`fragmentMain`,targets:[{format:`rgba8unorm`,blend:{color:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}]},primitive:{topology:`triangle-strip`}})),A=n.createBindGroup({label:`Raster/compute benchmark raster bind group`,layout:k.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:i}}]}),j=`u32-read-write-storage-buffer`,M=null,N=null,P=null,F;if(r.has(p))try{N=n.createTexture({label:`Raster/compute benchmark packed R32Uint target`,size:{width:e,height:e},format:`r32uint`,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});let t=n.createShaderModule({label:`Raster/compute benchmark read-write texture WGSL`,code:b(`r32uint-read-write-storage-texture`)});await S(t,`Shader compute texture non valido`),F=await x(n,()=>n.createComputePipelineAsync({label:`Raster/compute benchmark read-write texture pipeline`,layout:`auto`,compute:{module:t,entryPoint:`computeMain`}})),j=`r32uint-read-write-storage-texture`,l.push(N)}catch(e){N?.destroy(),N=null,M=`pipeline texture non disponibile: ${C(e)}`;let t=n.createShaderModule({label:`Raster/compute benchmark storage-buffer WGSL`,code:b(`u32-read-write-storage-buffer`)});await S(t,`Shader compute buffer non valido`),F=await x(n,()=>n.createComputePipelineAsync({label:`Raster/compute benchmark storage-buffer pipeline`,layout:`auto`,compute:{module:t,entryPoint:`computeMain`}}))}else{M=`WGSL ${p} non supportato`;let e=n.createShaderModule({label:`Raster/compute benchmark storage-buffer WGSL`,code:b(`u32-read-write-storage-buffer`)});await S(e,`Shader compute buffer non valido`),F=await x(n,()=>n.createComputePipelineAsync({label:`Raster/compute benchmark storage-buffer pipeline`,layout:`auto`,compute:{module:e,entryPoint:`computeMain`}}))}N||(P=n.createBuffer({label:`Raster/compute benchmark packed u32 target`,size:f,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),l.push(P));let I=n.createBindGroup({label:`Raster/compute benchmark compute bind group`,layout:F.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:h}},{binding:2,resource:{buffer:g}},N?{binding:3,resource:N.createView()}:{binding:3,resource:{buffer:P}}]}),L=null;N&&(L=n.createBuffer({label:`Raster/compute benchmark zero texture source`,size:f,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:!0}),new Uint8Array(L.getMappedRange()).fill(0),L.unmap(),l.push(L)),u=n.createBuffer({label:`Raster/compute benchmark raster readback`,size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),m=n.createBuffer({label:`Raster/compute benchmark compute readback`,size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),l.push(u,m);let R=()=>{let e=n.createCommandEncoder({label:`Raster/compute benchmark raster clear encoder`});return e.beginRenderPass({label:`Raster/compute benchmark raster clear pass`,colorAttachments:[{view:D.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:`clear`,storeOp:`store`}]}).end(),e.finish()},z=()=>{let t=n.createCommandEncoder({label:`Raster/compute benchmark compute clear encoder`});return N&&L?t.copyBufferToTexture({buffer:L,bytesPerRow:d,rowsPerImage:e},{texture:N},{width:e,height:e,depthOrArrayLayers:1}):t.clearBuffer(P),t.finish()},B=()=>{let e=n.createCommandEncoder({label:`Raster/compute benchmark raster work encoder`}),t=e.beginRenderPass({label:`Raster/compute benchmark raster work pass`,colorAttachments:[{view:D.createView(),loadOp:`load`,storeOp:`store`}]});t.setPipeline(k),t.setBindGroup(0,A);for(let e=0;e<s;e+=1)t.draw(4,a.copies.length);return t.end(),e.finish()},V=()=>{let e=n.createCommandEncoder({label:`Raster/compute benchmark compute work encoder`}),t=e.beginComputePass({label:`Raster/compute benchmark compute work pass`});t.setPipeline(F),t.setBindGroup(0,I);for(let e=0;e<s;e+=1)t.dispatchWorkgroups(a.activeTiles);return t.end(),e.finish()},H=async e=>{n.queue.submit([e===`raster`?R():z()]),await n.queue.onSubmittedWorkDone()},U=async e=>{await H(e),n.queue.submit([e===`raster`?B():V()]),await n.queue.onSubmittedWorkDone()};await U(`raster`),await U(`compute`);let W=[],G=[],K=[],q=[];for(let e of[`raster`,`compute`,`compute`,`raster`,`raster`,`compute`]){await H(e);let t=performance.now(),r=e===`raster`?B():V(),i=(performance.now()-t)/s,a=performance.now();n.queue.submit([r]),await n.queue.onSubmittedWorkDone();let o=(performance.now()-a)/s;e===`raster`?(K.push(i),W.push(o)):(q.push(i),G.push(o))}let J=n.createCommandEncoder({label:`Raster/compute benchmark output readback encoder`});J.copyTextureToBuffer({texture:D},{buffer:u,bytesPerRow:d,rowsPerImage:e},{width:e,height:e,depthOrArrayLayers:1}),N?J.copyTextureToBuffer({texture:N},{buffer:m,bytesPerRow:d,rowsPerImage:e},{width:e,height:e,depthOrArrayLayers:1}):J.copyBufferToBuffer(P,0,m,0,f),n.queue.submit([J.finish()]),await n.queue.onSubmittedWorkDone(),await Promise.all([u.mapAsync(GPUMapMode.READ),m.mapAsync(GPUMapMode.READ)]);let Y;try{Y=T(new Uint8Array(u.getMappedRange()),new Uint8Array(m.getMappedRange()))}finally{u.unmap(),m.unmap()}let X=_(W),Z=_(G),Q=X>0?(X-Z)/X*100:0,$=Y.differentPixels===0?Q>=20?`compute-clear-win`:Q>0?`compute-small-win`:`raster-wins`:`output-mismatch`;return{targetSize:e,baseStamps:32,physicalCopies:a.copies.length,tileSize:t,activeTiles:a.activeTiles,tileReferences:a.tileReferences,averageReferencesPerTile:a.averageReferencesPerTile,maximumReferencesPerTile:a.maximumReferencesPerTile,trialsPerPath:o,workloadRepetitionsPerSample:s,storageBackend:j,storageTextureFallbackReason:M,preparationCpuMs:c,uploadCpuMs:E,rasterEncodingP50Ms:_(K),computeEncodingP50Ms:_(q),rasterCompletionSamplesMs:W,computeCompletionSamplesMs:G,rasterCompletionMedianMs:X,computeCompletionMedianMs:Z,computeSpeedupPercent:Q,...Y,verdict:$}}finally{u?.unmap(),m?.unmap();for(let e=l.length-1;e>=0;--e)l[e].destroy()}}export{E as runRasterComputeBenchmark};