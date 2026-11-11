import { Skia } from 'react-native-skia';
import type { FrameImageContext } from '../frameImages';
import { makeVideoFrame, releaseFrameImages } from '../frameImages';
import type { DecodedFrame } from '../types';

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

const WIDTH = 16;
const HEIGHT = 8;

const makeContext = () => {
  const importExternalTexture = jest.fn(() => ({ destroy: jest.fn() }));
  const createTexture = jest.fn(
    ({ size: [width, height] }: { size: [number, number] }) => ({
      width,
      height,
      destroy: jest.fn(),
      createView: jest.fn(() => ({})),
    })
  );
  const createVideoFrameFromNativeBuffer = jest.fn(() => ({
    width: WIDTH,
    height: HEIGHT,
    release: jest.fn(),
  }));
  const pass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    draw: jest.fn(),
    end: jest.fn(),
  };
  const device = {
    createShaderModule: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createPipelineLayout: jest.fn(() => ({})),
    createSampler: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => ({})),
    createBindGroup: jest.fn(() => ({})),
    createBuffer: jest.fn(() => ({ destroy: jest.fn() })),
    createCommandEncoder: jest.fn(() => ({
      beginRenderPass: jest.fn(() => pass),
      finish: jest.fn(() => ({})),
    })),
    createTexture,
    importExternalTexture,
    queue: { writeBuffer: jest.fn(), submit: jest.fn() },
  };
  const context = {
    device,
    webgpu: { createVideoFrameFromNativeBuffer },
  } as unknown as FrameImageContext;
  return {
    context,
    device,
    pass,
    importExternalTexture,
    createTexture,
    createVideoFrameFromNativeBuffer,
  };
};

const makeFrame = (buffer: bigint | undefined, id?: number): DecodedFrame => ({
  buffer,
  id,
  width: WIDTH,
  height: HEIGHT,
  rotation: 0,
  release: jest.fn(),
});

let nextKey = 0;
const makeKey = () => `test-${nextKey++}`;

