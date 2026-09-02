import { quantizeUnorm8SpatialAdjacent } from "./rgba8-spatial-quantization";

export interface Rgba8AccumulationProbeResult {
  readonly repetitions: number;
  readonly deposit: number;
  readonly alphaSequence: readonly number[];
  readonly uniqueVisibleLevels: number;
  readonly lastChangingRepetition: number;
  readonly storedAlpha: number;
  readonly visibleBlackOverWhite: number;
  readonly preciseOutputBlackOverWhite: number;
  readonly spatialOutputBlackOverWhite: number;
  readonly encodedRampRepetitions: number;
  readonly redCodesExact: number;
  readonly greenCodesExact: number;
  readonly blueCodesExact: number;
  readonly encodedRampMaximumError: number;
}

const COPY_BYTES_PER_ROW = 256;

const probeShader = /* wgsl */ `
struct DepositUniforms {
  premultipliedColor: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> deposit: DepositUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return deposit.premultipliedColor;
}
`;

const encodedRampShader = /* wgsl */ `
struct RampUniforms {
  values: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> ramp: RampUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let code = f32(u32(fragmentPosition.x)) / 255.0;
  let row = u32(fragmentPosition.y);
  var color = vec3<f32>(0.0);
  if (row == 0u) {
    color.r = code;
  } else if (row == 1u) {
    color.g = code;
  } else {
    color.b = code;
  }
  return vec4<f32>(color * ramp.values.x, ramp.values.x);
}
`;

interface EncodedRampProbeResult {
  readonly repetitions: number;
  readonly redCodesExact: number;
  readonly greenCodesExact: number;
  readonly blueCodesExact: number;
  readonly maximumError: number;
}

