import { View, Button, Platform, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import VideoPlayerExample from './VideoPlayerExample';
import VideoCompositionExample from './VideoCompositionExample';
import BenchmarkScreen from './benchmark/BenchmarkScreen';
import { useEffect, useState } from 'react';
import { getDecodingCapabilitiesFor } from '@azzapp/react-native-skia-video';

type RootStackParamList = {
  Home: undefined;
  VideoPlayer: undefined;
  VideoComposition: undefined;
  Benchmark: undefined;
};

function HomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList>) {
  const [supportedDecoder, setSupportedDecoder] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'android') {
      const decodingCapabilities = getDecodingCapabilitiesFor('video/avc');
      setSupportedDecoder(
        decodingCapabilities
          ? `Resolution:${decodingCapabilities.maxWidth}x${decodingCapabilities.maxHeight}` +
              `\nMaxPlayer : ${decodingCapabilities.maxInstances}`
          : 'No decoder found for video/avc'
      );
    }
  }, []);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      <Button
        title="Video Player Example"
        onPress={() => navigation.push('VideoPlayer')}
      />
      <Button
        title="Video Composition Example"
        onPress={() => navigation.push('VideoComposition')}
      />
      <Button title="Benchmark" onPress={() => navigation.push('Benchmark')} />
      {supportedDecoder && <Text>Supported Decoder: {supportedDecoder}</Text>}
    </View>
  );
}

const Stack = createNativeStackNavigator();

function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Home"
            options={{ title: '@azzapp/react-native-skia-video' }}
            component={HomeScreen}
          />
          <Stack.Screen
            name="VideoPlayer"
            options={{ title: 'Video Player Example' }}
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
