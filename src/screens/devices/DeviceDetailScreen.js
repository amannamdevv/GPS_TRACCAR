/**
 * DeviceDetailScreen — Real data from tc_devices + tc_positions
 * Tabs: DETAILS | LOCATION | SENSORS | TRIPS | DG LOGS
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import { fetchDeviceList, fetchDgStatusLogs, reverseGeocode } from '../../api/webApi';
import moment from 'moment';

const getTripsReport = async () => [];
const getPositions = async () => [];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const DeviceDetailScreen = ({ route, navigation }) => {
  const { device: initialDevice } = route.params;

  const [device, setDevice] = useState(() => ({
    ...initialDevice,
    lat: initialDevice.lat || parseFloat(initialDevice.motion_lat) || 0,
    lng: initialDevice.lng || parseFloat(initialDevice.motion_lon) || 0,
  }));

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('DETAILS');
  const [currentAddress, setCurrentAddress] = useState(initialDevice.address || null);

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

  const tabs = ['DETAILS', 'LOCATION', 'SENSORS', 'TRIPS', 'DG LOGS'];

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
      setActiveTab('DETAILS');
      setTrips([]);
      setDgLogs([]);
      setDgTotalCount(0);
    }
  }, [route.params?.device]);

  // ─── GEOCODING ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadAddress = async () => {
      const { lat, lng } = device;
      if (lat && lng && parseFloat(lat) !== 0) {
        try {
          const addr = await reverseGeocode(lat, lng);
          setCurrentAddress(addr);
        } catch (e) {
          console.warn('Geocode failed:', e);
        }
      }
    };
    if (!currentAddress) loadAddress();
  }, [device.lat, device.lng]);

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

        if (updatedDev.motion_lat && updatedDev.motion_lon) {
          const addr = await reverseGeocode(updatedDev.motion_lat, updatedDev.motion_lon);
          setCurrentAddress(addr);
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
        trip.startAddress = await reverseGeocode(trip.startLat, trip.startLon);
        trip.endAddress = await reverseGeocode(trip.endLat, trip.endLon);
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
  // fetchDgStatusLogs webApi.js se aata hai — /dg_merged_status_api/ endpoint
  // limit=99999 → backend LIMIT clause sara data ek baar deta hai
  // start_date / end_date nahi bhej rahe → by default ALL records aayenge
  const loadDgLogs = useCallback(async () => {
    if (dgLoading) return;
    setDgLoading(true);
    try {
      const rows = await fetchDgStatusLogs({
        device_id: device.id,
        dg_name: device.name,
        page: 1,
        limit: 99999,   // ← sara data ek baar mein
      });

      // strict fallback filter: ensure we only show this device's logs
      const targetId = String(device.id);
      const targetName = String(device.name || '').trim().toLowerCase();

      const filtered = (rows || []).filter(item => {
        // match ID if available
        const itemId = String(item.deviceid || item.device_id || '');
        if (itemId && itemId !== targetId) return false;

        // match name if available
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

  // ─── TAB CHANGE ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'TRIPS') loadTrips();
    if (activeTab === 'DG LOGS') loadDgLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
    : device.totalDist ? device.totalDist + ' km' : 'N/A';
  const hoursMs = attr.hours ?? null;
  const hoursStr = hoursMs != null
    ? `${Math.floor(hoursMs / 3600000)}h ${Math.floor((hoursMs % 3600000) / 60000)}m`
    : 'N/A';

  const viewTripHistory = async (trip) => {
    try {
      setTripsLoading(true);
      const positions = await getPositions(device.id, trip.startTime, trip.endTime);
      const coords = positions.map(p => [p.latitude, p.longitude]);
      if (coords.length > 0) {
        navigation.navigate('Map', {
          historyData: {
            coords,
            startTime: new Date(trip.startTime).toLocaleString(),
            endTime: new Date(trip.endTime).toLocaleString(),
          },
        });
      } else {
        Alert.alert('No Data', 'No GPS positions found for this trip.');
      }
    } catch (err) {
      Alert.alert('History Error', err.message);
    } finally {
      setTripsLoading(false);
    }
  };

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
    } else {
      statusLabel = rawStatus || 'DG OFF';
      pillStyle = styles.statusPillOff;
      iconName = 'power-plug-off';
    }

    return (
      <View style={styles.logCard}>
        {/* Card Header Row */}
        <View style={styles.cardHeader2}>
          <View style={[styles.statusPill, pillStyle]}>
            <Icon name={iconName} size={14} color="#FFF" />
            <Text style={styles.statusPillText}>{statusLabel}</Text>
          </View>
          <Text style={styles.deviceName} numberOfLines={1}>
            {item.dg_name || item.device_name || `ID: ${item.deviceid}`}
          </Text>
        </View>

        {/* Quick Icon Telemetry Info Row */}
        <View style={styles.quickTelemetryRow}>
          <View style={styles.telemetryItem}>
            <Icon name="clock-outline" size={16} color="#64748b" />
            <Text style={styles.telemetryText}>{item.duration_minutes ?? 0} Mins</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Icon name="road-variant" size={16} color="#64748b" />
            <Text style={styles.telemetryText}>{item.covered_distance_km ?? 0} KM</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Icon name="transmission-tower" size={16} color="#64748b" />
            <Text style={styles.telemetryText} numberOfLines={1}>
              {item.nearest_indus_id || 'Tower N/A'}
            </Text>
          </View>
        </View>

        {/* Journey Addresses Grid (Start -> End) */}
        <View style={styles.journeyBox}>
          {/* Start Location Node */}
          <View style={styles.addressNode}>
            <Icon name="play-circle-outline" size={18} color="#10b981" style={styles.addressNodeIcon} />
            <View style={styles.addressDetails}>
              <Text style={styles.timeLabel}>
                Start: {formatTime(item.start_time)}
              </Text>
              <Text style={styles.addressText} numberOfLines={2}>
                {item.start_address || 'Address Not Available'}
              </Text>
              {item.start_latitude && (
                <Text style={styles.coordsText}>
                  Coord: {parseFloat(item.start_latitude).toFixed(5)}, {parseFloat(item.start_longitude).toFixed(5)}
                </Text>
              )}
            </View>
          </View>

          {/* Route Connection Dot line */}
          <View style={styles.connectorLine} />

          {/* End Location Node */}
          <View style={styles.addressNode}>
            <Icon name="stop-circle-outline" size={18} color="#ef4444" style={styles.addressNodeIcon} />
            <View style={styles.addressDetails}>
              <Text style={styles.timeLabel}>
                End: {formatTime(item.end_time)}
              </Text>
              <Text style={styles.addressText} numberOfLines={2}>
                {item.end_address || 'Address Not Available'}
              </Text>
              {item.end_latitude && (
                <Text style={styles.coordsText}>
                  Coord: {parseFloat(item.end_latitude).toFixed(5)}, {parseFloat(item.end_longitude).toFixed(5)}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Collapsible Details Drawer Button */}
        <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.id)}>
          <Text style={styles.expandBtnText}>
            {isExpanded ? 'Hide Details' : 'Show Industrial Site Details'}
          </Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#0284c7" />
        </TouchableOpacity>

        {/* Expandable Technical Telemetry details */}
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

  // ─── TAB CONTENT ────────────────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {

      case 'DETAILS':
        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Icon name="car" size={24} color="#4DD0E1" />
              </View>
              <Text style={styles.cardHeaderTitle}>{device.name}</Text>
              <Icon name="chevron-right" size={20} color="#D1D1D1" />
            </View>
            <InfoRow label="Icon" value="🚗" />
            <InfoRow label="Device ID" value={device.id?.toString()} copyable />
            <InfoRow label="IMEI" value={device.iccid || device.uniqueId || 'N/A'} copyable />
            <InfoRow label="SIM Card" value={device.phone || 'N/A'} />
            <InfoRow label="Model" value={device.model || 'N/A'} />
            <InfoRow label="Category" value={device.category || 'N/A'} />
            <InfoRow
              label="Last Update"
              value={device.lastUpdate ? new Date(device.lastUpdate).toLocaleString() : 'N/A'}
            />
          </View>
        );

      case 'LOCATION': {
        const hasValidCoords = Boolean(device.lat && device.lng && device.lat !== 0 && device.lng !== 0);
        const miniMapHtml = hasValidCoords ? `
          <!DOCTYPE html><html>
          <head>
            <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
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
        ` : '';

        return (
          <View style={styles.card}>
            {hasValidCoords ? (
              <View style={styles.miniMapContainer}>
                <WebView originWhitelist={['*']} source={{ html: miniMapHtml }} style={styles.miniMap} scrollEnabled={false} javaScriptEnabled />
              </View>
            ) : (
              <View style={styles.noMapBox}>
                <Icon name="map-marker-off" size={36} color="#9E9E9E" />
                <Text style={styles.noMapText}>No GPS fix available</Text>
              </View>
            )}
            <InfoRow label="Latitude" value={device.lat ? device.lat.toFixed(6) : 'N/A'} />
            <InfoRow label="Longitude" value={device.lng ? device.lng.toFixed(6) : 'N/A'} />
            <InfoRow label="Address" value={currentAddress || (hasValidCoords ? 'Fetching address…' : 'N/A')} />
            <InfoRow label="Speed" value={`${device.speedKmh || 0} km/h`} />
            <InfoRow label="Fix Time" value={device.fixTime ? new Date(device.fixTime).toLocaleString() : 'N/A'} />
          </View>
        );
      }

      case 'SENSORS':
        return (
          <View style={styles.card}>
            <InfoRow label="Speed" value={`${device.speedKmh || 0} km/h`} />
            <InfoRow label="Motion" value={motion === true || (device.speedKmh || 0) > 2 ? 'Moving' : 'Stopped'} />
            {ignition != null && <InfoRow label="Engine Status" value={ignition ? 'ON' : 'OFF'} />}
            <InfoRow label="Input Voltage" value={power != null ? `${power} V` : 'N/A'} />
            {charge != null && <InfoRow label="Charging" value={charge ? 'Yes' : 'No'} />}
            {batteryLevel != null && <InfoRow label="Battery Level" value={`${batteryLevel}%`} />}
            {rssi != null && <InfoRow label="GSM Signal" value={`${rssi} / 31`} />}
            {blocked != null && <InfoRow label="Blocked" value={blocked ? 'Yes' : 'No'} />}
            {fuel != null && <InfoRow label="Fuel Level" value={`${fuel}%`} />}
            {temp != null && <InfoRow label="Temperature" value={`${temp}°C`} />}
            <InfoRow label="Total Distance" value={totalDistKm} />
            {hoursStr !== 'N/A' && <InfoRow label="Engine Hours" value={hoursStr} />}
          </View>
        );

      case 'TRIPS':
        return (
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            {tripsLoading ? (
              <View style={styles.centerLoader}>
                <ActivityIndicator color="#FF9800" />
                <Text style={styles.loadingText}>Loading trips…</Text>
              </View>
            ) : trips.length === 0 ? (
              <View style={styles.centerLoader}>
                <Icon name="routes" size={48} color="#BDBDBD" />
                <Text style={styles.noTripsText}>No trips found in the last 24 hours</Text>
              </View>
            ) : (
              trips.map((trip, idx) => (
                <View key={idx} style={[styles.card, { padding: 16, marginBottom: 12 }]}>
                  <View style={styles.tripHeader}>
                    <Text style={styles.tripTime}>
                      {new Date(trip.startTime).toLocaleString()} – {new Date(trip.endTime).toLocaleString()}
                    </Text>
                    <Text style={styles.tripDuration}>{Math.round(trip.duration / 60)} min</Text>
                  </View>
                  <View style={styles.tripRoute}>
                    <Icon name="record-circle-outline" size={16} color="#4CAF50" />
                    <Text style={styles.tripLocation}>{trip.startAddress || 'Loading…'}</Text>
                  </View>
                  <View style={styles.tripRouteLine} />
                  <View style={styles.tripRoute}>
                    <Icon name="map-marker" size={16} color="#F44336" />
                    <Text style={styles.tripLocation}>{trip.endAddress || 'Loading…'}</Text>
                  </View>
                  <View style={styles.tripFooter}>
                    <TouchableOpacity style={styles.viewPathBtn} onPress={() => viewTripHistory(trip)}>
                      <Icon name="map-marker-path" size={16} color="#FF9800" />
                      <Text style={styles.viewPathText}>VIEW PATH</Text>
                    </TouchableOpacity>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.tripDistance}>{(trip.distance / 1000).toFixed(2)} km</Text>
                      <Text style={styles.tripSpeed}>Max: {Math.round((trip.maxSpeed || 0) * 1.852)} km/h</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        );

      case 'DG LOGS':
        return (
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>

            {/* Summary Bar */}
            <View style={styles.dgSummaryBar}>
              <Icon name="engine-outline" size={16} color="#FF9800" />
              <Text style={styles.dgSummaryText}>
                {dgLoading
                  ? 'Loading DG logs…'
                  : dgTotalCount > 0
                    ? `${dgTotalCount} total records`
                    : 'DG Activity Logs'}
              </Text>
              <TouchableOpacity onPress={loadDgLogs} disabled={dgLoading} style={styles.dgRefreshBtn}>
                <Icon name="refresh" size={16} color="#FF9800" />
              </TouchableOpacity>
            </View>

            {dgLoading ? (
              <View style={styles.centerLoader}>
                <ActivityIndicator size="large" color="#FF9800" />
                <Text style={styles.loadingText}>Fetching all DG records…</Text>
              </View>
            ) : dgLogs.length === 0 ? (
              <View style={styles.centerLoader}>
                <Icon name="engine-off-outline" size={48} color="#BDBDBD" />
                <Text style={styles.noTripsText}>No DG logs found for this device</Text>
              </View>
            ) : (
              <FlatList
                data={dgLogs}
                keyExtractor={(item, index) => `${item.id || index}`}
                renderItem={renderDgLogCard}
                scrollEnabled={false}
                ListFooterComponent={
                  <Text style={styles.endOfListText}>
                    ✓ All {dgTotalCount} records loaded
                  </Text>
                }
              />
            )}
          </View>
        );

      default:
        return null;
    }
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Header
        title={device.iccid || device.uniqueId || 'N/A'}
        navigation={navigation}
        showBack

      />

      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab === 'DG LOGS' ? 'DG Report' : tab}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.contentContainer} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('Map', { focusDevice: device })}
          >
            <Icon name="map-marker" size={20} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Show on Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.secondaryBtn]} onPress={refreshPosition}>
            <Icon name="refresh" size={20} color="#333" />
            <Text style={[styles.actionBtnText, { color: '#333' }]}>Refresh Data</Text>
          </TouchableOpacity>
        </View>

        {renderTabContent()}
      </ScrollView>
    </View>
  );
};

