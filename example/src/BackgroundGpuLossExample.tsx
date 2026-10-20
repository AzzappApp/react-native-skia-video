import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Button,
  PixelRatio,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  Canvas,
  Circle,
  Image as ImageSkia,
  Skia,
  type SkCanvas,
  type SkImage,
  type SkRuntimeEffect,
  type SkSurface,
} from 'react-native-skia';
import {
  runOnUI,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from 'react-native-reanimated';
import {
  useVideoCompositionPlayer,
  type FrameDrawer,
  type VideoComposition,
} from '@azzapp/react-native-skia-video';

/**
 * Reproduces, on iOS, the loss of React Native Skia's GPU device when the app
 * goes to the background while GPU work is being submitted.
 *
 * iOS refuses GPU work submitted by an app in the background, including work
 * still queued when the app gets there. With React Native Skia 3.7 (Dawn
 * 157), a refused Metal command buffer loses the device, and nothing renders
 * again until the app is restarted: the image freezes, the other canvases stop
 * updating and `Skia.gpu.isAvailable` turns false. React Native Skia 3.6
 * (Dawn 154) only lost the refused frame.
 *
 * The screen renders a costly shader at every frame, either into an offscreen
 * surface from a frame callback (React Native Skia only) or through a
 * composition player of this library (same pattern, inside the library).
 */

const SKSL = `
uniform float2 size;
uniform float time;
uniform float iterations;

half4 main(float2 position) {
  float2 q = position / size;
  float3 color = float3(0);
  for (int i = 0; i < 512; i++) {
    if (float(i) >= iterations) {
      break;
    }
    q = fract(q * 1.7 + float2(sin(time + float(i) * 0.1),
                               cos(time * 0.7 + float(i) * 0.13)) * 0.1);
    color += 0.5 + 0.5 * cos(6.2831 * (q.x + q.y) + float3(0, 2, 4));
  }
  return half4(half3(color / max(iterations, 1.0)), 1);
}
`;

const getEffect = (): SkRuntimeEffect | null => {
  'worklet';
  const runtime = globalThis as {
    backgroundGpuLossEffect?: SkRuntimeEffect | null;
  };
  if (runtime.backgroundGpuLossEffect === undefined) {
    runtime.backgroundGpuLossEffect = Skia.RuntimeEffect.Make(SKSL);
  }
  return runtime.backgroundGpuLossEffect;
};

/**
 * A full-frame shader whose cost grows with `iterations`: it keeps the GPU
 * busy, so that work is still queued when the app leaves the foreground.
 */
const drawLoad = (
  canvas: SkCanvas,
  width: number,
  height: number,
  time: number,
  iterations: number
) => {
  'worklet';
  const effect = getEffect();
  if (effect == null) {
    return;
  }
  const shader = effect.makeShader([width, height, time, iterations]);
  const paint = Skia.Paint();
  paint.setShader(shader);
  canvas.drawRect({ x: 0, y: 0, width, height }, paint);
  paint.dispose();
  shader.dispose();
};

type AppStateEvent = { at: number; state: string };

/** The app state transitions, as the JS thread receives them. */
const useAppStateLog = () => {
  const [log, setLog] = useState<AppStateEvent[]>(() => [
    { at: Date.now(), state: AppState.currentState ?? 'unknown' },
  ]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setLog((previous) => [...previous.slice(-7), { at: Date.now(), state }]);
    });
    return () => subscription.remove();
  }, []);
  return log;
};

type LoopProps = {
  /** The side of the rendered square, in points. */
  size: number;
  iterations: SharedValue<number>;
  /**
   * Stops rendering as soon as the app leaves the `active` state (the
   * app-side workaround), instead of rendering until iOS stops the frames.
   */
  paused: boolean;
};

/**
 * React Native Skia only: a frame callback draws into an offscreen surface and
 * flushes it, and a canvas shows the surface's image.
 */
const OffscreenLoop = ({ size, iterations, paused }: LoopProps) => {
  const pixelRatio = PixelRatio.get();
  const surface = useSharedValue<SkSurface | null>(null);
  const canvas = useSharedValue<SkCanvas | null>(null);
  const image = useSharedValue<SkImage | null>(null);

  const draw = useCallback(
    (frameInfo: FrameInfo) => {
      'worklet';
      if (surface.value == null) {
        const side = Math.round(size * pixelRatio);
        surface.value = Skia.Surface.MakeOffscreen(side, side);
        canvas.value = surface.value?.getCanvas() ?? null;
      }
      const target = surface.value;
      const targetCanvas = canvas.value;
      if (target == null || targetCanvas == null) {
        return;
      }
      drawLoad(
        targetCanvas,
        target.width(),
        target.height(),
        frameInfo.timeSinceFirstFrame / 1000,
        iterations.value
      );
      target.flush();
      if (image.value == null) {
        image.value = target.asImage();
      } else {
        // Same image, new content: the canvas must be told to draw it again.
        image.modify(undefined, true);
      }
    },
    [canvas, image, iterations, pixelRatio, size, surface]
  );
  const frameCallback = useFrameCallback(draw, false);

  useEffect(() => {
    frameCallback.setActive(!paused);
  }, [frameCallback, paused]);

  useEffect(
    () => () => {
      runOnUI(() => {
        'worklet';
        image.value?.dispose();
        image.value = null;
        canvas.value = null;
        surface.value?.dispose();
        surface.value = null;
      })();
    },
    [canvas, image, surface]
  );

  return (
    <Canvas style={{ width: size, height: size }}>
      <ImageSkia image={image} x={0} y={0} width={size} height={size} />
    </Canvas>
  );
};

