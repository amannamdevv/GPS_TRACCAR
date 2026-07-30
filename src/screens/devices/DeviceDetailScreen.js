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
  BackHandler,
  AppState,
  TextInput,
  Clipboard,
  ToastAndroid,
} from 'react-native';
import DatePicker from '../../components/CalendarPickerModal';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../../components/Header';
import SummaryDashboard from './SummaryDashboard';
import DailySummaryDetails from './DailySummaryDetails';
import { fetchDeviceList, fetchDgStatusLogs, getTripsReport, reverseGeocode, fetchDgDeviceDetail } from '../../api/webApi';
import moment from 'moment';

const getPositions = async () => [];

const DeviceDetailScreen = ({ route, navigation }) => {
  const { device: initialDevice } = route.params;

  const [device, setDevice] = useState(() => ({
    ...initialDevice,
    lat: Number(initialDevice.lat || initialDevice.motion_lat) || 0,
    lng: Number(initialDevice.lng || initialDevice.motion_lon) || 0,
  }));
  const [dgDetail, setDgDetail] = useState(null);

  const [trips, setTrips] = useState([]);
  const [allTrips, setAllTrips] = useState([]);
  const [tripTotalCount, setTripTotalCount] = useState(0);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [activeSegment, setActiveSegment] = useState('LOCATION');
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [showDailyDetail, setShowDailyDetail] = useState(false);
  const [selectedDailyDate, setSelectedDailyDate] = useState(null);
  const [currentAddress, setCurrentAddress] = useState(initialDevice.address || null);
  const [addressLoading, setAddressLoading] = useState(!initialDevice.address);

  const [dgLogs, setDgLogs] = useState([]);
  const [allDgLogs, setAllDgLogs] = useState([]); // full filtered set for in-memory pagination
  const [dgLoading, setDgLoading] = useState(false);
  const [dgTotalCount, setDgTotalCount] = useState(0);

  const [summaryFromDate, setSummaryFromDate] = useState(() => moment().subtract(1, 'days').toDate());
  const [summaryToDate, setSummaryToDate] = useState(() => moment().subtract(1, 'days').toDate());

  const [dgStatusFilter, setDgStatusFilter] = useState('ALL');
  const [dgDateFrom, setDgDateFrom] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });
  const [dgDateTo, setDgDateTo] = useState(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; });
  const [showDgFromPicker, setShowDgFromPicker] = useState(false);
  const [showDgToPicker, setShowDgToPicker] = useState(false);

  const [tripDateFrom, setTripDateFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0); // start of today
    return d;
  });
  const [tripDateTo, setTripDateTo] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999); // end of day
    return d;
  });
  const [showTripFromPicker, setShowTripFromPicker] = useState(false);
  const [showTripToPicker, setShowTripToPicker] = useState(false);

  const [dgPage, setDgPage] = useState(1);
  const DG_PAGE_SIZE = 10;

  const [tripPage, setTripPage] = useState(1);
  const TRIP_PAGE_SIZE = 10;

  const [expandedCardIds, setExpandedCardIds] = useState({});

  // Reverse geocoding on mount if no address
  useEffect(() => {
    if (!currentAddress && device.lat && device.lng) {
      reverseGeocode(device.lat, device.lng).then(addr => {
        setCurrentAddress(addr || 'Unknown Location');
        setAddressLoading(false);
      });
    }
  }, [device.lat, device.lng, currentAddress]);

  // Handle hardware back button
  useEffect(() => {
    const onBackPress = () => {
      if (showDailyDetail) {
        setShowDailyDetail(false);
        return true;
      }
      if (returnToSummary && activeSegment !== 'SUMMARY') {
        setReturnToSummary(false);
        setActiveSegment('SUMMARY');
        return true; // prevent default behavior
      }
      return false; // let default behavior happen
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => {
      if (subscription?.remove) {
        subscription.remove();
      } else if (BackHandler.removeEventListener) {
        BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      }
    };
  }, [returnToSummary, activeSegment, showDailyDetail]);

  const toggleExpand = (id) => setExpandedCardIds(prev => ({ ...prev, [id]: !prev[id] }));

  const totalPages = Math.max(1, Math.ceil(dgTotalCount / DG_PAGE_SIZE));
  const hasMoreDgLogs = dgPage < totalPages;

  // Removed automatic page reset to avoid race conditions. Handled manually on filter changes.
  useEffect(() => { setTripPage(1); }, [tripDateFrom, tripDateTo]);

  // Note: trips are only loaded on manual search button tap (not auto on date change)

  const tripsToRender = React.useMemo(() => {
    const start = (tripPage - 1) * TRIP_PAGE_SIZE;
    return allTrips.slice(start, start + TRIP_PAGE_SIZE);
  }, [allTrips, tripPage]);

  const tripTotalPages = Math.max(1, Math.ceil(tripTotalCount / TRIP_PAGE_SIZE));
  const hasMoreTrips = tripPage < tripTotalPages;

  const formatTime = (raw) => {
    if (!raw || raw === 'N/A') return 'N/A';
    const m = moment(raw);
    if (!m.isValid()) return raw;
    return m.format('DD/MM/YYYY, HH:mm:ss');
  };

  const formatDuration = (totalMinutes) => {
    const mins = parseInt(totalMinutes, 10) || 0;
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;

    if (d > 0) return `${d}d ${h}h ${m}m`;
    return `${h}h ${m}m`;
  };

  useEffect(() => {
    if (route.params?.device && route.params.device.id !== device.id) {
      const newDev = route.params.device;
      setDevice({
        ...newDev,
        lat: newDev.lat || parseFloat(newDev.motion_lat) || 0,
        lng: newDev.lng || parseFloat(newDev.motion_lon) || 0,
      });
      setCurrentAddress(newDev.address || null);
      setActiveSegment('SUMMARY');
      setTrips([]);
      setAllTrips([]);
      setTripTotalCount(0);
      setDgLogs([]);
      setDgTotalCount(0);
    }
  }, [route.params?.device]);

  const refreshPosition = useCallback(async () => {
    try {
      const [data, dgDetailDataResp] = await Promise.allSettled([
        fetchDeviceList(),
        fetchDgDeviceDetail()
      ]);

      if (dgDetailDataResp.status === 'fulfilled' && dgDetailDataResp.value?.data) {
        const found = dgDetailDataResp.value.data.find(d =>
          d.deviceid == device.id || d.uniqueid == device.uniqueId || d.uniqueid == device.uniqueid
        );
        if (found) {
          setDgDetail(found);
        }
      }

      if (data.status === 'fulfilled') {
        const devicesData = data.value?.devices || data.value?.data || [];
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
            speed: updatedDev.speed || 0,
            speedKmh: updatedDev.speedKmh || updatedDev.speed || 0,
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
          if (updatedDev.address) setCurrentAddress(updatedDev.address);
        }
      }
    } catch (err) {
      console.warn('Position refresh error:', err.message);
    }
  }, [device.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        refreshPosition();
      }
    });
    return () => subscription.remove();
  }, [refreshPosition]);

  useEffect(() => { refreshPosition(); }, [refreshPosition]);

  // Clean up pending requests when the component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerTripsRef.current) abortControllerTripsRef.current.abort();
      if (abortControllerDgRef.current) abortControllerDgRef.current.abort();
    };
  }, []);

  const abortControllerTripsRef = useRef(null);
  const loadTrips = useCallback(async () => {
    if (abortControllerTripsRef.current) {
      abortControllerTripsRef.current.abort();
    }
    abortControllerTripsRef.current = new AbortController();
    const signal = abortControllerTripsRef.current.signal;

    setTripsLoading(true);
    try {
      const startDate = moment(tripDateFrom).format('YYYY-MM-DD');
      const endDate = moment(tripDateTo).format('YYYY-MM-DD');

      const data = await getTripsReport(device.id, startDate, endDate, {
        limit: 9999,
        page: 1
      });
      if (signal.aborted) return;

      const fromMs = moment(tripDateFrom).startOf('day').valueOf();
      const toMs = moment(tripDateTo).endOf('day').valueOf();
      const timeFiltered = (data || []).filter(trip => {
        const t = moment(trip.startTime).valueOf();
        return t >= fromMs && t <= toMs;
      });

      const enriched = await Promise.all(timeFiltered.map(async trip => {
        if (!trip.startAddress && trip.startLat)
          trip.startAddress = await reverseGeocode(trip.startLat, trip.startLon);
        if (!trip.endAddress && trip.endLat)
          trip.endAddress = await reverseGeocode(trip.endLat, trip.endLon);
        return trip;
      }));
      if (signal.aborted) return;

      // API se jo bhi records aaye wahi dikhao — koi filter nahi
      setAllTrips(enriched);
      setTripTotalCount(enriched.length);
      setTripPage(1);

    } catch (err) {
      if (!signal.aborted) Alert.alert('Trips Error', err.message);
    } finally {
      if (!signal.aborted) setTripsLoading(false);
    }
  }, [device.id, tripDateFrom, tripDateTo, tripPage]);

  // Reset trip page when dates change
  useEffect(() => {
    setTripPage(1);
  }, [tripDateFrom, tripDateTo]);

  const abortControllerDgRef = useRef(null);
  const loadDgLogs = useCallback(async (pageOverride = null, statusOverride = undefined) => {
    if (abortControllerDgRef.current) {
      abortControllerDgRef.current.abort();
    }
    abortControllerDgRef.current = new AbortController();
    const signal = abortControllerDgRef.current.signal;

    // Use explicit override values if provided, else fall back to current state
    const currentPage = pageOverride !== null ? pageOverride : dgPage;
    const activeStatus = statusOverride !== undefined ? statusOverride : dgStatusFilter;

    setDgLoading(true);
    try {
      let startMom = moment(dgDateFrom).startOf('day');
      const endMom = moment(dgDateTo).endOf('day');
      const targetId = String(device.id);

      // Prevent backend error by capping the start date to a maximum of 30 days ago
      const minAllowedDate = moment().subtract(30, 'days').startOf('day');
      if (startMom.isBefore(minAllowedDate)) {
        startMom = minAllowedDate;
      }

      // Map UI filter labels to backend values
      let backendStatus = activeStatus;
      if (activeStatus === 'MOVE') backendStatus = 'MOVING';
      else if (activeStatus === 'STOPPED') backendStatus = 'STOP';

      const isFiltered = activeStatus && activeStatus !== 'ALL';

      const params = {
        deviceid: targetId,
        dg_name: device.name,
        start_date: startMom.format('YYYY-MM-DD'),
        end_date: endMom.format('YYYY-MM-DD'),
        // Always fetch all records to calculate correct full-day overview stats
        page: 1,
        limit: 9999,
      };

      if (isFiltered) {
        params.status = backendStatus;
        params.dg_status = backendStatus;
        params.final_status = backendStatus;
      }

      const response = await fetchDgStatusLogs(params, signal);
      if (signal.aborted) return;
      let raw = Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);

      // Client-side filter by final_status (safety net in case backend ignores status param)
      if (isFiltered) {
        raw = raw.filter(item => {
          const fs = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();
          if (backendStatus === 'ON') return fs === 'ON' || fs === '1';
          if (backendStatus === 'OFF') return fs === 'OFF' || fs === '0';
          if (backendStatus === 'MOVING') return fs === 'MOVING' || fs === 'MOVE' || fs === 'MOTION';
          if (backendStatus === 'STOP') return fs === 'STOP' || fs === 'STOPPED' || fs === 'IDLE';
          return true;
        });
      }

      setAllDgLogs(raw);
      setDgTotalCount(raw.length);

      const startIdx = (currentPage - 1) * DG_PAGE_SIZE;
      const endIdx = startIdx + DG_PAGE_SIZE;
      setDgLogs(raw.slice(startIdx, endIdx));

    } catch (err) {
      if (!signal.aborted) {
        Alert.alert('DG Logs Error', err.message);
      }
    } finally {
      if (!signal.aborted) {
        setDgLoading(false);
      }
    }
  }, [device.id, device.name, dgDateFrom, dgDateTo, dgPage, DG_PAGE_SIZE, dgStatusFilter]);

  const dgIsFirstRender = useRef(true);
  useEffect(() => {
    if (dgIsFirstRender.current) {
      dgIsFirstRender.current = false;
      return;
    }
    if (activeSegment === 'DG_REPORT') {
      loadDgLogs();
    }
  }, [activeSegment]);

  useEffect(() => {
    if (activeSegment === 'DG_REPORT') {
      const startIdx = (dgPage - 1) * DG_PAGE_SIZE;
      const endIdx = startIdx + DG_PAGE_SIZE;
      setDgLogs(allDgLogs.slice(startIdx, endIdx));
    }
  }, [dgPage, allDgLogs]);

  const dgStats = React.useMemo(() => {
    let totalDist = 0, onDuration = 0, offDuration = 0, moveDuration = 0, stopDuration = 0;
    allDgLogs.forEach(item => {
      const raw = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();

      let duration = 0;
      if (item.total_duration_hms && typeof item.total_duration_hms === 'string') {
        const parts = item.total_duration_hms.split(':');
        if (parts.length >= 3) {
          duration = parseInt(parts[0] || 0, 10) * 60 + parseInt(parts[1] || 0, 10) + (parseInt(parts[2] || 0, 10) / 60);
        }
      } else {
        duration = Number(item.total_duration_minutes) || 0;
      }

      if (raw.includes('OFF') || raw === '0') offDuration += duration;
      else if (raw.includes('ON') && !raw.includes('MOVE') && !raw.includes('MOTION')) onDuration += duration;
      else if (raw.includes('MOVE') || raw.includes('MOVING') || raw.includes('MOTION') || raw.includes('TRANSIT')) moveDuration += duration;
      else if (raw.includes('STOP') || raw.includes('IDLE') || raw.includes('PARK')) stopDuration += duration;

      if (!(raw.includes('OFF') || raw === '0') && item.covered_distance_km) totalDist += Number(item.covered_distance_km);
    });

    const days = moment(dgDateTo).startOf('day').diff(moment(dgDateFrom).startOf('day'), 'days') + 1;
    const totalTime = Math.max(1, days) * 24 * 60;

    return { totalDist, totalTime, onDuration, offDuration, moveDuration, stopDuration };
  }, [allDgLogs, dgDateFrom, dgDateTo]);
  const attr = device.attributes || {};
  const ignition = device.ignition ?? attr.ignition ?? null;
  const charge = device.charge ?? attr.charge ?? null;
  const batteryLevel = device.batteryLevel ?? attr.batteryLevel ?? null;
  const rssi = device.rssi ?? attr.rssi ?? null;
  const motion = device.motion ?? attr.motion ?? null;
  const powerAttr = attr.power ?? attr.battery ?? attr.io1 ?? attr.adc1;
  const power = powerAttr != null ? parseFloat(powerAttr).toFixed(1) : null;

  const isOnline = device.status === 'online';
  const isMoving = device.motion_status === 'moving' || device.motion_status === true || (device.speedKmh || 0) > 2;

  let statusColor = '#ef4444';
  let statusLabel = 'Offline';
  if (isOnline) {
    if (isMoving) { statusColor = '#10b981'; statusLabel = 'Moving'; }
    else { statusColor = '#0284c7'; statusLabel = 'Online'; }
  }

  // ─── DUMMY SUMMARY DATA ───────────────────────────────────────────────────
  const summaryData = {
    distance: '154.32 km',
    runningTime: '23h 53m',
    idleTime: '02h 10m',
    stopTime: '21h 05m',
    tripCount: 16,
    avgSpeed: '42 km/h',
    maxSpeed: '88 km/h',
    overspeed: 2,
    startAddress: 'Civil Lines, Jaipur, RJ',
    endAddress: 'Sitapura Industrial Area, Jaipur, RJ',
    startTime: '08:06 AM',
    endTime: '08:59 PM',
    driverName: 'Rakesh Kumar',
    odometer: '25,862.45 km',
    engineHours: '10h 25m',
    runningPct: 49,
    idlePct: 5,
    stopPct: 46
  };

  // ─── DG Log Card ──────────────────────────────────────────────────────────
  const renderDgLogCard = ({ item }) => {
    const isExpanded = !!expandedCardIds[item.id];
    const rawStatus = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();
    let cardStatusLabel = 'DG OFF';
    let pillStyle = styles.statusPillOff;
    let iconName = 'power-plug-off';

    if (rawStatus.includes('MOVING') || rawStatus.includes('MOVE') || rawStatus.includes('MOTION') || rawStatus.includes('TRANSIT')) {
      cardStatusLabel = 'MOVING'; pillStyle = styles.statusPillMoving; iconName = 'truck-delivery-outline';
    } else if (rawStatus.includes('STOP') || rawStatus.includes('IDLE') || rawStatus.includes('PARK')) {
      cardStatusLabel = 'STOPPED'; pillStyle = styles.statusPillStop; iconName = 'octagon-outline';
    } else if (rawStatus.includes('ON') || rawStatus === '1') {
      cardStatusLabel = 'DG ON'; pillStyle = styles.statusPillOn; iconName = 'lightning-bolt';
    }

    return (
      <View style={styles.logCard}>
        <View style={styles.cardHeader2}>
          <View style={[styles.statusPill, pillStyle]}>
            <Icon name={iconName} size={13} color="#FFF" />
            <Text style={styles.statusPillText}>{cardStatusLabel}</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.logDeviceName, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
              {item.dg_name || item.device_name || `ID: ${item.deviceid}`}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>
                IMEI: {item.uniqueid || ''}
              </Text>
              {item.uniqueid ? (
                <TouchableOpacity onPress={() => {
                  Clipboard.setString(item.uniqueid);
                  ToastAndroid.show('IMEI copied!', ToastAndroid.SHORT);
                }} style={{ padding: 4, marginLeft: 2 }}>
                  <Icon name="content-copy" size={14} color="#0284c7" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.quickTelemetryRow}>
          <View style={styles.telemetryItem}>
            <Icon name="clock-outline" size={15} color="#64748b" />
            <Text style={styles.telemetryText}>{item.total_duration_hms || '00:00:00'}</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Icon name="road-variant" size={15} color="#64748b" />
            <Text style={styles.telemetryText}>{(rawStatus.includes('OFF') || rawStatus === '0') ? 0 : (item.covered_distance_km ?? 0)} KM</Text>
          </View>
          <View style={[styles.telemetryItem, { flex: 1.5 }]}>
            <Icon name="transmission-tower" size={15} color="#64748b" />
            <Text style={styles.telemetryText} numberOfLines={2}>
              {(() => {
                const id = item.site_id || item.nearest_indus_id;
                const dist = item.site_distance != null ? item.site_distance : item.nearest_distance_m;
                return id ? `${id} (${dist != null ? parseFloat(dist).toFixed(2) + ' km' : 'N/A'})` : 'Tower N/A';
              })()}
            </Text>
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
                  {parseFloat(item.start_latitude).toFixed(5)}, {parseFloat(item.start_longitude).toFixed(5)}
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
                  {parseFloat(item.end_latitude).toFixed(5)}, {parseFloat(item.end_longitude).toFixed(5)}
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
            {[
              { label: '🌐 Circle', value: item.circle || 'N/A' },
              { label: '📍 Area / District', value: `${item.area || 'N/A'} / ${item.district || 'N/A'}` },
              { label: '🏫 Site Name / Type', value: `${item.site_name || 'N/A'} (${item.site_type || 'N/A'})` },
              // { label: '🔵 Current Indus ID', value: item.current_indus_id || 'N/A' },
              // { label: '📏 Nearest Distance', value: (item.site_distance != null ? item.site_distance : item.nearest_distance_m) != null ? `${parseFloat(item.site_distance ?? item.nearest_distance_m).toFixed(2)} km` : 'N/A' },
              { label: '🗼 Indus ID (100m)', value: item.indus_id_within_100m || 'None' },
              { label: '📞 IME', value: item.ome_name_as_erp || 'N/A' },
              { label: '👤 AOM', value: `${item.aom_name || 'N/A'}${item.aom_number ? ` (${item.aom_number})` : ''}` },
              { label: '🏢 Client Name', value: item.client_name || 'N/A' },

              // { label: '⏱ Total Duration', value: item.duration_minutes ? item.duration_minutes.split('.')[0] : (item.total_duration_minutes != null ? `${item.total_duration_minutes} mins` : 'N/A') },
              // { label: '🔗 Merged Rows', value: item.merged_rows != null ? String(item.merged_rows) : 'N/A' },
              { label: '⚡ Ext V Start', value: item.start_adc1 != null ? `${parseFloat(item.start_adc1).toFixed(2)} V` : 'N/A' },
              { label: '⚡ Ext V End', value: item.end_adc1 != null ? `${parseFloat(item.end_adc1).toFixed(2)} V` : 'N/A' },
              { label: '📡 GPS Install Date', value: item.gps_install_date ? moment(item.gps_install_date).format('DD/MM/YYYY') : 'N/A' },
            ].map((row, idx) => (
              <View key={idx} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue} numberOfLines={2}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  if (showDailyDetail) {
    return (
      <DailySummaryDetails
        onBack={() => setShowDailyDetail(false)}
        deviceName={device.name}
        deviceId={device.id}
        initialDate={selectedDailyDate}
        onOpenPlayback={(dateStr) => {
          navigation.navigate('Playback', {
            device: initialDevice,
            initialDate: dateStr
          });
        }}
        onGoToDgReport={(status, startD, endD) => {
          setDgStatusFilter(status);
          setDgDateFrom(new Date(startD));
          setDgDateTo(new Date(endD));
          setReturnToSummary(true);
          setShowDailyDetail(false);
          setActiveSegment('DG_REPORT');
        }}
      />
    );
  }

  if (activeSegment === 'SUMMARY') {
    return (
      <SummaryDashboard
        onOpenDaily={(dateStr) => {
          setSelectedDailyDate(dateStr);
          setShowDailyDetail(true);
        }}
        onBackToMap={() => setActiveSegment('LOCATION')}
        onGoToDgReport={(status, startD, endD) => {
          setDgStatusFilter(status);
          setDgDateFrom(new Date(startD));
          setDgDateTo(new Date(endD));
          setReturnToSummary(true);
          setActiveSegment('DG_REPORT');
        }}
        initialFromDate={summaryFromDate}
        initialToDate={summaryToDate}
        onDatesChange={(fromD, toD) => {
          setSummaryFromDate(fromD);
          setSummaryToDate(toD);
        }}
        deviceName={device.name}
        deviceId={device.id}
      />
    );
  }

  const handleHeaderBack = () => {
    if (returnToSummary) {
      setReturnToSummary(false);
      setActiveSegment('SUMMARY');
    } else {
      navigation && navigation.goBack && navigation.goBack();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Header title="DG Console" navigation={navigation} showBack onBackPress={handleHeaderBack} />
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Profile Card ── */}
        <View style={styles.profileHeaderCard}>
          <View style={[styles.largeAvatar, { backgroundColor: `${statusColor}15` }]}>
            <Icon name="car" size={38} color={statusColor} />
          </View>
          <View style={styles.profileHeaderMeta}>
            <Text style={styles.vehicleName}>{device.name}</Text>
            <Text style={styles.imeiText}>IMEI: {device.uniqueId || device.uniqueid}</Text>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15`, marginTop: 8 }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        {/* ── Quick Action Grid ── */}
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
              onPress={() => navigation.navigate(btn.route, { device })}
            >
              <View style={[styles.gridIconBg, { backgroundColor: `${btn.color}10` }]}>
                <Icon name={btn.icon} size={24} color={btn.color} />
              </View>
              <Text style={styles.gridLabel}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Segment Tab Bar ── */}
        <View style={styles.segmentTabBar}>
          {[
            { key: 'SUMMARY', label: 'Summary' },
            { key: 'LOCATION', label: 'Map' },
            // { key: 'TRIPS', label: 'Trips' }, // Hidden as per user request
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

        {/* ── Segment Bodies ── */}

        <View style={styles.segmentContent}>

          {/* ════ LOCATION ════ */}
          {activeSegment === 'LOCATION' && (
            <View style={styles.card}>
              {device.lat && device.lng && device.lat !== 0 ? (
                <View style={styles.miniMapContainer}>
                  <WebView
                    originWhitelist={['*']}
                    source={{
                      html: `<!DOCTYPE html><html>
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
                      </script></body></html>`,
                    }}
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

          {/* ════ TRIPS ════ */}
          {activeSegment === 'TRIPS' && (
            <View style={{ marginTop: 6 }}>
              <View style={styles.filterBar}>
                <TouchableOpacity style={styles.dateChip} onPress={() => setShowTripFromPicker(true)}>
                  <Icon name="calendar-start" size={14} color="#f97316" />
                  <Text style={styles.dateChipText}>{moment(tripDateFrom).format('DD/MM/YYYY')}</Text>
                </TouchableOpacity>
                <Text style={styles.dateChipArrow}>→</Text>
                <TouchableOpacity style={styles.dateChip} onPress={() => setShowTripToPicker(true)}>
                  <Icon name="calendar-end" size={14} color="#f97316" />
                  <Text style={styles.dateChipText}>{moment(tripDateTo).format('DD/MM/YYYY')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyBtn} onPress={loadTrips} disabled={tripsLoading}>
                  <Icon name="magnify" size={16} color="#fff" />
                </TouchableOpacity>
              </View>

              <DatePicker modal open={showTripFromPicker} date={tripDateFrom} mode="date"
                minimumDate={moment(tripDateTo).subtract(30, 'days').toDate()}
                maximumDate={new Date()}
                onConfirm={d => {
                  const from = new Date(d);
                  from.setHours(0, 0, 0, 0);
                  setShowTripFromPicker(false);
                  setTripDateFrom(from);
                  setTripPage(1);
                }}
                onCancel={() => setShowTripFromPicker(false)} title="Trip Start Date" />
              <DatePicker modal open={showTripToPicker} date={tripDateTo} mode="date"
                minimumDate={moment(tripDateFrom).toDate()}
                maximumDate={moment(tripDateFrom).add(30, 'days').toDate()}
                onConfirm={d => {
                  const to = new Date(d);
                  to.setHours(23, 59, 59, 999);
                  setShowTripToPicker(false);
                  setTripDateTo(to);
                  setTripPage(1);
                }}
                onCancel={() => setShowTripToPicker(false)} title="Trip End Date" />

              {tripsLoading ? (
                <ActivityIndicator size="large" color="#1565C0" style={{ marginVertical: 30 }} />
              ) : trips.length === 0 ? (
                <View style={styles.emptyContent}>
                  <Icon name="routes" size={40} color="#cbd5e1" />
                  <Text style={styles.emptyContentText}>No trips found for the selected date range</Text>
                </View>
              ) : (
                <View>
                  <View style={{ paddingHorizontal: 4, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.countText}>Showing {tripsToRender.length} of {tripTotalCount} trips</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#0284c7' }}>
                      Page {tripPage}/{tripTotalPages}
                    </Text>
                  </View>

                  <FlatList
                    data={tripsToRender}
                    keyExtractor={(item, idx) => `trip-${idx}`}
                    scrollEnabled={false}
                    renderItem={({ item: trip, index: idx }) => (
                      <View key={idx} style={[styles.card, { padding: 14, marginBottom: 12 }]}>
                        <View style={styles.tripHeader}>
                          <Text style={[styles.tripTime, {
                            fontWeight: 'bold',
                            color: trip.status === 'OFF' ? '#ef4444'
                              : (trip.status === 'MOVE' || trip.status === 'MOVING') ? '#10b981'
                                : '#facc15',
                          }]}>{trip.status}</Text>
                          <Text style={styles.tripTime}>{formatTime(trip.startTime)} – {formatTime(trip.endTime)}</Text>
                          <Text style={styles.tripDur}>{trip.durationHms ? trip.durationHms : formatDuration(trip.duration / 60)}</Text>
                        </View>
                        <View style={styles.tripRouteRow}>
                          <Icon name="play-circle" size={14} color="#10b981" />
                          <Text style={styles.tripLocText} numberOfLines={1}>{trip.startAddress || 'Loading...'}</Text>
                        </View>
                        <View style={styles.tripRouteRow}>
                          <Icon name="stop-circle" size={14} color="#ef4444" />
                          <Text style={styles.tripLocText} numberOfLines={1}>{trip.endAddress || 'Loading...'}</Text>
                        </View>
                        <View style={styles.tripFooter}>
                          <Text style={styles.tripDist}>{(trip.distance / 1000).toFixed(2)} km</Text>
                        </View>
                      </View>
                    )}
                  />

                  {tripTotalPages > 1 && (
                    <View style={styles.paginationContainer}>
                      <TouchableOpacity
                        style={[styles.pageBtn, (tripPage === 1 || tripsLoading) && styles.pageBtnDisabled]}
                        disabled={tripPage === 1 || tripsLoading}
                        onPress={() => setTripPage(1)}
                      >
                        <Text style={[styles.pageBtnText, tripPage === 1 && styles.pageBtnTextDisabled]}>First</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.pageBtn, (tripPage === 1 || tripsLoading) && styles.pageBtnDisabled]}
                        disabled={tripPage === 1 || tripsLoading}
                        onPress={() => setTripPage(prev => Math.max(1, prev - 1))}
                      >
                        <Icon name="chevron-left" size={20} color={tripPage === 1 ? '#cbd5e1' : '#0284c7'} />
                        <Text style={[styles.pageBtnText, tripPage === 1 && styles.pageBtnTextDisabled]}>Prev</Text>
                      </TouchableOpacity>

                      {Array.from({ length: tripTotalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === tripTotalPages || Math.abs(p - tripPage) <= 1)
                        .map((pageNum, idx, arr) => (
                          <React.Fragment key={pageNum}>
                            {idx > 0 && arr[idx - 1] !== pageNum - 1 && (
                              <Text style={{ color: '#94a3b8', paddingHorizontal: 2 }}>…</Text>
                            )}
                            <TouchableOpacity
                              style={[styles.pageNumberBtn, tripPage === pageNum && styles.pageNumberActive]}
                              onPress={() => setTripPage(pageNum)}
                              disabled={tripsLoading}
                            >
                              <Text style={[styles.pageNumberText, tripPage === pageNum && styles.pageNumberTextActive]}>
                                {pageNum}
                              </Text>
                            </TouchableOpacity>
                          </React.Fragment>
                        ))
                      }

                      <TouchableOpacity
                        style={[styles.pageBtn, (!hasMoreTrips || tripsLoading) && styles.pageBtnDisabled]}
                        disabled={!hasMoreTrips || tripsLoading}
                        onPress={() => setTripPage(prev => prev + 1)}
                      >
                        <Text style={[styles.pageBtnText, !hasMoreTrips && styles.pageBtnTextDisabled]}>Next</Text>
                        <Icon name="chevron-right" size={20} color={!hasMoreTrips ? '#cbd5e1' : '#0284c7'} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.pageBtn, (tripPage === tripTotalPages || tripsLoading) && styles.pageBtnDisabled]}
                        disabled={tripPage === tripTotalPages || tripsLoading}
                        onPress={() => setTripPage(tripTotalPages)}
                      >
                        <Text style={[styles.pageBtnText, tripPage === tripTotalPages && styles.pageBtnTextDisabled]}>Last</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ════ DG REPORT ════ */}
          {activeSegment === 'DG_REPORT' && (
            <View style={{ marginTop: 6 }}>

              <View style={styles.filterBar}>
                <TouchableOpacity style={styles.dateChip} onPress={() => setShowDgFromPicker(true)}>
                  <Icon name="calendar-start" size={14} color="#f97316" />
                  <Text style={styles.dateChipText}>{moment(dgDateFrom).format('DD/MM/YYYY')}</Text>
                </TouchableOpacity>
                <Text style={styles.dateChipArrow}>→</Text>
                <TouchableOpacity style={styles.dateChip} onPress={() => setShowDgToPicker(true)}>
                  <Icon name="calendar-end" size={14} color="#f97316" />
                  <Text style={styles.dateChipText}>{moment(dgDateTo).format('DD/MM/YYYY')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyBtn} onPress={() => { setDgPage(1); loadDgLogs(); }} disabled={dgLoading}>
                  <Icon name="magnify" size={16} color="#fff" />
                </TouchableOpacity>
              </View>

              <DatePicker modal open={showDgFromPicker} date={dgDateFrom} mode="date"
                minimumDate={moment(dgDateTo).subtract(30, 'days').toDate()}
                maximumDate={moment.min(moment(), moment(dgDateTo)).toDate()}
                onConfirm={d => { setShowDgFromPicker(false); setDgDateFrom(d); }}
                onCancel={() => setShowDgFromPicker(false)} title="DG Report Start Date" />
              <DatePicker modal open={showDgToPicker} date={dgDateTo} mode="date"
                minimumDate={moment(dgDateFrom).toDate()}
                maximumDate={moment.min(moment(), moment(dgDateFrom).add(30, 'days')).toDate()}
                onConfirm={d => { setShowDgToPicker(false); setDgDateTo(d); }}
                onCancel={() => setShowDgToPicker(false)} title="DG Report End Date" />

              <View style={styles.dgSummaryBox}>
                <Text style={styles.dgSummaryTitle}>Overview</Text>
                <TouchableOpacity onPress={() => { setDgPage(1); loadDgLogs(); }} disabled={dgLoading}>
                  <Icon name="refresh" size={18} color="#1565C0" />
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <View style={styles.summaryGrid}>
                  <SummaryCard icon="timer-play" title="ON Time" value={formatDuration(dgStats.onDuration)} color="#10b981" />
                  <SummaryCard icon="timer-sand" title="OFF Time" value={formatDuration(dgStats.offDuration)} color="#ef4444" />
                  <SummaryCard icon="truck-delivery-outline" title="Move Time" value={formatDuration(dgStats.moveDuration)} color="#0284c7" />
                  <SummaryCard icon="stop-circle-outline" title="Stop Time" value={formatDuration(dgStats.stopDuration)} color="#f59e0b" />
                  <SummaryCard icon="clock-outline" title="Total Time" value={formatDuration(dgStats.totalTime)} color="#8b5cf6" />
                  <SummaryCard icon="map-marker-distance" title="Move Dist" value={`${dgStats.totalDist.toFixed(2)} km`} color="#1565C0" />
                </View>

                <Text style={[styles.cardTitle, { marginTop: 10 }]}>Day Overview</Text>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressSegment, { backgroundColor: '#10b981', flex: dgStats.onDuration || 1 }]} />
                  <View style={[styles.progressSegment, { backgroundColor: '#0284c7', flex: dgStats.moveDuration || 1 }]} />
                  <View style={[styles.progressSegment, { backgroundColor: '#f59e0b', flex: dgStats.stopDuration || 1 }]} />
                  <View style={[styles.progressSegment, { backgroundColor: '#ef4444', flex: dgStats.offDuration || 1 }]} />
                </View>
                <View style={styles.legendContainer}>
                  <LegendItem color="#10b981" label="ON" value={formatDuration(dgStats.onDuration)} />
                  <LegendItem color="#0284c7" label="Moving" value={formatDuration(dgStats.moveDuration)} />
                  <LegendItem color="#f59e0b" label="Stopped" value={formatDuration(dgStats.stopDuration)} />
                  <LegendItem color="#ef4444" label="OFF" value={formatDuration(dgStats.offDuration)} />
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {['ALL', 'OFF', 'ON', 'MOVE', 'STOPPED'].map(st => (
                  <TouchableOpacity
                    key={st}
                    style={[styles.statusChip, dgStatusFilter === st && styles.statusChipActive]}
                    onPress={() => {
                      setDgStatusFilter(st);
                      setDgPage(1);
                      // Pass new status explicitly so it's used immediately (avoid stale closure)
                      loadDgLogs(1, st);
                    }}
                  >
                    <Text style={[styles.statusChipText, dgStatusFilter === st && styles.statusChipTextActive]}>
                      {st}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {dgLogs.length === 0 && !dgLoading ? (
                <View style={styles.emptyContent}>
                  <Icon name="engine-off" size={40} color="#cbd5e1" />
                  <Text style={styles.emptyContentText}>No DG activities found for the selected filters</Text>
                </View>
              ) : (
                <View>
                  <View style={{ paddingHorizontal: 4, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.countText}>Showing {dgLogs.length} logs</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {dgLoading && <ActivityIndicator size="small" color="#1565C0" style={{ marginRight: 8 }} />}
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#0284c7' }}>
                        Total: {dgTotalCount}
                      </Text>
                    </View>
                  </View>

                  <FlatList
                    data={dgLogs}
                    keyExtractor={(item, index) => `${item.id || index}`}
                    renderItem={renderDgLogCard}
                    scrollEnabled={false}
                  />

                  {totalPages > 1 && (
                    <View style={styles.paginationContainer}>
                      <TouchableOpacity
                        style={[styles.pageBtn, (dgPage === 1 || dgLoading) && styles.pageBtnDisabled]}
                        disabled={dgPage === 1 || dgLoading}
                        onPress={() => setDgPage(1)}
                      >
                        <Text style={[styles.pageBtnText, dgPage === 1 && styles.pageBtnTextDisabled]}>First</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.pageBtn, (dgPage === 1 || dgLoading) && styles.pageBtnDisabled]}
                        disabled={dgPage === 1 || dgLoading}
                        onPress={() => setDgPage(prev => Math.max(1, prev - 1))}
                      >
                        <Icon name="chevron-left" size={20} color={dgPage === 1 ? '#cbd5e1' : '#0284c7'} />
                        <Text style={[styles.pageBtnText, dgPage === 1 && styles.pageBtnTextDisabled]}>Prev</Text>
                      </TouchableOpacity>

                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - dgPage) <= 1)
                        .map((pageNum, idx, arr) => (
                          <React.Fragment key={pageNum}>
                            {idx > 0 && arr[idx - 1] !== pageNum - 1 && (
                              <Text style={{ color: '#94a3b8', paddingHorizontal: 2 }}>…</Text>
                            )}
                            <TouchableOpacity
                              style={[styles.pageNumberBtn, dgPage === pageNum && styles.pageNumberActive, dgLoading && { opacity: 0.5 }]}
                              disabled={dgLoading}
                              onPress={() => setDgPage(pageNum)}
                            >
                              <Text style={[styles.pageNumberText, dgPage === pageNum && styles.pageNumberTextActive]}>
                                {pageNum}
                              </Text>
                            </TouchableOpacity>
                          </React.Fragment>
                        ))
                      }

                      <TouchableOpacity
                        style={[styles.pageBtn, (!hasMoreDgLogs || dgLoading) && styles.pageBtnDisabled]}
                        disabled={!hasMoreDgLogs || dgLoading}
                        onPress={() => setDgPage(prev => prev + 1)}
                      >
                        <Text style={[styles.pageBtnText, !hasMoreDgLogs && styles.pageBtnTextDisabled]}>Next</Text>
                        <Icon name="chevron-right" size={20} color={!hasMoreDgLogs ? '#cbd5e1' : '#0284c7'} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.pageBtn, (dgPage === totalPages || dgLoading) && styles.pageBtnDisabled]}
                        disabled={dgPage === totalPages || dgLoading}
                        onPress={() => setDgPage(totalPages)}
                      >
                        <Text style={[styles.pageBtnText, dgPage === totalPages && styles.pageBtnTextDisabled]}>Last</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

        </View>
      </ScrollView>
    </View>
  );
};

// ─── InfoRow ─────────────────────────────────────────────────────────────────
const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

// ─── Summary UI Components ───────────────────────────────────────────────────
const SummaryCard = ({ icon, title, value, color }) => (
  <View style={styles.summaryCard}>
    <View style={[styles.summaryCardIcon, { backgroundColor: `${color}15` }]}>
      <Icon name={icon} size={20} color={color} />
    </View>
    <View style={styles.summaryCardContent}>
      <Text style={styles.summaryCardTitle}>{title}</Text>
      <Text style={styles.summaryCardValue}>{value}</Text>
    </View>
  </View>
);

const LegendItem = ({ color, label, value }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendColor, { backgroundColor: color }]} />
    <View>
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  </View>
);

const AddInfoItem = ({ icon, label, value }) => (
  <View style={styles.addInfoItem}>
    <Icon name={icon} size={18} color="#64748b" style={{ marginRight: 8, marginTop: 2 }} />
    <View style={{ flex: 1 }}>
      <Text style={styles.addInfoLabel}>{label}</Text>
      <Text style={styles.addInfoValue} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  segmentContent: {},

  summaryFullPage: {
    backgroundColor: '#f1f5f9',
    marginHorizontal: -16, // to take full width inside scroll
    marginTop: -16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  summaryPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    padding: 16,
    paddingTop: 20,
  },
  summaryPageTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  subTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    paddingBottom: 8,
  },
  subTabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  subTabBtnActive: {
    borderBottomColor: '#38bdf8',
  },
  subTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  subTabContent: {
    backgroundColor: '#f8fafc',
    minHeight: 400,
  },

  summaryDateHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  summaryDateText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1e293b', marginLeft: 8 },
  todayBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  todayBadgeText: { color: '#166534', fontSize: 11, fontWeight: '700' },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 4 },
  summaryCard: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  summaryCardIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  summaryCardContent: { flex: 1 },
  summaryCardTitle: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  summaryCardValue: { fontSize: 13, color: '#0f172a', fontWeight: '700' },

  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 12 },

  progressBarContainer: { height: 12, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', marginBottom: 16, backgroundColor: '#f1f5f9' },
  progressSegment: { height: '100%' },

  legendContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  legendColor: { width: 10, height: 10, borderRadius: 3, marginRight: 6, marginTop: 3 },
  legendLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  legendValue: { fontSize: 11, color: '#1e293b', fontWeight: '700' },

  startEndRow: { flexDirection: 'row', justifyContent: 'space-between' },
  startEndCol: { flex: 1, paddingRight: 8 },
  startEndHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  startEndLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginLeft: 4 },
  startEndTime: { fontSize: 13, color: '#0f172a', fontWeight: '700', marginBottom: 4 },
  startEndAddress: { fontSize: 11, color: '#475569', lineHeight: 16 },

  addInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  addInfoItem: { width: '48%', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  addInfoLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  addInfoValue: { fontSize: 12, color: '#1e293b', fontWeight: '700' },

  profileHeaderCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 20,
    padding: 16, borderWidth: 1, borderColor: '#e2e8f0',
    elevation: 3, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8,
    marginBottom: 20,
  },
  largeAvatar: { width: 68, height: 68, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  profileHeaderMeta: { flex: 1 },
  vehicleName: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  imeiText: { fontSize: 12, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, alignSelf: 'flex-start' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  quickGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, gap: 10 },
  gridItem: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#e2e8f0',
    elevation: 2, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6,
  },
  gridIconBg: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  gridLabel: { fontSize: 11, fontWeight: '600', color: '#475569' },

  segmentTabBar: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 24, padding: 4, marginBottom: 16 },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 20 },
  segmentBtnActive: { backgroundColor: '#FFFFFF', elevation: 2, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
  segmentBtnText: { fontSize: 11.5, fontWeight: '600', color: '#64748b' },
  segmentBtnTextActive: { color: '#1565C0', fontWeight: '700' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 16 },
  miniMapContainer: { height: 180, borderRadius: 12, overflow: 'hidden', marginBottom: 14 },
  noMapBox: { height: 120, borderRadius: 12, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  noMapText: { color: '#64748b', fontSize: 12, fontWeight: '500', marginTop: 8 },
  infoList: { gap: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  infoLabel: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#0f172a', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 12 },

  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  tripTime: { fontSize: 11, fontWeight: '700', color: '#475569', flex: 1 },
  tripDur: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  tripRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  tripLocText: { fontSize: 12, color: '#1e293b', fontWeight: '500', flex: 1 },
  tripFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 8 },
  tripDist: { fontSize: 13, fontWeight: '700', color: '#1e293b' },

  emptyContent: { alignItems: 'center', paddingVertical: 32 },
  emptyContentText: { color: '#64748b', fontSize: 13, fontWeight: '500', marginTop: 10 },

  dgOverviewCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 12 },
  dgOverviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dgOverviewLabel: { fontSize: 12, color: '#64748b' },
  dgOverviewValue: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
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
  logDeviceName: { fontSize: 13, fontWeight: '700', color: '#1e293b', flex: 1 },
  quickTelemetryRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderRadius: 8, padding: 8, marginBottom: 12 },
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

  paginationContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  pageBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  pageBtnDisabled: { backgroundColor: '#f1f5f9', borderColor: '#f1f5f9' },
  pageBtnText: { fontSize: 12, fontWeight: '600', color: '#0284c7', marginHorizontal: 2 },
  pageBtnTextDisabled: { color: '#cbd5e1' },
  pageNumberBtn: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  pageNumberActive: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  pageNumberText: { fontSize: 12, color: '#0284c7', fontWeight: '600' },
  pageNumberTextActive: { color: '#fff', fontWeight: '700' },
  countText: { fontSize: 12, color: '#64748b', fontWeight: '600' },

  filterBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 6 },
  dateChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  dateChipText: { fontSize: 11, fontWeight: '700', color: '#1e293b' },
  dateChipArrow: { fontSize: 14, fontWeight: '700', color: '#f97316' },
  applyBtn: { backgroundColor: '#f97316', width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  statusChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9', marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  statusChipActive: { backgroundColor: '#f97316', borderColor: '#f97316' },
  statusChipText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  statusChipTextActive: { color: '#fff' },
});

export default DeviceDetailScreen;