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
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path, G, Text as SvgText, Circle, Defs, ClipPath, Rect, Polyline, Line } from 'react-native-svg';
import Header from '../../components/Header';
import DeviceCard from '../../components/DeviceCard';
import { fetchDeviceList, fetchDgDashboard, fetchDgDashboardTop10, fetchFilterDropdowns, fetchDgCurrentDeviceVoltage, fetchDesignationUsers, fetchImeList } from '../../api/webApi';
import { Modal, ScrollView } from 'react-native';
import { AuthContext } from '../../context/AuthContext';
import { useFilter } from '../../context/FilterContext';
import moment from 'moment';

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

// ─── TOP 10 BAR CHART ─────────────────────────────────────────────────────────
const parseDurationString = (durStr) => {
  if (!durStr) return 0;
  let str = String(durStr).split('.')[0];
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseInt(parts[2], 10) || 0;
    return h + (m / 60) + (s / 3600);
  }
  return parseFloat(str) || 0;
};

const formatDurationHumanReadable = (valHours) => {
  if (isNaN(valHours) || valHours === 0) return '00:00:00';
  const totalSeconds = Math.round(valHours * 3600);
  const days = Math.floor(totalSeconds / 86400);
  const remainingSecondsAfterDays = totalSeconds % 86400;
  const hours = Math.floor(remainingSecondsAfterDays / 3600);
  const mins = Math.floor((remainingSecondsAfterDays % 3600) / 60);
  const secs = remainingSecondsAfterDays % 60;
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ${hours}h ${mins}m ${secs}s`;
  } else {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(valHours))}:${pad(mins)}:${pad(secs)}`;
  }
};

