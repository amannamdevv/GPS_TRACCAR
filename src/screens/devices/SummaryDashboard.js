import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator, ScrollView, Modal, FlatList, ToastAndroid, AppState, RefreshControl } from 'react-native';
import DatePicker from '../../components/CalendarPickerModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { fetchDgDailySummary, fetchDeviceList } from '../../api/webApi';
import DailySummaryDetails from './DailySummaryDetails';
import moment from 'moment';
import { LineChart, BarChart } from 'react-native-chart-kit';
import Svg, { G, Circle, Rect, Line, Text as SvgText } from 'react-native-svg';

const screenWidth = Dimensions.get('window').width;

// ─── Helpers ────────────────────────────────────────────────
const timeToSeconds = (timeStr) => {
   if (!timeStr) return 0;
   const [h, m, s] = String(timeStr).split(':').map(Number);
   return (h * 3600) + (m * 60) + (s || 0);
};

const formatSeconds = (totalSeconds) => {
   if (!totalSeconds || isNaN(totalSeconds)) return '0h 0m';
   const d = Math.floor(totalSeconds / 86400);
   const h = Math.floor((totalSeconds % 86400) / 3600);
   const m = Math.floor((totalSeconds % 3600) / 60);

   if (d > 0) return `${d}d ${h}h ${m}m`;
   return `${h}h ${m}m`;
};

const formatTimeStrWithDays = (timeStr) => {
   if (!timeStr) return '00:00:00';
   const parts = String(timeStr).split(':');
   if (parts.length < 2) return '00:00:00';
   const h = parseInt(parts[0], 10) || 0;
   const m = parseInt(parts[1], 10) || 0;
   const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
   return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// ─── Custom Donut Component ──────────────────────────────────
const DonutChart = ({ size = 120, strokeWidth = 18, segments }) => {
   const radius = (size - strokeWidth) / 2;
   const circumference = 2 * Math.PI * radius;

   const total = segments.reduce((acc, s) => acc + Math.max(s.value, 0), 0) || 1;

   const effectiveSegments = total <= 1 && segments.every(s => s.value === 0)
      ? [{ value: 1, color: '#10b981' }, { value: 1, color: '#f59e0b' }, { value: 1, color: '#ef4444' }]
      : segments.filter(s => s.value > 0);

   const finalTotal = effectiveSegments.reduce((acc, s) => acc + s.value, 0) || 1;
   let newCumulative = 0;

   const arcs = effectiveSegments.map((seg, idx) => {
      const segLength = (seg.value / finalTotal) * circumference;
      const dashArray = `${segLength} ${circumference - segLength}`;
      const dashOffset = -((newCumulative / finalTotal) * circumference);
      newCumulative += seg.value;

      return (
         <Circle
            key={idx}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            fill="transparent"
            strokeLinecap="butt"
         />
      );
   });

   return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
         <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
            fill="transparent"
         />
         <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            {arcs}
         </G>
      </Svg>
   );
};

// ─── Reusable Components ────────────────────────────────────
const StatBox = ({ icon, title, value, color, bgColor, onPress }) => (
   <TouchableOpacity style={styles.statBox} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.statIconBg, { backgroundColor: bgColor || `${color}15` }]}>
         <Icon name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.statValue, { color: '#0f172a' }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
   </TouchableOpacity>
);

const NoDataBadge = () => (
   <View style={styles.noDataBadge}>
      <Text style={styles.noDataBadgeText}>No data</Text>
   </View>
);

