import type { FrameImageContext } from '../frameImages';
import {
  makeVideoFrame,
  releaseFrameImages,
  uprightCrop,
} from '../frameImages';
import type { DecodedFrame } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('react-native-skia', () => ({
  Skia: {
    Image: {
      MakeImageFromGPUTexture: jest.fn(() => ({ dispose: jest.fn() })),
    },
  },
}));

jest.mock('react-native-webgpu', () => ({
  GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_DST: 2 },
  importDevice: jest.fn(),
}));

// A 1080p frame in a padded buffer, as decoders allocate them.
const BUFFER_WIDTH = 1920;
const BUFFER_HEIGHT = 1088;

const makeContext = () => {
  const pass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    draw: jest.fn(),
    end: jest.fn(),
  };
  const encoder = {
    beginRenderPass: jest.fn(() => pass),
    finish: jest.fn(() => ({})),
  };
  const externalTextures: { destroy: jest.Mock }[] = [];
  const nativeFrames: { width: number; height: number; release: jest.Mock }[] =
    [];
  const device = {
    createShaderModule: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createPipelineLayout: jest.fn(() => ({})),
    createSampler: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => ({})),
    createBindGroup: jest.fn(() => ({})),
    createBuffer: jest.fn(() => ({ destroy: jest.fn() })),
    createCommandEncoder: jest.fn(() => encoder),
    createTexture: jest.fn(
      ({ size: [width, height] }: { size: [number, number] }) => ({
        width,
        height,
        destroy: jest.fn(),
        createView: jest.fn(() => ({})),
      })
    ),
    importExternalTexture: jest.fn(() => {
      const external = { destroy: jest.fn() };
      externalTextures.push(external);
      return external;
    }),
    queue: { writeBuffer: jest.fn(), submit: jest.fn() },
  };
  const webgpu = {
    createVideoFrameFromNativeBuffer: jest.fn(() => {
      const nativeFrame = {
        width: BUFFER_WIDTH,
        height: BUFFER_HEIGHT,
        release: jest.fn(),
      };
      nativeFrames.push(nativeFrame);
      return nativeFrame;
    }),
  };
  const context = { device, webgpu } as unknown as FrameImageContext;
  return { context, device, webgpu, pass, externalTextures, nativeFrames };
};

const makeYUVFrame = (
  id: number,
  rotation: number,
  width: number,
  height: number
): DecodedFrame => ({
  buffer: BigInt(id),
  id,
  width,
  height,
  rotation: 0,
  yuv: { x: 0, y: 0, width: 1920, height: 1080, rotation },
  release: jest.fn(),
});

let nextKey = 0;
const makeKey = () => `yuv-test-${nextKey++}`;

describe('uprightCrop', () => {
  const crop = { x: 0, y: 0, width: 1920, height: 1080 };

  it.each([
    [0, { x: 0, y: 0, width: 1920, height: 1080 }],
    // The padding rows at the bottom of the buffer end up on the left.
    [90, { x: 8, y: 0, width: 1080, height: 1920 }],
    [180, { x: 0, y: 8, width: 1920, height: 1080 }],
    [270, { x: 0, y: 0, width: 1080, height: 1920 }],
  ])('maps the region of the buffer once rotated by %i°', (rotation, rect) => {
    expect(
      uprightCrop({ ...crop, rotation }, BUFFER_WIDTH, BUFFER_HEIGHT)
    ).toEqual(rect);
  });
});

describe('makeVideoFrame with a YUV frame', () => {
  it('converts, crops, rotates and scales the frame on the GPU', () => {
    const { context, device, webgpu, pass, externalTextures, nativeFrames } =
      makeContext();
    // A portrait video (stored rotated) decoded at 360×640.
    const frame = makeYUVFrame(1, 90, 360, 640);

    const videoFrame = makeVideoFrame(context, makeKey(), frame);

    expect(webgpu.createVideoFrameFromNativeBuffer).toHaveBeenCalledWith(1n);
    expect(device.importExternalTexture).toHaveBeenCalledWith({
      source: nativeFrames[0],
      rotation: 90,
    });
    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ size: [360, 640], format: 'rgba8unorm' })
    );
    const uniforms = Array.from(
      device.queue.writeBuffer.mock.calls[0]![2] as Float32Array
    );
    const expected = [
      // The region of the upright 1088×1920 frame: 8 padding columns skipped.
      1080 / 1088,
      1,
      8 / 1088,
      0,
    ];
    expect(uniforms).toHaveLength(expected.length);
    uniforms.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
    expect(pass.draw).toHaveBeenCalledWith(3);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    // The access to the buffer ends once the commands sampling it are
    // submitted, never before.
    expect(
      externalTextures[0]!.destroy.mock.invocationCallOrder[0]
    ).toBeGreaterThan(device.queue.submit.mock.invocationCallOrder[0]!);
    expect(nativeFrames[0]!.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(videoFrame).toEqual({
      image: expect.anything(),
      width: 360,
      height: 640,
      rotation: 0,
    });
  });

  it('creates the pipeline once and a uniform buffer per key', () => {
    const { context, device } = makeContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080));
    makeVideoFrame(context, key, makeYUVFrame(2, 0, 1920, 1080));
    makeVideoFrame(context, makeKey(), makeYUVFrame(3, 0, 1920, 1080));

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(device.createBuffer).toHaveBeenCalledTimes(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(3);
  });
});

describe('releaseFrameImages with YUV frames', () => {
  it('destroys the uniform buffer of the key', () => {
    const { context, device } = makeContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080));
    releaseFrameImages(key);

    const uniformBuffer = device.createBuffer.mock.results[0]!.value;
    expect(uniformBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});
