import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  drawVideoFrame,
  exportVideoComposition,
  getValidEncoderConfigurations,
  useVideoCompositionPlayer,
  type FrameDrawer,
  type VideoComposition,
  type VideoCompositionItem,
} from '@azzapp/react-native-skia-video';
import { Canvas, Image as SkiaImage, Skia } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * Plays every kind of composition the library has to handle, with the media
 * written by scripts/make-stress-media.swift into STRESS_DIR:
 * play, seek, scrub, loop and export, eager and lazy. Each result is shown and
 * logged as `STRESS|<composition>|<step>|PASS or FAIL|<detail>`, so a run
 * started from the command line can be read back from the device log.
 */

// Android: the app's external files, which adb can write to in a release
// build. iOS: Documents, in the simulator's app container.
export const STRESS_DIR = `${
  Platform.OS === 'android'
    ? ReactNativeBlobUtil.fs.dirs.MovieDir
    : ReactNativeBlobUtil.fs.dirs.DocumentDir
}/stress-media`;

// Items whose id ends with this have no frame to show (a start past the
// file's end): the checks leave them out.
const NO_FRAMES = '~noframes';

type Media = {
  file: string;
  duration: number;
};

const MEDIA: Media[] = [
  { file: 'h264-1080p30-audio.mp4', duration: 8 },
  { file: 'h264-4k30.mp4', duration: 8 },
  { file: 'hevc-4k30.mp4', duration: 8 },
  { file: 'hevc-1080p-hlg10.mov', duration: 6 },
  { file: 'h264-720p60.mp4', duration: 6 },
  { file: 'h264-1080p-rot90.mp4', duration: 6 },
  { file: 'h264-1080x1920.mp4', duration: 6 },
  { file: 'h264-638x358.mp4', duration: 6 },
  { file: 'h264-720p-short.mp4', duration: 0.5 },
  { file: 'hevc-4k30-audio.mp4', duration: 8 },
];

// Played for frame pacing, copy and direct.
const PERF_MEDIA = ['h264-1080p30-audio.mp4', 'h264-4k30.mp4', 'hevc-4k30.mp4'];

type Step =
  | 'play'
  | 'seek'
  | 'scrub'
  | 'loop'
  | 'export'
  | 'churn'
  | 'hold'
  | 'perf'
  | 'leak';

type Scenario = {
  name: string;
  composition: VideoComposition;
  steps: Step[];
  // Eager 4K montages may run out of hardware decoders: an error is then an
  // acceptable outcome, a hang or a crash is not.
  errorAllowed?: boolean;
};

type Result = {
  scenario: string;
  step: string;
  ok: boolean | 'info';
  detail: string;
};

const path = (file: string) => `${STRESS_DIR}/${file}`;

/** Clips one after another, overlapping by `overlap` seconds. */
const sequence = (
  clips: { file: string; start: number; duration: number; extra?: object }[],
  options: {
    lazy?: boolean;
    overlap?: number;
    maxLongSide?: number;
    direct?: boolean;
  } = {}
): VideoComposition => {
  let time = 0;
  const items: VideoCompositionItem[] = clips.map((clip, index) => {
    const item = {
      id: `${index}-${clip.file}`,
      path: path(clip.file),
      compositionStartTime: time,
      startTime: clip.start,
      duration: clip.duration,
      ...(options.maxLongSide ? { maxLongSide: options.maxLongSide } : {}),
      ...(options.direct ? { textureMode: 'direct' as const } : {}),
      ...clip.extra,
    };
    time += clip.duration - (options.overlap ?? 0);
    return item;
  });
  const last = items[items.length - 1]!;
  return {
    duration: last.compositionStartTime + last.duration,
    items,
    lazyDecoders: options.lazy,
  };
};

