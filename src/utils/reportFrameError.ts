/**
 * Reports an error of a frame callback once per message: the callback runs
 * on every frame, and the same failure would otherwise be logged 60 times a
 * second.
 */
const reportFrameError = (stage: string, error: unknown) => {
  'worklet';
  const global = globalThis as unknown as {
    __rnskvReportedFrameErrors?: Record<string, true>;
  };
  if (global.__rnskvReportedFrameErrors == null) {
    global.__rnskvReportedFrameErrors = {};
  }
  const message = error instanceof Error ? error.message : String(error);
  const key = `${stage}: ${message}`;
  if (global.__rnskvReportedFrameErrors[key]) {
    return;
  }
  global.__rnskvReportedFrameErrors[key] = true;
  console.error(
    `[react-native-skia-video] ${key}`,
    error instanceof Error ? error.stack : ''
  );
};

export default reportFrameError;
