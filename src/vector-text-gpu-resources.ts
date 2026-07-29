import type {
  VectorTextGpuMeshDraw,
  VectorTextGpuSlugBlurDraw,
  VectorTextGpuSlugDraw,
  VectorTextGpuSlugInnerShadowBlurDraw,
  VectorTextGpuSlugInnerShadowDirectDraw,
} from "./vector-text-prototype";

export interface CreatedVectorTextGpuMeshResources {
  readonly kind: "mesh";
  readonly revision: string;
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly memoryBytes: number;
}

export interface CreatedVectorTextGpuSlugResources {
  readonly kind: "slug";
  readonly revision: string;
  readonly curveTexture: GPUTexture;
  readonly bandTexture: GPUTexture;
  readonly bindGroup: GPUBindGroup;
  readonly curveCount: number;
  readonly memoryBytes: number;
}

export type CreatedVectorTextGpuResources =
  | CreatedVectorTextGpuMeshResources
  | CreatedVectorTextGpuSlugResources;

export function createVectorTextGpuMeshResources(
  device: GPUDevice,
  draw: VectorTextGpuMeshDraw,
): CreatedVectorTextGpuMeshResources {
  const vertexBuffer = device.createBuffer({
    label: `Vector text ${draw.meshKey} vertices`,
    size: Math.max(4, draw.mesh.vertices.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const indexBuffer = device.createBuffer({
    label: `Vector text ${draw.meshKey} indices`,
    size: Math.max(4, draw.mesh.indices.byteLength),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  if (draw.mesh.vertices.byteLength > 0) {
    device.queue.writeBuffer(vertexBuffer, 0, draw.mesh.vertices);
  }
  if (draw.mesh.indices.byteLength > 0) {
    device.queue.writeBuffer(indexBuffer, 0, draw.mesh.indices);
  }
  return {
    kind: "mesh",
    revision: draw.mesh.revision,
    vertexBuffer,
    indexBuffer,
    indexCount: draw.mesh.indices.length,
    memoryBytes: draw.mesh.vertices.byteLength + draw.mesh.indices.byteLength,
  };
}

export function createVectorTextGpuSlugResources(
  device: GPUDevice,
  draw:
    | VectorTextGpuSlugDraw
    | VectorTextGpuSlugBlurDraw
    | VectorTextGpuSlugInnerShadowDirectDraw
    | VectorTextGpuSlugInnerShadowBlurDraw,
  uniformBuffer: GPUBuffer,
  bindGroupLayout: GPUBindGroupLayout,
  uniformBytes: number,
): CreatedVectorTextGpuSlugResources {
  const curve = draw.slug.curveTexture;
  const band = draw.slug.bandTexture;
  const curveTexture = device.createTexture({
    label: `Vector text ${draw.meshKey} Slug curves`,
    size: {
      width: curve.width,
      height: curve.height,
      depthOrArrayLayers: 1,
    },
    format: "rgba32float",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  const bandTexture = device.createTexture({
    label: `Vector text ${draw.meshKey} Slug bands`,
    size: {
      width: band.width,
      height: band.height,
      depthOrArrayLayers: 1,
    },
    format: "rgba32uint",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    device.queue.writeTexture(
      { texture: curveTexture },
      curve.data,
      {
        offset: 0,
        bytesPerRow: curve.width * 16,
        rowsPerImage: curve.height,
      },
      {
        width: curve.width,
        height: curve.height,
        depthOrArrayLayers: 1,
      },
    );
    device.queue.writeTexture(
      { texture: bandTexture },
      band.data,
      {
        offset: 0,
        bytesPerRow: band.width * 16,
        rowsPerImage: band.height,
      },
      {
        width: band.width,
        height: band.height,
        depthOrArrayLayers: 1,
      },
    );
    const bindGroup = device.createBindGroup({
      label: `Vector text ${draw.meshKey} Slug bind group`,
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
            offset: 0,
            size: uniformBytes,
          },
        },
        { binding: 1, resource: curveTexture.createView() },
        { binding: 2, resource: bandTexture.createView() },
      ],
    });
    return {
      kind: "slug",
      revision: draw.slug.revision,
      curveTexture,
      bandTexture,
      bindGroup,
      curveCount: draw.slug.curveCount,
      memoryBytes: curve.data.byteLength + band.data.byteLength,
    };
  } catch (error) {
    curveTexture.destroy();
    bandTexture.destroy();
    throw error;
  }
}

export function destroyVectorTextGpuResources(
  resources: CreatedVectorTextGpuResources,
): void {
  if (resources.kind === "mesh") {
    resources.vertexBuffer.destroy();
    resources.indexBuffer.destroy();
  } else {
    resources.curveTexture.destroy();
    resources.bandTexture.destroy();
  }
}
