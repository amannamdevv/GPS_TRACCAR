import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { reverseGeocode } from '../api/webApi';

const getSignalInfo = (rssiVal) => {
  if (rssiVal === undefined || rssiVal === null) {
    return { percentage: 0, bars: 0, icon: 'signal-cellular-outline', label: 'N/A' };
  }
  const val = parseFloat(rssiVal);
  if (isNaN(val) || val < 0) {
    return { percentage: 0, bars: 0, icon: 'signal-cellular-outline', label: '0%' };
  }

  let bars = 0;
  let percentage = 0;

  if (val <= 4) {
    bars = Math.round(val);
    percentage = bars * 25;
  } else {
    percentage = Math.min(100, Math.round((val / 31) * 100));
    if (percentage <= 25) bars = 1;
    else if (percentage <= 50) bars = 2;
    else if (percentage <= 75) bars = 3;
    else bars = 4;
  }

  bars = Math.max(0, Math.min(4, bars));
  let iconName = 'signal-cellular-outline';
  if (bars === 1) iconName = 'signal-cellular-1';
  else if (bars === 2) iconName = 'signal-cellular-2';
  else if (bars >= 3) iconName = 'signal-cellular-3';

  return { percentage, bars, icon: iconName, label: `${Math.round(val)} CSQ` };
};

const DeviceCard = ({ device, onPress }) => {
  const [address, setAddress] = useState('Loading address...');
  const signalInfo = getSignalInfo(device.rssi);

  const statusStr = String(device.status || '').toLowerCase();
  const isOnline = statusStr === 'online';

  const motionStr = String(device.motion_status || '').toLowerCase();
  const isMoving = motionStr === 'moving' || motionStr === 'true' || motionStr === '1' || device.motion_status === true;

  const dgStr = String(device.dg_status || '').toLowerCase();
  const isDgOn = dgStr === '1' || dgStr === 'on' || dgStr === 'true';

  const batteryStr = String(device.battery_status || '').toLowerCase();
  const isCharging = batteryStr === 'charging' || batteryStr === 'true' || batteryStr === '1' || device.battery_status === true;

  useEffect(() => {
    let active = true;
    const fetchAddress = async () => {
      if (device.address) {
        if (active) setAddress(device.address);
        return;
      }

      if (!device.motion_lat || !device.motion_lon || parseFloat(device.motion_lat) === 0) {
        if (active) setAddress('No location fix');
        return;
      }
      try {
        const addr = await reverseGeocode(device.motion_lat, device.motion_lon);
        if (active) setAddress(addr || 'Address not available');
      } catch (err) {
        if (active) setAddress('Address error');
      }
    };
    fetchAddress();
    return () => { active = false; };
  }, [device.motion_lat, device.motion_lon]);

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  // Determine status color theme
  let statusColor = '#ef4444'; // Red (offline)
  let statusLabel = 'Offline';
  if (isOnline) {
    if (isMoving) {
      statusColor = '#10b981'; // Green (moving)
      statusLabel = 'Moving';
    } else {
      statusColor = '#0284c7'; // Blue (stopped)
      statusLabel = 'Online';
    }
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardBody}>
        {/* Header Row: Vehicle Icon, Name, status label */}
        <View style={styles.headerRow}>
          <View style={[styles.avatarContainer, { backgroundColor: `${statusColor}15` }]}>
            <Icon name="car" size={26} color={statusColor} />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.deviceName} numberOfLines={1}>{device.name || 'Unknown Vehicle'}</Text>
            <Text style={styles.deviceId}>{device.iccid || device.uniqueId || 'No IMEI'}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Telemetry Row Grid */}
        <View style={styles.telemetryGrid}>
          <View style={styles.telItem}>
            <Icon name="lightning-bolt" size={16} color={isDgOn ? '#10b981' : '#64748b'} />
            <Text style={styles.telLabel}>DG:</Text>
            <Text style={[styles.telValue, { color: isDgOn ? '#10b981' : '#0f172a' }]}>{isDgOn ? 'ON' : 'OFF'}</Text>
          </View>

          <View style={styles.telItem}>
            <Icon name={isCharging ? "battery-charging" : "battery-std"} size={16} color="#0284c7" />
            <Text style={styles.telLabel}>Batt:</Text>
            <Text style={styles.telValue}>{device.battery_level ? `${device.battery_level}%` : 'N/A'}</Text>
          </View>

          <View style={styles.telItem}>
            <Icon name="signal" size={16} color="#64748b" />
            <Text style={styles.telValue}>{signalInfo.label}</Text>
          </View>
        </View>

        {/* Address & Date Footer */}
        <View style={styles.footer}>
          <View style={styles.addressRow}>
            <Icon name="map-marker-outline" size={15} color="#64748b" style={{ marginRight: 6 }} />
            <Text style={styles.addressText} numberOfLines={1}>{address}</Text>
          </View>
          <View style={styles.timeRow}>
            <Icon name="clock-outline" size={14} color="#94a3b8" style={{ marginRight: 4 }} />
            <Text style={styles.timeText}>{formatDate(device.position_time)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  cardBody: { padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatarContainer: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  titleContainer: { flex: 1 },
  deviceName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  deviceId: { fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  telemetryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  telItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  telLabel: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  telValue: { fontSize: 11, fontWeight: '700', color: '#0f172a' },
  footer: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addressRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  addressText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
});

export default DeviceCard;
