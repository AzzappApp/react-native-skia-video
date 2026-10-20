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

# Background GPU loss (iOS)

The **Background GPU loss (iOS)** screen tries to reproduce the loss of React
Native Skia's GPU device when the app goes to the background while GPU work is
being submitted. iOS refuses GPU work from an app in the background, including
work still queued when the app gets there. With React Native Skia 3.7
(Dawn 157) a refused Metal command buffer loses the device, and nothing renders
again until the app is restarted; React Native Skia 3.6 (Dawn 154) only lost
the refused frame.

At every frame, the screen draws a costly animated background with a clock
over it (hand, seconds, frame number), into an offscreen surface from a frame
callback (React Native Skia only). Switches draw the background with a WebGPU
pass on Skia's device instead of a Skia shader, and render through a
composition player of this library. In a Release build on an iPhone
(`yarn ios --mode Release`):

1. **Start**; raise the GPU load if needed.
2. Go to the home screen (swipe up) for a few seconds, then come back. Try the
   side (lock) button too.
3. A loss shows at once: the clock stops, the banner turns red with
   `Skia.gpu.error`, and **Mount a new canvas** shows no disc.

The banner is a React Native view (it keeps working after a loss) and reads
`Skia.gpu` twice a second. The **Workaround** switch stops rendering as soon as
the app leaves the `active` state (`inactive` comes before `background`). The
app state transitions are listed as the JS thread receives them.

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
