import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import Svg, { Path, G, Text as SvgText, Circle, Defs, ClipPath, Rect } from 'react-native-svg';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList } from '../../api/webApi';

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

// ─── LARGE DONUT CHART ─────────────────────────────────────────────────────────
// activeFilter   → the current secondaryFilter key (controls which segment is highlighted)
// onFilterSelect → called with filterKey when a legend item is tapped
const DonutChart = ({ total, dataEntries, title, activeFilter, onFilterSelect }) => {
  if (!total || total === 0) return null;

  const CHART_SIZE = 200;
  const center = CHART_SIZE / 2;
  const strokeWidth = 30;
  const radius = (CHART_SIZE - strokeWidth) / 2;
  const MIN_DEG = 4;
  const GAP_DEG = 2.5;

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
  const activeSeg = activeIdx >= 0 ? segs[activeIdx] : null;
  const displayVal = activeSeg ? activeSeg.val : total;
  const displayLabel = activeSeg ? activeSeg.label : 'TOTAL';

  return (
    <View style={styles.bigChartCard}>
      {title && (
        <View style={styles.bigChartHeader}>
          <Icon name="chart-donut" size={15} color="#64748b" style={{ marginRight: 6 }} />
          <Text style={styles.bigChartTitle}>{title}</Text>
        </View>
      )}

      <View style={styles.bigChartBody}>
        {/* ── SVG Donut ── */}
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={CHART_SIZE} height={CHART_SIZE}>
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="#f1f5f9"
              strokeWidth={strokeWidth}
            />

            {segs.map((seg, i) => {
              const isActive = i === activeIdx;
              const extraR = isActive ? 6 : 0;
              const segRadius = radius + extraR / 2;
              const segStroke = strokeWidth + extraR;
              return (
                <Path
                  key={i}
                  d={arcPath(center, center, segRadius, seg.startDeg, seg.endDeg)}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={segStroke}
                  strokeLinecap="butt"
                  opacity={activeIdx === -1 || isActive ? 1 : 0.35}
                />
              );
            })}

            <Circle
              cx={center}
              cy={center}
              r={radius - strokeWidth / 2 - 2}
              fill="#FFFFFF"
            />

            <SvgText
              x={center}
              y={center - 10}
              textAnchor="middle"
              fontSize={activeSeg ? '26' : '30'}
              fontWeight="800"
              fill={activeSeg ? activeSeg.color : '#0f172a'}
            >
              {displayVal}
            </SvgText>
            <SvgText
              x={center}
              y={center + 12}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#94a3b8"
            >
              {displayLabel.toUpperCase()}
            </SvgText>
            {activeSeg && (
              <SvgText
                x={center}
                y={center + 27}
                textAnchor="middle"
                fontSize="11"
                fontWeight="500"
                fill="#64748b"
              >
                {`${Math.round((activeSeg.val / total) * 100)}%`}
              </SvgText>
            )}
          </Svg>
        </View>

        {/* ── Right side: Legend ── */}
        <View style={styles.bigLegend}>
          {segs.map((seg, i) => {
            const pct = Math.round((seg.val / total) * 100);
            const isActive = i === activeIdx;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  if (onFilterSelect) {
                    onFilterSelect(seg.filterKey);
                  }
                }}
                activeOpacity={0.7}
                style={[
                  styles.bigLegendRow,
                  isActive && { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' },
                ]}
              >
                <View style={[styles.bigLegendBar, { backgroundColor: seg.color }]} />

                <View style={styles.bigLegendText}>
                  <Text style={[styles.bigLegendLabel, isActive && { color: '#0f172a', fontWeight: '700' }]}>
                    {seg.label}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <Text style={[styles.bigLegendVal, { color: seg.color }]}>{seg.val}</Text>
                    <Text style={styles.bigLegendPct}>{`(${pct}%)`}</Text>
                  </View>
                </View>

                <View style={styles.miniBarBg}>
                  <View style={[styles.miniBarFill, { width: `${pct}%`, backgroundColor: seg.color }]} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={styles.bigChartHint}>Tap a segment to filter devices below</Text>
    </View>
  );
};

// ─── DASHBOARD SCREEN ─────────────────────────────────────────────────────────
const DashboardScreen = ({ navigation }) => {
  const [data, setData] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  // primaryFilter: which top-level group is selected (all / online / offline)
  const [primaryFilter, setPrimaryFilter] = useState('all');
  // secondaryFilter: sub-filter within that group (all / dg_on / dg_off / moving / stopped)
  const [secondaryFilter, setSecondaryFilter] = useState('all');

  // Live timer
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── FETCH ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const data = await fetchDeviceList();
      setDevices(data.devices || []);
    } catch (err) {
      setError(err.message || 'Failed to sync dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

  // ─── GLOBAL METRICS: always from ALL devices (for top 3 cards) ───────────
  const globalMetrics = useMemo(() => {
    const total = devices.length;
    const online = devices.filter(d => d.status === 'online').length;
    return { total, online, offline: total - online };
  }, [devices]);

  // ─── BASE DEVICES: scoped by primaryFilter ───────────────────────────────
  // online → only online devices
  // offline → only offline devices
  // all → all devices
  const baseDevices = useMemo(() => {
    if (primaryFilter === 'online') return devices.filter(d => d.status === 'online');
    if (primaryFilter === 'offline') return devices.filter(d => d.status !== 'online');
    return devices;
  }, [devices, primaryFilter]);

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
  const chartEntries = useMemo(() => {
    // Show only DG & Motion breakdown for all states
    return [
      { label: 'DG ON', val: secondaryMetrics.dgOn, color: '#3b82f6', filterKey: 'dg_on' },
      { label: 'DG OFF', val: secondaryMetrics.dgOff, color: '#64748b', filterKey: 'dg_off' },
      { label: 'Moving', val: secondaryMetrics.moving, color: '#f59e0b', filterKey: 'moving' },
      { label: 'Stopped', val: secondaryMetrics.stopped, color: '#8b5cf6', filterKey: 'stopped' },
    ];
  }, [secondaryMetrics]);

  // ─── FILTERED LIST: secondaryFilter applied ON TOP OF baseDevices ────────
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

  // ─── FILTER LABEL (for chip display) ────────────────────────────────────
  const primaryLabel = { all: 'All', online: 'Online', offline: 'Offline' }[primaryFilter];
  const secondaryLabel = { all: '', dg_on: 'DG ON', dg_off: 'DG OFF', moving: 'Moving', stopped: 'Stopped' }[secondaryFilter];

  // ─── STAT CARDS CONFIG ──────────────────────────────────────────────────────
  const primaryCards = [
    { key: 'all', label: 'Total Devices', val: globalMetrics.total, icon: 'devices', iconBg: 'rgba(21,101,192,0.1)', iconColor: '#1565C0' },
    { key: 'online', label: 'Active Online', val: globalMetrics.online, icon: 'check-circle', iconBg: 'rgba(16,185,129,0.1)', iconColor: '#10b981' },
    { key: 'offline', label: 'Inactive Offline', val: globalMetrics.offline, icon: 'close-circle', iconBg: 'rgba(239,68,68,0.1)', iconColor: '#ef4444' },
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
    if (primaryFilter === 'online') return 'Online Devices — DG & Motion Breakdown';
    if (primaryFilter === 'offline') return 'Offline Devices — DG & Motion Breakdown';
    return 'Device Status Overview';
  }, [primaryFilter]);

  // ─── HEADER ─────────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={styles.statsContainer}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Home / Devices Overview</Text>
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

      {/* Secondary Cards — counts scoped to selected primary group */}
      <View style={styles.secondaryRow}>
        {secondaryCards.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.secondaryCard, secondaryFilter === c.key && styles.secondaryCardActive]}
            onPress={() => handleSecondaryFilter(c.key)}
            activeOpacity={0.8}
          >
            <Icon name={c.icon} size={18} color={c.color} />
            <Text style={styles.secondaryVal}>{c.val}</Text>
            <Text style={styles.secondaryLabel}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Context hint */}
      {(primaryFilter === 'online' || primaryFilter === 'offline') && (
        <Text style={styles.contextHint}>
          Showing DG & Motion counts within{' '}
          <Text style={{ fontWeight: '700', color: '#1565C0' }}>
            {primaryFilter === 'online' ? 'Online' : 'Offline'}
          </Text>{' '}
          devices only
        </Text>
      )}

      {/* ── BIG Donut Chart ── */}
      <DonutChart
        total={chartTotal}
        title={chartTitle}
        activeFilter={secondaryFilter}
        onFilterSelect={handleSecondaryFilter}
        dataEntries={chartEntries}
      />

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
            <TouchableOpacity onPress={() => setShowSearch(p => !p)} style={{ padding: 8 }}>
              <Icon name="magnify" size={24} color="#FFFFFF" />
            </TouchableOpacity>

          </View>
        }
      />

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

  // ── BIG DONUT CHART STYLES ──
  bigChartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
    elevation: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
  bigChartHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
    marginBottom: 14,
  },
  bigChartTitle: {
    fontSize: 12, fontWeight: '700', color: '#334155',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  bigChartBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  // Legend — right column
  bigLegend: {
    flex: 1,
    gap: 6,
  },
  bigLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 6,
    paddingRight: 8,
    overflow: 'hidden',
    gap: 8,
  },
  bigLegendBar: {
    width: 4,
    height: '100%',
    minHeight: 44,
    borderRadius: 2,
  },
  bigLegendText: {
    flex: 1,
    gap: 2,
  },
  bigLegendLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  bigLegendVal: {
    fontSize: 15,
    fontWeight: '800',
  },
  bigLegendPct: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  miniBarBg: {
    width: 36,
    height: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: 4,
    borderRadius: 2,
  },
  bigChartHint: {
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
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

export default DashboardScreen;