describe('makeVideoFrame', () => {
  it('converts the frame into a texture of its key and wraps it', () => {
    const {
      context,
      device,
      pass,
      importExternalTexture,
      createTexture,
      createVideoFrameFromNativeBuffer,
    } = makeContext();
    const frame = makeFrame(1n, 1);

    const videoFrame = makeVideoFrame(context, makeKey(), frame);

    expect(createTexture).toHaveBeenCalledTimes(1);
    const texture = createTexture.mock.results[0]!.value;
    const nativeFrame = createVideoFrameFromNativeBuffer.mock.results[0]!.value;
    // Only the frame's YCbCr matrix is applied, not its transfer function.
    expect(importExternalTexture).toHaveBeenCalledWith({
      source: nativeFrame,
      sourceColorSpace: { primaries: 'srgb', transfer: 'srgb' },
    });
    // The whole frame drawn into the texture.
    expect(
      Array.from(device.queue.writeBuffer.mock.calls[0]![2] as Float32Array)
    ).toEqual([1, 1, 0, 0]);
    expect(texture.createView).toHaveBeenCalledTimes(1);
    expect(pass.draw).toHaveBeenCalledWith(3);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    // Released once the commands sampling it are submitted.
    const externalTexture = importExternalTexture.mock.results[0]!.value;
    expect(externalTexture.destroy.mock.invocationCallOrder[0]).toBeGreaterThan(
      device.queue.submit.mock.invocationCallOrder[0]!
    );
    expect(nativeFrame.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
    // The texture the image is made from, handed out with it.
    expect(videoFrame).toEqual({
      image: expect.anything(),
      texture,
      width: WIDTH,
      height: HEIGHT,
      rotation: 0,
    });
  });

  it('hands out the same image again for a frame handed out again', () => {
    const { context, importExternalTexture } = makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    const frameAgain = makeFrame(1n, 1);
    const again = makeVideoFrame(context, key, frameAgain);

    expect(importExternalTexture).toHaveBeenCalledTimes(1);
    expect(again.image).toBe(first.image);
    expect(again.texture).toBe(first.texture);
    expect(first.image.dispose).not.toHaveBeenCalled();
    // Android: the frame handed out again holds a reference to the buffer of
    // its own.
    expect(frameAgain.release).toHaveBeenCalledTimes(1);
  });

  it('keeps a frame whose conversion failed, to convert it again', () => {
    const { context, importExternalTexture } = makeContext();
    const key = makeKey();
    importExternalTexture.mockImplementationOnce(() => {
      throw new Error('importExternalTexture failed');
    });
    const frame = makeFrame(1n);

    expect(() => makeVideoFrame(context, key, frame)).toThrow(
      'importExternalTexture failed'
    );
    expect(frame.release).not.toHaveBeenCalled();

    // Handed out again, as the producer does until a new frame is decoded.
    const videoFrame = makeVideoFrame(context, key, frame);
    expect(importExternalTexture).toHaveBeenCalledTimes(2);
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(videoFrame.image).toBeTruthy();
  });

  it('hands out two images of the texture in turn for the new frames of a key', () => {
    const { context, importExternalTexture, createTexture } = makeContext();
    const makeImage = jest.mocked(Skia.Image.MakeFromGPUTexture);
    makeImage.mockClear();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    // The decoders recycle their buffers: a new frame can come in the buffer
    // of a previous one.
    const second = makeVideoFrame(context, key, makeFrame(1n, 2));
    const third = makeVideoFrame(context, key, makeFrame(1n, 3));

    expect(importExternalTexture).toHaveBeenCalledTimes(3);
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(makeImage).toHaveBeenCalledTimes(2);
    expect(second.image).not.toBe(first.image);
    expect(third.image).toBe(first.image);
    expect(first.image.dispose).not.toHaveBeenCalled();
    expect(second.image.dispose).not.toHaveBeenCalled();
  });

  it('disposes the images of a texture recreated for a new size', () => {
    const { context, createTexture, createVideoFrameFromNativeBuffer } =
      makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    const second = makeVideoFrame(context, key, makeFrame(1n, 2));
    createVideoFrameFromNativeBuffer.mockReturnValueOnce({
      width: WIDTH * 2,
      height: HEIGHT * 2,
      release: jest.fn(),
    });
    const resized = makeVideoFrame(context, key, makeFrame(1n, 3));

    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(createTexture.mock.results[0]!.value.destroy).toHaveBeenCalledTimes(
      1
    );
    expect(first.image.dispose).toHaveBeenCalledTimes(1);
    expect(second.image.dispose).toHaveBeenCalledTimes(1);
    expect(resized.image).not.toBe(first.image);
    expect(resized.image).not.toBe(second.image);
  });

  it('keeps the images of the previous size until a frame of the new size is converted', () => {
    const {
      context,
      createTexture,
      createVideoFrameFromNativeBuffer,
      importExternalTexture,
    } = makeContext();
    const key = makeKey();
    const resizedNativeFrame = () => ({
      width: WIDTH * 2,
      height: HEIGHT * 2,
      release: jest.fn(),
    });

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    createVideoFrameFromNativeBuffer.mockReturnValueOnce(resizedNativeFrame());
    importExternalTexture.mockImplementationOnce(() => {
      throw new Error('importExternalTexture failed');
    });
    const resizedFrame = makeFrame(1n, 2);
    expect(() => makeVideoFrame(context, key, resizedFrame)).toThrow(
      'importExternalTexture failed'
    );

    // The image handed out last is still the one shown.
    const [texture, resizedTexture] = createTexture.mock.results.map(
      (result) => result.value
    );
    expect(first.image.dispose).not.toHaveBeenCalled();
    expect(texture.destroy).not.toHaveBeenCalled();

    // Handed out again and converted, into the texture made for its size.
    createVideoFrameFromNativeBuffer.mockReturnValueOnce(resizedNativeFrame());
    const resized = makeVideoFrame(context, key, resizedFrame);
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(resized.texture).toBe(resizedTexture);
    expect(first.image.dispose).toHaveBeenCalledTimes(1);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(resizedTexture.destroy).not.toHaveBeenCalled();
  });

  it('keeps a frame whose image could not be made, to convert it again', () => {
    const { context } = makeContext();
    const key = makeKey();
    jest.mocked(Skia.Image.MakeFromGPUTexture).mockImplementationOnce(() => {
      throw new Error('MakeFromGPUTexture failed');
    });
    const frame = makeFrame(1n);

    expect(() => makeVideoFrame(context, key, frame)).toThrow(
      'MakeFromGPUTexture failed'
    );
    expect(frame.release).not.toHaveBeenCalled();

    expect(makeVideoFrame(context, key, frame).image).toBeTruthy();
    expect(frame.release).toHaveBeenCalledTimes(1);
  });

  it('makes the texture and the images again on a device that replaced theirs', () => {
    const lost = makeContext();
    const replacement = makeContext();
    const key = makeKey();
    const lostContext = { ...lost.context, deviceId: 'lost' };
    const context = { ...replacement.context, deviceId: 'replacement' };

    const first = makeVideoFrame(lostContext, key, makeFrame(1n, 1));
    // The frame handed out again: its image went with the lost device.
    const again = makeVideoFrame(context, key, makeFrame(1n, 1));

    expect(first.image.dispose).toHaveBeenCalledTimes(1);
    expect(
      lost.createTexture.mock.results[0]!.value.destroy
    ).toHaveBeenCalledTimes(1);
    expect(replacement.createTexture).toHaveBeenCalledTimes(1);
    expect(again.image).not.toBe(first.image);
    expect(again.texture).toBe(
      replacement.createTexture.mock.results[0]!.value
    );
  });

  it('hands out the image again for a frame released after its conversion', () => {
    const { context, importExternalTexture } = makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n));
    const again = makeVideoFrame(context, key, makeFrame(undefined));

    expect(importExternalTexture).toHaveBeenCalledTimes(1);
    expect(again.image).toBe(first.image);
  });

  it('throws for a released frame that was never converted', () => {
    const { context } = makeContext();

    expect(() =>
      makeVideoFrame(context, makeKey(), makeFrame(undefined))
    ).toThrow('released');
  });
});

