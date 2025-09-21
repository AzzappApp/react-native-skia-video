import { NativeModules, Platform } from 'react-native';
import type { RNSkiaVideoModule } from './types';

// @ts-expect-error __turboModuleProxy is not yet added to the type definitions
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const ReactNativeSkiaVideoModule = isTurboModuleEnabled
  ? require('./NativeReactNativeSkiaVideo').default
  : NativeModules.ReactNativeSkiaVideo;

if (!ReactNativeSkiaVideoModule) {
  throw new Error(
    `The package '@sheunglaili/react-native-skia-video' doesn't seem to be linked. Make sure: \n\n` +
      Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
      '- You rebuilt the app after installing the package\n' +
      '- You are not using Expo Go\n'
  );
}

ReactNativeSkiaVideoModule.install();

export default (global as any).RNSkiaVideo as RNSkiaVideoModule;
