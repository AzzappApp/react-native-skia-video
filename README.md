# React Native Skia Video

Video encoding/decoding support for [React Native Skia](https://github.com/Shopify/react-native-skia)

## Installation

```sh
npm install @azzapp/react-native-skia-video
```

## Usage

## VideoPlayer

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
    return Skia.Image.MakeImageFromNativeBuffer(frame.buffer);
  });

  return (
    <Canvas style={{ width, height }}>
      <Image image={videoImage} width={width} height={height}  />
    </Canvas>
  );
}

```

## VideoComposition

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
  const image = Skia.Image.MakeImageFromNativeBuffer(frame.buffer);
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
      <Picture picture={currentFrame} />
    </Canvas>
  );
}
```

To export a composition, use the `exportVideoComposition` function:

```js
import { exportVideoComposition } from '@azzapp/react-native-skia-video'


exportVideoComposition(
  videoComposition,
  {
    outPath: '/path/to/output',
    bitRate: 3500000,
    frameRate: 60,
    width: 1920,
    height: 1080,
  },
  drawFrame
).then(() => {
  console.log('Video exported successfully!')
})
```

> Please note that the Video Composition system currently does not support sound.


## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
