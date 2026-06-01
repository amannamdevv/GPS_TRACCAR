import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  StatusBar,
  Alert,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from '@react-native-community/geolocation';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import notifee, { AndroidImportance } from '@notifee/react-native';
import AlertNotificationService from '../../services/AlertNotificationService';

// API Services
import { fetchDeviceList, reverseGeocode, fetchAlarms } from '../../api/webApi';

const { height } = Dimensions.get('window');
const REFRESH_INTERVAL = 5000; 

// ─── NOTIFICATION HELPER ──────────────────────────────────────────────────────
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
        smallIcon: 'ic_launcher', // ensures it works on all android versions
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
  const [filter, setFilter] = useState('all'); 
  const [mapLayer, setMapLayer] = useState('standard'); 
  const [followMode, setFollowMode] = useState(false);
  
  // UI State
  const [bottomSheetHeight] = useState(new Animated.Value(220));
  const [isExpanded, setIsExpanded] = useState(false);

  // ─── LEAFLET CORE (ROBUST VERSION) ──────────────────────────────────────────
  const mapHtml = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Traccar Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; font-family: 'Roboto', sans-serif; }
        #map { height: 100vh; width: 100vw; background: #e8eaed; }
        
        .leaflet-popup-content-wrapper { background: #212121; color: #fff; border-radius: 6px; padding: 0; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        .leaflet-popup-content { margin: 0; width: 260px !important; }
        .popup-header { padding: 12px; background: #333; border-top-left-radius: 6px; border-top-right-radius: 6px; border-bottom: 1px solid #444; font-weight: bold; font-size: 14px; }
        .popup-body { padding: 12px; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; }
        .popup-label { color: #aaa; }
        .popup-value { color: #fff; font-weight: 500; }
        .popup-footer { padding: 10px; border-top: 1px solid #444; display: flex; justify-content: space-between; }
        .action-icon { font-size: 18px; cursor: pointer; color: #4CAF50; }
        
        .device-marker { transition: transform 0.3s ease-out, all 0.3s; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false }).setView([20, 78], 5);
        
        var layers = {
          standard: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps'
          }),
          satellite: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps'
          }),
          terrain: L.tileLayer('https://mt1.google.com/vt/lyrs=t&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps'
          })
        };
        
        layers.standard.addTo(map);
        var markers = {};
        var historyLayer = L.layerGroup().addTo(map);
        var isFirstFit = true;
        var myLocMarker = null;

        function getStatusColor(pos) {
          var isMoving = pos.motion_status === 'moving' || pos.motion_status === 'true' || pos.motion_status === true || pos.motion_status === 1 || pos.motion_status === '1';
          if (isMoving) return '#4CAF50'; 
          if (pos.status === 'online') return '#2196F3'; 
          return '#F44336'; 
        }

        function createCustomIcon(pos) {
          var color = getStatusColor(pos);
          var rotation = pos.course || 0;
          return L.divIcon({
            className: 'custom-div-icon',
            html: \`<div style="transform: rotate(\${rotation}deg); width: 30px; height: 30px; background: \${color}; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid white; margin-top: -4px;"></div>
                   </div>\`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
        }

        function buildPopup(pos) {
          var fixTime = pos.fixTime ? new Date(pos.fixTime).toLocaleString() : 'N/A';
          var isMoving = pos.motion_status === 'moving' || pos.motion_status === 'true' || pos.motion_status === true || pos.motion_status === 1 || pos.motion_status === '1';
          var motionText = isMoving ? 'Moving' : 'Stopped';
          
          var isDgOn = pos.dg_status === 1 || pos.dg_status === '1' || pos.dg_status?.toString().toLowerCase() === 'on' || pos.dg_status?.toString().toLowerCase() === 'true';
          var dgText = isDgOn ? 'ON' : 'OFF';
          
          var isIgnOn = pos.ignition_status === 1 || pos.ignition_status === '1' || pos.ignition_status?.toString().toLowerCase() === 'on' || pos.ignition_status?.toString().toLowerCase() === 'true';
          var ignText = isIgnOn ? 'ON' : 'OFF';

          return \`
            <div class="popup-header">\${pos.name}</div>
            <div class="popup-body">
              <div class="popup-row"><span class="popup-label">Status</span><span class="popup-value">\${pos.status.toUpperCase()}</span></div>
              <div class="popup-row"><span class="popup-label">Motion</span><span class="popup-value">\${motionText}</span></div>
              <div class="popup-row"><span class="popup-label">Battery</span><span class="popup-value" style="color:#10b981">\${pos.battery_level ? pos.battery_level + '%' : 'N/A'}</span></div>
              <div class="popup-row"><span class="popup-label">DG Status</span><span class="popup-value">\${dgText}</span></div>
              <div class="popup-row"><span class="popup-label">DG</span><span class="popup-value">\${ignText}</span></div>
              <div class="popup-row"><span class="popup-label">Address</span><span class="popup-value" style="color:#2196F3">\${pos.address || (pos.latitude.toFixed(5) + ", " + pos.longitude.toFixed(5))}</span></div>
              <div class="popup-row"><span class="popup-label">Fix Time</span><span class="popup-value">\${fixTime}</span></div>
            </div>
          \`;
        }

        // Global Dispatcher for React Native
        window.dispatchMapAction = function(actionStr) {
          try {
            var data = JSON.parse(actionStr);
            
            if (data.type === 'UPDATE_MARKERS') {
              var bounds = [];
              data.positions.forEach(function(pos) {
                if (!pos.latitude || !pos.longitude || pos.latitude === 0 || pos.longitude === 0) {
                  return;
                }
                var latlng = [pos.latitude, pos.longitude];
                if (markers[pos.deviceId]) {
                  markers[pos.deviceId].setLatLng(latlng);
                  markers[pos.deviceId].setIcon(createCustomIcon(pos));
                  if (markers[pos.deviceId].isPopupOpen()) {
                    markers[pos.deviceId].setPopupContent(buildPopup(pos));
                  }
                } else {
                  markers[pos.deviceId] = L.marker(latlng, { icon: createCustomIcon(pos) }).addTo(map);
                  markers[pos.deviceId].bindPopup(buildPopup(pos), { offset: [0, -10] });
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
              if (!data.lat || !data.lng || data.lat === 0 || data.lng === 0) return;
              map.setView([data.lat, data.lng], 16);
              if (markers[data.deviceId]) {
                if (data.address) {
                  // Temporarily update marker popup with fresh address
                  markers[data.deviceId].bindPopup(buildPopup({
                    deviceId: data.deviceId,
                    latitude: data.lat,
                    longitude: data.lng,
                    name: data.name || 'Device', 
                    status: data.status || 'online',
                    motion_status: data.motion_status,
                    battery_level: data.battery_level,
                    dg_status: data.dg_status,
                    ignition_status: data.ignition_status,
                    fixTime: data.fixTime || new Date().toISOString(),
                    address: data.address
                  })).openPopup();
                } else {
                  markers[data.deviceId].openPopup();
                }
              }
            }

            if (data.type === 'SET_LAYER') {
              map.eachLayer(function(l) { if (l instanceof L.TileLayer) map.removeLayer(l); });
              layers[data.layer].addTo(map);
            }

            if (data.type === 'ZOOM_IN') map.zoomIn();
            if (data.type === 'ZOOM_OUT') map.zoomOut();

            if (data.type === 'LOCATE_ME_NATIVE') {
              var latlng = [data.lat, data.lng];
              map.setView(latlng, 16);
              if(myLocMarker) map.removeLayer(myLocMarker);
              myLocMarker = L.circleMarker(latlng, {
                radius: 8, fillColor: '#2196F3', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
              }).addTo(map).bindPopup("You are here").openPopup();
            }

            if (data.type === 'SHOW_HISTORY') {
              historyLayer.clearLayers();
              if (data.coords && data.coords.length > 0) {
                var poly = L.polyline(data.coords, { color: '#1E88E5', weight: 4, opacity: 0.8 }).addTo(historyLayer);
                
                // Start Marker (Green)
                L.circleMarker(data.coords[0], { radius: 6, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(historyLayer).bindPopup("<b>TRIP START</b><br>" + data.startTime);
                
                // End Marker (Red)
                L.circleMarker(data.coords[data.coords.length - 1], { radius: 6, fillColor: '#F44336', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(historyLayer).bindPopup("<b>TRIP END</b><br>" + data.endTime);
                
                map.fitBounds(poly.getBounds(), { padding: [40, 40] });
              }
            }

            if (data.type === 'CLEAR_HISTORY') {
              historyLayer.clearLayers();
            }
          } catch(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ERROR', msg: e.message}));
          }
        };

        // Current Location Handlers
        map.on('locationfound', function(e) {
          if(myLocMarker) map.removeLayer(myLocMarker);
          myLocMarker = L.circleMarker(e.latlng, {
            radius: 8, fillColor: '#2196F3', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
          }).addTo(map).bindPopup("You are here").openPopup();
        });

        map.on('locationerror', function(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ERROR', msg: 'Could not find location. Please enable GPS.'}));
        });

        // Notify ready
        setTimeout(function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: 'MAP_READY'}));
        }, 500);

      </script>
    </body>
    </html>
  `, []);

  // ─── ROBUST COMMUNICATION ───────────────────────────────────────────────────
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
      
      devicesData.forEach((device) => { 
        // Build position object for each device to be in sync with what Leaflet expects
        const prevPosForDevice = prevPosMap[device.id];
        const pos = {
          deviceId:        device.id,
          latitude:        parseFloat(device.motion_lat) || 0,
          longitude:       parseFloat(device.motion_lon) || 0,
          name:            device.name || 'Unknown',
          status:          device.status || 'unknown',
          motion_status:   device.motion_status,
          battery_level:   device.battery_level,
          dg_status:       device.dg_status,
          ignition_status: device.ignition_status,
          battery_status:  device.battery_status,
          fixTime:         device.position_time,
          address:         prevPosForDevice?.address || null, // Preserve resolved address
        };
        
        posMap[device.id] = pos; 
        
        // The cached status will be preserved
        const currentStatus = device.status || 'offline';
        pos.__status = currentStatus; 
      });
      
      prevPositionsRef.current = posMap;
      setPositions(posMap);

      // Only fetch alarms for active/online devices, and only every 20 seconds to prevent network choke
      const now = Date.now();
      const shouldFetchAlarms = isFirstAlarmsFetchRef.current || (now - lastAlarmsFetchRef.current >= 20000);

      if (shouldFetchAlarms) {
        lastAlarmsFetchRef.current = now;
        const activeDevices = devicesData.filter(d => d.status === 'online');
        const devicesAlarms = [];

        for (const device of activeDevices) {
          try {
            const alarmList = await fetchAlarms(device.id);
            devicesAlarms.push({ deviceId: device.id, alarms: alarmList || [] });
            // A tiny 30ms sleep between requests keeps the single-threaded server responsive
            await new Promise(resolve => setTimeout(resolve, 30));
          } catch (e) {
            if (e.message !== 'Network Error') {
              console.warn(`[Alarms API] Fetch error for device ${device.id}:`, e.message);
            }
            devicesAlarms.push({ deviceId: device.id, alarms: [] });
          }
        }

        devicesAlarms.forEach(({ deviceId, alarms }) => {
          const name = posMap[deviceId]?.name || `Device ${deviceId}`;
          
          // Sort alarms by ID ascending so older alarms are processed first
          const sortedAlarms = [...alarms].sort((a, b) => a.id - b.id);
          
          sortedAlarms.forEach((alarm) => {
            if (!seenAlarmsRef.current.has(alarm.id)) {
              seenAlarmsRef.current.add(alarm.id);
              
              // Only trigger push notifications on new alarms appearing after initial boot sync is complete
              if (isFirstAlarmsFetchRef.current === false) {
                const parsed = AlertNotificationService.parseAlarm(alarm, name);
                if (parsed) {
                  displayNotification(parsed.title, parsed.body, parsed.timestamp);
                }
              }
            }
          });
        });

        // After first sync pass is complete, set isFirstAlarmsFetchRef to false
        if (isFirstAlarmsFetchRef.current) {
          devicesAlarms.forEach(({ alarms }) => {
            alarms.forEach(alarm => seenAlarmsRef.current.add(alarm.id));
          });
          isFirstAlarmsFetchRef.current = false;
        }
      }

      if (mapReady) {
        const updateData = devicesData.map(device => {
          const prevPosForDevice = prevPositionsRef.current[device.id];
          return {
            deviceId:        device.id,
            latitude:        parseFloat(device.motion_lat) || 0,
            longitude:       parseFloat(device.motion_lon) || 0,
            name:            device.name || 'Unknown',
            status:          device.status || 'offline',
            motion_status:   device.motion_status,
            battery_level:   device.battery_level,
            dg_status:       device.dg_status,
            ignition_status: device.ignition_status,
            fixTime:         device.position_time,
            address:         prevPosForDevice?.address || null, // Preserve resolved address
          };
        });

        sendToMap('UPDATE_MARKERS', { positions: updateData });

        if (followMode && selectedDeviceId) {
          const pos = posMap[selectedDeviceId];
          if (pos) {
            sendToMap('FOCUS_DEVICE', { 
              deviceId:        selectedDeviceId, 
              lat:             pos.latitude, 
              lng:             pos.longitude,
              name:            pos.name,
              status:          pos.status,
              motion_status:   pos.motion_status,
              battery_level:   pos.battery_level,
              dg_status:       pos.dg_status,
              ignition_status: pos.ignition_status,
              fixTime:         pos.fixTime,
              address:         pos.address
            });
          }
        }
      }
      setLoading(false);
    } catch (error) {
      if (error.message !== 'Network Error') {
        console.warn('Sync Error:', error);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [mapReady, followMode, selectedDeviceId, sendToMap]);

  useEffect(() => {
    // Request notification permissions for Android 13+ / iOS
    notifee.requestPermission();
    
    const unsubNet = NetInfo.addEventListener(state => setIsOnline(state.isConnected));
    fetchData(); // Run immediately
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => { clearInterval(interval); unsubNet(); };
  }, [fetchData]);

  // ─── HANDLE INCOMING FOCUS OR HISTORY REQUEST ───
  useEffect(() => {
    if (route.params?.focusDevice) {
      const device = route.params.focusDevice;
      setTimeout(() => focusDevice(device), 1000);
      navigation.setParams({ focusDevice: undefined });
    }
    
    if (route.params?.historyData) {
      const { coords, startTime, endTime } = route.params.historyData;
      setTimeout(() => {
        sendToMap('SHOW_HISTORY', { coords, startTime, endTime });
      }, 1500);
      navigation.setParams({ historyData: undefined });
    }
  }, [route.params, mapReady, focusDevice, sendToMap]);

  // Handle incoming messages from WebView
  const onMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setMapReady(true);
      } else if (data.type === 'MARKER_CLICK') {
        setSelectedDeviceId(data.id);
        const dev = devices.find(d => d.id === data.id);
        if (dev) {
          focusDevice(dev);
        }
      } else if (data.type === 'ERROR') {
        Alert.alert('Map Info', data.msg);
      }
    } catch (e) {}
  };

  // ─── ACTIONS ────────────────────────────────────────────────────────────────
  const focusDevice = async (device) => {
    const pos = positions[device.id];
    if (pos && mapReady) {
      setSelectedDeviceId(device.id);
      
      // Fetch address ONLY when focused to avoid rate limiting
      let addr = pos.address;
      if (!addr) {
        addr = await reverseGeocode(pos.latitude, pos.longitude);
        // Update local state so it shows in popup next time
        setPositions(prev => ({
          ...prev,
          [device.id]: { ...pos, address: addr }
        }));
        // Update ref immediately so fetchData preserves it
        if (prevPositionsRef.current[device.id]) {
          prevPositionsRef.current[device.id].address = addr;
        }
      }

      sendToMap('FOCUS_DEVICE', { 
        deviceId:        device.id, 
        lat:             pos.latitude, 
        lng:             pos.longitude,
        name:            pos.name,
        status:          pos.status,
        motion_status:   pos.motion_status,
        battery_level:   pos.battery_level,
        dg_status:       pos.dg_status,
        ignition_status: pos.ignition_status,
        fixTime:         pos.fixTime,
        address:         addr // Pass fresh address
      });
      if (isExpanded) toggleBottomSheet();
    } else {
      Alert.alert('Info', 'No GPS position found for this device yet.');
    }
  };

  const locateMe = async () => {
    const requestLoc = () => {
      Geolocation.getCurrentPosition(
        position => {
          sendToMap('LOCATE_ME_NATIVE', {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        error => Alert.alert('Location Error', 'Make sure GPS is enabled on your device.'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    };

    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission Required',
            message: 'App needs access to your location to show where you are on the map.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          requestLoc();
        } else {
          Alert.alert('Permission Denied', 'Cannot find your location without permission.');
        }
      } catch (err) {
        console.warn(err);
      }
    } else {
      requestLoc();
    }
  };

  const toggleBottomSheet = () => {
    const toValue = isExpanded ? 220 : height * 0.75;
    Animated.spring(bottomSheetHeight, { toValue, useNativeDriver: false }).start();
    setIsExpanded(!isExpanded);
  };

  // ─── FILTERED LIST ──────────────────────────────────────────────────────────
  const filteredDevices = useMemo(() => {
    return devices.filter(d => {
      const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) || (d.iccid || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filter === 'all' || d.status === filter;
      return matchesSearch && matchesStatus;
    });
  }, [devices, searchQuery, filter]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* ─── WEBVIEW LEAFLET CORE ─── */}
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        geolocationEnabled={true}
      />

      {/* ─── FLOATING DASHBOARD CONTROLS ─── */}
      <View style={[styles.controlsContainer, { top: insets.top + 10 }]}>
        <View style={styles.controlGroup}>
          <TouchableOpacity style={styles.controlBtn} onPress={() => sendToMap('ZOOM_IN')}>
            <Icon name="plus" size={24} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={() => sendToMap('ZOOM_OUT')}>
            <Icon name="minus" size={24} color="#333" />
          </TouchableOpacity>
        </View>

        <View style={styles.controlGroup}>
          <TouchableOpacity style={styles.controlBtn} onPress={locateMe}>
            <Icon name="crosshairs-gps" size={22} color="#1E88E5" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.controlBtn, followMode && styles.activeBtn]} 
            onPress={() => setFollowMode(!followMode)}
          >
            <Icon name={followMode ? "navigation" : "navigation-outline"} size={22} color={followMode ? "#FFF" : "#333"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={fetchData}>
            <Icon name="refresh" size={22} color="#333" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.controlBtn} 
          onPress={() => {
            const next = mapLayer === 'standard' ? 'satellite' : mapLayer === 'satellite' ? 'terrain' : 'standard';
            setMapLayer(next);
            sendToMap('SET_LAYER', { layer: next });
          }}
        >
          <Icon name="layers-outline" size={22} color="#333" />
        </TouchableOpacity>
      </View>

      {/* ─── STATUS BAR ─── */}
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>SYNCING WITH SERVER...</Text>
        </View>
      )}

      {/* ─── PROFESSIONAL BOTTOM DASHBOARD ─── */}
      <Animated.View style={[styles.bottomSheet, { height: bottomSheetHeight }]}>
        <TouchableOpacity style={styles.dragHandler} onPress={toggleBottomSheet}>
          <View style={styles.dragBar} />
        </TouchableOpacity>

        <View style={styles.sheetHeader}>
          <View style={styles.titleRow}>
            <Text style={styles.sheetTitle}>Traccar Dashboard</Text>
            <View style={styles.filterRow}>
              {['all', 'online', 'offline'].map(f => (
                <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.activeChip]}>
                  <Text style={[styles.filterChipText, filter === f && styles.activeChipText]}>{f.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <View style={styles.searchContainer}>
            <Icon name="magnify" size={20} color="#999" />
            <TextInput 
              style={styles.searchInput}
              placeholder="Search devices..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor="#999"
            />
          </View>
        </View>

        <FlatList
          data={filteredDevices}
          keyExtractor={item => (item.id?.toString() ?? Math.random().toString())}
          renderItem={({ item }) => {
            const isMoving = item.motion_status === 'moving' || item.motion_status === 'true' || item.motion_status === true || item.motion_status === 1 || item.motion_status === '1';
            return (
              <TouchableOpacity 
                style={[styles.deviceItem, selectedDeviceId === item.id && styles.selectedItem]} 
                onPress={() => focusDevice(item)}
              >
                <View style={styles.deviceItemLeft}>
                  <View style={[styles.statusIndicator, { backgroundColor: item.status === 'online' ? '#4CAF50' : '#F44336' }]} />
                  <View style={styles.iconCircle}>
                    <Icon name="car-outline" size={24} color="#555" />
                  </View>
                  <View style={{ marginLeft: 12 }}>
                    <Text style={styles.deviceNameText}>{item.name}</Text>
                    <Text style={styles.deviceMetaText}>{item.iccid || item.uniqueId || 'No IMEI'} • {item.status}</Text>
                  </View>
                </View>
                <View style={styles.deviceItemRight}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
                    <Icon 
                      name={item.battery_level ? "battery" : "battery-off"} 
                      size={16} 
                      color="#64748b" 
                      style={{ marginRight: 4 }} 
                    />
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#64748b', marginRight: 10 }}>
                      {item.battery_level ? `${item.battery_level}%` : 'N/A'}
                    </Text>
                    
                    <Icon 
                      name={isMoving ? "run" : "car-brake-park"} 
                      size={18} 
                      color={isMoving ? "#f59e0b" : "#94a3b8"} 
                    />
                  </View>
                  <Icon name="chevron-right" size={20} color="#CCC" />
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      </Animated.View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1E88E5" />
          <Text style={{ marginTop: 10, color: '#1E88E5', fontWeight: 'bold' }}>LOADING MAP...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  map: { flex: 1 },
  controlsContainer: { position: 'absolute', right: 16, zIndex: 100, alignItems: 'center' },
  controlGroup: { backgroundColor: '#FFF', borderRadius: 8, elevation: 5, marginBottom: 12, overflow: 'hidden' },
  controlBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  activeBtn: { backgroundColor: '#1E88E5' },
  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', borderTopLeftRadius: 25, borderTopRightRadius: 25, elevation: 25, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 5 },
  dragHandler: { width: '100%', height: 30, alignItems: 'center', justifyContent: 'center' },
  dragBar: { width: 40, height: 4, backgroundColor: '#E0E0E0', borderRadius: 2 },
  sheetHeader: { paddingHorizontal: 20, marginBottom: 15 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sheetTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A1A1A' },
  filterRow: { flexDirection: 'row', gap: 5 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#F0F0F0' },
  activeChip: { backgroundColor: '#1E88E5' },
  filterChipText: { fontSize: 10, fontWeight: 'bold', color: '#666' },
  activeChipText: { color: '#FFF' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 44, marginLeft: 8, color: '#333', fontSize: 14 },
  deviceItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F9F9F9' },
  selectedItem: { backgroundColor: '#F0F7FF', borderLeftWidth: 4, borderLeftColor: '#1E88E5' },
  deviceItemLeft: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  statusIndicator: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  deviceNameText: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  deviceMetaText: { fontSize: 12, color: '#999', marginTop: 2 },
  deviceItemRight: { flexDirection: 'row', alignItems: 'center' },
  speedText: { marginRight: 10, fontSize: 14, fontWeight: 'bold', color: '#1E88E5' },
  offlineBar: { position: 'absolute', top: 120, alignSelf: 'center', backgroundColor: '#1E88E5', paddingHorizontal: 15, paddingVertical: 6, borderRadius: 20, elevation: 5 },
  offlineText: { color: '#FFF', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
});

export default MapScreen;
