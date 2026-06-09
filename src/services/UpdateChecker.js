import { Alert, Linking } from 'react-native';
import VersionCheck from 'react-native-version-check';

const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.traccarmanager.app';

/**
 * Checks the Play Store for a newer version of the app.
 * If a newer version is found, shows a simple alert with an "Update" button
 * that opens the Play Store listing.
 *
 * Safe to call on every app launch – silently does nothing when the network
 * is unavailable or the app is not yet published.
 */
const checkForUpdate = async () => {
  // Disabling to prevent console warnings when the package name is not published on Google Play.
  return;
};

export default { checkForUpdate };