const Top10BarChart = ({ data, dateRange = '7days', onDateRangeChange }) => {
  const [barChartMode, setBarChartMode] = React.useState('distance');
  const [tooltipPos, setTooltipPos] = React.useState({ index: null, x: 0 });
  const [showDateDrop, setShowDateDrop] = React.useState(false);

  const dateLabels = {
    yesterday: 'Yesterday',
    '7days': 'Last 7 Days',
    '30days': 'Last 30 Days'
  };

  const activeData = React.useMemo(() => {
    if (!data) return [];
    if (barChartMode === 'distance') {
      const list = [...(data.top_moving || [])];
      return list.sort((a, b) => parseFloat(b.total_dg_move_km || 0) - parseFloat(a.total_dg_move_km || 0)).slice(0, 10);
    }
    if (barChartMode === 'onTime') {
      const list = [...(data.top_running || [])];
      return list.sort((a, b) => parseDurationString(b.total_dg_on) - parseDurationString(a.total_dg_on)).slice(0, 10);
    }
    const list = [...(data.top_idle || [])];
    return list.sort((a, b) => parseDurationString(b.total_dg_idle) - parseDurationString(a.total_dg_idle)).slice(0, 10);
  }, [data, barChartMode]);

  const { labels, values, displayStrings, fullNames } = React.useMemo(() => {
    let _labels = [];
    let _values = [];
    let _strings = [];
    let _fullNames = [];

    activeData.forEach(item => {
      let valNum = 0;
      let str = '';

      let name = item.dg_name || item.device_name || 'Unknown';
      _fullNames.push(name);
      _labels.push(name.length > 5 ? name.substring(0, 5) + '..' : name);

      if (barChartMode === 'distance') {
        valNum = parseFloat(item.total_dg_move_km || item.total_distance_km || 0);
        str = valNum.toFixed(2) + ' km';
      } else if (barChartMode === 'onTime') {
        valNum = parseDurationString(item.total_dg_on);
        str = formatDurationHumanReadable(valNum);
      } else {
        valNum = parseDurationString(item.total_dg_idle);
        str = formatDurationHumanReadable(valNum);
      }

      _values.push(valNum);
      _strings.push(str);
    });

    return { labels: _labels, values: _values, displayStrings: _strings, fullNames: _fullNames };
  }, [activeData, barChartMode]);

  const maxValue = Math.max(...values, 0);
  const niceMax = maxValue === 0 ? 10 : Math.ceil(maxValue * 1.2);
  const dynamicSegments = 4;

  const handleModeChange = (mode) => {
    setBarChartMode(mode);
    setTooltipPos({ index: null, x: 0 });
  };

  const scrollableWidth = Math.max(width - 80, values.length * 60);

  return (
    <View style={[{ overflow: 'hidden', marginTop: 10, paddingBottom: 16, paddingTop: 10, paddingHorizontal: 12, backgroundColor: '#fff', borderRadius: 16 }]}>
      <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }]}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>
          {barChartMode === 'distance' ? 'Top Moving DGs' : barChartMode === 'onTime' ? 'Top Running DGs' : 'Top Idle DGs'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {onDateRangeChange && (
            <View style={{ position: 'relative', zIndex: 50 }}>
              <TouchableOpacity
                onPress={() => setShowDateDrop(!showDateDrop)}
                style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#f1f5f9', borderRadius: 6, marginRight: 12, borderWidth: 1, borderColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: '#475569', fontWeight: 'bold' }}>{dateLabels[dateRange]}</Text>
                <Text style={{ fontSize: 10, color: '#475569', marginLeft: 4 }}>▼</Text>
              </TouchableOpacity>

              {showDateDrop && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setShowDateDrop(false)}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowDateDrop(false)}>
                    <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -75 }, { translateY: -75 }], backgroundColor: '#fff', borderRadius: 8, padding: 8, width: 150, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 }}>
                      {Object.entries(dateLabels).map(([key, label]) => (
                        <TouchableOpacity
                          key={key}
                          style={{ padding: 10, borderBottomWidth: key !== '30days' ? 1 : 0, borderBottomColor: '#f1f5f9' }}
                          onPress={() => {
                            setShowDateDrop(false);
                            if (key !== dateRange) onDateRangeChange(key);
                          }}>
                          <Text style={{ fontSize: 13, color: key === dateRange ? '#3b82f6' : '#334155', fontWeight: key === dateRange ? '700' : '500' }}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </TouchableOpacity>
                </Modal>
              )}
            </View>
          )}

          <TouchableOpacity onPress={() => handleModeChange('distance')} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: barChartMode === 'distance' ? '#3b82f6' : '#e2e8f0', borderRadius: 12, marginRight: 8 }}>
            <Text style={{ fontSize: 11, color: barChartMode === 'distance' ? '#fff' : '#64748b', fontWeight: 'bold' }}>Move</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleModeChange('onTime')} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: barChartMode === 'onTime' ? '#10b981' : '#e2e8f0', borderRadius: 12, marginRight: 8 }}>
            <Text style={{ fontSize: 11, color: barChartMode === 'onTime' ? '#fff' : '#64748b', fontWeight: 'bold' }}>ON</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleModeChange('idleTime')} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: barChartMode === 'idleTime' ? '#f59e0b' : '#e2e8f0', borderRadius: 12 }}>
            <Text style={{ fontSize: 11, color: barChartMode === 'idleTime' ? '#fff' : '#64748b', fontWeight: 'bold' }}>Idle</Text>
          </TouchableOpacity>
        </View>
      </View>

      {values.length === 0 && (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <Text style={{ color: '#94a3b8' }}>No data available for {dateLabels[dateRange]?.toLowerCase()}</Text>
        </View>
      )}

      {values.length > 0 && (
        <View style={{ marginTop: 14, flexDirection: 'row' }}>
          <View style={{ width: 45, height: 210, backgroundColor: '#fff', zIndex: 10 }}>
            <Svg width={45} height={210}>
              {Array.from({ length: dynamicSegments + 1 }).map((_, i) => {
                const val = niceMax - i * (niceMax / dynamicSegments);
                const y = 20 + i * (160 / dynamicSegments);
                return (
                  <SvgText key={`y-` + i} x={35} y={y + 4} fontSize="11" fill="#64748b" textAnchor="end" fontWeight="bold">
                    {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : Math.round(val)}
                  </SvgText>
                );
              })}
            </Svg>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ position: 'relative', width: scrollableWidth, height: 210 }}>
              <Svg width={scrollableWidth} height={210}>
                {Array.from({ length: dynamicSegments + 1 }).map((_, i) => {
                  const y = 20 + i * (160 / dynamicSegments);
                  return (
                    <Line key={`grid-` + i} x1={0} y1={y} x2={scrollableWidth - 15} y2={y} stroke="#eef2f7" strokeWidth="1" strokeDasharray="4, 6" />
                  );
                })}
                <Line x1={0} y1={20} x2={0} y2={180} stroke="#cbd5e1" strokeWidth="1" />
                <Line x1={scrollableWidth - 15} y1={20} x2={scrollableWidth - 15} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                {values.map((numVal, i) => {
                  const barH = niceMax > 0 ? (numVal / niceMax) * 160 : 0;
                  const usableWidth = scrollableWidth - 15;
                  const barSpacing = values.length > 0 ? usableWidth / values.length : usableWidth;
                  const maxBarWidth = 40;
                  const barWidth = Math.min(barSpacing * 0.55, maxBarWidth);
                  const x = (i * barSpacing) + (barSpacing - barWidth) / 2;
                  const isZeroBar = numVal === 0;
                  // Non-zero bars get a minimum height of 12 to be clearly visible against the 3px zero bars
                  const displayBarH = isZeroBar ? 3 : Math.max(barH, 12);
                  const displayY = 180 - displayBarH;
                  const barColor = isZeroBar
                    ? '#cbd5e1'
                    : barChartMode === 'distance' ? '#3b82f6' : barChartMode === 'onTime' ? '#10b981' : '#f59e0b';

                  const isAnySelected = tooltipPos.index !== null;
                  const isSelected = tooltipPos.index === i;
                  const barOpacity = isAnySelected ? (isSelected ? 1 : 0.3) : 1;

                  return (
                    <G
                      key={`bar-` + i}
                      onPress={() => {
                        if (tooltipPos.index === i) {
                          setTooltipPos({ index: null, x: 0 });
                        } else {
                          let tipX = x + barWidth / 2 - 35;
                          if (tipX < 0) tipX = 0;
                          if (tipX > scrollableWidth - 75) tipX = scrollableWidth - 75;
                          setTooltipPos({ index: i, x: tipX });
                        }
                      }}
                    >
                      <Rect x={x} y={displayY} width={barWidth} height={displayBarH} fill={barColor} opacity={barOpacity} rx="4" />
                      {isZeroBar && (
                        <SvgText x={(i * barSpacing) + barSpacing / 2} y={displayY - 3} fontSize="9" fill="#94a3b8" textAnchor="middle">
                          0
                        </SvgText>
                      )}
                      <SvgText x={(i * barSpacing) + barSpacing / 2} y={198} fontSize="11" fill="#64748b" textAnchor="middle" fontWeight="bold">
                        {labels[i]}
                      </SvgText>
                      {/* Invisible hit area for easier tapping */}
                      <Rect x={i * barSpacing} y={0} width={barSpacing} height={210} fill="transparent" />
                    </G>
                  );
                })}
              </Svg>

              {tooltipPos.index !== null ? (
                <View style={{
                  position: 'absolute', top: 10, left: tooltipPos.x,
                  backgroundColor: '#1e293b', paddingHorizontal: 6, paddingVertical: 6,
                  borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5,
                  minWidth: 70, alignItems: 'center', zIndex: 100
                }}>
                  <Text style={{ color: '#94a3b8', fontSize: 9, textAlign: 'center', marginBottom: 2 }}>
                    {fullNames[tooltipPos.index]}
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' }}>
                    {displayStrings[tooltipPos.index]}
                  </Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
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
              <View style={{ flex: 1 }}>
                <Text style={[styles.compactLegendLabel, { flex: undefined }]}>{seg.label}</Text>
                {seg.subLabel ? <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 1, fontWeight: '600' }}>{seg.subLabel}</Text> : null}
              </View>
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

