import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AppState,
  Button,
  PixelRatio,
  Platform,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  Canvas,
  Circle,
  FontStyle,
  Image as ImageSkia,
  PaintStyle,
  Skia,
  StrokeCap,
  type SkCanvas,
  type SkFont,
  type SkImage,
  type SkRuntimeEffect,
  type SkSurface,
} from 'react-native-skia';
import { importDevice } from 'react-native-webgpu';
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
  type VideoFrame,
} from '@azzapp/react-native-skia-video';
import {
  generateClip,
  getClip,
  getClipPath,
  isClipReady,
} from './benchmark/clips';

/**
 * Tries to reproduce, on iOS, the loss of React Native Skia's GPU device when
 * the app goes to the background while GPU work is being submitted.
 *
 * iOS refuses GPU work submitted by an app in the background, including work
 * still queued when the app gets there. With React Native Skia 3.7 (Dawn
 * 157), a refused Metal command buffer loses the device, and nothing renders
 * again until the app is restarted. React Native Skia 3.6 (Dawn 154) only
 * lost the refused frame.
 *
 * The screen renders, at every frame, a costly background (a Skia shader, or
 * a WebGPU pass on Skia's device) with a clock over it, into an offscreen
 * surface from a frame callback, or through a composition player of this
 * library. A loss shows at once: the clock stops, the banner (a React Native
 * view, which keeps working) turns red, and a new canvas stays empty.
 */

/**
 * An animated rainbow, with a grain computed by a loop whose length sets the
 * GPU load: the loop is the cost, the gradient is what shows.
 */
const SKSL = `
uniform float2 size;
uniform float time;
uniform float iterations;

half4 main(float2 position) {
  float2 uv = position / size;
  float2 q = uv;
  float grain = 0;
  for (int i = 0; i < 512; i++) {
    if (float(i) >= iterations) {
      break;
    }
    q = fract(q * 1.7 + float2(sin(time + float(i) * 0.1),
                               cos(time * 0.7 + float(i) * 0.13)) * 0.1);
    grain += q.x;
  }
  float3 color = 0.5 + 0.5 * cos(6.2831 * (uv.x * 0.6 + uv.y * 0.4 + time * 0.15)
                                 + float3(0, 2, 4));
  return half4(half3(color * (0.8 + 0.2 * fract(grain))), 1);
}
`;

/** The same, drawn by WebGPU. */
const WGSL = `
struct Params { time: f32, iterations: f32, size: f32, unused: f32 };
@group(0) @binding(0) var<uniform> params: Params;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[i], 0.0, 1.0);
}

@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / params.size;
  var q = uv;
  var grain = 0.0;
  for (var i = 0; i < 512; i++) {
    if (f32(i) >= params.iterations) {
      break;
    }
    let k = f32(i);
    q = fract(q * 1.7 + vec2f(sin(params.time + k * 0.1),
                              cos(params.time * 0.7 + k * 0.13)) * 0.1);
    grain += q.x;
  }
  let color = 0.5 + 0.5 * cos(6.2831 * (uv.x * 0.6 + uv.y * 0.4 + params.time * 0.15)
                              + vec3f(0.0, 2.0, 4.0));
  return vec4f(color * (0.8 + 0.2 * fract(grain)), 1.0);
}
`;

// WebGPU usage flags, as numbers: a worklet cannot capture the module's.
const TEXTURE_BINDING = 4;
const RENDER_ATTACHMENT = 16;
const COPY_DST = 8;
const UNIFORM = 64;

const FONT_FAMILY = Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif';

type WebGpuState = {
  size: number;
  texture: GPUTexture;
  view: GPUTextureView;
  image: SkImage;
  pipeline: GPURenderPipeline;
  uniforms: GPUBuffer;
  group: GPUBindGroup;
};

/** What a runtime keeps from one frame to the next (Skia objects are per runtime). */
type RuntimeCache = {
  backgroundGpuLossEffect?: SkRuntimeEffect | null;
  backgroundGpuLossFont?: SkFont | null;
  backgroundGpuLossFontSize?: number;
  backgroundGpuLossWebGpu?: WebGpuState | null;
  backgroundGpuLossWebGpuFailed?: boolean;
};

const runtimeCache = () => {
  'worklet';
  return globalThis as RuntimeCache;
};

const getEffect = () => {
  'worklet';
  const cache = runtimeCache();
  if (cache.backgroundGpuLossEffect === undefined) {
    cache.backgroundGpuLossEffect = Skia.RuntimeEffect.Make(SKSL);
  }
  return cache.backgroundGpuLossEffect;
};

