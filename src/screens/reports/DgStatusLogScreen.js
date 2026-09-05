import React, { useState, useEffect, useCallback, useRef } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Clipboard,
  ToastAndroid,
} from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';

import Header from '../../components/Header';
import { fetchDgStatusLogs, fetchDeviceList, reverseGeocode } from '../../api/webApi';
import { useFilter } from '../../context/FilterContext';

// ─── HELPER: Format timestamp nicely ─────────────────────────────────────────
const formatTime = (raw) => {
  if (!raw || raw === 'N/A') return 'N/A';
  const m = moment(raw);
  if (!m.isValid()) return raw;
  return m.format('DD/MM/YYYY, HH:mm:ss');
};

// ─── HELPER: Format total_duration_minutes → HH:MM:SS ─────────────────────────
const formatDuration = (totalMinutes) => {
  const mins = parseInt(totalMinutes, 10) || 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

const PAGE_SIZE = 10;

// ─── Quick‑select date range chips ────────────────────────────────────────────
const QUICK_RANGES = [
  { label: 'Today', days: 0 },
  { label: '1 Day', days: 1 },
  { label: '3 Days', days: 3 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
];

const STATUS_OPTIONS = [
  { key: 'ALL', icon: 'star-outline', color: '#eab308', label: 'All Statuses' },
  { key: 'ON', icon: 'lightning-bolt', color: '#10b981', label: 'DG ON (Running)' },
  { key: 'MOVING', icon: 'truck-delivery-outline', color: '#0284c7', label: 'Moving (In Transit)' },
  { key: 'OFF', icon: 'power-plug-off', color: '#ef4444', label: 'DG OFF' },
  { key: 'STOP', icon: 'octagon-outline', color: '#f59e0b', label: 'Stopped' },
];

const DgStatusLogScreen = ({ route, navigation }) => {
  const { apiFilters } = useFilter();
  const routeDeviceId = route?.params?.deviceId;
  const routeDeviceName = route?.params?.deviceName;

  const [logs, setLogs] = useState([]);
  const [allLogs, setAllLogs] = useState([]); // full filtered set for in-memory pagination
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [devices, setDevices] = useState([]);
  const [selectedDev, setSelectedDev] = useState(null);

  const [fullLogs, setFullLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [searchQuery, setSearchQuery] = useState('');

  const filteredDevices = devices.filter(d => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (d.name || '').toLowerCase().includes(q) ||
      (d.uniqueid || '').toLowerCase().includes(q) ||
      (d.iccid || '').toLowerCase().includes(q) ||
      String(d.id).includes(q);
  });

  const [showFilters, setShowFilters] = useState(false);
  const [showDevPicker, setShowDevPicker] = useState(false);

  const [deviceName, setDeviceName] = useState(routeDeviceName || '');
  const [deviceId, setDeviceId] = useState(routeDeviceId ? String(routeDeviceId) : '');

  const todayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const [startDate, setStartDate] = useState(todayStart);
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; });

  const [imeiFilter, setImeiFilter] = useState('');
  const [tempImeiFilter, setTempImeiFilter] = useState('');

  const [tempStartDate, setTempStartDate] = useState(todayStart);
  const [tempEndDate, setTempEndDate] = useState(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; });

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState('start');
  const [tempPickerDate, setTempPickerDate] = useState(new Date());

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tempStatusFilter, setTempStatusFilter] = useState('ALL');
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const [expandedCardIds, setExpandedCardIds] = useState({});

  useEffect(() => {
    if (selectedDev) {
      setDeviceName(selectedDev.name || '');
      setDeviceId(selectedDev.deviceid ? String(selectedDev.deviceid) : String(selectedDev.id || ''));
    } else {
      setDeviceName('');
      setDeviceId('');
    }
  }, [selectedDev]);

  const openDatePicker = (mode) => {
    setPickerMode(mode);
    setTempPickerDate(mode === 'start' ? tempStartDate : tempEndDate);
    setPickerVisible(true);
  };

  const onPickerChange = (event, selected) => {
    if (Platform.OS === 'android') {
      setPickerVisible(false);
      if (event.type === 'dismissed') return;
      if (selected) {
        if (pickerMode === 'start') {
          const startDay = moment(selected).startOf('day').toDate();
          setTempStartDate(startDay);
        } else {
          const endDay = moment(selected).endOf('day').toDate();
          setTempEndDate(endDay);
        }
      }
    } else {
      if (selected) {
        if (pickerMode === 'start') {
          const startDay = moment(selected).startOf('day').toDate();
          setTempStartDate(startDay);
        } else {
          const endDay = moment(selected).endOf('day').toDate();
          setTempEndDate(endDay);
        }
      }
    }
  };

  const confirmIOSDate = () => {
    if (pickerMode === 'start') setTempStartDate(tempPickerDate);
    else setTempEndDate(tempPickerDate);
    setPickerVisible(false);
  };

  const applyQuickRange = (days) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    setTempStartDate(start);
    setTempEndDate(end);
  };

  const lazyGeocodeAddresses = useCallback(async (currentLogs) => {
    for (let i = 0; i < currentLogs.length; i++) {
      const item = currentLogs[i];
      let updated = false;
      let startAddress = item.start_address;
      let endAddress = item.end_address;

      if ((!startAddress || startAddress === 'null' || startAddress === '—') && item.start_latitude && item.start_longitude) {
        try {
          const addr = await reverseGeocode(item.start_latitude, item.start_longitude);
          if (addr && addr !== '—') { startAddress = addr; updated = true; }
        } catch (e) { }
      }

      if ((!endAddress || endAddress === 'null' || endAddress === '—') && item.end_latitude && item.end_longitude) {
        try {
          const addr = await reverseGeocode(item.end_latitude, item.end_longitude);
          if (addr && addr !== '—') { endAddress = addr; updated = true; }
        } catch (e) { }
      }

      if (updated) {
        setLogs(prev => prev.map(l => l.id === item.id ? { ...l, start_address: startAddress, end_address: endAddress } : l));
      }
    }
  }, []);

  const abortControllerRef = useRef(null);
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const loadLogs = useCallback(async (isRefresh = false, overrideParams = null, statusOverride = undefined) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const activeStatus = statusOverride !== undefined ? statusOverride : statusFilter;
    const currentPage = overrideParams?.page ?? 1;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const startMom = overrideParams?.start_date ? moment(overrideParams.start_date).startOf('day') : moment(startDate).startOf('day');
      const endMom = overrideParams?.end_date ? moment(overrideParams.end_date).endOf('day') : moment(endDate).endOf('day');

      const devIdParam = overrideParams?.deviceid !== undefined ? overrideParams.deviceid : (overrideParams?.device_id !== undefined ? overrideParams.device_id : deviceId.trim());
      const devNameParam = overrideParams?.dg_name !== undefined ? overrideParams.dg_name : deviceName.trim();

      const params = {
        start_date: startMom.format('YYYY-MM-DD'),
        end_date: endMom.format('YYYY-MM-DD'),
        page: 1,
        limit: 9999, // Fetch all records for INSTANT client-side pagination
        ...apiFilters
      };

      if (devIdParam) params.deviceid = devIdParam;
      if (devNameParam) params.dg_name = devNameParam;

      // We will perform local filtering for status to ensure it perfectly matches the UI definitions.
      // (The backend might not support all status types like 'OFF', 'STOP' for this endpoint).

      const response = await fetchDgStatusLogs(params, signal);
      if (signal.aborted) return;

      let rawLogList = Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);

      const appliedImei = overrideParams?.imei !== undefined ? overrideParams.imei : imeiFilter;
      if (appliedImei && appliedImei.trim() !== '') {
        const query = appliedImei.trim().toLowerCase();
        rawLogList = rawLogList.filter(item => String(item.uniqueid || '').toLowerCase().includes(query));
      }

      if (activeStatus && activeStatus !== 'ALL') {
        rawLogList = rawLogList.filter(item => {
          const rawStatus = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();
          const isMoving = rawStatus.includes('MOVING') || rawStatus.includes('MOVE') || rawStatus.includes('MOTION') || rawStatus.includes('TRANSIT');
          const isStopped = rawStatus.includes('STOP') || rawStatus.includes('IDLE') || rawStatus.includes('PARK');
          const isOn = rawStatus.includes('ON') || rawStatus === '1';

          if (activeStatus === 'MOVING') return isMoving;
          if (activeStatus === 'STOP') return isStopped;
          if (activeStatus === 'ON') return isOn;
          if (activeStatus === 'OFF') return !isMoving && !isStopped && !isOn;
          return true;
        });
      }

      const total = rawLogList.length;

      setAllLogs(rawLogList); // Save full list for instant page changes
      setTotalCount(total);

      const maxPages = Math.max(1, Math.ceil(total / pageSize));
      const validPage = Math.min(currentPage, maxPages);

      if (currentPage !== validPage && overrideParams?.page === undefined) {
        setPage(validPage);
      } else if (overrideParams?.page === undefined) {
        setPage(currentPage);
      }

      setHasMore(validPage < maxPages);

      const startIdx = (validPage - 1) * pageSize;
      const sliced = rawLogList.slice(startIdx, startIdx + pageSize);
      setLogs(sliced);

      if (sliced.length > 0) {
        lazyGeocodeAddresses(sliced);
      }
    } catch (e) {
      if (!signal.aborted) {
        console.warn('Failed to fetch DG logs:', e);
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [deviceId, deviceName, startDate, endDate, pageSize, statusFilter, lazyGeocodeAddresses, imeiFilter, apiFilters]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    const handleRouteParams = (deviceList) => {
      let resolvedDeviceId = '';
      let resolvedDeviceName = '';

      if (routeDeviceId) {
        const matched = deviceList.find(d => String(d.id) === String(routeDeviceId));
        if (matched) {
          setSelectedDev(matched);
          resolvedDeviceId = String(matched.deviceid || matched.id);
          resolvedDeviceName = matched.name || '';
        } else {
          setSelectedDev({ id: routeDeviceId, name: routeDeviceName || `Device ID: ${routeDeviceId}` });
          resolvedDeviceId = String(routeDeviceId);
          resolvedDeviceName = routeDeviceName || '';
        }
      } else {
        setSelectedDev(null);
      }

      const initParams = {};
      if (resolvedDeviceId) initParams.device_id = resolvedDeviceId;
      if (resolvedDeviceName) initParams.dg_name = resolvedDeviceName;
      initParams.start_date = moment(startDate).format('YYYY-MM-DD');
      initParams.end_date = moment(endDate).format('YYYY-MM-DD');
      loadLogs(false, initParams);
    };

    if (devices.length === 0) {
      fetchDeviceList(apiFilters)
        .then(data => {
          const list = data?.devices || [];
          setDevices(list);
          handleRouteParams(list);
        })
        .catch(err => {
          console.warn('Device list load failed:', err.message);
          handleRouteParams([]);
        });
    } else {
      handleRouteParams(devices);
    }
  }, [routeDeviceId, routeDeviceName, apiFilters]);

  const handleApply = () => {
    const newStatus = tempStatusFilter;
    setStatusFilter(newStatus);
    let start = tempStartDate;
    let end = tempEndDate;
    if (!end || moment(end).isBefore(start, 'day')) {
      end = moment(start).endOf('day').toDate();
    } else {
      end = moment(end).endOf('day').toDate();
    }
    setStartDate(start);
    setEndDate(end);
    setImeiFilter(tempImeiFilter);
    setPage(1);
    setShowFilters(false);

    const params = {};
    if (deviceId.trim()) params.device_id = deviceId.trim();
    if (deviceName.trim()) params.dg_name = deviceName.trim();
    params.start_date = moment(start).format('YYYY-MM-DD');
    params.end_date = moment(end).format('YYYY-MM-DD');
    params.imei = tempImeiFilter;
    params.page = 1;

    setLoading(true);
    // Pass newStatus explicitly so the correct filter is used immediately
    loadLogs(false, params, newStatus);
  };

  const handleReset = () => {
    setStatusFilter('ALL');
    setTempStatusFilter('ALL');
    setShowStatusPicker(false);
    setShowDevPicker(false);
    setSearchQuery('');
    setImeiFilter('');
    setTempImeiFilter('');

    const defaultStart = todayStart();
    const defaultEnd = new Date();
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    setTempStartDate(defaultStart);
    setTempEndDate(defaultEnd);
    setPage(1);
    setShowFilters(false);

    let resolvedDeviceId = '';
    let resolvedDeviceName = '';

    if (!routeDeviceId) {
      setSelectedDev(null);
      setDeviceName('');
      setDeviceId('');
    } else {
      const matched = devices.find(d => String(d.id) === String(routeDeviceId));
      setSelectedDev(matched || { id: routeDeviceId, name: routeDeviceName || `Device ID: ${routeDeviceId}` });
      resolvedDeviceId = matched ? String(matched.deviceid || matched.id) : String(routeDeviceId);
      resolvedDeviceName = matched ? (matched.name || '') : (routeDeviceName || '');
    }

    setLoading(true);
    const params = {};
    params.device_id = resolvedDeviceId || '';
    params.dg_name = resolvedDeviceName || '';
    params.imei = '';
    params.start_date = moment(defaultStart).format('YYYY-MM-DD');
    params.end_date = moment(defaultEnd).format('YYYY-MM-DD');
    params.page = 1;

    // Pass 'ALL' explicitly so filter is cleared immediately
    loadLogs(false, params, 'ALL');
  };

  const handleLoadMore = () => {
    if (!loadingMore && !loading && hasMore) {
      setPage(prev => prev + 1);
    }
  };

  // Trigger log update when page changes (pure in-memory pagination)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Pure in-memory pagination slicing
    if (allLogs.length > 0) {
      const startIdx = (page - 1) * pageSize;
      const sliced = allLogs.slice(startIdx, startIdx + pageSize);
      setLogs(sliced);
      lazyGeocodeAddresses(sliced);
    }
  }, [page, pageSize]);

  const toggleExpand = (id) => setExpandedCardIds(prev => ({ ...prev, [id]: !prev[id] }));

  const handleCopyUid = (uid) => {
    if (!uid) return;
    Clipboard.setString(uid);
    ToastAndroid.show('IMEI copied!', ToastAndroid.SHORT);
  };

  // ─── Render card ──────────────────────────────────────────────────────────
  const renderLogCard = ({ item }) => {
    const isExpanded = !!expandedCardIds[item.id];
    const rawStatus = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();

    let statusLabel = 'DG OFF';
    let pillStyle = styles.pillOff;
    let iconName = 'power-plug-off';

    if (rawStatus.includes('MOVING') || rawStatus.includes('MOVE') || rawStatus.includes('MOTION') || rawStatus.includes('TRANSIT')) {
      statusLabel = 'MOVING'; pillStyle = styles.pillMoving; iconName = 'truck-delivery-outline';
    } else if (rawStatus.includes('STOP') || rawStatus.includes('IDLE') || rawStatus.includes('PARK')) {
      statusLabel = 'STOPPED'; pillStyle = styles.pillStop; iconName = 'octagon-outline';
    } else if (rawStatus.includes('ON') || rawStatus === '1') {
      statusLabel = 'DG ON'; pillStyle = styles.pillOn; iconName = 'lightning-bolt';
    }

    return (
      <View style={styles.logCard}>
        <View style={styles.cardHeader}>
          <View style={[styles.statusPill, pillStyle]}>
            <Icon name={iconName} size={13} color="#FFF" />
            <Text style={styles.pillText}>{statusLabel}</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.deviceNameText, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
              {item.dg_name || item.device_name || `ID: ${item.deviceid}`}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>
                IMEI: {item.uniqueid || ''}
              </Text>
              {item.uniqueid ? (
                <TouchableOpacity onPress={() => handleCopyUid(item.uniqueid)} style={{ padding: 4, marginLeft: 2 }}>
                  <Icon name="content-copy" size={14} color="#0284c7" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.telemetryRow}>
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
                return id ? `${id} (${dist != null ? dist + ' m' : 'N/A'})` : 'Tower N/A';
              })()}
            </Text>
          </View>
        </View>

        <View style={styles.journeyBox}>
          <View style={styles.addressNode}>
            <Icon name="play-circle-outline" size={18} color="#10b981" style={styles.nodeIcon} />
            <View style={styles.addressDetails}>
              <Text style={styles.timeLabel}>Start: {formatTime(item.start_time)}</Text>
              <Text style={styles.addressText} numberOfLines={2}>{item.start_address || 'Address Not Available'}</Text>
              {item.start_latitude && (
                <Text style={styles.coordsText}>{parseFloat(item.start_latitude).toFixed(5)}, {parseFloat(item.start_longitude).toFixed(5)}</Text>
              )}
            </View>
          </View>
          <View style={styles.connectorLine} />
          <View style={styles.addressNode}>
            <Icon name="stop-circle-outline" size={18} color="#ef4444" style={styles.nodeIcon} />
            <View style={styles.addressDetails}>
              <Text style={styles.timeLabel}>End: {formatTime(item.end_time)}</Text>
              <Text style={styles.addressText} numberOfLines={2}>{item.end_address || 'Address Not Available'}</Text>
              {item.end_latitude && (
                <Text style={styles.coordsText}>{parseFloat(item.end_latitude).toFixed(5)}, {parseFloat(item.end_longitude).toFixed(5)}</Text>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.id)}>
          <Text style={styles.expandBtnText}>{isExpanded ? 'Hide Site Details' : 'Show Industrial Site Details'}</Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#0284c7" />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedDrawer}>
            {[
              { label: '🌐 Circle', value: item.circle || 'N/A' },
              { label: '📍 Area / District', value: `${item.area || 'N/A'} / ${item.district || 'N/A'}` },
              { label: '🏫 Site Name / Type', value: `${item.site_name || 'N/A'} (${item.site_type || 'N/A'})` },
              { label: '🗼 Indus ID (100m)', value: item.indus_id_within_100m || 'None' },
              { label: '📞 IME', value: item.ome_name_as_erp || 'N/A' },
              { label: '👤 AOM', value: `${item.aom_name || 'N/A'}${item.aom_number ? ` (${item.aom_number})` : ''}` },
              { label: '🏢 Client Name', value: item.client_name || 'N/A' },
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

  // ─── DATE PICKER MODAL ─────────────────────────────────────────────────────
  const renderDatePickerModal = () => (
    <Modal
      visible={pickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPickerVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.dateModalCard}>
          <View style={styles.dateModalHeader}>
            <Icon name={pickerMode === 'start' ? 'calendar-arrow-right' : 'calendar-arrow-left'} size={22} color="#0284c7" />
            <Text style={styles.dateModalTitle}>
              {pickerMode === 'start' ? 'Select Start Date' : 'Select End Date'}
            </Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)}>
              <Icon name="close-circle" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <DateTimePicker
            value={Platform.OS === 'ios' ? tempPickerDate : (pickerMode === 'start' ? tempStartDate : tempEndDate)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
            onChange={onPickerChange}
            minimumDate={pickerMode === 'start' ? moment(tempEndDate).subtract(30, 'days').toDate() : moment(tempStartDate).toDate()}
            maximumDate={pickerMode === 'start' ? moment.min(moment(), moment(tempEndDate)).toDate() : moment.min(moment(), moment(tempStartDate).add(30, 'days')).toDate()}
            style={styles.datePickerInModal}
          />

          {Platform.OS === 'ios' && (
            <View style={styles.iosPickerActions}>
              <TouchableOpacity style={styles.iosCancelBtn} onPress={() => setPickerVisible(false)}>
                <Text style={styles.iosCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iosConfirmBtn} onPress={confirmIOSDate}>
                <Text style={styles.iosConfirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );

  // ─── FILTER PANEL ──────────────────────────────────────────────────────────
  const renderFilterPanel = () => (
    <View style={styles.filterPanel}>
      <Text style={styles.filterTitle}>
        <Icon name="filter-menu" size={16} color="#0284c7" /> Filter DG Report
      </Text>

      {routeDeviceId ? (
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>TARGET DEVICE</Text>
          <View style={styles.lockedRow}>
            <Icon name="truck-lock" size={18} color="#0284c7" />
            <Text style={styles.lockedText}>{routeDeviceName || `Device ID: ${routeDeviceId}`}</Text>
            <View style={styles.lockedBadge}><Text style={styles.lockedBadgeText}>Locked</Text></View>
          </View>
        </View>
      ) : (
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>DEVICE</Text>
          <TouchableOpacity style={styles.selectorBtn} onPress={() => setShowDevPicker(!showDevPicker)}>
            <Icon name="truck-outline" size={18} color="#0284c7" />
            <Text style={styles.selectorBtnText} numberOfLines={1}>
              {selectedDev ? selectedDev.name : 'All Devices'}
            </Text>
            <Icon name={showDevPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
          </TouchableOpacity>

          {showDevPicker && (
            <View style={styles.dropdownCard}>
              <View style={styles.searchRow}>
                <Icon name="magnify" size={16} color="#94a3b8" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search device..."
                  placeholderTextColor="#94a3b8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close" size={16} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
                <TouchableOpacity
                  style={[styles.dropdownItem, !selectedDev && styles.dropdownItemActive]}
                  onPress={() => { setSelectedDev(null); setShowDevPicker(false); setSearchQuery(''); }}
                >
                  <Icon name="star-outline" size={15} color="#eab308" />
                  <Text style={[styles.dropdownItemText, !selectedDev && styles.dropdownItemTextActive]}>All Devices</Text>
                </TouchableOpacity>
                {filteredDevices.map(d => {
                  const isSelected = selectedDev?.id === d.id;
                  const dotColor = d.status === 'online' ? '#10b981' : d.status === 'offline' ? '#ef4444' : '#f59e0b';
                  return (
                    <TouchableOpacity
                      key={d.id}
                      style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                      onPress={() => { setSelectedDev(d); setShowDevPicker(false); setSearchQuery(''); }}
                    >
                      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                      <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]} numberOfLines={1}>{d.name || `ID: ${d.id}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>DATE RANGE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
          {QUICK_RANGES.map(r => (
            <TouchableOpacity key={r.label} style={styles.chip} onPress={() => applyQuickRange(r.days)}>
              <Text style={styles.chipText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => openDatePicker('start')}>
            <Icon name="calendar-start" size={18} color="#0284c7" />
            <View style={styles.dateBtnContent}>
              <Text style={styles.dateBtnLabel}>From</Text>
              <Text style={styles.dateBtnValue}>{moment(tempStartDate).format('DD/MM/YYYY')}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.dateArrow}>
            <Icon name="arrow-right" size={18} color="#94a3b8" />
          </View>
          <TouchableOpacity style={styles.dateBtn} onPress={() => openDatePicker('end')}>
            <Icon name="calendar-end" size={18} color="#10b981" />
            <View style={styles.dateBtnContent}>
              <Text style={styles.dateBtnLabel}>To</Text>
              <Text style={styles.dateBtnValue}>{moment(tempEndDate).format('DD/MM/YYYY')}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>PAGE SIZE</Text>
        <TextInput
          style={styles.pageSizeInput}
          keyboardType="numeric"
          placeholder="10"
          placeholderTextColor="#94a3b8"
          value={String(pageSize)}
          onChangeText={text => {
            const num = parseInt(text, 10);
            if (!isNaN(num) && num > 0) setPageSize(num);
          }}
        />
      </View>

      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>DG STATUS</Text>
        <View style={styles.statusChipsGrid}>
          {STATUS_OPTIONS.map(opt => {
            const active = tempStatusFilter === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.statusChip, active && { backgroundColor: opt.color, borderColor: opt.color }]}
                onPress={() => setTempStatusFilter(opt.key)}
              >
                <Icon name={opt.icon} size={13} color={active ? '#FFF' : opt.color} />
                <Text style={[styles.statusChipText, active && { color: '#FFF' }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>IMEI</Text>
        <View style={styles.searchRow}>
          <Icon name="barcode-scan" size={16} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by IMEI..."
            placeholderTextColor="#94a3b8"
            value={tempImeiFilter}
            onChangeText={setTempImeiFilter}
          />
          {tempImeiFilter.length > 0 && (
            <TouchableOpacity onPress={() => setTempImeiFilter('')}>
              <Icon name="close" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.filterActions}>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Icon name="refresh" size={16} color="#64748b" />
          <Text style={styles.resetBtnText}>Reset</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.applyBtn} onPress={handleApply}>
          <Icon name="check-circle-outline" size={16} color="#FFF" />
          <Text style={styles.applyBtnText}>Apply Filter</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Header
        title={routeDeviceName ? `${routeDeviceName} Logs` : 'DG Report'}
        navigation={navigation}
        showBack={navigation.canGoBack()}
        rightAction={
          <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.headerBtn}>
            <Icon name={showFilters ? 'filter-off-outline' : 'filter-menu-outline'} size={22} color="#FFF" />
          </TouchableOpacity>
        }
      />

      {renderDatePickerModal()}
      {showFilters && renderFilterPanel()}
      <View style={{ flex: 1 }}>
        {logs.length === 0 && !loading && !refreshing ? (
          <View style={styles.center}>
            <Icon name="filter-remove-outline" size={64} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No Matching Logs</Text>
            <Text style={styles.emptySubtitle}>No records matched the status filter.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setStatusFilter('ALL'); setTempStatusFilter('ALL'); setPage(1); loadLogs(false); }}>
              <Text style={styles.retryText}>Clear Status Filter</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.countText}>
                Showing {logs.length} logs for {moment(startDate).isSame(endDate, 'day') ? moment(startDate).format('DD/MM/YYYY') : `${moment(startDate).format('DD/MM/YYYY')} - ${moment(endDate).format('DD/MM/YYYY')}`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {loading && <ActivityIndicator size="small" color="#0284c7" style={{ marginRight: 8 }} />}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#0284c7' }}>Total: {totalCount}</Text>
              </View>
            </View>
            <FlatList
              data={logs}
              keyExtractor={item => String(item.id)}
              renderItem={renderLogCard}
              contentContainerStyle={styles.listContent}
              refreshing={refreshing}
              onRefresh={() => { setPage(1); loadLogs(true); }}
            />
            <View style={styles.paginationContainer}>
              <TouchableOpacity
                style={[styles.pageBtn, (page === 1 || loading || loadingMore || refreshing) && styles.pageBtnDisabled]}
                disabled={page === 1 || loading || loadingMore || refreshing}
                onPress={() => setPage(1)}
              >
                <Text style={[styles.pageBtnText, page === 1 && styles.pageBtnTextDisabled]}>First</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pageBtn, (page === 1 || loading || loadingMore || refreshing) && styles.pageBtnDisabled]}
                disabled={page === 1 || loading || loadingMore || refreshing}
                onPress={() => setPage(prev => Math.max(1, prev - 1))}
              >
                <Icon name="chevron-left" size={20} color={page === 1 ? "#cbd5e1" : "#0284c7"} />
              </TouchableOpacity>

              {(() => {
                const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
                const pageButtons = [];
                const maxButtons = 3;
                let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
                let endPage = Math.min(totalPages, startPage + maxButtons - 1);
                if (endPage - startPage < maxButtons - 1) {
                  startPage = Math.max(1, endPage - maxButtons + 1);
                }
                for (let p = startPage; p <= endPage; p++) {
                  const isActive = p === page;
                  pageButtons.push(
                    <TouchableOpacity
                      key={p}
                      style={[styles.pageBtn, isActive && styles.pageBtnActive]}
                      disabled={loading || loadingMore || refreshing}
                      onPress={() => setPage(p)}
                    >
                      <Text style={[styles.pageBtnText, isActive && styles.pageBtnTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  );
                }
                return pageButtons;
              })()}
              <TouchableOpacity
                style={[styles.pageBtn, (!hasMore || loading || loadingMore || refreshing) && styles.pageBtnDisabled]}
                disabled={!hasMore || loading || loadingMore || refreshing}
                onPress={() => setPage(prev => prev + 1)}
              >
                <Icon name="chevron-right" size={20} color={!hasMore ? "#cbd5e1" : "#0284c7"} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pageBtn, (!hasMore || loading || loadingMore || refreshing) && styles.pageBtnDisabled]}
                disabled={!hasMore || loading || loadingMore || refreshing}
                onPress={() => {
                  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
                  setPage(totalPages);
                }}
              >
                <Text style={[styles.pageBtnText, !hasMore && styles.pageBtnTextDisabled]}>Last</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {showFilters && (
          <TouchableOpacity
            activeOpacity={1}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.15)', zIndex: 10 }]}
            onPress={() => setShowFilters(false)}
          />
        )}
      </View>
    </View>
  );
};

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  headerBtn: { padding: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748b', fontWeight: '500' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#334155', marginTop: 16, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: '#64748b', marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },
  retryBtn: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0284c7', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8,
  },
  retryText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  listContent: { padding: 16, paddingBottom: 40 },
  countText: { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 12, paddingLeft: 2 },
  footerLoader: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, gap: 8 },
  footerLoaderText: { fontSize: 13, color: '#64748b' },
  endText: { textAlign: 'center', fontSize: 12, color: '#94a3b8', paddingVertical: 16 },

  paginationContainer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  pageBtn: {
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: '#f8fafc', borderRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  pageBtnActive: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  pageBtnTextActive: { color: '#FFF' },
  pageBtnTextDisabled: { color: '#cbd5e1' },

  filterPanel: {
    backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    elevation: 6, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6,
  },
  filterTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 14 },
  filterSection: { marginBottom: 14 },
  filterLabel: { fontSize: 10, fontWeight: '800', color: '#94a3b8', letterSpacing: 1, marginBottom: 8 },

  selectorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f8fafc', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  selectorBtnText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#1e293b' },

  dropdownCard: {
    backgroundColor: '#FFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#e2e8f0', marginTop: 6, elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b', paddingVertical: 0 },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc',
  },
  dropdownItemActive: { backgroundColor: '#eff6ff' },
  dropdownItemText: { flex: 1, fontSize: 13, color: '#475569' },
  dropdownItemTextActive: { color: '#0284c7', fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  lockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#eff6ff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#bae6fd',
  },
  lockedText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#0369a1' },
  lockedBadge: { backgroundColor: '#0284c7', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  lockedBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },

  chipsRow: { marginBottom: 10 },
  chip: {
    backgroundColor: '#f1f5f9', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
    marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0',
  },
  chipText: { fontSize: 12, fontWeight: '600', color: '#475569' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f8fafc', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  dateBtnContent: { flex: 1 },
  dateBtnLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5 },
  dateBtnValue: { fontSize: 13, fontWeight: '700', color: '#1e293b', marginTop: 2 },
  dateArrow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center',
  },

  statusChipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  statusChipText: { fontSize: 11.5, fontWeight: '600', color: '#475569' },

  filterActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flex: 1, justifyContent: 'center',
    paddingVertical: 11, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  resetBtnText: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flex: 2, justifyContent: 'center',
    paddingVertical: 11, borderRadius: 10, backgroundColor: '#0284c7',
  },
  applyBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  pageSizeInput: {
    backgroundColor: '#f8fafc', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0',
    fontSize: 14, fontWeight: '600', color: '#1e293b',
  },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  dateModalCard: {
    backgroundColor: '#FFF', borderRadius: 16, width: '100%',
    overflow: 'hidden', elevation: 10,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  dateModalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  dateModalTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1e293b' },
  datePickerInModal: { backgroundColor: '#FFF' },
  iosPickerActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },
  iosCancelBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  iosCancelText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  iosConfirmBtn: { backgroundColor: '#0284c7', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  iosConfirmText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  logCard: {
    backgroundColor: '#FFF', borderRadius: 14, marginBottom: 14, padding: 14,
    elevation: 2, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 10, marginBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 6, marginRight: 10 },
  pillOn: { backgroundColor: '#10b981' },
  pillOff: { backgroundColor: '#ef4444' },
  pillMoving: { backgroundColor: '#0284c7' },
  pillStop: { backgroundColor: '#f59e0b' },
  pillText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  deviceNameText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1e293b' },

  telemetryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 12,
  },
  telemetryItem: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 5 },
  telemetryText: { fontSize: 12, fontWeight: '600', color: '#475569' },

  journeyBox: { paddingLeft: 2, marginBottom: 8 },
  addressNode: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nodeIcon: { marginTop: 1 },
  addressDetails: { flex: 1 },
  timeLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  addressText: { fontSize: 13, color: '#0f172a', fontWeight: '600', lineHeight: 18 },
  coordsText: { fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 },
  connectorLine: { width: 1, height: 14, backgroundColor: '#cbd5e1', marginLeft: 9, marginVertical: 3 },

  expandBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 4,
  },
  expandBtnText: { fontSize: 12, fontWeight: '600', color: '#0284c7' },

  expandedDrawer: {
    backgroundColor: '#f8fafc', borderRadius: 10,
    padding: 12, marginTop: 10, gap: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  detailLabel: { fontSize: 11.5, fontWeight: '600', color: '#64748b', flex: 1.2 },
  detailValue: { fontSize: 11.5, fontWeight: '600', color: '#1e293b', flex: 2, textAlign: 'right' },
});

export default DgStatusLogScreen;