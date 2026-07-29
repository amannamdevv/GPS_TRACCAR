// PlaybackScreen.js

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text,
  ActivityIndicator, StatusBar, Dimensions, Modal, ScrollView, Pressable
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import moment from 'moment';
import DatePicker from '../../components/CalendarPickerModal';
import { reverseGeocode, fetchPositionHistory, getTripsReport } from '../../api/webApi';

const { width } = Dimensions.get('window');
const fmt = (m) => m.format('YYYY-MM-DD HH:mm:ss');
const fmtDate = (m) => m.format('YYYY-MM-DD');

// Haversine distance
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const courseLabel = (deg) => {
  const dirs = ['North', 'NE', 'East', 'SE', 'South', 'SW', 'West', 'NW'];
  return dirs[Math.round((deg || 0) / 45) % 8];
};

const computeMileage = (points, targetTotalKm = 0) => {
  if (points.length === 0) return [];
  const miles = [0];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversine(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude,
    );
    // Only accumulate distance if vehicle is moving, to avoid stationary GPS drift
    if ((points[i].speedKmh || 0) > 2) {
      acc += d / 1000;
    }
    miles.push(acc);
  }

  // Scale the local running mileage to exactly match the API's total distance
  if (targetTotalKm > 0 && acc > 0) {
    const scale = targetTotalKm / acc;
    for (let i = 0; i < miles.length; i++) {
      miles[i] *= scale;
    }
  }
  return miles;
};

// Total moving-time vs stopped-time for the whole loaded day
const computeTimeSplit = (points) => {
  let moveMs = 0, stopMs = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = moment(points[i].fixTime).valueOf() - moment(points[i - 1].fixTime).valueOf();
    if (dt <= 0) continue;
    if (points[i - 1].final_status === 'MOVE') moveMs += dt; else stopMs += dt;
  }
  return { moveMs, stopMs };
};

