import { Alert, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * The file path of a `file://` URI, as the library's compositions take them.
 * iOS URIs are percent-encoded (`absoluteString`).
 */
export const pathFromUri = (uri: string) =>
  decodeURIComponent(uri.replace(/^file:\/\//, ''));

/**
 * Opens a video file of the app with the system's apps: a preview on iOS,
 * whose share button saves or sends it (AirDrop to a Mac, Files, Photos), an
 * app chosen by the user on Android.
 */
export const openVideoFile = (path: string) => {
  if (Platform.OS === 'android') {
    ReactNativeBlobUtil.android
      .actionViewIntent(path, 'video/mp4')
      .catch((error) => Alert.alert('Could not open the video', String(error)));
  } else {
    ReactNativeBlobUtil.ios.previewDocument(path);
  }
};

export const formatBytes = (bytes: number | undefined) => {
  if (bytes == null) {
    return null;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
};
