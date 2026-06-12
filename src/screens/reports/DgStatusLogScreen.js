import React, { useState, useEffect, useCallback } from 'react';
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
  Platform,
  PermissionsAndroid,
  ToastAndroid,
} from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';

import Header from '../../components/Header';
import { fetchDgStatusLogs, fetchDeviceList, reverseGeocode } from '../../api/webApi';

// ─── HELPER: Format timestamp nicely ─────────────────────────────────────────
// Converts "2026-05-31T13:50:30" → "31 May 2026, 1:50 PM"
const formatTime = (raw) => {
  if (!raw || raw === 'N/A') return 'N/A';
  const m = moment(raw);
  if (!m.isValid()) return raw;
  return m.format('DD MMM YYYY, h:mm A');
};

const DgStatusLogScreen = ({ route, navigation }) => {
  // Check if routed with specific device filters
  const routeDeviceId = route?.params?.deviceId;
  const routeDeviceName = route?.params?.deviceName;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Device dropdown selection lists state
  const [devices, setDevices] = useState([]);
  const [selectedDev, setSelectedDev] = useState(null);
  // Search query for device picker filter
  const [searchQuery, setSearchQuery] = useState('');
  // Filtered device list based on search query (name, uniqueid, iccid, id)
  const filteredDevices = devices.filter(d => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = (d.name || '').toLowerCase();
    const uid = (d.uniqueid || '').toLowerCase();
    const iccid = (d.iccid || '').toLowerCase();
    const idStr = String(d.id);
    return name.includes(q) || uid.includes(q) || iccid.includes(q) || idStr.includes(q);
  });

  // Sync selected device with filter states
  useEffect(() => {
    if (selectedDev) {
      setDeviceName(selectedDev.name || '');
      setDeviceId(selectedDev.deviceid ? String(selectedDev.deviceid) : (selectedDev.id ? String(selectedDev.id) : ''));
    } else {
      setDeviceName('');
      setDeviceId('');
    }
  }, [selectedDev]);

  const [showDevPicker, setShowDevPicker] = useState(false);

  // Filter states — no default date range, load all records by default
  const [deviceName, setDeviceName] = useState(routeDeviceName || '');
  const [deviceId, setDeviceId] = useState(routeDeviceId ? String(routeDeviceId) : '');
  const [showFilters, setShowFilters] = useState(false);

  // Status Filter States
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tempStatusFilter, setTempStatusFilter] = useState('ALL');
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // Keep track of which cards are expanded
  const [expandedCardIds, setExpandedCardIds] = useState({});

  // ─── LAZY GEOCODE ADDRESSES FALLBACK ────────────────────────────────────────
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
        } catch (e) {
          console.warn('[DgLogs] Start geocode failed for:', item.id, e.message);
        }
      }

      if ((!endAddress || endAddress === 'null' || endAddress === '—') && item.end_latitude && item.end_longitude) {
        try {
          const addr = await reverseGeocode(item.end_latitude, item.end_longitude);
          if (addr && addr !== '—') { endAddress = addr; updated = true; }
        } catch (e) {
          console.warn('[DgLogs] End geocode failed for:', item.id, e.message);
        }
      }

      if (updated) {
        setLogs((prevLogs) =>
          prevLogs.map((log) =>
            log.id === item.id ? { ...log, start_address: startAddress, end_address: endAddress } : log
          )
        );
      }
    }
  }, []);

  // ─── FETCH LOGS FROM API ───────────────────────────────────────────────────
  const loadLogs = useCallback(async (isRefresh = false, overrideParams = null) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const params = overrideParams || {};
      if (!overrideParams) {
        if (deviceId.trim()) params.device_id = deviceId.trim();
      }

      const data = await fetchDgStatusLogs(params);
      const logList = data || [];
      setLogs(logList);

      if (logList.length > 0) {
        lazyGeocodeAddresses(logList);
      }
    } catch (e) {
      Alert.alert('Report Error', 'Failed to fetch DG Activity logs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId, lazyGeocodeAddresses]);

  // ─── LOAD DEVICES ON MOUNT + INITIAL FETCH ──────────────────────────────────
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

      loadLogs(false, initParams);
    };

    if (devices.length === 0) {
      fetchDeviceList()
        .then((data) => {
          const list = data?.devices || [];
          setDevices(list);
          handleRouteParams(list);
        })
        .catch((err) => {
          console.warn('Failed to load device list:', err.message);
          handleRouteParams([]);
        });
    } else {
      handleRouteParams(devices);
    }
  }, [routeDeviceId, routeDeviceName]); // Re-run when route params change

  // ─── FILTER RESET ─────────────────────────────────────────────────────────
  const handleReset = () => {
    setDeviceName(routeDeviceName || '');
    setDeviceId(routeDeviceId ? String(routeDeviceId) : '');
    setShowFilters(false);
    setStatusFilter('ALL');
    setTempStatusFilter('ALL');
    setShowStatusPicker(false);

    let resolvedDeviceId = '';
    let resolvedDeviceName = '';

    if (!routeDeviceId) {
      setSelectedDev(null);
    } else {
      const matched = devices.find(d => String(d.id) === String(routeDeviceId));
      setSelectedDev(matched || { id: routeDeviceId, name: routeDeviceName || `Device ID: ${routeDeviceId}` });
      resolvedDeviceId = matched ? String(matched.deviceid || matched.id) : String(routeDeviceId);
      resolvedDeviceName = matched ? (matched.name || '') : (routeDeviceName || '');
    }

    setLoading(true);
    const params = {};
    if (resolvedDeviceId) params.device_id = resolvedDeviceId;
    // ✅ FIX: Always send dg_name on reset too
    if (resolvedDeviceName) params.dg_name = resolvedDeviceName;

    fetchDgStatusLogs(params)
      .then((data) => {
        const logList = data || [];
        setLogs(logList);
        if (logList.length > 0) lazyGeocodeAddresses(logList);
      })
      .catch(() => Alert.alert('Error', 'Failed to reload logs.'))
      .finally(() => setLoading(false));
  };

  // ─── EXPAND/COLLAPSE CARD ──────────────────────────────────────────────────
  const toggleExpand = (id) => {
    setExpandedCardIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  // ─── LOCAL FILTER (status + device) ──────────────────────────────────────────
  // Applies device name filter from route params OR from selected dropdown device
  const filteredLogs = logs.filter(item => {
    // 1. Device name local enforcement
    // Priority: routeDeviceName (locked mode) > deviceName (dropdown selection)
    const activeDeviceName = routeDeviceName || deviceName;
    if (activeDeviceName && activeDeviceName.trim()) {
      const itemDevName = String(item.dg_name || item.device_name || '').trim().toUpperCase();
      const filterName = activeDeviceName.trim().toUpperCase();
      if (itemDevName !== filterName) return false;
    }

    // 2. Status enforcement
    if (statusFilter === 'ALL') return true;
    const status = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();
    if (statusFilter === 'MOVING') {
      return status.includes('MOVING') || status.includes('MOVE') || status.includes('MOTION') || status.includes('TRANSIT');
    }
    if (statusFilter === 'STOP') {
      return status.includes('STOP') || status.includes('IDLE') || status.includes('PARK');
    }
    if (statusFilter === 'ON') {
      return (status.includes('ON') || status === '1') &&
        !status.includes('MOTION') && !status.includes('MOVING') && !status.includes('STOP');
    }
    if (statusFilter === 'OFF') {
      return status.includes('OFF') || status === '0';
    }
    return true;
  });

  // ─── RENDER SINGLE EVENT CARD ──────────────────────────────────────────────
  const renderLogCard = ({ item }) => {
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
        <View style={styles.cardHeader}>
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
              {/* ✅ FIX: Properly formatted start time */}
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
              {/* ✅ FIX: Properly formatted end time */}
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

  // ─── JSX RENDER ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Header
        title={routeDeviceName ? `${routeDeviceName} Logs` : 'DG Report'}
        navigation={navigation}
        showBack={navigation.canGoBack()}
        rightAction={
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.headerActionBtn}>
              <Icon name="filter-menu-outline" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>
        }
      />

      {/* Filter panel slide card */}
      {showFilters && (
        <View style={styles.filterCard}>
          <Text style={styles.filterTitle}>Filter Report</Text>
          <View style={styles.filterGrid}>
            {routeDeviceId ? (
              <View style={styles.inputWrapFull}>
                <Text style={styles.inputLabel}>Target Vehicle</Text>
                <View style={styles.lockedDeviceDisplay}>
                  <Icon name="truck-lock" size={20} color="#0284c7" />
                  <Text style={styles.lockedDeviceText}>
                    {routeDeviceName || `Device ID: ${routeDeviceId}`} (Locked Mode)
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.inputWrapFull}>
                <Text style={styles.inputLabel}>Select DG / Device</Text>
                <TouchableOpacity
                  style={styles.selector}
                  onPress={() => setShowDevPicker(!showDevPicker)}
                >
                  <Icon name="truck-outline" size={18} color="#0284c7" />
                  <Text style={styles.selectorText}>
                    {selectedDev ? selectedDev.name : '🌟 All Devices (Show Everything)'}
                  </Text>
                  <Icon name={showDevPicker ? 'chevron-up' : 'chevron-down'} size={20} color="#64748b" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>

                {showDevPicker && (
                  <ScrollView nestedScrollEnabled={true} style={styles.pickerDropdown}>
                    {/* Search input */}
                    <TextInput
                      style={styles.input}
                      placeholder="Search devices..."
                      placeholderTextColor="#64748b"
                      value={searchQuery}
                      onChangeText={text => setSearchQuery(text)}
                    />
                    <TouchableOpacity
                      style={[styles.pickerItem, !selectedDev && styles.pickerItemActive]}
                      onPress={() => {
                        setSelectedDev(null);
                        setDeviceName('');
                        setDeviceId('');
                        setShowDevPicker(false);
                      }}
                    >
                      <Icon name="star-outline" size={16} color="#eab308" style={{ marginRight: 8 }} />
                      <Text style={[styles.pickerItemText, !selectedDev && { color: '#0284c7', fontWeight: 'bold' }]}>
                        All Devices (Show Everything)
                      </Text>
                    </TouchableOpacity>

                    {filteredDevices.map((d) => {
                      const isSelected = selectedDev?.id === d.id;
                      return (
                        <TouchableOpacity
                          key={d.id}
                          style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                          onPress={() => {
                            setSelectedDev(d);
                            setDeviceName(d.name || '');
                            setDeviceId(String(d.deviceid || d.id));
                            setShowDevPicker(false);
                          }}
                        >
                          <Icon name="car-outline" size={16} color="#64748b" style={{ marginRight: 8 }} />
                          <Text style={[styles.pickerItemText, isSelected && { color: '#0284c7', fontWeight: 'bold' }]}>
                            {d.name || `ID: ${d.id}`}
                          </Text>
                          <View style={[styles.statusDot, {
                            backgroundColor: d.status === 'online' ? '#10b981' : d.status === 'offline' ? '#ef4444' : '#f59e0b'
                          }]} />
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}



            {/* Status Picker Selector */}
            <View style={styles.inputWrapFull}>
              <Text style={styles.inputLabel}>DG Status Filter</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setShowStatusPicker(!showStatusPicker)}>
                <Icon name="filter-variant" size={18} color="#0284c7" />
                <Text style={styles.selectorText}>
                  {tempStatusFilter === 'ALL' && '🌟 All Statuses'}
                  {tempStatusFilter === 'ON' && '⚡ DG ON (Running)'}
                  {tempStatusFilter === 'MOVING' && '🚚 Moving (In Transit)'}
                  {tempStatusFilter === 'OFF' && '🔌 DG OFF'}
                  {tempStatusFilter === 'STOP' && '🛑 Stopped'}
                </Text>
                <Icon name={showStatusPicker ? 'chevron-up' : 'chevron-down'} size={20} color="#64748b" style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>

              {showStatusPicker && (
                <View style={styles.pickerDropdown}>
                  {[
                    { key: 'ALL', icon: 'star-outline', color: '#eab308', label: 'All Statuses' },
                    { key: 'ON', icon: 'lightning-bolt', color: '#10b981', label: 'DG ON (Running)' },
                    { key: 'MOVING', icon: 'truck-delivery-outline', color: '#0284c7', label: 'Moving (In Transit)' },
                    { key: 'OFF', icon: 'power-plug-off', color: '#ef4444', label: 'DG OFF' },
                    { key: 'STOP', icon: 'octagon-outline', color: '#f59e0b', label: 'Stopped' },
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.pickerItem, tempStatusFilter === opt.key && styles.pickerItemActive]}
                      onPress={() => { setTempStatusFilter(opt.key); setShowStatusPicker(false); }}
                    >
                      <Icon name={opt.icon} size={16} color={opt.color} style={{ marginRight: 8 }} />
                      <Text style={[styles.pickerItemText, tempStatusFilter === opt.key && { color: '#0284c7', fontWeight: 'bold' }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={styles.filterActionRow}>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Icon name="refresh" size={16} color="#64748b" />
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => {
                const params = {};
                if (deviceId.trim()) params.device_id = deviceId.trim();
                // ✅ FIX: Send dg_name in apply filter too
                if (deviceName.trim()) params.dg_name = deviceName.trim();
                setShowFilters(false);
                setStatusFilter(tempStatusFilter);
                loadLogs(false, params);
              }}
            >
              <Icon name="magnify" size={16} color="#FFF" />
              <Text style={styles.applyBtnText}>Apply Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Main Logs View Body */}
      {loading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>Fetching Report...</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.centerLoader}>
          <Icon name="file-alert-outline" size={60} color="#cbd5e1" />
          <Text style={styles.noDataText}>No DG Report found</Text>
          <Text style={styles.noDataSub}>No records available.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadLogs()}>
            <Text style={styles.retryText}>Reload Logs</Text>
          </TouchableOpacity>
        </View>
      ) : filteredLogs.length === 0 ? (
        <View style={styles.centerLoader}>
          <Icon name="filter-remove-outline" size={60} color="#cbd5e1" />
          <Text style={styles.noDataText}>No matching logs found</Text>
          <Text style={styles.noDataSub}>No records match the current status filter.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setStatusFilter('ALL')}>
            <Text style={styles.retryText}>Clear Status Filter</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderLogCard}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => loadLogs(true)}
          ListHeaderComponent={
            <Text style={styles.logsCountText}>
              Showing {filteredLogs.length} of {logs.length} DG operations logs
            </Text>
          }
        />
      )}


    </View>
  );
};

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  headerActionBtn: { padding: 8, marginLeft: 8 },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748b', fontWeight: '500' },
  noDataText: { fontSize: 18, fontWeight: '700', color: '#334155', marginTop: 16 },
  noDataSub: { fontSize: 13, color: '#64748b', marginTop: 6, textAlign: 'center' },
  retryBtn: { marginTop: 20, backgroundColor: '#0284c7', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  listContent: { padding: 16, paddingBottom: 32 },
  logsCountText: { fontSize: 13, color: '#64748b', fontWeight: '600', marginBottom: 12, paddingLeft: 4 },
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
  cardHeader: {
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
  filterCard: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    padding: 16,
    elevation: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  filterTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  inputWrap: { width: '48%', marginBottom: 10 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  filterActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  resetBtnText: { fontSize: 13, fontWeight: '600', color: '#64748b', marginLeft: 6 },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284c7',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  applyBtnText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF', marginLeft: 6 },
  inputWrapFull: { width: '100%', marginBottom: 10 },
  dateSelectorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  dateButtonText: { fontSize: 13, color: '#1e293b', fontWeight: '600', marginLeft: 8 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
  },
  selectorText: { fontSize: 13, color: '#1e293b', fontWeight: '600', marginLeft: 8 },
  pickerDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginTop: 6,
    maxHeight: 180,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickerItemActive: { backgroundColor: '#e0f2fe' },
  pickerItemText: { fontSize: 13, color: '#334155', flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  lockedDeviceDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lockedDeviceText: { fontSize: 13, color: '#0284c7', fontWeight: '700', marginLeft: 8 },
});

export default DgStatusLogScreen;