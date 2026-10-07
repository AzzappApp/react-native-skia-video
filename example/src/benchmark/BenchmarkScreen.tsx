import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Button,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { CLIPS, generateClip, getClip, isClipReady } from './clips';
import { PlayerRun, PreviewRun } from './LiveRuns';
import {
  getScenarioClips,
  runExportScenario,
  SCENARIOS,
  type Metrics,
  type PlayerScenario,
  type PreviewScenario,
  type Scenario,
} from './scenarios';
import {
  formatBytes,
  formatSummary,
  readMemoryFootprint,
  wait,
  type Summary,
} from './stats';

type RunResult = {
  scenario: string;
  run: number;
  startedAt: string;
  metrics: Metrics | null;
  error: string | null;
  /** Memory before the run and once it is over (after a pause). */
  memoryBefore: number | null;
  memoryAfter: number | null;
  /** Highest memory sampled during the run. */
  memoryPeak: number | null;
};

type LiveRun = {
  scenario: PreviewScenario | PlayerScenario;
  resolve: (metrics: Metrics) => void;
  reject: (error: unknown) => void;
};

// Lets the previous run release its resources before measuring the memory.
const SETTLE_MS = 1500;

const RUN_COUNTS = [1, 3, 5, 10];

// Reading the memory is slow on Android (Debug.getMemoryInfo).
const MEMORY_SAMPLING_MS = Platform.OS === 'android' ? 500 : 250;

