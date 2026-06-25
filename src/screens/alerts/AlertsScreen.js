// AlertsScreen.js
// Fixed: race condition, retry logic, stable keys, stale closure in delete

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  RefreshControl, TouchableOpacity, StatusBar, Modal, TextInput,
  ScrollView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';
import Header from '../../components/Header';
import { fetchAlarms, fetchCustomEvents, fetchDeviceList } from '../../api/webApi';
import AlertNotificationService from '../../services/AlertNotificationService';

// ─── Cache keys ───────────────────────────────────────────────────────────────
const CACHE = {
  ALERTS: 'cached_alerts_data',
  DELETED: 'cached_deleted_alerts',
  READ: 'cached_read_alerts',
  NAMES: 'cached_device_names',
  LAST_SYNC: 'alerts_last_sync_ts',
};

// ─── Alert type mapping ───────────────────────────────────────────────────────
const ALERT_MAPPING = {
  powerCut: 'Power Cut Detected',
  lowBattery: 'Low Battery Alert',
  vibration: 'Vibration Detected',
  ignitionOn: 'DG ON',
  ignitionOff: 'DG OFF',
  deviceMoving: 'DG Moving',
  deviceStopped: 'DG Stopped',
};

const getAlertConfig = (type = '') => {
  const t = type.toLowerCase();
  if (t.includes('ignitionon')) return { icon: 'key-variant', color: '#00C853', bg: 'rgba(0,200,83,0.15)' };
  if (t.includes('ignitionoff')) return { icon: 'key-remove', color: '#D50000', bg: 'rgba(213,0,0,0.15)' };
  if (t.includes('power')) return { icon: 'power-plug-off', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
  if (t.includes('battery')) return { icon: 'battery-alert', color: '#eab308', bg: 'rgba(234,179,8,0.15)' };
  if (t.includes('vibration')) return { icon: 'vibrate', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' };
  if (t.includes('moving')) return { icon: 'car-speed-limiter', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
  if (t.includes('stopped')) return { icon: 'car-brake-hold', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' };
  return { icon: 'bell-ring', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' };
};

const TYPE_OPTIONS = [
  { key: 'ignitionOn', label: 'DG ON', icon: 'key-variant', color: '#00C853' },
  { key: 'ignitionOff', label: 'DG OFF', icon: 'key-remove', color: '#ef4444' },
  { key: 'deviceMoving', label: 'DG Moving', icon: 'car-speed-limiter', color: '#10b981' },
  { key: 'deviceStopped', label: 'DG Stopped', icon: 'car-brake-hold', color: '#3b82f6' },
];

const ALARM_OPTIONS = [
  { key: 'powerCut', label: 'Power Cut', icon: 'power-plug-off', color: '#ef4444' },
  { key: 'lowBattery', label: 'Low Battery', icon: 'battery-alert', color: '#eab308' },
  { key: 'vibration', label: 'Vibration', icon: 'vibrate', color: '#a855f7' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getStableKey = (a) => {
  // Already normalized key
  const existing = String(a.id || '');
  if (existing.startsWith('al_') || existing.startsWith('ev_')) return existing;

  // Build from raw fields
  const idStr = a.event_id ? `ev_${a.event_id}` : (a.id ? `al_${a.id}` : '');
  const type = (a.type || '').split(',')[0].trim();
  const device = String(a.deviceId ?? a.deviceid ?? '');
  const time = a.eventtime || a.event_time || a.serverTime || a.server_time
    || a.created_at || a.time || a.timestamp || '';
  return idStr || `${type}_${device}_${time}`;
};

const getTime = (a) =>
  a.eventtime || a.event_time || a.serverTime || a.server_time
  || a.created_at || a.time || a.timestamp || '';

const deduplicateAlerts = (list) => {
  const seen = new Set();
  return list.filter(a => {
    const key = getStableKey(a);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeAlarmType = (a) => {
  const rawType = String(a.type || '').trim().toLowerCase();
  const rawAttr = String(a.attributes?.alarm || '').trim().toLowerCase();
  const alarmField = String(a.alarm || a.attributes?.alarm || '').toLowerCase();
  const alarmTypes = alarmField.split(',').map(s => s.trim());
  const batRaw = a.attributes?.batteryLevel ?? a.attributes?.battery ?? a.battery_level;
  const batVal = batRaw != null ? parseFloat(batRaw) : null;

  if (rawType.includes('powercut') || rawAttr.includes('powercut') || alarmTypes.includes('powercut')) return 'powerCut';
  if (rawType.includes('lowbattery') || rawAttr.includes('lowbattery') || alarmTypes.includes('lowbattery')
    || (batVal !== null && batVal >= 0 && batVal <= 15)) return 'lowBattery';
  if (rawType.includes('vibration') || rawAttr.includes('vibration') || alarmTypes.includes('vibration')) return 'vibration';
  return a.type || 'alarm';
};

// ─── Async cache helpers ──────────────────────────────────────────────────────
const getJSON = async (key) => {
  try { const r = await AsyncStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
};
const setJSON = async (key, val) => {
  try { await AsyncStorage.setItem(key, JSON.stringify(val)); } catch { }
};
const loadDeletedSet = async () => {
  const arr = await getJSON(CACHE.DELETED);
  return new Set(Array.isArray(arr) ? arr.map(String) : []);
};
const saveDeletedSet = async (set) => setJSON(CACHE.DELETED, Array.from(set));

// ─── Retry wrapper for flaky network calls ────────────────────────────────────
const withRetry = async (fn, retries = 3, delayMs = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === retries - 1;
      if (isLast) throw err;
      // Exponential back-off: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)));
    }
  }
};

// ─── Normalise raw API → our shape ───────────────────────────────────────────
const normaliseAlarms = (raw) =>
  raw.map(a => {
    const type = normalizeAlarmType(a);
    const timeVal = a.eventtime || a.serverTime || a.created_at || a.time || a.timestamp || '';
    const deviceId = a.deviceId || a.deviceid || a.device_id;
    const id = a.id ? `al_${a.id}` : `al_${type}_${deviceId}_${timeVal}`;
    return {
      id, type, eventtime: timeVal, deviceId, address: a.address || '',
      latitude: parseFloat(a.latitude || a.lat || a.attributes?.latitude || 0) || 0,
      longitude: parseFloat(a.longitude || a.lon || a.attributes?.longitude || 0) || 0,
      original: a,
    };
  });

const normaliseCustom = (raw) =>
  raw.map(e => {
    const lower = String(e.event_type || e.type || '').toLowerCase();
    const cleanKey = lower.replace(/[\s_]/g, '');
    let type = e.event_type || e.type || '';
    if (cleanKey.includes('ignitionon')) type = 'ignitionOn';
    else if (cleanKey.includes('ignitionoff')) type = 'ignitionOff';
    else if (cleanKey.includes('devicemoving') || cleanKey.includes('moving')) type = 'deviceMoving';
    else if (cleanKey.includes('devicestopped') || cleanKey.includes('stopped')) type = 'deviceStopped';

    const timeVal = e.event_time || e.eventtime || e.serverTime || e.created_at || e.time || e.timestamp || '';
    const deviceId = e.deviceid || e.deviceId || e.device_id;
    const id = (e.event_id || e.id) ? `ev_${String(e.event_id || e.id)}` : `ev_${type}_${deviceId}_${timeVal}`;
    return {
      id, type, eventtime: timeVal, deviceId, address: e.address || '',
      latitude: parseFloat(e.latitude || e.lat) || 0,
      longitude: parseFloat(e.longitude || e.lon) || 0,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
const AlertsScreen = ({ navigation }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceNames, setDeviceNames] = useState({});
  const [showFilter, setShowFilter] = useState(false);
  const [syncError, setSyncError] = useState(null);   // surface network errors to UI

  const [pendingDeviceQ, setPendingDeviceQ] = useState('');
  const [pendingTypes, setPendingTypes] = useState([]);
  const [pendingAlarms, setPendingAlarms] = useState([]);
  const [pendingReadStatus, setPendingReadStatus] = useState('all');

  const [appliedDeviceQ, setAppliedDeviceQ] = useState('');
  const [appliedTypes, setAppliedTypes] = useState([]);
  const [appliedAlarms, setAppliedAlarms] = useState([]);
  const [appliedReadStatus, setAppliedReadStatus] = useState('all');

  const [readKeys, setReadKeys] = useState(new Set());
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  // ── FIX: keep a ref to current alerts so delete closure is never stale ──────
  const alertsRef = useRef([]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const activeFilterCount =
    appliedTypes.length + appliedAlarms.length +
    (appliedDeviceQ.trim() ? 1 : 0) +
    (appliedReadStatus !== 'all' ? 1 : 0);

  // ── Filter helpers ────────────────────────────────────────────────────────
  const toggleType = (key) => setPendingTypes(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key]);
  const toggleAlarm = (key) => setPendingAlarms(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key]);

  const openFilter = () => {
    setPendingDeviceQ(appliedDeviceQ);
    setPendingTypes([...appliedTypes]);
    setPendingAlarms([...appliedAlarms]);
    setPendingReadStatus(appliedReadStatus);
    setShowFilter(true);
  };
  const applyFilter = () => {
    setAppliedDeviceQ(pendingDeviceQ);
    setAppliedTypes([...pendingTypes]);
    setAppliedAlarms([...pendingAlarms]);
    setAppliedReadStatus(pendingReadStatus);
    setShowFilter(false);
  };
  const clearPending = () => { setPendingDeviceQ(''); setPendingTypes([]); setPendingAlarms([]); setPendingReadStatus('all'); };
  const clearApplied = () => { setAppliedDeviceQ(''); setAppliedTypes([]); setAppliedAlarms([]); setAppliedReadStatus('all'); };

  // ── Mark read ─────────────────────────────────────────────────────────────
  const markAsRead = (key) => {
    setReadKeys(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      setJSON(CACHE.READ, Array.from(next));
      return next;
    });
  };

  // ── Delete helpers ────────────────────────────────────────────────────────
  /**
   * FIX: uses alertsRef instead of closed-over `alerts` state → always fresh.
   */
  const permanentlyDelete = useCallback(async (keysToDelete) => {
    // 1. Remove from state using ref for freshness
    const next = alertsRef.current.filter(a => !keysToDelete.has(getStableKey(a)));
    setAlerts(next);
    setJSON(CACHE.ALERTS, next);

    // 2. Persist deleted IDs
    const existing = await loadDeletedSet();
    keysToDelete.forEach(k => existing.add(k));
    await saveDeletedSet(existing);
  }, []); // no deps needed — uses ref

  const handleDeleteAll = () => {
    if (filteredAlerts.length === 0) return;
    Alert.alert(
      'Delete All Alerts',
      `Are you sure you want to delete all ${filteredAlerts.length} alerts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: () => {
            const keys = new Set(filteredAlerts.map(a => getStableKey(a)));
            permanentlyDelete(keys);
            setSelectedKeys(new Set());
          },
        },
      ],
    );
  };

  const handleBulkDelete = () => {
    if (selectedKeys.size === 0) return;
    Alert.alert(
      'Delete Alerts',
      `Are you sure you want to delete ${selectedKeys.size} selected alert(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => { permanentlyDelete(new Set(selectedKeys)); setSelectedKeys(new Set()); },
        },
      ],
    );
  };

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredAlerts = useMemo(() => {
    const allowedDeviceIds = new Set([
      ...Object.keys(deviceNames),
      ...Object.keys(AlertNotificationService.deviceMap || {}),
    ].map(String));

    let list = alerts.filter(a => {
      const id = a.deviceid || a.deviceId;
      return id != null && allowedDeviceIds.has(String(id));
    });

    if (appliedReadStatus === 'read') list = list.filter(a => readKeys.has(getStableKey(a)));
    if (appliedReadStatus === 'unread') list = list.filter(a => !readKeys.has(getStableKey(a)));

    if (appliedDeviceQ.trim()) {
      const q = appliedDeviceQ.trim().toLowerCase();
      list = list.filter(a => {
        const id = a.deviceid || a.deviceId;
        const name = deviceNames[id] || a.device_name || `Vehicle #${id}`;
        return name.toLowerCase().includes(q) || String(id).includes(q);
      });
    }

    const allSelected = [...appliedTypes, ...appliedAlarms];
    if (allSelected.length > 0) {
      list = list.filter(a => {
        const clean = (a.type || '').split(',')[0].trim().toLowerCase();
        return allSelected.some(sel =>
          clean === sel.toLowerCase() ||
          (a.attributes?.alarm && a.attributes.alarm.toLowerCase() === sel.toLowerCase()),
        );
      });
    }

    return list;
  }, [alerts, appliedDeviceQ, appliedTypes, appliedAlarms, appliedReadStatus, readKeys, deviceNames]);

  // ── Core data load ────────────────────────────────────────────────────────
  /**
   * FIX: syncInProgress guard prevents overlapping calls from racing each other.
   * FIX: withRetry wraps every network call — no more single-failure blanks.
   * FIX: setAlerts called ONCE at the end of merge, not in parallel with cache load.
   */
  const syncInProgress = useRef(false);

  const loadData = useCallback(async (isRefresh = false) => {
    // Guard: don't run two syncs at the same time
    if (syncInProgress.current) return;
    syncInProgress.current = true;

    if (isRefresh) setRefreshing(true);
    setSyncError(null);

    const todayStart = moment().startOf('day').valueOf();
    const todayEnd = moment().endOf('day').valueOf();
    const isToday = (a) => { const t = moment(getTime(a)).valueOf(); return t >= todayStart && t <= todayEnd; };

    // ── Step 1: Instant cache render (first load only) ────────────────────
    const deletedSet = await loadDeletedSet();
    const notDeleted = (a) => !deletedSet.has(getStableKey(a));

    if (!isRefresh) {
      const [cachedReads, cachedNames, cached] = await Promise.all([
        getJSON(CACHE.READ),
        getJSON(CACHE.NAMES),
        getJSON(CACHE.ALERTS),
      ]);
      if (cachedReads) setReadKeys(new Set(cachedReads));
      if (cachedNames) {
        setDeviceNames(cachedNames);
        Object.assign(AlertNotificationService.deviceMap, cachedNames);
      }
      if (Array.isArray(cached) && cached.length > 0) {
        const visible = deduplicateAlerts(cached.filter(a => isToday(a) && notDeleted(a)));
        setAlerts(visible);
        alertsRef.current = visible;
        setLoading(false);
      }
    }

    // ── Step 2: Fetch device list (with retry) ────────────────────────────
    let myDeviceIds = new Set(Object.keys(AlertNotificationService.deviceMap).map(String));
    try {
      const devData = await withRetry(() => fetchDeviceList());
      const myDevs = Array.isArray(devData) ? devData : (devData?.devices || []);
      const names = {};
      myDevs.forEach(d => { if (d.id != null) names[d.id] = d.name || `Device ${d.id}`; });
      setDeviceNames(names);
      Object.assign(AlertNotificationService.deviceMap, names);
      myDeviceIds = new Set(Object.keys(names).map(String));
      setJSON(CACHE.NAMES, names);
    } catch (err) {
      console.warn('[AlertsScreen] fetchDeviceList failed after retries:', err?.message);
      // Non-fatal — continue with whatever device IDs we already have
      myDeviceIds = new Set(Object.keys(AlertNotificationService.deviceMap).map(String));
    }

    // ── Step 3: Fetch alerts & events (with retry) ────────────────────────
    try {
      const [alarmsRaw, customRaw] = await Promise.all([
        withRetry(() => fetchAlarms()).catch(e => { console.warn('[AlertsScreen] fetchAlarms failed:', e?.message); return []; }),
        withRetry(() => fetchCustomEvents()).catch(e => { console.warn('[AlertsScreen] fetchCustomEvents failed:', e?.message); return []; }),
      ]);

      const alarmsList = Array.isArray(alarmsRaw) ? alarmsRaw : (alarmsRaw?.data || []);
      const customList = Array.isArray(customRaw) ? customRaw : (customRaw?.data || []);

      const serverItems = deduplicateAlerts([
        ...normaliseAlarms(alarmsList).filter(a => myDeviceIds.has(String(a.deviceId))),
        ...normaliseCustom(customList).filter(a => myDeviceIds.has(String(a.deviceId))),
      ]);

      const serverKeySet = new Set(serverItems.map(a => getStableKey(a)));

      // ── Step 4: Incremental merge ──────────────────────────────────────
      const currentCached = (await getJSON(CACHE.ALERTS)) || [];
      const currentMap = new Map(currentCached.map(a => [getStableKey(a), a]));
      const freshDeletedSet = await loadDeletedSet();

      // Upsert server items (skip user-deleted)
      serverItems.forEach(item => {
        const key = getStableKey(item);
        if (!freshDeletedSet.has(key)) currentMap.set(key, item);
      });

      // Remove server-deleted items (not user-deleted)
      currentMap.forEach((_, key) => {
        const isServerItem = key.startsWith('al_') || key.startsWith('ev_');
        if (isServerItem && !serverKeySet.has(key) && !freshDeletedSet.has(key)) {
          currentMap.delete(key);
        }
      });

      let merged = Array.from(currentMap.values())
        .filter(a => isToday(a) && !freshDeletedSet.has(getStableKey(a)));

      merged = deduplicateAlerts(merged);
      merged.sort((a, b) => (moment(getTime(b)).valueOf() || 0) - (moment(getTime(a)).valueOf() || 0));
      merged = merged.slice(0, 500);

      await setJSON(CACHE.ALERTS, merged);
      // ── FIX: single setAlerts call at the very end — no mid-sync flicker ──
      setAlerts(merged);
      alertsRef.current = merged;
      await AsyncStorage.setItem(CACHE.LAST_SYNC, new Date().toISOString());
    } catch (err) {
      console.warn('[AlertsScreen] Sync failed:', err);
      setSyncError('Could not refresh alerts. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      syncInProgress.current = false;
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Render item ───────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const cleanType = (item.type || '').split(',')[0].trim();
    const typeParts = (item.type || '').split(',').map(p => p.trim()).filter(Boolean);
    const displayName = typeParts.map(t => ALERT_MAPPING[t] || t).join(', ') || 'Unknown Alert';
    const config = getAlertConfig(cleanType);
    const ts = item.eventtime || item.serverTime;
    const timeStr = ts ? moment(ts).format('hh:mm A') : '--';
    const dateStr = ts ? moment(ts).format('MMM DD, YYYY') : '--';
    const id = item.deviceid || item.deviceId;
    const deviceName = deviceNames[id] || item.device_name || `Vehicle #${id}`;
    const key = getStableKey(item);
    const isRead = readKeys.has(key);
    const isSelected = selectedKeys.has(key);

    return (
      <TouchableOpacity
        style={[styles.card, isRead && { opacity: 0.7, backgroundColor: '#0f172a' }]}
        activeOpacity={0.85}
        onPress={() => { markAsRead(key); navigation.navigate('AlertDetails', { alert: item }); }}
      >
        <TouchableOpacity
          style={{ paddingRight: 10, justifyContent: 'center' }}
          onPress={() => {
            const next = new Set(selectedKeys);
            if (isSelected) next.delete(key); else next.add(key);
            setSelectedKeys(next);
          }}
          hitSlop={{ top: 15, bottom: 15, left: 10, right: 10 }}
        >
          <Icon
            name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={isSelected ? '#38bdf8' : '#4b5563'}
          />
        </TouchableOpacity>

        <View style={[styles.iconWrap, { backgroundColor: config.bg }]}>
          <Icon name={config.icon} size={24} color={config.color} />
        </View>

        <View style={styles.cardContent}>
          <Text style={[styles.alertName, !isRead && { fontWeight: '800', color: '#f8fafc' }]}>{displayName}</Text>
          <Text style={[styles.deviceText, !isRead && { fontWeight: '600', color: '#e2e8f0' }]}>{deviceName}</Text>
          <View style={styles.timeBadge}>
            <Icon name="clock-outline" size={12} color="#94a3b8" style={{ marginRight: 4 }} />
            <Text style={styles.timeText}>{dateStr} at {timeStr}</Text>
          </View>
        </View>

        {!isRead && (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#38bdf8', alignSelf: 'center', marginLeft: 8 }} />
        )}
      </TouchableOpacity>
    );
  };

  const Chip = ({ item, selected, onToggle }) => (
    <TouchableOpacity
      style={[styles.chip, selected && { backgroundColor: item.color + '22', borderColor: item.color }]}
      onPress={() => onToggle(item.key)}
      activeOpacity={0.75}
    >
      <Icon name={item.icon} size={15} color={selected ? item.color : '#64748b'} />
      <Text style={[styles.chipText, selected && { color: item.color }]}>{item.label}</Text>
      {selected && <Icon name="check-circle" size={14} color={item.color} />}
    </TouchableOpacity>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <Header title="Security Alerts" navigation={navigation} />

      {/* Network error banner */}
      {syncError && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => loadData(true)} activeOpacity={0.8}>
          <Icon name="wifi-off" size={14} color="#fbbf24" style={{ marginRight: 6 }} />
          <Text style={styles.errorBannerText}>{syncError}</Text>
          <Icon name="refresh" size={14} color="#fbbf24" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
      )}

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <TouchableOpacity style={styles.filterBtn} onPress={openFilter} activeOpacity={0.8}>
          <Icon name="filter-variant" size={18} color={activeFilterCount > 0 ? '#22c55e' : '#94a3b8'} />
          <Text style={[styles.filterBtnText, activeFilterCount > 0 && { color: '#22c55e' }]}>
            {'  '}Filter{activeFilterCount > 0 ? `  (${activeFilterCount})` : ''}
          </Text>
          <Icon name="menu-down" size={20} color="#64748b" />
        </TouchableOpacity>

        {activeFilterCount > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginLeft: 8 }}>
            {appliedDeviceQ ? (
              <View style={styles.appliedChip}>
                <Icon name="magnify" size={12} color="#38bdf8" />
                <Text style={styles.appliedChipText}>{appliedDeviceQ}</Text>
              </View>
            ) : null}
            {[...appliedTypes, ...appliedAlarms].map(key => {
              const opt = [...TYPE_OPTIONS, ...ALARM_OPTIONS].find(o => o.key === key);
              return opt ? (
                <View key={key} style={[styles.appliedChip, { borderColor: opt.color + '66' }]}>
                  <Icon name={opt.icon} size={12} color={opt.color} />
                  <Text style={[styles.appliedChipText, { color: opt.color }]}>{opt.label}</Text>
                </View>
              ) : null;
            })}
            {appliedReadStatus !== 'all' && (
              <View style={[styles.appliedChip, { borderColor: '#38bdf866' }]}>
                <Icon name={appliedReadStatus === 'read' ? 'email-open' : 'email'} size={12} color="#38bdf8" />
                <Text style={[styles.appliedChipText, { color: '#38bdf8' }]}>
                  {appliedReadStatus === 'read' ? 'Read' : 'Unread'}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.clearChip} onPress={clearApplied}>
              <Icon name="close" size={12} color="#ef4444" />
              <Text style={styles.clearChipText}>Clear</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* Count row */}
      <View style={styles.countRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.countText}>
            {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''}
            {activeFilterCount > 0 ? ' (filtered)' : ' total'}
          </Text>
          {filteredAlerts.length > 0 && (
            <TouchableOpacity
              style={{ marginLeft: 12, flexDirection: 'row', alignItems: 'center' }}
              onPress={() => {
                if (selectedKeys.size === filteredAlerts.length) setSelectedKeys(new Set());
                else setSelectedKeys(new Set(filteredAlerts.map(a => getStableKey(a))));
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon
                name={selectedKeys.size === filteredAlerts.length && filteredAlerts.length > 0
                  ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={16} color="#38bdf8"
              />
              <Text style={{ marginLeft: 4, color: '#38bdf8', fontSize: 12, fontWeight: '600' }}>All</Text>
            </TouchableOpacity>
          )}
        </View>
        {selectedKeys.size > 0 ? (
          <TouchableOpacity style={styles.bulkDeleteBtn} onPress={handleBulkDelete}>
            <Icon name="trash-can-outline" size={16} color="#fff" />
            <Text style={styles.bulkDeleteText}>
              {selectedKeys.size === filteredAlerts.length
                ? `Delete All (${selectedKeys.size})`
                : `Delete (${selectedKeys.size})`}
            </Text>
          </TouchableOpacity>
        ) : (
          filteredAlerts.length > 0 && (
            <TouchableOpacity
              style={[styles.bulkDeleteBtn, { backgroundColor: '#334155' }]}
              onPress={handleDeleteAll}
            >
              <Icon name="trash-can-outline" size={16} color="#ef4444" />
              <Text style={[styles.bulkDeleteText, { color: '#ef4444' }]}>Delete All</Text>
            </TouchableOpacity>
          )
        )}
      </View>

      {/* Filter modal */}
      <Modal transparent animationType="slide" visible={showFilter} onRequestClose={() => setShowFilter(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowFilter(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filter Alerts</Text>
            <TouchableOpacity onPress={clearPending}><Text style={styles.clearAllText}>Clear All</Text></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.sectionLabel}>DEVICE SEARCH</Text>
            <View style={styles.searchBox}>
              <Icon name="magnify" size={18} color="#64748b" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="DG Name"
                placeholderTextColor="#475569"
                value={pendingDeviceQ}
                onChangeText={setPendingDeviceQ}
                returnKeyType="done"
              />
              {pendingDeviceQ.length > 0 && (
                <TouchableOpacity onPress={() => setPendingDeviceQ('')}>
                  <Icon name="close-circle" size={18} color="#475569" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>EVENT TYPE</Text>
              {pendingTypes.length > 0 && (
                <View style={styles.selBadge}><Text style={styles.selBadgeText}>{pendingTypes.length} selected</Text></View>
              )}
            </View>
            <View style={styles.chipGrid}>
              {TYPE_OPTIONS.map(item => (
                <Chip key={item.key} item={item} selected={pendingTypes.includes(item.key)} onToggle={toggleType} />
              ))}
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>ALARMS</Text>
              {pendingAlarms.length > 0 && (
                <View style={styles.selBadge}><Text style={styles.selBadgeText}>{pendingAlarms.length} selected</Text></View>
              )}
            </View>
            <View style={styles.chipGrid}>
              {ALARM_OPTIONS.map(item => (
                <Chip key={item.key} item={item} selected={pendingAlarms.includes(item.key)} onToggle={toggleAlarm} />
              ))}
            </View>

            <View style={styles.sectionRow}><Text style={styles.sectionLabel}>READ STATUS</Text></View>
            <View style={styles.chipGrid}>
              {[{ val: 'all', label: 'All' }, { val: 'unread', label: 'Unread' }, { val: 'read', label: 'Read' }].map(({ val, label }) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.chip, pendingReadStatus === val && { backgroundColor: '#38bdf822', borderColor: '#38bdf8' }]}
                  onPress={() => setPendingReadStatus(val)}
                >
                  <Text style={[styles.chipText, pendingReadStatus === val && { color: '#38bdf8' }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.applyRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowFilter(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={applyFilter}>
              <Icon name="check" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.applyText}>
                Apply{pendingTypes.length + pendingAlarms.length + (pendingDeviceQ.trim() ? 1 : 0) > 0
                  ? `  (${pendingTypes.length + pendingAlarms.length + (pendingDeviceQ.trim() ? 1 : 0)})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#38bdf8" />
        </View>
      ) : (
        <FlatList
          data={filteredAlerts}
          keyExtractor={(item) => getStableKey(item)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={['#38bdf8']}
              tintColor="#38bdf8"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="bell-off-outline" size={54} color="#475569" />
              <Text style={styles.emptyText}>
                {activeFilterCount > 0 ? 'No alerts match your filter' : 'No alerts found for today'}
              </Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity style={styles.clearFilterBtn} onPress={clearApplied}>
                  <Text style={styles.clearFilterText}>Clear Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={7}
        />
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  listContent: { padding: 16, paddingBottom: 40 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(251,191,36,0.12)', borderBottomWidth: 1, borderBottomColor: '#fbbf2433', paddingVertical: 8, paddingHorizontal: 16 },
  errorBannerText: { color: '#fbbf24', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 4 },
  countText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  bulkDeleteBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, gap: 4 },
  bulkDeleteText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  iconWrap: { justifyContent: 'center', alignItems: 'center', marginRight: 14, width: 48, height: 48, borderRadius: 14 },
  cardContent: { flex: 1 },
  alertName: { fontSize: 15, fontWeight: '700', color: '#f8fafc', marginBottom: 3 },
  deviceText: { fontSize: 13, color: '#94a3b8', fontWeight: '500', marginBottom: 6 },
  timeBadge: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  emptyText: { marginTop: 14, fontSize: 15, color: '#64748b', fontWeight: '600', textAlign: 'center' },
  clearFilterBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  clearFilterText: { color: '#38bdf8', fontSize: 13, fontWeight: '600' },
  filterBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  filterBtnText: { color: '#94a3b8', fontWeight: '600', fontSize: 13 },
  appliedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  appliedChipText: { fontSize: 12, color: '#38bdf8', fontWeight: '600' },
  clearChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: '#ef444466', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  clearChipText: { fontSize: 12, color: '#ef4444', fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 36, maxHeight: '75%', position: 'absolute', bottom: 0, left: 0, right: 0 },
  handle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 10 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  clearAllText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  sectionLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 16, marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 10 },
  selBadge: { backgroundColor: '#22c55e22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: '#22c55e55' },
  selBadgeText: { color: '#22c55e', fontSize: 11, fontWeight: '700' },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  searchInput: { flex: 1, color: '#f8fafc', fontSize: 14, padding: 0 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: '#334155', backgroundColor: '#0f172a' },
  chipText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  applyRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' },
  cancelText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  applyBtn: { flex: 2, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#22c55e', paddingVertical: 14, borderRadius: 14 },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export default AlertsScreen;