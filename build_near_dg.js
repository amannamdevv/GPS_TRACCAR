const fs = require('fs');

let code = fs.readFileSync('src/screens/reports/DgBySiteScreen.js', 'utf8');

// 1. Component name
code = code.split('DgBySiteScreen').join('NearDgMapScreen');
code = code.split('fetchDgBySiteReport').join('fetchNearbyDg');
code = code.split('fetchDeviceList, ').join('');
code = code.split('Header title="DG By Site Report"').join('Header title="Near DG Report"');
code = code.split('const NearDgMapScreen = ({ navigation }) => {').join('const NearDgMapScreen = ({ route, navigation }) => {\n  const { site_id, site_name, latitude, longitude } = route.params || {};');

// 2. Remove device search states
code = code.replace(/  const \[devices, setDevices\] = useState\(\[\]\);\n  const \[selectedDevice, setSelectedDevice\] = useState\(null\);\n\n  const \[searchQuery, setSearchQuery\] = useState\(''\);\n  const \[showSuggestions, setShowSuggestions\] = useState\(false\);\n/g, '');

// 3. Remove useEffect for getDevices
code = code.replace(/  useEffect\(\(\) => \{\n    const getDevices = async \(\) => \{[\s\S]*?\}, \[\]\);\n/g, '');

// 4. Remove getDisplayName and getFilteredDevices
code = code.replace(/  const getDisplayName = \([\s\S]*?  \};\n/g, '');
code = code.replace(/  const getFilteredDevices = \([\s\S]*?  \};\n/g, '');

// 5. Change towersList to dgList
code = code.split('const [towersList, setTowersList] = useState([]);').join('const [dgList, setDgList] = useState([]);');
code = code.split('setTowersList').join('setDgList');
code = code.split('towersList').join('dgList');
code = code.split('renderTowerCard').join('renderDgCard');

// 6. Rewrite loadData
const loadDataRegex = /  const loadData = async \(deviceOverride, radiusOverride\) => \{[\s\S]*?  \};\n/g;
const newLoadData = `  const loadData = async (radiusOverride) => {
    const rad = radiusOverride !== undefined ? radiusOverride : radius;
    if (!site_id) {
      Alert.alert('Warning', 'No Site ID provided.');
      return;
    }

    setLoading(true);
    setDgList([]);
    setReportData(null);

    try {
      let allDgs = [];
      let p = 1;
      let hasMore = true;
      let rData = null;

      while (hasMore) {
        const resp = await fetchNearbyDg({
          site_id: site_id,
          radius: rad,
          page: p,
          limit: 100
        });

        if (!rData && resp) rData = resp;
        const items = resp.data || resp.results || [];
        allDgs = [...allDgs, ...items];
        
        if (items.length < 100) {
          hasMore = false;
        } else {
          p++;
        }
      }

      setReportData(rData);
      setDgList(allDgs);

      if (webviewRef.current) {
        const payload = JSON.stringify({
          type: 'DATA',
          center: {
             latitude: parseFloat(latitude || rData?.site?.latitude || 0),
             longitude: parseFloat(longitude || rData?.site?.longitude || 0),
             site_id: site_id,
             site_name: site_name || rData?.site?.site_name || 'Site'
          },
          radius: rad,
          items: allDgs
        });
        webviewRef.current.postMessage(payload);
      }
    } catch (err) {
      Alert.alert('Error', err.message);
      if (webviewRef.current) webviewRef.current.postMessage(JSON.stringify({ type: 'CLEAR' }));
    } finally {
      setLoading(false);
    }
  };
`;
code = code.replace(loadDataRegex, newLoadData);

// 7. handleApply and handleReset
const applyRegex = /  const handleApply = \(\) => \{[\s\S]*?  \};\n/g;
const newApply = `  const handleApply = () => {
    loadData();
  };

  const handleReset = () => {
    setRadius('10');
    setDgList([]);
    setReportData(null);
    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify({ type: 'CLEAR' }));
    }
  };
`;
code = code.replace(applyRegex, newApply);
code = code.replace(/  const handleReset = \(\) => \{[\s\S]*?  \};\n/g, '');

// 8. UseEffect to auto-load since we have site_id
const autoLoad = `  useEffect(() => {
    if (site_id) {
      loadData('10');
    }
  }, [site_id]);\n\n`;
code = code.split('  const renderDgCard').join(autoLoad + '  const renderDgCard');

// 9. Fix renderHeader JSX to remove search bar
const renderHeaderRegex = /          \{\/\* SEARCH BAR \*\/\}[\s\S]*?          \{\/\* RADIUS AND APPLY \*\/\}/g;
code = code.replace(renderHeaderRegex, '          {/* RADIUS AND APPLY */}');
// Also remove showSuggestions box
code = code.replace(/          \{showSuggestions && filteredDevices\.length === 0[\s\S]*?          \}/g, '');

// 10. Fix map HTML script to swap center and items
const mapHtmlStart = /        var payload = JSON.parse\(event.data\);\n        if \(payload.type === 'CLEAR'\)/g;
const newMapHtmlStart = `        var payload = JSON.parse(event.data);
        if (payload.type === 'CLEAR') {
          markers.forEach(m => map.removeLayer(m));
          markers = [];
          if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
          return;
        }
        if (payload.type === 'DATA') {
          markers.forEach(m => map.removeLayer(m));
          markers = [];
          if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }

          var centerLat = payload.center.latitude;
          var centerLon = payload.center.longitude;
          
          if (!centerLat || !centerLon) return;

          // Draw Radius
          radiusCircle = L.circle([centerLat, centerLon], {
            color: '#1a3a6b', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1.5, radius: payload.radius * 1000
          }).addTo(map);

          // Draw Site Center Marker
          var siteMarker = L.marker([centerLat, centerLon], { icon: createTowerIcon(false, payload.center) }).addTo(map);
          var sitePopup = "<div class='dev-popup'>" +
                          "<div class='dev-popup-title'>" + (payload.center.site_name || 'N/A') + "</div>" +
                          "<div class='dev-popup-grid'>" +
                          "<div class='dev-field'><div class='dev-lbl'>Site ID</div><div class='dev-val'>" + payload.center.site_id + "</div></div>" +
                          "</div></div>";
          siteMarker.bindPopup(sitePopup);
          markers.push(siteMarker);

          var group = [radiusCircle];
          
          // Draw DGs
          (payload.items || []).forEach(function(d) {
            var mLat = d.latitude;
            var mLon = d.longitude;
            if (mLat && mLon) {
              var popupHtml = "<div class='dev-popup'>" +
                              "<div class='dev-popup-title'>" + (d.dg_name || d.name || 'Unknown DG') + "</div>" +
                              "<div class='dev-popup-grid'>" +
                              "<div class='dev-field'><div class='dev-lbl'>IMEI</div><div class='dev-val'>" + (d.gps_imei || d.imei || 'N/A') + "</div></div>" +
                              "<div class='dev-field'><div class='dev-lbl'>Status</div><div class='dev-val'>" +
                              (d.status === 'online' ? "<span class='badge badge-online'>ONLINE</span>" :
                              d.status === 'offline' ? "<span class='badge badge-offline'>OFFLINE</span>" :
                              "<span class='badge badge-unknown'>UNKNOWN</span>") +
                              "</div></div>" +
                              "<div class='dev-field'><div class='dev-lbl'>Speed</div><div class='dev-val'>" + ((d.speed || 0)*1.852).toFixed(2) + " km/h</div></div>" +
                              "<div class='dev-field'><div class='dev-lbl'>Motion</div><div class='dev-val'>" + (d.motion ? 'Yes 🏃' : 'No 🛑') + "</div></div>" +
                              "<div class='dev-field'><div class='dev-lbl'>Distance</div><div class='dev-val'>" + (d.distance || 0) + " km</div></div>" +
                              "<div class='dev-field full'><div class='dev-lbl'>Updated</div><div class='dev-val'>" + (d.position_time || d.lastUpdate || 'N/A') + "</div></div>" +
                              "</div></div>";
              var marker = L.marker([mLat, mLon], { icon: devIcon }).addTo(map);
              marker.bindPopup(popupHtml);
              markers.push(marker);
              group.push(marker);
            }
          });
          
          setTimeout(function() {
            var featureGroup = L.featureGroup(group);
            map.invalidateSize();
            map.fitBounds(featureGroup.getBounds(), { padding: [30, 30], maxZoom: 16, animate: true, duration: 1 });
          }, 400);
        }
`;

code = code.replace(/        var payload = JSON\.parse\(event\.data\);[\s\S]*?          \}, 400\);\n        \}/g, newMapHtmlStart);

fs.writeFileSync('src/screens/reports/NearDgMapScreen.js', code);
