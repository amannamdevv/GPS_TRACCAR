import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
} from '@notifee/react-native';
import Tts from 'react-native-tts';
import moment from 'moment';
import { AppState } from 'react-native';
import BackgroundActions from 'react-native-background-actions';
import { fetchAlarms, fetchCustomEvents, fetchDeviceList, reverseGeocode } from '../api/webApi';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const LAST_EVENT_ID_KEY = 'lastCustomEventId';   // for custom_events API
const LAST_ALARM_ID_KEY = 'lastAlarmId';          // for alaram API
const POLLING_INTERVAL_MS = 5000;
const BACKGROUND_POLLING_INTERVAL_MS = 60000;

// ─── Alert visual config ──────────────────────────────────────────────────────
const ALERT_CONFIG = {
  // ── From custom_events_with_address_api ──
  ignitionOn: {
    title: '🟢 DG ON',
    color: '#00C853',
    speakPrefix: 'DG turned ON on',
  },
  ignitionOff: {
    title: '🔴 DG OFF',
    color: '#D50000',
    speakPrefix: 'DG turned OFF on',
  },

  // ── From alaram API ──
  powerCut: {
    title: '⚡ Power Cut Detected',
    color: '#FF3D00',
    speakPrefix: 'Warning! Power Cut Detected on',
  },
  lowBattery: {
    title: '🔋 Low Battery Alert',
    color: '#FF9100',
    speakPrefix: 'Low Battery Alert on',
  },
  vibration: {
    title: '📳 Vibration Detected',
    color: '#AA00FF',
    speakPrefix: 'Vibration Detected on',
  },
};

// ─── Service ──────────────────────────────────────────────────────────────────
class AlertNotificationService {
  constructor() {
    this.isPolling = false;
    this.channelId = null;
    this.deviceMap = {};   // deviceId → name (cache)
    this.deviceLocMap = {}; // deviceId → {lat, lon, address}
    this.alertCooldowns = {};   // `${deviceId}_${type}` → timestamp
    this._ttsReady = false;
    this._initDone = false;
    this._permissionGranted = false;
    this._firstCustomEventSync = true;
    this._firstAlarmSync = true;

    // Track app state to reduce data usage in background
    this.appState = AppState.currentState;
    AppState.addEventListener('change', nextAppState => {
      this.appState = nextAppState;
    });
  }

  // ── Initialise ───────────────────────────────────────────────────────────────

  async _init() {
    if (this._initDone) return;
    this._initDone = true;
    await this._requestPermission();
    await this._initChannel();
    this._initTts();
  }

