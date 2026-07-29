import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList, loginApi } from '../../api/webApi';
import { useFilter } from '../../context/FilterContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DevicesScreen = ({ navigation, route }) => {
  const { userToken, isLoading } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const { apiFilters } = useFilter();

  const [allDevices, setAllDevices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('All'); // 'All', 'Online', 'Offline'

  // ─── PAGINATION ─────────────────────────────────────────────────────────────
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const abortControllerRef = useRef(null);

  const fetchDevices = useCallback(async (isRefresh = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (isRefresh) {
      setRefreshing(true);
      setAllDevices([]); // Clear stale cache immediately when explicitly refreshing
    } else setLoading(true);
    setError(null);

    try {
      // If pull-to-refresh, silently fetch the latest user info to get any newly assigned device_ids
      if (isRefresh) {
        try {
          const email = await AsyncStorage.getItem('traccar_email');
          const pass = await AsyncStorage.getItem('traccar_pass');
          const server = await AsyncStorage.getItem('traccar_server') || '';
          if (email && pass) {
            const user = await loginApi(server, email, pass);
            const info = { ...user, server };
            await AsyncStorage.setItem('userInfo', JSON.stringify(info));
          }
        } catch (authErr) {
          console.warn('[DevicesScreen] Silent auth refresh failed', authErr);
        }
      }

      const data = await fetchDeviceList(apiFilters, signal);
      if (!signal.aborted) {
        setAllDevices(data.devices || []);
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err.message || 'Failed to fetch devices');
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiFilters]);

  useEffect(() => {
    if (!isLoading && userToken) {
      fetchDevices();
    }
    
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && userToken) {
        fetchDevices(true);
      }
    });

    return () => {
      subscription.remove();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isLoading, userToken, fetchDevices]);

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

    // Apply voltage filter if navigated from dashboard pie chart
    const voltageFilter = route?.params?.voltageFilter;
    if (voltageFilter) {
      list = list.filter(d => {
        let v = parseFloat(d.adc1 || d.adc1_voltage || "0");
        if (isNaN(v)) v = 0;
        
        if (voltageFilter === 'Danger') return v < 9.5;
        if (voltageFilter === 'Critical') return v >= 9.5 && v < 11.5;
        if (voltageFilter === 'Normal') return v >= 11.5;
        return true;
      });
    }

    return list;
  }, [allDevices, activeTab, searchQuery, route?.params?.voltageFilter]);

  // Reset pagination when filters or search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [displayedDevices]);

  const renderTab = (title, count) => {
    const isActive = activeTab === title;
    return (
      <TouchableOpacity
        style={[styles.tab, isActive && styles.activeTab]}
        onPress={() => {
          // If changing main tabs, clear the voltage filter so we see the proper list
          if (route?.params?.voltageFilter) {
            navigation.setParams({ voltageFilter: null });
          }
          setActiveTab(title);
        }}
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
        title="DG Status"
        navigation={navigation}
        showBack={true}
        onBackPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.navigate('DashboardTab');
          }
        }}
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

      {route?.params?.voltageFilter && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: '#64748b', marginRight: 8 }}>
            Filtered by Voltage: <Text style={{ fontWeight: '700', color: '#1e3a8a' }}>
              {route.params.voltageFilter}
              {route.params.voltageFilter === 'Danger' ? ' (0.0 - 9.4V)' : ''}
              {route.params.voltageFilter === 'Critical' ? ' (9.5V - 11.4V)' : ''}
              {route.params.voltageFilter === 'Normal' ? ' (>= 11.5V)' : ''}
            </Text>
          </Text>
          <TouchableOpacity onPress={() => navigation.setParams({ voltageFilter: null })}>
            <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: 'bold' }}>CLEAR</Text>
          </TouchableOpacity>
        </View>
      )}

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
          <Text style={styles.loadingText}>Synchronizing DG devices...</Text>
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
          data={displayedDevices.slice(0, visibleCount)}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <DeviceCard
              device={item}
              onPress={() => navigation.navigate('DeviceDetail', { device: item })}
            />
          )}
          refreshing={refreshing}
          onRefresh={() => { fetchDevices(true); setVisibleCount(PAGE_SIZE); }}
          onEndReached={() => {
            if (visibleCount < displayedDevices.length) {
              setVisibleCount(prev => Math.min(prev + PAGE_SIZE, displayedDevices.length));
            }
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            visibleCount < displayedDevices.length ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#1565C0" />
                <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Loading more...</Text>
              </View>
            ) : displayedDevices.length > 0 ? (
              <Text style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', paddingVertical: 14 }}>
                Showing {Math.min(visibleCount, displayedDevices.length)} of {displayedDevices.length} devices
              </Text>
            ) : null
          }
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="car-off" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No DG match the selected criteria</Text>
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
