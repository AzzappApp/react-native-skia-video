# React Native Skia Video

Video encoding/decoding support for [React Native Skia](https://github.com/Shopify/react-native-skia)

> ⚠️ This library is still a beta in a very unstable state

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

const MyVideoPlayer = ({ uri, width, height }) =>{

  const { currentFrame } = useVideoPlayer({ uri })

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
      <Image image={videoImage} width={width} height={height}  />
    </Canvas>
  );
}

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
import { exportVideoComposition } from '@azzapp/react-native-skia-video'

exportVideoComposition({
  videoComposition,
  drawFrame,
  outPath: '/path/to/output',
  bitRate: 3500000,
  frameRate: 60,
  width: 1920,
  height: 1080,
}).then(() => {
  console.log('Video exported successfully!')
})
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
