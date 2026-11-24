# React Native Skia Video example

The example app of the library, built against its local sources: changes to
the library's TypeScript show up on reload, changes to its native code need a
rebuild. It has three screens:

- **Video player**: plays videos found on [Pexels](https://www.pexels.com/api/)
  with `useVideoPlayer`. Put your Pexels API key in
  `src/helpers/pexelsClient.ts` (don't commit it).
- **Video composition**: previews a composition with
  `useVideoCompositionPlayer` and exports it with `exportVideoComposition`.
- **Benchmark**: see [Benchmark](#benchmark).

## Running the app

From the root of the repository:

```sh
yarn                # installs the library and the example's dependencies
yarn example start  # starts Metro
yarn example ios    # or: yarn example android
```

On iOS, run `pod install` in `example/ios` after a change of the native
dependencies. On Android, the app is built with NDK 27, the one React Native
WebGPU needs (see
[Android NDK](https://azzappapp.github.io/react-native-skia-video/docs/getting-started#android-ndk)).

To edit the library's native code: open `example/ios/ReactNativeSkiaVideoExample.xcworkspace`
in Xcode (`Pods > Development Pods > @azzapp/react-native-skia-video`), or
`example/android` in Android Studio (`azzapp-react-native-skia-video`).

## Benchmark

The **Benchmark** screen measures the library on the device, with reproducible
scenarios, to compare branches or devices:

- **Test clips** (1080p30, 1080p60, 2160p30, 12 s) are generated on the device
  the first time (a synthetic animation exported by the library itself), so
  every run decodes the same files, without network.
- **Export** scenarios measure the export time, the frames per second and, per
  frame on the export thread, the decoding time (`decodeMs`) and the drawing +
  encoding time (`renderEncodeMs`); `slowFrames` lists the frames decoded in
  more than 100 ms, with their composition time, how long they waited for the
  native decoders (the rest is turning their frames into images) and the
  garbage collections of the export runtime meanwhile (count/time).
- **Composition preview** and **video player** scenarios measure, after a
  warm-up, the UI frame intervals, the frames missed by the display, the cost
  of a composition frame on the UI thread and the rate of the decoded frames.
- The **cadence** of the frames on screen: the intervals between two new
  frames of a clip (`itemFrameIntervalMs` in a preview,
  `decodedFrameIntervalMs` in a player) and `irregularFramesPct`, the share
  of them off by more than 3/4 of a display refresh from the duration of a
  frame (a frame shown a refresh early or late: judder). 30 fps on 60 Hz
  should show every frame for 33 ms; 24 fps on 60 Hz alternates 33 and 50 ms,
  which is not counted.
- To find what a preview misses frames on: `prepareMs`, the cost of turning
  the decoded frames into images on the UI thread (`renderMs` is the drawing
  that follows), `slowFrames`, the UI frames longer than 1.5 refresh periods
  with the composition time and the `prepareMs` of the frame before, and
  `itemGaps`, the intervals between two frames of a clip longer than two
  frames, with the clip and the composition time.
- The **sequence** scenarios play 8 clips one after another: only the clips
  around the current time have a decoder and textures, so their memory peak
  should stay close to that of a single clip, and the frames missed by the
  display show the cost of opening the next clip's decoder.
- The **color check** exports color bars (grays over the whole range, then
  mid saturated colors), decodes the exported video and reads a frame back:
  `maxError` is the largest change of a channel (0-255) over the encoding and
  the decoding, a few levels at most when the colors are kept.
- Each run records the memory of the process before and after it (iOS:
  physical footprint, Android: total PSS): it should stay stable over
  repeated runs.

Set a label (e.g. `pr63-iphone15`), a number of runs per scenario, run, then
**Share JSON** to keep the report. Measure in a Release build:

```bash
yarn ios --mode Release
yarn android --mode release
```
