import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Linking, RefreshControl, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import moment from 'moment';
import { fetchDgDeviceDetail } from '../../api/webApi';

const fmt = (dateStr) => {
  if (!dateStr || dateStr === 'N/A') return 'N/A';
  const m = moment(dateStr);
  return m.isValid() ? m.format('DD/MM/YYYY, HH:mm:ss') : String(dateStr);
};

const fmtDistance = (meters) => {
  if (meters == null || meters === 'N/A') return 'N/A';
  const km = parseFloat(meters) / 1000;
  return `${km.toFixed(2)} km`;
};

const deduplicateAlarms = (alarmStr) => {
  if (!alarmStr) return 'None';
  const unique = [...new Set(alarmStr.split(',').map(s => s.trim()).filter(Boolean))];
  return unique.join(', ') || 'None';
};

const val = (v, suffix = '') => {
  if (v === null || v === undefined || v === '' || v === 'null') return 'N/A';
  return `${v}${suffix}`;
};

// ─── Row Component ────────────────────────────────────────────────────────────
const Row = ({ label, value, icon, color, isLast }) => (
  <View>
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Icon name={icon} size={18} color={color || '#64748b'} style={styles.icon} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={[styles.rowValue, color ? { color, fontWeight: '700' } : {}]} numberOfLines={2}>
        {value}
      </Text>
    </View>
    {!isLast && <View style={styles.divider} />}
  </View>
);

// ─── Section Component ────────────────────────────────────────────────────────
const Section = ({ title, rows }) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeader}>{title}</Text>
    <View style={styles.card}>
      {rows.map((row, i) =>
        row.isMapLink ? (
          <View key={i}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                if (row.lat && row.lon) {
                  Linking.openURL(`https://www.google.com/maps?q=${row.lat},${row.lon}`).catch(() => { });
                }
              }}
            >
              <View style={styles.rowLeft}>
                <Icon name="google-maps" size={18} color="#1565C0" style={styles.icon} />
                <Text style={styles.rowLabel}>View on Google Maps</Text>
              </View>
              <Text style={[styles.rowValue, { color: '#1565C0' }]}>Open →</Text>
            </TouchableOpacity>
            {i < rows.length - 1 && <View style={styles.divider} />}
          </View>
        ) : (
          <Row key={i} {...row} isLast={i === rows.length - 1} />
        )
      )}
    </View>
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────
const DetailsInfoScreen = ({ route, navigation }) => {
  const { device } = route.params;
  const [d, setD] = useState(null); // dgDetail from API
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const resp = await fetchDgDeviceDetail();
      const list = resp?.data || [];
      const found = list.find(item =>
        item.deviceid == device.id ||
        item.uniqueid == device.uniqueId ||
        item.uniqueid == device.uniqueid
      );
      if (found) setD(found);
    } catch (e) {
      console.warn('[DetailsInfoScreen] load error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, [device]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header title="Device Information" navigation={navigation} showBack />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
          <Text style={styles.loadingText}>Loading device details...</Text>
        </View>
      </View>
    );
  }

  // Use dgDetail (d) as source of truth; fallback to device prop
  const src = d || {};

  const statusRaw = src.status || device.status || '';
  const isOnline = statusRaw === 'online';
  const isUnknown = statusRaw === 'unknown';
  const statusLabel = isOnline ? 'Online' : isUnknown ? 'Unknown' : 'Offline';
  const statusColor = isOnline ? '#10b981' : isUnknown ? '#f59e0b' : '#ef4444';

  const ignStatus = src.ignition_status || 'N/A';
  const ignColor = ignStatus === 'ON' ? '#10b981' : '#ef4444';

  const motionVal = src.motion !== undefined ? src.motion : device.motion_status;
  const isMoving = motionVal === 1 || motionVal === true || motionVal === '1';

  const chargeVal = src.charge !== undefined ? src.charge : device.battery_status;
  const isCharging = chargeVal === 1 || chargeVal === true || chargeVal === '1';

  return (
    <View style={styles.container}>
      <Header
        title="Device Information"
        navigation={navigation}
        showBack
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      >

        {/* ── Device Information ─────────────────────────── */}
        <Section title="📑  Device Information" rows={[
          { label: 'Device Name', value: val(src.device_name || device.name), icon: 'tag-outline' },
          { label: 'IMEI', value: val(src.uniqueid || device.uniqueId || device.uniqueid), icon: 'barcode-scan' },
          { label: 'State / Circle', value: val(src.state_name), icon: 'map' },
          { label: 'District / Zone', value: val(src.district_name), icon: 'map-marker-radius' },
          { label: 'Cluster', value: val(src.cluster_name), icon: 'group' },
          { label: 'Site Name', value: val(src.site_name), icon: 'office-building' },
          { label: 'Site ID', value: val(src.site_id), icon: 'qrcode' },
        ]} />

        {/* ── Telemetry & Status ──────────────────────── */}
        <Section title="⚡  Telemetry & Status" rows={[
          { label: 'DG Status', value: `${ignStatus} ${src.ignition_time ? `(${fmt(src.ignition_time)})` : ''}`, icon: 'lightning-bolt', color: ignColor },
          { label: 'Motion', value: isMoving ? 'Moving' : 'Stopped', icon: 'run', color: isMoving ? '#3b82f6' : '#ef4444' },
          { label: 'Battery', value: src.battery_level != null ? `${src.battery_level}%` : 'N/A', icon: 'battery', color: src.battery_level > 20 ? '#10b981' : '#ef4444' },
          { label: 'Signal', value: src.rssi ? `${src.rssi}` : 'N/A', icon: 'signal', color: '#10b981' },
          { label: 'Charge', value: isCharging ? 'Charging' : 'Not Charging', icon: 'power-plug', color: isCharging ? '#10b981' : '#ef4444' },
          { label: 'Voltage', value: src.adc1 != null && !isNaN(Number(src.adc1)) ? `${Number(src.adc1).toFixed(2)} V` : '0.00 V', icon: 'car-battery' },
          { label: 'Last Updated', value: fmt(src.lastupdate || src.updated_at), icon: 'clock' },
          { label: 'GPS Install', value: src.gps_install_date ? moment(src.gps_install_date).format('DD/MM/YYYY') : 'N/A', icon: 'calendar-check' },
        ]} />

        {/* ── Location ────────────────────────────────── */}
        <Section title="📍  Location" rows={[
          { label: 'Address', value: val(src.address || device.address), icon: 'map-marker' },
          { isMapLink: true, lat: src.latitude || device.motion_lat || device.lat, lon: src.longitude || device.motion_lon || device.lon },
        ]} />

      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14 },
  scroll: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  icon: { marginRight: 10 },
  rowLabel: { fontSize: 13, color: '#475569', fontWeight: '500', flex: 1 },
  rowValue: { fontSize: 13, color: '#0f172a', fontWeight: '600', textAlign: 'right', maxWidth: '55%' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginLeft: 44 },
  actionBtn: { flexDirection: 'row', backgroundColor: '#1565C0', padding: 14, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10, elevation: 2 },
  actionBtnText: { color: '#ffffff', fontSize: 15, fontWeight: 'bold' }
});

export default DetailsInfoScreen;