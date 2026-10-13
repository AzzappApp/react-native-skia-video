const mockSetYUVFramesSupported = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 33 },
}));
jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: { setYUVFramesSupported: mockSetYUVFramesSupported },
}));

const makeContext = (features: string[]) =>
  ({
    device: { features: new Set(features) },
    webgpu: {},
  }) as any;

describe('checkYUVFramesSupport', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSetYUVFramesSupported.mockClear();
  });

  it('enables the YUV frames when Skia’s device can sample them', () => {
    const { checkYUVFramesSupport } = require('../yuvFrames');
    checkYUVFramesSupport(
      makeContext(['opaque-ycbcr-android-for-external-texture'])
    );
    expect(mockSetYUVFramesSupported).toHaveBeenCalledWith(true);
  });

  it('keeps the OpenGL frames otherwise', () => {
    const { checkYUVFramesSupport } = require('../yuvFrames');
    checkYUVFramesSupport(makeContext([]));
    expect(mockSetYUVFramesSupported).toHaveBeenCalledWith(false);
  });

  it('checks once', () => {
    const { checkYUVFramesSupport } = require('../yuvFrames');
    const context = makeContext(['opaque-ycbcr-android-for-external-texture']);
    checkYUVFramesSupport(context);
    checkYUVFramesSupport(context);
    expect(mockSetYUVFramesSupported).toHaveBeenCalledTimes(1);
  });
});
