import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';
import Header from '../../components/Header';
import { fetchAlarms, fetchDeviceList, reverseGeocode } from '../../api/webApi';

// ─── Config ────────────────────────────────────────────────────────────────────
const ALARM_TYPES = {
  powercut: {
    label: 'Power Cut',
    icon: 'power-plug-off',
    color: '#ef4444',
    bg: '#fee2e2',
    pill: '#ef4444',
  },
  lowbattery: {
    label: 'Low Battery',
    icon: 'battery-alert-variant-outline',
    color: '#f59e0b',
    bg: '#fef3c7',
    pill: '#f59e0b',
  },
  vibration: {
    label: 'Vibration',
    icon: 'vibrate',
    color: '#8b5cf6',
    bg: '#ede9fe',
    pill: '#8b5cf6',
  },
};

// Stat card filter key mapping
// 'all' => show all, 'totaldgs' => unique DG filter, others map to alarm type keys
const STAT_FILTER_KEYS = {
  all: 'All',
  totaldgs: 'totaldgs',
  powercut: 'powercut',
  lowbattery: 'lowbattery',
  vibration: 'vibration',
};

const FILTER_TYPES = ['All', 'powercut', 'lowbattery', 'vibration'];

const getAlarmConfig = (type = '') => {
  const key = String(type).toLowerCase().replace(/[^a-z]/g, '');
  return ALARM_TYPES[key] || {
    label: type || 'Unknown',
    icon: 'bell-alert-outline',
    color: '#64748b',
    bg: '#f1f5f9',
    pill: '#64748b',
  };
};

