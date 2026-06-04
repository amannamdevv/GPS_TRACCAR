import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Linking } from 'react-native';
import Header from '../../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AuthContext } from '../../context/AuthContext';

const SettingsScreen = ({ navigation }) => {
  const { userInfo, logout } = useContext(AuthContext);
  
  const [distanceUnit, setDistanceUnit] = useState(false); // false = km, true = miles
  const [speedUnit, setSpeedUnit] = useState(false); // false = km/h, true = mph
  const [timeFormat, setTimeFormat] = useState(false); // false = 24h, true = 12h
  const [darkMode, setDarkMode] = useState(false);
  const [pushNotif, setPushNotif] = useState(true);
  const [geofenceNotif, setGeofenceNotif] = useState(true);
  const [speedNotif, setSpeedNotif] = useState(true);

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

  return (
    <View style={styles.container}>
      <Header title="Settings" navigation={navigation} />
      
      <ScrollView>
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {userInfo?.name ? userInfo.name.charAt(0) : 'U'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{userInfo?.name || 'User'}</Text>
            <Text style={styles.profileEmail}>{userInfo?.email || 'user@example.com'}</Text>
          </View>
          <TouchableOpacity style={styles.editBtn}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <SectionHeader title="WEBSITE" />
        <View style={styles.card}>
          <TouchableOpacity onPress={() => Linking.openURL('http://gps.shrotitele.com/')}>
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

        <SectionHeader title="PREFERENCES" />
        <View style={styles.card}>
          <SettingRow 
            icon="map-marker-distance" 
            title="Distance Unit" 
            subtitle={distanceUnit ? "Miles" : "Kilometers"}
            rightElement={<Switch value={distanceUnit} onValueChange={setDistanceUnit} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="speedometer" 
            title="Speed Unit" 
            subtitle={speedUnit ? "mph" : "km/h"}
            rightElement={<Switch value={speedUnit} onValueChange={setSpeedUnit} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="clock-outline" 
            title="Time Format" 
            subtitle={timeFormat ? "12 Hour" : "24 Hour"}
            rightElement={<Switch value={timeFormat} onValueChange={setTimeFormat} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="theme-light-dark" 
            title="Dark Mode" 
            rightElement={<Switch value={darkMode} onValueChange={setDarkMode} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="translate" 
            title="Language" 
            rightElement={
              <View style={styles.selectorRow}>
                <Text style={styles.selectorText}>English</Text>
                <Icon name="chevron-right" size={20} color="#757575" />
              </View>
            }
          />
        </View>

        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.card}>
          <SettingRow 
            icon="bell-ring-outline" 
            title="Push Notifications" 
            rightElement={<Switch value={pushNotif} onValueChange={setPushNotif} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="vector-polygon" 
            title="Geofence Alerts" 
            rightElement={<Switch value={geofenceNotif} onValueChange={setGeofenceNotif} />}
          />
          <View style={styles.divider} />
          <SettingRow 
            icon="speedometer" 
            title="Speed Alerts" 
            rightElement={<Switch value={speedNotif} onValueChange={setSpeedNotif} />}
          />
        </View>

        <SectionHeader title="ABOUT" />
        <View style={styles.card}>
          <SettingRow 
            icon="information-outline" 
            title="App Version" 
            rightElement={<Text style={styles.versionText}>1.0.0</Text>}
          />
          <View style={styles.divider} />
          <TouchableOpacity>
            <SettingRow 
              icon="star-outline" 
              title="Rate App" 
              rightElement={<Icon name="chevron-right" size={20} color="#757575" />}
            />
          </TouchableOpacity>
        </View>


        
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
    marginBottom: 8,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1565C0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
  },
  profileEmail: {
    fontSize: 14,
    color: '#757575',
    marginTop: 4,
  },
  editBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#E3F2FD',
    borderRadius: 20,
  },
  editBtnText: {
    color: '#1565C0',
    fontWeight: 'bold',
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#757575',
    marginLeft: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EEEEEE',
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
    fontSize: 16,
    color: '#212121',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#757575',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#EEEEEE',
    marginLeft: 56,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginRight: 6,
  },
  statusText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: 'bold',
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectorText: {
    color: '#757575',
    marginRight: 4,
  },
  versionText: {
    color: '#757575',
  },
  logoutBtn: {
    flexDirection: 'row',
    backgroundColor: '#F44336',
    marginHorizontal: 16,
    marginTop: 30,
    paddingVertical: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 1,
  },
});

export default SettingsScreen;
