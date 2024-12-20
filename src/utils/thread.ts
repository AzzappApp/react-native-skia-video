import { createWorkletRuntime, runOnRuntime } from 'react-native-reanimated';
import { Platform } from 'react-native';
import RNSkiaVideoModule from '../RNSkiaVideoModule';

const isAndroid = Platform.OS === 'android';

const runOnNewThread = (fn: () => void) => {
  const exportRuntime = createWorkletRuntime(
    'RNSkiaVideoExportRuntime-' + performance.now()
  );

  runOnRuntime(exportRuntime, () => {
    'worklet';
    if (isAndroid) {
      RNSkiaVideoModule.runWithJNIClassLoader?.(() => {
        'worklet';
        fn();
      });
    } else {
      fn();
    }
  })();
};

export { runOnNewThread };
