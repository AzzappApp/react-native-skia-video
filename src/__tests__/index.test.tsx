import { Platform } from 'react-native';
import * as api from '../index';

// Only the module surface matters here: the hooks are not rendered.
jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn(),
  useFrameCallback: jest.fn(),
  runOnUI: jest.fn(),
}));
jest.mock('react-native-worklets', () => ({
  createWorkletRuntime: jest.fn(),
  runOnRuntime: jest.fn(),
  scheduleOnRN: jest.fn(),
  createSynchronizable: jest.fn(),
}));
jest.mock('@shopify/react-native-skia', () => ({ Skia: {}, BlendMode: {} }));
jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    getValidEncoderConfigurations: jest.fn(() => []),
    getDecodingCapabilitiesFor: jest.fn(() => null),
  },
}));

describe('public API', () => {
  it('exposes the hooks and the export function', () => {
    expect(typeof api.useVideoPlayer).toBe('function');
    expect(typeof api.useVideoCompositionPlayer).toBe('function');
    expect(typeof api.exportVideoComposition).toBe('function');
  });

  it('only offers the codec capability helpers on Android', () => {
    // The React Native jest preset runs as iOS.
    expect(Platform.OS).toBe('ios');
    expect(() => api.getValidEncoderConfigurations(1920, 1080, 30, 1)).toThrow(
      'only available on Android'
    );
    expect(() => api.getDecodingCapabilitiesFor('video/avc')).toThrow(
      'only available on Android'
    );
  });
});