// ─── Battery bar ──────────────────────────────────────────────────────────────
const BatteryBar = ({ level }) => {
  const pct = Math.min(100, Math.max(0, parseFloat(level) || 0));
  const color = pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444';
  return (
    <View style={bar.wrap}>
      <View style={[bar.fill, { width: `${pct}%`, backgroundColor: color }]} />
      <Text style={bar.label}>{Math.round(pct)}%</Text>
    </View>
  );
};
const bar = StyleSheet.create({
  wrap: { width: 54, height: 10, backgroundColor: '#e2e8f0', borderRadius: 5, overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  label: { fontSize: 9, fontWeight: '700', color: '#475569', textAlign: 'center', zIndex: 1 },
});

// ─── Network signal dots ──────────────────────────────────────────────────────
const SignalDots = ({ value }) => {
  const bars = Math.min(4, Math.max(0, parseInt(value) || 0));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {[1, 2, 3, 4].map(i => (
        <View
          key={i}
          style={{
            width: 4,
            height: 4 + i * 3,
            borderRadius: 1,
            backgroundColor: i <= bars ? '#10b981' : '#cbd5e1',
          }}
        />
      ))}
    </View>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────
const AlarmDashboardScreen = ({ navigation }) => {
  const [alarms, setAlarms] = useState([]);
  const [deviceMap, setDeviceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState('All');
  const [activeStatKey, setActiveStatKey] = useState('all'); // tracks which stat card is active
  const [searchText, setSearchText] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const geocodeQueueRef = useRef({});

  // ── Load device name map ──
  const loadDevices = useCallback(async () => {
    try {
      const data = await fetchDeviceList();
      const list = data?.devices || [];
      const map = {};
      const locMap = {};
      list.forEach(d => {
        const id = d.deviceid ?? d.id;
        if (id != null) {
          map[String(id)] = d.name || `Device ${id}`;
          locMap[String(id)] = { lat: d.motion_lat, lon: d.motion_lon };
        }
      });
      setDeviceMap(map);
      return { map, locMap };
    } catch (e) {
      console.warn('[AlarmDash] loadDevices error', e.message);
      return { map: {}, locMap: {} };
    }
  }, []);

  // ── Lazy reverse geocode single alarm ──
  const geocodeAlarm = useCallback(async (alarmId, lat, lon) => {
    if (!lat || !lon) return;
    const key = `${alarmId}`;
    if (geocodeQueueRef.current[key]) return;
    geocodeQueueRef.current[key] = true;
    try {
      const addr = await reverseGeocode(lat, lon);
      if (addr && addr !== '—') {
        setAlarms(prev => prev.map(a => String(a.id) === String(alarmId) ? { ...a, _address: addr } : a));
      }
    } catch (_) { }
  }, []);

  // ── Load alarms ──
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [{ map: dMap, locMap }, data] = await Promise.all([loadDevices(), fetchAlarms()]);
      let list = Array.isArray(data) ? data : (data?.data ?? []);

      // ✅ Only keep today's alarms
      const todayStart = moment().startOf('day');
      const todayEnd = moment().endOf('day');
      list = list.filter(a => {
        const t = moment(a.eventtime || a.serverTime || a.created_at);
        return t.isValid() && t.isBetween(todayStart, todayEnd, null, '[]');
      });

      // Sort newest first
      list = [...list].sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));

      // Attach device name and preserve manually fetched addresses
      setAlarms(prevAlarms => {
        const finalList = list.map(a => {
          let addr = (a.address && a.address !== '—') ? a.address : null;
          // If API didn't provide address, check if we manually geocoded it previously
          if (!addr) {
            const old = prevAlarms.find(p => String(p.id) === String(a.id));
            if (old && old._address) addr = old._address;
          }
          return {
            ...a,
            _deviceName: dMap[String(a.deviceid ?? a.deviceId)] || `Device #${a.deviceid ?? a.deviceId ?? '?'}`,
            _address: addr,
          };
        });

        // Kick off lazy geocoding for alarms still missing addresses
        finalList.forEach(a => {
          if (a._address) return; // Address already available from API or preserved from previous state

          const devId = String(a.deviceid ?? a.deviceId);
          let lat = a.latitude || a.lat || a.attributes?.latitude || a.attributes?.lat;
          let lon = a.longitude || a.lon || a.attributes?.longitude || a.attributes?.lon;
          
          // Fallback to live device location if alarm location is missing
          if (!lat && locMap[devId]) {
            lat = locMap[devId].lat;
            lon = locMap[devId].lon;
          }

          if (lat && lon) geocodeAlarm(a.id, lat, lon);
        });

        return finalList;
      });

      setLastRefresh(new Date());
    } catch (e) {
      console.warn('[AlarmDash] loadData error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadDevices, geocodeAlarm]);

  useEffect(() => {
    loadData();
    // Auto refresh removed to reduce server load
    // const interval = setInterval(() => loadData(false), 120000); // 2 mins
    // return () => clearInterval(interval);
  }, [loadData]);

  // ── Derived stats ──
  const totalAlarms = alarms.length;
  const totalDGs = new Set(alarms.map(a => a.deviceid ?? a.deviceId).filter(Boolean)).size;
  const powerCutCount = alarms.filter(a => String(a.type || '').toLowerCase().includes('powercut')).length;
  const lowBatCount = alarms.filter(a => {
    const t = String(a.type || '').toLowerCase();
    const bat = parseFloat(a.attributes?.batteryLevel ?? a.attributes?.battery ?? 200);
    return t.includes('lowbattery') || (bat > 0 && bat <= 15);
  }).length;
  const vibCount = alarms.filter(a => String(a.type || '').toLowerCase().includes('vibration')).length;

  // ── Stat card press handler ──
  // Clicking a stat card sets both the chip filter and tracks activeStatKey
  const handleStatPress = (statKey) => {
    if (activeStatKey === statKey) {
      // Tap again to deselect → show all
      setActiveStatKey('all');
      setFilterType('All');
    } else {
      setActiveStatKey(statKey);
      if (statKey === 'all') {
        setFilterType('All');
      } else if (statKey === 'totaldgs') {
        // "Total DGs" = show all alarms (just a count of unique DGs, not a type filter)
        setFilterType('All');
      } else {
        setFilterType(statKey); // 'powercut' | 'lowbattery' | 'vibration'
      }
    }
  };

  // ── Filter logic ──
  const filtered = alarms.filter(a => {
    const t = String(a.type || '').toLowerCase();
    const typeMatch = filterType === 'All' || t.includes(filterType);
    const search = searchText.trim().toLowerCase();
    const nameMatch = !search || (a._deviceName || '').toLowerCase().includes(search) || (a._address || '').toLowerCase().includes(search);
    return typeMatch && nameMatch;
  });

  // ── Stat card component ──
  const StatCard = ({ statKey, icon, color, bg, count, label }) => {
    const isActive = activeStatKey === statKey;
    return (
      <TouchableOpacity
        style={[
          styles.statCard,
          { borderTopColor: color },
          isActive && { backgroundColor: color },
        ]}
        onPress={() => handleStatPress(statKey)}
        activeOpacity={0.75}
      >
        <View style={[styles.statIconWrap, { backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : bg }]}>
          <Icon name={icon} size={20} color={isActive ? '#FFF' : color} />
        </View>
        <Text style={[styles.statCount, isActive && { color: '#FFF' }]}>{count}</Text>
        <Text style={[styles.statLabel, isActive && { color: 'rgba(255,255,255,0.85)' }]}>{label}</Text>
        {isActive && (
          <View style={styles.activeIndicator}>
            <Icon name="check-circle" size={10} color="#FFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Render single alarm card ──
  const renderCard = ({ item }) => {
    const cfg = getAlarmConfig(item.type);
    const time = moment(item.eventtime || item.serverTime).format('MMM D, hh:mm:ss A');
    const batLevel = item.attributes?.batteryLevel ?? item.attributes?.battery;
    const network = item.attributes?.rssi ?? item.attributes?.network ?? item.attributes?.signalStrength;
    const dgStatus = item.attributes?.ignition === true ? 'ON' : item.attributes?.ignition === false ? 'OFF' : '—';
    const charging = item.attributes?.charge === true ? 'Yes' : item.attributes?.charge === false ? 'No' : '—';
    const motion = item.attributes?.motion === true ? 'Moving' : item.attributes?.motion === false ? 'Stop' : '—';
    const devId = item.deviceid ?? item.deviceId ?? '?';

    return (
      <View style={styles.card}>
        {/* Left accent bar */}
        <View style={[styles.cardAccent, { backgroundColor: cfg.pill }]} />

        <View style={styles.cardBody}>
          {/* Header row */}
          <View style={styles.cardHeader}>
            <View style={[styles.alarmPill, { backgroundColor: cfg.bg }]}>
              <Icon name={cfg.icon} size={13} color={cfg.color} />
              <Text style={[styles.alarmPillText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
            <Text style={styles.cardTime}>{time}</Text>
          </View>

          {/* Device row */}
          <View style={styles.deviceRow}>
            <Icon name="truck-outline" size={14} color="#64748b" />
            <Text style={styles.deviceName}>{item._deviceName}</Text>
            <View style={styles.idBadge}>
              <Text style={styles.idText}>ID: {devId}</Text>
            </View>
          </View>

          {/* Address */}
          {item._address ? (
            <View style={styles.addressRow}>
              <Icon name="map-marker-outline" size={13} color="#10b981" />
              <Text style={styles.addressText} numberOfLines={2}>{item._address}</Text>
            </View>
          ) : (
            <View style={styles.addressRow}>
              <Icon name="map-marker-outline" size={13} color="#cbd5e1" />
              <Text style={styles.addressPlaceholder}>Fetching address...</Text>
            </View>
          )}

          {/* Telemetry row */}
          <View style={styles.telemetryRow}>
            {/* Battery */}
            <View style={styles.telBox}>
              <Icon name="battery-charging-outline" size={12} color="#64748b" />
              <Text style={styles.telLabel}>Battery</Text>
              {batLevel != null ? (
                <BatteryBar level={batLevel} />
              ) : <Text style={styles.telValue}>—</Text>}
            </View>

            {/* Network */}
            <View style={styles.telBox}>
              <Icon name="signal" size={12} color="#64748b" />
              <Text style={styles.telLabel}>Network</Text>
              {network != null ? <SignalDots value={network} /> : <Text style={styles.telValue}>—</Text>}
            </View>

            {/* DG Status */}
            <View style={styles.telBox}>
              <Icon name="lightning-bolt" size={12} color="#64748b" />
              <Text style={styles.telLabel}>DG</Text>
              <Text style={[styles.telValue, { color: dgStatus === 'ON' ? '#10b981' : dgStatus === 'OFF' ? '#ef4444' : '#94a3b8' }]}>
                {dgStatus}
              </Text>
            </View>

            {/* Charging */}
            <View style={styles.telBox}>
              <Icon name="ev-plug-type2" size={12} color="#64748b" />
              <Text style={styles.telLabel}>Charging</Text>
              <Text style={[styles.telValue, { color: charging === 'Yes' ? '#10b981' : '#94a3b8' }]}>{charging}</Text>
            </View>

            {/* Motion */}
            <View style={styles.telBox}>
              <Icon name="run" size={12} color="#64748b" />
              <Text style={styles.telLabel}>Movement</Text>
              <Text style={[styles.telValue, {
                color: motion === 'Moving' ? '#0284c7' : motion === 'Stop' ? '#f59e0b' : '#94a3b8'
              }]}>{motion}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header
        title="DG Alarm Dashboard"
        navigation={navigation}
        showBack={false}
        rightAction={
          <TouchableOpacity onPress={() => loadData(true)} style={{ padding: 8 }}>
            <Icon name="refresh" size={24} color="#FFF" />
          </TouchableOpacity>
        }
      />

      {/* ✅ Summary Stats — all clickable as filters */}
      <View style={styles.statsRow}>
        <StatCard
          statKey="all"
          icon="bell-ring-outline"
          color="#ef4444"
          bg="#fee2e2"
          count={totalAlarms}
          label="Total Alarms"
        />
        <StatCard
          statKey="totaldgs"
          icon="truck-outline"
          color="#0284c7"
          bg="#dbeafe"
          count={totalDGs}
          label="Total DGs"
        />
        <StatCard
          statKey="powercut"
          icon="power-plug-off"
          color="#ef4444"
          bg="#fee2e2"
          count={powerCutCount}
          label="Power Cut"
        />
        <StatCard
          statKey="lowbattery"
          icon="battery-alert"
          color="#f59e0b"
          bg="#fef3c7"
          count={lowBatCount}
          label="Low Battery"
        />
        <StatCard
          statKey="vibration"
          icon="vibrate"
          color="#8b5cf6"
          bg="#ede9fe"
          count={vibCount}
          label="Vibration"
        />
      </View>

      {/* Last refresh */}
      {lastRefresh && (
        <Text style={styles.refreshText}>
          Last refresh: {moment(lastRefresh).format('D/M/YYYY, h:mm:ss A')}
        </Text>
      )}

      {/* Filters — chip bar stays in sync with stat card */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTER_TYPES.map(t => {
            const isActive = filterType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => {
                  setFilterType(t);
                  // Sync stat card highlight
                  if (t === 'All') setActiveStatKey('all');
                  else setActiveStatKey(t);
                }}
              >
                {t !== 'All' && (
                  <Icon
                    name={getAlarmConfig(t).icon}
                    size={13}
                    color={isActive ? '#FFF' : getAlarmConfig(t).color}
                    style={{ marginRight: 4 }}
                  />
                )}
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {t === 'All' ? '🌟 All Types' : getAlarmConfig(t).label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Icon name="magnify" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search DG name or address..."
          placeholderTextColor="#94a3b8"
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Icon name="close-circle" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Alarm Count */}
      <View style={styles.countRow}>
        <Icon name="format-list-bulleted" size={15} color="#64748b" />
        <Text style={styles.countText}>{filtered.length} alarm events</Text>
        {activeStatKey !== 'all' && (
          <TouchableOpacity
            style={styles.clearFilterBtn}
            onPress={() => { setActiveStatKey('all'); setFilterType('All'); }}
          >
            <Icon name="close-circle" size={13} color="#ef4444" />
            <Text style={styles.clearFilterText}>Clear filter</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#ef4444" />
          <Text style={styles.loadingText}>Loading Alarm Events...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => String(item.id ?? i)}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} colors={['#ef4444']} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="bell-off-outline" size={64} color="#cbd5e1" />
              <Text style={styles.emptyText}>No alarm events found</Text>
              <Text style={styles.emptySub}>Try changing the filter or pull to refresh</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    elevation: 2,
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    position: 'relative',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  statCount: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 9, color: '#64748b', fontWeight: '600', textAlign: 'center', marginTop: 2 },
  activeIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
  },

  // Refresh text
  refreshText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
    paddingHorizontal: 14,
    paddingBottom: 4,
  },

  // Filter
  filterBar: { paddingHorizontal: 12, marginBottom: 6 },
  filterScroll: { gap: 8, paddingRight: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  filterChipTextActive: { color: '#FFF' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },

  // Count row
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 6,
    gap: 4,
  },
  countText: { fontSize: 12, fontWeight: '600', color: '#64748b', flex: 1 },
  clearFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#fee2e2',
    borderRadius: 10,
  },
  clearFilterText: { fontSize: 11, color: '#ef4444', fontWeight: '600' },

  // List
  listContent: { paddingHorizontal: 12, paddingBottom: 32 },

  // Card
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    overflow: 'hidden',
  },
  cardAccent: { width: 4, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  cardBody: { flex: 1, padding: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  alarmPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  alarmPillText: { fontSize: 11, fontWeight: '700', marginLeft: 4 },
  cardTime: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },

  deviceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 5 },
  deviceName: { fontSize: 13, fontWeight: '700', color: '#1e293b', flex: 1 },
  idBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  idText: { fontSize: 10, color: '#64748b', fontWeight: '600' },

  addressRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 4 },
  addressText: { flex: 1, fontSize: 11.5, color: '#334155', lineHeight: 16 },
  addressPlaceholder: { flex: 1, fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' },

  // Telemetry
  telemetryRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  telBox: { flex: 1, alignItems: 'center', gap: 2 },
  telLabel: { fontSize: 9, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },
  telValue: { fontSize: 11, fontWeight: '700', color: '#475569' },

  // Empty / loading
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748b' },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#334155', marginTop: 16 },
  emptySub: { fontSize: 12, color: '#94a3b8', marginTop: 6 },
});

export default AlarmDashboardScreen;