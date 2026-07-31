import { createWorkletRuntime, runOnRuntime } from 'react-native-worklets';

const runOnNewThread = (fn: () => void) => {
  const exportRuntime = createWorkletRuntime({
    name: 'RNSkiaVideoExportRuntime-' + performance.now(),
  });

  runOnRuntime(exportRuntime, () => {
    'worklet';
    fn();
  })();
};

export { runOnNewThread };
