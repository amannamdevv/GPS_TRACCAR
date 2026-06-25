import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import Header from '../../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AuthContext } from '../../context/AuthContext';
import AlertService from '../../services/AlertNotificationService';

const SettingsScreen = ({ navigation }) => {
  const { userInfo, logout } = useContext(AuthContext);



  const [pushNotif, setPushNotif] = useState(true);
  const [geofenceNotif, setGeofenceNotif] = useState(true);

  const [bgAlerts, setBgAlerts] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem('user_settings');
        if (stored) {
          const parsed = JSON.parse(stored);

          if (parsed.pushNotif !== undefined) setPushNotif(parsed.pushNotif);
          if (parsed.geofenceNotif !== undefined) setGeofenceNotif(parsed.geofenceNotif);

          if (parsed.bgAlerts !== undefined) setBgAlerts(parsed.bgAlerts);

          // ✅ FIX: parsed value seedha use karo, state pe depend mat karo
          const shouldRunAlerts = parsed.bgAlerts !== false;
          const notifEnabled = parsed.pushNotif !== false;

          if (shouldRunAlerts && notifEnabled) {
            AlertService.start();
          } else {
            AlertService.stop();
          }
        } else {
          // Pehli baar app open — default mein start karo
          AlertService.start();
        }
      } catch (e) {
        console.warn('Failed to load settings', e);
        AlertService.start(); // error pe bhi start karo
        } finally {
          setIsLoading(false);
          // Ensure permission is requested and alerts always run
          (async () => {
            try {
              await notifee.requestPermission();
            } catch (e) {
              console.warn('Permission request failed', e);
            }
            AlertService.start();
          })();
        }
    };
    loadSettings();
  }, []);

  const saveSetting = async (key, value) => {
    try {
      const stored = await AsyncStorage.getItem('user_settings');
      let parsed = stored ? JSON.parse(stored) : {};
      parsed[key] = value;
      await AsyncStorage.setItem('user_settings', JSON.stringify(parsed));
    } catch (e) {
      console.warn('Failed to save setting', e);
    }
  };

  const handleToggle = async (key, value, setter) => {
    setter(value);
    saveSetting(key, value);

    if (key === 'pushNotif') {
      if (value === true) {
        try {
          await notifee.requestPermission();
          if (bgAlerts) {
            AlertService.start();
          }
        } catch (e) {
          console.warn('Failed to request permission or start service', e);
        }
      } else {
        AlertService.stop();
      }
    } else if (key === 'bgAlerts') {
      if (value === true) {
        AlertService.start();
      } else {
        AlertService.stop();
      }
    }
  };

  const SectionHeader = ({ title }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  const SettingRow = ({ icon, title, subtitle, rightElement }) => (
    <View style={styles.settingRow}>
      <Icon name={icon} size={24} color="#757575" style={styles.settingIcon} />
      <View style={styles.settingTextContainer}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {rightElement}
    </View>
  );

  const initials = userInfo?.name
    ? userInfo.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Settings" navigation={navigation} />

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Profile Card ── */}
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{userInfo?.name || 'User'}</Text>
            <Text style={styles.profileEmail}>{userInfo?.email || 'user@example.com'}</Text>

          </View>
        </View>

        <SectionHeader title="WEBSITE" />
        <View style={styles.card}>
          <TouchableOpacity onPress={() => Linking.openURL('https://gps.shrotitele.com/')}>
            <SettingRow
              icon="web"
              title="Website Link"
              subtitle="gps.shrotitele.com"
              rightElement={
                <View style={styles.statusBadge}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusText}>Connected</Text>
                </View>
              }
            />
          </TouchableOpacity>
        </View>


        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.card}>
          <SettingRow
            icon="bell-ring-outline"
            title="Push Notifications"
            rightElement={<Switch value={pushNotif} onValueChange={(val) => handleToggle('pushNotif', val, setPushNotif)} trackColor={{ true: '#1565C0', false: '#e2e8f0' }} thumbColor="#FFFFFF" />}
          />


        </View>

        <SectionHeader title="ABOUT" />
        <View style={styles.card}>
          <SettingRow
            icon="information-outline"
            title="App Version"
            rightElement={<Text style={styles.versionText}>1.0.0</Text>}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scroll: {
    padding: 16,
  },

  // ── Profile Card ──────────────────────────────────────────
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 2,
    borderColor: '#C7D2FE',
  },
  avatarText: {
    color: '#4338CA',
    fontSize: 22,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  profileEmail: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 5,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  // ─────────────────────────────────────────────────────────

  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 8,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  settingIcon: {
    marginRight: 16,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginLeft: 56,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '700',
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectorText: {
    color: '#64748b',
    marginRight: 4,
    fontWeight: '500',
  },
  versionText: {
    color: '#64748b',
    fontWeight: '600',
  },
});

export default SettingsScreen;