const buildScenarios = (available: Set<string>): Scenario[] => {
  const has = (file: string) => available.has(file);
  const media = MEDIA.filter((m) => has(m.file) && m.duration >= 2);
  const scenarios: Scenario[] = [];
  const all: Step[] = ['play', 'seek', 'scrub', 'loop', 'export'];
  // Players mounted and unmounted while they draw: dispose on the JS thread
  // during a draw on the UI thread.
  const withChurn: Step[] = [...all, 'churn'];
  // Copy and direct compared: frame pacing, and memory over many cycles.
  const measured: Step[] = [...withChurn, 'perf'];
  const measuredLeak: Step[] = [...withChurn, 'perf', 'leak'];

  for (const lazy of [false, true]) {
    scenarios.push({
      name: `montage-all-crossfade-${lazy ? 'lazy' : 'eager'}`,
      composition: sequence(
        media.map((m, i) => ({
          file: m.file,
          start: (i * 0.7) % (m.duration - 2),
          duration: 2,
        })),
        { lazy, overlap: 0.5 }
      ),
      steps: lazy ? measured : [...all, 'leak'],
      errorAllowed: !lazy,
    });
  }
  scenarios.push({
    name: 'montage-all-crossfade-lazy-direct',
    composition: sequence(
      media.map((m, i) => ({
        file: m.file,
        start: (i * 0.7) % (m.duration - 2),
        duration: 2,
      })),
      { lazy: true, overlap: 0.5, direct: true }
    ),
    steps: measured,
  });
  const uhd = ['h264-4k30.mp4', 'hevc-4k30.mp4'].filter(has);
  if (uhd.length > 0) {
    const clips = Array.from({ length: 8 }, (_, i) => ({
      file: uhd[i % uhd.length]!,
      start: (i * 0.9) % 6,
      duration: 1.5,
    }));
    scenarios.push({
      name: '4k-x8-lazy',
      composition: sequence(clips, { lazy: true }),
      steps: measuredLeak,
    });
    scenarios.push({
      name: '4k-x8-lazy-maxLongSide1280',
      composition: sequence(clips, { lazy: true, maxLongSide: 1280 }),
      steps: all,
    });
    scenarios.push({
      name: '4k-x8-lazy-direct',
      composition: sequence(clips, { lazy: true, direct: true }),
      steps: measuredLeak,
    });
    scenarios.push({
      name: '4k-x8-eager',
      composition: sequence(clips, { lazy: false }),
      steps: ['play', 'seek', 'export'],
      errorAllowed: true,
    });
    // Three 4K clips on screen at once: three decoders whatever the mode.
    const overlap: VideoComposition = {
      duration: 5,
      lazyDecoders: true,
      items: [0, 1, 2].map((i) => ({
        id: `pip-${i}`,
        path: path(uhd[i % uhd.length]!),
        compositionStartTime: i * 0.5,
        startTime: i,
        duration: 4,
      })),
    };
    scenarios.push({
      name: '4k-x3-simultaneous',
      composition: overlap,
      steps: all,
      errorAllowed: true,
    });
  }
  if (has('h264-720p60.mp4') && has('h264-638x358.mp4')) {
    scenarios.push({
      name: 'shorts-x20-lazy',
      composition: sequence(
        Array.from({ length: 20 }, (_, i) => ({
          file: i % 2 ? 'h264-720p60.mp4' : 'h264-638x358.mp4',
          start: (i * 0.37) % 5,
          duration: 0.6,
        })),
        { lazy: true }
      ),
      steps: all,
    });
  }
  for (const m of MEDIA.filter((x) => has(x.file))) {
    for (const direct of [false, true]) {
      scenarios.push({
        name: `single-${m.file}${direct ? '-direct' : ''}`,
        composition: sequence(
          [{ file: m.file, start: 0, duration: Math.min(m.duration, 4) }],
          { direct }
        ),
        // hold: a still frame, copy and direct, for a screenshot.
        steps:
          m.duration < 2
            ? ['play']
            : [
                'play',
                'seek',
                'loop',
                'hold',
                ...(PERF_MEDIA.includes(m.file) ? (['perf'] as Step[]) : []),
              ],
      });
    }
  }
  if (has('h264-1080p30-audio.mp4') && has('tone.m4a')) {
    const composition = sequence(
      [
        {
          file: 'h264-1080p30-audio.mp4',
          start: 1,
          duration: 3,
          extra: { audio: true },
        },
        {
          file: 'h264-1080p-rot90.mp4',
          start: 0,
          duration: 3,
          extra: { audio: true },
        },
        {
          file: 'hevc-4k30-audio.mp4',
          start: 2,
          duration: 3,
          extra: { audio: { volume: 0.5 } },
        },
      ].filter((c) => has(c.file)),
      { lazy: true, maxLongSide: 1280 }
    );
    composition.items.push({
      id: 'music',
      kind: 'audio',
      path: path('tone.m4a'),
      compositionStartTime: 0,
      startTime: 0,
      duration: composition.duration,
      volume: 0.2,
    });
    scenarios.push({
      name: 'audio-lazy',
      composition,
      steps: [...all, 'leak'],
    });
  }
  if (has('h264-720p-short.mp4') && has('h264-638x358.mp4')) {
    scenarios.push({
      name: 'start-past-file-end',
      composition: sequence([
        { file: 'h264-638x358.mp4', start: 0, duration: 2 },
        {
          file: 'h264-720p-short.mp4',
          start: 3,
          duration: 2,
          extra: { id: `gone${NO_FRAMES}` },
        },
        { file: 'h264-638x358.mp4', start: 2, duration: 2 },
      ]),
      steps: ['play', 'seek', 'export'],
    });
  }
  return scenarios;
};

