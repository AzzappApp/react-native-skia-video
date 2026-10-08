import type { FrameImageContext } from '../frameImages';
import { makeVideoFrame, releaseFrameImages } from '../frameImages';
import type { DecodedFrame } from '../types';

jest.mock('react-native-skia', () => ({
  Skia: {
    Image: {
      MakeImageFromGPUTexture: jest.fn(() => ({ dispose: jest.fn() })),
    },
  },
}));

jest.mock('react-native-webgpu', () => ({
  GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 },
  importDevice: jest.fn(),
}));

const WIDTH = 16;
const HEIGHT = 8;

const makeContext = () => {
  const copyExternalImageToTexture = jest.fn();
  const createTexture = jest.fn(
    ({ size: [width, height] }: { size: [number, number] }) => ({
      width,
      height,
      destroy: jest.fn(),
    })
  );
  const createVideoFrameFromNativeBuffer = jest.fn(() => ({
    width: WIDTH,
    height: HEIGHT,
    release: jest.fn(),
  }));
  const context = {
    device: { createTexture, queue: { copyExternalImageToTexture } },
    webgpu: { createVideoFrameFromNativeBuffer },
  } as unknown as FrameImageContext;
  return {
    context,
    copyExternalImageToTexture,
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
  it('copies the frame into a texture of its key and wraps it', () => {
    const { context, copyExternalImageToTexture, createTexture } =
      makeContext();
    const frame = makeFrame(1n, 1);

    const videoFrame = makeVideoFrame(context, makeKey(), frame);

    expect(createTexture).toHaveBeenCalledTimes(1);
    const texture = createTexture.mock.results[0]!.value;
    expect(copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: expect.objectContaining({ width: WIDTH, height: HEIGHT }) },
      { texture },
      [WIDTH, HEIGHT]
    );
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(videoFrame).toEqual({
      image: expect.anything(),
      width: WIDTH,
      height: HEIGHT,
      rotation: 0,
    });
  });

  it('hands out the same image again for a frame handed out again', () => {
    const { context, copyExternalImageToTexture } = makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    const frameAgain = makeFrame(1n, 1);
    const again = makeVideoFrame(context, key, frameAgain);

    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(again.image).toBe(first.image);
    expect(first.image.dispose).not.toHaveBeenCalled();
    // Android: the frame handed out again carries a ready fence of its own.
    expect(frameAgain.release).toHaveBeenCalledTimes(1);
  });

  it('copies a new frame of the same key and disposes the previous image', () => {
    const { context, copyExternalImageToTexture, createTexture } =
      makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n, 1));
    // The decoders recycle their buffers: a new frame can come in the buffer
    // of a previous one.
    const second = makeVideoFrame(context, key, makeFrame(1n, 2));

    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(second.image).not.toBe(first.image);
    expect(first.image.dispose).toHaveBeenCalledTimes(1);
    expect(second.image.dispose).not.toHaveBeenCalled();
  });

  it('hands out the image again for a frame released after its copy', () => {
    const { context, copyExternalImageToTexture } = makeContext();
    const key = makeKey();

    const first = makeVideoFrame(context, key, makeFrame(1n));
    const again = makeVideoFrame(context, key, makeFrame(undefined));

    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(again.image).toBe(first.image);
  });

  it('throws for a released frame that was never copied', () => {
    const { context } = makeContext();

    expect(() =>
      makeVideoFrame(context, makeKey(), makeFrame(undefined))
    ).toThrow('released');
  });
});

describe('releaseFrameImages', () => {
  it('disposes the images and the textures of the key and of its items', () => {
    const { context, copyExternalImageToTexture, createTexture } =
      makeContext();
    const key = makeKey();
    const other = makeKey();

    const frame = makeVideoFrame(context, key, makeFrame(1n, 1));
    const item = makeVideoFrame(context, `${key}:item`, makeFrame(2n, 2));
    const otherFrame = makeVideoFrame(context, other, makeFrame(3n, 3));
    releaseFrameImages(key);

    expect(frame.image.dispose).toHaveBeenCalledTimes(1);
    expect(item.image.dispose).toHaveBeenCalledTimes(1);
    expect(otherFrame.image.dispose).not.toHaveBeenCalled();
    const [texture, itemTexture, otherTexture] = createTexture.mock.results.map(
      (result) => result.value
    );
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(itemTexture.destroy).toHaveBeenCalledTimes(1);
    expect(otherTexture.destroy).not.toHaveBeenCalled();

    // The same frame handed out again is copied into a new texture.
    makeVideoFrame(context, key, makeFrame(1n, 1));
    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(4);
    expect(createTexture).toHaveBeenCalledTimes(4);
  });
});