const getFont = (size: number) => {
  'worklet';
  const cache = runtimeCache();
  if (cache.backgroundGpuLossFontSize !== size) {
    const typeface = Skia.FontMgr.System().matchFamilyStyle(
      FONT_FAMILY,
      FontStyle.Bold
    );
    cache.backgroundGpuLossFont = Skia.Font(typeface, size);
    cache.backgroundGpuLossFontSize = size;
  }
  return cache.backgroundGpuLossFont ?? null;
};

const getWebGpuState = (device: GPUDevice, size: number) => {
  'worklet';
  const cache = runtimeCache();
  const known = cache.backgroundGpuLossWebGpu;
  if (known != null && known.size === size) {
    return known;
  }
  if (known != null) {
    // The image first: a texture is not destroyed under a living image.
    known.image.dispose();
    known.texture.destroy();
    known.uniforms.destroy();
  }
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const texture = device.createTexture({
    size: [size, size],
    format: 'rgba8unorm',
    usage: RENDER_ATTACHMENT | TEXTURE_BINDING,
  });
  const uniforms = device.createBuffer({
    size: 16,
    usage: UNIFORM | COPY_DST,
  });
  const state: WebGpuState = {
    size,
    texture,
    view: texture.createView(),
    image: Skia.Image.MakeImageFromGPUTexture(texture),
    pipeline,
    uniforms,
    group: device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    }),
  };
  cache.backgroundGpuLossWebGpu = state;
  return state;
};

/**
 * Paints the costly background with a WebGPU pass, submitted right away, and
 * draws its texture with Skia. False if WebGPU failed: an exception thrown
 * from a frame callback would abort the app.
 */
const drawWebGpuBackground = (
  canvas: SkCanvas,
  device: GPUDevice,
  width: number,
  height: number,
  time: number,
  iterations: number
) => {
  'worklet';
  const cache = runtimeCache();
  if (cache.backgroundGpuLossWebGpuFailed) {
    return false;
  }
  try {
    const size = Math.round(Math.max(width, height));
    const state = getWebGpuState(device, size);
    device.queue.writeBuffer(
      state.uniforms,
      0,
      new Float32Array([time, iterations, size, 0])
    );
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: state.view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 1],
        },
      ],
    });
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.group);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const paint = Skia.Paint();
    canvas.drawImageRect(
      state.image,
      { x: 0, y: 0, width: size, height: size },
      { x: 0, y: 0, width, height },
      paint
    );
    paint.dispose();
    return true;
  } catch (error) {
    cache.backgroundGpuLossWebGpuFailed = true;
    console.warn(`WebGPU background unavailable: ${String(error)}`);
    return false;
  }
};

const drawSkiaBackground = (
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

/** A clock over the background: its hand turns once every 2 s. */
const drawClock = (
  canvas: SkCanvas,
  width: number,
  height: number,
  time: number,
  frame: number
) => {
  'worklet';
  const cx = width / 2;
  const cy = height * 0.42;
  const radius = Math.min(width, height) * 0.3;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('rgba(0, 0, 0, 0.6)'));
  canvas.drawCircle(cx, cy, radius, paint);
  paint.setColor(Skia.Color('white'));
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeWidth(radius * 0.06);
  canvas.drawCircle(cx, cy, radius, paint);
  const angle = time * Math.PI;
  canvas.drawLine(
    cx,
    cy,
    cx + Math.sin(angle) * radius * 0.85,
    cy - Math.cos(angle) * radius * 0.85,
    paint
  );

  const font = getFont(Math.round(width * 0.09));
  if (font != null) {
    const label = `${time.toFixed(2)} s   #${frame}`;
    const textWidth = font.measureText(label).width;
    const top = height * 0.8;
    const fontSize = font.getSize();
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(Skia.Color('rgba(0, 0, 0, 0.6)'));
    canvas.drawRRect(
      Skia.RRectXY(
        {
          x: cx - textWidth / 2 - fontSize * 0.4,
          y: top - fontSize * 1.05,
          width: textWidth + fontSize * 0.8,
          height: fontSize * 1.4,
        },
        fontSize * 0.3,
        fontSize * 0.3
      ),
      paint
    );
    paint.setColor(Skia.Color('white'));
    canvas.drawText(label, cx - textWidth / 2, top, paint, font);
  }
  paint.dispose();
};

