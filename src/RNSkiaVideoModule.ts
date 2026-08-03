import { Platform } from 'react-native';
import type { RNSkiaVideoModule } from './types';
import NativeReactNativeSkiaVideo from './NativeReactNativeSkiaVideo';

if (!NativeReactNativeSkiaVideo) {
  throw new Error(
    `The package '@azzapp/react-native-skia-video' doesn't seem to be linked. Make sure: \n\n` +
      Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
      '- You rebuilt the app after installing the package\n' +
      '- You are not using Expo Go\n'
  );
}

const installed = NativeReactNativeSkiaVideo.install();
if (!installed || (global as any).RNSkiaVideo == null) {
  throw new Error(
    "The package '@azzapp/react-native-skia-video' failed to install its JSI bindings."
  );
}

export default (global as any).RNSkiaVideo as RNSkiaVideoModule;
