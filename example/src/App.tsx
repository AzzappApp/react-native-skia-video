import { useEffect, useState } from 'react';
import { Platform, Pressable, StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Group,
  LinearGradient,
  RoundedRect,
  vec,
} from 'react-native-skia';
import { getDecodingCapabilitiesFor } from '@azzapp/react-native-skia-video';
import VideoPlayerExample from './VideoPlayerExample';
import VideoCompositionExample from './VideoCompositionExample';
import ClipExportExample from './ClipExportExample';
import BenchmarkScreen from './benchmark/BenchmarkScreen';
import { hasPexelsApiKey } from './helpers/pexelsClient';
import {
  colors,
  navigationTheme,
  radius,
  screenOptions,
  spacing,
} from './theme';
import { AppText, Card, Screen, Tag, styles } from './ui';

type RootStackParamList = {
  Home: undefined;
  ClipExport: undefined;
  VideoPlayer: undefined;
  VideoComposition: undefined;
  Benchmark: undefined;
};

type Example = {
  route: Exclude<keyof RootStackParamList, 'Home'>;
  title: string;
  description: string;
  tags: { label: string; tone: 'accent' | 'warning' | 'muted' }[];
};

const pexelsTag = hasPexelsApiKey
  ? { label: 'Pexels', tone: 'muted' as const }
  : { label: 'Needs a Pexels API key', tone: 'warning' as const };

const EXAMPLES: Example[] = [
  {
    route: 'ClipExport',
    title: 'Clip export',
    description:
      'Export a video of your library at the frame rate you choose, then compare it with the original, slowed down.',
    tags: [{ label: 'Export', tone: 'accent' }],
  },
  {
    route: 'VideoPlayer',
    title: 'Video player',
    description:
      'Stream a video into a Skia canvas: seek, change the speed, blur it.',
    tags: [{ label: 'Player', tone: 'accent' }, pexelsTag],
  },
  {
    route: 'VideoComposition',
    title: 'Video composition',
    description:
      'Cross-fade a selection of clips over music, preview it and export it.',
    tags: [{ label: 'Composition', tone: 'accent' }, pexelsTag],
  },
  {
    route: 'Benchmark',
    title: 'Benchmark',
    description:
      'Measure decoding, preview and export on generated clips, and share the results.',
    tags: [{ label: 'Performance', tone: 'muted' }],
  },
];

const HERO_HEIGHT = 168;

/** The home screen's header, drawn with Skia: glows and a strip of frames. */
const Hero = ({ width }: { width: number }) => {
  const frameWidth = 34;
  const frameHeight = 24;
  const frames = Math.floor((width * 0.55) / (frameWidth + 8));
  return (
    <View style={{ width, height: HERO_HEIGHT }}>
      <Canvas style={{ width, height: HERO_HEIGHT }}>
        <Fill color={colors.background} />
        <Group
          clip={{
            rect: { x: 0, y: 0, width, height: HERO_HEIGHT },
            rx: radius.lg,
            ry: radius.lg,
          }}
        >
          <RoundedRect
            x={0}
            y={0}
            width={width}
            height={HERO_HEIGHT}
            r={radius.lg}
          >
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, HERO_HEIGHT)}
              colors={['#0E3A38', colors.surface, '#241A45']}
            />
          </RoundedRect>
          <Circle cx={width * 0.88} cy={24} r={64} color={colors.accent}>
            <BlurMask blur={48} style="normal" />
          </Circle>
          <Circle
            cx={width * 0.62}
            cy={HERO_HEIGHT + 20}
            r={70}
            color={colors.violet}
            opacity={0.7}
          >
            <BlurMask blur={52} style="normal" />
          </Circle>
          <Group opacity={0.55}>
            {Array.from({ length: frames }, (_, index) => (
              <RoundedRect
                key={index}
                x={width - spacing.lg - (index + 1) * (frameWidth + 8) + 8}
                y={spacing.lg}
                width={frameWidth}
                height={frameHeight}
                r={4}
                color={colors.text}
                style="stroke"
                strokeWidth={1}
                opacity={1 - index / frames}
              />
            ))}
          </Group>
        </Group>
      </Canvas>
      <View
        style={{
          position: 'absolute',
          left: spacing.xl,
          right: spacing.xl,
          bottom: spacing.xl,
          gap: spacing.xs,
        }}
      >
        <AppText variant="caption" style={{ color: colors.accent }}>
          @azzapp/react-native-skia-video
        </AppText>
        <AppText variant="title">Video, drawn with Skia</AppText>
      </View>
    </View>
  );
};

const HomeScreen = ({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Home'>) => {
  const insets = useSafeAreaInsets();
  const [heroWidth, setHeroWidth] = useState(0);
  const [supportedDecoder, setSupportedDecoder] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'android') {
      const decodingCapabilities = getDecodingCapabilitiesFor('video/avc');
      setSupportedDecoder(
        decodingCapabilities
          ? `H.264 decoding up to ${decodingCapabilities.maxWidth}×${decodingCapabilities.maxHeight}, ${decodingCapabilities.maxInstances} at once`
          : 'No H.264 decoder found'
      );
    }
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: spacing.lg + insets.top }}>
      <View onLayout={(event) => setHeroWidth(event.nativeEvent.layout.width)}>
        {heroWidth > 0 && <Hero width={heroWidth} />}
      </View>
      {EXAMPLES.map((example) => (
        <Pressable
          key={example.route}
          accessibilityRole="button"
          onPress={() => navigation.navigate(example.route)}
        >
          {({ pressed }) => (
            <Card
              style={
                pressed && {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.accent,
                }
              }
            >
              <View style={styles.row}>
                <AppText variant="heading" style={styles.grow}>
                  {example.title}
                </AppText>
                <AppText variant="heading" style={{ color: colors.accent }}>
                  ›
                </AppText>
              </View>
              <AppText variant="muted">{example.description}</AppText>
              <View style={styles.wrapRow}>
                {example.tags.map((tag) => (
                  <Tag key={tag.label} label={tag.label} tone={tag.tone} />
                ))}
              </View>
            </Card>
          )}
        </Pressable>
      ))}
      {supportedDecoder && (
        <AppText variant="mono" style={styles.center}>
          {supportedDecoder}
        </AppText>
      )}
    </Screen>
  );
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Home"
            options={{ headerShown: false }}
            component={HomeScreen}
          />
          <Stack.Screen
            name="ClipExport"
            options={{ title: 'Clip export' }}
            component={ClipExportExample}
          />
          <Stack.Screen
            name="VideoPlayer"
            options={{ title: 'Video player' }}
            component={VideoPlayerExample}
          />
          <Stack.Screen
            name="VideoComposition"
            component={VideoCompositionExample}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Benchmark"
            options={{ title: 'Benchmark' }}
            component={BenchmarkScreen}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
