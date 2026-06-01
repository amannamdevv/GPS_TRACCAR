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

  // If rssi is in 0-4 range
  if (val <= 4) {
    bars = Math.round(val);
    percentage = bars * 25;
  } else {
    // CSQ standard: 0 to 31
    percentage = Math.min(100, Math.round((val / 31) * 100));
    if (percentage <= 25) {
      bars = 1;
    } else if (percentage <= 50) {
      bars = 2;
    } else if (percentage <= 75) {
      bars = 3;
    } else {
      bars = 4;
    }
  }

  // Clip bars to 0-4
  bars = Math.max(0, Math.min(4, bars));

  // Choose beautiful icon
  let iconName = 'signal-cellular-outline';
  if (bars === 1) iconName = 'signal-cellular-1';
  else if (bars === 2) iconName = 'signal-cellular-2';
  else if (bars >= 3) iconName = 'signal-cellular-3'; // Material icons cellular maxes at 3 / full

  const labelText = val <= 4 ? `${bars} CSQ` : `${Math.round(val)} CSQ`;

  return {
    percentage,
    bars,
    icon: iconName,
    label: labelText
  };
};

const DeviceCard = ({ device, onPress }) => {
  const [address, setAddress] = useState('Loading...');
  const signalInfo = getSignalInfo(device.rssi);

  const statusStr = device.status !== undefined && device.status !== null ? String(device.status).toLowerCase() : '';
  const isOnline = statusStr === 'online';

  const motionStr = device.motion_status !== undefined && device.motion_status !== null ? String(device.motion_status).toLowerCase() : '';
  const isMoving = motionStr === 'moving' || motionStr === 'true' || motionStr === '1' || device.motion_status === true;

  const dgStr = device.dg_status !== undefined && device.dg_status !== null ? String(device.dg_status).toLowerCase() : '';
  const isDgOn = dgStr === '1' || dgStr === 'on' || dgStr === 'true';

  const batteryStr = device.battery_status !== undefined && device.battery_status !== null ? String(device.battery_status).toLowerCase() : '';
  const isCharging = batteryStr === 'charging' || batteryStr === 'true' || batteryStr === '1' || device.battery_status === true;

  useEffect(() => {
    let active = true;
    const fetchAddress = async () => {
      if (!device.motion_lat || !device.motion_lon || parseFloat(device.motion_lat) === 0) {
        if (active) setAddress('No Location');
        return;
      }
      try {
        const addr = await reverseGeocode(device.motion_lat, device.motion_lon);
        if (active) setAddress(addr || 'Address Not Found');
      } catch (err) {
        if (active) setAddress('Error loading address');
      }
    };
    fetchAddress();
    return () => {
      active = false;
    };
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

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Accent strip based on online status */}
      <View style={[styles.accentStrip, isOnline ? styles.accentOnline : styles.accentOffline]} />

      <View style={styles.cardBody}>
        {/* Top Section: Name & Status */}
        <View style={styles.headerRow}>
          <View style={styles.titleContainer}>
            <Text style={styles.deviceName} numberOfLines={1}>{device.name || 'Unknown Device'}</Text>
            <Text style={styles.deviceId}>{device.iccid || device.uniqueId || 'No IMEI'}</Text>
          </View>
          <View style={[styles.statusPill, isOnline ? styles.statusPillOnline : styles.statusPillOffline]}>
            <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
            <Text style={[styles.statusText, isOnline ? styles.statusTextOnline : styles.statusTextOffline]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Data Grid Section (Extremely Rich Icons, Less Text) */}
        <View style={styles.gridContainer}>
          {/* Row 1: Last Update & Battery */}
          <View style={styles.gridRow}>
            <View style={styles.gridItem}>
              <View style={styles.iconBox}>
                <Icon name="clock-outline" size={16} color="#64748b" />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>Last Update</Text>
                <Text style={styles.itemValue}>{formatDate(device.position_time)}</Text>
              </View>
            </View>

            <View style={styles.gridItem}>
              <View style={styles.iconBox}>
                <Icon
                  name={isCharging ? "battery-charging" : "battery-std"}
                  size={16}
                  color={isCharging ? "#10b981" : "#0284c7"}
                />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>Battery</Text>
                <Text style={styles.itemValue}>{device.battery_level ? `${device.battery_level}%` : 'N/A'}</Text>
              </View>
            </View>
          </View>

          {/* Row 2: Motion & DG Status */}
          <View style={styles.gridRow}>
            <View style={styles.gridItem}>
              <View style={styles.iconBox}>
                <Icon
                  name={isMoving ? "run" : "car-brake-park"}
                  size={16}
                  color={isMoving ? "#f59e0b" : "#64748b"}
                />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>Motion</Text>
                <View style={[styles.valueBadge, isMoving ? styles.badgeMoving : styles.badgeStopped]}>
                  <Text style={[styles.badgeText, isMoving ? styles.badgeTextMoving : styles.badgeTextStopped]}>
                    {isMoving ? 'Moving' : 'Stopped'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.gridItem}>
              <View style={styles.iconBox}>
                <Icon
                  name="lightning-bolt"
                  size={16}
                  color={isDgOn ? "#10b981" : "#ef4444"}
                />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>DG Status</Text>
                <View style={[styles.valueBadge, isDgOn ? styles.badgeOn : styles.badgeOff]}>
                  <Text style={[styles.badgeText, isDgOn ? styles.badgeTextOn : styles.badgeTextOff]}>
                    {isDgOn ? 'ON' : 'OFF'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Row 3: Charging & RSSI */}
          <View style={styles.gridRow}>
            <View style={styles.gridItem}>
              <View style={styles.iconBox}>
                <Icon
                  name="power-plug"
                  size={16}
                  color={isCharging ? "#10b981" : "#64748b"}
                />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>Charging</Text>
                <Text style={styles.itemValue}>{isCharging ? 'Charging' : 'Discharging'}</Text>
              </View>
            </View>

            <View style={styles.gridItem}>
              <View style={[styles.iconBox, { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, paddingBottom: 6.5 }]}>
                <View style={{ width: 3, height: 5, borderRadius: 0.5, backgroundColor: signalInfo.bars >= 1 ? '#0284c7' : '#cbd5e1' }} />
                <View style={{ width: 3, height: 8, borderRadius: 0.5, backgroundColor: signalInfo.bars >= 2 ? '#0284c7' : '#cbd5e1' }} />
                <View style={{ width: 3, height: 11, borderRadius: 0.5, backgroundColor: signalInfo.bars >= 3 ? '#0284c7' : '#cbd5e1' }} />
                <View style={{ width: 3, height: 14, borderRadius: 0.5, backgroundColor: signalInfo.bars >= 4 ? '#0284c7' : '#cbd5e1' }} />
              </View>
              <View style={styles.itemMeta}>
                <Text style={styles.itemLabel}>Signal (RSSI)</Text>
                <Text style={styles.itemValue}>{signalInfo.label}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Address Footer Row */}
        <View style={styles.addressRow}>
          <Icon name="map-marker-outline" size={16} color="#10b981" style={styles.addressIcon} />
          <Text style={styles.addressText}>
            {address}
          </Text>
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
    marginVertical: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  accentStrip: {
    height: 4,
  },
  accentOnline: {
    backgroundColor: '#10b981',
  },
  accentOffline: {
    backgroundColor: '#ef4444',
  },
  cardBody: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleContainer: {
    flex: 1,
    marginRight: 10,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  deviceId: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#94a3b8',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusPillOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusPillOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusDotOnline: {
    backgroundColor: '#10b981',
  },
  statusDotOffline: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusTextOnline: {
    color: '#10b981',
  },
  statusTextOffline: {
    color: '#ef4444',
  },
  gridContainer: {
    gap: 12,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  itemMeta: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 1,
  },
  itemValue: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
  },
  valueBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    borderWidth: 0.5,
  },
  badgeMoving: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  badgeStopped: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  badgeOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgeOff: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgeTextMoving: {
    color: '#d97706',
  },
  badgeTextStopped: {
    color: '#64748b',
  },
  badgeTextOn: {
    color: '#10b981',
  },
  badgeTextOff: {
    color: '#ef4444',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  addressIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  addressText: {
    flex: 1,
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
    lineHeight: 18,
  },
});

export default DeviceCard;