/** A composition without items: the player is only a clock here. */
const COMPOSITION: VideoComposition = { duration: 60, items: [] };

/**
 * The same drawing through a composition player of this library, which draws
 * into its own offscreen surface at every frame.
 */
const PlayerLoop = ({ size, iterations, paused }: LoopProps) => {
  const drawFrame = useCallback<FrameDrawer>(
    ({ canvas, width, height, currentTime }) => {
      'worklet';
      drawLoad(canvas, width, height, currentTime, iterations.value);
    },
    [iterations]
  );
  // A paused player still draws at every frame: stopping the GPU work means
  // releasing the player.
  const { currentFrame } = useVideoCompositionPlayer({
    composition: paused ? null : COMPOSITION,
    drawFrame,
    width: size,
    height: size,
    autoPlay: true,
    isLooping: true,
  });

  return (
    <Canvas style={{ width: size, height: size }}>
      <ImageSkia image={currentFrame} x={0} y={0} width={size} height={size} />
    </Canvas>
  );
};

const CIRCLE_COLORS = ['#e63946', '#2a9d8f', '#457b9d'];

const BackgroundGpuLossExample = () => {
  const { width: windowWidth } = useWindowDimensions();
  const size = windowWidth - 40;
  const [running, setRunning] = useState(false);
  const [throughPlayer, setThroughPlayer] = useState(false);
  const [workaround, setWorkaround] = useState(false);
  const [iterationCount, setIterationCount] = useState(128);
  const iterations = useSharedValue(iterationCount);
  useEffect(() => {
    iterations.value = iterationCount;
  }, [iterationCount, iterations]);
  const [taps, setTaps] = useState(0);
  const [, setRefreshes] = useState(0);

  const log = useAppStateLog();
  const active = log[log.length - 1]?.state === 'active';
  const paused = !running || (workaround && !active);
  // A fresh object at each read: it tells the loss as soon as it happens.
  const gpu = Skia.gpu;

  const Loop = throughPlayer ? PlayerLoop : OffscreenLoop;
  const textStyle = { color: 'black' };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={textStyle}>
        1. Start. 2. Go to the home screen (swipe up) for a few seconds, then
        come back. 3. Also try the side (lock) button. After a loss, the image
        is frozen, the circle no longer changes and Skia.gpu.isAvailable is
        false until the app is restarted. Measure in a Release build.
      </Text>
      <Loop size={size} iterations={iterations} paused={paused} />
      <Button
        title={running ? 'Stop' : 'Start'}
        onPress={() => setRunning(!running)}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Switch value={throughPlayer} onValueChange={setThroughPlayer} />
        <Text style={textStyle}>
          Through a composition player of this library
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Switch value={workaround} onValueChange={setWorkaround} />
        <Text style={[textStyle, { flex: 1 }]}>
          Workaround: stop rendering as soon as the app is not active
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={textStyle}>
          Shader iterations (GPU load): {iterationCount}
        </Text>
        <Slider
          minimumValue={16}
          maximumValue={512}
          step={16}
          value={iterationCount}
          onSlidingComplete={setIterationCount}
          maximumTrackTintColor={'#CCC'}
          minimumTrackTintColor={'#F00'}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {/* Remounted at every tap: a canvas mounted after a loss stays empty. */}
        <Canvas key={taps} style={{ width: 64, height: 64 }}>
          <Circle
            cx={32}
            cy={32}
            r={28}
            color={CIRCLE_COLORS[taps % CIRCLE_COLORS.length]}
          />
        </Canvas>
        <Button title="New canvas" onPress={() => setTaps(taps + 1)} />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={textStyle}>
          Skia.gpu.isAvailable: {String(gpu.isAvailable)}
        </Text>
        {gpu.error != null && <Text style={textStyle}>{gpu.error}</Text>}
        <Button
          title="Read Skia.gpu again"
          onPress={() => setRefreshes((count) => count + 1)}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={textStyle}>App state (as received by JS):</Text>
        {log.map((event, index) => (
          <Text key={`${event.at}-${index}`} style={textStyle}>
            {new Date(event.at).toISOString().slice(11, 23)} {event.state}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
};

export default BackgroundGpuLossExample;
