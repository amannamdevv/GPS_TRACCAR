import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, StatusBar } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';
import Header from '../../components/Header';
import { fetchAlarms, fetchCustomEvents, fetchDeviceList } from '../../api/webApi';
import AlertNotificationService from '../../services/AlertNotificationService';

const ALERT_MAPPING = {
  powerCut: 'Power Cut Detected',
  lowBattery: 'Low Battery Alert',
  vibration: 'Vibration Detected',
  ignitionOn: 'DG ON',
  ignitionOff: 'DG OFF',
  deviceMoving: 'DG Moving',
  deviceStopped: 'DG Stopped',
};

const getAlertConfig = (type) => {
  const t = type.toLowerCase();
  if (t.includes('dg') || t.includes('ignition')) {
    return { icon: 'key-variant', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.15)' };
  }
  if (t.includes('power')) {
    return { icon: 'power-plug-off', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
  }
  if (t.includes('battery')) {
    return { icon: 'battery-alert', color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' };
  }
  if (t.includes('vibration')) {
    return { icon: 'vibrate', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' };
  }
  if (t.includes('motion')) {
    return { icon: 'run', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
  }
  return { icon: 'bell-ring', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
};

const AlertsScreen = ({ navigation }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [alarmsRaw, customRaw, devicesData] = await Promise.all([
        fetchAlarms(),
        fetchCustomEvents(),
        fetchDeviceList(),
      ]);

      // Build a Set of device IDs that belong to the logged-in user
      const myDevices = Array.isArray(devicesData)
        ? devicesData
        : (devicesData?.devices || []);
      const myDeviceIds = new Set(
        myDevices.map(d => String(d.id ?? d.deviceid ?? '')).filter(Boolean)
      );

      let alarmsList = Array.isArray(alarmsRaw) ? alarmsRaw : (alarmsRaw?.data || []);
      let customList = Array.isArray(customRaw) ? customRaw : (customRaw?.data || []);

      // Filter alarms to only those belonging to user's devices
      alarmsList = alarmsList.filter(a =>
        myDeviceIds.has(String(a.deviceId ?? a.deviceid ?? ''))
      );

      // Normalize custom events
      const normalizedCustom = customList.map(e => {
        const lower = String(e.event_type || '').toLowerCase();
        let type = e.event_type;
        if (lower === 'ignitionon' || lower === 'ignition_on') type = 'ignitionOn';
        else if (lower === 'ignitionoff' || lower === 'ignition_off') type = 'ignitionOff';
        else if (lower === 'devicemoving' || lower.includes('moving')) type = 'deviceMoving';
        else if (lower === 'devicestopped' || lower.includes('stopped')) type = 'deviceStopped';

        return {
          id: e.event_id || Math.random().toString(),
          type: type,
          eventtime: e.event_time,
          deviceId: e.deviceid,
          address: e.address,
          latitude: parseFloat(e.latitude || e.lat) || 0,
          longitude: parseFloat(e.longitude || e.lon) || 0,
        };
      // Filter custom events to only those belonging to user's devices
      }).filter(e => myDeviceIds.has(String(e.deviceId ?? '')));

      let combined = [...alarmsList, ...normalizedCustom];

      // Filter today's alerts
      const todayStart = moment().startOf('day');
      const todayEnd = moment().endOf('day');
      combined = combined.filter(a => {
        const t = moment(a.eventtime || a.serverTime || a.created_at);
        return t.isValid() && t.isBetween(todayStart, todayEnd, null, '[]');
      });

      // Sort newest first by time
      combined.sort((a, b) => {
        const timeA = moment(a.eventtime || a.serverTime || a.created_at).valueOf();
        const timeB = moment(b.eventtime || b.serverTime || b.created_at).valueOf();
        return timeB - timeA;
      });

      setAlerts(combined);
    } catch (error) {
      console.warn('Failed to load alerts', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto refresh removed to reduce server load
    // const interval = setInterval(() => {
    //   loadData(false);
    // }, 60000); // refresh every minute
    // return () => clearInterval(interval);
  }, [loadData]);

  const renderItem = ({ item }) => {
    const rawType = item.type || '';
    const cleanType = rawType.split(',')[0].trim();
    const displayName = ALERT_MAPPING[cleanType] || cleanType;
    const config = getAlertConfig(cleanType);
    const timeFormatted = moment(item.eventtime || item.serverTime).format('hh:mm A');
    const dateFormatted = moment(item.eventtime || item.serverTime).format('MMM DD, YYYY');
    const deviceName = AlertNotificationService._getDeviceName(item.deviceid || item.deviceId);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('AlertDetails', { alert: item })}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.bg }]}>
          <Icon name={config.icon} size={24} color={config.color} />
        </View>
        <View style={styles.contentContainer}>
          <Text style={styles.alertName}>{displayName}</Text>
          <Text style={styles.deviceText}>{deviceName}</Text>
          <View style={styles.timeBadge}>
            <Icon name="clock-outline" size={12} color="#94a3b8" style={{ marginRight: 4 }} />
            <Text style={styles.timeText}>{dateFormatted} at {timeFormatted}</Text>
          </View>
        </View>
        <Icon name="chevron-right" size={20} color="#64748b" style={{ alignSelf: 'center' }} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <Header title="Security Alerts" navigation={navigation} />
      
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#38bdf8" />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={['#38bdf8']}
              tintColor="#38bdf8"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="bell-outline" size={54} color="#475569" />
              <Text style={styles.emptyText}>No alerts triggered today</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Premium dark background
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#1e293b', // Lighter dark card background
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  alertName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 3,
  },
  deviceText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
    marginBottom: 6,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  emptyText: {
    marginTop: 14,
    fontSize: 15,
    color: '#64748b',
    fontWeight: '600',
  },
});

export default AlertsScreen;
