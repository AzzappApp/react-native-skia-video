# React Native Skia Video

Video encoding/decoding support for [React Native Skia](https://github.com/Shopify/react-native-skia)

> 📖 **[Documentation](https://azzappapp.github.io/react-native-skia-video/)** — getting started, guides (video player, compositions, audio, exporting), full API reference and a [complete example app](https://azzappapp.github.io/react-native-skia-video/docs/example).

> ⚠️ This library is still a beta in a very unstable state

## This fork

This is [batical/react-native-skia-video](https://github.com/batical/react-native-skia-video), a fork of [AzzappApp/react-native-skia-video](https://github.com/AzzappApp/react-native-skia-video). It keeps the upstream API and package name, and adds the options, fixes and tests below.

### Installing the fork

`lib/` is committed, so the package installs straight from GitHub with no build step:

```json
"@azzapp/react-native-skia-video": "github:batical/react-native-skia-video"
```

### New options and APIs

| Option or API                                                | Where                        | Platforms                          | What it does                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lazyDecoders`                                               | `VideoComposition`           | iOS, Android                       | Opens each item's decoder shortly before the item (1.5 s in the preview, 0.5 s in the export) and closes it 0.5 s after, instead of keeping every decoder open for the whole composition. Meant for compositions that play their clips one after another. |
| `maxLongSide`                                                | video item                   | iOS, Android                       | Caps the longest side the frames are decoded at, keeping the aspect. `resolution` wins when both are set.                                                                                                                                                 |
| `textureMode: 'copy' \| 'direct'`                            | video item, `useVideoPlayer` | iOS; Android for composition items | `direct` hands Skia the decoder's own buffer, with no copy. `copy` is the default and behaves as before.                                                                                                                                                  |
| `drawVideoFrame(canvas, frame, dst, { paint, fit, output })` | new export                   | iOS, Android                       | Draws a frame's picture upright into `dst` (`fill`, `cover` or `contain`), taking the frame's `rotation` and `crop` into account. `makeVideoFrameImage` returns the image, the picture's rectangle and the rotation for custom drawing.                   |
| `codec: 'h264' \| 'hevc'`                                    | `exportVideoComposition`     | iOS, Android                       | Chooses the export codec, falling back to H.264 when the device cannot encode HEVC. `isEncodingSupported(codec)` answers on both platforms.                                                                                                               |
| `encoderMode: 'copy' \| 'direct'`                            | `exportVideoComposition`     | iOS                                | `direct` blits each frame straight into the encoder's pixel buffer.                                                                                                                                                                                       |
| `drawWhenPaused`                                             | `useVideoCompositionPlayer`  | iOS, Android                       | A paused player now redraws only when the time or the frames change. Set this to redraw at every vsync anyway.                                                                                                                                            |

### Behaviour changes to know about

- **Frames can come as decoded.** iOS frames, and Android frames in `direct` mode, carry the video's `rotation` and are not turned upright. Android `direct` frames are also the decoder's buffer, often larger than the picture (1920x1088 for 1080p H.264), and carry a `crop`. Android `copy` frames stay upright with no crop. `drawVideoFrame` handles every case.
- **The preview clears its canvas before `drawFrame`**, as the export always did. A `drawFrame` that leaves part of the canvas alone no longer shows older frames there.
- **The `frames` object only holds items that have a current frame.** With `lazyDecoders`, an item whose decoder closed is no longer in it. An item reached by a seek shows no frame until its decoder has opened; the export always waits for it.
- **iOS decodes and encodes in Rec.709**, so HDR (HLG, Dolby Vision) sources are tone-mapped to SDR instead of looking washed out.
- **iOS frame times follow the presentation timeline once.** Earlier they were mapped through the track's edits twice, which showed every frame one frame early. This has not yet been checked with a real iPhone slow-motion file.
- **Exports produce a whole number of frames**, `ceil(duration × frameRate)`, even when the duration is a float sum of clip lengths.
- **Android plays Dolby Vision clips (iPhone HDR) on devices without a Dolby Vision decoder**, by decoding their HEVC or AVC base layer.

### Fixes

**Android**

- A player disposed while it draws no longer crashes. This race between the JS and UI threads aborted the app with `JNI DETECTED ERROR: obj == null`.
- After a scrub, a seek no longer freezes on a frame from before it. MediaCodec callbacks from before the flush are now dropped.
- A composition player that is the app's first Skia content no longer crashes ("Skia context is not initialized").
- A preview item that cannot open now emits `error` instead of crashing, as a lazy one does.
- An export no longer hangs on an item that has no frame in its range.
- GL objects are released on their own context. GPU work is ordered across EGL contexts with fences, and the encoder waits for the GPU before reading a frame (Mali GPUs run contexts concurrently).
- `maxLongSide` is honoured, and only the latest frame of a seek batch is drawn.
- No segfault when the encoder name or codec is absent. Encoders are probed for the export codec, and `getDecodingCapabilitiesFor` inspects decoders.
- R8 keep rules are shipped for the classes native code reaches by name.

**iOS**

- A zero-copy pixel path for decoding and encoding (`textureMode` / `encoderMode: 'direct'`, copy by default), with a bounded frame lifetime.
- Seeks land on the exact frame, including onto a frame's exact time, into an item's last tenth of a second, and before the player is ready.
- An export at the file's frame rate no longer repeats or skips frames.
- No decoding work while paused, and GCD instead of a thread per decoder per vsync. The decoder's frame lists are locked.
- VideoToolbox is linked for the codec probe.

**Both platforms**

- An item whose decoder closed no longer leaves its frame in the `frames` object. After a seek back into the item, drawing that frame threw on Android (`Invalid textureInfo`) and showed a stale picture on iOS.
- The player survives a zero size and a textureless surface, and disposes its offscreen surface and re-keys it when the size changes.

### Measured on a Pixel 8a

Peak memory while playing, from the example's stress screen:

| Composition                              | Eager   | Lazy   | Lazy + `maxLongSide: 1280` |
| ---------------------------------------- | ------- | ------ | -------------------------- |
| Eight 1.5 s 4K clips                     | 1712 MB | 639 MB | 532 MB                     |
| Nine 2 s clips (1080p to 4K), crossfaded | 1386 MB | 735 MB | —                          |

Eight 4K decoders opened eagerly also exceed what the phone decodes in real time (up to 15 % of frames missing), while the lazy variants miss none.

### Tests

- **Jest**: the hooks' frame loop, the export loop, the public API, and `drawVideoFrame`.
- **C++**: the lazy decoder window (`test/native`).
- **Android**: JVM unit tests, plus instrumented tests that encode their own videos on the device. They cover 1080p, 4K, HEVC, 60 fps, rotated and unaligned sources, pixels and orientation, seeks, loops, scrubs, lazy and eager montages, `direct` frames, and exports through the encoder, read back frame by frame. Run them with `./gradlew :azzapp_react-native-skia-video:connectedDebugAndroidTest` from `example/android`.
- **iOS**: an XCTest suite for the decoders, the extractors (lazy included) and the encoder, on videos written in the test. It lives in `example/ios/ReactNativeSkiaVideoExampleTests`.
- **Stress**: the example app has a stress screen (`example/src/StressTest.tsx`). It plays, seeks, scrubs, loops, exports, mounts and unmounts every kind of composition in copy and direct modes, and measures frame pacing and memory over repeated cycles. Its media are written by `swift example/scripts/make-stress-media.swift <dir>`.

## Installation

```sh
npm install @azzapp/react-native-skia-video
```

## Usage

### VideoPlayer

The `useVideoPlayer` is a custom React hook used in the context of a video player component. This hook encapsulates the logic for playing, pausing, and controlling video playback. It returns a [Reanimated](https://docs.swmansion.com/react-native-reanimated/) shared value that holds the current frame of the playing video.

```js
import { Canvas, Image, Skia } from '@shopify/react-native-skia';
import { useVideoPlayer } from '@azzapp/react-native-skia-video';

const MyVideoPlayer = ({ uri, width, height }) => {
  const { currentFrame } = useVideoPlayer({ uri });

  const videoImage = useDerivedValue(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return null;
    }
    return Skia.Image.MakeImageFromNativeTextureUnstable(
      frame.texture,
      frame.width,
      frame.height
    );
  });

  return (
    <Canvas style={{ width, height }}>
      <Image image={videoImage} width={width} height={height} />
    </Canvas>
  );
};
```

### VideoComposition

This library offers a mechanism for previewing and exporting videos created by compositing frames from other videos, utilizing the React Native Skia imperative API.

To preview a composition, use the `useVideoCompositionPlayer` hook:

```js
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useVideoCompositionPlayer } from '@azzapp/react-native-skia-video'

