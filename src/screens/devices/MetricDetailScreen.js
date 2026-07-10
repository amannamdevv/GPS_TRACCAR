import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BarChart } from 'react-native-chart-kit';
import { fetchDgDailySummary } from '../../api/webApi';
import moment from 'moment';

const screenWidth = Dimensions.get('window').width;

// Helper to convert HH:MM:SS to seconds
const timeToSeconds = (timeStr) => {
   if (!timeStr) return 0;
   const [h, m, s] = String(timeStr).split(':').map(Number);
   return (h * 3600) + (m * 60) + (s || 0);
};

// Helper to format seconds to HHh MMm
const formatSeconds = (totalSeconds) => {
   if (!totalSeconds || isNaN(totalSeconds)) return '0h 0m';
   const h = Math.floor(totalSeconds / 3600);
   const m = Math.floor((totalSeconds % 3600) / 60);
   return `${h}h ${m}m`;
};

const MetricDetailScreen = ({ onClose, metricType, fromDate, toDate }) => {
  const [loading, setLoading] = useState(true);
  const [apiData, setApiData] = useState([]);
  
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const loadData = async () => {
      setLoading(true);
      try {
        const startStr = moment(fromDate).format('YYYY-MM-DD');
        const endStr = moment(toDate).format('YYYY-MM-DD');
        // Fetch aggregate data for all devices
        const data = await fetchDgDailySummary(null, startStr, endStr, { signal });
        if (signal.aborted) return;
        let parsedData = data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
           parsedData = Object.values(data);
        }
        setApiData(parsedData || []);
      } catch (err) {
        if (!signal.aborted) {
          console.error("Error loading metric detail:", err);
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    };
    loadData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fromDate, toDate]);

  // Aggregate logic based on metricType
  let topVehicles = [];
  let dailyTotals = {};
  
  apiData.forEach(item => {
    const deviceName = item.dg_name || 'Unknown Device';
    const dateStr = item.from_date || item.date;
    let value = 0;
    
    switch(metricType) {
      case 'Total Distance': value = Number(item.total_dg_move_km) || 0; break;
      case 'Total Move': value = timeToSeconds(item.total_dg_move); break;
      case 'Total Idle': value = timeToSeconds(item.total_dg_idle); break;
      case 'Total Stop': value = timeToSeconds(item.total_dg_stop); break;
      case 'Trips': value = Number(item.total_time_periods) || 0; break;
      case 'Total DG ON': value = timeToSeconds(item.total_dg_on); break;
      case 'Total DG OFF': value = timeToSeconds(item.total_dg_off); break;
      default: value = 0;
    }

    // Vehicle aggregation
    const existing = topVehicles.find(v => v.name === deviceName);
    if (existing) {
      existing.value += value;
    } else {
      topVehicles.push({ name: deviceName, value });
    }

    // Daily aggregation
    const dateKey = moment(dateStr).format('DD MMM');
    dailyTotals[dateKey] = (dailyTotals[dateKey] || 0) + value;
  });

  topVehicles.sort((a, b) => b.value - a.value);

  // Generate chart data
  const getDummyLabels = () => {
    let arr = [];
    for (let i = 6; i >= 0; i--) {
      arr.push(moment().subtract(i, 'days').format('DD MMM'));
    }
    return arr;
  };

  const chartLabels = Object.keys(dailyTotals).length > 0 ? Object.keys(dailyTotals) : getDummyLabels();
  const chartValues = chartLabels.map(l => dailyTotals[l] || 0);
  const totalValue = chartValues.reduce((a, b) => a + b, 0);

  const maxVal = Math.max(...(chartValues.length > 0 ? chartValues : [0]));
  const minVal = Math.min(...(chartValues.length > 0 ? chartValues : [0]));
  const avgVal = chartValues.length > 0 ? totalValue / chartValues.length : 0;

  const isTimeMetric = metricType.includes('Move') || metricType.includes('Idle') || metricType.includes('Stop') || metricType.includes('ON') || metricType.includes('OFF');
  const formatVal = (val) => isTimeMetric ? formatSeconds(val) : (Number.isInteger(val) ? val.toString() : Number(val).toFixed(2));
  
  // Format for charts (charts require numbers, so we pass hours for time metrics)
  const chartMappedValues = chartValues.map(v => isTimeMetric ? (v/3600) : v);

  const chartConfig = {
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    color: (opacity = 1) => `rgba(21, 101, 192, 0.8)`,
    labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
    strokeWidth: 2,
    barPercentage: 0.6,
    decimalPlaces: isTimeMetric ? 1 : 0,
    propsForLabels: { fontSize: 9 }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Icon name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{metricType}</Text>
        </View>
        <Text style={{color: '#fff', fontSize: 12, opacity: 0.8}}>{moment(fromDate).format('DD MMM')} - {moment(toDate).format('DD MMM YYYY')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc', padding: 16 }}>
          
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total {metricType}</Text>
            <Text style={styles.totalValue}>{formatVal(totalValue)} {metricType === 'Total Distance' ? 'km' : ''}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statPillLabel}>Daily Avg</Text>
              <Text style={styles.statPillVal}>{formatVal(avgVal)}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statPillLabel}>Max</Text>
              <Text style={styles.statPillVal}>{formatVal(maxVal)}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statPillLabel}>Min</Text>
              <Text style={styles.statPillVal}>{formatVal(minVal)}</Text>
            </View>
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Daily Trend {isTimeMetric ? '(Hours)' : ''}</Text>
            <BarChart
               data={{ labels: chartLabels, datasets: [{ data: chartMappedValues }] }}
               width={screenWidth - 32 - 24}
               height={180}
               chartConfig={chartConfig}
               withInnerLines={false}
               showValuesOnTopOfBars={true}
               fromZero={true}
               style={{ marginVertical: 8, paddingRight: 0, borderRadius: 12 }}
            />
          </View>

          <Text style={styles.sectionTitle}>Top Vehicles by {metricType}</Text>
          <View style={styles.listCard}>
            {topVehicles.length === 0 ? (
               <Text style={styles.emptyText}>No vehicle data found.</Text>
            ) : (
               topVehicles.map((v, i) => (
                 <View key={i} style={[styles.listItem, i === topVehicles.length - 1 && { borderBottomWidth: 0 }]}>
                   <View style={styles.rankBadge}><Text style={styles.rankText}>#{i+1}</Text></View>
                   <Text style={styles.vehicleName} numberOfLines={1}>{v.name}</Text>
                   <Text style={styles.vehicleValue}>{formatVal(v.value)}</Text>
                 </View>
               ))
            )}
          </View>
          <View style={{height: 40}}/>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: '#1e3a8a', padding: 16, paddingTop: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 10 },
  
  totalCard: { backgroundColor: '#fff', padding: 20, borderRadius: 16, alignItems: 'center', elevation: 1, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  totalLabel: { fontSize: 13, color: '#64748b', fontWeight: '600', marginBottom: 4 },
  totalValue: { fontSize: 28, color: '#0f172a', fontWeight: '800' },
  
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statPill: { flex: 1, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 12, alignItems: 'center', marginHorizontal: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statPillLabel: { fontSize: 10, color: '#64748b', fontWeight: '600', marginBottom: 4 },
  statPillVal: { fontSize: 13, color: '#1e293b', fontWeight: '700' },
  
  chartCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', elevation: 1, marginBottom: 20 },
  chartTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 12 },
  listCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', elevation: 1, paddingHorizontal: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { backgroundColor: '#eff6ff', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  rankText: { color: '#1565C0', fontSize: 12, fontWeight: '700' },
  vehicleName: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '500' },
  vehicleValue: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  emptyText: { padding: 20, textAlign: 'center', color: '#94a3b8' }
});

export default MetricDetailScreen;
