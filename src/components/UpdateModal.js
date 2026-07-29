import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, AppState, Dimensions } from 'react-native';
import Modal from 'react-native-modal';
import VersionCheck from 'react-native-version-check';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
      console.log('[UpdateModal] Unable to open Play Store:', e.message);
    }
  }
};

const UpdateModal = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  const checkForUpdate = async () => {
    try {
      const currentVersion = VersionCheck.getCurrentVersion();
      let latestVersion = null;

      try {
        latestVersion = await VersionCheck.getLatestVersion({
          forceUpdate: true,
          provider: 'playStore',
          packageName: PACKAGE_NAME,
        });
      } catch (err) {
        console.log('VersionCheck getLatestVersion error:', err);
      }

      // Fallback scraper if the library fails to extract version from Play Store
      if (!latestVersion) {
        try {
          const response = await fetch(`https://play.google.com/store/apps/details?id=${PACKAGE_NAME}&hl=en&gl=US`, {
            headers: { 'Cache-Control': 'no-cache' }
          });
          const text = await response.text();
          // Typical pattern in Play Store HTML
          const match = text.match(/\[\[\["([\d.]+)"\]/);
          if (match && match[1]) {
            latestVersion = match[1];
          }
        } catch (e) {
          console.log('Manual scrape error:', e);
        }
      }

      console.log('🔍 Current App Version:', currentVersion);
      console.log('🆕 Latest Store Version:', latestVersion);

      let isNeeded = false;
      if (currentVersion && latestVersion) {
        const v1 = currentVersion.split('.').map(Number);
        const v2 = latestVersion.split('.').map(Number);
        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
          const p1 = v1[i] || 0;
          const p2 = v2[i] || 0;
          if (p2 > p1) {
            isNeeded = true;
            break;
          }
          if (p1 > p2) {
            break;
          }
        }
      }

      console.log('📲 Update Needed:', isNeeded);

      if (isNeeded) {
        setIsVisible(true);
      }
    } catch (error) {
      console.log('❌ Error checking for update:', error);
    }
  };

  useEffect(() => {
    // Initial check on mount
    checkForUpdate();

    // Check when returning from background
    const subscription = AppState.addEventListener('change', nextState => {
      if (appState.match(/inactive|background/) && nextState === 'active') {
        checkForUpdate();
      }
      setAppState(nextState);
    });

    return () => subscription.remove();
  }, [appState]);

  return (
    <Modal
      isVisible={isVisible}
      onBackdropPress={() => setIsVisible(false)}
      onBackButtonPress={() => setIsVisible(false)}
      style={styles.modal}
      backdropOpacity={0.5}
      animationIn="slideInUp"
      animationOut="slideOutDown"
      useNativeDriver
      hideModalContentWhileAnimating
    >
      <View style={styles.container}>
        <View style={styles.dragHandle} />
        
        <View style={styles.iconContainer}>
          <Icon name="cellphone-arrow-down" size={48} color="#1a3a6b" />
        </View>

        <Text style={styles.title}>Update Available</Text>
        <Text style={styles.subtitle}>
          A new version of the app is available. Please update to continue and enjoy the latest features.
        </Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.laterButton} onPress={() => setIsVisible(false)}>
            <Text style={styles.laterText}>LATER</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.updateButton} onPress={openPlayStore}>
            <Text style={styles.updateText}>UPDATE NOW</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  container: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
    paddingBottom: 34,
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    marginBottom: 20,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    gap: 12,
  },
  laterButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  laterText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '700',
  },
  updateButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1a3a6b',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1a3a6b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  updateText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default UpdateModal;