const videoComposition = {
  duration: 10,
  items: [{
    id: 'video1',
    path: '/local/path/to/video.mp4',
    compositionStartTime: 0,
    startTime: 0,
    duration: 5
  }, {
    id: 'video2',
    path: '/local/path/to/video2.mp4',
    compositionStartTime: 5,
    startTime: 5,
    duration: 5
  }]
}

const drawFrame: FrameDrawer = ({
  videoComposition,
  canvas,
  currentTime,
  frames,
  height,
  width,
}) => {
  'worklet';
  const frame = frames[currentTime < 5 ? 'video1' : 'video2'];
  const image = Skia.Image.MakeImageFromNativeTextureUnstable(
    frame.texture,
    width,
    height,
  );
  const paint = Skia.Paint();
  canvas.drawImage(image, 0, 0, paint)
}


const MyVideoCompositionPlayer = ({ width, height }) =>{
  const { currentFrame } = useVideoCompositionPlayer({
    composition: videoComposition,
    autoPlay: true,
    drawFrame,
    width,
    height,
  });

  return (
    <Canvas style={{ width, height }}>
      <Image image={currentFrame} x={0} y={0} width={width} height={height} />
    </Canvas>
  );
}
```

To export a composition, use the `exportVideoComposition` function:

```js
import { exportVideoComposition } from '@azzapp/react-native-skia-video';

