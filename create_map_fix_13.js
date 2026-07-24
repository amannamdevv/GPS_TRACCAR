const fs = require('fs');

let code = fs.readFileSync('src/screens/reports/NearDgMapScreen.js', 'utf8');

// 1. Fix Map rendering: change "items: allDgs" to "devices: allDgs" in loadData
code = code.replace("items: allDgs", "devices: allDgs");

// 2. Fix the card layout to match JSON and the screenshot
const oldRenderDgCardRegex = /const renderDgCard = \(\{ item \}\) => \{[\s\S]*?return \([\s\S]*?<\/View>\s*\);\s*\};/;

const newRenderDgCard = `const renderDgCard = ({ item }) => {
    const site = item.site || {};
    const dgStatus = (item.ignition === 1 || item.dg_status === 1 || item.dg_status === 'ON') ? 'ON' : 'OFF';
    
    return (
      <View style={styles.towerCompactCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDeviceName} numberOfLines={1}>
            {item.dg_name || 'Unknown DG'} 
            <Text style={{ color: '#94a3b8', fontWeight: '400', fontSize: 12 }}>  (ID: {item.deviceid || 'N/A'})</Text>
          </Text>
          <View style={[styles.badge, { backgroundColor: item.status === 'online' ? '#d1fae5' : '#f1f5f9' }]}>
            <Text style={[styles.badgeText, { color: item.status === 'online' ? '#16a34a' : '#64748b' }]}>
              {String(item.status || 'unknown').toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={{ flex: 1.2 }}>
             <Text style={styles.cardLabel}>SITE INFO</Text>
             <Text style={styles.cardValue}>{site.site_id || 'N/A'}</Text>
             <Text style={[styles.cardValue, { fontSize: 11, color: '#64748b', marginTop: 2 }]} numberOfLines={1}>{site.site_name || 'N/A'}</Text>
          </View>
          <View style={{ flex: 1 }}>
             <Text style={styles.cardLabel}>SITE LOCATION</Text>
             <Text style={[styles.cardValue, {fontSize: 11}]}>{site.latitude ? parseFloat(site.latitude).toFixed(5) : '-'},</Text>
             <Text style={[styles.cardValue, {fontSize: 11}]}>{site.longitude ? parseFloat(site.longitude).toFixed(5) : '-'}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
             <Text style={styles.cardLabel}>DISTANCE</Text>
             <Text style={[styles.cardValue, { color: '#eab308', fontWeight: 'bold' }]}>{item.distance} km</Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
             <Text style={styles.cardLabel}>GPS IMEI</Text>
             <Text style={styles.cardValue}>{item.gps_imei || 'N/A'}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
             <Text style={styles.cardLabel}>DG STATUS</Text>
             <View style={[styles.badge, dgStatus === 'ON' ? { backgroundColor: '#fef08a' } : { backgroundColor: '#fee2e2' }]}>
               <Text style={[styles.badgeText, dgStatus === 'ON' ? { color: '#ca8a04' } : { color: '#dc2626' }]}>DG {dgStatus}</Text>
             </View>
          </View>
        </View>

        <View style={[styles.cardRow, { marginBottom: 0, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' }]}>
          <View style={{ flex: 1 }}>
             <Text style={styles.cardLabel}>DG LOCATION: </Text>
             <Text style={[styles.cardValue, { fontSize: 11, color: '#475569', marginBottom: 2 }]}>{item.address || 'N/A'}</Text>
             <Text style={[styles.cardValue, { fontSize: 10, color: '#94a3b8' }]}>{item.latitude}, {item.longitude}</Text>
          </View>
        </View>
      </View>
    );
  };`;

code = code.replace(oldRenderDgCardRegex, newRenderDgCard);

fs.writeFileSync('src/screens/reports/NearDgMapScreen.js', code);
