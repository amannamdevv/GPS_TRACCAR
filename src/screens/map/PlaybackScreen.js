import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text,
  ActivityIndicator, StatusBar, Dimensions, Modal,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import moment from 'moment';
import DatePicker from 'react-native-date-picker';
import { reverseGeocode } from '../../api/webApi';
import axios from 'axios';

const { width } = Dimensions.get('window');
const BASE_URL = 'http://gps.shrotitele.com:1061/api';
const fmt = (m) => m.format('YYYY-MM-DD HH:mm:ss');

// ── Haversine distance (meters) ───────────────────────────────────────────────
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

const computeMileage = (points) => {
  const miles = [0];
  for (let i = 1; i < points.length; i++) {
    const d = haversine(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude,
    );
    miles.push(miles[i - 1] + d / 1000);
  }
  return miles;
};

// ── Status color helper ───────────────────────────────────────────────────────
const getStatusColor = (s) => {
  if (!s) return '#94a3b8';
  const u = String(s).toUpperCase();
  if (u === 'MOVE' || u === 'MOVING') return '#4ade80';
  if (u === 'STOP' || u === 'STOPPED') return '#f97316';
  if (u === 'IDLE') return '#facc15';
  return '#94a3b8';
};

// ── Fetch ALL position history for a time range ───────────────────────────────
const fetchAllPositions = async (deviceId, from, to) => {
  try {
    const resp = await axios.get(`${BASE_URL}/dg_merged_status_api/`, {
      params: { deviceid: deviceId, deviceId, from, to },
      timeout: 20000,
    });
    const raw = resp.data;
    let all = [];
    if (Array.isArray(raw)) all = raw;
    else if (raw && Array.isArray(raw.data)) all = raw.data;
    else if (raw && Array.isArray(raw.results)) all = raw.results;

    const filtered = all.filter(t => {
      const tid = t.deviceid ?? t.deviceId ?? t.device_id;
      return !tid || String(tid) === String(deviceId);
    });
    return filtered.length > 0 ? filtered : all;
  } catch (e) {
    console.warn('[fetchAllPositions]', e.message);
    return [];
  }
};

// ── Normalize raw API row → playback point ───────────────────────────────────
const normalizePoint = (p) => ({
  latitude: parseFloat(p.start_latitude ?? p.motion_lat ?? p.latitude ?? p.lat ?? 0),
  longitude: parseFloat(p.start_longitude ?? p.motion_lon ?? p.longitude ?? p.lon ?? 0),
  speedKmh: parseFloat(p.speedKmh ?? p.speed ?? 0),
  course: parseFloat(p.course ?? 0),
  fixTime: p.start_time ?? p.position_time ?? p.fixTime ?? new Date().toISOString(),
  ignition_status: p.ignition_status ?? p.ignition ?? null,
  battery_level: p.battery_level ?? null,
  final_status: p.final_status ?? null,
});

