import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import moment from 'moment';

const DetailsInfoScreen = ({ route, navigation }) => {
  const { device } = route.params;

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return moment(dateString).format('DD MMM YYYY, hh:mm A');
  };

  const handleShare = async () => {
    try {
      const shareText = `
Device Details:
Name: ${device.name}
IMEI/ICCID: ${device.iccid || device.uniqueId}
Status: ${device.status}
Lat/Lon: ${device.motion_lat}, ${device.motion_lon}
Speed: ${device.speedKmh || 0} km/h
Last Update: ${formatDate(device.position_time)}
      `.trim();
      await Share.share({ message: shareText });
    } catch (e) {
      console.warn(e);
    }
  };

  const attr = device.attributes || {};
  const isOnline = device.status === 'online';

  const items = [
    { category: 'Device Identity', rows: [
      { label: 'Device Name', value: device.name, icon: 'tag-outline' },
      { label: 'IMEI / ICCID', value: device.iccid || device.uniqueId || 'N/A', icon: 'barcode-scan' },
      { label: 'Device ID', value: String(device.id), icon: 'identifier' },
      { label: 'SIM Card Phone', value: device.phone || 'N/A', icon: 'sim' },
      { label: 'Model', value: device.model || 'N/A', icon: 'cellphone' },
    ]},
    { category: 'Current Status', rows: [
      { label: 'Connection Status', value: isOnline ? 'Online' : 'Offline', icon: 'connection', color: isOnline ? '#10b981' : '#ef4444' },
      { label: 'Speed', value: `${device.speedKmh || 0} km/h`, icon: 'speedometer' },
      { label: 'Motion', value: device.motion_status === 'moving' || device.motion_status === true || (device.speedKmh || 0) > 2 ? 'Moving' : 'Stopped', icon: 'run' },
      { label: 'Engine Ignition', value: device.ignition_status === 1 || device.ignition_status === '1' || device.ignition_status === true ? 'ON' : 'OFF', icon: 'key' },
    ]},
    { category: 'Sensor & Power Attributes', rows: [
      { label: 'Battery Level', value: device.battery_level ? `${device.battery_level}%` : 'N/A', icon: 'battery' },
      { label: 'DG Status', value: device.dg_status === 1 || device.dg_status === '1' ? 'ON' : 'OFF', icon: 'lightning-bolt' },
      { label: 'Charging State', value: device.battery_status === 'charging' || device.battery_status === true ? 'Charging' : 'Discharging', icon: 'power-plug' },
      { label: 'GSM Signal (RSSI)', value: device.rssi ? `${device.rssi} / 31` : 'N/A', icon: 'signal' },
    ]},
    { category: 'Location Telemetry', rows: [
      { label: 'Latitude', value: device.motion_lat ? parseFloat(device.motion_lat).toFixed(6) : 'N/A', icon: 'latitude' },
      { label: 'Longitude', value: device.motion_lon ? parseFloat(device.motion_lon).toFixed(6) : 'N/A', icon: 'longitude' },
      { label: 'Last Position Time', value: formatDate(device.position_time), icon: 'clock' },
    ]}
  ];

  return (
    <View style={styles.container}>
      <Header
        title="Device Information"
        navigation={navigation}
        showBack
        rightAction={
          <TouchableOpacity onPress={handleShare} style={{ padding: 8 }}>
            <Icon name="share-variant" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {items.map((sec, idx) => (
          <View key={idx} style={styles.section}>
            <Text style={styles.sectionHeader}>{sec.category}</Text>
            <View style={styles.card}>
              {sec.rows.map((row, rIdx) => (
                <View key={rIdx}>
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Icon name={row.icon} size={20} color="#64748b" style={styles.icon} />
                      <Text style={styles.rowLabel}>{row.label}</Text>
                    </View>
                    <Text style={[styles.rowValue, row.color ? { color: row.color, fontWeight: '700' } : {}]}>
                      {row.value}
                    </Text>
                  </View>
                  {rIdx < sec.rows.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  rowLeft: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 12 },
  rowLabel: { fontSize: 14, color: '#334155', fontWeight: '500' },
  rowValue: { fontSize: 14, color: '#0f172a', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginLeft: 48 },
});

export default DetailsInfoScreen;
