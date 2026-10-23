import { Skia } from 'react-native-skia';

/**
 * The GPU device React Native Skia renders with, identified by the address of
 * its WGPUDevice (Skia.getNativeDevice()) as a string; empty without one.
 *
 * React Native Skia replaces a lost device (a driver reset, the GPU out of
 * memory, GPU work refused while the app was in the background on iOS), and
 * what was made on the lost device is good for nothing from then on. Worse:
 * once a view presents on the new device, the old one is destroyed, and the
 * GPU buffers its recorders still hold go with it — drawing into a surface
 * made on it then writes into freed memory, a crash in Graphite rather than a
 * blank frame. Comparing this id with the one something was made on tells,
 * synchronously and on any runtime, that it must be made again; the
 * `lost` promise of Skia.gpu only settles on the JS thread, frames later.
 *
 * A string rather than a number: on Android the address can carry a tag in
 * its top byte, beyond what a double holds exactly.
 */
const skiaDeviceId = (): string => {
  'worklet';
  try {
    return String(Skia.getNativeDevice());
  } catch {
    // no GPU to render with (Skia.gpu says why)
    return '';
  }
};

export default skiaDeviceId;
