import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, RefreshControl, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import moment from 'moment';
import { fetchDgDeviceDetail } from '../../api/webApi';

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = (dateStr) => {
  if (!dateStr || dateStr === 'N/A') return 'N/A';
  const m = moment(dateStr);
  return m.isValid() ? m.format('DD/MM/YYYY, HH:mm:ss') : String(dateStr);
};

// Same logic as website's timeAgo() in dg_list.html
const timeAgo = (dateStr) => {
  if (!dateStr) return 'N/A';
  const then = moment(dateStr);
  if (!then.isValid()) return 'N/A';
  const diffSec = Math.max(0, moment().diff(then, 'seconds'));
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffSec / 3600);
  const diffDay = Math.floor(diffSec / 86400);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffSec < 60) return `${diffSec} sec`;
  if (diffMin < 60) return `${diffMin} min`;
  if (diffHr < 24) return `${diffHr} hr`;
  if (diffDay < 30) return `${diffDay} day${diffDay > 1 ? 's' : ''}`;
  return `${diffMonth} month${diffMonth > 1 ? 's' : ''}`;
};

const val = (v, suffix = '') => {
  if (v === null || v === undefined || v === '' || v === 'null') return 'N/A';
  return `${v}${suffix}`;
};

const numVal = (v, suffix = '') => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return 'N/A';
  return `${Number(v).toFixed(2)}${suffix}`;
};

// ─── Row Component ────────────────────────────────────────────────────────
const Row = ({ label, value, icon, color, isLast, sub }) => (
  <View>
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Icon name={icon} size={18} color={color || '#64748b'} style={styles.icon} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={{ maxWidth: '58%' }}>
        <Text style={[styles.rowValue, color ? { color, fontWeight: '700' } : {}]} numberOfLines={2}>
          {value}
        </Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
    {!isLast && <View style={styles.divider} />}
  </View>
);

// ─── Section Component ────────────────────────────────────────────────────
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