describe('releaseFrameImages', () => {
  it('disposes the images and the textures of the key and of its items', () => {
    const { context, importExternalTexture, createTexture } = makeContext();
    const key = makeKey();
    const other = makeKey();

    const frame = makeVideoFrame(context, key, makeFrame(1n, 1));
    const nextFrame = makeVideoFrame(context, key, makeFrame(1n, 4));
    const item = makeVideoFrame(context, `${key}:item`, makeFrame(2n, 2));
    const otherFrame = makeVideoFrame(context, other, makeFrame(3n, 3));
    releaseFrameImages(key);

    expect(frame.image.dispose).toHaveBeenCalledTimes(1);
    expect(nextFrame.image.dispose).toHaveBeenCalledTimes(1);
    expect(item.image.dispose).toHaveBeenCalledTimes(1);
    expect(otherFrame.image.dispose).not.toHaveBeenCalled();
    const [texture, itemTexture, otherTexture] = createTexture.mock.results.map(
      (result) => result.value
    );
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(itemTexture.destroy).toHaveBeenCalledTimes(1);
    expect(otherTexture.destroy).not.toHaveBeenCalled();

    // The same frame handed out again is converted into a new texture.
    makeVideoFrame(context, key, makeFrame(1n, 4));
    expect(importExternalTexture).toHaveBeenCalledTimes(5);
    expect(createTexture).toHaveBeenCalledTimes(4);
  });
});