const itemsAt = (composition: VideoComposition, time: number) =>
  composition.items.filter(
    (item) =>
      item.kind !== 'audio' &&
      item.compositionStartTime <= time &&
      time < item.compositionStartTime + item.duration
  );

/** Draws the items on screen stacked, for the export. */
const drawTiles: FrameDrawer = ({
  canvas,
  videoComposition,
  currentTime,
  frames,
  width,
  height,
}) => {
  'worklet';
  const onScreen = videoComposition.items.filter(
    (item) =>
      item.kind !== 'audio' &&
      item.compositionStartTime <= currentTime &&
      currentTime < item.compositionStartTime + item.duration
  );
  const paint = Skia.Paint();
  const tile = height / Math.max(onScreen.length, 1);
  onScreen.forEach((item, index) => {
    const frame = frames[item.id];
    if (!frame || frame.texture == null) {
      return;
    }
    drawVideoFrame(
      canvas,
      frame,
      { x: 0, y: index * tile, width, height: tile },
      { paint, fit: 'contain' }
    );
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StressTest({ autorun }: { autorun?: boolean }) {
  const { width: windowWidth } = useWindowDimensions();
  const size = Math.round(windowWidth * 0.8);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [current, setCurrent] = useState<Scenario | null>(null);
  const [looping, setLooping] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState('Looking for media…');
  const running = useRef(false);

  // Written by drawFrame on the UI thread, read by the runner.
  const ticks = useSharedValue(0);
  // The perf step: draws, gaps between them and time spent in drawFrame.
  const perfOn = useSharedValue(false);
  const perfDraws = useSharedValue(0);
  const perfGaps = useSharedValue(0);
  const perfMaxGap = useSharedValue(0);
  const perfDrawMs = useSharedValue(0);
  const perfLast = useSharedValue(0);
  const missing = useSharedValue(0);
  const drawnTime = useSharedValue(-1);
  const drawnIds = useSharedValue('');

  const events = useRef<{ ready: boolean; complete: number; errors: string[] }>(
    {
      ready: false,
      complete: 0,
      errors: [],
    }
  );

  useEffect(() => {
    (async () => {
      const available = new Set<string>();
      if (await ReactNativeBlobUtil.fs.isDir(STRESS_DIR)) {
        for (const file of await ReactNativeBlobUtil.fs.ls(STRESS_DIR)) {
          available.add(file);
        }
      }
      const built = buildScenarios(available);
      setScenarios(built);
      setStatus(
        built.length
          ? `${available.size} media files, ${built.length} compositions`
          : `No media in ${STRESS_DIR}: run scripts/make-stress-media.swift and copy them there`
      );
    })();
  }, []);

  const drawFrame = useCallback<FrameDrawer>(
    ({ canvas, videoComposition, currentTime, frames, width, height }) => {
      'worklet';
      const onScreen = videoComposition.items.filter(
        (item) =>
          item.kind !== 'audio' &&
          item.compositionStartTime <= currentTime &&
          currentTime < item.compositionStartTime + item.duration
      );
      const drawStart = performance.now();
      if (perfOn.value) {
        if (perfLast.value > 0) {
          const gap = drawStart - perfLast.value;
          if (gap > 25) {
            perfGaps.value += 1;
          }
          perfMaxGap.value = Math.max(perfMaxGap.value, gap);
        }
        perfLast.value = drawStart;
        perfDraws.value += 1;
      }
      const paint = Skia.Paint();
      const ids: string[] = [];
      let missed = false;
      const tile = height / Math.max(onScreen.length, 1);
      onScreen.forEach((item, index) => {
        const frame = frames[item.id];
        const settled = currentTime - item.compositionStartTime > 0.3;
        if (!frame || frame.texture == null) {
          if (settled && !item.id.endsWith('~noframes')) {
            missed = true;
          }
          return;
        }
        ids.push(item.id);
        drawVideoFrame(
          canvas,
          frame,
          { x: 0, y: index * tile, width, height: tile },
          { paint, fit: 'contain' }
        );
      });
      ticks.value += 1;
      if (missed) {
        missing.value += 1;
      }
      drawnTime.value = currentTime;
      drawnIds.value = ids.join('|');
      if (perfOn.value) {
        perfDrawMs.value += performance.now() - drawStart;
      }
    },
    [
      ticks,
      missing,
      drawnTime,
      drawnIds,
      perfOn,
      perfDraws,
      perfGaps,
      perfMaxGap,
      perfDrawMs,
      perfLast,
    ]
  );

  const onError = useCallback((error: any) => {
    events.current.errors.push(String(error?.message ?? error));
  }, []);
  const onReady = useCallback(() => {
    events.current.ready = true;
  }, []);
  const onComplete = useCallback(() => {
    events.current.complete += 1;
  }, []);

  const { currentFrame, player } = useVideoCompositionPlayer({
    composition: current?.composition ?? null,
    drawFrame,
    width: size,
    height: size,
    isLooping: looping,
    onError,
    onReadyToPlay: onReady,
    onComplete,
  });
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const report = useCallback((result: Result) => {
    console.log(
      `STRESS|${result.scenario}|${result.step}|${
        result.ok === 'info' ? 'INFO' : result.ok ? 'PASS' : 'FAIL'
      }|${result.detail}`
    );
    setResults((previous) => [...previous, result]);
    // Also in a file, for a run read back from the command line.
    ReactNativeBlobUtil.fs
      .appendFile(
        `${STRESS_DIR}/results.txt`,
        `${result.scenario}|${result.step}|${
          result.ok === 'info' ? 'INFO' : result.ok ? 'PASS' : 'FAIL'
        }|${result.detail}\n`,
        'utf8'
      )
      .catch(() => {});
  }, []);

  const run = useCallback(async () => {
    if (!scenarios || running.current) {
      return;
    }
    running.current = true;
    setResults([]);
    await ReactNativeBlobUtil.fs
      .writeFile(`${STRESS_DIR}/results.txt`, '', 'utf8')
      .catch(() => {});
    const started = Date.now();

    const waitFor = async (check: () => boolean, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (!check()) {
        if (Date.now() > deadline || events.current.errors.length) {
          return false;
        }
        await sleep(16);
      }
      return true;
    };

    // The items that should be drawn at `time`.
    const expectedIds = (composition: VideoComposition, time: number) =>
      itemsAt(composition, time)
        .filter((item) => !item.id.endsWith(NO_FRAMES))
        .map((item) => item.id);

    const drawnAt = (composition: VideoComposition, time: number) => () => {
      if (Math.abs(drawnTime.value - time) > 0.05) {
        return false;
      }
      const drawn = drawnIds.value.split('|');
      return expectedIds(composition, time).every((id) => drawn.includes(id));
    };

    for (const scenario of scenarios) {
      const { composition, name } = scenario;
      setStatus(`${name}…`);
      events.current = { ready: false, complete: 0, errors: [] };
      setLooping(false);
      setCurrent(scenario);
      const ready = await waitFor(() => events.current.ready, 15000);
      const failOrInfo = (step: string, detail: string) =>
        report({
          scenario: name,
          step,
          ok:
            scenario.errorAllowed && events.current.errors.length
              ? 'info'
              : false,
          detail,
        });
      if (!ready) {
        failOrInfo(
          'open',
          `not ready: ${events.current.errors.join('; ') || 'timeout'}`
        );
        setCurrent(null);
        await sleep(500);
        continue;
      }

      for (const step of scenario.steps) {
        const p = playerRef.current;
        if (!p) {
          failOrInfo(step, 'no player');
          break;
        }
        if (events.current.errors.length) {
          break;
        }
        const t0 = Date.now();
        if (step === 'play') {
          p.pause();
          p.seekTo(0);
          await sleep(200);
          ticks.value = 0;
          missing.value = 0;
          const completes = events.current.complete;
          p.play();
          const done = await waitFor(
            () => events.current.complete > completes,
            composition.duration * 1000 + 5000
          );
          const ratio = ticks.value ? missing.value / ticks.value : 1;
          const ok = done && ratio < 0.05 && events.current.errors.length === 0;
          const detail = `${done ? 'completed' : 'no complete'} in ${Date.now() - t0}ms, ${ticks.value} draws, ${missing.value} without a settled item's frame`;
          if (ok) {
            report({ scenario: name, step, ok, detail });
          } else if (done && scenario.errorAllowed) {
            // More decoders than the hardware runs in real time.
            report({ scenario: name, step, ok: 'info', detail });
          } else {
            failOrInfo(step, `${detail} ${events.current.errors.join('; ')}`);
          }
        } else if (step === 'seek' || step === 'scrub') {
          p.pause();
          if (step === 'scrub') {
            for (let i = 0; i < 80; i++) {
              p.seekTo(Math.random() * composition.duration);
              await sleep(16);
            }
          }
          const times =
            step === 'seek'
              ? [
                  composition.duration * 0.8 + 0.013,
                  0.2,
                  ...composition.items
                    .filter((item) => item.kind !== 'audio')
                    .slice(0, 6)
                    .map(
                      (item) => item.compositionStartTime + item.duration * 0.5
                    ),
                  composition.duration - 0.1,
                  composition.duration * 0.33 + 0.013,
                ]
              : [composition.duration * 0.6 + 0.013];
          const failures: string[] = [];
          let slowest = 0;
          for (const time of times) {
            const s0 = Date.now();
            p.seekTo(time);
            if (await waitFor(drawnAt(composition, time), 4000)) {
              slowest = Math.max(slowest, Date.now() - s0);
            } else {
              failures.push(
                `${time.toFixed(2)}s: drew ${drawnTime.value.toFixed(2)}s [${drawnIds.value}] expected [${expectedIds(composition, time).join('|')}]`
              );
            }
          }
          const ok =
            failures.length === 0 && events.current.errors.length === 0;
          if (ok) {
            report({
              scenario: name,
              step,
              ok,
              detail: `${times.length} seeks, slowest ${slowest}ms`,
            });
          } else {
            failOrInfo(
              step,
              `${failures.join('; ')} ${events.current.errors.join('; ')}`
            );
          }
        } else if (step === 'loop') {
          setLooping(true);
          await sleep(100);
          p.seekTo(Math.max(composition.duration - 1, 0));
          p.play();
          let sawEnd = false;
          const wrapped = await waitFor(() => {
            const time = p.currentTime;
            if (time > composition.duration - 0.6) {
              sawEnd = true;
            }
            return (
              sawEnd &&
              time > 0.3 &&
              time < Math.min(1.5, composition.duration / 2)
            );
          }, 6000);
          const firstIds = expectedIds(composition, 0.5);
          const drew =
            wrapped &&
            (await waitFor(
              () =>
                firstIds.every((id) => drawnIds.value.split('|').includes(id)),
              2000
            ));
          p.pause();
          setLooping(false);
          const ok = wrapped && drew && events.current.errors.length === 0;
          if (ok) {
            report({
              scenario: name,
              step,
              ok,
              detail: `wrapped in ${Date.now() - t0}ms`,
            });
          } else {
            failOrInfo(
              step,
              `wrapped=${wrapped} drewFirstItems=${drew} ${events.current.errors.join('; ')}`
            );
          }
        } else if (step === 'perf') {
          // Frame pacing while playing; the host resets and reads the
          // system's frame stats (Android gfxinfo) around it.
          p.pause();
          p.seekTo(0);
          await sleep(500);
          perfDraws.value = 0;
          perfGaps.value = 0;
          perfMaxGap.value = 0;
          perfDrawMs.value = 0;
          perfLast.value = 0;
          console.log(`STRESS_PERF_BEGIN|${name}`);
          const started = Date.now();
          perfOn.value = true;
          p.play();
          await sleep(Math.min(composition.duration - 0.2, 8) * 1000);
          perfOn.value = false;
          const seconds = (Date.now() - started) / 1000;
          console.log(`STRESS_PERF_END|${name}`);
          p.pause();
          const draws = perfDraws.value;
          report({
            scenario: name,
            step,
            ok: true,
            detail: `${(draws / seconds).toFixed(1)} draws/s, ${perfGaps.value} gaps over 25ms (max ${perfMaxGap.value.toFixed(0)}ms), drawFrame ${(perfDrawMs.value / Math.max(draws, 1)).toFixed(2)}ms avg`,
          });
        } else if (step === 'leak') {
          // The same composition mounted, played, sought and unmounted again
          // and again; the host samples memory, threads and codecs every ten
          // cycles, unmounted, and checks they stay flat.
          let cycles = 0;
          for (let cycle = 0; cycle <= 40; cycle++) {
            if (cycle % 10 === 0) {
              setCurrent(null);
              await sleep(1500);
              console.log(`STRESS_SAMPLE|${name}|${cycle}`);
              await sleep(2000);
            }
            if (cycle === 40) {
              break;
            }
            events.current.ready = false;
            setCurrent(scenario);
            if (!(await waitFor(() => events.current.ready, 10000))) {
              break;
            }
            playerRef.current?.play();
            await sleep(400);
            playerRef.current?.seekTo(composition.duration * 0.7);
            await sleep(300);
            cycles++;
          }
          setCurrent(null);
          const ok = cycles === 40 && events.current.errors.length === 0;
          if (ok) {
            report({
              scenario: name,
              step,
              ok,
              detail: `${cycles} mount, play, seek, unmount cycles; memory sampled every 10`,
            });
          } else {
            failOrInfo(
              step,
              `${cycles} cycles ${events.current.errors.join('; ')}`
            );
          }
          // Back for the steps after this one.
          events.current.ready = false;
          setCurrent(scenario);
          await waitFor(() => events.current.ready, 15000);
        } else if (step === 'hold') {
          p.pause();
          const time = Math.min(1, composition.duration / 2) + 0.013;
          p.seekTo(time);
          const shown = await waitFor(drawnAt(composition, time), 4000);
          await sleep(300);
          console.log(`STRESS_HOLD|${name}`);
          await sleep(2500);
          if (shown) {
            report({
              scenario: name,
              step,
              ok: true,
              detail: `held ${time.toFixed(3)}s`,
            });
          } else {
            failOrInfo(step, `no frame at ${time.toFixed(3)}s to hold`);
          }
        } else if (step === 'churn') {
          for (let i = 0; i < 25; i++) {
            setCurrent(null);
            await sleep(20 + Math.random() * 100);
            events.current.ready = false;
            setCurrent(scenario);
            if (!(await waitFor(() => events.current.ready, 10000))) {
              break;
            }
            playerRef.current?.seekTo(Math.random() * composition.duration);
            playerRef.current?.play();
            await sleep(50 + Math.random() * 350);
          }
          const ok = events.current.errors.length === 0 && events.current.ready;
          if (ok) {
            report({
              scenario: name,
              step,
              ok,
              detail: `25 mount, play, unmount cycles in ${Date.now() - t0}ms`,
            });
          } else {
            failOrInfo(
              step,
              `ready=${events.current.ready} ${events.current.errors.join('; ')}`
            );
          }
        } else if (step === 'export') {
          setCurrent(null);
          await sleep(300);
          const requested = {
            width: 1080,
            height: 1080,
            frameRate: 30,
            bitRate: 8_000_000,
          };
          const config =
            Platform.OS === 'android'
              ? getValidEncoderConfigurations(
                  requested.width,
                  requested.height,
                  requested.frameRate,
                  requested.bitRate
                )?.[0]
              : requested;
          if (!config) {
            report({
              scenario: name,
              step,
              ok: false,
              detail: 'no encoder configuration',
            });
            break;
          }
          const outPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/stress-${name}.mp4`;
          let frames = 0;
          let total = 0;
          try {
            await Promise.race([
              exportVideoComposition({
                videoComposition: composition,
                drawFrame: drawTiles,
                outPath,
                ...config,
                onProgress: (progress) => {
                  frames = progress.framesCompleted;
                  total = progress.nbFrames;
                },
              }),
              sleep(180_000).then(() => {
                throw new Error(`timeout at frame ${frames}/${total}`);
              }),
            ]);
            const stat = await ReactNativeBlobUtil.fs.stat(outPath);
            const ok = frames === total && Number(stat.size) > 0;
            report({
              scenario: name,
              step,
              ok,
              detail: `${frames}/${total} frames ${config.width}x${config.height} in ${Date.now() - t0}ms, ${Math.round(Number(stat.size) / 1024)} KB`,
            });
            await ReactNativeBlobUtil.fs.unlink(outPath).catch(() => {});
          } catch (error: any) {
            report({
              scenario: name,
              step,
              ok: scenario.errorAllowed ? 'info' : false,
              detail: `export failed at ${frames}/${total}: ${error?.message ?? error}`,
            });
          }
          // Back to the player for the next steps, if any.
          events.current.ready = false;
          setCurrent(scenario);
          await waitFor(() => events.current.ready, 15000);
        }
      }
      setCurrent(null);
      await sleep(500);
    }
    setStatus(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log('STRESS|done');
    ReactNativeBlobUtil.fs
      .appendFile(`${STRESS_DIR}/results.txt`, 'done\n', 'utf8')
      .catch(() => {});
    running.current = false;
  }, [
    scenarios,
    report,
    ticks,
    missing,
    drawnTime,
    drawnIds,
    perfOn,
    perfDraws,
    perfGaps,
    perfMaxGap,
    perfDrawMs,
    perfLast,
  ]);

  useEffect(() => {
    if (autorun && scenarios?.length) {
      run();
    }
    // Once, when the scenarios are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, scenarios]);

  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;

  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 8, paddingTop: 8 }}>
      <Canvas style={{ width: size, height: size, backgroundColor: 'black' }}>
        <SkiaImage
          image={currentFrame}
          x={0}
          y={0}
          width={size}
          height={size}
        />
      </Canvas>
      <Text style={{ color: 'black' }}>{status}</Text>
      <Text style={{ color: 'black' }}>
        {passed} passed, {failed} failed
      </Text>
      <Button title="Run" onPress={run} disabled={!scenarios?.length} />
      <ScrollView style={{ alignSelf: 'stretch', paddingHorizontal: 12 }}>
        {results.map((r, i) => (
          <Text
            key={i}
            style={{
              color: r.ok === true ? 'green' : r.ok === 'info' ? 'gray' : 'red',
              fontSize: 12,
            }}
          >
            {r.ok === true ? '✓' : r.ok === 'info' ? 'i' : '✗'} {r.scenario} ·{' '}
            {r.step}: {r.detail}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
