import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, Dimensions, RefreshControl } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DatePicker from '../../components/CalendarPickerModal';
import { fetchDgDailySummary, fetchDgStatusLogs } from '../../api/webApi';
import moment from 'moment';

const { width } = Dimensions.get('window');

const SummaryCard = ({ icon, title, value, color, onPress }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={onPress ? 0.7 : 1} style={styles.summaryCard}>
    <View style={[styles.summaryCardIcon, { backgroundColor: `${color}15` }]}>
      <Icon name={icon} size={20} color={color} />
    </View>
    <View style={styles.summaryCardContent}>
      <Text style={styles.summaryCardTitle}>{title}</Text>
      <Text style={styles.summaryCardValue}>{value}</Text>
    </View>
  </TouchableOpacity>
);

const LegendItem = ({ color, label, value, onPress }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={onPress ? 0.7 : 1} style={styles.legendItem}>
    <View style={[styles.legendColor, { backgroundColor: color }]} />
    <View>
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  </TouchableOpacity>
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

const calculatePct = (timeStr, totalSec) => {
  if (!timeStr || !totalSec) return 0;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return 0;
  const sec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + (parts[2] ? parseInt(parts[2], 10) : 0);
  return Math.round((sec / totalSec) * 100);
};

const formatTime = (timeStr) => {
  if (!timeStr) return '00:00:00';
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return '00:00:00';
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return `${d}d ${String(remH).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatDurationMs = (ms) => {
  if (!ms) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const timeToSeconds = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + (parts[2] ? parseInt(parts[2], 10) : 0);
};

const DailySummaryDetails = ({ onBack, deviceName, deviceId, initialDate, onOpenPlayback, onGoToDgReport }) => {
  const [summarySubTab, setSummarySubTab] = useState('Summary');
  const [loading, setLoading] = useState(true);
  const [apiData, setApiData] = useState(null);

  const [currentDate, setCurrentDate] = useState(() => initialDate ? new Date(initialDate) : moment().subtract(1, 'days').toDate());
  const [showPicker, setShowPicker] = useState(false);

  const [tabDataCache, setTabDataCache] = useState({});
  const [tabLoading, setTabLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Clear cache when date or device changes
  useEffect(() => {
    setTabDataCache({});
  }, [currentDate, deviceId]);

  const abortControllerRef = useRef(null);

  const loadSummaryData = useCallback(async (signal) => {
    setLoading(true);
    const dateToFetch = moment(currentDate).format('YYYY-MM-DD');
    try {
      const data = await fetchDgDailySummary(deviceId, dateToFetch, dateToFetch, { signal });
      if (signal?.aborted) return;

      let result = null;
      if (data && typeof data === 'object') {
        if (Array.isArray(data.data) && data.data.length > 0) {
          result = data.data[0];
        } else if (Array.isArray(data) && data.length > 0) {
          result = data[0];
        } else if (!Array.isArray(data)) {
          const vals = Object.values(data).filter(v => v && typeof v === 'object' && !Array.isArray(v));
          result = vals.length > 0 ? vals[0] : null;
        }
      }
      setApiData(result);
    } catch (err) {
      if (!signal?.aborted) {
        setApiData(null);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [currentDate, deviceId]);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    loadSummaryData(abortControllerRef.current.signal);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadSummaryData]);

  const loadTabData = async (force = false) => {
    if (summarySubTab === 'Summary') return;

    // If not forcing refresh and we already have data for this tab, do nothing
    if (!force && tabDataCache[summarySubTab]) return;

    if (!force) setTabLoading(true);
    const dateStr = moment(currentDate).format('YYYY-MM-DD');
    try {
      let res = [];
      switch (summarySubTab) {
        case 'Timeline':
          const logsResp = await fetchDgStatusLogs({ device_id: deviceId, start_date: dateStr, end_date: dateStr });
          res = Array.isArray(logsResp) ? logsResp : [];
          break;
      }
      const newData = Array.isArray(res) ? res : res?.data || res?.results || [];
      setTabDataCache(prev => ({ ...prev, [summarySubTab]: newData }));
    } catch (e) {
      console.warn('Error loading tab:', e);
    }
    if (!force) setTabLoading(false);
  };

  useEffect(() => {
    loadTabData();
  }, [summarySubTab, currentDate, deviceId]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (summarySubTab === 'Summary') {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      await loadSummaryData(abortControllerRef.current.signal);
    } else {
      await loadTabData(true);
    }
    setRefreshing(false);
  };

  const runSec = timeToSeconds(apiData?.total_dg_move);
  const idleSec = timeToSeconds(apiData?.total_dg_idle);
  const stopSec = timeToSeconds(apiData?.total_dg_stop);
  const totalSec = runSec + idleSec + stopSec || 1; // avoid div by 0

  const runningPct = Math.round((runSec / totalSec) * 100) || 0;
  const idlePct = Math.round((idleSec / totalSec) * 100) || 0;
  const stopPct = Math.round((stopSec / totalSec) * 100) || 0;

  const onSec = timeToSeconds(apiData?.total_dg_on);
  const offSec = timeToSeconds(apiData?.total_dg_off);
  const totalDgSec = onSec + offSec || 1;
  const onPct = Math.round((onSec / totalDgSec) * 100) || 0;
  const offPct = Math.round((offSec / totalDgSec) * 100) || 0;

  return (
    <View style={styles.container}>
      {/* Separate Page Header */}
      <View style={styles.summaryPageHeader}>
        <TouchableOpacity onPress={onBack} style={{ padding: 8, marginLeft: -8 }}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.summaryPageTitle}>{moment(currentDate).format('DD/MM/YYYY')}</Text>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={{ padding: 8, marginRight: -8 }}>
          <Icon name="calendar-month" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <DatePicker
        modal
        open={showPicker}
        date={currentDate}
        mode="date"
        minimumDate={moment().subtract(30, 'days').toDate()}
        maximumDate={new Date()}
        onConfirm={(date) => {
          setShowPicker(false);
          setCurrentDate(date);
        }}
        onCancel={() => setShowPicker(false)}
      />

      {/* Sub-Tabs */}
      <View style={styles.subTabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['Summary', 'Timeline'].map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.subTabBtn, summarySubTab === tab && styles.subTabBtnActive]}
              onPress={() => setSummarySubTab(tab)}
            >
              <Text style={[styles.subTabText, summarySubTab === tab && styles.subTabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Sub-Tab Content */}
      <ScrollView
        style={styles.subTabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1565C0']} />}
      >
        {loading && !refreshing && summarySubTab === 'Summary' ? (
          <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 40 }} />
        ) : summarySubTab === 'Summary' && apiData ? (
          <View style={{ padding: 16 }}>
            <View style={styles.summaryGrid}>
              <SummaryCard icon="map-marker-distance" title="Distance" value={`${apiData?.total_dg_move_km || 0} km`} color="#1565C0" />
              <SummaryCard onPress={() => onGoToDgReport?.('MOVE', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} icon="timer-play" title="Move Time" value={formatTime(apiData?.total_dg_move)} color="#10b981" />
              <SummaryCard onPress={() => onGoToDgReport?.('IDLE', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} icon="timer-sand" title="Idle Time" value={formatTime(apiData?.total_dg_idle)} color="#f59e0b" />
              <SummaryCard onPress={() => onGoToDgReport?.('STOP', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} icon="stop-circle-outline" title="Stop Time" value={formatTime(apiData?.total_dg_stop)} color="#ef4444" />
              <SummaryCard onPress={() => onGoToDgReport?.('ON', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} icon="power" title="DG ON" value={formatTime(apiData?.total_dg_on)} color="#0ea5e9" />
              <SummaryCard onPress={() => onGoToDgReport?.('OFF', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} icon="power-off" title="DG OFF" value={formatTime(apiData?.total_dg_off)} color="#64748b" />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>DG Status Overview</Text>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressSegment, { backgroundColor: '#10b981', flex: onPct > 0 ? onPct : 1 }]} />
                <View style={[styles.progressSegment, { backgroundColor: '#ef4444', flex: offPct > 0 ? offPct : 1 }]} />
              </View>
              <View style={styles.legendContainer}>
                <LegendItem onPress={() => onGoToDgReport?.('ON', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} color="#10b981" label="ON" value={`${onPct}% (${formatTime(apiData?.total_dg_on)})`} />
                <LegendItem onPress={() => onGoToDgReport?.('OFF', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} color="#ef4444" label="OFF" value={`${offPct}% (${formatTime(apiData?.total_dg_off)})`} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Motion Overview</Text>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressSegment, { backgroundColor: '#10b981', flex: runningPct > 0 ? runningPct : 1 }]} />
                <View style={[styles.progressSegment, { backgroundColor: '#f59e0b', flex: idlePct > 0 ? idlePct : 1 }]} />
                <View style={[styles.progressSegment, { backgroundColor: '#ef4444', flex: stopPct > 0 ? stopPct : 1 }]} />
              </View>
              <View style={styles.legendContainer}>
                <LegendItem onPress={() => onGoToDgReport?.('MOVE', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} color="#10b981" label="Move" value={`${runningPct}% (${formatTime(apiData?.total_dg_move)})`} />
                <LegendItem onPress={() => onGoToDgReport?.('IDLE', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} color="#f59e0b" label="Idle" value={`${idlePct}% (${formatTime(apiData?.total_dg_idle)})`} />
                <LegendItem onPress={() => onGoToDgReport?.('STOP', moment(currentDate).format('YYYY-MM-DD'), moment(currentDate).format('YYYY-MM-DD'))} color="#ef4444" label="Stop" value={`${stopPct}% (${formatTime(apiData?.total_dg_stop)})`} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Additional Info</Text>
              <View style={styles.addInfoGrid}>
                <AddInfoItem icon="car" label="DG Name" value={deviceName || apiData?.dg_name || 'Unknown'} />
                <AddInfoItem icon="barcode" label="GPS IMEI" value={apiData?.gps_imei || 'N/A'} />
                <AddInfoItem icon="calendar-check" label="Install Date" value={apiData?.gps_install_date ? moment(apiData.gps_install_date).format('DD/MM/YYYY') : 'N/A'} />
                <AddInfoItem icon="speedometer" label="Distance" value={`${apiData?.total_dg_move_km || 0} km`} />
                <AddInfoItem icon="lightning-bolt" label="Ext V Start" value={apiData?.start_adc1 != null ? `${parseFloat(apiData.start_adc1).toFixed(2)} V` : '0.00 V'} />
                <AddInfoItem icon="lightning-bolt" label="Ext V End" value={apiData?.end_adc1 != null ? `${parseFloat(apiData.end_adc1).toFixed(2)} V` : '0.00 V'} />
              </View>
            </View>
            <View style={{ height: 40 }} />
          </View>
        ) : summarySubTab === 'Summary' && !apiData ? (
          <View style={styles.emptyContent}>
            <Icon name="file-search-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyContentText}>No summary available for this date.</Text>
          </View>
        ) : tabLoading && !refreshing ? (
          <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 40 }} />
        ) : summarySubTab === 'Timeline' ? (
          <View style={{ padding: 16 }}>
            {!(tabDataCache['Timeline'] && tabDataCache['Timeline'].length > 0) ? (
              <View style={styles.emptyContent}>
                <Icon name="timeline-text-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyContentText}>No timeline data for this date.</Text>
              </View>
            ) : (
              tabDataCache['Timeline'].map((item, idx) => {
                const rawStatus = String(item.final_status || item.dg_status || item.status || '').trim().toUpperCase();

                let statusLabel = 'Stop';
                let bgColor = '#ef4444';
                let iconName = 'stop-circle';

                if (rawStatus.includes('OFF') || rawStatus === '0') {
                  statusLabel = 'DG OFF'; bgColor = '#ef4444'; iconName = 'power-plug-off';
                } else if (rawStatus.includes('MOVE') || rawStatus.includes('MOVING') || rawStatus.includes('MOTION')) {
                  statusLabel = 'Moved'; bgColor = '#0284c7'; iconName = 'truck-delivery-outline';
                } else if (rawStatus.includes('STOP') || rawStatus.includes('IDLE') || rawStatus.includes('PARK')) {
                  statusLabel = 'Stopped'; bgColor = '#f59e0b'; iconName = 'octagon-outline';
                } else if (rawStatus.includes('ON') || rawStatus === '1') {
                  statusLabel = 'DG ON'; bgColor = '#10b981'; iconName = 'lightning-bolt';
                }

                return (
                  <View key={idx} style={styles.timelineRow}>
                    <View style={styles.timelineLine} />
                    <View style={[styles.timelineIcon, { backgroundColor: bgColor }]}>
                      <Icon name={iconName} size={14} color="#fff" />
                    </View>
                    <View style={styles.timelineContent}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <Text style={styles.timelineTime}>{moment(item.start_time || item.position_time).format('HH:mm')}</Text>
                        {(() => {
                          let durationText = null;

                          if (item.total_duration_hms) {
                            durationText = formatTime(item.total_duration_hms);
                          } else if (item.duration_minutes) {
                            durationText = formatTime(item.duration_minutes.split('.')[0]);
                          } else {
                            let durMs = null;
                            if (item.duration) durMs = Number(item.duration);
                            else if (item.time_diff && typeof item.time_diff === 'string') durMs = timeToSeconds(item.time_diff) * 1000;
                            else if (item.end_time && (item.start_time || item.position_time)) durMs = moment(item.end_time).diff(moment(item.start_time || item.position_time));

                            if (durMs && durMs > 0) {
                              durationText = formatDurationMs(durMs);
                            }
                          }

                          if (durationText) {
                            return (
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Icon name="timer-outline" size={14} color="#64748b" style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '600' }}>{durationText}</Text>
                              </View>
                            );
                          }
                          return null;
                        })()}
                      </View>
                      <Text style={styles.timelineStatus}>{statusLabel}</Text>
                      <Text style={styles.timelineLocation}>{item.start_address || item.address || 'Unknown location'}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  summaryPageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e3a8a', padding: 16, paddingTop: 20 },
  summaryPageTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  subTabBar: { flexDirection: 'row', backgroundColor: '#1e3a8a', paddingBottom: 0 },
  subTabBtn: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  subTabBtnActive: { borderBottomColor: '#38bdf8' },
  subTabText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  subTabTextActive: { color: '#38bdf8', fontWeight: '700' },
  subTabContent: { backgroundColor: '#f8fafc', flex: 1 },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 8 },
  summaryCard: { width: '48%', backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', elevation: 1 },
  summaryCardIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  summaryCardContent: { flex: 1 },
  summaryCardTitle: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  summaryCardValue: { fontSize: 14, color: '#0f172a', fontWeight: '800' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 16, elevation: 1 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 16 },

  progressBarContainer: { height: 12, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', marginBottom: 16, backgroundColor: '#e2e8f0' },
  progressSegment: { height: '100%' },

  legendContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  legendColor: { width: 10, height: 10, borderRadius: 3, marginRight: 8, marginTop: 4 },
  legendLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  legendValue: { fontSize: 12, color: '#1e293b', fontWeight: '800' },

  startEndRow: { flexDirection: 'row', justifyContent: 'space-between' },
  startEndCol: { flex: 1, paddingRight: 8 },
  startEndHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  startEndLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginLeft: 4 },
  startEndTime: { fontSize: 14, color: '#0f172a', fontWeight: '800', marginBottom: 4 },
  startEndAddress: { fontSize: 11, color: '#475569', lineHeight: 16 },

  addInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  addInfoItem: { width: '48%', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  addInfoLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  addInfoValue: { fontSize: 12, color: '#1e293b', fontWeight: '800' },

  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  actionBtnText: { marginLeft: 6, fontSize: 12, fontWeight: '700', color: '#1565C0' },

  emptyContent: { alignItems: 'center', paddingVertical: 60 },
  emptyContentText: { color: '#94a3b8', fontSize: 15, fontWeight: '600', marginTop: 16 },

  timelineRow: { flexDirection: 'row', marginBottom: 20, position: 'relative' },
  timelineLine: { position: 'absolute', left: 11, top: 24, bottom: -20, width: 2, backgroundColor: '#e2e8f0' },
  timelineIcon: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  timelineContent: { flex: 1, marginLeft: 16, backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', elevation: 1 },
  timelineTime: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  timelineStatus: { fontSize: 14, color: '#1e293b', fontWeight: '800', marginTop: 2 },
  timelineLocation: { fontSize: 11, color: '#475569', marginTop: 4 }
});

export default DailySummaryDetails;
