import type { FrameImageContext } from '../frameImages';
import {
  makeVideoFrame,
  makeVideoFrames,
  releaseFrameImages,
  uprightCrop,
} from '../frameImages';
import type { DecodedFrame } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('react-native-skia', () => ({
  Skia: {
    Image: {
      MakeFromGPUTexture: jest.fn(() => ({ dispose: jest.fn() })),
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

// A buffer imported once with importSharedTextureMemory, with the external
// texture over its texture; its accesses end with a fence each.
type Import = {
  memory: {
    createTexture: jest.Mock;
    beginAccess: jest.Mock;
    endAccess: jest.Mock;
    destroy: jest.Mock;
  };
  texture: { destroy: jest.Mock };
  externalTexture: { destroy: jest.Mock };
  fences: { destroy: jest.Mock }[];
};

const makeImport = (): Import => {
  const fences: { destroy: jest.Mock }[] = [];
  const texture = { destroy: jest.fn() };
  return {
    memory: {
      createTexture: jest.fn(() => texture),
      beginAccess: jest.fn(),
      endAccess: jest.fn(() => {
        const fence = { destroy: jest.fn() };
        fences.push(fence);
        return { initialized: true, fences: [{ fence, signaledValue: 1n }] };
      }),
      destroy: jest.fn(),
    },
    texture,
    externalTexture: { destroy: jest.fn() },
    fences,
  };
};

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
  const imports: Import[] = [];
  const addImport = (imported = makeImport()) => {
    imports.push(imported);
    return imported.memory;
  };
  const nativeBuffers: { width: number; height: number; release: jest.Mock }[] =
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
    importSharedTextureMemory: jest.fn(() => addImport()),
    importExternalTexture: jest.fn(
      () => imports[imports.length - 1]!.externalTexture
    ),
    queue: {
      writeBuffer: jest.fn(),
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
    },
  };
  const webgpu = {
    createNativeBufferFromPointer: jest.fn(() => {
      const nativeBuffer = {
        width: BUFFER_WIDTH,
        height: BUFFER_HEIGHT,
        release: jest.fn(),
      };
      nativeBuffers.push(nativeBuffer);
      return nativeBuffer;
    }),
  };
  const context = { device, webgpu } as unknown as FrameImageContext;
  return { context, device, webgpu, pass, imports, addImport, nativeBuffers };
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
    const { context, device, webgpu, pass, imports, nativeBuffers } =
      makeContext();
    // A portrait video (stored rotated) decoded at 360×640.
    const frame = makeYUVFrame(1, 90, 360, 640);

    const videoFrame = makeVideoFrame(context, makeKey(), frame);

    expect(webgpu.createNativeBufferFromPointer).toHaveBeenCalledWith(1n);
    expect(device.importSharedTextureMemory).toHaveBeenCalledWith({
      source: nativeBuffers[0],
    });
    const imported = imports[0]!;
    // Only the frame's YCbCr matrix is applied, not its transfer function.
    expect(device.importExternalTexture).toHaveBeenCalledWith({
      source: imported.texture,
      rotation: 90,
      sourceColorSpace: { primaries: 'srgb', transfer: 'srgb' },
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
    // submitted, never before, and its fence is released.
    expect(imported.memory.beginAccess).toHaveBeenCalledWith(
      imported.texture,
      true
    );
    expect(imported.memory.endAccess).toHaveBeenCalledWith(imported.texture);
    expect(
      imported.memory.endAccess.mock.invocationCallOrder[0]
    ).toBeGreaterThan(device.queue.submit.mock.invocationCallOrder[0]!);
    expect(imported.fences[0]!.destroy).toHaveBeenCalledTimes(1);
    // The import keeps the native buffer until it is released.
    expect(nativeBuffers[0]!.release).not.toHaveBeenCalled();
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(videoFrame).toEqual({
      image: expect.anything(),
      texture: expect.anything(),
      width: 360,
      height: 640,
      rotation: 0,
    });
  });

  it('imports a buffer once, then only begins and ends the access to it', () => {
    const { context, device, imports } = makeContext();
    const key = makeKey();
    const frames = [
      makeYUVFrame(1, 0, 1920, 1080, 7n),
      makeYUVFrame(2, 0, 1920, 1080, 7n),
    ];

    frames.forEach((frame) => makeVideoFrame(context, key, frame));

    expect(device.importSharedTextureMemory).toHaveBeenCalledTimes(1);
    expect(device.importExternalTexture).toHaveBeenCalledTimes(1);
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);
    expect(imports[0]!.memory.beginAccess).toHaveBeenCalledTimes(2);
    expect(imports[0]!.memory.endAccess).toHaveBeenCalledTimes(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
    frames.forEach((frame) => expect(frame.release).toHaveBeenCalledTimes(1));
  });

  it('releases the buffers no frame used for a while', () => {
    const { context, imports, nativeBuffers } = makeContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080, 100n));
    for (let id = 2; id < 80; id++) {
      makeVideoFrame(context, key, makeYUVFrame(id, 0, 1920, 1080, 200n));
    }
    expect(imports[0]!.memory.destroy).not.toHaveBeenCalled();
    // A new buffer: the decoder gave up the first one.
    makeVideoFrame(context, key, makeYUVFrame(80, 0, 1920, 1080, 300n));

    expect(imports[0]!.externalTexture.destroy).toHaveBeenCalledTimes(1);
    expect(imports[0]!.texture.destroy).toHaveBeenCalledTimes(1);
    expect(imports[0]!.memory.destroy).toHaveBeenCalledTimes(1);
    expect(nativeBuffers[0]!.release).toHaveBeenCalledTimes(1);
    expect(imports[1]!.memory.destroy).not.toHaveBeenCalled();
    expect(nativeBuffers[1]!.release).not.toHaveBeenCalled();
  });

  it('imports a buffer again if the access to it fails', () => {
    const { context, device, addImport, nativeBuffers } = makeContext();
    const key = makeKey();
    const failing = makeImport();
    failing.memory.beginAccess.mockImplementation(() => {
      throw new Error('beginAccess failed');
    });
    device.importSharedTextureMemory.mockImplementationOnce(() =>
      addImport(failing)
    );
    const frame = makeYUVFrame(1, 0, 1920, 1080, 7n);

    expect(() => makeVideoFrame(context, key, frame)).toThrow(
      'beginAccess failed'
    );
    expect(failing.memory.destroy).toHaveBeenCalledTimes(1);
    expect(nativeBuffers[0]!.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);

    makeVideoFrame(context, key, makeYUVFrame(2, 0, 1920, 1080, 7n));
    expect(device.importSharedTextureMemory).toHaveBeenCalledTimes(2);
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
  it('destroys the uniform buffer and the imported buffers of the key', () => {
    const { context, device, imports, nativeBuffers } = makeContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeYUVFrame(1, 0, 1920, 1080));
    makeVideoFrame(context, key, makeYUVFrame(2, 0, 1920, 1080));
    releaseFrameImages(key);

    const uniformBuffer = device.createBuffer.mock.results[0]!.value;
    expect(uniformBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(imports).toHaveLength(2);
    imports.forEach(({ externalTexture, texture, memory }) => {
      expect(externalTexture.destroy).toHaveBeenCalledTimes(1);
      expect(texture.destroy).toHaveBeenCalledTimes(1);
      expect(memory.destroy).toHaveBeenCalledTimes(1);
      // The textures go before the memory they were created from.
      expect(memory.destroy.mock.invocationCallOrder[0]).toBeGreaterThan(
        texture.destroy.mock.invocationCallOrder[0]!
      );
    });
    // The buffers are released after their imports.
    nativeBuffers.forEach((nativeBuffer, i) => {
      expect(nativeBuffer.release).toHaveBeenCalledTimes(1);
      expect(nativeBuffer.release.mock.invocationCallOrder[0]).toBeGreaterThan(
        imports[i]!.memory.destroy.mock.invocationCallOrder[0]!
      );
    });
    // A submission after the release, for Dawn to free the buffers now.
    expect(device.queue.submit).toHaveBeenCalledTimes(3);
    expect(device.queue.submit).toHaveBeenLastCalledWith([]);
    expect(device.queue.submit.mock.invocationCallOrder[2]).toBeGreaterThan(
      imports[1]!.memory.destroy.mock.invocationCallOrder[0]!
    );
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  });
});

describe('makeVideoFrames with YUV frames', () => {
  it('releases the imported buffers of the items without a frame a few per frame', () => {
    const { context, imports, nativeBuffers } = makeContext();
    const key = makeKey();
    // The item `a` renders into 5 buffers in turn, `b` into one.
    for (let id = 1; id <= 5; id++) {
      makeVideoFrames(context, key, {
        a: makeYUVFrame(id, 0, 1920, 1080),
        b: makeYUVFrame(10, 0, 1920, 1080),
      });
    }
    expect(imports).toHaveLength(6);
    const importsA = imports.filter((_, i) => i !== 1);
    const released = () =>
      importsA.filter(({ memory }) => memory.destroy.mock.calls.length > 0)
        .length;

    // The item `a` is no longer live: 2 of its buffers are released per frame.
    makeVideoFrames(context, key, { b: makeYUVFrame(10, 0, 1920, 1080) });
    expect(released()).toBe(2);
    makeVideoFrames(context, key, { b: makeYUVFrame(10, 0, 1920, 1080) });
    expect(released()).toBe(4);
    expect(imports[1]!.memory.destroy).not.toHaveBeenCalled();

    // The rest is released with the key.
    releaseFrameImages(key);
    expect(released()).toBe(5);
    imports.forEach(({ memory }) => {
      expect(memory.destroy).toHaveBeenCalledTimes(1);
    });
    nativeBuffers.forEach((nativeBuffer) => {
      expect(nativeBuffer.release).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves out the frame of an item that cannot be made, with onError', () => {
    const { context } = makeContext();
    const broken: DecodedFrame = {
      ...makeYUVFrame(2, 0, 1920, 1080),
      yuv: undefined,
    };
    const onError = jest.fn();

    const frames = makeVideoFrames(
      context,
      makeKey(),
      {
        a: makeYUVFrame(1, 0, 1920, 1080),
        b: broken,
        c: makeYUVFrame(3, 0, 1920, 1080),
      },
      onError
    );

    expect(Object.keys(frames)).toEqual(['a', 'c']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('b', expect.any(Error));
    expect(broken.release).toHaveBeenCalledTimes(1);
  });

  it('throws for an item that cannot be made, without onError', () => {
    const { context } = makeContext();

    expect(() =>
      makeVideoFrames(context, makeKey(), {
        a: { ...makeYUVFrame(1, 0, 1920, 1080), yuv: undefined },
      })
    ).toThrow('no YUV layout');
  });
});
