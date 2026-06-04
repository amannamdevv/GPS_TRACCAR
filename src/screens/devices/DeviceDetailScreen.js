import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  FlatList,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import { fetchDeviceList, fetchDgStatusLogs } from '../../api/webApi';
import moment from 'moment';
import axios from 'axios';
const BASE_URL = 'http://gps.shrotitele.com:1061/api';

const getTripsReport = async (deviceId, from, to) => {
  try {
    const resp = await axios.get(`${BASE_URL}/dg_merged_status_api/`, {
      params: { deviceid: deviceId, deviceId, from, to },
      timeout: 20000,
    });
    const raw = resp.data;
    let all = [];
    if (Array.isArray(raw)) all = raw;
    else if (raw && Array.isArray(raw.data)) all = raw.data;
    else if (raw && Array.isArray(raw.results)) all = raw.results;

    const filtered = all.filter(t => {
      const tid = t.deviceid ?? t.deviceId ?? t.device_id;
      return !tid || String(tid) === String(deviceId);
    });
    
    return filtered.map(t => ({
      startTime: t.start_time ?? t.position_time,
      endTime: t.end_time ?? t.position_time,
      duration: (parseFloat(t.total_duration_minutes ?? t.duration_minutes ?? 0)) * 60,
      distance: (parseFloat(t.covered_distance_km ?? 0)) * 1000,
      startLat: parseFloat(t.start_latitude ?? t.latitude ?? 0),
      startLon: parseFloat(t.start_longitude ?? t.longitude ?? 0),
      endLat: parseFloat(t.end_latitude ?? t.latitude ?? 0),
      endLon: parseFloat(t.end_longitude ?? t.longitude ?? 0),
      startAddress: t.start_address || null,
      endAddress: t.end_address || null,
      status: String(t.final_status || t.motion_status || 'UNKNOWN').toUpperCase()
    })).filter(t => t.status === 'MOVE' || t.status === 'MOVING');
  } catch (e) {
    console.warn('[getTripsReport]', e.message);
    return [];
  }
};

const getPositions = async () => [];

