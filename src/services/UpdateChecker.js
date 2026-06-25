import { Alert, Linking } from 'react-native';
import VersionCheck from 'react-native-version-check';

const PACKAGE_NAME = 'com.stpl.gpstracker';

const MARKET_URL = `market://details?id=${PACKAGE_NAME}`;
const WEB_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;

const openPlayStore = async () => {
  try {
    const supported = await Linking.canOpenURL(MARKET_URL);

    if (supported) {
      await Linking.openURL(MARKET_URL);
    } else {
      await Linking.openURL(WEB_URL);
    }
  } catch (error) {
    try {
      await Linking.openURL(WEB_URL);
    } catch (e) {
      console.log('[UpdateChecker] Unable to open Play Store:', e.message);
    }
  }
};

/**
 * Checks the Play Store for a newer version of the app.
 */
const checkForUpdate = async () => {
  try {
    const currentVersion = await VersionCheck.getCurrentVersion();
    const latestVersion = await VersionCheck.getLatestVersion();

    console.log('[UpdateChecker] Current Version:', currentVersion);
    console.log('[UpdateChecker] Latest Version:', latestVersion);

    const update = VersionCheck.needUpdate({
      currentVersion,
      latestVersion,
    });

    if (update && update.isNeeded) {
      Alert.alert(
        'Update Available',
        `A new version (${latestVersion}) is available. Please update to enjoy the latest features.`,
        [
          {
            text: 'Later',
            style: 'cancel',
          },
          {
            text: 'Update',
            onPress: openPlayStore,
          },
        ],
        {
          cancelable: false,
        }
      );
    }
  } catch (e) {
    console.log('[UpdateChecker] Check failed:', e.message);
  }
};

export default {
  checkForUpdate,
};