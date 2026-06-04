import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  TextInput,
  FlatList,
  Dimensions,
  Animated,
  StatusBar, Alert,
  PermissionsAndroid,
  Platform,
  Linking,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from '@react-native-community/geolocation';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import notifee, { AndroidImportance } from '@notifee/react-native';
import AlertNotificationService from '../../services/AlertNotificationService';

// API Services
import { fetchDeviceList, reverseGeocode } from '../../api/webApi';

const { height, width } = Dimensions.get('window');
const REFRESH_INTERVAL = 5000;

async function displayNotification(title, body, timestamp) {
  try {
    const channelId = await notifee.createChannel({
      id: 'alerts',
      name: 'Vehicle Alerts',
      importance: AndroidImportance.HIGH,
    });

    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        showTimestamp: !!timestamp,
        timestamp: timestamp || undefined,
        pressAction: { id: 'default' },
      },
    });
  } catch (error) {
    console.log('Notification error:', error);
  }
}

const MapScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);
  const prevPositionsRef = useRef({});
  const seenAlarmsRef = useRef(new Set());
  const isFirstAlarmsFetchRef = useRef(true);
  const isFetchingRef = useRef(false);
  const lastAlarmsFetchRef = useRef(0);

  // ─── STATE ──────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState([]);
  const [positions, setPositions] = useState({});
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [mapLayer, setMapLayer] = useState('standard');
  const [followMode, setFollowMode] = useState(false);

  // Bottom action panel animation
  const slideAnim = useRef(new Animated.Value(300)).current;

  const selectedDevice = useMemo(() => {
    return devices.find(d => d.id === selectedDeviceId);
  }, [devices, selectedDeviceId]);

  // Slide up panel when device selected, slide down when deselected
  useEffect(() => {
    if (selectedDeviceId) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 250,
        useNativeDriver: true
      }).start();
    }
  }, [selectedDeviceId]);

  // ─── LEAFLET CORE ──────────────────────────────────────────────────────────
  const mapHtml = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Traccar Map</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; background: #e8eaed; }
        .leaflet-popup-content-wrapper { background: #212121; color: #fff; border-radius: 8px; padding: 0; box-shadow: 0 4px 15px rgba(0,0,0,0.4); }
        .leaflet-popup-content { margin: 0; width: 220px !important; }
        .popup-header { padding: 10px 12px; background: #27272a; border-top-left-radius: 8px; border-top-right-radius: 8px; font-weight: bold; font-size: 13px; border-bottom: 1px solid #3f3f46; }
        .popup-body { padding: 10px 12px; font-size: 11px; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { color: #a1a1aa; }
        .popup-value { color: #fff; font-weight: 600; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var indiaBounds = [[6.4626999, 68.1097], [35.513327, 97.3953586]];
        var map = L.map('map', { 
          zoomControl: false,
          maxBounds: indiaBounds,
          maxBoundsViscosity: 1.0,
          minZoom: 4
        }).setView([20.5937, 78.9629], 5);
        
        var layers = {
          standard: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
          satellite: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
          terrain: L.tileLayer('https://mt1.google.com/vt/lyrs=t&x={x}&y={y}&z={z}')
        };
        
        layers.standard.addTo(map);
        var markers = {};
        var isFirstFit = true;
        var myLocMarker = null;

        function getStatusColor(pos) {
          var isMoving = pos.motion_status === 'moving' || pos.motion_status === 'true' || pos.motion_status === true || pos.motion_status === 1 || pos.motion_status === '1';
          if (isMoving) return '#10b981'; // Green
          if (pos.status === 'online') return '#10b981'; // Green
          return '#ef4444'; // Red
        }

        function createCustomIcon(pos) {
          var color = getStatusColor(pos);
          var rotation = pos.course || 0;
          return L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="transform: rotate(' + rotation + 'deg); width: 30px; height: 30px; background: ' + color + '; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid white; margin-top: -4px;"></div></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
        }

        function buildPopup(pos) {
          var speedKmh = pos.speedKmh || 0;
          var ignition = pos.ignition_status ? 'On' : 'Off';
          var battery = pos.battery_level != null ? pos.battery_level + '%' : 'N/A';
          var alarm = pos.alarm ? pos.alarm : '—';
          var address = pos.address || 'Unknown';
          return '<div class="popup-header">' + pos.name + '</div>' +
                 '<div class="popup-body">' +
                 '<div class="popup-row"><span class="popup-label">Status</span><span class="popup-value" style="color:' + getStatusColor(pos) + '">' + pos.status.toUpperCase() + '</span></div>' +
                 '<div class="popup-row"><span class="popup-label">Speed</span><span class="popup-value">' + speedKmh + ' km/h</span></div>' +
                 '<div class="popup-row"><span class="popup-label">Ignition</span><span class="popup-value">' + ignition + '</span></div>' +
                 '<div class="popup-row"><span class="popup-label">Battery</span><span class="popup-value">' + battery + '</span></div>' +
                 '<div class="popup-row"><span class="popup-label">Alarm</span><span class="popup-value">' + alarm + '</span></div>' +
                 '<div class="popup-row"><span class="popup-label">DG</span><span class="popup-value">' + (pos.dg_status || 'N/A') + '</span></div>' +
                 '<div class="popup-row"><span class="popup-label">Address</span><span class="popup-value">' + address + '</span></div>' +
                 '</div>';
        }

        window.dispatchMapAction = function(actionStr) {
          try {
            var data = JSON.parse(actionStr);
            
            if (data.type === 'UPDATE_MARKERS') {
              var bounds = [];
              data.positions.forEach(function(pos) {
                if (!pos.latitude || !pos.longitude) return;
                var latlng = [pos.latitude, pos.longitude];
                
                if (markers[pos.deviceId]) {
                  markers[pos.deviceId].setLatLng(latlng);
                  markers[pos.deviceId].setIcon(createCustomIcon(pos));
                } else {
                  markers[pos.deviceId] = L.marker(latlng, { icon: createCustomIcon(pos) }).addTo(map);
                  markers[pos.deviceId].on('click', function() {
                    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'MARKER_CLICK', id: pos.deviceId}));
                  });
                }
                bounds.push(latlng);
              });

              if (isFirstFit && bounds.length > 0) {
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                isFirstFit = false;
              }
            }

            if (data.type === 'FOCUS_DEVICE') {
              if (!data.lat || !data.lng) return;
              map.setView([data.lat, data.lng], 16);
            }

            if (data.type === 'SET_LAYER') {
              map.eachLayer(function(l) { if (l instanceof L.TileLayer) map.removeLayer(l); });
              layers[data.layer].addTo(map);
            }

            if (data.type === 'ZOOM_IN') map.zoomIn();
            if (data.type === 'ZOOM_OUT') map.zoomOut();

            if (data.type === 'LOCATE_ME_NATIVE') {
              var latlng = [data.lat, data.lng];
              if(myLocMarker) map.removeLayer(myLocMarker);
              myLocMarker = L.circleMarker(latlng, {
                radius: 8, fillColor: '#2196F3', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
              }).addTo(map);
              
              if (!data.noPan) {
                if (data.fitAll) {
                  var allBounds = [latlng];
                  for (var id in markers) {
                    allBounds.push(markers[id].getLatLng());
                  }
                  if (allBounds.length > 1) {
                    map.fitBounds(allBounds, { padding: [50, 50], maxZoom: 16 });
                  } else {
                    map.setView(latlng, 16);
                  }
                } else {
                  map.setView(latlng, 16);
                }
              }
            }
          } catch(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ERROR', msg: e.message}));
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
    webViewRef.current.injectJavaScript(`window.dispatchMapAction(${JSON.stringify(actionStr)}); true;`);
  }, []);

  // ─── DATA SYNC ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      try {
        const data = await fetchDeviceList();
        const devicesData = data.devices || [];

        setDevices(devicesData);
        const posMap = {};
        const prevPosMap = prevPositionsRef.current;

        // Build position objects with telemetry and address (fallback to previous address)
        devicesData.forEach((device) => {
          const prevPosForDevice = prevPosMap[device.id];
          const pos = {
            deviceId: device.id,
            latitude: parseFloat(device.motion_lat) || 0,
            longitude: parseFloat(device.motion_lon) || 0,
            name: device.name || 'Unknown',
            status: device.status || 'unknown',
            motion_status: device.motion_status,
            battery_level: device.battery_level,
            dg_status: device.dg_status,
            ignition_status: device.ignition_status,
            battery_status: device.battery_status,
            fixTime: device.position_time,
            address: device.address || prevPosForDevice?.address || null,
            speedKmh: device.speedKmh ?? device.speed ?? 0,
            alarm: device.alarm ?? null,
          };
          posMap[device.id] = pos;
        });

        prevPositionsRef.current = posMap;
        setPositions(posMap);

        // If map is ready, send initial markers and focus nearest device
        if (mapReady) {
          sendToMap('UPDATE_MARKERS', { positions: Object.values(posMap) });
          focusNearestDevice(Object.values(posMap));
          // Auto-show user's current location blue dot
          showMyLocation();
        }

        const now = Date.now();
        // Placeholder for alarm fetching logic.
        // Update lastAlarmsFetchRef to current time.
        lastAlarmsFetchRef.current = now;
      } catch (e) {
        console.warn(e);
      } finally {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }, [mapReady]);

    // Helper to compute haversine distance
    const haversine = (lat1, lon1, lat2, lon2) => {
      const toRad = (deg) => (deg * Math.PI) / 180;
      const R = 6371; // km
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.asin(Math.sqrt(a));
    };

