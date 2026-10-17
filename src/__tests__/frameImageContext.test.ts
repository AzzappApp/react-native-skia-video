jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mockGpu = { isAvailable: true, error: null as string | null };
const mockDevicePointer = 42n;

jest.mock('react-native-skia', () => ({
  Skia: {
    get gpu() {
      return mockGpu;
    },
    getNativeDevice: jest.fn(() => mockDevicePointer),
  },
}));

jest.mock('react-native-webgpu', () => ({
  importDevice: jest.fn((pointer: bigint) => ({ pointer })),
}));

const loadFrameImages = () => {
  let frameImages: typeof import('../frameImages') | undefined;
  jest.isolateModules(() => {
    frameImages = require('../frameImages');
  });
  return frameImages!;
};

describe('getFrameImageContext', () => {
  beforeEach(() => {
    (globalThis as { RNWebGPU?: unknown }).RNWebGPU = {};
    mockGpu.isAvailable = true;
    mockGpu.error = null;
  });

  afterEach(() => {
    delete (globalThis as { RNWebGPU?: unknown }).RNWebGPU;
  });

  it("imports Skia's GPU device", () => {
    const context = loadFrameImages().getFrameImageContext();

    expect(context.device).toEqual({ pointer: mockDevicePointer });
  });

  it("throws Skia's reason when it has no GPU to render with", () => {
    mockGpu.isAvailable = false;
    mockGpu.error = 'Vulkan 1.1 is not available on this device';

    expect(() => loadFrameImages().getFrameImageContext()).toThrow(
      "@azzapp/react-native-skia-video can't draw video frames: " +
        'Vulkan 1.1 is not available on this device'
    );
  });
});