async function probeEncodedRgba8Ramp(
  device: GPUDevice,
  deposit: number,
  minimumRepetitions: number,
): Promise<EncodedRampProbeResult> {
  const residualTarget = 0.25 / 255;
  const repetitions = deposit >= 1
    ? 1
    : Math.max(
      minimumRepetitions,
      Math.ceil(Math.log(residualTarget) / Math.log(Math.max(1e-12, 1 - deposit))),
    );
  const opticalDepth = -Math.log2(Math.max(1e-12, 1 - deposit)) * repetitions;
  const coverage = 1 - (2 ** -opticalDepth);
  const texture = device.createTexture({
    label: "Encoded RGBA8 complete color-code ramp",
    size: { width: 256, height: 3 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    label: "Encoded RGBA8 complete color-code ramp readback",
    size: 1024 * 3,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const uniform = device.createBuffer({
    label: "Encoded RGBA8 complete color-code ramp uniform",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    device.queue.writeBuffer(uniform, 0, new Float32Array([coverage, 0, 0, 0]));
    const module = device.createShaderModule({
      label: "Encoded RGBA8 complete color-code ramp shader",
      code: encodedRampShader,
    });
    const pipeline = await device.createRenderPipelineAsync({
      label: "Encoded RGBA8 complete color-code ramp pipeline",
      layout: "auto",
      vertex: { module, entryPoint: "vertexMain" },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const bindGroup = device.createBindGroup({
      label: "Encoded RGBA8 complete color-code ramp bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const encoder = device.createCommandEncoder({
      label: "Encoded RGBA8 complete color-code ramp commands",
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow: 1024, rowsPerImage: 3 },
      { width: 256, height: 3, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const exact = [0, 0, 0];
    let maximumError = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let code = 0; code < 256; code += 1) {
        const offset = row * 1024 + code * 4;
        const actual = bytes[offset + row];
        maximumError = Math.max(maximumError, Math.abs(actual - code));
        const otherA = bytes[offset + ((row + 1) % 3)];
        const otherB = bytes[offset + ((row + 2) % 3)];
        if (actual === code && otherA === 0 && otherB === 0 && bytes[offset + 3] === 255) {
          exact[row] += 1;
        }
      }
    }
    readback.unmap();
    return {
      repetitions,
      redCodesExact: exact[0],
      greenCodesExact: exact[1],
      blueCodesExact: exact[2],
      maximumError,
    };
  } finally {
    uniform.destroy();
    readback.destroy();
    texture.destroy();
  }
}

/**
 * Executes the real fixed-function source-over blend repeatedly in a 1×1
 * RGBA8 render target. The probe never touches the document or its history.
 */
export async function probeRgba8PerDabAccumulation(
  device: GPUDevice,
  requestedDeposit: number,
  repetitions = 256,
): Promise<Rgba8AccumulationProbeResult> {
  const deposit = Math.max(0, Math.min(1, requestedDeposit));
  const count = Math.max(1, Math.min(1024, Math.trunc(repetitions)));
  let spatialAlpha = 0;
  for (let actionId = 1; actionId <= count; actionId += 1) {
    const compositedAlpha = deposit + (spatialAlpha / 255) * (1 - deposit);
    spatialAlpha = quantizeUnorm8SpatialAdjacent(compositedAlpha, 0, 0, actionId);
  }
  const texture = device.createTexture({
    label: "RGBA8 per-dab accumulation probe",
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    label: "RGBA8 per-dab accumulation probe readback",
    size: COPY_BYTES_PER_ROW * count,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const uniform = device.createBuffer({
    label: "RGBA8 per-dab accumulation probe uniform",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  try {
    device.queue.writeBuffer(uniform, 0, new Float32Array([0, 0, 0, deposit]));
    const module = device.createShaderModule({
      label: "RGBA8 per-dab accumulation probe shader",
      code: probeShader,
    });
    const pipeline = await device.createRenderPipelineAsync({
      label: "RGBA8 per-dab source-over probe pipeline",
      layout: "auto",
      vertex: { module, entryPoint: "vertexMain" },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{
          format: "rgba8unorm",
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    const bindGroup = device.createBindGroup({
      label: "RGBA8 per-dab accumulation probe bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const encoder = device.createCommandEncoder({
      label: "RGBA8 per-dab accumulation probe commands",
    });
    const view = texture.createView();
    for (let index = 0; index < count; index += 1) {
      const pass = encoder.beginRenderPass({
        label: `RGBA8 per-dab probe repetition ${index + 1}`,
        colorAttachments: [{
          view,
          loadOp: index === 0 ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture },
        {
          buffer: readback,
          offset: index * COPY_BYTES_PER_ROW,
          bytesPerRow: COPY_BYTES_PER_ROW,
          rowsPerImage: 1,
        },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    }
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const alphaSequence = new Array<number>(count);
    let previous = 0;
    let lastChangingRepetition = 0;
    const visibleLevels = new Set<number>([255]);
    for (let index = 0; index < count; index += 1) {
      const alpha = bytes[index * COPY_BYTES_PER_ROW + 3];
      alphaSequence[index] = alpha;
      const visible = 255 - alpha;
      visibleLevels.add(visible);
      if (alpha !== previous) lastChangingRepetition = index + 1;
      previous = alpha;
    }
    readback.unmap();
    const storedAlpha = alphaSequence[alphaSequence.length - 1];
    const ramp = await probeEncodedRgba8Ramp(device, deposit, count);
    return {
      repetitions: count,
      deposit,
      alphaSequence,
      uniqueVisibleLevels: visibleLevels.size,
      lastChangingRepetition,
      storedAlpha,
      visibleBlackOverWhite: 255 - storedAlpha,
      preciseOutputBlackOverWhite: Math.round(255 * ((1 - deposit) ** count)),
      spatialOutputBlackOverWhite: 255 - spatialAlpha,
      encodedRampRepetitions: ramp.repetitions,
      redCodesExact: ramp.redCodesExact,
      greenCodesExact: ramp.greenCodesExact,
      blueCodesExact: ramp.blueCodesExact,
      encodedRampMaximumError: ramp.maximumError,
    };
  } finally {
    uniform.destroy();
    readback.destroy();
    texture.destroy();
  }
}