exportVideoComposition({
  videoComposition,
  drawFrame,
  outPath: '/path/to/output',
  bitRate: 3500000,
  frameRate: 60,
  width: 1920,
  height: 1080,
}).then(() => {
  console.log('Video exported successfully!');
});
```

#### Audio

Video items are silent by default. To play the audio track of a video item
(both during playback and export), set its `audio` option:

```js
const videoComposition = {
  duration: 10,
  items: [
    {
      id: 'video1',
      path: 'path/to/video.mp4',
      compositionStartTime: 0,
      startTime: 0,
      duration: 10,
      // plays the audio track of video.mp4, in sync with its frames
      audio: { volume: 0.8 }, // or simply `audio: true`
    },
    // additional audio (music, voice over...) can be added with an audio
    // item; the source can be an audio file or the audio track of any
    // video file
    {
      id: 'music',
      kind: 'audio',
      path: 'path/to/music.mp3',
      compositionStartTime: 0,
      startTime: 12,
      duration: 10,
      volume: 0.3,
    },
  ],
};
```

Audio items never appear in the `frames` map passed to `drawFrame`.
Overlapping audio is mixed together. During playback the audio is played in
sync with the composition; during export it is encoded (AAC) into the output
file. The exported audio can be configured through the `audioBitRate`
(default 128kbps), `audioSampleRate` (default 44100Hz) and
`audioChannelCount` (default 2) export options.

### Video Capabilities (Android only)

On android you might needs to check the video capabilities of your device before exporting a video. This library provides 2 android specific functions for this purpose :

#### getDecodingCapabilitiesFor(mimetype: string)

This function will returns the decoding capabilities of this device for the given mime type (most of the time you should check `video/avc`).

#### getValidEncoderConfigurations(width: number, height: number, frameRate: number, bitRate: number)

This function will returns a list of valid configuration in regards of your device encoding capabilities with the corresponding encoder.
If the provided parameters are not supported the returned configurations will be overridden with valid parameters (by decreasing, resolution, framerate or bitrate) while keeping the same aspect ratio.

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
