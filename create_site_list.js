const fs = require('fs');

const code = `import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert, TextInput, ScrollView, Modal
} from 'react-native';
import Header from '../../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { fetchSiteList } from '../../api/webApi';
import moment from 'moment';

const StatCard = ({ icon, color, title, value, bgColor }) => (
  <View style={[styles.statCard, { borderLeftColor: color, borderLeftWidth: 3 }]}>
    <View style={[styles.statIconWrap, { backgroundColor: bgColor }]}>
      <Icon name={icon} size={18} color={color} />
    </View>
    <View style={styles.statInfo}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  </View>
);

const CustomDropdown = ({ label, value, options, onSelect, placeholder }) => {
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <View style={styles.filterInputWrapper}>
      <Text style={styles.filterLabel}>{label}</Text>
      <TouchableOpacity style={styles.dropdownBtn} onPress={() => setModalVisible(true)}>
        <Text style={[styles.dropdownBtnText, !value && { color: '#94a3b8' }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Icon name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisible(false)}>
          <View style={styles.dropdownMenu}>
            <Text style={styles.dropdownTitle}>Select {label}</Text>
            <FlatList
              data={[{ label: \`All \${label}\`, value: '' }, ...options]}
              keyExtractor={(item, index) => String(index)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dropdownItem, value === item.value && { backgroundColor: '#f1f5f9' }]}
                  onPress={() => {
                    onSelect(item.value);
                    setModalVisible(false);
                  }}
                >
                  <Text style={[styles.dropdownItemText, value === item.value && { color: '#1a3a6b', fontWeight: 'bold' }]}>
                    {item.label}
                  </Text>
                  {value === item.value && <Icon name="check" size={16} color="#1a3a6b" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#f1f5f9' }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const SiteListReportScreen = ({ navigation }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [totalSites, setTotalSites] = useState(0);
  const [dgSites, setDgSites] = useState(0);
  const [nonDgSites, setNonDgSites] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    siteId: '',
    siteName: '',
    state: '',
    district: '',
    cluster: '',
    siteType: '',
    client: ''
  });

  const loadData = async (pageNumber = 1, isRefresh = false) => {
    if (pageNumber === 1) {
      if (!isRefresh) setLoading(true);
    }
    
    try {
      const params = {
        page: pageNumber,
        limit: 20,
        site_id: filters.siteId,
        site_name: filters.siteName,
        state: filters.state,
        district: filters.district,
        cluster: filters.cluster,
        site_type: filters.siteType,
        client: filters.client
      };

      Object.keys(params).forEach(key => !params[key] && delete params[key]);

      const resp = await fetchSiteList(params);
      
      const newSites = resp.data || resp.results || resp || [];
      const sitesArray = Array.isArray(newSites) ? newSites : [];

      if (resp.total_records !== undefined) setTotalSites(resp.total_records);
      
      // Fallback keys based on common backend naming for dg counts
      const dgCount = resp.total_dg || resp.dg_sites || resp.dg_count || resp.dg_total || 0;
      const nonDgCount = resp.total_non_dg || resp.non_dg_sites || resp.non_dg_count || resp.nondg_total || 0;
      
      if (dgCount !== undefined) setDgSites(dgCount);
      if (nonDgCount !== undefined) setNonDgSites(nonDgCount);

      if (sitesArray.length < 20) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }

      if (pageNumber === 1) {
        setData(sitesArray);
      } else {
        setData(prev => [...prev, ...sitesArray]);
      }
      setPage(pageNumber);

    } catch (e) {
      console.warn('SiteList error:', e);
      Alert.alert('Error', 'Failed to fetch site list.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(1, true);
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      loadData(page + 1);
    }
  };

  const handleApplyFilters = () => {
    setShowFilters(false);
    loadData(1);
  };

  const handleResetFilters = () => {
    setFilters({ siteId: '', siteName: '', state: '', district: '', cluster: '', siteType: '', client: '' });
    setTimeout(() => {
      loadData(1);
    }, 100);
  };

  const renderFilterInput = (key, placeholder) => (
    <View style={styles.filterInputWrapper}>
      <Text style={styles.filterLabel}>{placeholder}</Text>
      <TextInput
        style={styles.filterTextInput}
        placeholder={\`e.g. \${placeholder}\`}
        value={filters[key]}
        onChangeText={(val) => setFilters(prev => ({ ...prev, [key]: val }))}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return moment(dateString).format('DD/MM/YYYY HH:mm');
  };

  const renderItem = ({ item, index }) => {
    const siteId = item.site_id || item.siteId || 'N/A';
    const siteName = item.site_name || item.siteName || 'N/A';
    const state = item.state_name || item.state || 'N/A';
    const district = item.district_name || item.district || 'N/A';
    const cluster = item.cluster_name || item.cluster || 'N/A';
    const siteType = item.site_type || item.siteType || 'N/A';
    const client = item.ime || 'N/A';
    const lat = item.latitude || '0.00';
    const lon = item.longitude || '0.00';
    
    const isDg = siteType.toLowerCase().includes('dg') && !siteType.toLowerCase().includes('non dg');

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.siteIdWrap}>
            <View style={styles.indexCircle}><Text style={styles.indexText}>{(page - 1) * 20 + index + 1}</Text></View>
            <Icon name="tower-cell" size={16} color="#1a3a6b" style={{marginLeft: 6}} />
            <Text style={styles.siteIdText}>{siteId}</Text>
          </View>
          <View style={[styles.badge, isDg ? styles.dgBadge : styles.nonDgBadge]}>
            <Text style={[styles.badgeText, isDg ? styles.dgBadgeText : styles.nonDgBadgeText]}>
              {siteType}
            </Text>
          </View>
        </View>

        <Text style={styles.siteName}>{siteName}</Text>

        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Client</Text>
            <Text style={styles.gridValue}>{client}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Location</Text>
            <Text style={styles.gridValue}>{cluster}, {district}, {state}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Coordinates</Text>
            <Text style={styles.gridValue}>{lat}, {lon}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Created</Text>
            <Text style={styles.gridValue}>{formatDate(item.created_date)}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Updated</Text>
            <Text style={styles.gridValue}>{formatDate(item.updated_date)}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Level 1</Text>
            <Text style={styles.gridValue} numberOfLines={1}>{item.level1_name || '—'}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Level 2</Text>
            <Text style={styles.gridValue} numberOfLines={1}>{item.level2_name || '—'}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Level 3</Text>
            <Text style={styles.gridValue} numberOfLines={1}>{item.level3_name || '—'}</Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <TouchableOpacity 
            style={styles.nearDgBtn}
            onPress={() => navigation.navigate('NearDgMapScreen', { 
              site_id: siteId,
              site_name: siteName,
              latitude: lat,
              longitude: lon
            })}
          >
            <Icon name="map-marker-radius" size={16} color="#fff" style={{marginRight: 4}} />
            <Text style={styles.nearDgBtnText}>Near DG</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Site List Report" navigation={navigation} />
      
      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard icon="database" color="#3b82f6" bgColor="#dbeafe" title="TOTAL SITES" value={totalSites.toLocaleString()} />
        <StatCard icon="flash" color="#8b5cf6" bgColor="#ede9fe" title="DG SITES" value={dgSites.toLocaleString()} />
        <StatCard icon="solar-power" color="#f59e0b" bgColor="#fef3c7" title="NON DG" value={nonDgSites.toLocaleString()} />
      </View>

      {/* Filters Header Toggle */}
      <TouchableOpacity 
        style={styles.filterToggle} 
        onPress={() => setShowFilters(!showFilters)}
        activeOpacity={0.7}
      >
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Icon name="filter-variant" size={20} color="#1a3a6b" />
          <Text style={styles.filterToggleText}>Filters</Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text style={styles.filterHintText}>{showFilters ? 'Hide' : 'Show'}</Text>
          <Icon name={showFilters ? 'chevron-up' : 'chevron-down'} size={20} color="#64748b" />
        </View>
      </TouchableOpacity>

      {/* Expandable Filters */}
      {showFilters && (
        <View style={styles.filtersContainer}>
          <ScrollView contentContainerStyle={styles.filterScroll}>
            <View style={styles.filterGrid}>
              <CustomDropdown
                label="Client"
                placeholder="All Clients"
                value={filters.client}
                options={[{label: 'MRG Group', value: 'MRG Group'}, {label: 'Other', value: 'Other'}]}
                onSelect={(val) => setFilters(prev => ({...prev, client: val}))}
              />
              {renderFilterInput('siteId', 'Site ID')}
              {renderFilterInput('siteName', 'Site Name')}
              
              <CustomDropdown
                label="State"
                placeholder="All States"
                value={filters.state}
                options={[{label: 'Rajasthan', value: 'Rajasthan'}, {label: 'Delhi', value: 'Delhi'}]}
                onSelect={(val) => setFilters(prev => ({...prev, state: val}))}
              />
              <CustomDropdown
                label="District"
                placeholder="All Districts"
                value={filters.district}
                options={[{label: 'Alwar', value: 'Alwar'}, {label: 'Bikaner', value: 'Bikaner'}]}
                onSelect={(val) => setFilters(prev => ({...prev, district: val}))}
              />
              <CustomDropdown
                label="Cluster"
                placeholder="All Clusters"
                value={filters.cluster}
                options={[{label: 'Dausa', value: 'Dausa'}, {label: 'Bikaner', value: 'Bikaner'}]}
                onSelect={(val) => setFilters(prev => ({...prev, cluster: val}))}
              />
              <CustomDropdown
                label="Site Type"
                placeholder="All Types"
                value={filters.siteType}
                options={[{label: 'DG Site', value: 'DG Site'}, {label: 'Non DG', value: 'Non DG'}]}
                onSelect={(val) => setFilters(prev => ({...prev, siteType: val}))}
              />
            </View>
            
            <View style={styles.filterActions}>
              <TouchableOpacity style={styles.resetBtn} onPress={handleResetFilters}>
                <Icon name="refresh" size={16} color="#64748b" />
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={handleApplyFilters}>
                <Icon name="magnify" size={16} color="#fff" />
                <Text style={styles.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      {/* List */}
      {loading && data.length === 0 ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#1a3a6b" />
          <Text style={styles.loadingText}>Loading sites...</Text>
        </View>
      ) : data.length === 0 ? (
        <View style={styles.centerBox}>
          <Icon name="tower-cell" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>No sites found.</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item, index) => (item.site_id || item.siteId || index) + '-' + index}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a3a6b']} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={hasMore ? <ActivityIndicator size="small" color="#1a3a6b" style={{marginVertical: 10}} /> : <View style={{height: 20}} />}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  statsRow: {
    flexDirection: 'row',
    padding: 12,
    justifyContent: 'space-between'
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 4,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center'
  },
  statIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginRight: 8
  },
  statInfo: {
    flex: 1
  },
  statValue: {
    fontSize: 14, fontWeight: 'bold', color: '#0f172a'
  },
  statTitle: {
    fontSize: 9, fontWeight: '700', color: '#64748b', marginTop: 2, textTransform: 'uppercase'
  },
  filterToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  filterToggleText: { fontSize: 14, fontWeight: '700', color: '#1a3a6b', marginLeft: 8 },
  filterHintText: { fontSize: 12, color: '#64748b', marginRight: 4 },
  filtersContainer: {
    backgroundColor: '#fff', paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    elevation: 2, zIndex: 10, maxHeight: 350
  },
  filterScroll: { paddingHorizontal: 16, paddingVertical: 8 },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  filterInputWrapper: {
    width: '48%', marginBottom: 12
  },
  filterLabel: { fontSize: 10, fontWeight: 'bold', color: '#64748b', marginBottom: 4, textTransform: 'uppercase' },
  filterTextInput: {
    borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#0f172a', backgroundColor: '#f8fafc'
  },
  dropdownBtn: {
    borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#f8fafc',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  dropdownBtnText: {
    fontSize: 13, color: '#0f172a', flex: 1
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center'
  },
  dropdownMenu: {
    backgroundColor: '#fff', width: '80%', maxHeight: '60%', borderRadius: 8, paddingVertical: 8, elevation: 5
  },
  dropdownTitle: {
    fontSize: 14, fontWeight: 'bold', color: '#1a3a6b', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0'
  },
  dropdownItem: {
    paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  dropdownItemText: {
    fontSize: 14, color: '#334155'
  },
  filterActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, marginRight: 10
  },
  resetBtnText: { color: '#64748b', fontSize: 13, fontWeight: '600', marginLeft: 4 },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a3a6b',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', marginLeft: 4 },
  
  listContent: { padding: 12, paddingTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#e2e8f0', elevation: 1
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  siteIdWrap: { flexDirection: 'row', alignItems: 'center' },
  indexCircle: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 10, fontWeight: 'bold', color: '#475569' },
  siteIdText: { fontSize: 13, fontWeight: 'bold', color: '#1a3a6b', marginLeft: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' },
  dgBadge: { backgroundColor: '#ede9fe', borderWidth: 1, borderColor: '#c4b5fd' },
  dgBadgeText: { color: '#6d28d9' },
  nonDgBadge: { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fde68a' },
  nonDgBadgeText: { color: '#d97706' },
  
  siteName: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 },
  
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  gridItem: { width: '50%', paddingHorizontal: 4, marginBottom: 8 },
  gridLabel: { fontSize: 9, color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 2 },
  gridValue: { fontSize: 12, color: '#334155', fontWeight: '500' },
  
  footerRow: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9'
  },
  nearDgBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0ea5e9',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8
  },
  nearDgBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14 },
  emptyText: { marginTop: 12, color: '#94a3b8', fontSize: 15 }
});

export default SiteListReportScreen;
`;

fs.writeFileSync('src/screens/reports/SiteListReportScreen.js', code);
