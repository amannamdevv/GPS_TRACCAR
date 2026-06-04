import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Animated,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchDeviceList, reverseGeocode } from '../../api/webApi';

const { width } = Dimensions.get('window');
const REFRESH_INTERVAL = 5000;

const TrackingScreen = ({ route, navigation }) => {
  const { device: initialDevice } = route.params;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);

  const [device, setDevice] = useState(initialDevice);
  const [address, setAddress] = useState('Fetching address...');
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [followMode, setFollowMode] = useState(true);
  const [showPanel, setShowPanel] = useState(false); // Default hidden, shown on marker click

  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: showPanel ? 0 : 300,
      useNativeDriver: true,
      tension: 50,
      friction: 8
    }).start();
  }, [showPanel]);

  // ─── LEAFLET HTML ──────────────────────────────────────────────────────────
  const mapHtml = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Device Tracking</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; background: #1a202c; }
        .leaflet-popup-content-wrapper { background: rgba(20, 20, 20, 0.85); color: #fff; border-radius: 8px; padding: 0; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        .leaflet-popup-content { margin: 12px; font-size: 11px; line-height: 1.5; font-family: sans-serif; white-space: pre-wrap; }
        .leaflet-popup-tip { background: rgba(20, 20, 20, 0.85); }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false }).setView([20, 78], 5);
        L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
          attribution: '&copy; Google Maps'
        }).addTo(map);

        var marker = null;
        var pathLine = L.polyline([], { color: '#0284c7', weight: 4, opacity: 0.8 }).addTo(map);

        function createCustomIcon(status, course) {
          var color = '#F44336'; // offline
          if (status === 'online') {
            color = '#4CAF50';
          }
          var rotation = course || 0;
          return L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="transform: rotate(' + rotation + 'deg); width: 30px; height: 30px; background: ' + color + '; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid white; margin-top: -4px;"></div></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
        }

        window.dispatchTrackingAction = function(actionStr) {
          var data = JSON.parse(actionStr);
          if (data.type === 'UPDATE_POSITION') {
            var latlng = [data.lat, data.lng];
            
            var popupHtml = 'Status:' + (data.status.charAt(0).toUpperCase() + data.status.slice(1)) + '\\n' +
                            'Time:' + data.time + '\\n' +
                            'Engine:' + data.engine + '\\n' +
                            'Battery:' + data.battery + '\\n' +
                            (data.alarm ? 'Alarm: ' + data.alarm + '\\n' : '') +
                            'External Voltage:' + data.voltage + '\\n' +
                            'Distance:' + data.distance;

            if (marker) {
              marker.setLatLng(latlng);
              marker.setIcon(createCustomIcon(data.status, data.course));
              marker.setPopupContent(popupHtml);
            } else {
              marker = L.marker(latlng, { icon: createCustomIcon(data.status, data.course) }).bindPopup(popupHtml, {
                closeButton: false,
                offset: [0, -10]
              }).addTo(map);
              marker.openPopup();
            }
            
            // Add to polyline path
            var pathCoords = pathLine.getLatLngs();
            pathCoords.push(latlng);
            pathLine.setLatLngs(pathCoords);

            if (data.follow) {
              map.setView(latlng, 17);
            }
          }
        };

        setTimeout(function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'MAP_READY'}));
        }, 500);
      </script>
    </body>
    </html>
  `, []);

  const sendToMap = useCallback((type, payload = {}) => {
    if (!webViewRef.current) return;
    const actionStr = JSON.stringify({ type, ...payload });
    webViewRef.current.injectJavaScript(`window.dispatchTrackingAction(${JSON.stringify(actionStr)}); true;`);
  }, []);

  const updateLocationDetails = useCallback(async (lat, lon) => {
    try {
      const addr = await reverseGeocode(lat, lon);
      setAddress(addr || 'Address Not Found');
    } catch (_) {
      setAddress('Error loading address');
    }
  }, []);

  const fetchLivePosition = useCallback(async () => {
    try {
      const data = await fetchDeviceList();
      const list = data.devices || [];
      const updated = list.find(d => d.id === device.id);
      if (updated) {
        setDevice(updated);
        const lat = parseFloat(updated.motion_lat) || 0;
        const lng = parseFloat(updated.motion_lon) || 0;
        if (mapReady && lat !== 0) {
          const attr = updated.attributes || {};
          let powerStr = attr.power ?? attr.battery ?? attr.io1 ?? attr.adc1;
          powerStr = powerStr != null ? parseFloat(powerStr).toFixed(1) + 'V' : '0.0V';
          const distStr = attr.totalDistance != null ? (attr.totalDistance / 1000).toFixed(2) + 'km' : (updated.totalDist ? updated.totalDist + 'km' : '0.00km');

          sendToMap('UPDATE_POSITION', {
            lat,
            lng,
            status: updated.status,
            course: updated.course || 0,
            follow: followMode,
            time: (updated.position_time || '').replace('T', ' ').substring(0, 19),
            engine: (updated.ignition || attr.ignition) ? 'ON' : 'OFF',
            battery: updated.battery_level || attr.batteryLevel || 0,
            alarm: updated.alarm || attr.alarm || '',
            voltage: powerStr,
            distance: distStr,
          });
        }
        updateLocationDetails(lat, lng);
      }
    } catch (e) {
      console.warn('Tracking Sync Error:', e.message);
    } finally {
      setLoading(false);
    }
  }, [device.id, mapReady, followMode, sendToMap, updateLocationDetails]);

  useEffect(() => {
    if (mapReady) {
      const lat = parseFloat(device.motion_lat) || 0;
      const lng = parseFloat(device.motion_lon) || 0;
      if (lat !== 0) {
        const attr = device.attributes || {};
        let powerStr = attr.power ?? attr.battery ?? attr.io1 ?? attr.adc1;
        powerStr = powerStr != null ? parseFloat(powerStr).toFixed(1) + 'V' : '0.0V';
        const distStr = attr.totalDistance != null ? (attr.totalDistance / 1000).toFixed(2) + 'km' : (device.totalDist ? device.totalDist + 'km' : '0.00km');

        sendToMap('UPDATE_POSITION', {
          lat,
          lng,
          status: device.status,
          course: device.course || 0,
          follow: followMode,
          time: (device.position_time || '').replace('T', ' ').substring(0, 19),
          engine: (device.ignition || attr.ignition) ? 'ON' : 'OFF',
          battery: device.battery_level || attr.batteryLevel || 0,
          alarm: device.alarm || attr.alarm || '',
          voltage: powerStr,
          distance: distStr,
        });
        updateLocationDetails(lat, lng);
      }
    }
  }, [mapReady]);

  useEffect(() => {
    fetchLivePosition();
    // Auto refresh removed to reduce server load
    // const interval = setInterval(fetchLivePosition, REFRESH_INTERVAL);
    // return () => clearInterval(interval);
  }, [fetchLivePosition]);

  const onMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setMapReady(true);
      } else if (data.type === 'MARKER_CLICK') {
        setShowPanel(true);
      }
    } catch (e) {}
  };

  const isOnline = device.status === 'online';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color="#0f172a" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{device.name}</Text>
          <Text style={styles.headerSubtitle}>{device.iccid || device.uniqueId || 'No IMEI'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.followBtn, followMode && styles.followBtnActive]}
          onPress={() => setFollowMode(!followMode)}
        >
          <Icon name="navigation" size={20} color={followMode ? '#FFFFFF' : '#475569'} />
        </TouchableOpacity>
      </View>

      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />

      <View style={styles.addressBar}>
        <Text style={styles.addressBarText} numberOfLines={2}>
          {address}
        </Text>
      </View>

      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#0284c7" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  map: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    elevation: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  headerSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  followBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  followBtnActive: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  addressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(20, 25, 35, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
  },
  addressBarText: {
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  loader: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 255, 255, 0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
});

export default TrackingScreen;
