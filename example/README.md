This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Benchmark

The **Benchmark** screen measures the library on the device, with reproducible
scenarios, to compare branches or devices:

- **Test clips** (1080p30, 1080p60, 2160p30, 12 s) are generated on the device
  the first time (a synthetic animation exported by the library itself), so
  every run decodes the same files, without network.
- **Export** scenarios measure the export time, the frames per second and, per
  frame on the export thread, the decoding time (`decodeMs`) and the drawing +
  encoding time (`renderEncodeMs`).
- **Composition preview** and **video player** scenarios measure, after a
  warm-up, the UI frame intervals, the frames missed by the display, the cost
  of a composition frame on the UI thread and the rate of the decoded frames.
- The **cadence** of the frames on screen: the intervals between two new
  frames of a clip (`itemFrameIntervalMs` in a preview,
  `decodedFrameIntervalMs` in a player) and `irregularFramesPct`, the share
  of them off by more than 3/4 of a display refresh from the duration of a
  frame (a frame shown a refresh early or late: judder). 30 fps on 60 Hz
  should show every frame for 33 ms; 24 fps on 60 Hz alternates 33 and 50 ms,
  which is not counted.
- The **sequence** scenarios play 8 clips one after another: only the clips
  around the current time have a decoder and textures, so their memory peak
  should stay close to that of a single clip, and the frames missed by the
  display show the cost of opening the next clip's decoder.
- The **color check** exports color bars (grays over the whole range, then
  mid saturated colors), decodes the exported video and reads a frame back:
  `maxError` is the largest change of a channel (0-255) over the encoding and
  the decoding, a few levels at most when the colors are kept.
- Each run records the memory of the process before and after it (iOS:
  physical footprint, Android: total PSS): it should stay stable over
  repeated runs.

Set a label (e.g. `pr63-iphone15`), a number of runs per scenario, run, then
**Share JSON** to keep the report. Measure in a Release build:

```bash
yarn ios --mode Release
yarn android --mode release
```

# Getting Started

>**Note**: Make sure you have completed the [React Native - Environment Setup](https://reactnative.dev/docs/environment-setup) instructions till "Creating a new application" step, before proceeding.

## Step 1: Start the Metro Server

First, you will need to start **Metro**, the JavaScript _bundler_ that ships _with_ React Native.

To start Metro, run the following command from the _root_ of your React Native project:

```bash
# using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Start your Application

Let Metro Bundler run in its _own_ terminal. Open a _new_ terminal from the _root_ of your React Native project. Run the following command to start your _Android_ or _iOS_ app:

### For Android

```bash
# using npm
npm run android

# OR using Yarn
yarn android
```

### For iOS

```bash
# using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up _correctly_, you should see your new app running in your _Android Emulator_ or _iOS Simulator_ shortly provided you have set up your emulator/simulator correctly.

This is one way to run your app — you can also run it directly from within Android Studio and Xcode respectively.

## Step 3: Modifying your App

Now that you have successfully run the app, let's modify it.

1. Open `App.tsx` in your text editor of choice and edit some lines.
2. For **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Developer Menu** (<kbd>Ctrl</kbd> + <kbd>M</kbd> (on Window and Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (on macOS)) to see your changes!

   For **iOS**: Hit <kbd>Cmd ⌘</kbd> + <kbd>R</kbd> in your iOS Simulator to reload the app and see your changes!

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [Introduction to React Native](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