// ─── Main Screen ──────────────────────────────────────────────────────────
const DetailsInfoScreen = ({ route, navigation }) => {
  const { device } = route.params;
  const [d, setD] = useState(null);       // dgDetail row from dg_device_detail_json
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const loadData = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setNotFound(false);
    setErrorMsg(null);
    try {
      const deviceId = device.id || device.deviceid;
      console.log('[DetailsInfoScreen] calling fetchDgDeviceDetail with deviceid:', deviceId, 'uniqueId:', device.uniqueId || device.uniqueid);
      const resp = await fetchDgDeviceDetail({ deviceid: deviceId });
      console.log('[DetailsInfoScreen] API response status:', resp?.status, 'data count:', Array.isArray(resp?.data) ? resp.data.length : 'NOT_ARRAY', 'error:', resp?.error);
      if (resp?.status === false) {
        setErrorMsg(resp.error || 'Server se data nahi mila. Login/session check karein.');
      }
      const list = Array.isArray(resp?.data) ? resp.data : [];
      if (list.length > 0) {
        console.log('[DetailsInfoScreen] First item deviceid:', list[0].deviceid, 'uniqueid:', list[0].uniqueid);
      }
      const found = list.find(item =>
        String(item.deviceid) === String(device.id) ||
        String(item.deviceid) === String(device.deviceid) ||
        String(item.uniqueid) === String(device.uniqueId) ||
        String(item.uniqueid) === String(device.uniqueid)
      );
      if (found) {
        console.log('[DetailsInfoScreen] ✅ Device found! deviceid:', found.deviceid, 'name:', found.device_name);
        setD(found);
      } else {
        console.log('[DetailsInfoScreen] ❌ Device NOT found in list of', list.length, 'items');
        // If API returned data but find() missed, use first item (since we filtered by deviceid)
        if (list.length === 1) {
          console.log('[DetailsInfoScreen] Using first (only) item as fallback');
          setD(list[0]);
        } else {
          setNotFound(true);
        }
      }
    } catch (e) {
      console.warn('[DetailsInfoScreen] load error:', e.message);
      setErrorMsg(e.message);
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

  // src = live dg_device_detail_json row. Fallback to device prop only if API row missing.
  const src = d || {};

  const statusRaw = src.status || device.status || '';
  const isOnline = statusRaw === 'online';
  const isUnknown = statusRaw === 'unknown';
  const statusLabel = isOnline ? 'Online' : isUnknown ? 'Unknown' : 'Offline';
  const statusColor = isOnline ? '#10b981' : isUnknown ? '#f59e0b' : '#ef4444';

  const ignitionVal = src.ignition;
  const ignStatus = src.ignition_status || (ignitionVal == 1 ? 'ON' : ignitionVal == 0 ? 'OFF' : 'N/A');
  const ignColor = ignStatus === 'ON' ? '#10b981' : '#ef4444';

  // Same rule as website: ON -> ignition_on_time, OFF -> ignition_off_time
  let ignTime = src.ignition_time;
  if (ignitionVal == 1) ignTime = src.ignition_on_time || ignTime;
  if (ignitionVal == 0) ignTime = src.ignition_off_time || ignTime;

  const isMoving = src.motion === 1 || src.motion === true || src.motion === '1';
  const motionLabel = isMoving ? 'Moving' : 'Stopped';
  const motionColor = isMoving ? '#3b82f6' : '#f59e0b';

  const isCharging = src.charge === 1 || src.charge === true || src.charge === '1';

  const siteIdValue = src.gtms_site_id || src.site_id
    ? `${src.gtms_site_id || src.site_id}${src.site_distance != null ? ' (' + Number(src.site_distance).toFixed(2) + ' km)' : ''}`
    : 'N/A';

  return (
    <View style={styles.container}>
      <Header title="Device Information" navigation={navigation} showBack />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
      >

        {/* ── Profile strip ──────────────────────────────── */}
        <View style={styles.profileStrip}>
          <View style={[styles.avatar, { backgroundColor: `${statusColor}15` }]}>
            <Icon name="engine-outline" size={30} color={statusColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{val(src.device_name || device.name)}</Text>
            <Text style={styles.imeiText}>IMEI: {val(src.uniqueid || device.uniqueId || device.uniqueid)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {notFound && (
          <View style={styles.warnBox}>
            <Icon name="alert-circle-outline" size={20} color="#b45309" />
            <Text style={styles.warnText}>
              Is device ka record dg_device_detail API me nahi mila. Neeche wali basic info hi dikh rahi hai — server/session issue ho sakta hai.
            </Text>
          </View>
        )}
        {errorMsg && (
          <View style={styles.warnBox}>
            <Icon name="wifi-alert" size={20} color="#b45309" />
            <Text style={styles.warnText}>{errorMsg}</Text>
          </View>
        )}

        {/* ── Device Information ─────────────────────────── */}
        <Section title="📑  Device Information" rows={[
          { label: 'Device Name', value: val(src.device_name || device.name), icon: 'tag-outline' },
          { label: 'IMEI', value: val(src.uniqueid || device.uniqueId || device.uniqueid), icon: 'barcode-scan' },
          { label: 'Circle Name', value: val(src.state_name), icon: 'map' },
          { label: 'Zone Name', value: val(src.zone_name), icon: 'map-marker-path' },
          { label: 'Cluster Name', value: val(src.district_name), icon: 'group' },
          { label: 'Site Name', value: val(src.site_name), icon: 'office-building' },
          { label: 'Site ID', value: siteIdValue, icon: 'qrcode' },
        ]} />

        {/* ── DG Status & Aging ──────────────────────────── */}
        <Section title="⚡  DG Status" rows={[
          { label: 'DG Status', value: ignStatus, icon: 'lightning-bolt', color: ignColor, sub: ignTime ? fmt(ignTime) : null },
          { label: 'Aging For ON/OFF', value: timeAgo(ignTime), icon: 'timer-sand', color: ignColor },
          { label: 'DG Move Status', value: motionLabel, icon: 'run', color: motionColor, sub: src.motion_time ? fmt(src.motion_time) : null },
          { label: 'Aging For Move', value: timeAgo(src.motion_time), icon: 'timer-sand', color: motionColor },
        ]} />

        {/* ── Telemetry ───────────────────────────────────── */}
        <Section title="📡  Telemetry" rows={[
          { label: 'In GPS Batt', value: src.battery_level != null ? `${src.battery_level}%` : 'N/A', icon: 'battery', color: src.battery_level > 20 ? '#10b981' : '#ef4444' },
          { label: 'GSM Signal', value: src.rssi != null ? `${src.rssi}` : 'N/A', icon: 'signal', color: '#10b981' },
          { label: 'Charge Status', value: isCharging ? 'Charging' : 'Not Charging', icon: 'power-plug', color: isCharging ? '#10b981' : '#ef4444' },
          { label: 'Ext Batt Volt', value: numVal(src.adc1, ' V'), icon: 'car-battery' },
          { label: 'CNN Satellite', value: src.sat != null ? `${src.sat}` : 'N/A', icon: 'satellite-uplink', color: '#3b82f6' },
        ]} />

        {/* ── Communication ───────────────────────────────── */}
        <Section title="🕒  Communication" rows={[
          { label: 'Last Comm. Time', value: fmt(src.lastupdate || src.updated_at), icon: 'clock' },
          { label: 'Aging Last Comm.', value: timeAgo(src.lastupdate || src.updated_at), icon: 'timer-sand' },
          { label: 'GPS Install', value: src.gps_install_date ? moment(src.gps_install_date).format('DD/MM/YYYY') : 'N/A', icon: 'calendar-check' },
          { label: 'GPS Install Site', value: val(src.gps_indus_id), icon: 'office-building-marker' },
        ]} />

        {/* ── Assigned Team ────────────────────────────────── */}
        <Section title="👥  Assigned Team" rows={[
          { label: 'O&M Head', value: val(src.aid_l3_name), icon: 'account-tie' },
          { label: 'AOM', value: val(src.aid_l4_name), icon: 'account-supervisor' },
          { label: 'FSE', value: val(src.aid_l5_name), icon: 'account-wrench' },
          { label: 'Technician', value: val(src.aid_l6_name), icon: 'account-hard-hat' },
        ]} />

        {/* ── Location ────────────────────────────────────── */}
        <Section title="📍  Location" rows={[
          { label: 'Current Address', value: val(src.address || device.address), icon: 'map-marker' },
          { isMapLink: true, lat: src.latitude || device.motion_lat || device.lat, lon: src.longitude || device.motion_lon || device.lon },
        ]} />

      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14 },
  scroll: { padding: 16, paddingBottom: 48 },

  profileStrip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 14,
  },
  avatar: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  vehicleName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  imeiText: { fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  warnBox: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 12, marginBottom: 14, gap: 8 },
  warnText: { flex: 1, fontSize: 12, color: '#92400e', fontWeight: '500' },

  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  icon: { marginRight: 10 },
  rowLabel: { fontSize: 13, color: '#475569', fontWeight: '500', flex: 1 },
  rowValue: { fontSize: 13, color: '#0f172a', fontWeight: '600', textAlign: 'right' },
  rowSub: { fontSize: 10, color: '#94a3b8', textAlign: 'right', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginLeft: 44 },
});

export default DetailsInfoScreen;