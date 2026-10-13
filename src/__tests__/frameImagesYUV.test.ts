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
const YUV_TO_RGB = [1, 0, 1.5, -0.75, 1, -0.2, -0.5, 0.3, 1, 1.9, 0, -0.9];

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
  const externalTextures: { yuvToRgbMatrix: number[]; destroy: jest.Mock }[] =
    [];
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
      const external = { yuvToRgbMatrix: YUV_TO_RGB, destroy: jest.fn() };
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
  height: number,
  buffer = BigInt(id)
): DecodedFrame => ({
  buffer,
  id,
  width,
  height,
  rotation: 0,
  yuv: { x: 0, y: 0, width: 1920, height: 1080, rotation },
  release: jest.fn(),
});

let nextKey = 0;
const makeKey = () => `yuv-test-${nextKey++}`;

// A buffer imported with importSharedTextureMemory (react-native-webgpu
// patch), whose accesses end with a sync fd fence each.
const makeSharedMemory = (handle: bigint) => {
  const texture = {
    width: BUFFER_WIDTH,
    height: BUFFER_HEIGHT,
    destroy: jest.fn(),
  };
  const fences: { destroy: jest.Mock }[] = [];
  return {
    handle,
    texture,
    fences,
    createTexture: jest.fn(() => texture),
    beginAccess: jest.fn(),
    endAccess: jest.fn(() => {
      const fence = { destroy: jest.fn() };
      fences.push(fence);
      return { initialized: true, fences: [{ fence, signaledValue: 1n }] };
    }),
    destroy: jest.fn(),
  };
};

// A device with the createExternalTexture of the react-native-webgpu patch.
const makeSharedContext = () => {
  const base = makeContext();
  const memories: ReturnType<typeof makeSharedMemory>[] = [];
  const importSharedTextureMemory = jest.fn(
    ({ handle }: { handle: bigint }) => {
      const memory = makeSharedMemory(handle);
      memories.push(memory);
      return memory;
    }
  );
  const createExternalTexture = jest.fn(() => {
    const external = { yuvToRgbMatrix: YUV_TO_RGB, destroy: jest.fn() };
    base.externalTextures.push(external);
    return external;
  });
  Object.assign(base.device, {
    importSharedTextureMemory,
    createExternalTexture,
  });
  return {
    ...base,
    memories,
    importSharedTextureMemory,
    createExternalTexture,
  };
};

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
      ...YUV_TO_RGB,
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

describe('makeVideoFrame with YUV frames and createExternalTexture', () => {
  it('imports a buffer once, then only begins and ends the access to it', () => {
    const {
      context,
      device,
      memories,
      importSharedTextureMemory,
      createExternalTexture,
    } = makeSharedContext();
    const key = makeKey();
    const frames = [
      makeYUVFrame(1, 90, 360, 640, 7n),
      makeYUVFrame(2, 90, 360, 640, 7n),
    ];

    frames.forEach((frame) => makeVideoFrame(context, key, frame));

    expect(importSharedTextureMemory).toHaveBeenCalledTimes(1);
    expect(importSharedTextureMemory).toHaveBeenCalledWith({ handle: 7n });
    const memory = memories[0]!;
    expect(createExternalTexture).toHaveBeenCalledTimes(1);
    expect(createExternalTexture).toHaveBeenCalledWith(
      memory,
      memory.texture,
      90
    );
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);
    expect(device.importExternalTexture).not.toHaveBeenCalled();
    expect(memory.beginAccess).toHaveBeenCalledTimes(2);
    expect(memory.beginAccess).toHaveBeenCalledWith(memory.texture, true);
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
    // Each access ends once the commands sampling the buffer are submitted,
    // and its fences are released.
    expect(memory.endAccess).toHaveBeenCalledTimes(2);
    memory.endAccess.mock.invocationCallOrder.forEach((order, i) =>
      expect(order).toBeGreaterThan(
        device.queue.submit.mock.invocationCallOrder[i]!
      )
    );
    memory.fences.forEach((fence) =>
      expect(fence.destroy).toHaveBeenCalledTimes(1)
    );
    frames.forEach((frame) => expect(frame.release).toHaveBeenCalledTimes(1));
    // The region of the upright 1088×1920 buffer, as without the cache.
    const uniforms = Array.from(
      device.queue.writeBuffer.mock.calls[1]![2] as Float32Array
    );
    [1080 / 1088, 1, 8 / 1088, 0].forEach((value, i) =>
      expect(uniforms[12 + i]).toBeCloseTo(value, 5)
    );
  });

  it('releases the buffers no frame used for a while', () => {
    const { context, memories, externalTextures } = makeSharedContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080, 100n));
    for (let id = 2; id < 80; id++) {
      makeVideoFrame(context, key, makeYUVFrame(id, 0, 1920, 1080, 200n));
    }
    expect(memories[0]!.destroy).not.toHaveBeenCalled();
    // A new buffer: the decoder gave up the first one.
    makeVideoFrame(context, key, makeYUVFrame(80, 0, 1920, 1080, 300n));

    expect(externalTextures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(memories[0]!.texture.destroy).toHaveBeenCalledTimes(1);
    expect(memories[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(memories[1]!.destroy).not.toHaveBeenCalled();
  });

  it('imports the frame on its own if the access to its buffer fails', () => {
    const { context, device, memories, importSharedTextureMemory } =
      makeSharedContext();
    const key = makeKey();
    importSharedTextureMemory.mockImplementationOnce(({ handle }) => {
      const memory = makeSharedMemory(handle);
      memory.beginAccess.mockImplementation(() => {
        throw new Error('beginAccess failed');
      });
      memories.push(memory);
      return memory;
    });
    const frame = makeYUVFrame(1, 0, 1920, 1080, 7n);

    makeVideoFrame(context, key, frame);

    expect(device.importExternalTexture).toHaveBeenCalledTimes(1);
    expect(memories[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);

    // Imported again for the next frame.
    makeVideoFrame(context, key, makeYUVFrame(2, 0, 1920, 1080, 7n));
    expect(importSharedTextureMemory).toHaveBeenCalledTimes(2);
    expect(memories[1]!.beginAccess).toHaveBeenCalledTimes(1);
  });

  it('releases the imported buffers with the frames of the key', () => {
    const { context, memories, externalTextures } = makeSharedContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080, 7n));
    makeVideoFrame(context, key, makeYUVFrame(2, 0, 1920, 1080, 8n));
    releaseFrameImages(key);

    memories.forEach((memory) => {
      expect(memory.texture.destroy).toHaveBeenCalledTimes(1);
      expect(memory.destroy).toHaveBeenCalledTimes(1);
    });
    externalTextures.forEach((external) =>
      expect(external.destroy).toHaveBeenCalledTimes(1)
    );
  });
});
