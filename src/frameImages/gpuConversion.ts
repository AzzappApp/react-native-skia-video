/// <reference types="@webgpu/types" />
import { GPUBufferUsage, GPUShaderStage } from 'react-native-webgpu';

/**
 * The GPU pass that turns a decoded frame into an RGBA texture.
 *
 * The frame is bound as an external texture: React Native WebGPU converts it
 * from YUV to RGB while it is sampled. The pass draws one region of it, the
 * whole frame on iOS, the picture inside the decoder's padded buffer on
 * Android, over the whole target texture, which scales it to the target's
 * size.
 */

// The region drawn is set by two uniforms:
// uv = position01 * uvScale + uvOffset, position01 running over the target.
const SHADER = `
struct Uniforms {
  uvScale: vec2f,
  uvOffset: vec2f,
};

@group(0) @binding(0) var frame: texture_external;
@group(0) @binding(1) var frameSampler: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  // A triangle covering the target, position01 running from its top-left corner.
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let corner = corners[index];
  var output: VertexOutput;
  output.position = vec4f(corner, 0.0, 1.0);
  let position01 = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  output.uv = position01 * u.uvScale + u.uvOffset;
  return output;
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(textureSampleBaseClampToEdge(frame, frameSampler, input.uv).rgb, 1.0);
}
`;

const UNIFORMS_SIZE = 4 * Float32Array.BYTES_PER_ELEMENT;

/**
 * The color space the frames are converted to, given to React Native WebGPU
 * with each external texture: the one of Skia's textures. The conversion then
 * only applies the frame's YCbCr matrix and range, as the encoders do, and an
 * exported clip keeps its colors. With the default, React Native WebGPU also
 * converts the frame's transfer function (SMPTE 170M for BT.601 and BT.709
 * video) to sRGB: midtones come out brighter (about 12 levels at 50% gray),
 * more so with each export of an export. iOS decodes HDR video to SDR BT.709
 * (see VideoCompositionItemDecoder.mm).
 */
export const VIDEO_COLOR_SPACE = {
  primaries: 'srgb',
  transfer: 'srgb',
} as const;

type ConversionPipeline = {
  device: GPUDevice;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
  pipeline: GPURenderPipeline;
};

/**
 * Returns the pipeline of the pass, made once per runtime (stored on its
 * global object).
 */
export const getConversionPipeline = (
  device: GPUDevice
): ConversionPipeline => {
  'worklet';
  const global = globalThis as unknown as {
    __rnskvConversionPipeline?: ConversionPipeline;
  };
  if (global.__rnskvConversionPipeline?.device !== device) {
    const module = device.createShaderModule({ code: SHADER });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          externalTexture: {},
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    global.__rnskvConversionPipeline = {
      device,
      bindGroupLayout,
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      }),
      pipeline: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      }),
    };
  }
  return global.__rnskvConversionPipeline;
};

/**
 * Returns the uniform buffer of `owner` (one per key, see FrameSlot), made on
 * first use.
 */
export const getUniformBuffer = (
  device: GPUDevice,
  owner: { uniformBuffer?: GPUBuffer }
) => {
  'worklet';
  owner.uniformBuffer ??= device.createBuffer({
    size: UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return owner.uniformBuffer;
};

/**
 * Makes the bind group of the pass for `frame`, sampled with the uniforms of
 * `uniformBuffer`.
 */
export const makeConversionBindGroup = (
  device: GPUDevice,
  frame: GPUExternalTexture,
  uniformBuffer: GPUBuffer
) => {
  'worklet';
  const { bindGroupLayout, sampler } = getConversionPipeline(device);
  return device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: frame },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });
};

/**
 * Runs the pass: draws the frame of `bindGroup` over the whole of `target`,
 * submitted on the device's queue (Skia's).
 */
export const drawFrameInto = (
  device: GPUDevice,
  bindGroup: GPUBindGroup,
  target: GPUTexture
) => {
  'worklet';
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store' },
    ],
  });
  pass.setPipeline(getConversionPipeline(device).pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
};