// ─────────────────────────────────────────────────────────────────────────────
const PlaybackScreen = ({ route, navigation }) => {
  const { device } = route.params;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  // ── Time filter modal ──────────────────────────────────────────────────────
  const [showTimeModal, setShowTimeModal] = useState(true);
  const [timeframe, setTimeframe] = useState('today');
  const [tempTf, setTempTf] = useState('today');
  const [customStart, setCustomStart] = useState(new Date());
  const [customEnd, setCustomEnd] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // ── Playback state ─────────────────────────────────────────────────────────
  const [routePoints, setRoutePoints] = useState([]);
  const [mileageArr, setMileageArr] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [currentAddress, setCurrentAddress] = useState('');
  const [showHUD, setShowHUD] = useState(false);

  // ── Live telemetry for HUD display (updated every animation frame) ─────────
  const [liveTel, setLiveTel] = useState({
    speed: 0, course: 0, courseDir: 'North',
    mileage: '0.00', status: '—', time: '—',
  });

  // ── Refs ──────────────────────────────────────────────────────────────────
  const animationRef = useRef(null);
  const routePointsRef = useRef([]);
  const mileageArrRef = useRef([]);
  const currentAddressRef = useRef('');
  const addressCacheRef = useRef({});
  const lastGeoIndexRef = useRef(-1);
  const lastBridgeSendRef = useRef(0);
  const lastTelUpdateRef = useRef(0);

  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { mileageArrRef.current = mileageArr; }, [mileageArr]);
  useEffect(() => { currentAddressRef.current = currentAddress; }, [currentAddress]);

  const deviceId = device.deviceid ?? device.id;
  const BAR_WIDTH = width - 40;
  const SPEEDS = [1, 2, 4, 8, 16];

  // ── Send message to WebView ────────────────────────────────────────────────
  const sendToMap = useCallback((type, payload = {}) => {
    if (!webViewRef.current) return;
    const s = JSON.stringify({ type, ...payload });
    webViewRef.current.injectJavaScript(`window.dispatchPlayback(${JSON.stringify(s)});true;`);
  }, []);

  // ── Zoom controls (send to map JS) ────────────────────────────────────────
  const zoomIn = useCallback(() => {
    webViewRef.current?.injectJavaScript(`map.zoomIn();true;`);
  }, []);
  const zoomOut = useCallback(() => {
    webViewRef.current?.injectJavaScript(`map.zoomOut();true;`);
  }, []);

  // ── Cached reverse geocode ────────────────────────────────────────────────
  const getCachedAddress = useCallback(async (lat, lng) => {
    const key = `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
    if (addressCacheRef.current[key]) return addressCacheRef.current[key];
    try {
      const addr = await reverseGeocode(lat, lng);
      if (addr) addressCacheRef.current[key] = addr;
      return addr || '';
    } catch { return ''; }
  }, []);

  // ── Time range builder ─────────────────────────────────────────────────────
  // TODAY     : aaj raat 12:00:00 AM → abhi (live)
  // YESTERDAY : kal raat 12:00:00 AM → kal raat 11:59:59 PM  (pura kal ka din)
  // HOUR      : abhi se 1 ghanta pehle → abhi
  // CUSTOM    : user-picked
  const getTimeRange = useCallback((tf) => {
    const now = moment();
    if (tf === 'today') {
      return {
        from: fmt(now.clone().startOf('day')),   // aaj 00:00:00
        to: fmt(now),                           // abhi live
      };
    }
    if (tf === 'yesterday') {
      const yday = now.clone().subtract(1, 'day');
      return {
        from: fmt(yday.clone().startOf('day')),  // kal 00:00:00
        to: fmt(yday.clone().endOf('day')),    // kal 23:59:59
      };
    }
    if (tf === 'hour') {
      return {
        from: fmt(now.clone().subtract(1, 'hour')),
        to: fmt(now),
      };
    }
    // custom
    return {
      from: fmt(moment(customStart)),
      to: fmt(moment(customEnd)),
    };
  }, [customStart, customEnd]);

  // ── MAIN LOAD ─────────────────────────────────────────────────────────────
  const loadAndAnimate = useCallback(async (tf) => {
    if (!mapReady) return;

    setLoading(true);
    setLoadError('');
    setShowHUD(false);
    setIsPlaying(false);
    setCurrentIndex(0);
    setRoutePoints([]);
    setMileageArr([]);
    setCurrentAddress('');
    setLiveTel({ speed: 0, course: 0, courseDir: 'North', mileage: '0.00', status: '—', time: '—' });
    lastGeoIndexRef.current = -1;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const { from, to } = getTimeRange(tf);

    try {
      const raw = await fetchAllPositions(deviceId, from, to);

      if (!raw || raw.length === 0) {
        setLoadError('Is time range mein koi GPS data nahi mila.');
        sendToMap('CLEAR_ALL');
        setLoading(false);
        return;
      }

      // Normalize + filter valid coords
      let points = raw
        .map(normalizePoint)
        .filter(p => p.latitude !== 0 && p.longitude !== 0);

      // Sort ascending by time
      points.sort((a, b) => moment(a.fixTime).valueOf() - moment(b.fixTime).valueOf());

      // Deduplicate consecutive identical coords
      const deduped = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const prev = deduped[deduped.length - 1];
        if (
          Math.abs(points[i].latitude - prev.latitude) > 0.00001 ||
          Math.abs(points[i].longitude - prev.longitude) > 0.00001
        ) deduped.push(points[i]);
      }
      points = deduped;

      if (points.length < 2) {
        setLoadError('Sirf ek GPS point mila — playback ke liye 2+ points chahiye.');
        setLoading(false);
        return;
      }

      const miles = computeMileage(points);
      setRoutePoints(points);
      setMileageArr(miles);

      const fp = points[0];
      const lp = points[points.length - 1];

      // Initial telemetry
      setLiveTel({
        speed: parseFloat(fp.speedKmh).toFixed(0),
        course: parseFloat(fp.course).toFixed(0),
        courseDir: courseLabel(fp.course),
        mileage: '0.00',
        status: fp.final_status || '—',
        time: moment(fp.fixTime).format('HH:mm:ss'),
      });

      // Draw full route on map (once, never redrawn)
      sendToMap('LOAD_FULL_ROUTE', {
        coords: points.map(pt => [pt.latitude, pt.longitude]),
        startCoord: [fp.latitude, fp.longitude],
        endCoord: [lp.latitude, lp.longitude],
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

      // Fetch start address
      const addr = await getCachedAddress(fp.latitude, fp.longitude);
      setCurrentAddress(addr);
      setShowHUD(true);
    } catch (e) {
      console.warn('[loadAndAnimate]', e);
      setLoadError('Data load karne mein error aaya.');
    } finally {
      setLoading(false);
    }
  }, [mapReady, deviceId, sendToMap, getTimeRange, getCachedAddress]);

  // ── Auto-load once map is ready ────────────────────────────────────────────
  useEffect(() => {
    if (mapReady && !showTimeModal) loadAndAnimate(timeframe);
  }, [mapReady]); // eslint-disable-line

  // ── rAF animation loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || routePointsRef.current.length < 2) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    const pts = routePointsRef.current;
    const miles = mileageArrRef.current;
    const startMs = moment(pts[0].fixTime).valueOf();
    const totalMs = moment(pts[pts.length - 1].fixTime).valueOf() - startMs;
    const pointTimes = pts.map(p => moment(p.fixTime).valueOf() - startMs);
    const resumeMs = pointTimes[currentIndex] || 0;
    let animStart = performance.now() - resumeMs / playSpeed;
    let lastIdx = currentIndex;

    const animate = (now) => {
      const elapsed = (now - animStart) * playSpeed;

      if (elapsed >= totalMs) {
        const lp = pts[pts.length - 1];
        const tel = {
          time: moment(lp.fixTime).format('HH:mm:ss'),
          speed: '0', course: Math.round(lp.course),
          courseDir: courseLabel(lp.course),
          mileage: (miles[miles.length - 1] || 0).toFixed(2),
          status: lp.final_status || '—', address: currentAddressRef.current,
        };
        sendToMap('UPDATE_CAR', {
          coord: [lp.latitude, lp.longitude],
          course: lp.course, speed: 0, follow: false, telemetry: { ...tel, time: moment(lp.fixTime).format('YYYY-MM-DD HH:mm:ss') },
        });
        setLiveTel(tel);
        setCurrentIndex(pts.length - 1);
        setIsPlaying(false);
        return;
      }

      // Binary search current segment
      let lo = 0, hi = pts.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pointTimes[mid] <= elapsed) lo = mid; else hi = mid - 1;
      }
      const idx = lo;
      const segS = pointTimes[idx], segE = pointTimes[idx + 1];
      const frac = segE > segS ? Math.max(0, Math.min(1, (elapsed - segS) / (segE - segS))) : 0;

      const p1 = pts[idx], p2 = pts[idx + 1];
      const lat = p1.latitude + (p2.latitude - p1.latitude) * frac;
      const lng = p1.longitude + (p2.longitude - p1.longitude) * frac;
      const spd = p1.speedKmh + (p2.speedKmh - p1.speedKmh) * frac;
      const crs = p1.course + (p2.course - p1.course) * frac;
      const mlg = (miles[idx] || 0) + ((miles[idx + 1] || 0) - (miles[idx] || 0)) * frac;
      const fixMs = moment(p1.fixTime).valueOf() + frac * (moment(p2.fixTime).valueOf() - moment(p1.fixTime).valueOf());

      // Determine status based on speed interpolation
      const curStatus = spd > 2 ? 'MOVE' : (p1.final_status || 'STOP');

      const tel = {
        time: moment(fixMs).format('YYYY-MM-DD HH:mm:ss'),
        speed: spd.toFixed(0),
        course: Math.round(crs),
        courseDir: courseLabel(crs),
        mileage: mlg.toFixed(2),
        status: curStatus,
        address: currentAddressRef.current,
      };

      // Throttle WebView bridge ~60fps
      if (now - lastBridgeSendRef.current >= 16) {
        sendToMap('UPDATE_CAR', { coord: [lat, lng], course: crs, speed: spd, follow: true, telemetry: tel });
        lastBridgeSendRef.current = now;
      }

      // Update RN HUD ~10fps (100ms) to avoid too many setState calls
      if (now - lastTelUpdateRef.current >= 100) {
        setLiveTel({
          speed: spd.toFixed(0),
          course: Math.round(crs),
          courseDir: courseLabel(crs),
          mileage: mlg.toFixed(2),
          status: curStatus,
          time: moment(fixMs).format('HH:mm:ss'),
        });
        lastTelUpdateRef.current = now;
      }

      if (idx !== lastIdx) {
        setCurrentIndex(idx);
        lastIdx = idx;
        // Geocode every 12 steps, cached
        if (idx - lastGeoIndexRef.current >= 12) {
          lastGeoIndexRef.current = idx;
          getCachedAddress(pts[idx].latitude, pts[idx].longitude).then(addr => {
            if (addr) setCurrentAddress(addr);
          });
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, playSpeed, routePoints]); // eslint-disable-line

  // ── Seek ──────────────────────────────────────────────────────────────────
  const seekTo = useCallback((idx) => {
    const pts = routePointsRef.current;
    const miles = mileageArrRef.current;
    const pt = pts[idx];
    if (!pt) return;
    setCurrentIndex(idx);
    const spd = parseFloat(pt.speedKmh);
    const curStatus = spd > 2 ? 'MOVE' : (pt.final_status || 'STOP');
    const tel = {
      time: moment(pt.fixTime).format('HH:mm:ss'),
      speed: spd.toFixed(0),
      course: Math.round(pt.course),
      courseDir: courseLabel(pt.course),
      mileage: (miles[idx] || 0).toFixed(2),
      status: curStatus,
    };
    setLiveTel(tel);
    sendToMap('UPDATE_CAR', {
      coord: [pt.latitude, pt.longitude],
      course: pt.course, speed: spd, follow: true,
      telemetry: { ...tel, time: moment(pt.fixTime).format('YYYY-MM-DD HH:mm:ss'), address: currentAddressRef.current },
    });
    getCachedAddress(pt.latitude, pt.longitude).then(addr => {
      if (addr) setCurrentAddress(addr);
    });
  }, [sendToMap, getCachedAddress]);

  // ── WebView message handler ────────────────────────────────────────────────
  const onMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') setMapReady(true);
    } catch (_) { }
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const progress = routePoints.length > 1
    ? (currentIndex / (routePoints.length - 1)) * 100 : 0;
  const totalKm = mileageArr.length > 0
    ? mileageArr[mileageArr.length - 1].toFixed(2) : '0.00';

  const tfLabel = {
    today: 'Today',
    yesterday: 'Yesterday',
    hour: 'Last 1 Hr',
    custom: `${moment(customStart).format('DD MMM')} – ${moment(customEnd).format('DD MMM')}`,
  };

  // ── MAP HTML ──────────────────────────────────────────────────────────────
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

    /* Popup */
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

    /* Pin markers */
    .pin{display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:800;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.7)}

    /* Car animations */
    @keyframes pulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(2.5);opacity:0}100%{transform:scale(1);opacity:0}}
    @keyframes ripple{0%{transform:scale(.7);opacity:.8}100%{transform:scale(2.6);opacity:0}}
  </style>
</head>
<body><div id="map"></div>
<script>
// ── Map init ─────────────────────────────────────────────────────────────────
var map = L.map('map', {zoomControl:false, attributionControl:false}).setView([20,78], 5);
L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {maxZoom:20}).addTo(map);

var routeLine = L.polyline([], {color:'#22c55e', weight:5, opacity:.9}).addTo(map);
var arrowDec = null, startM = null, endM = null, carM = null;

// ── Icon builders ─────────────────────────────────────────────────────────────
function carIcon(deg, spd) {
  var moving = (spd||0) > 2;
  var bg = moving ? '#f97316' : '#64748b';
  return L.divIcon({
    className:'', iconSize:[44,44], iconAnchor:[22,22], popupAnchor:[0,-24],
    html:'<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">'
      +(moving
        ?'<div style="position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.18);animation:pulse 1.5s ease-out infinite"></div>'
         +'<div style="position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(249,115,22,0.1);animation:ripple 2s linear infinite .5s"></div>'
        :'')
      +'<div style="width:34px;height:34px;background:'+bg+';border:3px solid #fff;border-radius:50%;'
      +'box-shadow:0 4px 12px rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;'
      +'z-index:2;transform:rotate('+(deg||0)+'deg)">'
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

// ── Popup builder ─────────────────────────────────────────────────────────────
function statusHtml(s) {
  if (!s || s==='—') return '<span class="val">—</span>';
  var u=s.toUpperCase();
  if(u==='MOVE'||u==='MOVING') return '<span class="stmove">▶ MOVE</span>';
  if(u==='STOP'||u==='STOPPED') return '<span class="ststop">■ STOP</span>';
  if(u==='IDLE') return '<span class="stidle">◉ IDLE</span>';
  return '<span class="val">'+s+'</span>';
}

function buildPopup(t) {
  return '<div class="lpc">'
    +'<div class="hdr">🛰 Live Telemetry</div>'
    +'<div class="row"><span class="lbl">Status</span>'+statusHtml(t.status)+'</div>'
    +'<div class="row"><span class="lbl">GPS Time</span><span class="val tm">'+(t.time||'—')+'</span></div>'
    +'<div class="row"><span class="lbl">Speed</span><span class="spd">'+(t.speed||0)+'<span class="spdu"> kph</span></span></div>'

    +'<div class="row"><span class="lbl">Mileage</span><span class="val mlg">'+(t.mileage||'0.00')+' km</span></div>'
    +(t.address?'<div class="addr">📍 '+t.address+'</div>':'')
    +'</div>';
}

// ── Dispatch handler ──────────────────────────────────────────────────────────
window.dispatchPlayback = function(s) {
  var d = JSON.parse(s);

  if (d.type === 'CLEAR_ALL') {
    routeLine.setLatLngs([]);
    if(arrowDec){map.removeLayer(arrowDec);arrowDec=null;}
    if(startM){map.removeLayer(startM);startM=null;}
    if(endM){map.removeLayer(endM);endM=null;}
    if(carM){map.removeLayer(carM);carM=null;}
    return;
  }

  if (d.type === 'LOAD_FULL_ROUTE') {
    // Clear old layers
    routeLine.setLatLngs([]);
    if(arrowDec){map.removeLayer(arrowDec);arrowDec=null;}
    if(startM){map.removeLayer(startM);startM=null;}
    if(endM){map.removeLayer(endM);endM=null;}
    if(carM){map.removeLayer(carM);carM=null;}

    if(!d.coords||d.coords.length<2) return;

    // Draw polyline (once)
    routeLine.setLatLngs(d.coords);

    // Arrow decorators
    if(window.L.polylineDecorator){
      arrowDec = L.polylineDecorator(routeLine,{
        patterns:[{offset:25,repeat:90,symbol:L.Symbol.arrowHead({
          pixelSize:11,polygon:false,
          pathOptions:{stroke:true,weight:2.5,color:'rgba(255,255,255,0.7)',opacity:.8}
        })}]
      }).addTo(map);
    }

    // S / P markers
    startM = L.marker(d.coords[0], {icon:pinIcon('S','#22c55e'),zIndexOffset:500}).addTo(map);
    endM   = L.marker(d.coords[d.coords.length-1], {icon:pinIcon('P','#ef4444'),zIndexOffset:500}).addTo(map);

    // Car at start
    carM = L.marker(d.coords[0], {icon:carIcon(0,0),zIndexOffset:1000}).addTo(map);
    var ft = d.firstTelemetry||{};
    carM.bindPopup(buildPopup(ft),{className:'lpw',maxWidth:260,closeButton:true,autoPan:false,keepInView:false});
    carM.openPopup();

    // fitBounds ONCE
    map.fitBounds(routeLine.getBounds(),{padding:[65,65],animate:true,duration:1.0});
    return;
  }

  if (d.type === 'UPDATE_CAR' && carM && d.coord) {
    carM.setLatLng(d.coord);
    carM.setIcon(carIcon(d.course||0, d.speed||0));
    if(d.telemetry) carM.setPopupContent(buildPopup(d.telemetry));
    if(!carM.isPopupOpen()) carM.openPopup();

    // Smooth follow — panTo only, no fitBounds, stable zoom
    if(d.follow){
      var z = map.getZoom();
      var tz = Math.max(z,15);
      if(z!==tz){
        map.setView(d.coord,tz,{animate:true,duration:0.4});
      } else {
        map.panTo(d.coord,{animate:true,duration:0.3,easeLinearity:0.6});
      }
    }
    return;
  }
};

setTimeout(function(){
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'MAP_READY'}));
},400);
</script></body></html>
  `, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── MAP (full screen) ── */}
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={s.map}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
      />

      {/* ── HEADER ── */}
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
          <Text style={s.filterChipTxt}>{tfLabel[timeframe] || 'Today'}</Text>
          <Icon name="chevron-down" size={13} color="#f97316" />
        </TouchableOpacity>
      </View>

      {/* ── ZOOM BUTTONS (right side, above HUD) ── */}
      <View style={s.zoomPanel}>
        <TouchableOpacity style={s.zoomBtn} onPress={zoomIn} activeOpacity={0.75}>
          <Text style={s.zoomTxt}>+</Text>
        </TouchableOpacity>
        <View style={s.zoomDiv} />
        <TouchableOpacity style={s.zoomBtn} onPress={zoomOut} activeOpacity={0.75}>
          <Text style={s.zoomTxt}>−</Text>
        </TouchableOpacity>
      </View>

      {/* ── ERROR BANNER ── */}
      {loadError !== '' && !loading && (
        <View style={s.errorBanner}>
          <Icon name="alert-circle-outline" size={16} color="#fca5a5" />
          <Text style={s.errorTxt}>{loadError}</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════
          TIME FILTER MODAL
      ══════════════════════════════════════════════════ */}
      <Modal visible={showTimeModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Playback Time Range</Text>

            <View style={s.modalBody}>
              {[
                {
                  key: 'today',
                  label: 'Today',
                  sub: `${moment().format('DD MMM YYYY')}  ·  12:00 AM → Live`,
                },
                {
                  key: 'yesterday',
                  label: 'Yesterday',
                  sub: `${moment().subtract(1, 'day').format('DD MMM YYYY')}  ·  12:00 AM – 11:59 PM`,
                },
                {
                  key: 'hour',
                  label: 'Last 1 Hour',
                  sub: `${moment().subtract(1, 'hour').format('HH:mm')} → ${moment().format('HH:mm')} abhi`,
                },
                {
                  key: 'custom',
                  label: 'Custom Range',
                  sub: 'Apna time manually choose karo',
                },
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
                    <Icon name="calendar-start" size={15} color="#f97316" />
                    <Text style={s.dateInputText}>Start: {fmt(moment(customStart))}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dateInput} onPress={() => setShowEndPicker(true)}>
                    <Icon name="calendar-end" size={15} color="#f97316" />
                    <Text style={s.dateInputText}>End:   {fmt(moment(customEnd))}</Text>
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

      {/* ══════════════════════════════════════════════════
          PLAYBACK HUD
      ══════════════════════════════════════════════════ */}
      {showHUD && (
        <View style={[s.hud, { paddingBottom: insets.bottom + 10 }]}>

          {/* ── Status pill + GPS time ── */}
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
            <Text style={s.ptCount}>{currentIndex + 1}/{routePoints.length}</Text>
          </View>

          {/* ── Progress bar ── */}
          <View style={s.progWrap}>
            <TouchableOpacity
              style={s.progBg}
              activeOpacity={1}
              onPress={e => {
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / BAR_WIDTH));
                const idx = Math.round(ratio * (routePoints.length - 1));
                setIsPlaying(false);
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
                seekTo(idx);
              }}
            >
              <View style={[s.progFill, { width: `${progress}%` }]} />
              <View style={[s.progThumb, { left: `${Math.max(0, Math.min(98, progress))}%` }]} />
            </TouchableOpacity>
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

          {/* ── Stats grid ── */}
          <View style={s.statsGrid}>
            {/* Speed — big and green */}
            <View style={[s.stat, s.statWide]}>
              <Text style={[s.statV, { color: '#4ade80', fontSize: 22 }]}>
                {liveTel.speed}
              </Text>
              <Text style={s.statL}>Speed (kph)</Text>
            </View>


            {/* Mileage */}
            <View style={s.stat}>
              <Text style={[s.statV, { color: '#60a5fa' }]}>{liveTel.mileage}</Text>
              <Text style={s.statL}>Mileage km</Text>
            </View>

            {/* Total */}
            <View style={s.stat}>
              <Text style={[s.statV, { color: '#a78bfa' }]}>{totalKm}</Text>
              <Text style={s.statL}>Total km</Text>
            </View>
          </View>

          <View style={s.div} />

          {/* ── Controls ── */}
          <View style={s.controls}>
            <TouchableOpacity style={s.ctrlBtn} onPress={() => {
              setIsPlaying(false);
              if (animationRef.current) cancelAnimationFrame(animationRef.current);
              seekTo(0);
            }}>
              <Icon name="skip-backward" size={20} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity style={s.ctrlBtn} onPress={() => {
              setIsPlaying(false);
              if (animationRef.current) cancelAnimationFrame(animationRef.current);
              seekTo(Math.max(0, currentIndex - 1));
            }}>
              <Icon name="step-backward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.playBtn}
              onPress={() => {
                if (routePoints.length === 0) return;
                if (!isPlaying && currentIndex >= routePoints.length - 1) {
                  seekTo(0);
                  setTimeout(() => setIsPlaying(true), 60);
                } else {
                  setIsPlaying(p => !p);
                }
              }}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={s.ctrlBtn} onPress={() => {
              setIsPlaying(false);
              if (animationRef.current) cancelAnimationFrame(animationRef.current);
              seekTo(Math.min(routePoints.length - 1, currentIndex + 1));
            }}>
              <Icon name="step-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.speedBtn}
              onPress={() => setPlaySpeed(sp => SPEEDS[(SPEEDS.indexOf(sp) + 1) % SPEEDS.length])}
            >
              <Text style={s.speedTxt}>×{playSpeed}</Text>
            </TouchableOpacity>
          </View>

          {/* ── Address ── */}
          {currentAddress ? (
            <View style={s.addrBox}>
              <Text style={s.addrTxt} numberOfLines={2}>📍 {currentAddress}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* ── Date pickers ── */}
      <DatePicker
        modal open={showStartPicker} date={customStart}
        onConfirm={d => { setShowStartPicker(false); setCustomStart(d); setShowEndPicker(true); }}
        onCancel={() => setShowStartPicker(false)}
        title="Start Date/Time"
      />
      <DatePicker
        modal open={showEndPicker} date={customEnd} minimumDate={customStart}
        onConfirm={d => { setShowEndPicker(false); setCustomEnd(d); }}
        onCancel={() => setShowEndPicker(false)}
        title="End Date/Time"
      />

      {/* ── Loading overlay ── */}
      {loading && (
        <View style={s.loader}>
          <ActivityIndicator size="large" color="#f97316" />
          <Text style={s.loaderTxt}>Route load ho raha hai...</Text>
          <Text style={s.loaderSub}>{tfLabel[timeframe] || ''} ka GPS data fetch ho raha hai</Text>
        </View>
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0c14' },
  map: { flex: 1 },

  // Header
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
  },
  filterChipTxt: { fontSize: 11.5, color: '#f97316', fontWeight: '700' },

  // Zoom buttons (right side)
  zoomPanel: {
    position: 'absolute', right: 12, bottom: 320, zIndex: 18,
    backgroundColor: 'rgba(8,10,18,0.92)',
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1e2533',
    elevation: 8,
  },
  zoomBtn: {
    width: 42, height: 42,
    justifyContent: 'center', alignItems: 'center',
  },
  zoomTxt: { fontSize: 22, color: '#f1f5f9', fontWeight: '300', lineHeight: 26 },
  zoomDiv: { height: 1, backgroundColor: '#1e2533' },

  // Error banner
  errorBanner: {
    position: 'absolute', top: 90, left: 16, right: 16, zIndex: 25,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(127,29,29,0.95)', padding: 12,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  errorTxt: { flex: 1, color: '#fca5a5', fontSize: 12, fontWeight: '600' },

  // HUD
  hud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#0f1420',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(249,115,22,0.2)',
    elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.6, shadowRadius: 16,
  },

  // HUD top row
  hudTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  hudGpsTime: { flex: 1, fontSize: 11, color: '#64748b', fontWeight: '600' },
  ptCount: { fontSize: 10, color: '#2d3748' },

  // Progress bar
  progWrap: { marginBottom: 8 },
  progBg: {
    height: 8, backgroundColor: '#0d1117', borderRadius: 4,
    overflow: 'visible', position: 'relative',
    borderWidth: 1, borderColor: '#1e2533',
  },
  progFill: { height: '100%', backgroundColor: '#f97316', borderRadius: 4 },
  progThumb: {
    position: 'absolute', top: -5,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#fff', borderWidth: 2.5, borderColor: '#f97316',
    marginLeft: -9,
    shadowColor: '#f97316', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 8,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  timeTxt: { fontSize: 10, color: '#374151', fontWeight: '600' },

  // Stats grid
  statsGrid: {
    flexDirection: 'row', gap: 3, marginBottom: 6, alignItems: 'stretch',
  },
  stat: {
    flex: 1, alignItems: 'center',
    backgroundColor: '#0d1117', borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 3,
  },
  statWide: { flex: 1.4 },
  statV: { fontSize: 13, fontWeight: '800', color: '#f8fafc', textAlign: 'center' },
  statL: {
    fontSize: 8, color: '#374151', marginTop: 3,
    textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3,
  },
  div: { height: 1, backgroundColor: '#161e2e', marginVertical: 7 },

  // Controls
  controls: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 14, marginBottom: 10,
  },
  ctrlBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#0d1117', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#1e2533',
  },
  playBtn: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: '#f97316', justifyContent: 'center', alignItems: 'center',
    elevation: 10, shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.65, shadowRadius: 12,
  },
  speedBtn: {
    width: 52, height: 42, borderRadius: 12,
    backgroundColor: '#0d1117', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#f97316',
  },
  speedTxt: { fontSize: 13, fontWeight: '900', color: '#f97316' },

  // Address
  addrBox: {
    backgroundColor: '#0d1117', paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: '#1e2533', marginBottom: 2,
  },
  addrTxt: { fontSize: 11.5, color: '#6b7280', textAlign: 'center', lineHeight: 17 },

  // Modal
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

  // Loader
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,10,18,0.92)',
    justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  loaderTxt: { marginTop: 14, color: '#f97316', fontWeight: '800', fontSize: 14 },
  loaderSub: { marginTop: 5, color: '#4b5563', fontSize: 11 },
});

export default PlaybackScreen;