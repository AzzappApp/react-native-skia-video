import { View, Button, Platform, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import VideoPlayerExample from './VideoPlayerExample';
import VideoCompositionExample from './VideoCompositionExample';
import StressTest, { STRESS_DIR } from './StressTest';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useEffect, useState } from 'react';
import { getDecodingCapabilitiesFor } from '@azzapp/react-native-skia-video';

type RootStackParamList = {
  Home: undefined;
  VideoPlayer: undefined;
  VideoComposition: undefined;
  Stress: { autorun?: boolean };
};

function HomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList>) {
  const [supportedDecoder, setSupportedDecoder] = useState<string | null>(null);
  // A run started from the command line: see StressTest.tsx.
  useEffect(() => {
    ReactNativeBlobUtil.fs.exists(`${STRESS_DIR}/autorun`).then((autorun) => {
      if (autorun) {
        navigation.push('Stress', { autorun: true });
      }
    });
  }, [navigation]);
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
      <Button
        title="Stress Test"
        onPress={() => navigation.push('Stress', {})}
      />
      {supportedDecoder && <Text>Supported Decoder: {supportedDecoder}</Text>}
    </View>
  );
}

function StressScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, 'Stress'>) {
  return <StressTest autorun={route.params?.autorun} />;
}

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
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
          name="Stress"
          options={{ title: 'Stress Test' }}
          component={StressScreen}
        />
        <Stack.Screen
          name="VideoComposition"
          component={VideoCompositionExample}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;