const fmtDuration = (ms) => {
  const totalMin = Math.floor((ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const getStatusColor = (s) => {
  if (!s) return '#94a3b8';
  const u = String(s).toUpperCase();
  if (u === 'MOVE' || u === 'MOVING') return '#4ade80';
  if (u === 'STOP' || u === 'STOPPED') return '#f97316';
  if (u === 'IDLE') return '#facc15';
  return '#94a3b8';
};

// Normalize a single point from positions_view
const normalizePoint = (p) => {
  const speedKmh = parseFloat(p.speed ?? 0) * 1.852; // Convert knots to km/h
  let attrs = {};
  try {
    if (typeof p.attributes === 'string') attrs = JSON.parse(p.attributes);
    else if (typeof p.attributes === 'object') attrs = p.attributes;
  } catch (e) { }

  const isMoving = speedKmh > 2;
  const final_status = isMoving ? 'MOVE' : 'STOP';
  return {
    latitude: parseFloat(p.latitude ?? 0),
    longitude: parseFloat(p.longitude ?? 0),
    speedKmh: speedKmh,
    course: parseFloat(p.course ?? 0),
    fixTime: p.fixtime || p.devicetime || null,
    final_status: isMoving ? 'MOVE' : 'STOP',
    totalDistance: parseFloat(attrs.totalDistance ?? 0),
  };
};

const PlaybackScreen = ({ route, navigation }) => {
  const { device, initialDate } = route.params;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Time modal
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [timeframe, setTimeframe] = useState(initialDate ? 'custom' : 'today');
  const [tempTf, setTempTf] = useState(initialDate ? 'custom' : 'today');
  const [customStart, setCustomStart] = useState(initialDate ? new Date(initialDate) : new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);

  // Playback state
  const [routePoints, setRoutePoints] = useState([]);
  const [mileageArr, setMileageArr] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [currentAddress, setCurrentAddress] = useState('');
  const [showHUD, setShowHUD] = useState(false);
  const [timeSplit, setTimeSplit] = useState({ moveMs: 0, stopMs: 0 }); // total move/stop time for the day
  const [apiSummary, setApiSummary] = useState({ distance: '0.00', moveMs: 0, stops: 0 });

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState(0);
  const [followMode, setFollowMode] = useState(true);

  // HUD telemetry
  const [liveTel, setLiveTel] = useState({
    speed: 0, course: 0, courseDir: 'North',
    mileage: '0.00', status: '—', time: '—',
  });

  // Refs
  const animationRef = useRef(null);
  const routePointsRef = useRef([]);
  const mileageArrRef = useRef([]);
  const currentAddressRef = useRef('');
  const addressCacheRef = useRef({});
  const lastGeoIndexRef = useRef(-1);
  const lastBridgeSendRef = useRef(0);
  const lastTelUpdateRef = useRef(0);
  const currentIndexRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const progBarLayoutRef = useRef({ x: 0, width: BAR_WIDTH });
  const lastSeekDragRef = useRef(0);
  const followModeRef = useRef(followMode);

  // Stop-pause tracking (auto-pause for 2s when playback reaches a stop)
  const stopsRef = useRef([]);
  const pausedStopsRef = useRef(new Set());
  const isPlayingRef = useRef(false);
  const pauseTimeoutRef = useRef(null);

  const abortControllerRef = useRef(null);

  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { mileageArrRef.current = mileageArr; }, [mileageArr]);
  useEffect(() => { currentAddressRef.current = currentAddress; }, [currentAddress]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { followModeRef.current = followMode; }, [followMode]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const deviceId = device.deviceid ?? device.id;
  const BAR_WIDTH = width - 40;
  const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20];

  // Send message to map
  const sendToMap = useCallback((type, payload = {}) => {
    if (!webViewRef.current) return;
    const s = JSON.stringify({ type, ...payload });
    webViewRef.current.injectJavaScript(`window.dispatchPlayback(${JSON.stringify(s)});true;`);
  }, []);

  // Zoom
  const zoomIn = useCallback(() => {
    webViewRef.current?.injectJavaScript(`map.zoomIn();true;`);
  }, []);
  const zoomOut = useCallback(() => {
    webViewRef.current?.injectJavaScript(`map.zoomOut();true;`);
  }, []);

  // Cached geocode
  const getCachedAddress = useCallback(async (lat, lng) => {
    const key = `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
    if (addressCacheRef.current[key]) return addressCacheRef.current[key];
    try {
      const addr = await reverseGeocode(lat, lng);
      if (addr) addressCacheRef.current[key] = addr;
      return addr || '';
    } catch { return ''; }
  }, []);

  // Selected date shown in header & on the map — always DD/MM/YYYY, always a single day
  const selectedDateStr = useMemo(() => {
    switch (timeframe) {
      case 'yesterday':
        return moment().subtract(1, 'day').format('DD/MM/YYYY');
      case 'custom':
        return moment(customStart).format('DD/MM/YYYY');
      case 'hour':
      case 'today':
      default:
        return moment().format('DD/MM/YYYY');
    }
  }, [timeframe, customStart]);

  // Time range builder
  const getTimeRange = useCallback((tf) => {
    const now = moment();
    switch (tf) {
      case 'today':
        return {
          from: fmt(now.clone().startOf('day')),
          to: fmt(now),
          fromDate: fmtDate(now),
          toDate: fmtDate(now),
        };
      case 'yesterday':
        const yday = now.clone().subtract(1, 'day');
        return {
          from: fmt(yday.clone().startOf('day')),
          to: fmt(yday.clone().endOf('day')),
          fromDate: fmtDate(yday),
          toDate: fmtDate(yday),
        };
      case 'hour':
        return {
          from: fmt(now.clone().subtract(1, 'hour')),
          to: fmt(now),
          fromDate: fmtDate(now),
          toDate: fmtDate(now),
        };
      case 'custom':
      default:
        // Single day only — never a date range. 00:00:00 -> 23:59:59 of the chosen day.
        const cDate = moment(customStart);
        return {
          from: fmt(cDate.clone().startOf('day')),
          to: fmt(cDate.clone().endOf('day')),
          fromDate: fmtDate(cDate),
          toDate: fmtDate(cDate),
        };
    }
  }, [customStart]);

  // Main load
  const loadAndAnimate = useCallback(async (tf) => {
    if (!mapReady) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setLoadError('');
    setShowHUD(false);
    setIsPlaying(false);
    setCurrentIndex(0);
    elapsedMsRef.current = 0;
    setRoutePoints([]);
    setMileageArr([]);
    setCurrentAddress('');
    setLiveTel({ speed: 0, course: 0, courseDir: 'North', mileage: '0.00', status: '—', time: '—' });
    setTimeSplit({ moveMs: 0, stopMs: 0 });
    setApiSummary({ distance: '0.00', moveMs: 0, stops: 0 });
    lastGeoIndexRef.current = -1;
    stopsRef.current = [];
    pausedStopsRef.current = new Set();
    if (pauseTimeoutRef.current) { clearTimeout(pauseTimeoutRef.current); pauseTimeoutRef.current = null; }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const { from, to, fromDate, toDate } = getTimeRange(tf);

    try {
      const [raw, trips] = await Promise.all([
        fetchPositionHistory(deviceId, fromDate, toDate, { signal }),
        getTripsReport(deviceId, fromDate, toDate)
      ]);
      if (signal.aborted) return;

      let apiDist = 0;
      let apiMoveMs = 0;
      let apiStops = 0;
      trips.forEach(t => {
        const st = (t.status || '').toUpperCase();
        if (st === 'MOVE' || st === 'MOVING') {
          apiDist += (t.distance || 0); // distance in meters
          apiMoveMs += (t.duration || 0) * 1000; // duration in ms
        }
        if (st === 'STOP' || st === 'STOPPED') {
          apiStops++;
        }
      });
      setApiSummary({
        distance: (apiDist / 1000).toFixed(2),
        moveMs: apiMoveMs,
        stops: apiStops
      });

      if (!raw || raw.length === 0) {
        setLoadError('No data found for the selected time range.');
        sendToMap('CLEAR_ALL');
        setLoading(false);
        return;
      }

      let points = raw
        .filter(p => String(p.deviceid) === String(deviceId) || String(p.device_id) === String(deviceId) || p.deviceid == null)
        .map(normalizePoint)
        .filter(p => p.latitude !== 0 && p.longitude !== 0);

      // Client‑side time filter for points
      const fromMs = moment(from, 'YYYY-MM-DD HH:mm:ss').valueOf();
      const toMs = moment(to, 'YYYY-MM-DD HH:mm:ss').valueOf();
      points = points.filter(p => {
        if (!p.fixTime) return false;
        const t = moment(p.fixTime).valueOf();
        return t >= fromMs && t <= toMs;
      });

      if (points.length === 0) {
        setLoadError('No GPS data found for the selected time range.');
        sendToMap('CLEAR_ALL');
        setLoading(false);
        return;
      }

      // Sort ascending by fixTime
      points.sort((a, b) => moment(a.fixTime).valueOf() - moment(b.fixTime).valueOf());

      // Deduplicate consecutive identical coordinates
      if (points.length > 0) {
        const deduped = [points[0]];
        for (let i = 1; i < points.length; i++) {
          const prev = deduped[deduped.length - 1];
          if (
            Math.abs(points[i].latitude - prev.latitude) > 0.00001 ||
            Math.abs(points[i].longitude - prev.longitude) > 0.00001
          ) deduped.push(points[i]);
        }
        points = deduped;
      }

      if (points.length < 2) {
        setLoadError('Only one GPS point found — at least 2 needed.');
        setLoading(false);
        return;
      }

      const miles = computeMileage(points, apiDist / 1000);
      setRoutePoints(points);
      setMileageArr(miles);
      setTimeSplit(computeTimeSplit(points));

      // Use stops directly from the API trips response for exact match
      const stopEventsRaw = [];
      trips.forEach(t => {
        const st = (t.status || '').toUpperCase();
        if (st === 'STOP' || st === 'STOPPED') {
          // Filter stops that are outside the requested time window
          const tripStartMs = moment(t.startTime).valueOf();
          const tripEndMs = t.endTime ? moment(t.endTime).valueOf() : tripStartMs;
          if (tripStartMs > toMs || tripEndMs < fromMs) return;

          // Find closest point index for animation matching
          let closestIdx = 0;
          let minDist = Infinity;
          const tStartMs = moment(t.startTime).valueOf();
          for (let i = 0; i < points.length; i++) {
            const pMs = moment(points[i].fixTime).valueOf();
            const diff = Math.abs(pMs - tStartMs);
            if (diff < minDist) {
              minDist = diff;
              closestIdx = i;
            }
          }
          stopEventsRaw.push({
            lat: t.startLat,
            lng: t.startLon,
            startTime: t.startTime,
            endTime: t.endTime,
            durationSec: t.duration || 0,
            startIdx: closestIdx,
            endIdx: closestIdx,
            apiAddress: t.startAddress || null,
          });
        }
      });

      // Reverse-geocode each stop (using API address if available, else local)
      const stopEvents = await Promise.all(stopEventsRaw.map(async (st) => {
        let addr = st.apiAddress || '';
        if (!addr) {
          try { addr = await getCachedAddress(st.lat, st.lng); } catch { addr = ''; }
        }
        const dur = st.durationSec;
        return {
          lat: st.lat,
          lng: st.lng,
          startIdx: st.startIdx,
          endIdx: st.endIdx,
          startTime: moment(st.startTime).format('DD MMM HH:mm'),
          endTime: moment(st.endTime).format('DD MMM HH:mm'),
          duration: dur >= 3600
            ? Math.floor(dur / 3600) + 'h ' + Math.floor((dur % 3600) / 60) + 'm'
            : Math.floor(dur / 60) + 'm',
          address: addr || 'Address Not Available',
        };
      }));

      stopsRef.current = stopEvents;
      pausedStopsRef.current = new Set();

      const fp = points[0];
      const lp = points[points.length - 1];

      setLiveTel({
        speed: parseFloat(fp.speedKmh).toFixed(0),
        course: parseFloat(fp.course).toFixed(0),
        courseDir: courseLabel(fp.course),
        mileage: '0.00',
        status: fp.final_status || '—',
        time: moment(fp.fixTime).format('HH:mm:ss'),
      });

      // Draw full route on map
      const startMs = moment(points[0].fixTime).valueOf();
      const mapCoords = points.map((p, i) => ({
        lat: p.latitude, lng: p.longitude,
        ms: moment(p.fixTime).valueOf() - startMs,
        spd: p.speedKmh, crs: p.course, mlg: miles[i],
        fixMs: moment(p.fixTime).valueOf()
      }));

      sendToMap('LOAD_FULL_ROUTE', {
        coords: mapCoords,
        stops: stopEvents,
        startCoord: [fp.latitude, fp.longitude],
        endCoord: [lp.latitude, lp.longitude],
        startTime: moment(fp.fixTime).format('DD MMM YYYY, HH:mm:ss'),
        endTime: moment(lp.fixTime).format('DD MMM YYYY, HH:mm:ss'),
        totalKm: miles[miles.length - 1]?.toFixed(2) || '0.00',
        selectedDate: selectedDateStr,
        firstTelemetry: {
          time: moment(fp.fixTime).format('YYYY-MM-DD HH:mm:ss'),
          speed: parseFloat(fp.speedKmh).toFixed(0),
          course: parseFloat(fp.course).toFixed(0),
          courseDir: courseLabel(fp.course),
          mileage: '0.00',
          status: fp.final_status || '—',
          address: '',
        },
      });

      // Fetch start and end addresses in parallel
      const [startAddr, endAddr] = await Promise.all([
        getCachedAddress(fp.latitude, fp.longitude),
        getCachedAddress(lp.latitude, lp.longitude),
      ]);
      setCurrentAddress(startAddr);

      // Send addresses to update S and E marker popups
      sendToMap('SET_MARKER_INFO', {
        startAddress: startAddr || '',
        endAddress: endAddr || '',
        startTime: moment(fp.fixTime).format('DD MMM YYYY, HH:mm:ss'),
        endTime: moment(lp.fixTime).format('DD MMM YYYY, HH:mm:ss'),
      });

      setShowHUD(true);
    } catch (e) {
      if (!signal.aborted) {
        console.warn('[loadAndAnimate]', e);
        setLoadError('An error occurred while loading data.');
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [mapReady, deviceId, sendToMap, getTimeRange, getCachedAddress, selectedDateStr]);

  // Auto‑load once map is ready
  useEffect(() => {
    if (mapReady && !showTimeModal) loadAndAnimate(timeframe);
  }, [mapReady]); // eslint-disable-line

  // Playback Control Sync
  useEffect(() => {
    if (routePoints.length < 2) return;
    if (isPlaying) {
      sendToMap('PLAY', { speed: playSpeed, elapsed: elapsedMsRef.current, follow: followModeRef.current });
    } else {
      sendToMap('PAUSE');
    }
  }, [isPlaying, playSpeed]);

  useEffect(() => {
    sendToMap('UPDATE_FOLLOW', { follow: followMode });
  }, [followMode]);

  // Seek
  const seekTo = useCallback((idx) => {
    const pts = routePointsRef.current;
    if (idx < 0 || idx >= pts.length) return;
    setCurrentIndex(idx);
    if (pts.length > 0) {
      const s0 = moment(pts[0].fixTime).valueOf();
      elapsedMsRef.current = moment(pts[idx].fixTime).valueOf() - s0;
    }

    // Keep "pause only once per stop" consistent with manual seeking: stops
    // already behind the seek point are marked as done, stops ahead are reset
    // so they can still trigger their one-time pause when reached.
    stopsRef.current.forEach((st, si) => {
      if (st.startIdx <= idx) pausedStopsRef.current.add(si);
      else pausedStopsRef.current.delete(si);
    });
    sendToMap('SEEK', { elapsed: elapsedMsRef.current });
  }, [sendToMap]);

  const onMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'MAP_READY') setMapReady(true);
      if (msg.type === 'SYNC') {
        elapsedMsRef.current = msg.elapsed;
        const newIdx = msg.idx;

        // Check for stops manually
        const stops = stopsRef.current;
        let hitStopIdx = -1;
        for (let si = 0; si < stops.length; si++) {
          if (stops[si].startIdx === newIdx && !pausedStopsRef.current.has(si)) { hitStopIdx = si; break; }
        }
        if (hitStopIdx !== -1) {
          pausedStopsRef.current.add(hitStopIdx);
        }

        if (newIdx !== lastGeoIndexRef.current) {
          lastGeoIndexRef.current = newIdx;
          setCurrentIndex(newIdx);
          getCachedAddress(routePointsRef.current[newIdx].latitude, routePointsRef.current[newIdx].longitude).then(addr => {
            if (addr) setCurrentAddress(addr);
          });
        }
        setLiveTel({
          speed: msg.tel.speed,
          course: msg.tel.course,
          courseDir: courseLabel(msg.tel.course),
          mileage: msg.tel.mileage,
          status: msg.tel.status,
          time: moment(msg.tel.fixMs).format('HH:mm:ss'),
        });
      }
      if (msg.type === 'END') {
        setIsPlaying(false);
        elapsedMsRef.current = msg.elapsed;
        setCurrentIndex(routePointsRef.current.length - 1);
      }
    } catch (_) { }
  }, [getCachedAddress]);

  const progress = routePoints.length > 1
    ? (currentIndex / (routePoints.length - 1)) * 100 : 0;
  const totalKm = mileageArr.length > 0
    ? mileageArr[mileageArr.length - 1].toFixed(2) : '0.00';

  // Label shown inside the filter chip — keeps "Today"/"Yesterday"/"Last 1 Hr"
  // wording, but Custom Date now always shows the single selected day (DD/MM/YYYY).
  const tfLabel = {
    today: 'Today',
    yesterday: 'Yesterday',
    hour: 'Last 1 Hr',
    custom: selectedDateStr,
  };

  // Map HTML (Leaflet map + stop markers + date badge; logic driven via postMessage)
  const mapHtml = useMemo(() => `
<!DOCTYPE html><html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-polylinedecorator/dist/leaflet.polylineDecorator.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{background:#0d1117;width:100%;height:100%;overflow:hidden}
    #map{height:100vh;width:100vw}
    .lpw{background:rgba(8,10,18,0.98)!important;border:1px solid rgba(249,115,22,0.4)!important;border-radius:14px!important;box-shadow:0 10px 40px rgba(0,0,0,.9)!important;padding:0!important}
    .lpt{background:rgba(8,10,18,0.98)!important}
    .lpc{padding:10px 14px!important;font-family:'Segoe UI',system-ui,sans-serif!important;min-width:190px}
    .lpc .hdr{font-size:9px;color:#f97316;text-transform:uppercase;letter-spacing:1.2px;font-weight:900;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(249,115,22,0.18)}
    .lpc .row{display:flex;gap:6px;align-items:center;padding:2.5px 0}
    .lpc .lbl{color:#4b5563;min-width:65px;font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0}
    .lpc .val{color:#fff;font-weight:800;font-size:12.5px}
    .lpc .spd{color:#4ade80;font-size:15px}
    .lpc .spdu{font-size:10px;color:#86efac;font-weight:500}
    .lpc .crs{color:#facc15}
    .lpc .mlg{color:#60a5fa}
    .lpc .tm{color:#e2e8f0;font-size:11px;font-weight:600}
    .lpc .stmove{color:#4ade80;font-weight:800;font-size:11px}
    .lpc .ststop{color:#f97316;font-weight:800;font-size:11px}
    .lpc .stidle{color:#facc15;font-weight:800;font-size:11px}
    .lpc .addr{font-size:10px;color:#6b7280;white-space:normal;max-width:200px;line-height:1.45;padding-top:4px;border-top:1px solid rgba(255,255,255,0.06);margin-top:3px}
    .leaflet-container a.leaflet-popup-close-button{color:#4b5563!important;font-size:16px!important;top:6px!important;right:8px!important}
    .pin{display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:800;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.7)}
    .leaflet-popup-content-wrapper{background:#ffffff!important;border:1px solid #e2e8f0!important;border-radius:10px!important;box-shadow:0 6px 16px rgba(0,0,0,0.15)!important;padding:0!important;}
    .leaflet-popup-tip{background:#ffffff!important;}
    .leaflet-control-attribution { display: none !important; }
    .mk-popup{font-family:'Segoe UI',system-ui,sans-serif;min-width:160px;max-width:200px;padding:8px 12px;background:#ffffff;border-radius:10px;}
    .mk-popup .mk-title{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #e2e8f0}
    .mk-popup .mk-title.start{color:#16a34a}
    .mk-popup .mk-title.end{color:#dc2626}
    .mk-popup .mk-row{display:flex;gap:6px;align-items:flex-start;padding:3px 0}
    .mk-popup .mk-lbl{color:#64748b;min-width:45px;font-size:10px;text-transform:uppercase;font-weight:600;flex-shrink:0}
    .mk-popup .mk-val{color:#334155;font-weight:700;font-size:13px}
    .mk-popup .mk-addr{color:#475569;font-size:11.5px;white-space:normal;max-width:200px;line-height:1.4;margin-top:5px;padding-top:5px;border-top:1px solid #e2e8f0}
    .dateBadge{position:absolute;top:14px;left:14px;z-index:1000;background:rgba(8,10,18,0.92);color:#f97316;padding:6px 14px;border-radius:10px;font-weight:800;font-size:12px;border:1px solid rgba(249,115,22,0.4);font-family:'Segoe UI',system-ui,sans-serif;letter-spacing:.3px;display:none;box-shadow:0 4px 14px rgba(0,0,0,.5)}
    @keyframes pulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(2.5);opacity:0}100%{transform:scale(1);opacity:0}}
    @keyframes ripple{0%{transform:scale(.7);opacity:.8}100%{transform:scale(2.6);opacity:0}}
    .car-marker { transition: transform 0.08s linear !important; margin-left: -22px !important; margin-top: -22px !important; }
  </style>
</head>
<body><div id="map"></div><div id="dateLabel" class="dateBadge"></div>
<script>
var map = L.map('map', {zoomControl:false, attributionControl:false}).setView([20,78], 5);
L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {maxZoom:20}).addTo(map);

var routeLine = L.polyline([], {color:'#22c55e', weight:5, opacity:.9}).addTo(map);
var arrowDec = null, startM = null, endM = null, carM = null;

var animData = [];
var animPlaying = false;
var animSpeed = 1;
var animStartReal = 0;
var animElapsedVirtual = 0;
var animTimer = null;
var lastSyncSec = -1;
var followMode = false;

function lerp(a, b, f) { return a + (b - a) * f; }

function animFrame(now) {
   if (!animPlaying || animData.length < 2) return;
   var elapsed = animElapsedVirtual + (now - animStartReal) * animSpeed;
   
   var lo = 0, hi = animData.length - 2;
   while (lo < hi) {
     var mid = (lo + hi + 1) >> 1;
     if (animData[mid].ms <= elapsed) lo = mid; else hi = mid - 1;
   }
   var idx = lo;
   
   var p1 = animData[idx];
   var p2 = animData[idx + 1];
   var t1 = p1.ms;
   var t2 = p2.ms;
   var frac = t2 > t1 ? Math.max(0, Math.min(1, (elapsed - t1) / (t2 - t1))) : 0;
   
   var lat = lerp(p1.lat, p2.lat, frac);
   var lng = lerp(p1.lng, p2.lng, frac);
   var spd = lerp(p1.spd, p2.spd, frac);
   var crs = lerp(p1.crs, p2.crs, frac);
   var mlg = lerp(p1.mlg, p2.mlg, frac);
   var fixMs = p1.fixMs + (p2.fixMs - p1.fixMs) * frac;
   
   if (carM) {
      carM.setLatLng([lat, lng]);
      var el = carM.getElement();
      if (el) {
         var moving = spd > 2;
         var bg = moving ? '#f97316' : '#64748b';
         var rw = el.querySelector('.car-rotate');
         if (rw) { rw.style.transform = 'rotate(' + Math.round(crs) + 'deg)'; rw.style.background = bg; }
         var pulses = el.querySelectorAll('.pulse-ring');
         if (moving && pulses.length === 0) {
            var ring1 = document.createElement('div');
            ring1.className = 'pulse-ring';
            ring1.style.cssText = 'position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.18);animation:pulse 1.5s ease-out infinite';
            var ring2 = document.createElement('div');
            ring2.className = 'pulse-ring';
            ring2.style.cssText = 'position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(249,115,22,0.1);animation:ripple 2s linear infinite .5s';
            if (rw) { el.firstChild.insertBefore(ring1, rw); el.firstChild.insertBefore(ring2, rw); }
         } else if (!moving && pulses.length > 0) {
            pulses.forEach(function(p) { p.remove(); });
         }
      }
      if(followMode){
        var z = map.getZoom();
        var tz = Math.max(z,15);
        if(z!==tz) map.setView([lat,lng],tz,{animate:true,duration:0.4});
        else map.panTo([lat,lng],{animate:true,duration:0.3,easeLinearity:0.6});
      }
   }
   
   var currentVirtualSec = Math.floor(fixMs / 1000);
   if (currentVirtualSec !== lastSyncSec) {
      lastSyncSec = currentVirtualSec;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'SYNC', idx: idx, elapsed: elapsed,
        tel: { speed: spd.toFixed(0), course: Math.round(crs), mileage: mlg.toFixed(2), status: spd > 2 ? 'MOVE' : 'STOP', fixMs: fixMs }
      }));
   }
   
   if (elapsed >= animData[animData.length-1].ms) {
      animPlaying = false;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'END', elapsed: elapsed }));
   } else {
      animTimer = requestAnimationFrame(animFrame);
   }
}

function carIcon(deg, spd) {
  var moving = (spd||0) > 2;
  var bg = moving ? '#f97316' : '#64748b';
  return L.divIcon({
    className:'car-marker', iconSize:[44,44], iconAnchor:[22,22], popupAnchor:[0,-24],
    html:'<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">'
      +(moving
        ?'<div class="pulse-ring" style="position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.18);animation:pulse 1.5s ease-out infinite"></div>'
         +'<div class="pulse-ring" style="position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(249,115,22,0.1);animation:ripple 2s linear infinite .5s"></div>'
        :'')
      +'<div class="car-rotate" style="width:34px;height:34px;background:'+bg+';border:3px solid #fff;border-radius:50%;'
      +'box-shadow:0 4px 12px rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;'
      +'z-index:2;transform:rotate('+(deg||0)+'deg);transition: transform 0.2s linear;">'
      +'<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;'
      +'border-bottom:12px solid #fff;margin-top:-3px"></div>'
      +'</div></div>'
  });
}

function pinIcon(label, bg) {
  return L.divIcon({
    className:'', iconSize:[30,30], iconAnchor:[15,15],
    html:'<div class="pin" style="width:30px;height:30px;background:'+bg+';color:#fff;font-size:12px">'+label+'</div>'
  });
}

function stopIcon() {
  return L.divIcon({
    className:'', iconSize:[14,14], iconAnchor:[7,7],
    html:'<div style="width:14px;height:14px;background:#facc15;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>'
  });
}

window.dispatchPlayback = function(s) {
  var d = JSON.parse(s);
  if (d.type === 'CLEAR_ALL') {
    animPlaying = false; if (animTimer) cancelAnimationFrame(animTimer); animData = [];
    routeLine.setLatLngs([]);
    if(arrowDec){map.removeLayer(arrowDec);arrowDec=null;}
    if(startM){map.removeLayer(startM);startM=null;}
    if(endM){map.removeLayer(endM);endM=null;}
    if(carM){map.removeLayer(carM);carM=null;}
    if(window.stopMarkers) { window.stopMarkers.forEach(function(m){map.removeLayer(m);}); }
    window.stopMarkers = [];
    var dlc = document.getElementById('dateLabel'); dlc.style.display='none';
    return;
  }
  if (d.type === 'LOAD_FULL_ROUTE') {
    routeLine.setLatLngs([]);
    if(arrowDec){map.removeLayer(arrowDec);arrowDec=null;}
    if(startM){map.removeLayer(startM);startM=null;}
    if(endM){map.removeLayer(endM);endM=null;}
    if(carM){map.removeLayer(carM);carM=null;}
    if(window.stopMarkers) { window.stopMarkers.forEach(function(m){map.removeLayer(m);}); }
    window.stopMarkers = [];

    if(!d.coords||d.coords.length<2) return;
    animData = d.coords;
    routeLine.setLatLngs(d.coords.map(c=>[c.lat,c.lng]));

    if(window.L.polylineDecorator){
      arrowDec = L.polylineDecorator(routeLine,{
        patterns:[{offset:25,repeat:90,symbol:L.Symbol.arrowHead({
          pixelSize:11,polygon:false,
          pathOptions:{stroke:true,weight:2.5,color:'rgba(255,255,255,0.7)',opacity:.8}
        })}]
      }).addTo(map);
    }

    startM = L.marker([d.coords[0].lat, d.coords[0].lng], {icon:pinIcon('S','#22c55e'),zIndexOffset:500}).addTo(map);
    endM   = L.marker([d.coords[d.coords.length-1].lat, d.coords[d.coords.length-1].lng], {icon:pinIcon('P','#ef4444'),zIndexOffset:500}).addTo(map);

    startM.bindPopup('<div class="mk-popup"><div class="mk-title start">▶ Start Point</div><div class="mk-addr">Loading...</div></div>', {className:'lpw',closeButton:true,autoPan:true,offset:[0,-8]});
    endM.bindPopup('<div class="mk-popup"><div class="mk-title end">⏹ End Point</div><div class="mk-addr">Loading...</div></div>', {className:'lpw',closeButton:true,autoPan:true,offset:[0,-8]});

    if (d.stops && d.stops.length > 0) {
      d.stops.forEach(function(st, idx) {
        var sm = L.marker([st.lat, st.lng], {icon:stopIcon(), zIndexOffset:300}).addTo(map);
        sm.bindPopup('<div class="mk-popup"><div class="mk-title" style="color:#facc15">⏹ Stop '+(idx+1)+'</div>'
          +'<div class="mk-row"><span class="mk-lbl">Start</span><span class="mk-val">'+st.startTime+'</span></div>'
          +'<div class="mk-row"><span class="mk-lbl">End</span><span class="mk-val">'+st.endTime+'</span></div>'
          +'<div class="mk-row"><span class="mk-lbl">Duration</span><span class="mk-val">'+st.duration+'</span></div>'
          +'<div class="mk-addr">📍 '+(st.address||'Address Not Available')+'</div>'
          +'</div>', {className:'lpw',closeButton:true,autoPan:true,offset:[0,-8]});
        window.stopMarkers.push(sm);
      });
    }

    carM = L.marker([d.coords[0].lat, d.coords[0].lng], {icon:carIcon(0,0),zIndexOffset:1000}).addTo(map);

    var dl = document.getElementById('dateLabel');
    if (d.selectedDate) {
      dl.textContent = '📅 ' + d.selectedDate;
      dl.style.display = 'block';
    } else {
      dl.style.display = 'none';
    }

    map.fitBounds(routeLine.getBounds(),{padding:[65,65],animate:true,duration:1.0});
    return;
  }
  if (d.type === 'PLAY') {
     animSpeed = d.speed;
     animElapsedVirtual = d.elapsed;
     followMode = d.follow;
     animPlaying = true;
     animStartReal = performance.now();
     if (animTimer) cancelAnimationFrame(animTimer);
     animTimer = requestAnimationFrame(animFrame);
  } else if (d.type === 'PAUSE') {
     animPlaying = false;
     if (animTimer) cancelAnimationFrame(animTimer);
  } else if (d.type === 'SEEK') {
     animElapsedVirtual = d.elapsed;
     animStartReal = performance.now();
     if (!animPlaying) {
        animPlaying = true;
        animFrame(performance.now());
        animPlaying = false;
     }
  } else if (d.type === 'UPDATE_FOLLOW') {
     followMode = d.follow;
  }
  if (d.type === 'SET_MARKER_INFO') {
    if (startM) {
      startM.setPopupContent('<div class="mk-popup"><div class="mk-title start">▶ Start Point</div>'
        +'<div class="mk-row"><span class="mk-lbl">Time</span><span class="mk-val">'+(d.startTime||'—')+'</span></div>'
        +(d.startAddress?'<div class="mk-addr">📍 '+d.startAddress+'</div>':'')
        +'</div>');
    }
    if (endM) {
      endM.setPopupContent('<div class="mk-popup"><div class="mk-title end">⏹ End Point</div>'
        +'<div class="mk-row"><span class="mk-lbl">Time</span><span class="mk-val">'+(d.endTime||'—')+'</span></div>'
        +(d.endAddress?'<div class="mk-addr">📍 '+d.endAddress+'</div>':'')
        +'</div>');
    }
    return;
  }
};

setTimeout(function(){
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'MAP_READY'}));
},400);
</script></body></html>
  `, [selectedDateStr]);

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={s.map}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
      />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.headerTitle} numberOfLines={1}>{device.name}</Text>
          <Text style={s.headerSub}>History Playback</Text>
        </View>
        <TouchableOpacity
          style={s.filterChip}
          onPress={() => { setTempTf(timeframe); setShowTimeModal(true); }}
        >
          <Icon name="clock-outline" size={13} color="#f97316" />
          <Text style={s.filterChipTxt} numberOfLines={1}>
            {timeframe === 'custom' ? selectedDateStr : `${tfLabel[timeframe] || 'Today'} (${selectedDateStr})`}
          </Text>
          <Icon name="chevron-down" size={13} color="#f97316" />
        </TouchableOpacity>
      </View>

      {/* Zoom buttons */}
      {(loadError === '' && !loading) && (
        <View style={s.zoomPanel}>
          <TouchableOpacity style={s.zoomBtn} onPress={zoomIn} activeOpacity={0.75}>
            <Text style={s.zoomTxt}>+</Text>
          </TouchableOpacity>
          <View style={s.zoomDiv} />
          <TouchableOpacity style={s.zoomBtn} onPress={zoomOut} activeOpacity={0.75}>
            <Text style={s.zoomTxt}>−</Text>
          </TouchableOpacity>
          <View style={s.zoomDiv} />
          <TouchableOpacity style={s.zoomBtn} onPress={() => setFollowMode(!followMode)} activeOpacity={0.75}>
            <Icon name="navigation" size={18} color={followMode ? '#0284c7' : '#f1f5f9'} />
          </TouchableOpacity>
        </View>
      )}

      {/* No data overlay */}
      {loadError !== '' && !loading && (
        <View style={s.noDataOverlay}>
          <Icon name="map-marker-off" size={60} color="#334155" />
          {/* <Text style={s.noDataTitle}>No Playback Data</Text> */}
          <Text style={s.noDataText}>{loadError}</Text>
          <TouchableOpacity style={s.noDataBtn} onPress={() => { setTempTf(timeframe); setShowTimeModal(true); }}>
            <Text style={s.noDataBtnTxt}>Change Time Range</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Time filter modal */}
      <Modal visible={showTimeModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Playback Time Range</Text>
            <View style={s.modalBody}>
              {[
                { key: 'today', label: 'Today', sub: `${moment().format('DD/MM/YYYY')}  ·  12:00 AM → Live` },
                { key: 'yesterday', label: 'Yesterday', sub: `${moment().subtract(1, 'day').format('DD/MM/YYYY')}  ·  12:00 AM – 11:59 PM` },
                { key: 'hour', label: 'Last 1 Hour', sub: `${moment().subtract(1, 'hour').format('HH:mm')} → ${moment().format('HH:mm')} now` },
                { key: 'custom', label: 'Custom Date', sub: `Selected: ${moment(customStart).format('DD/MM/YYYY')}` },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.radioRow, tempTf === opt.key && s.radioRowActive]}
                  activeOpacity={0.75}
                  onPress={() => setTempTf(opt.key)}
                >
                  <Icon
                    name={tempTf === opt.key ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={tempTf === opt.key ? '#f97316' : '#4b5563'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.radioLabel, tempTf === opt.key && { color: '#f97316' }]}>
                      {opt.label}
                    </Text>
                    <Text style={s.radioSub}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              {tempTf === 'custom' && (
                <View style={s.dateInputsBox}>
                  <TouchableOpacity style={s.dateInput} onPress={() => setShowStartPicker(true)}>
                    <Icon name="calendar" size={15} color="#f97316" />
                    <Text style={s.dateInputText}>Select Date: {moment(customStart).format('DD/MM/YYYY')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={s.modalFooter}>
              <TouchableOpacity
                style={s.modalBtn}
                onPress={() => {
                  if (!mapReady) navigation.goBack();
                  else setShowTimeModal(false);
                }}
              >
                <Text style={s.modalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={s.modalBtnDiv} />
              <TouchableOpacity
                style={s.modalBtn}
                onPress={() => {
                  setTimeframe(tempTf);
                  setShowTimeModal(false);
                  loadAndAnimate(tempTf);
                }}
              >
                <Text style={[s.modalBtnTxt, { color: '#f97316', fontWeight: '800' }]}>
                  Load Route
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playback HUD — Compact */}
      {showHUD && (
        <View style={[s.hud, { paddingBottom: insets.bottom + 4 }]}>
          {/* Top row: status + time + stats inline */}
          <View style={s.hudTopRow}>
            <View style={[s.statusPill, {
              backgroundColor: getStatusColor(liveTel.status) + '22',
              borderColor: getStatusColor(liveTel.status) + '66'
            }]}>
              <View style={[s.statusDot, { backgroundColor: getStatusColor(liveTel.status) }]} />
              <Text style={[s.statusTxt, { color: getStatusColor(liveTel.status) }]}>
                {String(liveTel.status || '—').toUpperCase()}
              </Text>
            </View>
            <Text style={s.hudGpsTime}>{liveTel.time || '—'}</Text>
            <Text style={s.hudStat}><Text style={{ color: '#4ade80' }}>{liveTel.speed}</Text> kph</Text>
            <Text style={s.hudStat}><Text style={{ color: '#60a5fa' }}>{liveTel.mileage}</Text>/{totalKm} km</Text>
          </View>

          {/* Progress bar */}
          <View style={s.progWrap}>
            <View
              style={s.progBg}
              onLayout={e => { progBarLayoutRef.current = e.nativeEvent.layout; }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={e => {
                setIsPlaying(false);
                setIsScrubbing(true);
                const barW = progBarLayoutRef.current.width || BAR_WIDTH;
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barW));
                setScrubRatio(ratio);
                const pts = routePointsRef.current;
                if (pts.length < 2) return;
                seekTo(Math.round(ratio * (pts.length - 1)));
              }}
              onResponderMove={e => {
                const now = Date.now();
                if (now - lastSeekDragRef.current < 50) return;
                lastSeekDragRef.current = now;
                const barW = progBarLayoutRef.current.width || BAR_WIDTH;
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barW));
                setScrubRatio(ratio);
                const pts = routePointsRef.current;
                if (pts.length < 2) return;
                seekTo(Math.round(ratio * (pts.length - 1)));
              }}
              onResponderRelease={() => setIsScrubbing(false)}
            >
              {isScrubbing && (
                <View style={[s.scrubTooltip, { left: `${Math.max(5, Math.min(95, scrubRatio * 100))}%` }]}>
                  <Text style={s.scrubTooltipTxt} numberOfLines={2}>
                    {currentAddress || 'Loading...'}
                  </Text>
                  <View style={s.scrubTooltipArrow} />
                </View>
              )}
              <View style={s.progTrackBg}>
                <View style={[s.progFill, { width: `${progress}%` }]} />
              </View>
              <View style={[s.progThumb, { left: `${Math.max(0, Math.min(98, progress))}%` }]} />
            </View>
            <View style={s.timeRow}>
              <Text style={s.timeTxt}>
                {routePoints[0]?.fixTime ? moment(routePoints[0].fixTime).format('HH:mm') : '--:--'}
              </Text>
              <Text style={s.timeTxt}>
                {routePoints.length > 0
                  ? moment(routePoints[routePoints.length - 1].fixTime).format('HH:mm')
                  : '--:--'}
              </Text>
            </View>
          </View>

          {/* Controls & Speed */}
          <View style={s.playbackBar}>
            <View style={s.controls}>
              <Pressable style={({ pressed }) => [s.playBtnOutline, { marginRight: 10, backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)' }]} onPress={() => {
                setIsPlaying(false);
                seekTo(Math.max(0, currentIndex - 1));
              }}>
                <Icon name="skip-previous" size={24} color="#6b7a90" />
              </Pressable>

              <Pressable style={({ pressed }) => [s.playBtn, pressed && { backgroundColor: '#c2410c', transform: [{ scale: 0.95 }] }]} onPress={() => {
                if (routePoints.length === 0) return;
                if (!isPlaying && currentIndex >= routePoints.length - 1) {
                  seekTo(0);
                  setTimeout(() => setIsPlaying(true), 60);
                } else {
                  setIsPlaying(p => !p);
                }
              }}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
              </Pressable>

              <Pressable onPress={() => {
                setIsPlaying(false);
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
                seekTo(Math.min(routePoints.length - 1, currentIndex + 1));
              }} style={({ pressed }) => [s.playBtnOutline, { marginLeft: 10, backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)' }]}>
                <Icon name="skip-next" size={24} color="#6b7a90" />
              </Pressable>
            </View>

            <View style={{ marginTop: 8 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.speedCtrl}>
                <Text style={s.speedLbl}>SPEED</Text>
                {[0.25, 0.5, 1, 2, 5, 10, 20].map(sVal => (
                  <TouchableOpacity
                    key={sVal}
                    style={[s.spdBtn, playSpeed === sVal && s.spdBtnActive]}
                    onPress={() => setPlaySpeed(sVal)}
                  >
                    <Text style={[s.spdBtnTxt, playSpeed === sVal && s.spdBtnTxtActive]}>{sVal}x</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Address */}
          {currentAddress ? (
            <View style={s.addrBox}>
              <Text style={s.addrTxt} numberOfLines={2}>📍 {currentAddress}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Date picker — Custom Date supports a single day only */}
      <DatePicker
        modal open={showStartPicker} date={customStart} mode="date"
        minimumDate={moment().subtract(30, 'days').toDate()} maximumDate={new Date()}
        onConfirm={d => { setShowStartPicker(false); setCustomStart(d); }}
        onCancel={() => setShowStartPicker(false)}
        title="Select Date"
      />

      {/* Loading overlay */}
      {loading && (
        <View style={s.loader}>
          <ActivityIndicator size="large" color="#f97316" />
          <Text style={s.loaderTxt}>Loading...</Text>
        </View>
      )}
    </View>
  );
};

// Styles (unchanged)
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0c14' },
  map: { flex: 1 },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(8,10,18,0.93)',
    paddingHorizontal: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: { padding: 8, marginRight: 6 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#f8fafc' },
  headerSub: { fontSize: 11, color: '#4b5563', marginTop: 1 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(249,115,22,0.12)',
    paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)',
    maxWidth: width * 0.52,
  },
  filterChipTxt: { fontSize: 11.5, color: '#f97316', fontWeight: '700' },
  zoomPanel: {
    position: 'absolute', right: 12, bottom: 200, zIndex: 18,
    backgroundColor: 'rgba(8,10,18,0.92)',
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1e2533',
    elevation: 8,
  },
  zoomBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  zoomTxt: { fontSize: 20, color: '#f1f5f9', fontWeight: '300', lineHeight: 24 },
  zoomDiv: { height: 1, backgroundColor: '#1e2533' },
  errorBanner: {
    position: 'absolute', top: 90, left: 16, right: 16, zIndex: 25,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(127,29,29,0.95)', padding: 12,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  errorTxt: { flex: 1, color: '#fca5a5', fontSize: 12, fontWeight: '600' },
  hud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#0f1420',
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4,
    borderTopWidth: 1, borderTopColor: 'rgba(249,115,22,0.2)',
    elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5, shadowRadius: 10,
  },
  hudTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 12, borderWidth: 1,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  hudGpsTime: { fontSize: 9, color: '#64748b', fontWeight: '600', marginRight: 4 },
  hudStat: { fontSize: 9, color: '#475569', fontWeight: '600', marginLeft: 4 },
  hudSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 8, marginTop: 4 },
  summaryPill: {
    flex: 1, alignItems: 'center', backgroundColor: '#1a2030',
    paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2d3748',
  },
  summaryVal: { fontSize: 14, fontWeight: '800', color: '#f8fafc' },
  summaryLbl: { fontSize: 9, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  progWrap: { marginBottom: 2 },
  progBg: {
    height: 22, backgroundColor: 'transparent', borderRadius: 4,
    overflow: 'visible', position: 'relative', justifyContent: 'center',
  },
  progTrackBg: {
    height: 5, backgroundColor: '#0d1117', borderRadius: 3,
    overflow: 'hidden', borderWidth: 1, borderColor: '#1e2533',
  },
  progFill: { height: '100%', backgroundColor: '#f97316', borderRadius: 3 },
  progThumb: {
    position: 'absolute', top: 4,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#f97316',
    marginLeft: -7,
    shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 4, elevation: 6,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeTxt: { fontSize: 9, color: '#374151', fontWeight: '600' },
  playbackBar: {
    flexDirection: 'column', gap: 6, marginTop: 4, marginBottom: 6
  },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  playBtnOutline: {
    width: 42, height: 42, borderRadius: 21,
    borderWidth: 2, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  playBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#f97316', justifyContent: 'center', alignItems: 'center',
    elevation: 8, shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  speedCtrl: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4,
  },
  speedLbl: {
    fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4, fontWeight: '700'
  },
  spdBtn: {
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6,
    backgroundColor: '#1a2030', borderWidth: 1, borderColor: '#2d3748',
  },
  spdBtnActive: {
    backgroundColor: 'rgba(249,115,22,0.15)', borderColor: '#f97316',
  },
  spdBtnTxt: {
    fontSize: 11, fontWeight: '600', color: '#94a3b8'
  },
  spdBtnTxtActive: {
    color: '#f97316'
  },
  addrBox: {
    paddingVertical: 2, paddingHorizontal: 4,
    marginBottom: 2, alignItems: 'center'
  },
  addrTxt: { fontSize: 9.5, color: '#94a3b8', textAlign: 'center', lineHeight: 12 },
  scrubTooltip: {
    position: 'absolute', bottom: 20,
    transform: [{ translateX: -70 }], width: 140,
    backgroundColor: '#fff', padding: 4, borderRadius: 6,
    zIndex: 100, elevation: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 5,
  },
  scrubTooltipTxt: { fontSize: 9.5, color: '#0f1420', textAlign: 'center', fontWeight: '700' },
  scrubTooltipArrow: {
    position: 'absolute', bottom: -4, left: '50%', marginLeft: -4,
    borderTopWidth: 4, borderTopColor: '#fff',
    borderLeftWidth: 4, borderLeftColor: 'transparent',
    borderRightWidth: 4, borderRightColor: 'transparent',
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    width: width * 0.88, backgroundColor: '#0f1420', borderRadius: 18,
    elevation: 30, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)',
  },
  modalTitle: {
    color: '#f8fafc', fontSize: 15, fontWeight: '700',
    textAlign: 'center', paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#1a2030',
    letterSpacing: 0.3,
  },
  modalBody: { padding: 18 },
  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 11, paddingHorizontal: 10,
    borderRadius: 12, marginBottom: 4,
  },
  radioRowActive: { backgroundColor: 'rgba(249,115,22,0.08)' },
  radioLabel: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  radioSub: { fontSize: 11, color: '#4b5563', marginTop: 1 },
  dateInputsBox: { gap: 8, marginTop: 8 },
  dateInput: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0d1117', paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)',
  },
  dateInputText: { color: '#f1f5f9', fontSize: 12.5, fontWeight: '600' },
  modalFooter: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1a2030' },
  modalBtn: { flex: 1, paddingVertical: 16, justifyContent: 'center', alignItems: 'center' },
  modalBtnTxt: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  modalBtnDiv: { width: 1, backgroundColor: '#1a2030' },
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,10,18,0.92)',
    justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  loaderTxt: { marginTop: 14, color: '#f97316', fontWeight: '800', fontSize: 14 },
  loaderSub: { marginTop: 5, color: '#4b5563', fontSize: 11 },
  noDataOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0d1117',
    justifyContent: 'center', alignItems: 'center', zIndex: 90,
    paddingHorizontal: 30,
  },
  noDataTitle: { fontSize: 20, fontWeight: '800', color: '#f1f5f9', marginTop: 16 },
  noDataText: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  noDataBtn: { marginTop: 24, backgroundColor: '#f97316', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  noDataBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

export default PlaybackScreen;