const DeviceDetailScreen = ({ route, navigation }) => {
  const { device: initialDevice } = route.params;

  const [device, setDevice] = useState(() => ({
    ...initialDevice,
    lat: Number(initialDevice.lat || initialDevice.motion_lat) || 0,
    lng: Number(initialDevice.lng || initialDevice.motion_lon) || 0,
  }));

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [activeSegment, setActiveSegment] = useState('LOCATION'); // 'LOCATION', 'SENSORS', 'TRIPS', 'DG_REPORT'
  const [currentAddress, setCurrentAddress] = useState(initialDevice.address || null);
  const [addressLoading, setAddressLoading] = useState(!initialDevice.address);
  const addressCacheRef = useRef({});

  // DG Logs state
  const [dgLogs, setDgLogs] = useState([]);
  const [dgLoading, setDgLoading] = useState(false);
  const [dgTotalCount, setDgTotalCount] = useState(0);

  const [expandedCardIds, setExpandedCardIds] = useState({});
  const toggleExpand = (id) => {
    setExpandedCardIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const formatTime = (raw) => {
    if (!raw || raw === 'N/A') return 'N/A';
    const m = moment(raw);
    if (!m.isValid()) return raw;
    return m.format('DD MMM YYYY, h:mm A');
  };

  // ─── UPDATE ON ROUTE PARAMS CHANGE ─────────────────────────────────────────
  useEffect(() => {
    if (route.params?.device && route.params.device.id !== device.id) {
      const newDev = route.params.device;
      setDevice({
        ...newDev,
        lat: newDev.lat || parseFloat(newDev.motion_lat) || 0,
        lng: newDev.lng || parseFloat(newDev.motion_lon) || 0,
      });
      setCurrentAddress(newDev.address || null);
      setActiveSegment('LOCATION');
      setTrips([]);
      setDgLogs([]);
      setDgTotalCount(0);
    }
  }, [route.params?.device]);

  // Geocoding removed to use single API address

  // ─── REFRESH POSITION ───────────────────────────────────────────────────────
  const refreshPosition = useCallback(async () => {
    try {
      const data = await fetchDeviceList();
      const devicesData = data.devices || [];
      const updatedDev = devicesData.find(d => d.id === device.id);

      if (updatedDev) {
        const isMoving = ['moving', 'true', '1', true, 1].includes(
          typeof updatedDev.motion_status === 'string'
            ? updatedDev.motion_status.toLowerCase()
            : updatedDev.motion_status
        );
        const isCharging = ['charging', 'true', '1', true, 1].includes(
          typeof updatedDev.battery_status === 'string'
            ? updatedDev.battery_status.toLowerCase()
            : updatedDev.battery_status
        );

        setDevice(prev => ({
          ...prev,
          iccid: updatedDev.iccid,
          lat: parseFloat(updatedDev.motion_lat) || 0,
          lng: parseFloat(updatedDev.motion_lon) || 0,
          address: updatedDev.address,
          speed: isMoving ? 10 : 0,
          speedKmh: isMoving ? 36 : 0,
          fixTime: updatedDev.position_time,
          ignition: updatedDev.ignition_status,
          charge: isCharging,
          batteryLevel: updatedDev.battery_level,
          rssi: updatedDev.rssi,
          motion: isMoving,
          attributes: {
            power: updatedDev.battery_level,
            charge: updatedDev.battery_status,
            motion: updatedDev.motion_status,
            status: updatedDev.dg_status,
            ignition: updatedDev.ignition_status,
            blocked: false,
          },
        }));

        if (updatedDev.address) {
          setCurrentAddress(updatedDev.address);
        }
      }
    } catch (err) {
      console.warn('Position refresh error:', err.message);
    }
  }, [device.id]);

  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  // ─── LOAD TRIPS ─────────────────────────────────────────────────────────────
  const loadTrips = useCallback(async () => {
    if (tripsLoading) return;
    setTripsLoading(true);
    try {
      const start = moment().subtract(24, 'hours').toISOString();
      const end = moment().toISOString();
      const data = await getTripsReport(device.id, start, end);
      const enriched = await Promise.all((data || []).map(async trip => {
        if (!trip.startAddress && trip.startLat) {
          trip.startAddress = await reverseGeocode(trip.startLat, trip.startLon);
        }
        if (!trip.endAddress && trip.endLat) {
          trip.endAddress = await reverseGeocode(trip.endLat, trip.endLon);
        }
        return trip;
      }));
      setTrips(enriched);
    } catch (err) {
      Alert.alert('Trips Error', err.message);
    } finally {
      setTripsLoading(false);
    }
  }, [device.id, tripsLoading]);

  // ─── LOAD DG LOGS ───────────────────────────────────────────────────────────
  const loadDgLogs = useCallback(async () => {
    if (dgLoading) return;
    setDgLoading(true);
    try {
      const rows = await fetchDgStatusLogs({
        device_id: device.id,
        dg_name: device.name,
        page: 1,
        limit: 99999,
      });

      const targetId = String(device.id);
      const targetName = String(device.name || '').trim().toLowerCase();

      const filtered = (rows || []).filter(item => {
        const itemId = String(item.deviceid || item.device_id || '');
        if (itemId && itemId !== targetId) return false;

        const itemName = String(item.dg_name || item.device_name || '').trim().toLowerCase();
        if (itemName && targetName && itemName !== targetName && !itemId) return false;

        return true;
      });

      setDgLogs(filtered);
      setDgTotalCount(filtered.length);
    } catch (err) {
      Alert.alert('DG Logs Error', err.message);
    } finally {
      setDgLoading(false);
    }
  }, [device.id, dgLoading]);

  // Trigger data load based on segment selection
  useEffect(() => {
    if (activeSegment === 'TRIPS') loadTrips();
    if (activeSegment === 'DG_REPORT') loadDgLogs();
  }, [activeSegment]);

  const viewTripHistory = async (trip) => {
    try {
      setTripsLoading(true);
      const positions = await getPositions(device.id, trip.startTime, trip.endTime);
      const coords = positions.map(p => [p.latitude, p.longitude]);
      if (coords.length > 0) {
        navigation.navigate('Playback', { device, historyData: { coords, startTime: new Date(trip.startTime).toLocaleString(), endTime: new Date(trip.endTime).toLocaleString() } });
      } else {
        Alert.alert('No Data', 'No GPS positions found for this trip.');
      }
    } catch (err) {
      Alert.alert('History Error', err.message);
    } finally {
      setTripsLoading(false);
    }
  };

  const handleSendCommand = () => {
    Alert.alert('Send Command', 'Command system is under development.');
  };

  // ─── SENSOR ATTRIBUTES ──────────────────────────────────────────────────────
  const attr = device.attributes || {};
  const ignition = device.ignition ?? attr.ignition ?? null;
  const charge = device.charge ?? attr.charge ?? null;
  const batteryLevel = device.batteryLevel ?? attr.batteryLevel ?? null;
  const rssi = device.rssi ?? attr.rssi ?? null;
  const motion = device.motion ?? attr.motion ?? null;
  const powerAttr = attr.power ?? attr.battery ?? attr.io1 ?? attr.adc1;
  const power = powerAttr != null ? parseFloat(powerAttr).toFixed(1) : null;
  const fuel = attr.fuel != null ? Math.round(attr.fuel) : null;
  const temp = attr.temp != null ? attr.temp.toFixed(1) : null;
  const blocked = attr.blocked ?? null;
  const totalDistKm = attr.totalDistance != null
    ? (attr.totalDistance / 1000).toFixed(2) + ' km'
    : device.totalDist ? `${device.totalDist} km` : '0 km';
  const hoursMs = attr.hours ?? null;
  const hoursStr = hoursMs != null
    ? `${Math.floor(hoursMs / 3600000)}h ${Math.floor((hoursMs % 3600000) / 60000)}m`
    : '0h 0m';

  const isOnline = device.status === 'online';
  const isMoving = device.motion_status === 'moving' || device.motion_status === true || (device.speedKmh || 0) > 2;

  let statusColor = '#ef4444';
  let statusLabel = 'Offline';
  if (isOnline) {
    if (isMoving) {
      statusColor = '#10b981';
      statusLabel = 'Moving';
    } else {
      statusColor = '#0284c7';
      statusLabel = 'Online';
    }
  }

  // ─── DG LOG CARD ────────────────────────────────────────────────────────────
  const renderDgLogCard = ({ item }) => {
    const isExpanded = !!expandedCardIds[item.id];
    const rawStatus = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();
    let statusLabel = 'DG OFF';
    let pillStyle = styles.statusPillOff;
    let iconName = 'power-plug-off';

    if (rawStatus.includes('MOVING') || rawStatus.includes('MOVE') || rawStatus.includes('MOTION') || rawStatus.includes('TRANSIT')) {
      statusLabel = 'MOVING';
      pillStyle = styles.statusPillMoving;
      iconName = 'truck-delivery-outline';
    } else if (rawStatus.includes('STOP') || rawStatus.includes('IDLE') || rawStatus.includes('PARK')) {
      statusLabel = 'STOPPED';
      pillStyle = styles.statusPillStop;
      iconName = 'octagon-outline';
    } else if (rawStatus.includes('ON') || rawStatus === '1') {
      statusLabel = 'DG ON';
      pillStyle = styles.statusPillOn;
      iconName = 'lightning-bolt';
    } else if (rawStatus.includes('OFF') || rawStatus === '0') {
      statusLabel = 'DG OFF';
      pillStyle = styles.statusPillOff;
      iconName = 'power-plug-off';
    }

    return (
      <View style={styles.logCard}>
        <View style={styles.cardHeader2}>
          <View style={[styles.statusPill, pillStyle]}>
            <Icon name={iconName} size={13} color="#FFF" />
            <Text style={styles.statusPillText}>{statusLabel}</Text>
          </View>
          <Text style={styles.logDeviceName} numberOfLines={1}>
            {item.dg_name || item.device_name || `ID: ${item.deviceid}`}
          </Text>
        </View>

        <View style={styles.quickTelemetryRow}>
          <View style={styles.telemetryItem}>
            <Icon name="clock-outline" size={15} color="#64748b" />
            <Text style={styles.telemetryText}>{item.duration_minutes ?? 0} Mins</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Icon name="road-variant" size={15} color="#64748b" />
            <Text style={styles.telemetryText}>{item.covered_distance_km ?? 0} KM</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Icon name="transmission-tower" size={15} color="#64748b" />
            <Text style={styles.telemetryText} numberOfLines={1}>{item.nearest_indus_id || 'Tower N/A'}</Text>
          </View>
        </View>

        <View style={styles.journeyBox}>
          <View style={styles.addressNode}>
            <Icon name="play-circle-outline" size={16} color="#10b981" style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.timeLabel}>Start: {formatTime(item.start_time)}</Text>
              <Text style={styles.addressText} numberOfLines={2}>{item.start_address || 'Address Not Available'}</Text>
              {item.start_latitude ? (
                <Text style={styles.coordsText}>
                  Coord: {parseFloat(item.start_latitude).toFixed(5)}, {parseFloat(item.start_longitude).toFixed(5)}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.connectorLine} />
          <View style={styles.addressNode}>
            <Icon name="stop-circle-outline" size={16} color="#ef4444" style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.timeLabel}>End: {formatTime(item.end_time)}</Text>
              <Text style={styles.addressText} numberOfLines={2}>{item.end_address || 'Address Not Available'}</Text>
              {item.end_latitude ? (
                <Text style={styles.coordsText}>
                  Coord: {parseFloat(item.end_latitude).toFixed(5)}, {parseFloat(item.end_longitude).toFixed(5)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.id)}>
          <Text style={styles.expandBtnText}>{isExpanded ? 'Hide Details' : 'Show Industrial Site Details'}</Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#0284c7" />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedDrawer}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>📍 District / Area:</Text>
              <Text style={styles.detailValue}>{item.district || 'N/A'} / {item.area || 'N/A'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>🏫 Site Name / Type:</Text>
              <Text style={styles.detailValue}>{item.site_name || 'N/A'} ({item.site_type || 'N/A'})</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>📞 OME ERP O&M:</Text>
              <Text style={styles.detailValue}>{item.ome_name_as_erp || 'N/A'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>👤 AOM Manager:</Text>
              <Text style={styles.detailValue}>{item.aom_name || 'N/A'} {item.aom_number ? `(${item.aom_number})` : ''}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>🗼 Indus Towers (100m):</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{item.indus_id_within_100m || 'None'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>📏 Nearest Indus Dist:</Text>
              <Text style={styles.detailValue}>{item.nearest_distance_m !== null ? `${item.nearest_distance_m} meters` : 'N/A'}</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Header title="DG Console" navigation={navigation} showBack />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Profile Card Header */}
        <View style={styles.profileHeaderCard}>
          <View style={[styles.largeAvatar, { backgroundColor: `${statusColor}15` }]}>
            <Icon name="car" size={38} color={statusColor} />
          </View>
          <View style={styles.profileHeaderMeta}>
            <Text style={styles.vehicleName}>{device.name}</Text>
            <Text style={styles.imeiText}>IMEI: {device.iccid || device.uniqueId}</Text>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15`, marginTop: 8 }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        {/* 4 Action Grid */}
        <View style={styles.quickGrid}>
          {[
            { label: 'Tracking', icon: 'crosshairs-gps', color: '#1565C0', route: 'Tracking' },
            { label: 'Playback', icon: 'history', color: '#ea580c', route: 'Playback' },
            { label: 'Detail', icon: 'card-bulleted-settings-outline', color: '#10b981', route: 'DetailInfo' },
          ].map((btn, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.gridItem}
              activeOpacity={0.8}
              onPress={btn.action || (() => navigation.navigate(btn.route, { device }))}
            >
              <View style={[styles.gridIconBg, { backgroundColor: `${btn.color}10` }]}>
                <Icon name={btn.icon} size={24} color={btn.color} />
              </View>
              <Text style={styles.gridLabel}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Segmented Controller (Tab Bar) */}
        <View style={styles.segmentTabBar}>
          {[
            { key: 'LOCATION', label: 'Map' },
            { key: 'SENSORS', label: 'Sensors' },
            { key: 'TRIPS', label: 'Trips' },
            { key: 'DG_REPORT', label: 'DG Report' },
          ].map(seg => (
            <TouchableOpacity
              key={seg.key}
              style={[styles.segmentBtn, activeSegment === seg.key && styles.segmentBtnActive]}
              onPress={() => setActiveSegment(seg.key)}
            >
              <Text style={[styles.segmentBtnText, activeSegment === seg.key && styles.segmentBtnTextActive]}>
                {seg.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Segment Contents */}
        <View style={styles.segmentContent}>
          {activeSegment === 'LOCATION' && (
            <View style={styles.card}>
              {device.lat && device.lng && device.lat !== 0 ? (
                <View style={styles.miniMapContainer}>
                  <WebView
                    originWhitelist={['*']}
                    source={{
                      html: `
                      <!DOCTYPE html><html>
                      <head>
                        <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
                        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                        <style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
                      </head>
                      <body><div id="map"></div>
                      <script>
                        var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${device.lat},${device.lng}],15);
                        L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
                        L.circleMarker([${device.lat},${device.lng}],{radius:8,fillColor:'#2196F3',color:'#fff',weight:2,opacity:1,fillOpacity:0.9}).addTo(map);
                      </script></body></html>
                    ` }}
                    style={{ flex: 1 }}
                    scrollEnabled={false}
                  />
                </View>
              ) : (
                <View style={styles.noMapBox}>
                  <Icon name="map-marker-off" size={32} color="#94a3b8" />
                  <Text style={styles.noMapText}>No location coordinates available</Text>
                </View>
              )}
              <View style={styles.infoList}>
                <InfoRow label="Address" value={addressLoading ? 'Fetching address...' : (currentAddress || 'N/A')} />
                <InfoRow label="Latitude / Longitude" value={`${Number(device.lat || 0).toFixed(5)}, ${Number(device.lng || 0).toFixed(5)}`} />
                <InfoRow label="Last Fix Time" value={formatTime(device.fixTime)} />
              </View>
            </View>
          )}

          {activeSegment === 'SENSORS' && (
            <View style={styles.card}>
              <InfoRow label="GSM Signal Strength" value={rssi ? `${rssi} / 31` : 'N/A'} />
              <InfoRow label="Battery Voltage" value={power != null ? `${power} V` : 'N/A'} />
              <InfoRow label="Engine Hours" value={hoursStr} />
              <InfoRow label="Total Distance" value={totalDistKm} />
              <InfoRow label="Speed" value={`${device.speedKmh || 0} km/h`} />
              <InfoRow label="Motion State" value={motion === true || (device.speedKmh || 0) > 2 ? 'Moving' : 'Stopped'} />
            </View>
          )}

          {activeSegment === 'TRIPS' && (
            <View style={{ marginTop: 6 }}>
              {tripsLoading ? (
                <ActivityIndicator size="large" color="#1565C0" style={{ marginVertical: 30 }} />
              ) : trips.length === 0 ? (
                <View style={styles.emptyContent}>
                  <Icon name="routes" size={40} color="#cbd5e1" />
                  <Text style={styles.emptyContentText}>No trips recorded in the last 24 hours</Text>
                </View>
              ) : (
                trips.map((trip, idx) => (
                  <View key={idx} style={[styles.card, { padding: 14, marginBottom: 12 }]}>
                    <View style={styles.tripHeader}>
                      <Text style={[styles.tripTime, { fontWeight: 'bold', color: trip.status === 'OFF' ? '#ef4444' : trip.status === 'MOVE' || trip.status === 'MOVING' ? '#10b981' : '#facc15' }]}>{trip.status}</Text>
                      <Text style={styles.tripTime}>{formatTime(trip.startTime)} – {formatTime(trip.endTime)}</Text>
                      <Text style={styles.tripDur}>{Math.round(trip.duration / 60)}m</Text>
                    </View>
                    <View style={styles.tripRouteRow}><Icon name="play-circle" size={14} color="#10b981" /><Text style={styles.tripLocText} numberOfLines={1}>{trip.startAddress || 'Loading...'}</Text></View>
                    <View style={styles.tripRouteRow}><Icon name="stop-circle" size={14} color="#ef4444" /><Text style={styles.tripLocText} numberOfLines={1}>{trip.endAddress || 'Loading...'}</Text></View>
                    <View style={styles.tripFooter}>
                      <Text style={styles.tripDist}>{(trip.distance / 1000).toFixed(2)} km</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {activeSegment === 'DG_REPORT' && (
            <View style={{ marginTop: 6 }}>
              <View style={styles.dgSummaryBox}>
                <Text style={styles.dgSummaryTitle}>DG Merged Reports</Text>
                <TouchableOpacity onPress={loadDgLogs} disabled={dgLoading}>
                  <Icon name="refresh" size={18} color="#1565C0" />
                </TouchableOpacity>
              </View>

              {dgLoading ? (
                <ActivityIndicator size="large" color="#1565C0" style={{ marginVertical: 30 }} />
              ) : dgLogs.length === 0 ? (
                <View style={styles.emptyContent}>
                  <Icon name="engine-off" size={40} color="#cbd5e1" />
                  <Text style={styles.emptyContentText}>No DG activities recorded</Text>
                </View>
              ) : (
                <FlatList
                  data={dgLogs}
                  keyExtractor={(item, index) => `${item.id || index}`}
                  renderItem={renderDgLogCard}
                  scrollEnabled={false}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    marginBottom: 20,
  },
  largeAvatar: { width: 68, height: 68, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  profileHeaderMeta: { flex: 1 },
  vehicleName: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  imeiText: { fontSize: 12, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, alignSelf: 'flex-start' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Quick grid
  quickGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, gap: 10 },
  gridItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  gridIconBg: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  gridLabel: { fontSize: 11, fontWeight: '600', color: '#475569' },

  // Segment Tab
  segmentTabBar: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 24, padding: 4, marginBottom: 16 },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 20 },
  segmentBtnActive: { backgroundColor: '#FFFFFF', elevation: 2, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
  segmentBtnText: { fontSize: 11.5, fontWeight: '600', color: '#64748b' },
  segmentBtnTextActive: { color: '#1565C0', fontWeight: '700' },

  // Cards & Rows
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 16 },
  miniMapContainer: { height: 180, borderRadius: 12, overflow: 'hidden', marginBottom: 14 },
  noMapBox: { height: 120, borderRadius: 12, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  noMapText: { color: '#64748b', fontSize: 12, fontWeight: '500', marginTop: 8 },
  infoList: { gap: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  infoLabel: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#0f172a', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 12 },

  // Trips
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  tripTime: { fontSize: 11, fontWeight: '700', color: '#475569', flex: 1 },
  tripDur: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  tripRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  tripLocText: { fontSize: 12, color: '#1e293b', fontWeight: '500', flex: 1 },
  tripFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 8 },
  tripDist: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  playTripBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff7ed', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 0.5, borderColor: '#ffedd5' },
  playTripText: { fontSize: 10.5, fontWeight: '700', color: '#ea580c' },

  // Empty state
  emptyContent: { alignItems: 'center', paddingVertical: 32 },
  emptyContentText: { color: '#64748b', fontSize: 13, fontWeight: '500', marginTop: 10 },

  // DG Log specific
  dgSummaryBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 4 },
  dgSummaryTitle: { fontSize: 13, fontWeight: '700', color: '#475569' },
  logCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 12 },
  cardHeader2: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8, marginBottom: 10 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, marginRight: 10 },
  statusPillOn: { backgroundColor: '#10b981' },
  statusPillOff: { backgroundColor: '#ef4444' },
  statusPillMoving: { backgroundColor: '#0284c7' },
  statusPillStop: { backgroundColor: '#f59e0b' },
  statusPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginLeft: 4 },
  logDeviceName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1e293b' },
  quickTelemetryRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderRadius: 8, padding: 8, marginBottom: 10 },
  telemetryItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  telemetryText: { fontSize: 11, fontWeight: '600', color: '#475569', marginLeft: 4 },
  journeyBox: { paddingLeft: 2, marginBottom: 6 },
  addressNode: { flexDirection: 'row', alignItems: 'flex-start' },
  timeLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  addressText: { fontSize: 12, color: '#0f172a', fontWeight: '700' },
  coordsText: { fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 },
  connectorLine: { width: 1, height: 12, backgroundColor: '#cbd5e1', marginLeft: 8, marginVertical: 3 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 8, marginTop: 4 },
  expandBtnText: { fontSize: 11.5, fontWeight: '600', color: '#0284c7' },
  expandedDrawer: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginTop: 8, gap: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  detailLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', flex: 1.1 },
  detailValue: { fontSize: 11, fontWeight: '600', color: '#1e293b', flex: 2, textAlign: 'right' },
});

export default DeviceDetailScreen;