// ─── SUB COMPONENTS ──────────────────────────────────────────────────────────
const InfoRow = ({ label, value, copyable }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <View style={styles.infoValueContainer}>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
      {copyable && <Icon name="content-copy" size={16} color="#D1D1D1" style={{ marginLeft: 6 }} />}
    </View>
  </View>
);

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  actionRow: { flexDirection: 'row', padding: 16, paddingBottom: 0 },
  actionBtn: {
    flex: 1, flexDirection: 'row', backgroundColor: '#FF9800',
    paddingVertical: 10, justifyContent: 'center', alignItems: 'center',
    borderRadius: 8, marginRight: 8,
  },
  secondaryBtn: {
    backgroundColor: '#FFFFFF', marginRight: 0, marginLeft: 8,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  actionBtnText: { color: '#FFFFFF', fontWeight: '600', marginLeft: 8, fontSize: 14 },
  tabBar: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  tabScroll: { paddingHorizontal: 8 },
  tab: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#FF9800' },
  tabText: { color: '#757575', fontSize: 14 },
  activeTabText: { color: '#FF9800', fontWeight: 'bold' },
  contentContainer: { flex: 1 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 10, margin: 16, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  cardHeaderIcon: { width: 40, alignItems: 'flex-start' },
  cardHeaderTitle: { flex: 1, fontSize: 16, color: '#333333' },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  infoLabel: { fontSize: 14, color: '#757575' },
  infoValueContainer: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end', paddingLeft: 16 },
  infoValue: { fontSize: 14, color: '#333333', textAlign: 'right' },
  miniMapContainer: { height: 160, borderRadius: 10, overflow: 'hidden', margin: 16 },
  miniMap: { flex: 1 },
  noMapBox: { height: 100, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 10, margin: 16 },
  noMapText: { color: '#9E9E9E', marginTop: 8 },
  centerLoader: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { color: '#FF9800', marginTop: 10 },
  noTripsText: { color: '#9E9E9E', fontSize: 15, marginTop: 12, textAlign: 'center' },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  tripTime: { fontWeight: 'bold', color: '#333333', fontSize: 12, flex: 1 },
  tripDuration: { color: '#757575' },
  tripRoute: { flexDirection: 'row', alignItems: 'flex-start' },
  tripRouteLine: { width: 2, height: 16, backgroundColor: '#E0E0E0', marginLeft: 7, marginVertical: 4 },
  tripLocation: { marginLeft: 8, color: '#333333' },
  tripFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F5F5F5',
  },
  viewPathBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  viewPathText: { color: '#FF9800', fontSize: 11, fontWeight: 'bold', marginLeft: 4 },
  tripDistance: { fontWeight: 'bold', color: '#757575', fontSize: 13 },
  tripSpeed: { color: '#FF9800', fontWeight: 'bold', fontSize: 11 },

  // ── DG Logs ─────────────────────────────────────────────────────────────────
  dgSummaryBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF8F0', borderRadius: 8,
    padding: 10, marginBottom: 12,
    borderWidth: 1, borderColor: '#FFE0B2',
  },
  dgSummaryText: { flex: 1, marginLeft: 8, color: '#E65100', fontSize: 13, fontWeight: '600' },
  dgRefreshBtn: { padding: 4 },

  logCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader2: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
    marginBottom: 10,
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, marginRight: 10 },
  statusPillOn: { backgroundColor: '#10b981' },
  statusPillOff: { backgroundColor: '#ef4444' },
  statusPillMoving: { backgroundColor: '#0284c7' },
  statusPillStop: { backgroundColor: '#f59e0b' },
  statusPillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', marginLeft: 4 },
  deviceName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1e293b' },
  quickTelemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  telemetryItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  telemetryText: { fontSize: 12, fontWeight: '600', color: '#475569', marginLeft: 6 },
  journeyBox: { paddingLeft: 4, marginBottom: 8 },
  addressNode: { flexDirection: 'row', alignItems: 'flex-start' },
  addressNodeIcon: { marginTop: 2 },
  addressDetails: { flex: 1, marginLeft: 10 },
  timeLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  addressText: { fontSize: 13, color: '#0f172a', fontWeight: '700', lineHeight: 18 },
  coordsText: { fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 },
  connectorLine: { width: 1, height: 16, backgroundColor: '#cbd5e1', marginLeft: 8, marginVertical: 4 },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    marginTop: 4,
  },
  expandBtnText: { fontSize: 12, fontWeight: '600', color: '#0284c7' },
  expandedDrawer: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  detailLabel: { fontSize: 11.5, fontWeight: '600', color: '#64748b', flex: 1.1 },
  detailValue: { fontSize: 11.5, fontWeight: '600', color: '#1e293b', flex: 2, textAlign: 'right' },

  endOfListText: { textAlign: 'center', color: '#9E9E9E', fontSize: 12, paddingVertical: 16, marginBottom: 8 },
});

export default DeviceDetailScreen;