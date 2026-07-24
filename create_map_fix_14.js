const fs = require('fs');

let code = fs.readFileSync('src/screens/reports/NearDgMapScreen.js', 'utf8');

// 1. Change StatCards
const oldStats = `  const renderStats = () => {
    if (!reportData) return null;
    let dgCount = 0; let nonDgCount = 0;
    dgList.forEach(t => {
      const st = t.site_type ? t.site_type.toUpperCase().trim() : '';
      if (st.includes('DG') && !st.includes('NON')) dgCount++; else nonDgCount++;
    });

    // Additional device stats (assuming they come from reportData.devices if available)
    const devs = reportData.devices || [];
    const dgDevices = devs.length;
    let onlineDevs = 0;
    let dgOn = 0;
    let dgOff = 0;
    devs.forEach(d => {
      if (d.status === 'online') onlineDevs++;
      if (d.dg_status && d.dg_status.toUpperCase() === 'ON') dgOn++;
      else dgOff++;
    });

    return (
      <View style={styles.statsGrid}>
        <StatCard title="Total Towers" value={dgList.length} icon="radio-tower" color="#1a3a6b" bgColor="#eff6ff" />
        <StatCard title="DG Devices" value={dgDevices} icon="truck" color="#7c3aed" bgColor="#ede9fe" />
        <StatCard title="Online" value={onlineDevs} icon="check-circle" color="#10b981" bgColor="#d1fae5" />
        <StatCard title="DG ON" value={dgOn} icon="power-plug" color="#eab308" bgColor="#fef08a" />
        <StatCard title="DG OFF" value={dgOff} icon="power-plug-off" color="#ef4444" bgColor="#fee2e2" />
        <StatCard title="DG Sites" value={dgCount} icon="lightning-bolt" color="#0B66BD" bgColor="#dbeafe" />
        <StatCard title="Non DG" value={nonDgCount} icon="office-building" color="#6B7280" bgColor="#f3f4f6" />
      </View>
    );
  };`;

const newStats = `  const renderStats = () => {
    if (!reportData) return null;
    let onlineDevs = 0; let offlineDevs = 0; let dgOn = 0; let totalDist = 0;
    dgList.forEach(d => {
      if (String(d.status).toLowerCase() === 'online') onlineDevs++;
      else offlineDevs++;
      
      if (d.dg_status === 1 || d.dg_status === '1' || d.dg_status === 'ON' || d.ignition === 1) dgOn++;
      
      if (d.distance) totalDist += parseFloat(d.distance);
    });

    const avgDist = dgList.length > 0 ? (totalDist / dgList.length).toFixed(1) : 0;
    const siteName = reportData?.site?.site_name || site_name || 'Site';

    return (
      <View style={styles.statsGrid}>
        <StatCard title="Site" value={siteName} icon="map-marker-outline" color="#1a3a6b" bgColor="#eff6ff" />
        <StatCard title="Radius (KM)" value={radius} icon="record-circle-outline" color="#f59e0b" bgColor="#fef3c7" />
        <StatCard title="DGs Found" value={dgList.length} icon="crosshairs-gps" color="#7c3aed" bgColor="#ede9fe" />
        <StatCard title="Online" value={onlineDevs} icon="check-circle" color="#10b981" bgColor="#d1fae5" />
        <StatCard title="Offline" value={offlineDevs} icon="close-circle" color="#ef4444" bgColor="#fee2e2" />
        <StatCard title="DG Running" value={dgOn} icon="power-plug" color="#eab308" bgColor="#fef08a" />
        <StatCard title="Avg Dist" value={avgDist} icon="map-marker-distance" color="#0B66BD" bgColor="#dbeafe" />
      </View>
    );
  };`;

code = code.replace(oldStats, newStats);

// 2. Remove the dark blue Info Banner
const bannerRegex = /<View style=\{\{\s*backgroundColor:\s*'#1a3a6b'[\s\S]*?<\/View>\s*<\/View>\s*<\/View>/;
code = code.replace(bannerRegex, "");

// 3. Fix type: 'DATA' to type: 'PLOT'
code = code.replace(/type:\s*'DATA',/g, "type: 'PLOT',");

// 4. Ensure site is plotted as well (as center point) in generateMapHtml
// The map currently plots "towers", but Near DG API only returns `site` (the center site) and `data` (DGs).
// So let's make sure the center site is plotted if it exists.
const towerPlotCode = `          if (data.center) {
             var icon = createTowerIcon(false, data.center);
             var m = L.marker([data.center.latitude, data.center.longitude], { icon: icon, zIndexOffset: 999 }).addTo(map);
             m.bindPopup("<div class='dev-popup'><div class='dev-popup-title' style='color:#94a3b8'>&#128333; " + (data.center.site_name || 'Site') + "</div></div>");
             markers.push(m);
             // Plot radius circle around center site
             if (data.radius && data.radius > 0 && !radiusCircle) {
                radiusCircle = L.circle([data.center.latitude, data.center.longitude], { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1, radius: data.radius * 1000, weight: 1, dashArray: '5,5' }).addTo(map);
                bounds.extend(radiusCircle.getBounds());
             }
          }`;

// Find where device iteration happens in generateMapHtml and inject center plotting logic before it
code = code.replace(
  /var deviceCenter = null;\s*if \(data\.devices && data\.devices\.length > 0\) \{/m,
  towerPlotCode + `\n\n          var deviceCenter = null;\n          if (data.devices && data.devices.length > 0) {`
);

// Remove the old radius circle logic inside the devices loop since we plot it around the center site now
code = code.replace(
  /if \(data\.radius && data\.radius > 0 && !radiusCircle\) \{[\s\S]*?bounds\.extend\(\[d\.latitude, d\.longitude\]\);\s*\}/m,
  "bounds.extend([d.latitude, d.longitude]);"
);

fs.writeFileSync('src/screens/reports/NearDgMapScreen.js', code);
