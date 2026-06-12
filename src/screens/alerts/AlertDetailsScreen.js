import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reverseGeocode, fetchDeviceList } from '../../api/webApi';
import moment from 'moment';

const ALERT_MAPPING = {
  powerCut: 'Power Cut Detected',
  lowBattery: 'Low Battery Alert',
  vibration: 'Vibration Detected',
  ignitionOn: 'DG ON',
  ignitionOff: 'DG OFF',
  deviceMoving: 'DG Moving',
  deviceStopped: 'DG Stopped',
  // backward compatibility for older alerts
  motionStart: 'DG Moving',
  motionStop: 'DG Stopped',
};

const AlertDetailsScreen = ({ route, navigation }) => {
  const { alert } = route.params;
  const insets = useSafeAreaInsets();

  const [address, setAddress] = useState('Fetching alert address...');
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);

  const [lat, setLat] = useState(() => {
    return parseFloat(alert.latitude || alert.lat || alert.attributes?.latitude || alert.attributes?.lat || alert.motion_lat) || 0;
  });
  const [lng, setLng] = useState(() => {
    return parseFloat(alert.longitude || alert.lon || alert.attributes?.longitude || alert.attributes?.lon || alert.motion_lon) || 0;
  });

  // ─── LEAFLET MINI-MAP ───────────────────────────────────────────────────────
  const mapHtml = useMemo(() => {
    if (lat === 0 || lng === 0) return '';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 16);
          L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
          L.circleMarker([${lat}, ${lng}], {
            radius: 8,
            fillColor: '#ef4444',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
          }).addTo(map);
        </script>
      </body>
      </html>
    `;
  }, [lat, lng]);

  useEffect(() => {
    const initData = async () => {
      // Load address
      if (lat !== 0) {
        try {
          const addr = await reverseGeocode(lat, lng);
          setAddress(addr || 'Address Not Available');
        } catch (_) {
          setAddress('Error loading address');
        }
      } else {
        setAddress('No coordinates associated with this alert');
      }

      // Load device details
      try {
        const list = await fetchDeviceList();
        const found = list.devices?.find(d => d.id === (alert.deviceid || alert.deviceId));
        if (found) {
          setDevice(found);
          // Fallback to device location if alert didn't provide coordinates
          if (lat === 0 || lng === 0) {
            const dLat = parseFloat(found.motion_lat) || 0;
            const dLng = parseFloat(found.motion_lon) || 0;
            if (dLat !== 0) {
              setLat(dLat);
              setLng(dLng);
              try {
                const fallbackAddr = await reverseGeocode(dLat, dLng);
                setAddress(fallbackAddr || 'Address Not Available');
              } catch (_) { }
            }
          }
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, [alert.id]);

  const rawType = alert.type || '';
  const cleanType = rawType.split(',')[0].trim();
  const displayName = ALERT_MAPPING[cleanType] || cleanType;
  const timeFormatted = moment(alert.eventtime || alert.serverTime).format('MMM DD, YYYY hh:mm A');

  return (
    <View style={styles.container}>
      <Header title="Alert Details" navigation={navigation} showBack />

      {/* Map View */}
      {lat !== 0 && lng !== 0 ? (
        <View style={styles.mapContainer}>
          <WebView originWhitelist={['*']} source={{ html: mapHtml }} style={styles.map} javaScriptEnabled />
        </View>
      ) : (
        <View style={styles.noMapBox}>
          <Icon name="map-marker-off" size={48} color="#94a3b8" />
          <Text style={styles.noMapText}>No coordinates found for this alert</Text>
        </View>
      )}

      {/* Alert details card */}
      <View style={[styles.detailsCard, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.alertIconBg}>
            <Icon name="bell-alert-outline" size={24} color="#ef4444" />
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.alertName}>{displayName}</Text>
            <Text style={styles.alertTime}>{timeFormatted}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Icon name="car" size={18} color="#64748b" style={styles.icon} />
          <View style={styles.infoMeta}>
            <Text style={styles.label}>DG Name</Text>
                        <Text style={styles.value}>{device?.name ?? 'N/A'}</Text>
          </View>
        </View>

        {device?.uniqueid && (
          <View style={styles.row}>
            <Icon name="barcode-scan" size={18} color="#64748b" style={styles.icon} />
            <View style={styles.infoMeta}>
              <Text style={styles.label}>IMEI / Unique ID</Text>
              <Text style={styles.value}>{device.uniqueid}</Text>
            </View>
          </View>
        )}

        {device?.iccid && (
          <View style={styles.row}>
            <Icon name="barcode-scan" size={18} color="#64748b" style={styles.icon} />
            <View style={styles.infoMeta}>
              <Text style={styles.label}>ICCID</Text>
              <Text style={styles.value}>{device.iccid}</Text>
            </View>
          </View>
        )}

        <View style={styles.row}>
          <Icon name="map-marker-outline" size={18} color="#10b981" style={styles.icon} />
          <View style={styles.infoMeta}>
            <Text style={styles.label}>Trigger Location</Text>
            <Text style={styles.value} numberOfLines={2}>{address}</Text>
          </View>
        </View>

        {lat !== 0 && (
          <View style={styles.row}>
            <Icon name="compass-outline" size={18} color="#64748b" style={styles.icon} />
            <View style={styles.infoMeta}>
              <Text style={styles.label}>Coordinates</Text>
              <Text style={styles.value}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  noMapBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  noMapText: { marginTop: 12, color: '#64748b', fontSize: 14, fontWeight: '500' },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    elevation: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  alertIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerInfo: { flex: 1 },
  alertName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  alertTime: { fontSize: 12, color: '#64748b', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  icon: { marginRight: 12, marginTop: 2 },
  infoMeta: { flex: 1 },
  label: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: '600' },
  value: { fontSize: 13.5, color: '#1e293b', fontWeight: '700', marginTop: 2, lineHeight: 18 },
});

export default AlertDetailsScreen;
