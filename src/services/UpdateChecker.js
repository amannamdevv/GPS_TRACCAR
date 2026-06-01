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
  try {
    const updateNeeded = await VersionCheck.needUpdate();

    if (updateNeeded && updateNeeded.isNeeded) {
      Alert.alert(
        'Update Available',
        `A new version (${updateNeeded.latestVersion}) is available. Please update for the best experience.`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Update',
            onPress: () => {
              Linking.openURL(
                updateNeeded.storeUrl || PLAY_STORE_URL,
              );
            },
          },
        ],
        { cancelable: true },
      );
    }
  } catch (error) {
    // Silently ignore errors (no internet, app not published yet, etc.)
    console.log('[UpdateChecker] Version check skipped:', error.message);
  }
};

export default { checkForUpdate };
