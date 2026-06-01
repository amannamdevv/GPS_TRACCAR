import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList } from '../../api/webApi';

const DevicesScreen = ({ navigation }) => {
  const [allDevices, setAllDevices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('All'); // 'All', 'Online', 'Offline'

  // ─── FETCH ────────────────────────────────────────────────────────────────
  const fetchDevices = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchDeviceList();
      const mapped = (data.devices || []).map((device) => {
        return {
          id:             device.id,
          name:           device.name || 'Unknown Device',
          iccid:          device.iccid || 'N/A',
          status:         device.status || 'unknown',
          position_time:  device.position_time,
          battery_level:  device.battery_level,
          motion_status:  device.motion_status,
          dg_status:      device.dg_status,
          battery_status: device.battery_status,
          motion_lat:     device.motion_lat,
          motion_lon:     device.motion_lon,
          rssi:           device.rssi,
          alarm:          device.alarm,
        };
      });
      setAllDevices(mapped);
    } catch (err) {
      setError(err.message || 'Failed to fetch devices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // ─── FILTER ───────────────────────────────────────────────────────────────
  const onlineCount = allDevices.filter((d) => d.status === 'online').length;
  const offlineCount = allDevices.filter((d) => d.status === 'offline').length;
  
  let displayedDevices = allDevices;
  if (activeTab === 'Online') {
    displayedDevices = allDevices.filter(d => d.status === 'online');
  } else if (activeTab === 'Offline') {
    displayedDevices = allDevices.filter(d => d.status === 'offline');
  }

  if (searchQuery) {
    displayedDevices = displayedDevices.filter((device) =>
      device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (device.iccid || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  // ─── RENDER TABS ──────────────────────────────────────────────────────────
  const renderTab = (title, count) => {
    const isActive = activeTab === title;
    return (
      <TouchableOpacity 
        style={[styles.tab, isActive && styles.activeTab]} 
        onPress={() => setActiveTab(title)}
      >
        <Text style={[styles.tabText, isActive && styles.activeTabText]}>
          {title}[{count}]
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Header 
        title={`Device List(${allDevices.length})`} 
        navigation={navigation} 
        rightAction={
          <TouchableOpacity onPress={() => setShowSearch(!showSearch)} style={{ padding: 8 }}>
            <Icon name="search" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        }
      />

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {renderTab('All', allDevices.length)}
        {renderTab('Online', onlineCount)}
        {renderTab('Offline', offlineCount)}
      </View>

      {/* Search bar */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color="#757575" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, IMEI..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#AAAAAA"
            autoFocus
          />
          {searchQuery.length > 0 && (
            <Icon
              name="close"
              size={20}
              color="#757575"
              onPress={() => setSearchQuery('')}
            />
          )}
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF9800" />
        </View>
      )}

      {/* Error */}
      {!loading && error && (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color="#F44336" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchDevices()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Device list */}
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
        />
      )}
    </View>
  );
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#FF9800', // Protrack orange indicator
  },
  tabText: {
    fontSize: 14,
    color: '#757575',
  },
  activeTabText: {
    color: '#FF9800',
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: '#212121',
    fontSize: 15,
    padding: 0,
  },
  listContainer: {
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    color: '#F44336',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: '#FF9800',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});

export default DevicesScreen;
