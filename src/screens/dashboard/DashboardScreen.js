import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
  RefreshControl,
  PanResponder,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path, G, Text as SvgText, Circle, Defs, ClipPath, Rect, Polyline, Line } from 'react-native-svg';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList, fetchDgDashboard, fetchFilterDropdowns } from '../../api/webApi';
import { Modal, ScrollView } from 'react-native';
import { AuthContext } from '../../context/AuthContext';

const { width } = Dimensions.get('window');

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const polarToCartesian = (cx, cy, r, angleDeg) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arcPath = (cx, cy, r, startDeg, endDeg) => {
  const sweep = Math.min(endDeg - startDeg, 359.99);
  const end = polarToCartesian(cx, cy, r, startDeg + sweep);
  const start = polarToCartesian(cx, cy, r, startDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
};

// ─── COMPACT DUAL CHARTS ────────────────────────────────────────────────────────
const CompactDonut = ({ total, dataEntries, title, activeFilter, onFilterSelect, horizontal = false }) => {
  if (!total || total === 0) return null;

  const CHART_SIZE = 110;
  const center = CHART_SIZE / 2;
  const strokeWidth = 14;
  const radius = (CHART_SIZE - strokeWidth) / 2;
  const MIN_DEG = 4;
  const GAP_DEG = 4;

  const active = dataEntries.filter(e => e.val > 0);

  let segs = active.map(e => ({ ...e, deg: (e.val / total) * 360 }));
  segs = segs.map(s => ({ ...s, deg: Math.max(s.deg, MIN_DEG) }));

  const totalGap = active.length * GAP_DEG;
  const availDeg = 360 - totalGap;
  const rawSum = segs.reduce((a, s) => a + s.deg, 0);
  segs = segs.map(s => ({ ...s, deg: (s.deg / rawSum) * availDeg }));

  let cursor = 0;
  segs = segs.map(s => {
    const start = cursor;
    const end = cursor + s.deg;
    cursor = end + GAP_DEG;
    return { ...s, startDeg: start, endDeg: end };
  });

  const activeIdx = segs.findIndex(s => s.filterKey === activeFilter);

  return (
    <View style={[styles.compactDonutWrapper, horizontal && { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}>
      {!horizontal && <Text style={styles.compactDonutTitle}>{title}</Text>}

      <View style={[styles.compactDonutSvg, horizontal && { marginBottom: 0, marginRight: 32, alignItems: 'center' }]}>
        {horizontal && <Text style={styles.compactDonutTitle}>{title}</Text>}
        <Svg width={CHART_SIZE} height={CHART_SIZE}>
          <Circle cx={center} cy={center} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
          {segs.map((seg, i) => {
            const isActive = i === activeIdx;
            const extraR = isActive ? 4 : 0;
            const segRadius = radius + extraR / 2;
            const segStroke = strokeWidth + extraR;
            return (
              <Path
                key={i}
                d={arcPath(center, center, segRadius, seg.startDeg, seg.endDeg)}
                fill="none"
                stroke={seg.color}
                strokeWidth={segStroke}
                strokeLinecap="round"
                opacity={activeIdx === -1 || isActive ? 1 : 0.35}
              />
            );
          })}
          <SvgText x={center} y={center + 6} textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a">
            {total}
          </SvgText>
        </Svg>
      </View>

      <View style={[styles.compactLegend, horizontal && { width: 'auto', minWidth: 120 }]}>
        {dataEntries.map((seg, i) => {
          const isActive = seg.filterKey === activeFilter;
          return (
            <TouchableOpacity
              key={i}
              onPress={() => onFilterSelect && onFilterSelect(seg.filterKey)}
              style={[
                styles.compactLegendItem,
                isActive && styles.compactLegendItemActive,
                { borderColor: isActive ? seg.color : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <View style={[styles.compactLegendDot, { backgroundColor: seg.color }]} />
              <Text style={styles.compactLegendLabel}>{seg.label}</Text>
              <Text style={[styles.compactLegendVal, { color: seg.color }]}>{seg.val}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};
// ─── TOP RANKINGS CARD ──────────────────────────────────────────────────────────
const TopRankingsCard = ({ title, subtitle, data, valueKey, labelKey, unitFormatter }) => {
  if (!data || data.length === 0) return null;

  const top10 = data.slice(0, 10);

  let maxVal = 0;
  top10.forEach(item => {
    const val = parseFloat(item[valueKey]) || 0;
    if (val > maxVal) maxVal = val;
  });

  if (maxVal === 0) maxVal = 1;

  return (
    <View style={styles.rankingsCard}>
      <Text style={styles.rankingsTitle}>{title}</Text>
      <Text style={styles.rankingsSubtitle}>{subtitle}</Text>

      <View style={styles.rankingsList}>
        {top10.map((item, index) => {
          const rawVal = parseFloat(item[valueKey]) || 0;
          const displayVal = unitFormatter(rawVal);
          const pct = Math.min((rawVal / maxVal) * 100, 100);

          return (
            <View key={item.deviceid || index} style={styles.rankingRow}>
              <View style={styles.rankingHeader}>
                <Text style={styles.rankingLabel}>{item[labelKey] || 'Unknown Device'}</Text>
                <Text style={styles.rankingValue}>{displayVal}</Text>
              </View>
              <View style={styles.rankingBarBg}>
                <View style={[styles.rankingBarFill, { width: `${pct}%` }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ─── DASHBOARD SCREEN ─────────────────────────────────────────────────────────
const DashboardScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const isSuperadmin = userInfo?.user_type === 'Superadmin';

  const [data, setData] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selDevice, setSelDevice] = useState(null);
  const [dgDashboardData, setDgDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [primaryFilter, setPrimaryFilter] = useState('all');
  const [secondaryFilter, setSecondaryFilter] = useState('all');

  // ─── CASCADE FILTER STATE ─────────────────────────────────────────────────
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [dropdowns, setDropdowns] = useState({ clients: [], states: [], districts: [], clusters: [] });
  // Panel UI states
  const [selClient, setSelClient] = useState(null);
  const [selState, setSelState] = useState(null);
  const [selDistrict, setSelDistrict] = useState(null);
  const [selCluster, setSelCluster] = useState(null);
  // Applied filters (used for actual list rendering)
  const [appliedClient, setAppliedClient] = useState(null);
  const [appliedState, setAppliedState] = useState(null);
  const [appliedDistrict, setAppliedDistrict] = useState(null);
  const [appliedCluster, setAppliedCluster] = useState(null);
  const [appliedDevice, setAppliedDevice] = useState(null);

  const [previewDevices, setPreviewDevices] = useState([]);

  const [filterLoading, setFilterLoading] = useState(false);

  // Which dropdown is open inside the panel
  const [openDrop, setOpenDrop] = useState(null); // 'client'|'state'|'district'|'cluster'|'device'|null
  const [dropSearchQuery, setDropSearchQuery] = useState('');

  const filteredDgDashboardData = useMemo(() => {
    if (!dgDashboardData) return null;
    const allowedDeviceIds = new Set(devices.map(d => String(d.id || d.deviceid)));

    return {
      top_moving: (dgDashboardData.top_moving || []).filter(item => allowedDeviceIds.has(String(item.deviceid))),
      top_idle: (dgDashboardData.top_idle || []).filter(item => allowedDeviceIds.has(String(item.deviceid)))
    };
  }, [dgDashboardData, devices]);

  // Live timer (updated on screen focus and every second)
  const [currentTime, setCurrentTime] = useState(new Date());
  // Update the time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── FETCH ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [deviceResp, dgResp, ddResp] = await Promise.all([
        fetchDeviceList(),
        fetchDgDashboard(),
        fetchFilterDropdowns(),
      ]);
      setDevices(deviceResp.devices || []);
      setDgDashboardData(dgResp || null);
      setDropdowns(ddResp);
    } catch (err) {
      setError(err.message || 'Failed to sync dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Dynamically update dependent dropdowns and preview devices when panel selections change
  useEffect(() => {
    let isActive = true;
    const fetchDependentDropdownsAndPreview = async () => {
      try {
        const ddResp = await fetchFilterDropdowns(selClient?.id, selState?.id, selDistrict?.id);
        if (isActive) {
          setDropdowns(prev => ({
            clients: prev.clients.length > 0 ? prev.clients : ddResp.clients, // Preserve base clients
            states: ddResp.states,
            districts: ddResp.districts,
            clusters: ddResp.clusters,
          }));
        }

        // Fetch preview devices for the Device dropdown
        const apiFilters = {};
        if (selClient) apiFilters.client_id = selClient.id;
        if (selState) apiFilters.state_id = selState.id;
        if (selDistrict) apiFilters.district_id = selDistrict.id;
        if (selCluster) apiFilters.cluster_id = selCluster.id;

        const devResp = await fetchDeviceList(apiFilters);
        if (isActive) {
          setPreviewDevices(devResp.devices || []);
        }
      } catch (e) {
        console.warn('Failed to update dependent dropdowns', e);
      }
    };

    // Only fetch if we've already done initial load and panel is open
    if (devices.length > 0 && showFilterPanel) {
      fetchDependentDropdownsAndPreview();
    }
  }, [selClient, selState, selDistrict, selCluster, showFilterPanel]);

  // ─── SHARED HELPERS ─────────────────────────────────────────────────────────
  const isDgOn = useCallback(d => {
    const s = String(d.dg_status ?? '').toLowerCase();
    return s === '1' || s === 'on' || s === 'true' || s === 'yes';
  }, []);

  const isMoving = useCallback(d => {
    const s = String(d.motion_status ?? '').toLowerCase();
    return s === 'moving' || s === '1' || s === 'true' || s === 'on';
  }, []);

  // When a primary card is clicked: set primary, reset secondary
  const handlePrimaryFilter = useCallback((key) => {
    setPrimaryFilter(key);
    setSecondaryFilter('all');
  }, []);

  // When a secondary card or chart segment is clicked
  const handleSecondaryFilter = useCallback((key) => {
    setSecondaryFilter(prev => (prev === key ? 'all' : key));
  }, []);

  // ─── GLOBAL METRICS & CASCADE FILTER ─────────────────────────────────────
  //
  // NOTE: Device objects from /dg_device_latest_json/ do NOT contain clientid/stateid/
  // districtid/clusterid fields. So we CANNOT do local filtering by those.
  // Instead, Apply fetches from backend with filter params → `devices` state is
  // already scoped. cascadeFilteredDevices just passes `devices` through, with
  // one extra local filter: the Device dropdown selection (matched by ID).

  const cascadeFilteredDevices = useMemo(() => {
    // `devices` is already backend-filtered when a cascade filter is applied.
    // Only do local filtering for the Device dropdown (we have ID to match on).
    if (!appliedDevice) return devices;
    return devices.filter(d => {
      const did = String(d.id ?? d.deviceid ?? '');
      return did === String(appliedDevice.id);
    });
  }, [devices, appliedDevice]);

  // Global metrics reflect the currently applied cascade filters
  const globalMetrics = useMemo(() => {
    const total = cascadeFilteredDevices.length;
    const online = cascadeFilteredDevices.filter(d => d.status === 'online').length;
    return { total, online, offline: total - online };
  }, [cascadeFilteredDevices]);

  // ─── BASE DEVICES: scoped by primaryFilter ───────────────────────────────
  // online → only online cascade-filtered devices
  // offline → only offline cascade-filtered devices
  // all → all cascade-filtered devices
  const baseDevices = useMemo(() => {
    if (primaryFilter === 'online') return cascadeFilteredDevices.filter(d => d.status === 'online');
    if (primaryFilter === 'offline') return cascadeFilteredDevices.filter(d => d.status !== 'online');
    return cascadeFilteredDevices;
  }, [cascadeFilteredDevices, primaryFilter]);

  // ─── SECONDARY METRICS: DG/Motion counts WITHIN baseDevices ─────────────
  const secondaryMetrics = useMemo(() => {
    const dgOn = baseDevices.filter(isDgOn).length;
    const moving = baseDevices.filter(isMoving).length;
    return {
      dgOn,
      dgOff: baseDevices.length - dgOn,
      moving,
      stopped: baseDevices.length - moving,
    };
  }, [baseDevices, isDgOn, isMoving]);

  // ─── CHART DATA: reflects baseDevices breakdown ──────────────────────────
  const chartTotal = baseDevices.length;
  const chartEntries = []; // Using direct entries in the render now for dual charts

  // ─── FILTER HELPER ────────────────────────────────────────────────────────
  const getNested = (d, keys) => {
    for (let k of keys) {
      if (d[k] != null && String(d[k]).trim() !== '') return String(d[k]).trim();
      if (d.attributes && d.attributes[k] != null && String(d.attributes[k]).trim() !== '') return String(d.attributes[k]).trim();
      if (d.current_attributes && d.current_attributes[k] != null && String(d.current_attributes[k]).trim() !== '') return String(d.current_attributes[k]).trim();
    }
    return '';
  };

  const checkMatch = (d, appliedItem, idKeys, nameKeys) => {
    if (!appliedItem) return true;
    const cid = getNested(d, idKeys);
    const appliedId = String(appliedItem.id).trim();
    if (cid && cid === appliedId) return true;

    const cname = getNested(d, nameKeys).toLowerCase();
    const appliedName = String(appliedItem.name).toLowerCase().trim();
    if (cname && cname === appliedName) return true;

    return false;
  };

  // ─── FILTERED LIST: secondaryFilter + searchQuery ON TOP OF baseDevices ────────
  const filteredDevices = useMemo(() => {
    let list = baseDevices;
    if (secondaryFilter === 'dg_on') list = baseDevices.filter(isDgOn);
    else if (secondaryFilter === 'dg_off') list = baseDevices.filter(d => !isDgOn(d));
    else if (secondaryFilter === 'moving') list = baseDevices.filter(isMoving);
    else if (secondaryFilter === 'stopped') list = baseDevices.filter(d => !isMoving(d));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.iccid || d.uniqueId || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [baseDevices, secondaryFilter, searchQuery, isDgOn, isMoving]);

  // Device options for the Device dropdown inside the filter panel
  // Dynamically filtered based on the current panel selection via previewDevices
  const filteredDeviceOptions = useMemo(() => {
    return previewDevices.map(d => ({ id: d.id ?? d.deviceid, name: d.name ?? d.device_name }));
  }, [previewDevices]);

  const activeCascadeCount = [appliedClient, appliedState, appliedDistrict, appliedCluster, appliedDevice].filter(Boolean).length;

  const clearCascade = async () => {
    // Reset panel UI state
    setSelClient(null); setSelState(null); setSelDistrict(null); setSelCluster(null); setSelDevice(null); setOpenDrop(null);
    // Reset applied state
    setAppliedClient(null); setAppliedState(null); setAppliedDistrict(null); setAppliedCluster(null); setAppliedDevice(null);
    // Re-fetch full unfiltered list from backend
    setFilterLoading(true);
    try {
      const resp = await fetchDeviceList({});
      setDevices(resp.devices || []);
    } catch (e) {
      console.warn('[clearCascade]', e.message);
    } finally {
      setFilterLoading(false);
      setShowFilterPanel(false);
    }
  };

  const applyCascade = async () => {
    // Save selected items for display (badge count, chips)
    setAppliedClient(selClient);
    setAppliedState(selState);
    setAppliedDistrict(selDistrict);
    setAppliedCluster(selCluster);
    setAppliedDevice(selDevice);

    // Build query params for backend — client/state/district/cluster fields
    // are NOT in the device objects so we rely entirely on the backend to filter.
    const apiFilters = {};
    if (selClient) apiFilters.client_id = selClient.id;
    if (selState) apiFilters.state_id = selState.id;
    if (selDistrict) apiFilters.district_id = selDistrict.id;
    if (selCluster) apiFilters.cluster_id = selCluster.id;
    // selDevice is handled client-side by cascadeFilteredDevices (matched by ID)

    setFilterLoading(true);
    try {
      const resp = await fetchDeviceList(apiFilters);
      setDevices(resp.devices || []);
    } catch (e) {
      console.warn('[applyCascade]', e.message);
    } finally {
      setFilterLoading(false);
      setShowFilterPanel(false);
    }
  };

  const openFilterPanel = () => {
    setSelClient(appliedClient);
    setSelState(appliedState);
    setSelDistrict(appliedDistrict);
    setSelCluster(appliedCluster);
    setSelDevice(appliedDevice);
    setPreviewDevices(devices);
    setShowFilterPanel(true);
  };

  // ─── CASCADE DROPDOWN RENDER ─────────────────────────────────────────────
  const renderCascadeDropdown = (label, icon, key, value, options, onSelect, onClear) => {
    const isOpen = openDrop === key;
    return (
      <View style={cStyles.dropBlock}>
        <Text style={cStyles.dropLabel}>{label}</Text>
        <TouchableOpacity
          style={[cStyles.dropBtn, value && cStyles.dropBtnActive]}
          onPress={() => {
            setOpenDrop(isOpen ? null : key);
            setDropSearchQuery('');
          }}
          activeOpacity={0.8}
        >
          <Icon name={icon} size={16} color={value ? '#1565C0' : '#64748b'} />
          <Text style={[cStyles.dropBtnText, value && cStyles.dropBtnTextActive]} numberOfLines={1}>
            {value ? value.name : `All ${label}s`}
          </Text>
          {value ? (
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close-circle" size={16} color="#ef4444" />
            </TouchableOpacity>
          ) : (
            <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" />
          )}
        </TouchableOpacity>
        {isOpen && (
          <View style={cStyles.optionBox}>
            <View style={cStyles.optionSearchBox}>
              <Icon name="magnify" size={16} color="#94a3b8" />
              <TextInput
                style={cStyles.optionSearchInput}
                placeholder={`Search ${label}...`}
                placeholderTextColor="#94a3b8"
                value={dropSearchQuery}
                onChangeText={setDropSearchQuery}
                autoFocus={true}
              />
              {dropSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setDropSearchQuery('')}>
                  <Icon name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={options.filter(opt => (opt.name || '').toLowerCase().includes(dropSearchQuery.toLowerCase()))}
              keyExtractor={item => item.id?.toString() || Math.random().toString()}
              style={{ maxHeight: 200 }}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              ListHeaderComponent={
                <TouchableOpacity style={cStyles.optionItem} onPress={() => { onSelect(null); setOpenDrop(null); setDropSearchQuery(''); }}>
                  <Text style={[cStyles.optionText, !value && { color: '#1565C0', fontWeight: '700' }]}>All {label}s</Text>
                </TouchableOpacity>
              }
              renderItem={({ item: opt }) => (
                <TouchableOpacity
                  style={[cStyles.optionItem, value?.id === opt.id && cStyles.optionItemActive]}
                  onPress={() => { onSelect(opt); setOpenDrop(null); setDropSearchQuery(''); }}
                >
                  <Text style={[cStyles.optionText, value?.id === opt.id && cStyles.optionTextActive]}>{opt.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>
    );
  };

  // ─── FILTER LABEL (for chip display) ────────────────────────────────────
  const primaryLabel = { all: 'All', online: 'Online', offline: 'Offline' }[primaryFilter];
  const secondaryLabel = { all: '', dg_on: 'DG ON', dg_off: 'DG OFF', moving: 'Moving', stopped: 'Stopped' }[secondaryFilter];

  // ─── STAT CARDS CONFIG ──────────────────────────────────────────────────────
  const primaryCards = [
    { key: 'all', label: 'Total Devices', val: globalMetrics.total, icon: 'devices', iconBg: 'rgba(21,101,192,0.1)', iconColor: '#1565C0' },
    { key: 'online', label: 'Online', val: globalMetrics.online, icon: 'check-circle', iconBg: 'rgba(16,185,129,0.1)', iconColor: '#10b981' },
    { key: 'offline', label: 'Offline', val: globalMetrics.offline, icon: 'close-circle', iconBg: 'rgba(239,68,68,0.1)', iconColor: '#ef4444' },
  ];

  // Secondary cards: counts scoped to baseDevices (respects primaryFilter)
  const secondaryCards = [
    { key: 'dg_on', label: 'DG ON', val: secondaryMetrics.dgOn, icon: 'lightning-bolt', color: '#10b981' },
    { key: 'dg_off', label: 'DG OFF', val: secondaryMetrics.dgOff, icon: 'lightning-bolt', color: '#ef4444' },
    { key: 'moving', label: 'MOVING', val: secondaryMetrics.moving, icon: 'run', color: '#f59e0b' },
    { key: 'stopped', label: 'STOPPED', val: secondaryMetrics.stopped, icon: 'car-brake-park', color: '#6366f1' },
  ];

  // ─── CHART TITLE ────────────────────────────────────────────────────────────
  const chartTitle = useMemo(() => {
    return `${primaryLabel} Devices — Metrics Breakdown`;
  }, [primaryFilter, primaryLabel]);

  // ─── HEADER ─────────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={styles.statsContainer}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}> Devices Overview</Text>
        <View style={styles.liveTimerBadge}>
          <Icon name="clock-outline" size={14} color="#1565C0" />
          <Text style={styles.liveTimerText}>
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        </View>
      </View>

      {/* Primary Cards (Total / Online / Offline) — always global counts */}
      <View style={styles.primaryRow}>
        {primaryCards.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.primaryCard, primaryFilter === c.key && styles.primaryCardActive]}
            onPress={() => handlePrimaryFilter(c.key)}
            activeOpacity={0.8}
          >
            <View style={styles.cardTop}>
              <View style={[styles.iconBox, { backgroundColor: c.iconBg }]}>
                <Icon name={c.icon} size={22} color={c.iconColor} />
              </View>
              <Text style={styles.cardVal}>{c.val}</Text>
            </View>
            <Text style={styles.cardLabel}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* Context hint */}
      {primaryFilter === 'online' && (
        <Text style={styles.contextHint}>
          Showing DG & Motion counts within{' '}
          <Text style={{ fontWeight: '700', color: '#1565C0' }}>
            {primaryLabel}
          </Text>{' '}
          devices only
        </Text>
      )}

      {/* ── CHARTS AREA ── */}
      {primaryFilter === 'all' && chartTotal > 0 && (
        <View style={[styles.dualChartCard, { justifyContent: 'center' }]}>
          <CompactDonut
            horizontal={true}
            total={chartTotal}
            title="DEVICE STATUS"
            activeFilter={primaryFilter} // Not interactive directly here
            dataEntries={[
              { label: 'ONLINE', val: globalMetrics.online, color: '#10b981', filterKey: 'online' },
              { label: 'OFFLINE', val: globalMetrics.offline, color: '#ef4444', filterKey: 'offline' },
            ]}
          />
        </View>
      )}

      {primaryFilter === 'online' && chartTotal > 0 && (
        <View style={styles.dualChartCard}>
          <CompactDonut
            total={chartTotal}
            title="DG STATUS"
            activeFilter={secondaryFilter}
            onFilterSelect={handleSecondaryFilter}
            dataEntries={[
              { label: 'DG ON', val: secondaryMetrics.dgOn, color: '#3b82f6', filterKey: 'dg_on' },
              { label: 'DG OFF', val: secondaryMetrics.dgOff, color: '#ef4444', filterKey: 'dg_off' },
            ]}
          />
          <View style={styles.chartDivider} />
          <CompactDonut
            total={chartTotal}
            title="MOTION STATUS"
            activeFilter={secondaryFilter}
            onFilterSelect={handleSecondaryFilter}
            dataEntries={[
              { label: 'MOVING', val: secondaryMetrics.moving, color: '#10b981', filterKey: 'moving' },
              { label: 'STOPPED', val: secondaryMetrics.stopped, color: '#f59e0b', filterKey: 'stopped' },
            ]}
          />
        </View>
      )}

      {/* ── TOP RANKINGS (DG DASHBOARD) ── */}
      {/* 
      {filteredDgDashboardData && filteredDgDashboardData.top_moving && filteredDgDashboardData.top_moving.length > 0 && (
        <TopRankingsCard
          title="Top Moving DGs"
          // subtitle="Ranked by total distance travelled (km)."
          data={filteredDgDashboardData.top_moving}
          valueKey="total_distance_km"
          labelKey="device_name"
          unitFormatter={(val) => `${val.toFixed(2)}km`}
        />
      )}

      {filteredDgDashboardData && filteredDgDashboardData.top_idle && filteredDgDashboardData.top_idle.length > 0 && (
        <TopRankingsCard
          title="Top Idle DGs"
          // subtitle="Ranked by continuous idle time at the same location."
          data={filteredDgDashboardData.top_idle}
          valueKey="idle_minutes"
          labelKey="device_name"
          unitFormatter={(val) => `${(val / 60).toFixed(1)} hrs`}
        />
      )}
      */}

      {/* Table header with filter chips */}
      <View style={styles.tableHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.tableTitle}>
            {primaryFilter === 'all' ? 'All Devices' : primaryFilter === 'online' ? 'Online Devices' : 'Offline Devices'}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{filteredDevices.length} items</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {primaryFilter !== 'all' && (
            <TouchableOpacity style={styles.filterChip} onPress={() => handlePrimaryFilter('all')}>
              <Text style={styles.filterChipText}>{primaryLabel} ✕</Text>
            </TouchableOpacity>
          )}
          {secondaryFilter !== 'all' && (
            <TouchableOpacity style={[styles.filterChip, { backgroundColor: '#e0f2fe', borderColor: '#7dd3fc' }]} onPress={() => setSecondaryFilter('all')}>
              <Text style={[styles.filterChipText, { color: '#0369a1' }]}>{secondaryLabel} ✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Header
        title="DG Monitoring Dashboard"
        navigation={navigation}
        rightAction={
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => showFilterPanel ? setShowFilterPanel(false) : openFilterPanel()} style={{ padding: 8 }}>
              <View>
                <Icon name="filter-menu-outline" size={24} color="#FFFFFF" />
                {activeCascadeCount > 0 && (
                  <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#f97316', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{activeCascadeCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSearch(p => !p)} style={{ padding: 8 }}>
              <Icon name="magnify" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        }
      />

      {/* ── CASCADE FILTER PANEL ── */}
      {showFilterPanel && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { zIndex: 9, backgroundColor: 'transparent' }]}
          activeOpacity={1}
          onPress={() => setShowFilterPanel(false)}
        />
      )}
      {showFilterPanel && (
        <View style={[cStyles.panel, { zIndex: 10 }]}>
          <View style={cStyles.panelHeader}>
            <Text style={cStyles.panelTitle}>Filter Devices</Text>
          </View>
          {isSuperadmin && renderCascadeDropdown('Client', 'account-multiple-outline', 'client', selClient, dropdowns.clients,
            (v) => { setSelClient(v); setSelState(null); setSelDistrict(null); setSelCluster(null); setSelDevice(null); },
            () => { setSelClient(null); setSelState(null); setSelDistrict(null); setSelCluster(null); setSelDevice(null); }
          )}
          {renderCascadeDropdown('State', 'map-outline', 'state', selState, dropdowns.states,
            (v) => { setSelState(v); setSelDistrict(null); setSelCluster(null); setSelDevice(null); },
            () => { setSelState(null); setSelDistrict(null); setSelCluster(null); setSelDevice(null); }
          )}
          {renderCascadeDropdown('District', 'city-variant-outline', 'district', selDistrict, dropdowns.districts,
            (v) => { setSelDistrict(v); setSelCluster(null); setSelDevice(null); },
            () => { setSelDistrict(null); setSelCluster(null); setSelDevice(null); }
          )}
          {renderCascadeDropdown('Cluster', 'hexagon-multiple-outline', 'cluster', selCluster, dropdowns.clusters,
            (v) => { setSelCluster(v); setSelDevice(null); },
            () => { setSelCluster(null); setSelDevice(null); }
          )}
          {renderCascadeDropdown('Device', 'car', 'device', selDevice, filteredDeviceOptions,
            (v) => setSelDevice(v),
            () => setSelDevice(null)
          )}

          {/* Filter action buttons */}
          <View style={cStyles.buttonRow}>
            <TouchableOpacity
              style={[cStyles.applyBtn, filterLoading && { opacity: 0.6 }]}
              onPress={filterLoading ? null : applyCascade}
              activeOpacity={0.8}
            >
              {filterLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={cStyles.applyBtnText}>Apply</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[cStyles.resetBtn, filterLoading && { opacity: 0.6 }]}
              onPress={filterLoading ? null : clearCascade}
              activeOpacity={0.8}
            >
              <Text style={cStyles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showSearch && (
        <View style={styles.searchBar}>
          <Icon name="magnify" size={20} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search devices by name, IMEI..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94a3b8"
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
          <Text style={styles.loadingText}>Syncing device metrics...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadData()}>
            <Text style={styles.retryText}>Retry Sync</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredDevices}
          keyboardShouldPersistTaps="always"
          keyExtractor={item => (item.id?.toString() ?? Math.random().toString())}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <DeviceCard
              device={item}
              onPress={() => navigation.navigate('DeviceTab', { screen: 'DeviceDetail', params: { device: item } })}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={['#1565C0']}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="truck-off" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No devices match the current filter/search</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const CARD_GAP = 8;
const SECONDARY_CARD_W = (width - 32 - CARD_GAP * 3) / 4;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  statsContainer: { padding: 16 },

  sectionTitle: {
    fontSize: 12, fontWeight: '600', color: '#64748b',
    marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  liveTimerBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#e0f2fe',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4,
  },
  liveTimerText: {
    fontSize: 12, fontWeight: '700', color: '#1565C0',
  },

  // Primary cards
  primaryRow: { flexDirection: 'row', gap: CARD_GAP, marginBottom: 12 },
  primaryCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
    padding: 12, borderWidth: 1, borderColor: '#e2e8f0',
    elevation: 3, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6,
  },
  primaryCardActive: { borderColor: '#1565C0', borderWidth: 2, backgroundColor: '#f0f9ff' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  iconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cardVal: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  cardLabel: { fontSize: 10, fontWeight: '600', color: '#64748b' },

  // Secondary cards
  secondaryRow: { flexDirection: 'row', gap: CARD_GAP, marginBottom: 6 },
  secondaryCard: {
    width: SECONDARY_CARD_W, backgroundColor: '#FFFFFF', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center',
    borderWidth: 1, borderColor: '#e2e8f0',
    elevation: 2, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4,
  },
  secondaryCardActive: { borderColor: '#1565C0', borderWidth: 1.5, backgroundColor: '#f0f9ff' },
  secondaryVal: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginTop: 4 },
  secondaryLabel: { fontSize: 9, fontWeight: '700', color: '#64748b', marginTop: 2, textAlign: 'center' },

  // Context hint
  contextHint: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 14,
    marginTop: 2,
    fontStyle: 'italic',
  },

  // ── COMPACT DUAL CHART STYLES ──
  dualChartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  chartDivider: {
    width: 1,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 10,
  },
  compactDonutWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  compactDonutTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  compactDonutSvg: {
    marginBottom: 16,
  },
  compactLegend: {
    width: '100%',
    gap: 6,
  },
  compactLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  compactLegendItemActive: {
    backgroundColor: '#f8fafc',
  },
  compactLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  compactLegendLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  compactLegendVal: {
    fontSize: 13,
    fontWeight: '800',
  },

  // ── RANKINGS CARD STYLES ──
  rankingsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rankingsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  rankingsSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 16,
  },
  rankingsList: {
    gap: 12,
  },
  rankingRow: {
    flexDirection: 'column',
    gap: 4,
  },
  rankingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rankingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
    marginRight: 10,
  },
  rankingValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  rankingBarBg: {
    height: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  rankingBarFill: {
    height: '100%',
    backgroundColor: '#60a5fa', // Light blue like the screenshot
    borderRadius: 3,
  },


  // Line Chart
  lineChartCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  lineChartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  lineChartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Table header
  tableHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  tableTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  badge: {
    backgroundColor: '#e2e8f0', paddingHorizontal: 8,
    paddingVertical: 2, borderRadius: 8, marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  filterChip: { backgroundColor: '#1565C0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  filterChipText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#cbd5e1',
  },
  searchInput: { flex: 1, height: 38, fontSize: 14, color: '#0f172a', padding: 0 },

  // States
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: '#1565C0', fontWeight: '700', fontSize: 14 },
  errorText: { marginTop: 12, color: '#ef4444', textAlign: 'center', fontWeight: '600' },
  retryBtn: { marginTop: 16, backgroundColor: '#1565C0', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { marginTop: 12, fontSize: 13, color: '#64748b', textAlign: 'center' },
});

// ─── CASCADE FILTER STYLES ────────────────────────────────────────────────────
const cStyles = StyleSheet.create({
  panel: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    elevation: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  panelTitle: { fontSize: 14, fontWeight: '800', color: '#1e293b' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fef2f2', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  clearBtnText: { fontSize: 12, fontWeight: '700', color: '#ef4444' },

  dropBlock: { marginBottom: 10, zIndex: 10 },
  dropLabel: { fontSize: 10, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 5 },
  dropBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  dropBtnActive: { borderColor: '#1565C0', backgroundColor: '#eff6ff' },
  dropBtnText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#64748b' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  applyBtn: { flex: 0.48, backgroundColor: '#1565C0', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  applyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  resetBtn: { flex: 0.48, backgroundColor: '#e2e8f0', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  resetBtnText: { color: '#1565C0', fontWeight: '700', fontSize: 13 },

  optionBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 4,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    overflow: 'hidden',
    zIndex: 999,
  },
  optionSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
  },
  optionSearchInput: {
    flex: 1,
    height: 36,
    fontSize: 13,
    color: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  optionItem: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc',
  },
  optionItemActive: { backgroundColor: '#eff6ff' },
  optionText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  optionTextActive: { color: '#1565C0', fontWeight: '700' },
});

export default DashboardScreen;