  async _requestPermission() {
    try {
      const settings = await notifee.requestPermission();
      this._permissionGranted =
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
      console.log('[AlertService] Notification Permission granted:', this._permissionGranted);

      // Request location permissions gracefully so background service doesn't crash on Android 14
      const { PermissionsAndroid, Platform } = require('react-native');
      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
      }
    } catch (e) {
      // Older Android — no runtime permission needed, treat as granted
      this._permissionGranted = true;
    }
  }

  async _initChannel() {
    try {
      try { await notifee.deleteChannel('gps_alerts'); } catch (_) { }
      try { await notifee.deleteChannel('gps_alerts_v2'); } catch (_) { }
      try { await notifee.deleteChannel('gps_alerts_v3'); } catch (_) { }

      this.channelId = await notifee.createChannel({
        id: 'gps_alerts_v4',
        name: 'GPS Vehicle Alerts',
        description: 'Real-time GPS tracking alerts',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        vibration: true,
        sound: 'default',
        lights: true,
      });
      console.log('[AlertService] Channel ready:', this.channelId);
    } catch (e) {
      console.warn('[AlertService] Channel init error:', e.message);
      this.channelId = 'gps_alerts_v4';
    }
  }

  _initTts() {
    try {
      Tts.getInitStatus()
        .then(() => {
          Tts.setDefaultRate(0.48);
          Tts.setDefaultPitch(1.0);
          try { Tts.setDefaultLanguage('en-IN'); } catch (_) { }
          this._ttsReady = true;
          console.log('[AlertService] TTS ready');
        })
        .catch(e => console.warn('[AlertService] TTS init error', e));
    } catch (e) {
      console.warn('[AlertService] TTS catch', e);
    }
  }

  // ── Device name cache ─────────────────────────────────────────────────────────

  async _loadDevices() {
    try {
      const data = await fetchDeviceList();
      if (data?.devices) {
        data.devices.forEach(d => {
          if (d.id != null) {
            this.deviceMap[d.id] = d.name || `Device ${d.id}`;
            this.deviceLocMap[d.id] = { lat: d.motion_lat, lon: d.motion_lon, address: d.address };
          }
        });
      }
    } catch (e) {
      console.warn('[AlertService] loadDevices error', e);
    }
  }

  _getDeviceName(deviceId, fallbackName) {
    if (fallbackName && fallbackName !== 'Unknown Device') return fallbackName;
    if (!deviceId) return 'Unknown Vehicle';
    return this.deviceMap[deviceId] || `Vehicle #${deviceId}`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // POLL 1 — custom_events_with_address_api
  //          Covers: ignitionOn, ignitionOff, deviceMoving, deviceStopped
  // ══════════════════════════════════════════════════════════════════════════════

  async _pollCustomEvents() {
    try {
      const events = await fetchCustomEvents();
      if (!events?.length) return;
      await this._handleCustomEvents(events);
    } catch (e) {
      console.warn('[AlertService] pollCustomEvents error:', e.message);
    }
  }

  async _handleCustomEvents(events) {
    let lastId = await this._getStoredId(LAST_EVENT_ID_KEY);
    let maxNewId = lastId;

    // ── FIRST RUN: sync to current max, don't notify anything ───────────────
    if (lastId === 0 || this._firstCustomEventSync) {
      const maxId = events.reduce((m, e) => Math.max(m, parseInt(e.event_id, 10) || 0), 0);
      if (maxId > 0) {
        await this._saveStoredId(LAST_EVENT_ID_KEY, maxId);
        console.log('[AlertService] Custom events first run — synced to ID', maxId);
      }
      this._firstCustomEventSync = false;
      return;
    }

    // ── Only new events, oldest first ───────────────────────────────────────
    const fresh = events
      .filter(e => (parseInt(e.event_id, 10) || 0) > lastId)
      .sort((a, b) => parseInt(a.event_id, 10) - parseInt(b.event_id, 10));

    if (!fresh.length) return;

    const nowMs = Date.now();

    for (const ev of fresh) {
      const evId = parseInt(ev.event_id, 10);
      if (evId > maxNewId) maxNewId = evId;

      // Skip if older than 3 minutes (allows for normal GPS transmission delay)
      const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : nowMs;
      if (nowMs - evTimeMs > 3 * 60 * 1000) continue;

      const rawType = String(ev.event_type || '').trim();
      const typeKey = this._normaliseEventType(rawType);
      if (!typeKey) continue;

      const deviceId = ev.deviceid;
      const deviceName = this._getDeviceName(deviceId, ev.device_name);
      const cooldownKey = `${deviceId}_${typeKey}`;
      if (this._isCoolingDown(cooldownKey)) continue;
      this.alertCooldowns[cooldownKey] = Date.now();

      const payload = await this._buildCustomEventPayload(typeKey, deviceName, ev);
      if (!payload) continue;

      await this._sendNotification(payload);
      this._speak(payload.speakText);
      await new Promise(r => setTimeout(r, 1200));
    }

    if (maxNewId > lastId) await this._saveStoredId(LAST_EVENT_ID_KEY, maxNewId);
  }

  /** Maps raw event_type string → our ALERT_CONFIG key */
  _normaliseEventType(raw) {
    const lower = raw.toLowerCase();
    if (lower === 'ignitionon' || lower === 'ignition_on') return 'ignitionOn';
    if (lower === 'ignitionoff' || lower === 'ignition_off') return 'ignitionOff';
    if (lower === 'devicemoving' || lower.includes('moving')) return 'deviceMoving';
    if (lower === 'devicestopped' || lower.includes('stopped')) return 'deviceStopped';
    return null;
  }

  /** Build notification payload from a custom_events row */
  async _buildCustomEventPayload(typeKey, deviceName, ev) {
    const cfg = ALERT_CONFIG[typeKey];
    if (!cfg) return null;

    // event_time from API  (e.g. "2026-05-28T11:45:59")
    const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');

    // Address: prefer what API returns, fallback to reverseGeocode
    let address = ev.address && ev.address.trim() ? ev.address.trim() : null;

    if (!address) {
      const lat = ev.latitude || ev.lat;
      const lon = ev.longitude || ev.lon;
      if (lat && lon) {
        try { address = await reverseGeocode(lat, lon); } catch (_) {}
      }
    }

    // Notification body
    // Line 1: device name + time
    // Line 2: address (always shown if available)
    const body = address
      ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
      : `${deviceName}  •  ${timeLabel}`;

    return {
      type: typeKey,
      title: cfg.title,
      body,
      speakText: `${cfg.speakPrefix} ${deviceName}`,
      timestamp: evTimeMs,
      color: cfg.color,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // POLL 2 — /alaram/
  //          Covers: powerCut, lowBattery, vibration (and anything else)
  // ══════════════════════════════════════════════════════════════════════════════

  async _pollAlarms() {
    try {
      const data = await fetchAlarms();
      const alarmList = Array.isArray(data) ? data : (data?.data ?? []);
      await this._handleAlarms(alarmList);
    } catch (e) {
      console.warn('[AlertService] pollAlarms error:', e.message);
    }
  }

  async _handleAlarms(alarms) {
    if (!alarms?.length) return;

    let lastId = await this._getStoredId(LAST_ALARM_ID_KEY);
    let maxNewId = lastId;

    // ── FIRST RUN ────────────────────────────────────────────────────────────
    if (lastId === 0 || this._firstAlarmSync) {
      const maxId = alarms.reduce((m, a) => Math.max(m, parseInt(a.id, 10) || 0), 0);
      if (maxId > 0) {
        await this._saveStoredId(LAST_ALARM_ID_KEY, maxId);
        console.log('[AlertService] Alarms first run — synced to ID', maxId);
      }
      this._firstAlarmSync = false;
      return;
    }

    const fresh = alarms
      .filter(a => (parseInt(a.id, 10) || 0) > lastId)
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

    if (!fresh.length) return;

    const nowMs = Date.now();

    for (const alarm of fresh) {
      const alarmId = parseInt(alarm.id, 10);
      if (alarmId > maxNewId) maxNewId = alarmId;

      // Skip stale alarms (older than 3 minutes)
      const evTimeStr = alarm.eventtime || alarm.serverTime;
      const evTimeMs = evTimeStr ? new Date(evTimeStr).getTime() : nowMs;
      if (nowMs - evTimeMs > 3 * 60 * 1000) continue;

      const deviceId = alarm.deviceid ?? alarm.deviceId;
      const deviceName = this._getDeviceName(deviceId, alarm.device_name);
      
      let address = null;
      let lat = alarm.latitude || alarm.lat || alarm.attributes?.latitude || alarm.attributes?.lat;
      let lon = alarm.longitude || alarm.lon || alarm.attributes?.longitude || alarm.attributes?.lon;
      
      if (!lat && this.deviceLocMap[deviceId]) {
        lat = this.deviceLocMap[deviceId].lat;
        lon = this.deviceLocMap[deviceId].lon;
        address = this.deviceLocMap[deviceId].address;
      }
      
      if (!address && lat && lon) {
        try { address = await reverseGeocode(lat, lon); } catch (_) {}
      }

      const payload = this._parseAlarm(alarm, deviceName, address);
      if (!payload) continue;

      const cooldownKey = `${deviceId}_${payload.type}`;
      if (this._isCoolingDown(cooldownKey)) continue;
      this.alertCooldowns[cooldownKey] = Date.now();

      await this._sendNotification(payload);
      this._speak(payload.speakText);
      await new Promise(r => setTimeout(r, 1200));
    }

    if (maxNewId > lastId) await this._saveStoredId(LAST_ALARM_ID_KEY, maxNewId);
  }

  /** Parse alarm API row → notification payload */
  _parseAlarm(alarm, deviceName, address = null) {
    const rawType = String(alarm.type || '').trim().toLowerCase();
    const rawAttr = String(alarm.attributes?.alarm || '').trim().toLowerCase();
    const ignition = alarm.attributes?.ignition;
    const motion = alarm.attributes?.motion;
    const batRaw = alarm.attributes?.batteryLevel ?? alarm.attributes?.battery;
    const battery = batRaw != null ? parseFloat(batRaw) : null;

    const evTimeStr = alarm.eventtime || alarm.serverTime;
    const evTimeMs = evTimeStr ? new Date(evTimeStr).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');

    const make = (typeKey, detail, extraSpeak = '') => {
      const cfg = ALERT_CONFIG[typeKey] || {};
      const fullDetail = address && address !== '—' ? `${detail}\n📍 ${address}` : detail;
      return {
        type: typeKey,
        title: cfg.title || `🔔 ${typeKey}`,
        body: `${deviceName}  •  ${timeLabel}\n${fullDetail}`,
        speakText: `${cfg.speakPrefix || typeKey} ${deviceName}. ${extraSpeak}`,
        timestamp: evTimeMs,
        color: cfg.color || '#1565C0',
      };
    };

    if (rawType.includes('powercut') || rawAttr.includes('powercut'))
      return make('powerCut', '🔌 Power supply disconnected');

    if (rawType.includes('lowbattery') || rawAttr.includes('lowbattery') ||
      (battery !== null && battery > 0 && battery <= 15)) {
      const pct = battery != null ? `${Math.round(battery)}%` : '';
      return make('lowBattery', `🔋 Battery low${pct ? ' ' + pct : ''}`, pct ? `Battery at ${pct}.` : '');
    }

    if (rawType.includes('vibration') || rawAttr.includes('vibration'))
      return make('vibration', '📳 Unusual vibration detected');

    // Fallback for any other alarm type
    if (alarm.type) {
      const label = alarm.type;
      const detail = rawAttr || label;
      const fullDetail = address && address !== '—' ? `${detail}\n📍 ${address}` : detail;
      return {
        type: alarm.type,
        title: `🔔 ${label}`,
        body: `${deviceName}  •  ${timeLabel}\n${fullDetail}`,
        speakText: `${label} on ${deviceName}`,
        timestamp: evTimeMs,
        color: '#1565C0',
      };
    }

    return null;
  }

  // ── Send notification ─────────────────────────────────────────────────────────

  async _sendNotification(payload) {
    if (!this._permissionGranted) {
      console.warn('[AlertService] No permission — skipping notification');
      return;
    }
    try {
      const id = await notifee.displayNotification({
        title: payload.title,
        body: payload.body,
        android: {
          channelId: this.channelId,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          smallIcon: 'ic_launcher',
          color: payload.color,
          showTimestamp: true,
          timestamp: payload.timestamp,
          vibrationPattern: [100, 400, 200, 400],
          pressAction: { id: 'default' },
        },
      });
      console.log('[AlertService] ✅ Notification sent:', payload.title, '| id:', id);
    } catch (e) {
      console.error('[AlertService] ❌ displayNotification FAILED:', e.message);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────────

  _speak(text) {
    if (!text) return;
    
    // Explicitly replace '0' with 'zero'
    const spacedText = text.replace(/0/g, 'zero ').replace(/(\d)/g, '$1 ');

    try {
      Tts.stop();
      setTimeout(() => { if (this._ttsReady) Tts.speak(spacedText); }, 400);
    } catch (e) {
      console.warn('[AlertService] TTS speak error', e);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _isCoolingDown(key) {
    return Date.now() - (this.alertCooldowns[key] || 0) < 5 * 60 * 1000;
  }

  async _getStoredId(key) {
    try {
      const v = await AsyncStorage.getItem(key);
      return v ? parseInt(v, 10) : 0;
    } catch { return 0; }
  }

  async _saveStoredId(key, id) {
    try { await AsyncStorage.setItem(key, id.toString()); }
    catch (e) { console.warn('[AlertService] saveStoredId error', e); }
  }

  // ── Background loop ───────────────────────────────────────────────────────────

  backgroundTask = async () => {
    let loops = 0;
    await new Promise(async () => {
      while (BackgroundActions.isRunning()) {
        // Refresh device name map every ~1 minute
        if (loops % (60000 / POLLING_INTERVAL_MS) === 0) await this._loadDevices();

        // Run both polls every cycle
        await this._pollCustomEvents(); // ignition / motion (with address)
        await this._pollAlarms();       // power cut / battery / vibration

        loops++;
        
        // Wait 5 seconds in foreground, 60 seconds in background to save data
        const waitTime = this.appState === 'active' ? POLLING_INTERVAL_MS : BACKGROUND_POLLING_INTERVAL_MS;
        await new Promise(r => setTimeout(r, waitTime));
      }
    });
  };

  // ── Public API ────────────────────────────────────────────────────────────────

  /** Allow external screens to parse an alarm for display */
  parseAlarm(alarm, deviceName) {
    return this._parseAlarm(alarm, deviceName, null);
  }

  async start() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      await this._init();

      const options = {
        taskName: 'GPSAlerts',
        taskTitle: 'GPS Tracking Active',
        taskDesc: 'Monitoring real-time vehicle alerts',
        taskIcon: { name: 'ic_launcher', type: 'mipmap' },
        color: '#1565C0',
        linkingURI: 'traccarmanager://',
        parameters: {},
      };

      const { Platform } = require('react-native');
      if (Platform.OS === 'android' && Platform.Version >= 34) {
        // Required for Android 14 (API 34)
        options.foregroundServiceTypes = ['dataSync', 'location'];
      }

      try {
        await this._loadDevices();
        await BackgroundActions.start(this.backgroundTask, options);
        console.log('[AlertService] Background task started ✅');
      } catch (e) {
        console.warn('[AlertService] Background task failed — using foreground fallback:', e.message);
        await this._loadDevices();
        
        const runFallback = async () => {
          if (!this.isPolling) return;
          await this._pollCustomEvents();
          await this._pollAlarms();
          
          const waitTime = this.appState === 'active' ? POLLING_INTERVAL_MS : BACKGROUND_POLLING_INTERVAL_MS;
          this._fallbackTimeout = setTimeout(runFallback, waitTime);
        };
        runFallback();
      }
    } catch (e) {
      console.error('[AlertService] Critical error during start:', e);
      this.isPolling = false;
    }
  }

  stop() {
    this.isPolling = false;
    BackgroundActions.stop().catch(() => { });
    if (this._fallbackTimeout) {
      clearTimeout(this._fallbackTimeout);
      this._fallbackTimeout = null;
    }
    console.log('[AlertService] Stopped.');
  }
}

export default new AlertNotificationService();