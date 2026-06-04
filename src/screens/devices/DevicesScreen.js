import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList } from '../../api/webApi';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DevicesScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  const [allDevices, setAllDevices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('All'); // 'All', 'Online', 'Offline'

  const fetchDevices = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchDeviceList();
      setAllDevices(data.devices || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch devices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    // Auto refresh removed to reduce server load
    // const interval = setInterval(() => {
    //   fetchDevices(true);
    // }, 10000);
    // return () => clearInterval(interval);
  }, [fetchDevices]);

  // Counts
  const onlineCount = useMemo(() => allDevices.filter(d => d.status === 'online').length, [allDevices]);
  const offlineCount = useMemo(() => allDevices.filter(d => d.status !== 'online').length, [allDevices]);

  // Filtering
  const displayedDevices = useMemo(() => {
    let list = allDevices;
    if (activeTab === 'Online') {
      list = allDevices.filter(d => d.status === 'online');
    } else if (activeTab === 'Offline') {
      list = allDevices.filter(d => d.status !== 'online');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.iccid || d.uniqueId || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allDevices, activeTab, searchQuery]);

  const renderTab = (title, count) => {
    const isActive = activeTab === title;
    return (
      <TouchableOpacity
        style={[styles.tab, isActive && styles.activeTab]}
        onPress={() => setActiveTab(title)}
        activeOpacity={0.7}
      >
        <Text style={[styles.tabText, isActive && styles.activeTabText]}>
          {title} ({count})
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Header
        title="Fleet Status"
        navigation={navigation}
        rightAction={
          <TouchableOpacity onPress={() => setShowSearch(!showSearch)} style={{ padding: 8 }}>
            <Icon name="magnify" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        }
      />

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {renderTab('All', allDevices.length)}
        {renderTab('Online', onlineCount)}
        {renderTab('Offline', offlineCount)}
      </View>

      {/* Search Bar */}
      {showSearch && (
        <View style={styles.searchBar}>
          <Icon name="magnify" size={22} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, IMEI..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94a3b8"
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={20} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Loading Overlay */}
      {loading && !refreshing && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
          <Text style={styles.loadingText}>Synchronizing fleet devices...</Text>
        </View>
      )}

      {/* Error */}
      {!loading && error && (
        <View style={styles.center}>
          <Icon name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchDevices()}>
            <Text style={styles.retryBtnText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Device List */}
      {!loading && !error && (
        <FlatList
          data={displayedDevices}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <DeviceCard
              device={item}
              onPress={() => navigation.navigate('DeviceDetail', { device: item })}
            />
          )}
          refreshing={refreshing}
          onRefresh={() => fetchDevices(true)}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="car-off" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No vehicles match the selected criteria</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  activeTabText: { color: '#1565C0', fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchInput: { flex: 1, height: '100%', color: '#0f172a', fontSize: 14, fontWeight: '500' },
  listContainer: { paddingVertical: 12, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, color: '#1565C0', fontWeight: '700', fontSize: 13 },
  errorText: { color: '#ef4444', fontSize: 14, marginTop: 12, textAlign: 'center', fontWeight: '600' },
  retryBtn: { marginTop: 16, backgroundColor: '#1565C0', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyText: { color: '#64748b', fontSize: 14, marginTop: 12, textAlign: 'center', fontWeight: '500' },
});

export default DevicesScreen;
