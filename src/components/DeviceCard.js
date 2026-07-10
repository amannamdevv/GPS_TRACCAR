import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { reverseGeocode } from '../api/webApi';

const getSignalInfo = (rssiVal) => {
  const val = parseInt(rssiVal);
  if (isNaN(val) || val <= 0) {
    return { icon: 'signal-off', color: '#ef4444' };
  }
  let bars = Math.max(0, Math.min(4, val));
  let iconName = 'network-strength-outline';
  if (bars === 1) iconName = 'network-strength-1';
  else if (bars === 2) iconName = 'network-strength-2';
  else if (bars === 3) iconName = 'network-strength-3';
  else if (bars >= 4) iconName = 'network-strength-4';
  return { icon: iconName, color: '#10b981' };
};

const getBatteryInfo = (level, isCharging) => {
  const pct = parseInt(level) || 0;
  if (pct === 0) return { name: 'battery-unknown', color: '#ef4444' }; // ? icon for 0%
  
  let color = pct <= 20 ? '#ef4444' : pct <= 50 ? '#f59e0b' : '#10b981';
  let iconName = 'battery';
  
  const rounded = Math.round(pct / 10) * 10;
  if (rounded === 0) iconName = 'battery-outline';
  else if (rounded < 100) iconName = `battery-${rounded}`;
  
  if (isCharging) {
    if (rounded === 0) iconName = 'battery-charging-outline';
    else if (rounded < 100) iconName = `battery-charging-${rounded}`;
    else iconName = 'battery-charging-100';
  }
  
  return { name: iconName, color };
};

const DeviceCard = ({ device, onPress }) => {
  const [address, setAddress] = useState('Loading address...');
  const signalInfo = getSignalInfo(device.rssi);
  const statusStr = String(device.status || '').toLowerCase();
  const isOnline = statusStr === 'online';
  const isMoving = device.motion_status === 1 || device.motion_status === '1' || device.motion_status === true;
  const isDgOn = device.dg_status === 1 || device.dg_status === '1' || device.dg_status === true;
  const isCharging = device.battery_status === 1 || device.battery_status === '1' || device.battery_status === true;
  const battInfo = getBatteryInfo(device.battery_level, isCharging);

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
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const formatDurationMins = (mins) => {
    if (mins < 1) return 'just now';
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    
    return parts.join(' ');
  };

  // Calculate ignition duration (ON)
  const getIgnitionDuration = () => {
    if (!device.ignition_on_time) return null;
    const mins = Math.round((Date.now() - new Date(device.ignition_on_time).getTime()) / 60000);
    return formatDurationMins(mins);
  };

  // Calculate ignition OFF duration
  const getIgnitionOffDuration = () => {
    if (!device.ignition_off_time) return null;
    const mins = Math.round((Date.now() - new Date(device.ignition_off_time).getTime()) / 60000);
    return formatDurationMins(mins);
  };

  const ignitionDuration = getIgnitionDuration();
  const ignitionOffDuration = getIgnitionOffDuration();
  const showIgnitionTime = isDgOn && device.ignition_status === 1 && ignitionDuration;

  // Status colors
  let statusColor = '#ef4444';
  let statusLabel = 'Offline';
  if (isOnline) {
    statusColor = '#10b981';
    statusLabel = 'Online';
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardBody}>
        {/* Header Row */}
        <View style={styles.headerRow}>
          <View style={[styles.avatarContainer, { backgroundColor: `${statusColor}15` }]}>
            <Icon name="car" size={26} color={statusColor} />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {device.name || 'Unknown Vehicle'}
            </Text>
            <Text style={styles.deviceId}>
              {device.uniqueId || device.uniqueid || 'No IMEI'}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Telemetry Grid - Improved Layout */}
        <View style={styles.telemetryGrid}>
          {/* DG Status + Ignition Time (next to each other) */}
          <View style={styles.telItem}>
            <Icon
              name="lightning-bolt"
              size={17}
              color={isDgOn ? '#10b981' : '#ef4444'}
            />
            <Text style={styles.telLabel}>DG:</Text>
            <Text style={styles.telValue}>
              {isDgOn ? 'ON' : 'OFF'}
            </Text>

            {/* Ignition Time right next to DG ON/OFF */}
            {showIgnitionTime && (
              <View style={styles.ignitionTimeContainer}>
                <Icon name="clock-outline" size={13} color="#10b981" />
                <Text style={styles.ignitionTimeText}>{ignitionDuration} ago</Text>
              </View>
            )}

            {!isDgOn && ignitionOffDuration && (
              <View style={styles.ignitionTimeContainer}>
                <Icon name="clock-outline" size={13} color="#ef4444" />
                <Text style={[styles.ignitionTimeText, { color: '#ef4444' }]}>{ignitionOffDuration} ago</Text>
              </View>
            )}
          </View>

          {/* Industry ID */}
          <View style={styles.telItem}>
            <Icon name="factory" size={17} color="#64748b" />
            <Text style={styles.telLabel}>Site id:</Text>
            <Text style={styles.telValue}>{device.nearest_indus_id || 'N/A'}</Text>
          </View>
          {/* Moving Status */}
          <View style={styles.telItem}>
            <Icon
              name="run"
              size={17}
              color={isMoving ? '#3b82f6' : '#f59e0b'}
            />
            <Text style={styles.telValue}>
              {isMoving ? 'Moving' : 'Stopped'}
            </Text>
          </View>

          {/* Battery */}
          <View style={styles.telItem}>
            <Icon
              name={battInfo.name}
              size={17}
              color={battInfo.color}
            />
            <Text style={styles.telLabel}>Batt:</Text>
            <Text style={styles.telValue}>
              {device.battery_level != null ? `${parseInt(device.battery_level)}%` : '0%'}
            </Text>
          </View>

          {/* Voltage - Clean placement */}
          <View style={styles.telItem}>
            <Icon
              name="flash"
              size={17}
              color={device.adc1 != null ? (parseFloat(device.adc1) > 0 ? '#f59e0b' : '#ef4444') : '#64748b'}
            />

            <Text style={styles.telLabel}>Ext. Batt:</Text>

            <Text style={styles.telValue}>
              {device.adc1 != null ? `${parseFloat(device.adc1).toFixed(2)}V` : 'N/A'}
            </Text>
          </View>

          {/* Signal Strength */}
          <View style={styles.telItem}>
            <Icon name={signalInfo.icon} size={18} color={signalInfo.color} />
            <Text style={styles.telValue}>Signal</Text>
          </View>
        </View>

        {/* Address & Time Footer */}
        <View style={styles.footer}>
          <View style={styles.addressRow}>
            <Icon name="map-marker-outline" size={15} color="#64748b" style={{ marginRight: 6 }} />
            <Text style={styles.addressText} numberOfLines={1}>{address}</Text>
          </View>
          <View style={styles.timeRow}>
            <Icon name="clock-outline" size={14} color="#64748b" style={{ marginRight: 4 }} />
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
  cardBody: {
    padding: 14
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  titleContainer: { flex: 1 },
  deviceName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a'
  },
  deviceId: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'monospace'
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  telItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  telLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500'
  },
  telValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a'
  },
  ignitionTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 6,
    gap: 3,
  },
  ignitionTimeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10
  },
  addressText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500'
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  timeText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600'
  },
});

export default DeviceCard;