// ─── Main Dashboard Component ───────────────────────────────
const SummaryDashboard = ({ onBackToMap, onOpenDaily, onGoToDgReport, deviceName, deviceId, initialFromDate, initialToDate, onDatesChange }) => {
   const [loading, setLoading] = useState(true);
   const [apiData, setApiData] = useState([]);

   // Dates
   const [barChartMode, setBarChartMode] = useState('distance'); // 'distance' | 'onTime'
   const [fromDate, setFromDate] = useState(() => initialFromDate || moment().subtract(1, 'days').toDate());
   const [toDate, setToDate] = useState(() => initialToDate || moment().subtract(1, 'days').toDate());
   const [showFromPicker, setShowFromPicker] = useState(false);
   const [showToPicker, setShowToPicker] = useState(false);

   // Device Picker
   const [localDeviceId, setLocalDeviceId] = useState(deviceId);
   const [localDeviceName, setLocalDeviceName] = useState(deviceName);
   const [devicesList, setDevicesList] = useState([]);
   const [showDevicePicker, setShowDevicePicker] = useState(false);
   const [showShareModal, setShowShareModal] = useState(false);
   const [selectedMetric, setSelectedMetric] = useState(null);
   const [tooltipPos, setTooltipPos] = useState({ index: null, x: 0 });
   const [selectedDay, setSelectedDay] = useState(null);
   const [activeQuickDate, setActiveQuickDate] = useState('Yesterday');
   const [refreshing, setRefreshing] = useState(false);
   const [refreshKey, setRefreshKey] = useState(0);
   
   const onRefresh = useCallback(() => {
      setRefreshing(true);
      setRefreshKey(prev => prev + 1);
      setTimeout(() => setRefreshing(false), 1500);
   }, []);
   
   const handleQuickDate = (daysStr) => {
      setActiveQuickDate(daysStr);
      let end = moment().subtract(1, 'days').endOf('day');
      let start = moment().subtract(1, 'days').startOf('day');
      
      switch(daysStr) {
         case 'Yesterday':
            start = moment().subtract(1, 'days').startOf('day');
            break;
         case '3 Days':
            start = moment().subtract(3, 'days').startOf('day');
            break;
         case '5 Days':
            start = moment().subtract(5, 'days').startOf('day');
            break;
         case '7 Days':
            start = moment().subtract(7, 'days').startOf('day');
            break;
         case '15 Days':
            start = moment().subtract(15, 'days').startOf('day');
            break;
         case '1 Month':
            start = moment().subtract(30, 'days').startOf('day');
            break;
      }
      
      const sDate = start.toDate();
      const eDate = end.toDate();

      setFromDate(sDate);
      setToDate(eDate);
      if (onDatesChange) onDatesChange(sDate, eDate);
   };

   // Sync props
   useEffect(() => {
      setLocalDeviceId(deviceId);
      setLocalDeviceName(deviceName);
   }, [deviceId, deviceName]);

   // Fetch devices list
   useEffect(() => {
      const fetchDevices = async () => {
         try {
            const res = await fetchDeviceList();
            if (res?.data) setDevicesList(res.data);
            else if (Array.isArray(res)) setDevicesList(res);
         } catch (error) {
            console.error("Error fetching devices:", error);
         }
      };
      fetchDevices();
   }, []);

   // ─── Fetch Summary Data (per-day loop so each date gets its own record) ───
   const abortControllerRef = useRef(null);

   useEffect(() => {
      if (abortControllerRef.current) {
         abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const loadData = async () => {
         setLoading(true);
         setApiData([]); // Clear old data to prevent showing previous device's data
         try {
            const start = moment(fromDate).startOf('day');
            const end = moment(toDate).startOf('day');
            const daysDiff = end.diff(start, 'days') + 1;
            const dayCount = daysDiff > 0 && daysDiff <= 31 ? daysDiff : 1;

            const parseRes = (data, defaultDate) => {
               if (data && typeof data === 'object') {
                  if (Array.isArray(data.data)) {
                     return data.data.map(d => ({ ...d, date: d.date || d.from_date || defaultDate }));
                  } else if (Array.isArray(data)) {
                     return data.map(d => ({ ...d, date: d.date || d.from_date || defaultDate }));
                  } else {
                     return Object.keys(data)
                        .filter(key => key !== 'status' && key !== 'message' && key !== 'code' && key !== 'device_list' && key !== 'filters' && key !== 'device_count' && key !== 'record_count' && key !== 'session_device_count' && key !== 'session_device_ids')
                        .map(key => ({
                           date: key || defaultDate,
                           ...data[key]
                        }));
                  }
               }
               return [];
            };

            if (dayCount === 1) {
               const d = start.format('YYYY-MM-DD');
               const data = await fetchDgDailySummary(localDeviceId, d, d, { signal });
               if (signal.aborted) return;
               
               let parsedData = parseRes(data, d);
               setApiData(parsedData);
            } else {
               const dailyResults = await Promise.all(
                  Array.from({ length: dayCount }, (_, i) => {
                     const d = moment(start).add(i, 'days').format('YYYY-MM-DD');
                     return fetchDgDailySummary(localDeviceId, d, d, { signal })
                        .then(res => {
                           if (signal.aborted) return null;
                           return parseRes(res, d);
                        })
                        .catch(() => []);
                  })
               );

               if (signal.aborted) return;
               
               // Flatten array of arrays
               const parsedData = dailyResults.filter(Boolean).flat();
               parsedData.sort((a, b) => moment(a.date || a.from_date).diff(moment(b.date || b.from_date)));
               setApiData(parsedData);
            }
         } catch (err) {
            if (signal.aborted) return;
            console.error("Error loading summary:", err);
            setApiData([]);
         } finally {
            if (!signal.aborted) {
               setLoading(false);
            }
         }
      };
      loadData();

      const subscription = AppState.addEventListener('change', nextAppState => {
         if (nextAppState === 'active') {
            loadData();
         }
      });

      return () => {
         subscription.remove();
         if (abortControllerRef.current) {
            abortControllerRef.current.abort();
         }
      };
   }, [fromDate, toDate, localDeviceId, refreshKey]);

   // ─── Calculations ────────────────────────────────────────
   const totalDistance = apiData.reduce((acc, curr) => acc + (Number(curr.total_dg_move_km) || 0), 0).toFixed(2);
   const totalRunningSec = apiData.reduce((acc, curr) => acc + timeToSeconds(curr.total_dg_move), 0);
   const totalIdleSec = apiData.reduce((acc, curr) => acc + timeToSeconds(curr.total_dg_idle), 0);
   const totalStopSec = apiData.reduce((acc, curr) => acc + timeToSeconds(curr.total_dg_stop), 0);
   const totalOnSec = apiData.reduce((acc, curr) => acc + timeToSeconds(curr.total_dg_on), 0);
   const totalOffSec = apiData.reduce((acc, curr) => acc + timeToSeconds(curr.total_dg_off), 0);
   const totalTimeSec = totalRunningSec + totalIdleSec + totalStopSec || 1;

   const hasMovementData = (totalRunningSec + totalIdleSec + totalStopSec) > 0;
   const totalTrips = apiData.reduce((acc, curr) => acc + (Number(curr.total_time_periods) || 0), 0);

   // Chart Labels & Values (date-wise, sirf day-number label)
   const getLabelsAndDistances = () => {
      const start = moment(fromDate).startOf('day');
      const end = moment(toDate).startOf('day');
      const daysDiff = end.diff(start, 'days') + 1;
      const count = daysDiff > 0 && daysDiff <= 31 ? daysDiff : 1;

      const generatedLabels = [];
      const generatedDistances = [];
      const generatedOnTimes = [];
      const generatedIdleTimes = [];
      const generatedOnTimeStrings = [];
      const generatedIdleTimeStrings = [];
      const generatedFullDates = [];
      const groupedDailyData = [];
      
      const formatTimeStr = (totalSeconds) => {
         const h = Math.floor(totalSeconds / 3600);
         const m = Math.floor((totalSeconds % 3600) / 60);
         const s = (totalSeconds % 60);
         return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      };

      for (let i = 0; i < count; i++) {
         const currentDate = moment(start).add(i, 'days');
         const dateStr = currentDate.format('YYYY-MM-DD');
         generatedLabels.push(currentDate.format('DD')); // sirf date number, jaise reference design
         generatedFullDates.push(currentDate.format('DD/MM/YYYY'));

         const matches = apiData.filter(d => {
            const rowDateStr = moment(d.date || d.from_date).format('YYYY-MM-DD');
            return rowDateStr === dateStr;
         });

         if (matches.length > 0) {
            const dayTotal = matches.reduce((sum, match) => sum + (Number(match.total_dg_move_km) || 0), 0);
            generatedDistances.push(Number(dayTotal.toFixed(2)));
            
            const dayOnSec = matches.reduce((sum, match) => sum + timeToSeconds(match.total_dg_on), 0);
            const dayOffSec = matches.reduce((sum, match) => sum + timeToSeconds(match.total_dg_off), 0);
            const dayMoveSec = matches.reduce((sum, match) => sum + timeToSeconds(match.total_dg_move), 0);
            generatedOnTimes.push(Number((dayOnSec / 3600).toFixed(1)));
            generatedOnTimeStrings.push(formatTimeStr(dayOnSec));

            const dayIdleSec = matches.reduce((sum, match) => sum + timeToSeconds(match.total_dg_idle), 0);
            const dayStopSec = matches.reduce((sum, match) => sum + timeToSeconds(match.total_dg_stop), 0);
            generatedIdleTimes.push(Number((dayIdleSec / 3600).toFixed(1)));
            generatedIdleTimeStrings.push(formatTimeStr(dayIdleSec));

            groupedDailyData.push({
               date: dateStr,
               total_dg_move_km: Number(dayTotal.toFixed(2)),
               total_dg_on: formatTimeStr(dayOnSec),
               total_dg_off: formatTimeStr(dayOffSec),
               total_dg_idle: formatTimeStr(dayIdleSec),
               total_dg_stop: formatTimeStr(dayStopSec),
               total_dg_move: formatTimeStr(dayMoveSec),
               start_adc1: matches[0]?.start_adc1 ?? null,
               end_adc1: matches[0]?.end_adc1 ?? null,
            });
         } else {
            generatedDistances.push(0);
            generatedOnTimes.push(0);
            generatedIdleTimes.push(0);
            generatedOnTimeStrings.push('00:00:00');
            generatedIdleTimeStrings.push('00:00:00');

            groupedDailyData.push({
               date: dateStr,
               total_dg_move_km: 0,
               total_dg_on: '00:00:00',
               total_dg_off: '00:00:00',
               total_dg_idle: '00:00:00',
               total_dg_stop: '00:00:00',
               total_dg_move: '00:00:00',
            });
         }
      }
      return { generatedLabels, generatedDistances, generatedOnTimes, generatedIdleTimes, generatedOnTimeStrings, generatedIdleTimeStrings, generatedFullDates, groupedDailyData };
   };

   const { generatedLabels: labels, generatedDistances: distances, generatedOnTimes: onTimes, generatedIdleTimes: idleTimes, generatedOnTimeStrings: onTimeStrings, generatedIdleTimeStrings: idleTimeStrings, generatedFullDates: fullDates, groupedDailyData: dailyLogsData } = getLabelsAndDistances();
   
   const handleModeChange = (mode) => {
      setBarChartMode(mode);
      setTooltipPos({ index: null, x: 0 });
   };

   const activeDataset = barChartMode === 'distance' ? distances : (barChartMode === 'onTime' ? onTimes : idleTimes);
   const activeDatasetStrings = barChartMode === 'distance' ? distances : (barChartMode === 'onTime' ? onTimeStrings : idleTimeStrings);
   const activeHasData = activeDataset.some(v => v > 0);

   // --- Dynamic Y-Axis Scale Logic ---
   const rawData = activeDataset.map(d => Number(d) || 0);
   const maxValue = Math.max(...rawData, 0);
   
   let stepSize = 1;
   if (barChartMode === 'distance') {
      stepSize = 10;
      if (maxValue > 40) stepSize = 25;
      if (maxValue > 100) stepSize = 50;
      if (maxValue > 250) stepSize = 100;
      if (maxValue > 500) stepSize = 200;
      if (maxValue > 1000) stepSize = 250;
      if (maxValue > 2000) stepSize = 500;
   } else {
      stepSize = 2;
      if (maxValue > 12) stepSize = 4;
      if (maxValue > 24) stepSize = 6;
   }

   let dynamicSegments = Math.ceil(maxValue / stepSize);
   if (dynamicSegments < 3) dynamicSegments = 3; // Ensure a nice looking grid

   const niceMax = dynamicSegments * stepSize;

   // Donut Segments (Always 3 parts)
   const donutSegments = hasMovementData ? [
      { name: 'Move', value: totalRunningSec, displaySec: totalRunningSec, color: '#10b981' },
      { name: 'Idle', value: totalIdleSec, displaySec: totalIdleSec, color: '#f59e0b' },
      { name: 'Stop', value: totalStopSec, displaySec: totalStopSec, color: '#ef4444' }
   ].filter(s => s.value > 0) : [
      { name: 'Move', value: 1, displaySec: 0, color: '#10b981' },
      { name: 'Idle', value: 1, displaySec: 0, color: '#f59e0b' },
      { name: 'Stop', value: 1, displaySec: 0, color: '#ef4444' }
   ];

   // Common Chart Config
   const commonConfig = {
      backgroundGradientFrom: '#ffffff',
      backgroundGradientTo: '#ffffff',
      decimalPlaces: 0,
      color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, // light blue everywhere by default
      labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
      propsForDots: { r: '4', strokeWidth: '2', stroke: '#1565C0', fill: '#fff' },
      propsForBackgroundLines: { strokeDasharray: '4, 6', stroke: '#eef2f7', strokeWidth: 1 },
   };

   // ─── Handlers ────────────────────────────────────────────
   const handleExport = (type) => {
      setShowShareModal(false);
      ToastAndroid.show(`${type} export coming soon!`, ToastAndroid.SHORT);
   };

   if (selectedMetric) {
      return null; // Placeholder - handle navigation as per your app structure
   }

   // ── Responsive bar chart width ──────────────────────────────
   // chart-kit ke y-axis number (jaise "55") ke liye thoda extra space chahiye
   // warna chhote phones pe wo number cut ho jaata hai (left side).
   // Isliye hum chart ko card ki actual available width se thoda kam rakhte hain
   // aur library ko khud apna y-axis label space nikalne dete hain.
   const chartCardHorizontalPadding = 32; // chartCard ka left+right padding (16+16)
   const minWidthPerBar = 40; // minimum space per bar (including spacing)
   const yAxisWidth = 45;
   
   const scrollableAvailableWidth = screenWidth - chartCardHorizontalPadding - yAxisWidth;
   const scrollableCalculatedWidth = (distances.length * minWidthPerBar) + 15; // 15 for right padding
   const scrollableWidth = Math.max(scrollableAvailableWidth, scrollableCalculatedWidth, 195);

   const handleChartTouch = (e) => {
      const x = e.nativeEvent.locationX;
      const paddingLeft = 0; // Y-axis is now outside the scroll view
      const paddingRight = 15;
      const usableWidth = scrollableWidth - paddingLeft - paddingRight;
      const barSpacing = distances.length > 0 ? usableWidth / distances.length : usableWidth;

      const index = Math.floor(x / barSpacing);
      if (index >= 0 && index < distances.length) {
         if (tooltipPos.index === index) {
            setTooltipPos({ index: null, x: 0 });
         } else {
            const centerX = (index * barSpacing) + (barSpacing / 2);
            setTooltipPos({ index, x: centerX - 35 }); // 35 is half bubble width
         }
      } else {
         setTooltipPos({ index: null, x: 0 });
      }
   };

   // Show DailySummaryDetails screen when a day card is tapped
   if (selectedDay) {
      return (
         <DailySummaryDetails
            deviceId={localDeviceId}
            deviceName={localDeviceName}
            initialDate={selectedDay.date || selectedDay.from_date}
            onBack={() => setSelectedDay(null)}
            onOpenPlayback={null}
            onGoToDgReport={onGoToDgReport}
         />
      );
   }

   return (
      <View style={styles.container}>
         {/* ─── Header ─── */}
         <View style={styles.header}>
            <View style={styles.headerLeft}>
               <TouchableOpacity onPress={onBackToMap} hitSlop={{ top: 20, bottom: 20 }}>
                  <Icon name="arrow-left" size={24} color="#fff" />
               </TouchableOpacity>
               <Text style={styles.headerTitle}>DG Summary Report</Text>
            </View>
         </View>

         <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 30 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1565C0']} />}
         >
            <View style={{ flex: 1 }}>
               {/* Date Pickers (Hidden modals) */}
               <DatePicker
                  modal open={showFromPicker} date={fromDate} mode="date"
                  minimumDate={moment().subtract(30, 'days').toDate()} maximumDate={moment().subtract(1, 'days').toDate()}
                  onConfirm={(date) => { setShowFromPicker(false); setFromDate(date); setActiveQuickDate(null); if (onDatesChange) onDatesChange(date, toDate); }}
                  onCancel={() => setShowFromPicker(false)}
                  title="Select Start Date"
                  confirmText="Done"
                  cancelText="Cancel"
               />
               <DatePicker
                  modal open={showToPicker} date={toDate} mode="date"
                  minimumDate={moment().subtract(30, 'days').toDate()} maximumDate={moment().subtract(1, 'days').toDate()}
                  onConfirm={(date) => { setShowToPicker(false); setToDate(date); setActiveQuickDate(null); if (onDatesChange) onDatesChange(fromDate, date); }}

                  onCancel={() => setShowToPicker(false)}
                  title="Select End Date"
                  confirmText="Done"
                  cancelText="Cancel"
               />

               {/* ─── Filter Row ─── */}
               <View style={styles.filterContainer}>
                  <View style={[styles.filterBtn, { paddingHorizontal: 4, gap: 4, flex: 1.2 }]}>
                     <TouchableOpacity onPress={() => setShowFromPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Icon name="calendar-start" size={14} color="#f97316" />
                        <Text style={[styles.filterText, { flex: 1, fontSize: 10, marginLeft: 2 }]} numberOfLines={1}>{moment(fromDate).format('DD/MM/YY')}</Text>
                     </TouchableOpacity>
                     <Text style={{ color: '#94a3b8', fontSize: 10 }}>→</Text>
                     <TouchableOpacity onPress={() => setShowToPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Icon name="calendar-end" size={14} color="#f97316" />
                        <Text style={[styles.filterText, { flex: 1, fontSize: 10, marginLeft: 2 }]} numberOfLines={1}>{moment(toDate).format('DD/MM/YY')}</Text>
                     </TouchableOpacity>
                  </View>

                  <TouchableOpacity style={styles.filterBtn} onPress={() => setShowDevicePicker(true)}>
                     <Icon name="truck-delivery" size={16} color="#64748b" />
                     <Text style={styles.filterText} numberOfLines={1}>
                        {localDeviceName || 'All Devices'}
                     </Text>
                     <Icon name="chevron-down" size={14} color="#64748b" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.iconBtnOnly}>
                     <Icon name="filter-variant" size={18} color="#1e293b" />
                  </TouchableOpacity>
               </View>

               {/* Quick Date Chips */}
               <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
                  {['Yesterday', '3 Days', '5 Days', '7 Days', '15 Days', '1 Month'].map(opt => (
                     <TouchableOpacity 
                        key={opt}
                        style={[styles.quickDateChip, activeQuickDate === opt && styles.activeQuickDateChip]}
                        onPress={() => handleQuickDate(opt)}
                     >
                        <Text style={[styles.quickDateChipText, activeQuickDate === opt && styles.activeQuickDateChipText]}>{opt}</Text>
                     </TouchableOpacity>
                  ))}
               </ScrollView>

               {/* Device Selection Modal */}
               <Modal visible={showDevicePicker} transparent animationType="fade">
                  <TouchableOpacity
                     style={styles.modalOverlay}
                     activeOpacity={1}
                     onPress={() => setShowDevicePicker(false)}
                  >
                     <View style={styles.deviceModalContent}>
                        <Text style={styles.modalHeading}>Select Device</Text>
                        <FlatList
                           data={devicesList}
                           keyExtractor={(item) => String(item.id || item.deviceid)}
                           renderItem={({ item }) => (
                              <TouchableOpacity
                                 style={styles.deviceItem}
                                 onPress={() => {
                                    setLocalDeviceId(item.id || item.deviceid);
                                    setLocalDeviceName(item.name || item.dg_name);
                                    setShowDevicePicker(false);
                                 }}
                              >
                                 <View style={styles.deviceRadio}>
                                    {(localDeviceId === (item.id || item.deviceid)) ? <View style={styles.radioInner} /> : null}
                                 </View>
                                 <Text style={styles.deviceName}>{item.name || item.dg_name}</Text>
                              </TouchableOpacity>
                           )}
                        />
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDevicePicker(false)}>
                           <Text style={styles.cancelBtnText}>Close</Text>
                        </TouchableOpacity>
                     </View>
                  </TouchableOpacity>
               </Modal>

               {loading ? (
                  <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 60 }} />
               ) : (
                  <>
                     {/* ─── Stats Grid (3 Columns) ─── */}
                     <View style={styles.statsGrid}>
                        <StatBox icon="road-variant" title="Total Distance" value={`${totalDistance} km`} color="#1565C0" onPress={() => setSelectedMetric('distance')} />
                        <StatBox icon="car" title="Total Move" value={formatSeconds(totalRunningSec)} color="#10b981" onPress={() => { setSelectedMetric('move'); if (onGoToDgReport) onGoToDgReport('MOVE', fromDate, toDate); }} />
                        <StatBox icon="timer-sand" title="Total Idle" value={formatSeconds(totalIdleSec)} color="#f59e0b" onPress={() => { setSelectedMetric('idle'); if (onGoToDgReport) onGoToDgReport('STOPPED', fromDate, toDate); }} />
                        <StatBox icon="stop-circle-outline" title="Total Stop" value={formatSeconds(totalStopSec)} color="#ef4444" onPress={() => { setSelectedMetric('stop'); if (onGoToDgReport) onGoToDgReport('ALL', fromDate, toDate); }} />
                        <StatBox icon="power-plug" title="DG ON" value={formatSeconds(totalOnSec)} color="#0ea5e9" onPress={() => { setSelectedMetric('on'); if (onGoToDgReport) onGoToDgReport('ON', fromDate, toDate); }} />
                        <StatBox icon="power-off" title="DG OFF" value={formatSeconds(totalOffSec)} color="#94a3b8" onPress={() => { setSelectedMetric('off'); if (onGoToDgReport) onGoToDgReport('OFF', fromDate, toDate); }} />
                     </View>

                     {/* ─── Overview Section Header ─── */}
                     <View style={[styles.sectionHeader, { paddingHorizontal: 16 }]}>
                        <Text style={styles.sectionTitle}>Overview Charts</Text>
                     </View>

                     {/* ─── Charts Grid (Top-Bottom) ─── */}
                     <View style={styles.chartsGrid}>

                        {/* Card 1: Run/Idle/Stop Donut */}
                        <View style={[styles.chartCard, { justifyContent: 'flex-start' }]}>
                           <Text style={styles.chartLabel}>Move vs Idle vs Stop</Text>

                           <View style={styles.donutContainer}>
                              <DonutChart size={130} strokeWidth={18} segments={donutSegments} />

                              <View style={styles.donutLegend}>
                                 {[
                                    { label: 'Move', sec: totalRunningSec, color: '#10b981' },
                                    { label: 'Idle', sec: totalIdleSec, color: '#f59e0b' },
                                    { label: 'Stop', sec: totalStopSec, color: '#ef4444' },
                                 ].map((item, idx) => {
                                    const pct = totalTimeSec > 0 ? Math.round((item.sec / totalTimeSec) * 100) : 0;
                                    const handleLegendPress = () => {
                                       if (onGoToDgReport) {
                                          if (item.label === 'Move') onGoToDgReport('MOVE', fromDate, toDate);
                                          if (item.label === 'Idle') onGoToDgReport('STOPPED', fromDate, toDate);
                                          if (item.label === 'Stop') onGoToDgReport('ALL', fromDate, toDate);
                                       }
                                    };
                                    return (
                                       <TouchableOpacity key={idx} style={styles.legendRow} onPress={handleLegendPress}>
                                          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                                          <View style={styles.legendInfo}>
                                             <Text style={styles.legendLabel}>{item.label}</Text>
                                             <Text style={styles.legendValue}>{`${formatSeconds(item.sec)} (${pct}%)`}</Text>
                                          </View>
                                       </TouchableOpacity>
                                    )
                                 })}
                              </View>
                           </View>
                        </View>

                        {/* Card 2: Daily Distance/ON (Bar) */}
                        <View style={[styles.chartCard, { overflow: 'hidden' }]}>
                           <View style={[styles.chartHeaderRow, { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }]}>
                              <Text style={styles.chartLabel}>{barChartMode === 'distance' ? 'Daily Distance (km)' : barChartMode === 'onTime' ? 'Daily DG ON (hours)' : 'Daily Idle (hours)'}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
                           {!activeHasData ? <NoDataBadge /> : null}

                           <View style={{ marginTop: 14, flexDirection: 'row' }}>
                              {/* Fixed Y-Axis */}
                              <View style={{ width: 45, height: 210, backgroundColor: '#fff', zIndex: 10 }}>
                                 <Svg width={45} height={210}>
                                    {Array.from({ length: dynamicSegments + 1 }).map((_, i) => {
                                       const val = niceMax - i * (niceMax / dynamicSegments);
                                       const y = 20 + i * (160 / dynamicSegments);
                                       return (
                                          <SvgText key={`y-${i}`} x={35} y={y + 4} fontSize="11" fill="#64748b" textAnchor="end" fontWeight="bold">
                                             {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : Math.round(val)}
                                          </SvgText>
                                       );
                                    })}
                                 </Svg>
                              </View>

                              {/* Scrollable Chart Area */}
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                                 <View
                                    onTouchEnd={handleChartTouch}
                                    style={{ position: 'relative', width: scrollableWidth, height: 210 }}
                                 >
                                    <Svg width={scrollableWidth} height={210}>
                                       {/* Grid lines */}
                                       {Array.from({ length: dynamicSegments + 1 }).map((_, i) => {
                                          const y = 20 + i * (160 / dynamicSegments);
                                          return (
                                             <Line key={`grid-${i}`} x1={0} y1={y} x2={scrollableWidth - 15} y2={y} stroke="#eef2f7" strokeWidth="1" strokeDasharray="4, 6" />
                                          );
                                       })}

                                       {/* Left & Right Borders */}
                                       <Line x1={0} y1={20} x2={0} y2={180} stroke="#cbd5e1" strokeWidth="1" />
                                       <Line x1={scrollableWidth - 15} y1={20} x2={scrollableWidth - 15} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                                       {/* Bars & X-Axis Labels */}
                                       {activeDataset.map((val, i) => {
                                          const numVal = Number(val) || 0;
                                          const barH = niceMax > 0 ? (numVal / niceMax) * 160 : 0;
                                          const usableWidth = scrollableWidth - 15;
                                          const barSpacing = activeDataset.length > 0 ? usableWidth / activeDataset.length : usableWidth;
                                          const maxBarWidth = 40;
                                          const barWidth = Math.min(barSpacing * 0.55, maxBarWidth);
                                          const x = (i * barSpacing) + (barSpacing - barWidth) / 2;
                                          const y = 180 - barH;
                                          const barColor = barChartMode === 'distance' ? '#3b82f6' : barChartMode === 'onTime' ? '#10b981' : '#f59e0b';
                                          
                                          const isAnySelected = tooltipPos.index !== null;
                                          const isSelected = tooltipPos.index === i;
                                          const barOpacity = isAnySelected ? (isSelected ? 1 : 0.3) : 1;

                                          return (
                                             <G key={`bar-${i}`}>
                                                <Rect x={x} y={y} width={barWidth} height={barH} fill={barColor} opacity={barOpacity} rx="4" />
                                                <SvgText x={(i * barSpacing) + barSpacing / 2} y={198} fontSize="11" fill="#64748b" textAnchor="middle" fontWeight="bold">
                                                   {labels[i]}
                                                </SvgText>
                                             </G>
                                          );
                                       })}
                                    </Svg>

                                    {/* Exact Tooltip Bubble */}
                                    {tooltipPos.index !== null ? (
                                       <View style={{
                                          position: 'absolute',
                                          top: 10,
                                          left: tooltipPos.x,
                                          backgroundColor: '#1e293b',
                                          paddingHorizontal: 6,
                                          paddingVertical: 6,
                                          borderRadius: 8,
                                          shadowColor: '#000',
                                          shadowOffset: { width: 0, height: 2 },
                                          shadowOpacity: 0.25,
                                          shadowRadius: 3.84,
                                          elevation: 5,
                                          minWidth: 70,
                                          alignItems: 'center',
                                          zIndex: 100
                                       }}>
                                          <Text style={{ color: '#94a3b8', fontSize: 9, textAlign: 'center', marginBottom: 2 }}>
                                             {fullDates[tooltipPos.index]}
                                          </Text>
                                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' }}>
                                             {barChartMode === 'distance' 
                                                ? `${activeDataset[tooltipPos.index]} km` 
                                                : `${activeDatasetStrings[tooltipPos.index]}`}
                                          </Text>
                                       </View>
                                    ) : null}
                                 </View>
                              </ScrollView>
                           </View>
                        </View>
                     </View>
                     {/* End Charts Grid */}

                     {/* ─── Daily Summary List ─── */}
                     <Text style={[styles.sectionTitle, { marginTop: 24, marginBottom: 12, paddingHorizontal: 16, fontSize: 18, color: '#1e293b' }]}>Daily Summary</Text>

                     {apiData.length === 0 ? (
                        <View style={styles.emptyState}>
                           <Icon name="file-search-outline" size={50} color="#cbd5e1" />
                           <Text style={styles.emptyText}>No records found for this period.</Text>
                        </View>
                     ) : (
                        dailyLogsData.map((day, idx) => {
                           const runS = timeToSeconds(day.total_dg_move);
                           const idleS = timeToSeconds(day.total_dg_idle);
                           const stopS = timeToSeconds(day.total_dg_stop);
                           const dayTotal = runS + idleS + stopS || 1;

                           const runPct = (runS / dayTotal) * 100;
                           const idlePct = (idleS / dayTotal) * 100;
                           const stopPct = (stopS / dayTotal) * 100;
                           const isToday = moment(day.date || day.from_date).isSame(moment(), 'day');

                           return (
                              <TouchableOpacity
                                 key={idx}
                                 style={styles.dayCard}
                                 activeOpacity={0.8}
                                 onPress={() => setSelectedDay(day)}
                              >
                                 {/* Day Header */}
                                 <View style={styles.dayHeader}>
                                    <View style={styles.dayLeft}>
                                       <View style={styles.calendarIcon}>
                                          <Icon name="calendar" size={14} color="#1565C0" />
                                       </View>
                                       <Text style={styles.dayDate}>
                                          {moment(day.date || day.from_date).format('DD/MM/YYYY')}
                                       </Text>
                                    </View>
                                    <View style={[styles.badge, { backgroundColor: isToday ? '#dcfce7' : '#f1f5f9' }]}>
                                       <Text style={[styles.badgeText, { color: isToday ? '#166534' : '#64748b' }]}>
                                          {isToday ? 'Today' : '1 Day'}
                                       </Text>
                                    </View>
                                 </View>

                                 {/* Progress Bar (Green/Orange/Red) */}
                                 <View style={styles.progressTrack}>
                                    {runPct > 0 ? <View style={[styles.progressBar, { width: `${runPct}%`, backgroundColor: '#10b981' }]} /> : null}
                                    {idlePct > 0 ? <View style={[styles.progressBar, { width: `${idlePct}%`, backgroundColor: '#f59e0b' }]} /> : null}
                                    {stopPct > 0 ? <View style={[styles.progressBar, { width: `${stopPct}%`, backgroundColor: '#ef4444' }]} /> : null}
                                 </View>

                                 {/* Stats Grid (4 cols) */}
                                 <View style={styles.dayStatsGrid}>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="map-marker-distance" size={14} color="#1565C0" />
                                       <Text style={styles.dayStatVal}>{day.total_dg_move_km || 0}</Text>
                                       <Text style={styles.dayStatLab}>km</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="car" size={14} color="#10b981" />
                                       <Text style={styles.dayStatVal}>{formatTimeStrWithDays(day.total_dg_move)}</Text>
                                       <Text style={styles.dayStatLab}>Move</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="timer-sand" size={14} color="#f59e0b" />
                                       <Text style={styles.dayStatVal}>{formatTimeStrWithDays(day.total_dg_idle)}</Text>
                                       <Text style={styles.dayStatLab}>Idle</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="stop-circle" size={14} color="#ef4444" />
                                       <Text style={styles.dayStatVal}>{formatTimeStrWithDays(day.total_dg_stop)}</Text>
                                       <Text style={styles.dayStatLab}>Stop</Text>
                                    </View>
                                 </View>

                                 {/* Second Stats Grid Row */}
                                 <View style={[styles.dayStatsGrid, { borderTopWidth: 0, paddingTop: 6, paddingBottom: 6 }]}>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="power" size={14} color="#0ea5e9" />
                                       <Text style={styles.dayStatVal}>{formatTimeStrWithDays(day.total_dg_on)}</Text>
                                       <Text style={styles.dayStatLab}>DG ON</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="power-off" size={14} color="#64748b" />
                                       <Text style={styles.dayStatVal}>{formatTimeStrWithDays(day.total_dg_off)}</Text>
                                       <Text style={styles.dayStatLab}>DG OFF</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="lightning-bolt" size={14} color="#8b5cf6" />
                                       <Text style={styles.dayStatVal}>{day.start_adc1 != null ? parseFloat(day.start_adc1).toFixed(2) : '0.00'}</Text>
                                       <Text style={styles.dayStatLab}>V Start</Text>
                                    </View>
                                    <View style={styles.dayStatItem}>
                                       <Icon name="lightning-bolt-outline" size={14} color="#8b5cf6" />
                                       <Text style={styles.dayStatVal}>{day.end_adc1 != null ? parseFloat(day.end_adc1).toFixed(2) : '0.00'}</Text>
                                       <Text style={styles.dayStatLab}>V End</Text>
                                    </View>
                                 </View>
                              </TouchableOpacity>
                           );
                        })
                     )}
                  </>
               )}
            </View>
         </ScrollView>

         {/* ─── Share Bottom Sheet ─── */}
         <Modal visible={showShareModal} transparent animationType="slide">
            <TouchableOpacity
               style={styles.sheetOverlay}
               activeOpacity={1}
               onPress={() => setShowShareModal(false)}
            >
               <View style={styles.sheetContent}>
                  <View style={styles.sheetHandle} />
                  <Text style={styles.sheetTitle}>Export & Share</Text>

                  {['PDF', 'Excel', 'CSV', 'Link'].map(type => (
                     <TouchableOpacity key={type} style={styles.sheetOption} onPress={() => handleExport(type)}>
                        <Icon
                           name={
                              type === 'PDF' ? 'file-pdf-box' :
                                 type === 'Excel' ? 'file-excel-box' :
                                    type === 'CSV' ? 'file-delimited' : 'share-variant'
                           }
                           size={22}
                           color={
                              type === 'PDF' ? '#ef4444' :
                                 type === 'Excel' ? '#10b981' :
                                    type === 'CSV' ? '#1565C0' : '#8b5cf6'
                           }
                        />
                        <Text style={styles.sheetOptionText}>Download {type}</Text>
                     </TouchableOpacity>
                  ))}

                  <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowShareModal(false)}>
                     <Text style={styles.sheetCancelText}>Cancel</Text>
                  </TouchableOpacity>
               </View>
            </TouchableOpacity>
         </Modal>
      </View>
   );
};

