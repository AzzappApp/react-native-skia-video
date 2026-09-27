import { Skia } from '@shopify/react-native-skia';
import { drawVideoFrame, makeVideoFrameImage } from '../videoFrameImage';
import type { VideoFrame } from '../types';

jest.mock('@shopify/react-native-skia', () => ({
  Skia: {
    Image: {
      MakeImageFromNativeTextureUnstable: jest.fn(
        (
          _texture: unknown,
          width: number,
          height: number,
          _mipmapped: boolean,
          output?: unknown
        ) => output ?? { kind: 'image', width, height }
      ),
    },
    Paint: jest.fn(() => ({ kind: 'paint' })),
  },
}));

const makeImage = Skia.Image.MakeImageFromNativeTextureUnstable as jest.Mock;

const canvas = () => {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    canvas: {
      drawImageRect: record('drawImageRect'),
      save: record('save'),
      restore: record('restore'),
      translate: record('translate'),
      rotate: record('rotate'),
    } as any,
  };
};

const copyFrame: VideoFrame = {
  texture: { glID: 1 },
  width: 1280,
  height: 720,
  rotation: 0,
};

// A 1080p H.264 buffer as Android hands it over with textureMode 'direct'.
const directFrame = (rotation: number): VideoFrame => ({
  texture: { glID: 2 },
  width: 1920,
  height: 1088,
  rotation,
  crop: { x: 0, y: 0, width: 1920, height: 1080 },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('makeVideoFrameImage', () => {
  it('wraps the whole texture of a frame without a crop', () => {
    const result = makeVideoFrameImage(copyFrame)!;
    expect(makeImage).toHaveBeenCalledWith(
      copyFrame.texture,
      1280,
      720,
      false,
      undefined
    );
    expect(result.rect).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(result.rotation).toBe(0);
    expect([result.width, result.height]).toEqual([1280, 720]);
  });

  it('keeps to the picture of a decoder buffer, and turns its size', () => {
    const result = makeVideoFrameImage(directFrame(90))!;
    expect(makeImage.mock.calls[0]?.slice(1, 3)).toEqual([1920, 1088]);
    expect(result.rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(result.rotation).toBe(90);
    expect([result.width, result.height]).toEqual([1080, 1920]);
  });

  it('normalises the rotation', () => {
    expect(makeVideoFrameImage({ ...copyFrame, rotation: -90 })!.rotation).toBe(
      270
    );
    expect(makeVideoFrameImage({ ...copyFrame, rotation: 450 })!.rotation).toBe(
      90
    );
  });

  it('recycles the output image', () => {
    const output = { kind: 'recycled' } as any;
    expect(makeVideoFrameImage(copyFrame, output)!.image).toBe(output);
    expect(makeImage.mock.calls[0]?.[4]).toBe(output);
  });

  it('has nothing for a frame without a texture', () => {
    expect(
      makeVideoFrameImage({ ...copyFrame, texture: undefined })
    ).toBeNull();
    expect(makeImage).not.toHaveBeenCalled();
  });
});

describe('drawVideoFrame', () => {
  const dst = { x: 10, y: 20, width: 100, height: 100 };

  it('stretches an upright frame over the destination by default', () => {
    const { canvas: c, calls } = canvas();
    drawVideoFrame(c, copyFrame, dst);
    expect(calls).toEqual([
      [
        'drawImageRect',
        expect.anything(),
        { x: 0, y: 0, width: 1280, height: 720 },
        dst,
        { kind: 'paint' },
      ],
    ]);
  });

  it('draws only the picture of a decoder buffer', () => {
    const { canvas: c, calls } = canvas();
    drawVideoFrame(c, directFrame(0), dst);
    expect(calls[0]?.[2]).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('covers with the middle of the picture', () => {
    const { canvas: c, calls } = canvas();
    drawVideoFrame(c, directFrame(0), dst, { fit: 'cover' });
    expect(calls[0]?.[2]).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(calls[0]?.[3]).toEqual(dst);
  });

  it('contains the whole picture in the middle of the destination', () => {
    const { canvas: c, calls } = canvas();
    drawVideoFrame(c, directFrame(0), dst, { fit: 'contain' });
    expect(calls[0]?.[2]).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(calls[0]?.[3]).toEqual({
      x: 10,
      y: 41.875,
      width: 100,
      height: 56.25,
    });
  });

  it('turns a rotated frame about the middle of the destination', () => {
    const { canvas: c, calls } = canvas();
    const portrait = { x: 0, y: 0, width: 108, height: 192 };
    drawVideoFrame(c, directFrame(90), portrait);
    expect(calls).toEqual([
      ['save'],
      ['translate', 54, 96],
      ['rotate', 90, 0, 0],
      [
        'drawImageRect',
        expect.anything(),
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: -96, y: -54, width: 192, height: 108 },
        { kind: 'paint' },
      ],
      ['restore'],
    ]);
  });

  it('covers with the middle of a rotated picture', () => {
    for (const rotation of [90, 180, 270]) {
      const { canvas: c, calls } = canvas();
      drawVideoFrame(c, directFrame(rotation), dst, { fit: 'cover' });
      const draw = calls.find((call) => call[0] === 'drawImageRect')!;
      expect(draw[2]).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    }
  });

  it('maps an offset crop through the rotation', () => {
    const frame: VideoFrame = {
      texture: {},
      width: 200,
      height: 100,
      rotation: 90,
      crop: { x: 10, y: 20, width: 100, height: 50 },
    };
    const { canvas: c, calls } = canvas();
    drawVideoFrame(c, frame, dst);
    const draw = calls.find((call) => call[0] === 'drawImageRect')!;
    expect(draw[2]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('uses the given paint, recycles the image and returns it', () => {
    const { canvas: c, calls } = canvas();
    const paint = { kind: 'faded' } as any;
    const output = { kind: 'recycled' } as any;
    expect(drawVideoFrame(c, copyFrame, dst, { paint, output })).toBe(output);
    expect(calls[0]?.[4]).toBe(paint);
  });

  it('draws nothing for a frame without a texture', () => {
    const { canvas: c, calls } = canvas();
    expect(
      drawVideoFrame(c, { ...copyFrame, texture: undefined }, dst)
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
