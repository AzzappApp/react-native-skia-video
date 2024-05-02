import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package '@azzapp/react-native-skia-video' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// @ts-expect-error
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const ReactNativeSkiaVideoModule = isTurboModuleEnabled
  ? require('./NativeReactNativeSkiaVideo').default
  : NativeModules.ReactNativeSkiaVideo;

const ReactNativeSkiaVideo = ReactNativeSkiaVideoModule
  ? ReactNativeSkiaVideoModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export function multiply(a: number, b: number): Promise<number> {
  return ReactNativeSkiaVideo.multiply(a, b);
}