const getTop10Dates = (range) => {
  if (range === 'yesterday') {
    return {
      startDate: moment().subtract(1, 'days').format('YYYY-MM-DD'),
      endDate: moment().subtract(1, 'days').format('YYYY-MM-DD')
    };
  } else if (range === '30days') {
    return {
      startDate: moment().subtract(29, 'days').format('YYYY-MM-DD'),
      endDate: moment().subtract(1, 'days').format('YYYY-MM-DD')
    };
  }
  return {
    // 7 days ending yesterday (6 days ago to yesterday)
    startDate: moment().subtract(6, 'days').format('YYYY-MM-DD'),
    endDate: moment().subtract(1, 'days').format('YYYY-MM-DD')
  };
};

// ─── DASHBOARD SCREEN ─────────────────────────────────────────────────────────
const DashboardScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const isSuperadmin = userInfo?.user_type?.toLowerCase() === 'superadmin' || userInfo?.is_superadmin || userInfo?.role?.toLowerCase() === 'superadmin' || userInfo?.emp_type == 0 || userInfo?.emp_type === '0';
  const {
    appliedClient: globalClient,
    appliedIme: globalIme,
    appliedState: globalState,
    appliedOm: globalOm,
    appliedAom: globalAom,
    appliedCluster: globalCluster,
    appliedFse: globalFse,
    appliedTechnician: globalTechnician,
    appliedDevice: globalDevice,
    applyFilter: applyGlobalFilter,
    clearFilter: clearGlobalFilter
  } = useFilter();

  const [data, setData] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selDevice, setSelDevice] = useState(globalDevice);
  const [dgDashboardData, setDgDashboardData] = useState(null);
  const [dgDashboardTop10Data, setDgDashboardTop10Data] = useState(null);
  const [top10DateRange, setTop10DateRange] = useState('yesterday');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [primaryFilter, setPrimaryFilter] = useState('all');
  const [secondaryFilter, setSecondaryFilter] = useState('all');

  // ─── CASCADE FILTER STATE ─────────────────────────────────────────────────
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [dropdowns, setDropdowns] = useState({ clients: [], imes: [], states: [], oms: [], aoms: [], clusters: [], fses: [], technicians: [] });
  const [loadingDropdowns, setLoadingDropdowns] = useState(false);
  // Panel UI states
  const [selClient, setSelClient] = useState(globalClient);
  const [selIme, setSelIme] = useState(globalIme);
  const [selState, setSelState] = useState(globalState);
  const [selOm, setSelOm] = useState(globalOm);
  const [selAom, setSelAom] = useState(globalAom);
  const [selCluster, setSelCluster] = useState(globalCluster);
  const [selFse, setSelFse] = useState(globalFse);
  const [selTechnician, setSelTechnician] = useState(globalTechnician);
  // Applied filters (used for actual list rendering)
  const [appliedClient, setAppliedClient] = useState(globalClient);
  const [appliedIme, setAppliedIme] = useState(globalIme);
  const [appliedState, setAppliedState] = useState(globalState);
  const [appliedOm, setAppliedOm] = useState(globalOm);
  const [appliedAom, setAppliedAom] = useState(globalAom);
  const [appliedCluster, setAppliedCluster] = useState(globalCluster);
  const [appliedFse, setAppliedFse] = useState(globalFse);
  const [appliedTechnician, setAppliedTechnician] = useState(globalTechnician);
  const [appliedDevice, setAppliedDevice] = useState(globalDevice);

  const [previewDevices, setPreviewDevices] = useState([]);

  const [filterLoading, setFilterLoading] = useState(false);

  // Which dropdown is open inside the panel
  const [openDrop, setOpenDrop] = useState(null); // 'client'|'state'|'district'|'cluster'|'device'|null
  const [dropSearchQuery, setDropSearchQuery] = useState('');

  // Bumped every time a cascade selection changes upstream of a dependent
  // dropdown, so in-flight fetches for a stale selection can be identified
  // and ignored even if they resolve out of order.
  const cascadeRequestIdRef = useRef(0);

  // Live timer (updated on screen focus and every second)
  const [currentTime, setCurrentTime] = useState(new Date());
  const [voltageData, setVoltageData] = useState([]);

  const filtersRef = useRef({ appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, top10DateRange });
  useEffect(() => {
    filtersRef.current = { appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, top10DateRange };
  }, [appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, top10DateRange]);

  // Update the time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── FETCH ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
      // Clear old data to ensure fresh data is visible immediately after refresh completes
      setDevices([]);
      setDgDashboardData(null);
      setDgDashboardTop10Data(null);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const currentFilters = filtersRef.current;
      const { startDate, endDate } = getTop10Dates(currentFilters.top10DateRange);

      const apiFilters = {};
      if (currentFilters.appliedClient) apiFilters.client_id = currentFilters.appliedClient.id;
      if (currentFilters.appliedIme) apiFilters.ime = currentFilters.appliedIme.id;
      if (currentFilters.appliedState) apiFilters.state_id = currentFilters.appliedState.id;
      if (currentFilters.appliedOm) apiFilters.om_id = currentFilters.appliedOm.id;
      if (currentFilters.appliedAom) apiFilters.aom_id = currentFilters.appliedAom.id;
      if (currentFilters.appliedCluster) {
        apiFilters.cluster_id = currentFilters.appliedCluster.id;
        apiFilters.district_id = currentFilters.appliedCluster.id;
      }
      if (currentFilters.appliedFse) apiFilters.fse_id = currentFilters.appliedFse.id;
      if (currentFilters.appliedTechnician) apiFilters.technician_id = currentFilters.appliedTechnician.id;

      const deviceResp = await fetchDeviceList(apiFilters, isRefresh);
      const devicesArr = deviceResp.devices || [];
      setDevices(devicesArr);

      const top10Params = { from_date: startDate, to_date: endDate, ...apiFilters };

      const [dgResp, ddResp, top10Resp, voltResp] = await Promise.all([
        fetchDgDashboard(apiFilters),
        fetchFilterDropdowns(),
        fetchDgDashboardTop10(top10Params),
        fetchDgCurrentDeviceVoltage()
      ]);
      setDgDashboardData(dgResp || null);
      setDgDashboardTop10Data(top10Resp || null);
      setDropdowns(ddResp);

      const voltData = voltResp?.data || [];
      setVoltageData(voltData);
    } catch (err) {
      setError(err.message || 'Failed to sync dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        loadData(true);
      }
    });
    return () => subscription.remove();
  }, [loadData]);

  // ─── CLEAR DOWNSTREAM DROPDOWN OPTIONS IMMEDIATELY ───────────────────────
  // Whenever a parent-level filter changes (client/state/om/aom/cluster/fse),
  // the dropdown OPTION LISTS for everything below it must be cleared right
  // away (synchronously), not just the selected values. Otherwise, if the
  // user re-opens a dependent dropdown before the background fetch below
  // finishes, they will briefly (or, on a slow network, for a while) see the
  // PREVIOUS parent's options — e.g. changing OM but still seeing the old
  // OM's AOM list. Clearing here guarantees every dropdown always reflects
  // only the currently selected parent chain, no matter how fast the user
  // clicks through client → state → om → aom → cluster → fse → technician.
  const clearDownstreamOptions = useCallback((level) => {
    setDropdowns(prev => {
      const next = { ...prev };
      if (level === 'client' || level === 'state') {
        next.oms = []; next.aoms = []; next.clusters = []; next.fses = []; next.technicians = [];
      }
      if (level === 'om') {
        next.aoms = []; next.clusters = []; next.fses = []; next.technicians = [];
      }
      if (level === 'aom') {
        next.clusters = []; next.fses = []; next.technicians = [];
      }
      if (level === 'cluster') {
        next.fses = []; next.technicians = [];
      }
      if (level === 'fse') {
        next.technicians = [];
      }
      return next;
    });
    // Device options are always cascade-scoped, so clear them too until the
    // fresh preview-device fetch (below) completes for the new selection.
    setPreviewDevices([]);
  }, []);

  // Dynamically update dependent dropdowns and preview devices when panel selections change
  useEffect(() => {
    let isActive = true;
    // Snapshot a request id for this run so a late-resolving fetch from an
    // older (now-stale) selection can never overwrite newer state, even if
    // network responses arrive out of order.
    const requestId = ++cascadeRequestIdRef.current;

    const fetchDependentDropdownsAndPreview = async () => {
      try {
        setLoadingDropdowns(true);
        const ddResp = await fetchFilterDropdowns(selClient?.id, selState?.id, selOm?.id, selAom?.id, selCluster?.id, selFse?.id, selTechnician?.id);

        // AOM ke base par cluster fetch karo: sirf aomId pass karo taaki backend sahi clusters de
        // (baaki filters pass karne par backend restrict kar sakta hai)
        let aomClusters = [];
        if (selAom?.id && !selCluster) {
          try {
            const aomClusterResp = await fetchFilterDropdowns(null, null, null, selAom.id, null, null, null);
            aomClusters = aomClusterResp.clusters?.length > 0
              ? aomClusterResp.clusters
              : (aomClusterResp.districts?.length > 0 ? aomClusterResp.districts : []);
          } catch (ce) {
            console.warn('[aomClusters fetch]', ce.message);
          }
        }

        const [fetchedOms, fetchedAoms, fetchedFses, fetchedTechs, fetchedImes] = await Promise.all([
          // OM_Head: state select ke baad, client (emp_type) pass karo superadmin ke liye
          selState ? fetchDesignationUsers("OM_Head", {
            state_id: selState.id,
            ...(selClient ? { emp_type: selClient.id } : {})
          }) : Promise.resolve([]),
          // AOM: OM ka superior pass karo
          selOm ? fetchDesignationUsers("AOM", {
            superior: selOm.id,
            state_id: selState?.id,
            ...(selClient ? { emp_type: selClient.id } : {})
          }) : Promise.resolve([]),
          // FSE: AOM ka id superior hai, cluster(district) id dist_id hai
          (selAom || selCluster) ? fetchDesignationUsers("FSE", {
            superior: selAom?.id || '',
            state_id: selState?.id,
            dist_id: selCluster?.id || '',
            ...(selClient ? { emp_type: selClient.id } : {})
          }) : Promise.resolve([]),
          // Technician: FSE ka id superior hai
          selFse ? fetchDesignationUsers("Technician", {
            superior: selFse.id,
            state_id: selState?.id,
            dist_id: selCluster?.id || '',
            ...(selClient ? { emp_type: selClient.id } : {})
          }) : Promise.resolve([]),
          ((dropdowns.imes || []).length === 0) ? fetchImeList() : Promise.resolve([]),
        ]);

        // Cluster list:
        // AOM selected hai tabhi clusters dikhao — warna [] clear karo
        // Isse OM change hone par AOM null ho jata hai → cluster turant clear
        const resolvedClusters = selAom?.id
          ? (aomClusters.length > 0 ? aomClusters : (ddResp.clusters?.length > 0 ? ddResp.clusters : (ddResp.districts || [])))
          : [];

        // Bail out if a newer selection has already superseded this fetch —
        // this is the key guard that stops "purana data" (stale parent's
        // options) from ever landing in state after the user has already
        // moved on to a different OM/AOM/Cluster/etc.
        if (isActive && requestId === cascadeRequestIdRef.current) {
          setDropdowns(prev => ({
            clients: ddResp.clients || [],
            imes: fetchedImes.length > 0 ? fetchedImes : (prev.imes || []),
            states: ddResp.states || [],
            // OM: State selected → fetchedOms (filtered by state), else []
            oms: selState
              ? (fetchedOms.length > 0 ? fetchedOms : (ddResp.oms || []))
              : [],
            // AOM: OM selected → fetchedAoms (filtered by superior=om.id), else []
            // OM change hone par AOM null → [] dikhega (stale data nahi)
            aoms: selOm
              ? (fetchedAoms.length > 0 ? fetchedAoms : (ddResp.aoms || []))
              : [],
            // Cluster: AOM selected → resolvedClusters (dedicated fetch), else []
            clusters: resolvedClusters,
            // FSE: AOM ya Cluster selected → fetchedFses (filtered), else []
            // AOM change hone par FSE null → [] dikhega (stale nahi)
            fses: (selAom || selCluster)
              ? (fetchedFses.length > 0 ? fetchedFses : (ddResp.fses || []))
              : [],
            // Technician: FSE selected → fetchedTechs (filtered), else []
            technicians: selFse
              ? (fetchedTechs.length > 0 ? fetchedTechs : (ddResp.technicians || []))
              : [],
          }));
        }


        // Fetch preview devices for the Device dropdown
        // IMPORTANT: /dg_device_latest_json/ sirf yeh params support karta hai:
        // client_id, ime, state_id, district_id, cluster_id
        // om_id, aom_id, fse_id, technician_id is endpoint par kaam nahi karte → 0 devices
        const deviceApiFilters = {};
        if (selClient) deviceApiFilters.client_id = selClient.id;
        if (selIme) deviceApiFilters.ime = selIme.id;
        if (selState) deviceApiFilters.state_id = selState.id;
        if (selCluster) {
          deviceApiFilters.cluster_id = selCluster.id;
          deviceApiFilters.district_id = selCluster.id;
        }

        const devResp = await fetchDeviceList(deviceApiFilters);
        if (isActive && requestId === cascadeRequestIdRef.current) {
          setPreviewDevices(devResp.devices || []);
        }
      } catch (e) {
        console.warn('Failed to update dependent dropdowns', e);
      } finally {
        if (isActive && requestId === cascadeRequestIdRef.current) setLoadingDropdowns(false);
      }
    };

    // Only fetch if we've already done initial load and panel is open
    if (devices.length > 0 && showFilterPanel) {
      fetchDependentDropdownsAndPreview();
    }

    return () => { isActive = false; };
  }, [selClient, selIme, selState, selOm, selAom, selCluster, selFse, selTechnician, showFilterPanel]);

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

  const voltageStats = useMemo(() => {
    let normal = 0, critical = 0, danger = 0, total = 0;
    const allowedDeviceIds = new Set(cascadeFilteredDevices.map(d => String(d.id || d.deviceid)));

    voltageData.forEach(item => {
      if (allowedDeviceIds.has(String(item.deviceid))) {
        let voltage = parseFloat(item.adc1_voltage || "0");
        if (isNaN(voltage)) voltage = 0;
        if (voltage < 9.5) danger++;
        else if (voltage >= 9.5 && voltage < 11.5) critical++;
        else if (voltage >= 11.5) normal++;
        total++;
      }
    });
    return { normal, critical, danger, total };
  }, [voltageData, cascadeFilteredDevices]);

  const padToTop10 = useCallback((existingArr, isDurationString) => {
    const allowedDeviceIds = new Set(cascadeFilteredDevices.map(d => String(d.id || d.deviceid)));
    const filtered = (existingArr || []).filter(item => allowedDeviceIds.has(String(item.deviceid)));
    const existingIds = new Set(filtered.map(item => String(item.deviceid)));

    for (const dev of cascadeFilteredDevices) {
      if (filtered.length >= 10) break;
      const did = String(dev.id || dev.deviceid);
      if (!existingIds.has(did)) {
        filtered.push({
          deviceid: did,
          device_name: dev.name || 'Unknown Device',
          dg_name: dev.name || 'Unknown Device',
          total_distance_km: 0,
          total_dg_move_km: 0,
          running_hours: 0,
          total_dg_on: isDurationString ? '00:00:00' : 0,
          total_dg_idle: isDurationString ? '00:00:00' : 0,
        });
        existingIds.add(did);
      }
    }
    return filtered.slice(0, 10);
  }, [cascadeFilteredDevices]);

  const filteredDgDashboardData = useMemo(() => {
    if (!dgDashboardData) return null;
    return {
      top_moving: padToTop10(dgDashboardData.top_moving, false),
      top_running: padToTop10(dgDashboardData.top_running, false),
      top_idle: padToTop10(dgDashboardData.top_idle, true)
    };
  }, [dgDashboardData, padToTop10]);


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

  const filteredDgTop10Data = useMemo(() => {
    if (!dgDashboardTop10Data) return null;

    return {
      top_moving: padToTop10(dgDashboardTop10Data.top_moving, false),
      top_running: padToTop10(dgDashboardTop10Data.top_running, true),
      top_idle: padToTop10(dgDashboardTop10Data.top_idle, true),
    };
  }, [dgDashboardTop10Data, padToTop10]);
  // Device options for the Device dropdown inside the filter panel
  // Dynamically filtered based on the current panel selection via previewDevices
  const filteredDeviceOptions = useMemo(() => {
    return previewDevices.map(d => ({ id: d.id ?? d.deviceid, name: d.name ?? d.device_name }));
  }, [previewDevices]);

  const activeCascadeCount = [appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, appliedDevice].filter(Boolean).length;

  const clearCascade = async () => {
    // Reset panel UI state
    setSelClient(null); setSelIme(null); setSelState(null); setSelOm(null); setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null); setOpenDrop(null);
    // Immediately clear every dependent dropdown's option list too, so the
    // panel never flashes a previous selection's leftover options.
    setDropdowns(prev => ({ ...prev, oms: [], aoms: [], clusters: [], fses: [], technicians: [] }));
    setPreviewDevices([]);
    // Invalidate any in-flight cascade fetch so it can't overwrite this reset.
    cascadeRequestIdRef.current += 1;
    // Reset applied state
    setAppliedClient(null); setAppliedIme(null); setAppliedState(null); setAppliedOm(null); setAppliedAom(null); setAppliedCluster(null); setAppliedFse(null); setAppliedTechnician(null); setAppliedDevice(null);
    // Clear global filter — other screens will now fetch unfiltered data
    clearGlobalFilter();
    // Re-fetch full unfiltered list from backend
    setFilterLoading(true);
    try {
      const { startDate, endDate } = getTop10Dates(top10DateRange);

      const resp = await fetchDeviceList({});
      const devs = resp.devices || [];
      setDevices(devs);

      const top10Params = { from_date: startDate, to_date: endDate };
      const [top10Resp, dgResp] = await Promise.all([
        fetchDgDashboardTop10(top10Params),
        fetchDgDashboard({})
      ]);

      setDgDashboardTop10Data(top10Resp || null);
      setDgDashboardData(dgResp || null);
    } catch (e) {
      console.warn('[clearCascade]', e.message);
    } finally {
      setFilterLoading(false);
      setShowFilterPanel(false);
    }
  };

  // ─── APPLY CASCADE ───────────────────────────────────────────────────────
  // FIX: pehle yahan device list ke liye ek ALAG, chhota "deviceApiFilters"
  // banaya jaata tha jisme om_id / aom_id / fse_id / technician_id include
  // hi nahi hote the ("device endpoint sirf client/ime/state/cluster support
  // karta hai" wali galat assumption). Isi wajah se OM -> AOM -> Cluster
  // select karke Apply dabane par backend ko incomplete filters milte the
  // aur device list 0 aa jaati thi — jabki dashboard/top10 calls poore
  // apiFilters ke saath sahi chal rahe the.
  //
  // Ab teeno calls (device list, dg dashboard, top10) EK HI complete
  // apiFilters object use karte hain — jaisa website (loadDevices) aur
  // isi screen ke apne loadData() me already ho raha hai. Baaki poora
  // cascade/reset logic bilkul waisa hi hai, sirf yeh mismatch fix hua hai.
  const applyCascade = async () => {
    // Save selected items for display (badge count, chips)
    setAppliedClient(selClient);
    setAppliedIme(selIme);
    setAppliedState(selState);
    setAppliedOm(selOm);
    setAppliedAom(selAom);
    setAppliedCluster(selCluster);
    setAppliedFse(selFse);
    setAppliedTechnician(selTechnician);
    setAppliedDevice(selDevice);

    // Build ONE complete filter object — used for device list, dg dashboard,
    // and top10 API calls alike. selDevice is handled client-side afterwards
    // by cascadeFilteredDevices (matched by ID), so it's not sent to backend.
    const apiFilters = {};
    if (selClient) apiFilters.client_id = selClient.id;
    if (selIme) apiFilters.ime = selIme.id;
    if (selState) apiFilters.state_id = selState.id;
    if (selOm) apiFilters.om_id = selOm.id;
    if (selAom) apiFilters.aom_id = selAom.id;
    if (selCluster) {
      apiFilters.cluster_id = selCluster.id;
      apiFilters.district_id = selCluster.id;
    }
    if (selFse) apiFilters.fse_id = selFse.id;
    if (selTechnician) apiFilters.technician_id = selTechnician.id;

    // Update global filter context — other screens will pick this up
    applyGlobalFilter(
      { client: selClient, ime: selIme, state: selState, om: selOm, aom: selAom, cluster: selCluster, fse: selFse, technician: selTechnician, device: selDevice },
      apiFilters
    );

    setFilterLoading(true);
    try {
      const { startDate, endDate } = getTop10Dates(top10DateRange);

      // ✅ same apiFilters used everywhere now
      const resp = await fetchDeviceList(apiFilters);
      const devs = resp.devices || [];
      setDevices(devs);

      const top10Params = { from_date: startDate, to_date: endDate, ...apiFilters };
      const [top10Resp, dgResp] = await Promise.all([
        fetchDgDashboardTop10(top10Params),
        fetchDgDashboard(apiFilters)
      ]);

      setDgDashboardTop10Data(top10Resp || null);
      setDgDashboardData(dgResp || null);
    } catch (e) {
      console.warn('[applyCascade]', e.message);
    } finally {
      setFilterLoading(false);
      setShowFilterPanel(false);
    }
  };

  const handleTop10DateRangeChange = async (newRange) => {
    setTop10DateRange(newRange);
    try {
      const { startDate, endDate } = getTop10Dates(newRange);

      const apiFilters = {};
      if (appliedClient) apiFilters.client_id = appliedClient.id;
      if (appliedState) apiFilters.state_id = appliedState.id;
      if (appliedOm) apiFilters.om_id = appliedOm.id;
      if (appliedAom) apiFilters.aom_id = appliedAom.id;
      if (appliedCluster) {
        apiFilters.cluster_id = appliedCluster.id;
        apiFilters.district_id = appliedCluster.id;
      }
      if (appliedFse) apiFilters.fse_id = appliedFse.id;
      if (appliedTechnician) apiFilters.technician_id = appliedTechnician.id;

      const top10Params = { from_date: startDate, to_date: endDate, ...apiFilters };
      const top10Resp = await fetchDgDashboardTop10(top10Params);
      setDgDashboardTop10Data(top10Resp || null);
    } catch (e) {
      console.warn('handleTop10DateRangeChange error:', e.message);
    }
  };

  const toggleFilterDrop = (key) => {
    const isOpen = openDrop === key;
    if (isOpen) {
      setOpenDrop(null);
    } else {
      setOpenDrop(key);
      setDropSearchQuery('');
    }
  };

  const openFilterPanel = () => {
    setSelClient(appliedClient);
    setSelState(appliedState);
    setSelOm(appliedOm);
    setSelAom(appliedAom);
    setSelCluster(appliedCluster);
    setSelFse(appliedFse);
    setSelTechnician(appliedTechnician);
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
            {loadingDropdowns && (key === 'om' || key === 'aom' || key === 'cluster' || key === 'fse' || key === 'technician' || key === 'device') && options.length === 0 ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#1565C0" />
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Loading {label}s...</Text>
              </View>
            ) : (
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
                ListEmptyComponent={
                  <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: '#94a3b8' }}>No {label}s found</Text>
                  </View>
                }
              />
            )}
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
        <View style={{ gap: 12 }}>
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

          <View style={[styles.dualChartCard, { justifyContent: 'center' }]}>
            <CompactDonut
              horizontal={true}
              total={voltageStats.total}
              title="Ex. Batt Volt STATUS"
              activeFilter={null}
              onFilterSelect={(filterKey) => navigation.navigate('DeviceTab', { screen: 'DevicesList', params: { voltageFilter: filterKey } })}
              dataEntries={[
                { label: 'DANGER', subLabel: '0.0 - 9.4V', val: voltageStats.danger, color: '#ef4444', filterKey: 'Danger' },
                { label: 'CRITICAL', subLabel: '9.5 - 11.4V', val: voltageStats.critical, color: '#f59e0b', filterKey: 'Critical' },
                { label: 'NORMAL', subLabel: '11.5V & above', val: voltageStats.normal, color: '#10b981', filterKey: 'Normal' },
              ]}
            />
          </View>
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
      {filteredDgTop10Data && (
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 8, marginBottom: 0 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>DG Performance</Text>
          </View>
          <Top10BarChart data={filteredDgTop10Data} dateRange={top10DateRange} onDateRangeChange={handleTop10DateRangeChange} />
        </View>
      )}

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
        <View style={[cStyles.panel, { zIndex: 10, maxHeight: '80%' }]}>
          <View style={cStyles.panelHeader}>
            <Text style={cStyles.panelTitle}>Filter Devices</Text>
          </View>
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} nestedScrollEnabled={true}>
            {(() => {
              const availableStates = dropdowns.states || [];
              const availableOms = dropdowns.oms || [];
              const availableAoms = dropdowns.aoms || [];
              const availableClusters = dropdowns.clusters || [];
              const availableFses = dropdowns.fses || [];
              const availableTechnicians = dropdowns.technicians || [];

              return (
                <>
                  {renderCascadeDropdown('IME', 'office-building-outline', 'ime', selIme, dropdowns.imes || [],
                    (v) => { setSelIme(v); },
                    () => { setSelIme(null); }
                  )}
                  {isSuperadmin && renderCascadeDropdown('Client', 'account-multiple-outline', 'client', selClient, dropdowns.clients || [],
                    (v) => {
                      setSelClient(v);
                      setSelState(null); setSelOm(null); setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('client');
                    },
                    () => {
                      setSelClient(null);
                      setSelState(null); setSelOm(null); setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('client');
                    }
                  )}
                  {renderCascadeDropdown('Circle', 'map-outline', 'state', selState, availableStates,
                    (v) => {
                      setSelState(v);
                      setSelOm(null); setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('state');
                    },
                    () => {
                      setSelState(null);
                      setSelOm(null); setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('state');
                    }
                  )}
                  {renderCascadeDropdown('O&M Head', 'account-tie', 'om', selOm, availableOms,
                    (v) => {
                      setSelOm(v);
                      setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('om');
                    },
                    () => {
                      setSelOm(null);
                      setSelAom(null); setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('om');
                    }
                  )}
                  {renderCascadeDropdown('AOM', 'account-supervisor', 'aom', selAom, availableAoms,
                    (v) => {
                      setSelAom(v);
                      setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('aom');
                    },
                    () => {
                      setSelAom(null);
                      setSelCluster(null); setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('aom');
                    }
                  )}
                  {renderCascadeDropdown('Cluster', 'hexagon-multiple-outline', 'cluster', selCluster, availableClusters,
                    (v) => {
                      setSelCluster(v);
                      setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('cluster');
                    },
                    () => {
                      setSelCluster(null);
                      setSelFse(null); setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('cluster');
                    }
                  )}
                  {renderCascadeDropdown('FSE', 'account-wrench-outline', 'fse', selFse, availableFses,
                    (v) => {
                      setSelFse(v);
                      setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('fse');
                    },
                    () => {
                      setSelFse(null);
                      setSelTechnician(null); setSelDevice(null);
                      clearDownstreamOptions('fse');
                    }
                  )}
                  {renderCascadeDropdown('Technician', 'account-hard-hat', 'technician', selTechnician, availableTechnicians,
                    (v) => { setSelTechnician(v); setSelDevice(null); },
                    () => { setSelTechnician(null); setSelDevice(null); }
                  )}
                  {renderCascadeDropdown('Device', 'car', 'device', selDevice, filteredDeviceOptions,
                    (v) => setSelDevice(v),
                    () => setSelDevice(null)
                  )}
                </>
              );
            })()}
          </ScrollView>

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

      {(loading && !refreshing) || (devices.length === 0 && (loading || refreshing)) ? (
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
          ListHeaderComponent={renderHeader()}
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
    marginHorizontal: 8,
  },
  chartDividerHorizontal: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 12,
    width: '100%'
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