const focusNearestDevice = (positionsArray) => {
  Geolocation.getCurrentPosition(
    (loc) => {
      const { latitude: myLat, longitude: myLon } = loc.coords;
      let nearest = null;
      let minDist = Infinity;
      positionsArray.forEach((p) => {
        if (!p.latitude || !p.longitude) return;
        const d = haversine(myLat, myLon, p.latitude, p.longitude);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      });
      if (nearest) {
        sendToMap('FOCUS_DEVICE', { lat: nearest.latitude, lng: nearest.longitude });
      }
    },
    (err) => {
      console.warn('Geolocation error', err);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
  );
};

  useEffect(() => {
    notifee.requestPermission();
    const unsubNet = NetInfo.addEventListener(state => setIsOnline(state.isConnected));
    return () => { unsubNet(); };
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      const interval = setInterval(fetchData, 10000); // Poll every 10s while focused
      return () => clearInterval(interval);
    }, [fetchData])
  );

  // Handle params focus
  useEffect(() => {
    if (route.params?.focusDevice) {
      const device = route.params.focusDevice;
      setTimeout(() => focusDevice(device), 1000);
      navigation.setParams({ focusDevice: undefined });
    }
  }, [route.params, mapReady]);

  const onMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setMapReady(true);
        setLoading(false);
        // When map is ready, send markers and focus nearest device
        if (Object.keys(positions).length > 0) {
          sendToMap('UPDATE_MARKERS', { positions: Object.values(positions) });
          focusNearestDevice(Object.values(positions));
        }
        // Auto-show user's current location blue dot
        showMyLocation();
      } else if (data.type === 'MARKER_CLICK') {
        const dev = devices.find(d => d.id === data.id);
        if (dev) {
          focusDevice(dev);
        }
      }
    } catch (e) {}
  };

  const focusDevice = async (device) => {
    setSelectedDeviceId(device.id);
    const lat = parseFloat(device.motion_lat) || 0;
    const lng = parseFloat(device.motion_lon) || 0;
    if (lat !== 0 && mapReady) {
      sendToMap('FOCUS_DEVICE', { deviceId: device.id, lat, lng });

      // Fetch Address
      const pos = positions[device.id];
      if (pos && !pos.address) {
        if (device.address) {
          setPositions(prev => ({
            ...prev,
            [device.id]: { ...pos, address: device.address }
          }));
          if (prevPositionsRef.current[device.id]) {
            prevPositionsRef.current[device.id].address = device.address;
          }
        } else {
          const addr = await reverseGeocode(lat, lng);
          setPositions(prev => ({
            ...prev,
            [device.id]: { ...pos, address: addr }
          }));
          if (prevPositionsRef.current[device.id]) {
            prevPositionsRef.current[device.id].address = addr;
          }
        }
      }
    }
  };

  // Auto-center and show blue dot on user's current location
  const showMyLocation = useCallback(() => {
    Geolocation.getCurrentPosition(
      position => {
        sendToMap('LOCATE_ME_NATIVE', {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          fitAll: true
        });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [sendToMap]);

  // Button press: same behavior
  const locateMe = () => {
    Geolocation.getCurrentPosition(
      position => {
        sendToMap('LOCATE_ME_NATIVE', {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      error => Alert.alert('Location Error', 'GPS might be disabled.'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  // Actions
  const openNavigation = () => {
    if (!selectedDevice) return;
    const lat = parseFloat(selectedDevice.motion_lat);
    const lon = parseFloat(selectedDevice.motion_lon);
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lon}`,
      android: `geo:0,0?q=${lat},${lon}`
    });
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Failed to launch Maps'));
  };

  const handleSendCommand = () => {
    Alert.alert('Send Command', 'Command system is under development.');
  };

  // Autocomplete / Search filters
  const filteredSearchList = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return devices.filter(d =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.iccid || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [devices, searchQuery]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
      />

      {/* Floating Header Search Box */}
      <View style={[styles.searchBoxWrapper, { top: insets.top + 10 }]}>
        <View style={styles.searchBar}>
          <Icon name="magnify" size={22} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search vehicles..."
            value={searchQuery}
            onChangeText={(t) => {
              setSearchQuery(t);
              setShowSearchResults(t.length > 0);
            }}
            placeholderTextColor="#94a3b8"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setShowSearchResults(false); }}>
              <Icon name="close-circle" size={20} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>

        {showSearchResults && filteredSearchList.length > 0 && (
          <View style={styles.searchResultsDropdown}>
            <FlatList
              data={filteredSearchList}
              keyExtractor={item => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => {
                    focusDevice(item);
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }}
                >
                  <Icon name="car" size={18} color="#64748b" style={{ marginRight: 10 }} />
                  <Text style={styles.searchResultText}>{item.name}</Text>
                  <View style={[styles.statusDot, { backgroundColor: item.status === 'online' ? '#10b981' : '#ef4444', marginLeft: 'auto' }]} />
                </TouchableOpacity>
              )}
              style={{ maxHeight: 200 }}
            />
          </View>
        )}
      </View>

      {/* Floating Side Action buttons (Layer, Locate, Refresh) */}
      <View style={styles.sideControls}>
        <TouchableOpacity style={styles.circleButton} onPress={() => {
          const next = mapLayer === 'standard' ? 'satellite' : mapLayer === 'satellite' ? 'terrain' : 'standard';
          setMapLayer(next);
          sendToMap('SET_LAYER', { layer: next });
        }}>
          <Icon name="layers-outline" size={20} color="#0f172a" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.circleButton} onPress={locateMe}>
          <Icon name="crosshairs-gps" size={20} color="#0284c7" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.circleButton, followMode && styles.activeCircleButton]} onPress={() => setFollowMode(!followMode)}>
          <Icon name="navigation" size={20} color={followMode ? '#FFFFFF' : '#0f172a'} />
        </TouchableOpacity>
      </View>

      {/* Offline sync banner */}
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>SYNCING WITH SERVER...</Text>
        </View>
      )}

      {/* REDESIGNED: Sleek Action Panel */}
      {selectedDevice && (
        <Animated.View style={[styles.actionPanel, { transform: [{ translateY: slideAnim }], paddingBottom: insets.bottom + 16 }]}>
          {/* Grab handle / header */}
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleContainer}>
              <Text style={styles.panelTitle}>{selectedDevice.name}</Text>
              <Text style={styles.panelSubtitle}>{selectedDevice.iccid || 'No IMEI'}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedDeviceId(null)}>
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Quick status bar inside panel */}
          <View style={styles.statusMetricsRow}>
            <View style={styles.metricItem}>
              <Icon name="speedometer" size={14} color="#64748b" />
              <Text style={styles.metricText}>{selectedDevice.speedKmh || 0} km/h</Text>
            </View>
            <View style={styles.metricItem}>
              <Icon name="battery" size={14} color="#10b981" />
              <Text style={styles.metricText}>{selectedDevice.battery_level ? `${selectedDevice.battery_level}%` : 'N/A'}</Text>
            </View>
            <View style={[styles.statusDotLabel, { backgroundColor: selectedDevice.status === 'online' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }]}>
              <View style={[styles.dotIndicator, { backgroundColor: selectedDevice.status === 'online' ? '#10b981' : '#ef4444' }]} />
              <Text style={[styles.dotLabelText, { color: selectedDevice.status === 'online' ? '#10b981' : '#ef4444' }]}>
                {selectedDevice.status === 'online' ? 'ONLINE' : 'OFFLINE'}
              </Text>
            </View>
          </View>

          <Text style={styles.addressLine} numberOfLines={1}>
            📍 {positions[selectedDeviceId]?.address || 'Resolving address...'}
          </Text>

          <View style={styles.panelDivider} />

          {/* 6 Actions Grid */}
          <View style={styles.actionsGrid}>
            {[
              { label: 'Detail', icon: 'card-bulleted-settings-outline', action: () => navigation.navigate('DetailInfo', { device: selectedDevice }) },
              { label: 'Tracking', icon: 'crosshairs-gps', action: () => navigation.navigate('Tracking', { device: selectedDevice }) },
              { label: 'Playback', icon: 'history', action: () => navigation.navigate('Playback', { device: selectedDevice }) },
              { label: 'Navigation', icon: 'google-maps', action: openNavigation }
            ].map((btn, idx) => (
              <TouchableOpacity key={idx} style={styles.actionGridItem} onPress={btn.action}>
                <View style={styles.actionIconBox}>
                  <Icon name={btn.icon} size={22} color="#1565C0" />
                </View>
                <Text style={styles.actionLabel}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1565C0" />
          <Text style={styles.loadingText}>SYNCHRONIZING FLEET...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  map: { flex: 1 },
  searchBoxWrapper: { position: 'absolute', left: 16, right: 16, zIndex: 100 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 16,
    height: 48,
    elevation: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  searchInput: { flex: 1, height: '100%', color: '#0f172a', fontSize: 14, fontWeight: '500' },
  searchResultsDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginTop: 8,
    paddingVertical: 8,
    elevation: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchResultText: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sideControls: { position: 'absolute', right: 16, top: 150, zIndex: 90, gap: 10 },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  activeCircleButton: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  offlineBar: { position: 'absolute', top: 120, alignSelf: 'center', backgroundColor: '#ef4444', paddingHorizontal: 15, paddingVertical: 6, borderRadius: 20, elevation: 5 },
  offlineText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  loadingText: { marginTop: 12, color: '#1565C0', fontWeight: '800', fontSize: 12, letterSpacing: 1 },

  // Sleek Bottom Action Panel
  actionPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    elevation: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  panelTitleContainer: { flex: 1 },
  panelTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  panelSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  closeBtn: { padding: 6, backgroundColor: '#f1f5f9', borderRadius: 20 },
  statusMetricsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  metricItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  statusDotLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12 },
  dotIndicator: { width: 6, height: 6, borderRadius: 3 },
  dotLabelText: { fontSize: 10, fontWeight: '700' },
  addressLine: { fontSize: 12, color: '#64748b', marginBottom: 14 },
  panelDivider: { height: 1, backgroundColor: '#f1f5f9', marginBottom: 14 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  actionGridItem: { width: '30%', alignItems: 'center', marginBottom: 12 },
  actionIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  actionLabel: { fontSize: 11, fontWeight: '600', color: '#334155' },
});

export default MapScreen;
