import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import Header from '../../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AuthContext } from '../../context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MeScreen = ({ navigation }) => {
  const { userInfo, logout } = useContext(AuthContext);
  const insets = useSafeAreaInsets();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: () => logout() }
      ]
    );
  };

  const menuGroups = [
    {
      title: 'Activity & Reporting',
      items: [
        { name: 'Dashboard', icon: 'view-dashboard', color: '#1565C0', route: 'Dashboard', desc: 'Real-time vehicle status & charts' },
        { name: 'Reports', icon: 'chart-bar', color: '#10b981', route: 'Reports', desc: 'Summary, route, stops, events logs' },
        { name: 'DG Alarm Dashboard', icon: 'bell-alert-outline', color: '#ef4444', route: 'AlarmDashboard', desc: 'DG industrial alarm tracking' },
      ]
    },
    {
      title: 'Preferences',
      items: [
        { name: 'Settings', icon: 'cog-outline', color: '#64748b', route: 'Settings', desc: 'Distance units, alerts, preferences' },
      ]
    }
  ];

  return (
    <View style={styles.container}>
      <Header title="My Profile" navigation={navigation} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {userInfo?.name ? userInfo.name.charAt(0).toUpperCase() : 'U'}
            </Text>
          </View>
          <View style={styles.profileMeta}>
            <Text style={styles.profileName}>{userInfo?.name || 'User'}</Text>
            <Text style={styles.profileEmail}>{userInfo?.email || 'user@example.com'}</Text>
          </View>
        </View>

        {/* Menu Groups */}
        {menuGroups.map((group, gIdx) => (
          <View key={gIdx} style={styles.groupContainer}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.card}>
              {group.items.map((item, idx) => (
                <View key={idx}>
                  <TouchableOpacity
                    style={styles.itemRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate(item.route)}
                  >
                    <View style={[styles.itemIconContainer, { backgroundColor: `${item.color}15` }]}>
                      <Icon name={item.icon} size={22} color={item.color} />
                    </View>
                    <View style={styles.itemTextContainer}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemDesc}>{item.desc}</Text>
                    </View>
                    <Icon name="chevron-right" size={20} color="#cbd5e1" />
                  </TouchableOpacity>
                  {idx < group.items.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.8} onPress={handleLogout}>
          <Icon name="logout" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.logoutBtnText}>LOGOUT</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1565C0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: { fontSize: 26, fontWeight: '800', color: '#FFFFFF' },
  profileMeta: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  profileEmail: { fontSize: 13, color: '#64748b', marginTop: 4 },
  groupContainer: { marginBottom: 20 },
  groupTitle: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  itemIconContainer: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  itemTextContainer: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  itemDesc: { fontSize: 12, color: '#64748b', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginLeft: 72 },
  logoutBtn: {
    flexDirection: 'row',
    backgroundColor: '#ef4444',
    paddingVertical: 14,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    elevation: 3,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  logoutBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, letterSpacing: 0.8 },
});

export default MeScreen;
