import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';
import Header from '../../components/Header';
import { fetchAlarms } from '../../api/webApi';
import AlertNotificationService from '../../services/AlertNotificationService';

const ALERT_MAPPING = {
  powerCut: 'Power Cut Detected',
  lowBattery: 'Low Battery Alert',
  vibration: 'Vibration Detected',
  ignitionOn: 'DG ON',
  ignitionOff: 'DG OFF',
  motionStart: 'Motion Started',
  motionStop: 'Motion Stopped',
};

const getAlertIcon = (type) => {
  const t = type.toLowerCase();
  if (t.includes('dg') || t.includes('ignition')) return 'key-variant';
  if (t.includes('power')) return 'power-plug-off';
  if (t.includes('battery')) return 'battery-alert';
  if (t.includes('vibration')) return 'vibrate';
  if (t.includes('motion')) return 'run';
  return 'bell-ring';
};

const AlertsScreen = ({ navigation }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchAlarms();
      let alertsList = Array.isArray(data) ? data : (data?.data || []);
      
      // Only keep today's alerts
      const todayStart = moment().startOf('day');
      const todayEnd = moment().endOf('day');
      alertsList = alertsList.filter(a => {
        const t = moment(a.eventtime || a.serverTime || a.created_at);
        return t.isValid() && t.isBetween(todayStart, todayEnd, null, '[]');
      });

      // Sort newest first
      alertsList = [...alertsList].sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
      setAlerts(alertsList);
    } catch (error) {
      console.warn('Failed to load alerts', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto refresh every 2 minutes while on this screen
    const interval = setInterval(() => {
      loadData(false);
    }, 120000);
    return () => clearInterval(interval);
  }, [loadData]);

  const renderItem = ({ item }) => {
    const rawType = item.type || '';
    const cleanType = rawType.split(',')[0].trim();
    const displayName = ALERT_MAPPING[cleanType] || cleanType;
    const iconName = getAlertIcon(cleanType);
    const timeFormatted = moment(item.eventtime || item.serverTime).format('MMM DD, YYYY hh:mm A');
    const deviceName = AlertNotificationService._getDeviceName(item.deviceid || item.deviceId);

    return (
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          <Icon name={iconName} size={28} color="#ef4444" />
        </View>
        <View style={styles.contentContainer}>
          <Text style={styles.alertName}>{displayName}</Text>
          <Text style={styles.deviceText}>{deviceName}</Text>
          <Text style={styles.timeText}>{timeFormatted}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Current Alerts" navigation={navigation} />
      
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} colors={['#1565C0']} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="bell-off-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No alerts found</Text>
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
    backgroundColor: '#f8fafc',
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
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#fee2e2',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  alertName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  deviceText: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
  },
});

export default AlertsScreen;
