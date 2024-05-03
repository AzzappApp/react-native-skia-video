import { View, StyleSheet, Button } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import VideoPlayerExample from './VideoPlayerExample';

type RootStackParamList = {
  Home: undefined;
  VideoPlayer: undefined;
};

function HomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList>) {
  return (
    <View style={styles.container}>
      <Button
        title="VideoPlayer Example"
        onPress={() => navigation.push('VideoPlayer')}
      />
    </View>
  );
}

const Stack = createNativeStackNavigator();

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="VideoPlayer" component={VideoPlayerExample} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