type DrawOptions = {
  iterations: number;
  /** Skia's device, imported by WebGPU: the background is then a WebGPU pass. */
  device: GPUDevice | null;
};

/** Draws `frame` over the whole canvas, cropped to fill it. */
const drawVideoFrame = (
  canvas: SkCanvas,
  frame: VideoFrame,
  width: number,
  height: number
) => {
  'worklet';
  const aspectRatio = width / height;
  const source =
    frame.width / frame.height > aspectRatio
      ? {
          x: (frame.width - frame.height * aspectRatio) / 2,
          y: 0,
          width: frame.height * aspectRatio,
          height: frame.height,
        }
      : {
          x: 0,
          y: (frame.height - frame.width / aspectRatio) / 2,
          width: frame.width,
          height: frame.width / aspectRatio,
        };
  const paint = Skia.Paint();
  canvas.drawImageRect(
    frame.image,
    source,
    { x: 0, y: 0, width, height },
    paint
  );
  paint.dispose();
};

const drawScene = (
  canvas: SkCanvas,
  width: number,
  height: number,
  time: number,
  frame: number,
  options: DrawOptions,
  video?: VideoFrame
) => {
  'worklet';
  const drawn =
    options.device != null &&
    drawWebGpuBackground(
      canvas,
      options.device,
      width,
      height,
      time,
      options.iterations
    );
  if (!drawn) {
    drawSkiaBackground(canvas, width, height, time, options.iterations);
  }
  if (video != null) {
    drawVideoFrame(canvas, video, width, height);
  }
  drawClock(canvas, width, height, time, frame);
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

/**
 * Skia.gpu, read twice a second (a fresh object at each read: it tells the
 * loss as soon as it happens), and how long the JS thread has been running.
 */
const useGpuStatus = () => {
  const [state, setState] = useState(() => ({
    gpu: Skia.gpu,
    since: Date.now(),
    now: Date.now(),
  }));
  useEffect(() => {
    const interval = setInterval(() => {
      setState((previous) => ({
        ...previous,
        gpu: Skia.gpu,
        now: Date.now(),
      }));
    }, 500);
    return () => clearInterval(interval);
  }, []);
  return {
    gpu: state.gpu,
    jsSeconds: Math.floor((state.now - state.since) / 1000),
  };
};

type LoopProps = {
  /** The side of the rendered square, in points. */
  size: number;
  options: SharedValue<DrawOptions>;
  /** Not rendering: stopped, or the workaround while the app is not active. */
  paused: boolean;
};

/**
 * React Native Skia only: a frame callback draws into an offscreen surface and
 * flushes it, and a canvas shows the surface's image.
 */
const OffscreenLoop = ({ size, options, paused }: LoopProps) => {
  const pixelRatio = PixelRatio.get();
  const surface = useSharedValue<SkSurface | null>(null);
  const canvas = useSharedValue<SkCanvas | null>(null);
  const image = useSharedValue<SkImage | null>(null);
  const frame = useSharedValue(0);

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
      frame.value += 1;
      drawScene(
        targetCanvas,
        target.width(),
        target.height(),
        frameInfo.timeSinceFirstFrame / 1000,
        frame.value,
        options.value
      );
      target.flush();
      if (image.value == null) {
        image.value = target.asImage();
      } else {
        // Same image, new content: the canvas must be told to draw it again.
        image.modify(undefined, true);
      }
    },
    [canvas, frame, image, options, pixelRatio, size, surface]
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

const VIDEO_ID = 'video';

type PlayerLoopProps = LoopProps & {
  /** A video item (the benchmark's test clip), decoded and drawn. */
  videoPath: string | null;
  /** An audio item (a generated tone): the player's clock is then the audio's. */
  audioPath: string | null;
};

/**
 * The same drawing through a composition player of this library, which draws
 * into its own offscreen surface at every frame. Without items the player is
 * only a clock; a video item adds decoders and the conversion of their frames
 * on Skia's device, an audio item an AVPlayer.
 */
const PlayerLoop = ({
  size,
  options,
  paused,
  videoPath,
  audioPath,
}: PlayerLoopProps) => {
  const composition = useMemo<VideoComposition>(() => {
    const duration = videoPath != null ? getClip('1080p30').duration : 60;
    const items: VideoComposition['items'] = [];
    if (videoPath != null) {
      items.push({
        id: VIDEO_ID,
        path: videoPath,
        compositionStartTime: 0,
        startTime: 0,
        duration,
      });
    }
    if (audioPath != null) {
      items.push({
        id: 'audio',
        kind: 'audio',
        path: audioPath,
        compositionStartTime: 0,
        startTime: 0,
        duration,
        volume: 0.5,
      });
    }
    return { duration, items };
  }, [audioPath, videoPath]);

  const frame = useSharedValue(0);
  const drawFrame = useCallback<FrameDrawer>(
    ({ canvas, width, height, currentTime, frames }) => {
      'worklet';
      frame.value += 1;
      drawScene(
        canvas,
        width,
        height,
        currentTime,
        frame.value,
        options.value,
        frames[VIDEO_ID]
      );
    },
    [frame, options]
  );
  // A paused player still draws at every frame: stopping the GPU work means
  // releasing the player.
  const { currentFrame } = useVideoCompositionPlayer({
    composition: paused ? null : composition,
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

const TONE_SECONDS = 12;
const TONE_RATE = 22050;

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const toBase64 = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += BASE64[a >> 2]!;
    out += BASE64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? BASE64[c & 63]! : '=';
  }
  return out;
};

/**
 * A 12 s mono WAV, written once: a soft low tone with a tick every second, so
 * that the audio is heard going on while the image is frozen.
 */
const writeTestTone = async () => {
  const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/rnskv-background-gpu-loss-tone.wav`;
  if (await ReactNativeBlobUtil.fs.exists(path)) {
    return path;
  }
  const samples = TONE_SECONDS * TONE_RATE;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TONE_RATE, true);
  view.setUint32(28, TONE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / TONE_RATE;
    const sinceTick = t % 1;
    const tick =
      sinceTick < 0.05
        ? Math.sin(2 * Math.PI * 880 * t) * (1 - sinceTick / 0.05)
        : 0;
    const value = 0.15 * Math.sin(2 * Math.PI * 220 * t) + 0.35 * tick;
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  await ReactNativeBlobUtil.fs.writeFile(path, toBase64(bytes), 'base64');
  return path;
};

const CIRCLE_COLORS = ['#e63946', '#2a9d8f', '#457b9d'];

const formatTime = (at: number) => new Date(at).toISOString().slice(11, 23);

const Row = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    {children}
  </View>
);

const BackgroundGpuLossExample = () => {
  const { width: windowWidth } = useWindowDimensions();
  const size = windowWidth - 40;
  const [running, setRunning] = useState(false);
  const [throughPlayer, setThroughPlayer] = useState(false);
  const [withWebGpu, setWithWebGpu] = useState(false);
  const [workaround, setWorkaround] = useState(false);
  const [iterations, setIterations] = useState(128);
  const [canvasMount, setCanvasMount] = useState(() => Date.now());
  const [withVideo, setWithVideo] = useState(false);
  const [withAudio, setWithAudio] = useState(false);
  // The test clip of the benchmark, generated on the device (no network):
  // its path once it exists, the progress while it is generated.
  const [clipPath, setClipPath] = useState<string | null>(null);
  const [clipProgress, setClipProgress] = useState<number | null>(null);
  const [tonePath, setTonePath] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    const clip = getClip('1080p30');
    isClipReady(clip).then(
      (ready) => {
        if (ready) {
          setClipPath(getClipPath(clip));
        }
      },
      () => {}
    );
  }, []);

  const generateTestClip = () => {
    const clip = getClip('1080p30');
    setClipProgress(0);
    setMediaError(null);
    generateClip(clip, new AbortController().signal, setClipProgress).then(
      () => {
        setClipProgress(null);
        setClipPath(getClipPath(clip));
      },
      (error) => {
        setClipProgress(null);
        setMediaError(String(error?.message ?? error));
      }
    );
  };

  const toggleAudio = (enabled: boolean) => {
    setWithAudio(enabled);
    if (enabled && tonePath == null) {
      writeTestTone().then(setTonePath, (error) =>
        setMediaError(String(error?.message ?? error))
      );
    }
  };

  // Skia's own device, seen by WebGPU: one queue for both.
  const device = useMemo(() => {
    try {
      return importDevice(Skia.getNativeDevice());
    } catch {
      return null;
    }
  }, []);
  const options = useSharedValue<DrawOptions>({ iterations, device: null });
  useEffect(() => {
    options.value = { iterations, device: withWebGpu ? device : null };
  }, [device, iterations, options, withWebGpu]);

  const log = useAppStateLog();
  const active = log[log.length - 1]?.state === 'active';
  const paused = !running || (workaround && !active);
  const { gpu, jsSeconds } = useGpuStatus();

  const text = { color: 'black' };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View
        style={{
          padding: 12,
          borderRadius: 10,
          backgroundColor: gpu.isAvailable ? '#2a9d8f' : '#e63946',
        }}
      >
        <Text style={{ color: 'white', fontSize: 22, fontWeight: 'bold' }}>
          {gpu.isAvailable ? 'GPU OK' : 'GPU DEVICE LOST'}
        </Text>
        {gpu.error != null && (
          <Text style={{ color: 'white', marginTop: 4 }} selectable>
            {gpu.error}
          </Text>
        )}
        <Text style={{ color: 'white', marginTop: 4 }}>
          JS alive for {jsSeconds} s — app state: {log[log.length - 1]?.state}
        </Text>
      </View>

      <Text style={text}>
        Start, go to the home screen (swipe up) for a few seconds and come back;
        try the side (lock) button too. A loss: the clock below stops, the
        banner turns red, and a new canvas stays empty. Use a Release build.
      </Text>

      {throughPlayer ? (
        <PlayerLoop
          size={size}
          options={options}
          paused={paused}
          videoPath={withVideo ? clipPath : null}
          audioPath={withAudio ? tonePath : null}
        />
      ) : (
        <OffscreenLoop size={size} options={options} paused={paused} />
      )}

      <Button
        title={running ? 'Stop' : 'Start'}
        onPress={() => setRunning(!running)}
      />

      <Row>
        <Switch value={withWebGpu} onValueChange={setWithWebGpu} />
        <Text style={[text, { flex: 1 }]}>
          Background drawn by a WebGPU pass on Skia&apos;s device
          {device == null ? ' (unavailable)' : ''}
        </Text>
      </Row>
      <Row>
        <Switch value={throughPlayer} onValueChange={setThroughPlayer} />
        <Text style={[text, { flex: 1 }]}>
          Through a composition player of this library
        </Text>
      </Row>
      {throughPlayer && (
        <View style={{ gap: 10, paddingLeft: 20 }}>
          <Row>
            <Switch
              value={withVideo && clipPath != null}
              disabled={clipPath == null}
              onValueChange={setWithVideo}
            />
            <Text style={[text, { flex: 1 }]}>
              Video item (the benchmark&apos;s 1080p30 test clip)
            </Text>
          </Row>
          {clipPath == null &&
            (clipProgress == null ? (
              <Button
                title="Generate the test clip (once)"
                onPress={generateTestClip}
              />
            ) : (
              <Text style={text}>
                Generating the test clip… {Math.round(clipProgress * 100)}%
              </Text>
            ))}
          <Row>
            <Switch value={withAudio} onValueChange={toggleAudio} />
            <Text style={[text, { flex: 1 }]}>
              Audio item (a generated tone, ticking every second)
            </Text>
          </Row>
          {mediaError != null && <Text style={text}>{mediaError}</Text>}
        </View>
      )}
      <Row>
        <Switch value={workaround} onValueChange={setWorkaround} />
        <Text style={[text, { flex: 1 }]}>
          Workaround: stop rendering as soon as the app is not active
        </Text>
      </Row>
      <View style={{ gap: 4 }}>
        <Text style={text}>GPU load (shader iterations): {iterations}</Text>
        <Slider
          minimumValue={16}
          maximumValue={512}
          step={16}
          value={iterations}
          onSlidingComplete={setIterations}
          maximumTrackTintColor={'#CCC'}
          minimumTrackTintColor={'#F00'}
        />
      </View>

      <Row>
        {/* Remounted at every tap: a canvas mounted after a loss stays empty. */}
        <Canvas key={canvasMount} style={{ width: 72, height: 72 }}>
          <Circle
            cx={36}
            cy={36}
            r={32}
            color={CIRCLE_COLORS[canvasMount % CIRCLE_COLORS.length]}
          />
        </Canvas>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={text}>
            A canvas mounted at {formatTime(canvasMount)}: a colored disc,
            unless the device is lost.
          </Text>
          <Button
            title="Mount a new canvas"
            onPress={() => setCanvasMount(Date.now())}
          />
        </View>
      </Row>

      <View style={{ gap: 2 }}>
        <Text style={text}>App state, as JS receives it:</Text>
        {log.map((event, index) => (
          <Text key={`${event.at}-${index}`} style={text}>
            {formatTime(event.at)} {event.state}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
};

export default BackgroundGpuLossExample;
