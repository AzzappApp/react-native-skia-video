import React, { useState } from 'react';
import {
  Canvas,
  Circle,
  DisplacementMap,
  Image,
  Skia,
  Turbulence,
} from '@shopify/react-native-skia';
import { Button, View } from 'react-native';
import { useVideoPlayer } from '@azzapp/react-native-skia-video';
import { useDerivedValue } from 'react-native-reanimated';

const VideoPlayerExample = () => {
  const [uri, setUri] = useState<string | null>(
    'https://res.cloudinary.com/azzapp/video/upload/a0x4zbyyoyqrny9dlne4lt4z.mp4'
  );
  const width = 256;
  const height = 256;

  const { currentFrame, player } = useVideoPlayer({
    uri,
    isLooping: true,
    onReadyToPlay() {
      console.log('on ready to play');
    },
    onBufferingEnd() {
      console.log('on bufffering end');
    },
    onPlayingStatusChange(playing) {
      console.log('on playing status change', playing);
    },
    onComplete() {
      console.log('on complete');
    },
  });

  const videoImage = useDerivedValue(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return null;
    }
    return Skia.Image.MakeImageFromNativeBuffer(frame.buffer);
  });

  return (
    <View
      // eslint-disable-next-line react-native/no-inline-styles
      style={{ flex: 1, justifyContent: 'space-around', alignItems: 'center' }}
    >
      <Canvas style={{ width, height }}>
        <Image
          rect={{
            x: 0,
            y: 0,
            width: width,
            height: height,
          }}
          image={videoImage}
        >
          <DisplacementMap channelX="g" channelY="a" scale={20}>
            <Turbulence freqX={0.01} freqY={0.05} octaves={2} seed={2} />
          </DisplacementMap>
        </Image>
        <Circle c={{ x: width / 2, y: height / 2 }} r={50} color="#FF000055" />
      </Canvas>
      {/* <Button title="Load" onPress={pickImage} /> */}
      <Button title="Delete" onPress={() => setUri(null)} />
      <Button title="Seek" onPress={() => player?.seekTo(0)} />
      <Button title="Play" onPress={() => player?.play()} />
      <Button title="Pause" onPress={() => player?.pause()} />
    </View>
  );
};

export default VideoPlayerExample;
