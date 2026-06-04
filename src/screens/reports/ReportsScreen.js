/**
 * ReportsScreen — Real Traccar API Reports
 * Uses: GET /api/reports/summary, /api/reports/route, /api/reports/trips
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  FlatList,
  Platform,
  PermissionsAndroid,
  ToastAndroid,
} from 'react-native';
import RNFS from 'react-native-fs';
import Header from '../../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { fetchDeviceList, reverseGeocode } from '../../api/webApi';

const getDevices = async () => {
  try {
    const data = await fetchDeviceList();
    const list = data.devices || [];
    return list.map(d => ({
      id: d.id,
      name: d.name,
      uniqueId: d.iccid || d.name,
      status: d.status || 'offline',
      disabled: false,
    }));
  } catch (e) {
    return [];
  }
};

const getPositionHistory = async () => [];
const getTripsReport = async () => [];
const getSummaryReport = async () => [];
const getStopsReport = async () => [];
const getEvents = async () => [];

const REPORT_TYPES = ['Route', 'Trips', 'Stops', 'Events', 'Summary', 'DG Logs'];

const ReportsScreen = ({ navigation }) => {
  const [reportType,  setReportType]  = useState('Route');
  const [devices,     setDevices]     = useState([]);
  const [selectedDev, setSelectedDev] = useState(null);
  const [isGenerating,setIsGenerating]= useState(false);
  const [reportData,  setReportData]  = useState(null);
  const [loadingDevs, setLoadingDevs] = useState(true);
  const [showDevPicker, setShowDevPicker] = useState(false);

  // Date range: today
  const todayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const todayEnd = () => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  };

  // ─── LOAD DEVICES ──────────────────────────────────────────────────────────
  useEffect(() => {
    getDevices()
      .then((data) => {
        const active = data.filter((d) => !d.disabled);
        setDevices(active);
        if (active.length > 0) setSelectedDev(active[0]);
      })
      .catch((err) => Alert.alert('Error', err.message))
      .finally(() => setLoadingDevs(false));
  }, []);

  // ─── GENERATE REPORT ───────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!selectedDev) {
      Alert.alert('No Device', 'Please select a device first.');
      return;
    }
    setIsGenerating(true);
    setReportData(null);
    const from = todayStart().toISOString();
    const to   = todayEnd().toISOString();

    // helper: filter positions to every 5-minute interval
    const fiveMinFilter = (positions) => {
      const result = [];
      let lastT = 0;
      positions.forEach(pt => {
        const t = new Date(pt.fixTime).getTime();
        if (t - lastT >= 300000) { result.push(pt); lastT = t; }
      });
      return result;
    };

    try {
      let data;
      switch (reportType) {
        case 'Route': {
          const rawData = await getPositionHistory(selectedDev.id, from, to);
          data = rawData && rawData.length > 0 ? fiveMinFilter(rawData) : [];
          break;
        }
        case 'Trips': {
          const trips = await getTripsReport(selectedDev.id, from, to);
          // For each trip fetch 5-min route points + addresses in parallel
          data = await Promise.all((trips || []).map(async (trip) => {
            const [startAddr, endAddr, routeRaw] = await Promise.all([
              reverseGeocode(trip.startLat, trip.startLon),
              reverseGeocode(trip.endLat, trip.endLon),
              getPositionHistory(selectedDev.id, trip.startTime, trip.endTime),
            ]);
            trip.startAddress = startAddr;
            trip.endAddress   = endAddr;
            trip.routePoints  = routeRaw && routeRaw.length > 0 ? fiveMinFilter(routeRaw) : [];
            return trip;
          }));
          break;
        }
        case 'Stops': {
          const stops = await getStopsReport(selectedDev.id, from, to);
          data = await Promise.all((stops || []).map(async (stop) => {
            stop.address = await reverseGeocode(stop.latitude, stop.longitude);
            return stop;
          }));
          break;
        }
        case 'Events': {
          const [events, positions] = await Promise.all([
            getEvents(selectedDev.id, from, to),
            getPositionHistory(selectedDev.id, from, to)
          ]);
          
          // Create a map for fast lookup: positionId -> {lat, lon}
          const posMap = {};
          (positions || []).forEach(p => {
            posMap[p.id] = { lat: p.latitude, lon: p.longitude };
          });

          data = await Promise.all((events || []).map(async (event) => {
            // Try to get coords from the linked positionId
            const coords = posMap[event.positionId];
            const lat = coords?.lat || event.latitude;
            const lon = coords?.lon || event.longitude;

            if (lat && lon) {
              event.address = await reverseGeocode(lat, lon);
            }
            return event;
          }));
          break;
        }
        case 'Summary':
          data = await getSummaryReport(selectedDev.id, from, to);
          break;
        default:
          data = [];
      }

      setReportData(data);
    } catch (err) {
      Alert.alert('Report Error', err.message);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedDev, reportType]);

  // ─── DOWNLOAD CSV REPORT ───────────────────────────────────────────────────
  const handleDownloadCSV = async () => {
    if (!selectedDev) {
      Alert.alert('No Device', 'Please select a device first.');
      return;
    }

    try {
      if (Platform.OS === 'android' && Platform.Version < 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message: 'App needs access to storage to download the file.',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          ToastAndroid.show('Storage permission denied', ToastAndroid.SHORT);
          return;
        }
      }

      ToastAndroid.show('Generating & Downloading CSV...', ToastAndroid.SHORT);
      
      const from = todayStart().toISOString();
      const to   = todayEnd().toISOString();
      const filename = `DG_Report_${selectedDev.name.replace(/\s+/g, '_')}_${Date.now()}.xlsx`;
      const downloadPath = RNFS.DownloadDirectoryPath + '/' + filename;

      // Make sure this matches your PC's IP or production server IP
      const API_URL = `http://shrotitele.com:1061/export-comprehensive?deviceId=${selectedDev.id}&from=${from}&to=${to}`;

      const res = await RNFS.downloadFile({
        fromUrl: API_URL,
        toFile: downloadPath,
      }).promise;

      if (res.statusCode === 200) {
        ToastAndroid.show(`Downloaded: ${filename}`, ToastAndroid.LONG);
      } else {
        ToastAndroid.show('Download failed. No data or server error.', ToastAndroid.SHORT);
      }
    } catch (e) {
      console.warn(e);
      ToastAndroid.show('Error downloading file', ToastAndroid.SHORT);
    }
  };

  // ─── ROUTE REPORT RENDER ───────────────────────────────────────────────────
  const renderRoute = () => {
    if (!reportData || reportData.length === 0) {
      return <Text style={styles.noData}>No route data for today.</Text>;
    }
    return (
      <View style={styles.tableWrap}>
        {/* Header */}
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.tableCell, styles.headerCell, { flex: 1.5 }]}>Time</Text>
          <Text style={[styles.tableCell, styles.headerCell]}>Speed</Text>
          <Text style={[styles.tableCell, styles.headerCell]}>Alt</Text>
          <Text style={[styles.tableCell, styles.headerCell]}>Valid</Text>
        </View>
        <FlatList
          data={reportData} // Show all downsampled 5-min intervals
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item, index }) => {
            const altVal = item.altitude ?? item.attributes?.altitude ?? null;
            return (
              <View style={[styles.tableRow, index % 2 === 0 && styles.rowAlt]}>
                <Text style={[styles.tableCell, { flex: 1.5 }]}>
                  {new Date(item.fixTime).toLocaleTimeString()}
                </Text>
                <Text style={styles.tableCell}>
                  {Math.round((item.speed ?? 0) * 1.852)} km/h
                </Text>
                <Text style={styles.tableCell}>
                  {altVal !== null ? `${Math.round(altVal)} m` : 'N/A'}
                </Text>
                <Text style={styles.tableCell}>
                  {item.valid ? '✅' : '❌'}
                </Text>
              </View>
            );
          }}
          scrollEnabled={false}
        />
        <Text style={styles.rowCount}>Showing {reportData.length} records (every 5 min)</Text>
      </View>
    );
  };

  // ─── TRIPS REPORT RENDER ───────────────────────────────────────────────────
  const renderTrips = () => {
    if (!reportData || reportData.length === 0) {
      return <Text style={styles.noData}>No trips recorded today.</Text>;
    }
    return reportData.map((trip, idx) => (
      <View key={idx} style={styles.tripCard}>
        <View style={styles.tripHeader}>
          <Text style={styles.tripTime}>
            {new Date(trip.startTime).toLocaleTimeString()} → {new Date(trip.endTime).toLocaleTimeString()}
          </Text>
          <Text style={styles.tripDuration}>{Math.round((trip.duration || 0) / 60000)} min</Text>
        </View>
        <View style={styles.tripDetailRow}>
          <Icon name="map-marker-outline" size={14} color="#757575" />
          <Text style={styles.tripDetailText}>{trip.startAddress || 'Loading...'}</Text>
        </View>
        <View style={styles.tripDetailRow}>
          <Icon name="map-marker-check" size={14} color="#4CAF50" />
          <Text style={styles.tripDetailText}>{trip.endAddress || 'Loading...'}</Text>
        </View>
        <View style={styles.tripFooter}>
          <Text style={styles.tripKm}>{((trip.distance || 0) / 1000).toFixed(2)} km</Text>
          <Text style={styles.tripSpeed}>Max {Math.round((trip.maxSpeed || 0) * 1.852)} km/h</Text>
          <Text style={styles.tripSpeed}>Avg {Math.round((trip.averageSpeed || 0) * 1.852)} km/h</Text>
        </View>
        {/* 5-minute route points inside this trip */}
        {trip.routePoints && trip.routePoints.length > 0 && (
          <View style={styles.tripRouteTable}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.tableCell, styles.headerCell, { flex: 1.5, fontSize: 11 }]}>Time</Text>
              <Text style={[styles.tableCell, styles.headerCell, { fontSize: 11 }]}>Speed</Text>
              <Text style={[styles.tableCell, styles.headerCell, { fontSize: 11 }]}>Alt</Text>
            </View>
            {trip.routePoints.map((pt, pi) => {
              const altVal = pt.altitude ?? pt.attributes?.altitude ?? null;
              return (
                <View key={pi} style={[styles.tableRow, pi % 2 === 0 && styles.rowAlt]}>
                  <Text style={[styles.tableCell, { flex: 1.5, fontSize: 11 }]}>
                    {new Date(pt.fixTime).toLocaleTimeString()}
                  </Text>
                  <Text style={[styles.tableCell, { fontSize: 11 }]}>
                    {Math.round((pt.speed ?? 0) * 1.852)} km/h
                  </Text>
                  <Text style={[styles.tableCell, { fontSize: 11 }]}>
                    {altVal !== null ? `${Math.round(altVal)} m` : 'N/A'}
                  </Text>
                </View>
              );
            })}
            <Text style={styles.rowCount}>{trip.routePoints.length} points (every 5 min)</Text>
          </View>
        )}
      </View>
    ));
  };

  // ─── SUMMARY REPORT RENDER ─────────────────────────────────────────────────
  const renderSummary = () => {
    if (!reportData || reportData.length === 0) {
      return <Text style={styles.noData}>No summary data available.</Text>;
    }
    const s = Array.isArray(reportData) ? reportData[0] : reportData;
    return (
      <View style={styles.summaryGrid}>
        <SummaryCard label="Distance"     value={`${((s.distance || 0) / 1000).toFixed(1)} km`} icon="map-marker-distance" />
        <SummaryCard label="Max Speed"    value={`${Math.round((s.maxSpeed || 0) * 1.852)} km/h`} icon="speedometer" />
        <SummaryCard label="Avg Speed"    value={`${Math.round((s.averageSpeed || 0) * 1.852)} km/h`} icon="speedometer-medium" />
        <SummaryCard label="Engine Hours" value={`${s.engineHours ? (s.engineHours / 3600000).toFixed(1) : '0'} h`} icon="engine-outline" />
        <SummaryCard label="Trips"        value={s.trips?.toString() || '0'} icon="routes" />
        <SummaryCard label="Stops"        value={s.stops?.toString() || '0'} icon="stop-circle-outline" />
      </View>
    );
  };

  // ─── STOPS REPORT RENDER ──────────────────────────────────────────────────────
  const renderStops = () => {
    if (!reportData || reportData.length === 0) {
      return <Text style={styles.noData}>No stops recorded today.</Text>;
    }
    return reportData.map((stop, idx) => (
      <View key={idx} style={styles.tripCard}>
        <View style={styles.tripHeader}>
          <Text style={styles.tripTime}>
            {stop.startTime ? new Date(stop.startTime).toLocaleTimeString() : 'N/A'} → {stop.endTime ? new Date(stop.endTime).toLocaleTimeString() : 'N/A'}
          </Text>
          <Text style={styles.tripDuration}>{stop.duration ? Math.round(stop.duration / 60000) : 0} min stopped</Text>
        </View>
        <View style={styles.tripDetailRow}>
          <Icon name="bus-stop-uncovered" size={18} color="#F44336" />
          <Text style={styles.tripDetailText}>{stop.address || 'Location unknown'}</Text>
        </View>
        <View style={styles.tripFooter}>
          <Text style={styles.tripSpeed}>Engine: {stop.engineHours ? (stop.engineHours/3600000).toFixed(2) + 'h' : '0h'}</Text>
          <Text style={styles.tripSpeed}>Spent: {stop.spentFuel ? stop.spentFuel.toFixed(1) + 'L' : '0L'}</Text>
        </View>
      </View>
    ));
  };

  // ─── EVENTS REPORT RENDER ─────────────────────────────────────────────────────
  const renderEvents = () => {
    if (!reportData || reportData.length === 0) {
      return <Text style={styles.noData}>No events recorded today.</Text>;
    }
    return reportData.map((event, idx) => {
      const evType = event.type || 'unknown';
      const iconName = evType === 'ignitionOn' ? 'key-variant' : 
                       evType === 'ignitionOff' ? 'key-remove' :
                       evType === 'deviceOnline' ? 'wifi' :
                       evType === 'deviceOffline' ? 'wifi-off' : 'bell-outline';
      const iconColor = evType.toLowerCase().includes('on') || evType.toLowerCase().includes('online') ? '#4CAF50' : '#F44336';
      
      return (
        <View key={idx} style={styles.tripCard}>
          <View style={styles.tripHeader}>
            <Text style={[styles.tripTime, { color: iconColor }]}>
              {evType.toUpperCase()}
            </Text>
            <Text style={styles.tripDuration}>
              {event.eventTime ? new Date(event.eventTime).toLocaleTimeString() : 'N/A'}
            </Text>
          </View>
          <View style={styles.tripDetailRow}>
            <Icon name={iconName} size={18} color={iconColor} />
            <Text style={styles.tripDetailText}>{event.address || 'Event triggered (No address)'}</Text>
          </View>
        </View>
      );
    });
  };

  // ─── DEVICE PICKER MODAL ───────────────────────────────────────────────────
  const DevicePicker = () => (
    <View style={styles.pickerDropdown}>
      {devices.map((d) => (
        <TouchableOpacity
          key={d.id}
          style={[styles.pickerItem, selectedDev?.id === d.id && styles.pickerItemActive]}
          onPress={() => { setSelectedDev(d); setShowDevPicker(false); }}
        >
          <Text style={[styles.pickerItemText, selectedDev?.id === d.id && { color: '#1565C0', fontWeight: 'bold' }]}>
            {d.name}
          </Text>
          <View style={[styles.statusDot, { backgroundColor: d.status === 'online' ? '#4CAF50' : d.status === 'offline' ? '#F44336' : '#FF9800' }]} />
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <Header title="Reports" navigation={navigation} />
      <ScrollView style={styles.content}>

        {/* Report config card */}
        <View style={styles.card}>

          {/* Report Type */}
          <Text style={styles.label}>Report Type</Text>
          <View style={styles.typePicker}>
            {REPORT_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeBtn, reportType === t && styles.typeBtnActive]}
                onPress={() => {
                  if (t === 'DG Logs') {
                    navigation.navigate('DeviceTab', {
                      screen: 'DgStatusLog'
                    });
                  } else {
                    setReportType(t);
                    setReportData(null);
                  }
                }}
              >
                <Text style={[styles.typeBtnText, reportType === t && { color: '#FFFFFF' }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Device Picker */}
          <Text style={styles.label}>Device</Text>
          {loadingDevs ? (
            <ActivityIndicator color="#1565C0" />
          ) : (
            <>
              <TouchableOpacity style={styles.selector} onPress={() => setShowDevPicker(!showDevPicker)}>
                <Text style={styles.selectorText}>{selectedDev?.name || 'Select device'}</Text>
                <Icon name={showDevPicker ? 'chevron-up' : 'chevron-down'} size={24} color="#757575" />
              </TouchableOpacity>
              {showDevPicker && <DevicePicker />}
            </>
          )}

          {/* Date Range — Today */}
          <Text style={styles.label}>Date Range</Text>
          <View style={styles.dateDisplay}>
            <Icon name="calendar-today" size={18} color="#757575" />
            <Text style={styles.dateText}>Today ({new Date().toLocaleDateString()})</Text>
          </View>

          {/* Generate Button */}
          <TouchableOpacity
            style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.generateBtnText}>GENERATE REPORT</Text>
            )}
          </TouchableOpacity>

          {/* Download CSV Button */}
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={handleDownloadCSV}
          >
            <Icon name="file-download" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.generateBtnText}>DOWNLOAD DG EXCEL</Text>
          </TouchableOpacity>
        </View>

        {/* Results */}
        {reportData !== null && (
          <View style={styles.resultsContainer}>
            <Text style={styles.resultsTitle}>
              {reportType} Report — {selectedDev?.name}
            </Text>
            {reportType === 'Route'   && renderRoute()}
            {reportType === 'Trips'   && renderTrips()}
            {reportType === 'Stops'   && renderStops()}
            {reportType === 'Events'  && renderEvents()}
            {reportType === 'Summary' && renderSummary()}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

// ─── Summary Card ─────────────────────────────────────────────────────────────
const SummaryCard = ({ label, value, icon }) => (
  <View style={styles.summaryCard}>
    <Icon name={icon} size={26} color="#1565C0" />
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>
);

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F5F5F5' },
  content:       { padding: 16 },
  card:          { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, elevation: 3, marginBottom: 20 },
  label:         { fontSize: 13, fontWeight: 'bold', color: '#757575', marginBottom: 8, marginTop: 14 },
  typePicker:    { flexDirection: 'row' },
  typeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
    borderColor: '#E0E0E0', marginRight: 6, alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  typeBtnText:   { color: '#757575', fontWeight: 'bold', fontSize: 13 },
  selector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#F5F5F5',
  },
  selectorText: { color: '#212121', fontSize: 15 },
  pickerDropdown: { backgroundColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0', marginTop: 4 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  pickerItemActive: { backgroundColor: '#E3F2FD' },
  pickerItemText: { fontSize: 15, color: '#212121' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dateDisplay: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#E0E0E0' },
  dateText: { marginLeft: 8, color: '#424242', fontSize: 15 },
  generateBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  generateBtnDisabled: { backgroundColor: '#90CAF9' },
  generateBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  downloadBtn: { backgroundColor: '#4CAF50', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10, flexDirection: 'row', justifyContent: 'center' },
  resultsContainer: { marginBottom: 16 },
  resultsTitle: { fontSize: 16, fontWeight: 'bold', color: '#212121', marginBottom: 12 },
  noData: { color: '#9E9E9E', textAlign: 'center', padding: 32, fontSize: 15 },
  tableWrap: { backgroundColor: '#FFFFFF', borderRadius: 8, overflow: 'hidden', elevation: 1 },
  tableRow: { flexDirection: 'row' },
  tableHeader: { backgroundColor: '#1565C0' },
  headerCell: { color: '#FFFFFF', fontWeight: 'bold' },
  tableCell: { flex: 1, padding: 10, fontSize: 12, color: '#212121', borderRightWidth: 1, borderRightColor: '#F0F0F0' },
  rowAlt: { backgroundColor: '#F9F9F9' },
  rowCount: { textAlign: 'center', color: '#9E9E9E', fontSize: 12, padding: 8 },
  tripCard: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 14, marginBottom: 10, elevation: 2 },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  tripTime: { fontWeight: 'bold', color: '#212121', fontSize: 14 },
  tripDuration: { color: '#757575', fontSize: 13 },
  tripDetailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  tripDetailText: { flex: 1, marginLeft: 6, color: '#424242', fontSize: 13 },
  tripFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  tripKm: { fontWeight: 'bold', color: '#1565C0' },
  tripSpeed: { color: '#757575', fontSize: 12 },
  tripRouteTable: { marginTop: 10, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#E0E0E0' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  summaryCard: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16, marginBottom: 12, alignItems: 'center', elevation: 2 },
  summaryValue: { fontSize: 20, fontWeight: 'bold', color: '#1565C0', marginTop: 8 },
  summaryLabel: { fontSize: 12, color: '#757575', marginTop: 4 },
});

export default ReportsScreen;