const BenchmarkScreen = () => {
  const [label, setLabel] = useState('');
  const [runCount, setRunCount] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(SCENARIOS.map((scenario) => scenario.id))
  );
  const [readyClips, setReadyClips] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshClips = useCallback(async () => {
    const ready = new Set<string>();
    for (const clip of CLIPS) {
      if (await isClipReady(clip)) {
        ready.add(clip.id);
      }
    }
    setReadyClips(ready);
    return ready;
  }, []);

  useEffect(() => {
    refreshClips();
  }, [refreshClips]);

  const running = status != null;

  /**
   * Generates the missing clips. Returns why the clips that could not be
   * generated are unavailable (e.g. unsupported by the device's encoders).
   */
  const ensureClips = async (clipIds: string[], signal: AbortSignal) => {
    const unavailable = new Map<string, string>();
    const ready = await refreshClips();
    for (const clipId of new Set(clipIds)) {
      if (ready.has(clipId) || signal.aborted) {
        continue;
      }
      try {
        await generateClip(getClip(clipId), signal, (progress) =>
          setStatus(`Generating clip ${clipId}… ${Math.round(progress * 100)}%`)
        );
      } catch (e) {
        if (signal.aborted) {
          throw e;
        }
        unavailable.set(clipId, e instanceof Error ? e.message : String(e));
      }
      await refreshClips();
    }
    return unavailable;
  };

  const runLive = (scenario: PreviewScenario | PlayerScenario) =>
    new Promise<Metrics>((resolve, reject) =>
      setLiveRun({ scenario, resolve, reject })
    ).finally(() => setLiveRun(null));

  const runScenario = (scenario: Scenario, signal: AbortSignal) => {
    if (scenario.kind === 'export') {
      return runExportScenario(scenario, signal, (progress) =>
        setStatus(`${scenario.label}… ${Math.round(progress * 100)}%`)
      );
    }
    setStatus(`${scenario.label}…`);
    return runLive(scenario);
  };

  const runBenchmark = async (generateOnly = false) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;
    const scenarios = SCENARIOS.filter((scenario) => selected.has(scenario.id));
    try {
      setStatus('Preparing…');
      const unavailableClips = await ensureClips(
        generateOnly
          ? CLIPS.map((clip) => clip.id)
          : scenarios.flatMap(getScenarioClips),
        signal
      );
      if (generateOnly) {
        if (unavailableClips.size > 0) {
          Alert.alert(
            'Some clips are unavailable',
            [...unavailableClips.values()].join('\n')
          );
        }
        return;
      }
      for (const scenario of scenarios) {
        const missingClip = getScenarioClips(scenario).find((clipId) =>
          unavailableClips.has(clipId)
        );
        if (missingClip != null) {
          setResults((previous) => [
            ...previous,
            {
              scenario: scenario.id,
              run: 0,
              startedAt: new Date().toISOString(),
              metrics: null,
              error: `Skipped: ${unavailableClips.get(missingClip)}`,
              memoryBefore: null,
              memoryAfter: null,
              memoryPeak: null,
            },
          ]);
          continue;
        }
        for (let run = 1; run <= runCount && !signal.aborted; run++) {
          setStatus(`${scenario.label} (run ${run}/${runCount})`);
          await wait(SETTLE_MS);
          const memoryBefore = readMemoryFootprint();
          const startedAt = new Date().toISOString();
          let metrics: Metrics | null = null;
          let error: string | null = null;
          let memoryPeak = memoryBefore;
          const memorySampling = setInterval(() => {
            const memory = readMemoryFootprint();
            if (memory != null && (memoryPeak == null || memory > memoryPeak)) {
              memoryPeak = memory;
            }
          }, MEMORY_SAMPLING_MS);
          // A run during which the app left the foreground is not
          // representative (throttled or suspended).
          let interrupted = false;
          const appStateSubscription = AppState.addEventListener(
            'change',
            (state) => {
              if (state !== 'active') {
                interrupted = true;
              }
            }
          );
          try {
            metrics = await runScenario(scenario, signal);
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          } finally {
            clearInterval(memorySampling);
            appStateSubscription.remove();
          }
          if (interrupted && error == null) {
            error = 'Interrupted: the app left the foreground';
          }
          if (signal.aborted) {
            return;
          }
          await wait(SETTLE_MS);
          const result: RunResult = {
            scenario: scenario.id,
            run,
            startedAt,
            metrics,
            error,
            memoryBefore,
            memoryAfter: readMemoryFootprint(),
            memoryPeak,
          };
          console.log('[benchmark]', JSON.stringify(result));
          setResults((previous) => [...previous, result]);
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        Alert.alert('Benchmark failed', e instanceof Error ? e.message : '');
      }
    } finally {
      abortControllerRef.current = null;
      setStatus(null);
    }
  };

  const stop = () => {
    abortControllerRef.current?.abort();
    liveRun?.reject(new Error('Stopped'));
  };

  const report = () => ({
    label,
    platform: Platform.OS,
    osVersion: Platform.Version,
    date: new Date().toISOString(),
    runsPerScenario: runCount,
    results,
  });

  const shareReport = async () => {
    const json = JSON.stringify(report(), null, 2);
    const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/rnskv-benchmark-${
      label || 'report'
    }-${Date.now()}.json`;
    await ReactNativeBlobUtil.fs.writeFile(path, json, 'utf8');
    await Share.share({ message: json, title: `Benchmark ${label}` });
  };

  const toggleScenario = (id: string, value: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {liveRun?.scenario.kind === 'preview' && (
        <PreviewRun
          scenario={liveRun.scenario}
          onDone={liveRun.resolve}
          onError={liveRun.reject}
        />
      )}
      {liveRun?.scenario.kind === 'player' && (
        <PlayerRun
          scenario={liveRun.scenario}
          onDone={liveRun.resolve}
          onError={liveRun.reject}
        />
      )}
      {running ? (
        <View style={styles.section}>
          <Text style={styles.status}>{status}</Text>
          <Button title="Stop" onPress={stop} />
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            Measure in a Release build, device plugged in and cool, and keep the
            app in the foreground.
          </Text>
          <View style={styles.section}>
            <Text style={styles.title}>Label</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. pr63-iphone15"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.section}>
            <Text style={styles.title}>Runs per scenario</Text>
            <View style={styles.row}>
              {RUN_COUNTS.map((count) => (
                <Button
                  key={count}
                  title={count === runCount ? `[${count}]` : `${count}`}
                  onPress={() => setRunCount(count)}
                />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.title}>Test clips</Text>
            {CLIPS.map((clip) => (
              <Text key={clip.id}>
                {clip.id} ({clip.width}×{clip.height}@{clip.frameRate},{' '}
                {clip.duration}s):{' '}
                {readyClips.has(clip.id) ? 'ready' : 'generated on first run'}
              </Text>
            ))}
            <Button
              title="Generate the clips"
              onPress={() => runBenchmark(true)}
            />
          </View>
          <View style={styles.section}>
            <Text style={styles.title}>Scenarios</Text>
            {SCENARIOS.map((scenario) => (
              <View key={scenario.id} style={styles.row}>
                <Switch
                  value={selected.has(scenario.id)}
                  onValueChange={(value) => toggleScenario(scenario.id, value)}
                />
                <Text style={styles.scenarioLabel}>{scenario.label}</Text>
              </View>
            ))}
            <Button
              title="Run the selected scenarios"
              disabled={selected.size === 0}
              onPress={() => runBenchmark()}
            />
          </View>
        </>
      )}
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={[styles.title, styles.grow]}>
            Results ({results.length})
          </Text>
          <Button
            title="Share JSON"
            disabled={results.length === 0 || running}
            onPress={shareReport}
          />
          <Button
            title="Clear"
            disabled={results.length === 0 || running}
            onPress={() => setResults([])}
          />
        </View>
        {results.map((result, index) => (
          <ResultView key={index} result={result} />
        ))}
      </View>
    </ScrollView>
  );
};

const isSummary = (value: unknown): value is Summary =>
  typeof value === 'object' && value != null && 'p50' in value;

const ResultView = ({ result }: { result: RunResult }) => (
  <View style={styles.result}>
    <Text style={styles.resultTitle}>
      {result.scenario} #{result.run}
    </Text>
    {result.error != null && (
      <Text style={styles.error}>Error: {result.error}</Text>
    )}
    {Object.entries(result.metrics ?? {}).map(([key, value]) => (
      <Text key={key} style={styles.metric}>
        {key}:{' '}
        {isSummary(value)
          ? formatSummary(value)
          : key === 'fileSize'
            ? formatBytes(value as number | null)
            : String(value)}
      </Text>
    ))}
    <Text style={styles.metric}>
      memory: {formatBytes(result.memoryBefore)} →{' '}
      {formatBytes(result.memoryAfter)} (
      {result.memoryBefore != null && result.memoryAfter != null
        ? formatBytes(result.memoryAfter - result.memoryBefore)
        : 'n/a'}
      ), peak {formatBytes(result.memoryPeak)}
    </Text>
  </View>
);

export default BenchmarkScreen;

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  hint: {
    fontStyle: 'italic',
  },
  status: {
    fontSize: 16,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    padding: 8,
  },
  scenarioLabel: {
    flex: 1,
  },
  result: {
    gap: 2,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resultTitle: {
    fontWeight: 'bold',
  },
  error: {
    color: 'red',
  },
  metric: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
  },
});