// ─── Stylesheet ───────────────────────────────────────────
const styles = StyleSheet.create({
   container: { flex: 1, backgroundColor: '#f8fafc' },

   header: {
      backgroundColor: '#1e3a8a',
      paddingTop: 45,
      paddingBottom: 16,
      paddingHorizontal: 16,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
   },
   headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
   headerTitle: { fontSize: 17, fontWeight: '700', color: '#ffffff' },

   filterContainer: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 8,
      backgroundColor: '#fff',
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 2
   },
   filterBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#f8fafc',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 6
   },
   quickDateChip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      backgroundColor: '#f1f5f9',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#e2e8f0',
   },
   activeQuickDateChip: {
      backgroundColor: '#1565C0',
      borderColor: '#1565C0',
   },
   quickDateChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#475569',
   },
   activeQuickDateChipText: {
      color: '#ffffff',
   },
   filterText: { fontSize: 11, fontWeight: '600', color: '#334155', flex: 1 },
   iconBtnOnly: {
      width: 36,
      height: 36,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#e2e8f0',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f8fafc'
   },

   statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 12,
      marginTop: 12,
      gap: 8
   },
   statBox: {
      width: '31%',
      backgroundColor: '#fff',
      borderRadius: 14,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#f1f5f9',
      elevation: 1,
      marginBottom: 4
   },
   statIconBg: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8
   },
   statValue: {
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 2
   },
   statTitle: {
      fontSize: 9,
      color: '#64748b',
      fontWeight: '600',
      textAlign: 'center'
   },

   sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      marginTop: 20,
      marginBottom: 12
   },
   sectionTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
   viewAllLink: { fontSize: 13, fontWeight: '700', color: '#1565C0' },

   chartsGrid: {
      flexDirection: 'column',
      paddingHorizontal: 12,
      gap: 16
   },
   chartCard: {
      width: '100%',
      backgroundColor: '#fff',
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: '#f1f5f9',
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      minHeight: 200,
      marginBottom: 4
   },
   chartHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4
   },
   chartLabel: { fontSize: 13, fontWeight: '700', color: '#334155' },
   chartBigValue: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginTop: 4, marginBottom: 4 },
   chartUnit: { fontSize: 12, fontWeight: '600', color: '#64748b' },

   noDataBadge: {
      backgroundColor: '#f1f5f9',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6
   },
   noDataBadgeText: { fontSize: 9, fontWeight: '700', color: '#94a3b8' },

   // Donut specific
   donutContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 15,
      gap: 16,
      paddingRight: 10
   },
   donutLegend: {
      flex: 1,
      gap: 14,
      marginLeft: 10
   },
   legendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10
   },
   legendDot: {
      width: 12,
      height: 12,
      borderRadius: 4
   },
   legendInfo: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 2
   },
   legendLabel: { fontSize: 14, fontWeight: '800', color: '#1e293b' },
   legendValue: { fontSize: 13, fontWeight: '600', color: '#475569' },

   // Daily Cards
   dayCard: {
      backgroundColor: '#fff',
      marginHorizontal: 12,
      marginBottom: 12,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: '#f1f5f9',
      elevation: 1
   },
   dayHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14
   },
   dayLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10
   },
   calendarIcon: {
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: '#eff6ff',
      alignItems: 'center',
      justifyContent: 'center'
   },
   dayDate: {
      fontSize: 15,
      fontWeight: '700',
      color: '#0f172a'
   },
   badge: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 12
   },
   badgeText: {
      fontSize: 11,
      fontWeight: '700'
   },
   progressTrack: {
      height: 8,
      backgroundColor: '#f1f5f9',
      borderRadius: 4,
      flexDirection: 'row',
      overflow: 'hidden',
      marginBottom: 16
   },
   progressBar: {
      height: '100%'
   },
   dayStatsGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderColor: '#f8fafc',
      paddingTop: 12
   },
   dayStatItem: {
      alignItems: 'center',
      flex: 1
   },
   dayStatVal: {
      fontSize: 13,
      fontWeight: '800',
      color: '#0f172a',
      marginTop: 4,
      marginBottom: 2
   },
   dayStatLab: {
      fontSize: 9,
      color: '#94a3b8',
      fontWeight: '600'
   },

   emptyState: {
      alignItems: 'center',
      paddingVertical: 60,
      marginHorizontal: 12
   },
   emptyText: {
      marginTop: 12,
      color: '#94a3b8',
      fontSize: 14,
      fontWeight: '600'
   },

   // Modals
   modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center'
   },
   deviceModalContent: {
      width: '85%',
      maxHeight: '70%',
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20
   },
   modalHeading: {
      fontSize: 17,
      fontWeight: '800',
      color: '#0f172a',
      marginBottom: 16
   },
   deviceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#f1f5f9'
   },
   deviceRadio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: '#1565C0',
      marginRight: 12,
      alignItems: 'center',
      justifyContent: 'center'
   },
   radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: '#1565C0'
   },
   deviceName: {
      fontSize: 14,
      fontWeight: '600',
      color: '#334155'
   },
   cancelBtn: {
      marginTop: 16,
      backgroundColor: '#f1f5f9',
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center'
   },
   cancelBtnText: {
      color: '#ef4444',
      fontWeight: '700'
   },

   sheetOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end'
   },
   sheetContent: {
      backgroundColor: '#fff',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      paddingBottom: 40
   },
   sheetHandle: {
      width: 40,
      height: 4,
      backgroundColor: '#e2e8f0',
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20
   },
   sheetTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: '#0f172a',
      marginBottom: 20
   },
   sheetOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: '#f8fafc'
   },
   sheetOptionText: {
      marginLeft: 16,
      fontSize: 16,
      fontWeight: '500',
      color: '#334155'
   },
   sheetCancel: {
      marginTop: 12,
      backgroundColor: '#f1f5f9',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center'
   },
   sheetCancelText: {
      color: '#64748b',
      fontWeight: '700',
      fontSize: 16
   }
});

export default SummaryDashboard;