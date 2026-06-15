import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
} from '@notifee/react-native';
import Tts from 'react-native-tts';
import moment from 'moment';
import { AppState } from 'react-native';
// ✅ FIX 1: fetchCustomEvents was never imported — added it here
import { fetchAlarms, fetchDeviceList, fetchCustomEvents, reverseGeocode } from '../api/webApi';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const LAST_EVENT_ID_KEY = 'lastCustomEventId';
const LAST_ALARM_ID_KEY = 'lastAlarmId';
const POLLING_INTERVAL_MS = 10000;
const BACKGROUND_POLLING_INTERVAL_MS = 60000;

// ─── Alert visual config ──────────────────────────────────────────────────────
const ALERT_CONFIG = {
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
  deviceMoving: {
    title: '🚚 DG Move',
    color: '#FF9800',
    speakPrefix: 'DG moving on',
  },
  deviceStopped: {
    title: '🛑 DG Stop',
    color: '#D32F2F',
    speakPrefix: 'DG stopped on',
  },
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
    this.deviceMap = {};
    this.deviceLocMap = {};
    this.alertCooldowns = {};
    this.deviceStateCache = {};
    this.allowedDeviceIds = new Set();
    this._ttsReady = false;
    this._initDone = false;
    this._permissionGranted = false;
    this._firstCustomEventSync = true;
    this._firstAlarmSync = true;
    this._fallbackTimeout = null;

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

      const { PermissionsAndroid, Platform } = require('react-native');
      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
      }
    } catch (e) {
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
        name: 'GPS DG Alerts',
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
        for (const d of data.devices) {
          if (d.id == null) continue;

          const curIgnition = d.dg_status === 1 ? 1 : 0;
          const curMotion = d.motion_status === 1 ? 1 : 0;

          const deviceName = d.name || `Device ${d.id}`;
          this.deviceMap[d.id] = deviceName;
          this.deviceLocMap[d.id] = { lat: d.motion_lat, lon: d.motion_lon, address: d.address };

          const prevState = this.deviceStateCache[d.id];

          // First poll — just store state, don't notify
          if (!prevState) {
            this.deviceStateCache[d.id] = { ignition: curIgnition, motion: curMotion };
            continue;
          }

          const timeLabel = moment().format('hh:mm A, DD MMM YYYY');
          const address = d.address || '';
          const nowMs = Date.now();

          // ── Ignition change → DG ON / DG OFF ──
          if (curIgnition !== prevState.ignition) {
            const typeKey = curIgnition === 1 ? 'ignitionOn' : 'ignitionOff';
            const cooldownKey = `${d.id}_${typeKey}`;
            if (!this._isCoolingDown(cooldownKey)) {
              this.alertCooldowns[cooldownKey] = nowMs;
              const cfg = ALERT_CONFIG[typeKey];
              const body = address
                ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
                : `${deviceName}  •  ${timeLabel}`;
              const payload = {
                type: typeKey,
                title: cfg.title,
                body,
                speakText: `${cfg.speakPrefix} ${deviceName}`,
                timestamp: nowMs,
                color: cfg.color,
              };
              await this._sendNotification(payload);
              this._speak(payload.speakText);
              await new Promise(r => setTimeout(r, 800));
            }
          }

          // ── Motion change → DG MOVE / DG STOP ──
          if (curMotion !== prevState.motion) {
            const typeKey = curMotion === 1 ? 'deviceMoving' : 'deviceStopped';
            const cooldownKey = `${d.id}_${typeKey}`;
            if (!this._isCoolingDown(cooldownKey)) {
              this.alertCooldowns[cooldownKey] = nowMs;
              const cfg = ALERT_CONFIG[typeKey];
              const body = address
                ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
                : `${deviceName}  •  ${timeLabel}`;
              const payload = {
                type: typeKey,
                title: cfg.title,
                body,
                speakText: `${cfg.speakPrefix} ${deviceName}`,
                timestamp: nowMs,
                color: cfg.color,
              };
              await this._sendNotification(payload);
              this._speak(payload.speakText);
              await new Promise(r => setTimeout(r, 800));
            }
          }

          this.deviceStateCache[d.id] = { ignition: curIgnition, motion: curMotion };
        }
      }
      // ✅ Always rebuild allowedDeviceIds after _loadDevices so _pollAlarms has it
      this.allowedDeviceIds = new Set(Object.keys(this.deviceMap).map(k => String(k)));
      console.log('[AlertService] allowedDeviceIds updated, count:', this.allowedDeviceIds.size);
    } catch (e) {
      console.warn('[AlertService] loadDevices error', e);
    }
  }

  _getDeviceName(deviceId, fallbackName) {
    if (fallbackName && fallbackName !== 'Unknown Device') return fallbackName;
    if (!deviceId) return 'Unknown DG';
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

    // ── FIRST RUN: sync to current max, don't notify ─────────────────────────
    if (lastId === 0) {
      const maxId = events.reduce((m, e) => Math.max(m, parseInt(e.event_id, 10) || 0), 0);
      if (maxId > 0) {
        await this._saveStoredId(LAST_EVENT_ID_KEY, maxId);
        console.log('[AlertService] Custom events first run — synced to ID', maxId);
      }
      this._firstCustomEventSync = false;
      return;
    }

    const fresh = events
      .filter(e => (parseInt(e.event_id, 10) || 0) > lastId)
      .sort((a, b) => parseInt(a.event_id, 10) - parseInt(b.event_id, 10));

    if (!fresh.length) return;

    const nowMs = Date.now();

    for (const ev of fresh) {
      const evId = parseInt(ev.event_id, 10);
      if (evId > maxNewId) maxNewId = evId;

      const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : nowMs;
      if (nowMs - evTimeMs > 12 * 60 * 60 * 1000) continue;

      const rawType = String(ev.event_type || '').trim();
      const typeKey = this._normaliseEventType(rawType);
      if (!typeKey) continue;

      const deviceId = ev.deviceid;
      if (!this.allowedDeviceIds.has(String(deviceId))) {
        continue;
      }
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

  _normaliseEventType(raw) {
    const lower = raw.toLowerCase();
    if (lower === 'ignitionon' || lower === 'ignition_on') return 'ignitionOn';
    if (lower === 'ignitionoff' || lower === 'ignition_off') return 'ignitionOff';
    if (lower === 'devicemoving' || lower.includes('moving')) return 'deviceMoving';
    if (lower === 'devicestopped' || lower.includes('stopped')) return 'deviceStopped';
    return null;
  }

  async _buildCustomEventPayload(typeKey, deviceName, ev) {
    const cfg = ALERT_CONFIG[typeKey];
    if (!cfg) return null;

    const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');

    let address = ev.address && ev.address.trim() ? ev.address.trim() : null;
    if (!address) {
      const lat = ev.latitude || ev.lat;
      const lon = ev.longitude || ev.lon;
      if (lat && lon) {
        try { address = await reverseGeocode(lat, lon); } catch (_) { }
      }
    }

    const body = address
      ? `${deviceName}  •  ${timeLabel}\nType: ${typeKey}\n📍 ${address}`
      : `${deviceName}  •  ${timeLabel}\nType: ${typeKey}`;

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
  //          Covers: powerCut, lowBattery, vibration
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
    if (lastId === 0) {
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

      const evTimeStr = alarm.eventtime || alarm.serverTime;
      const evTimeMs = evTimeStr ? new Date(evTimeStr).getTime() : nowMs;
      if (nowMs - evTimeMs > 12 * 60 * 60 * 1000) continue;

      const deviceId = alarm.deviceid ?? alarm.deviceId ?? alarm.device_id;
      if (!this.allowedDeviceIds.has(String(deviceId))) {
        continue;
      }
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
        try { address = await reverseGeocode(lat, lon); } catch (_) { }
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

  _parseAlarm(alarm, deviceName, address = null) {
    const rawType = String(alarm.type || '').trim().toLowerCase();
    const rawAttr = String(alarm.attributes?.alarm || '').trim().toLowerCase();
    const batRaw = alarm.attributes?.batteryLevel ?? alarm.attributes?.battery;
    const battery = batRaw != null ? parseFloat(batRaw) : null;

    const evTimeStr = alarm.eventtime || alarm.serverTime;
    const evTimeMs = evTimeStr ? new Date(evTimeStr).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');

    // ✅ FIX: also handle comma-separated alarm types like "lowBattery,lowBattery"
    const alarmFieldRaw = String(alarm.alarm || alarm.attributes?.alarm || '').toLowerCase();
    const alarmTypes = alarmFieldRaw.split(',').map(s => s.trim());

    const make = (typeKey, detail, extraSpeak = '') => {
      const cfg = ALERT_CONFIG[typeKey] || {};
      const fullDetail = address && address !== '—' ? `${detail}\n📍 ${address}` : detail;
      return {
        type: typeKey,
        title: cfg.title || `🔔 ${typeKey}`,
        body: `${deviceName}  •  ${timeLabel}\nType: ${typeKey}\n${fullDetail}`,
        speakText: `${cfg.speakPrefix || typeKey} ${deviceName}. ${extraSpeak}`,
        timestamp: evTimeMs,
        color: cfg.color || '#1565C0',
      };
    };

    // Check all possible alarm fields for power cut
    if (rawType.includes('powercut') || rawAttr.includes('powercut') || alarmTypes.includes('powercut'))
      return make('powerCut', '🔌 Power supply disconnected');

    // Check all possible alarm fields for low battery
    if (rawType.includes('lowbattery') || rawAttr.includes('lowbattery') ||
      alarmTypes.includes('lowbattery') ||
      (battery !== null && battery >= 0 && battery <= 15)) {
      const pct = battery != null ? `${Math.round(battery)}%` : '';
      return make('lowBattery', `🔋 Battery low${pct ? ' ' + pct : ''}`, pct ? `Battery at ${pct}.` : '');
    }

    // Check all possible alarm fields for vibration
    if (rawType.includes('vibration') || rawAttr.includes('vibration') || alarmTypes.includes('vibration'))
      return null; // Explicitly ignored per user request

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

  async _speak(text) {
    if (!text) return;
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

  // ── One full poll cycle ───────────────────────────────────────────────────────
  // ✅ FIX: Extracted to a single method so both backgroundTask and fallback use same logic
  // Order matters: _loadDevices MUST run first to populate allowedDeviceIds
  async _runOneCycle() {
    // Load devices first – this also rebuilds allowedDeviceIds for the current user
    await this._loadDevices();
    // If after loading there are no devices scoped to this user, skip this poll cycle
    if (!this.allowedDeviceIds || this.allowedDeviceIds.size === 0) {
      console.warn('[AlertService] No allowed devices for current user – skipping poll cycle');
      return;
    }
    await this._pollCustomEvents();     // ✅ Fires event‑based alerts
    await this._pollAlarms();           // Fires powerCut / lowBattery / vibration
  }

  // Manually trigger a single poll cycle (useful for testing/debug)
  async refreshNow() {
    if (!this.isPolling) {
      console.warn('[AlertService] refreshNow called but service not started');
      return;
    }
    console.log('[AlertService] Manual refresh triggered');
    await this._runOneCycle();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  parseAlarm(alarm, deviceName) {
    return this._parseAlarm(alarm, deviceName, null);
  }

  async start() {
    if (this.isPolling) return;
    this.isPolling = true;

    await this._init(); // ✅ FIX: ensure channel + permissions are ready before anything else

    try {
      try {
        const { PermissionsAndroid, Platform } = require('react-native');
        if (Platform.OS === 'android') {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
          );
        }
      } catch (e) { console.warn('[AlertService] Battery opt ignore request failed', e.message); }

      console.log('[AlertService] Starting foreground-only polling loop');

      const runLoop = async () => {
        if (!this.isPolling) return;

        // Only run the alert cycle if the app is actively in the foreground
        if (this.appState === 'active') {
          await this._runOneCycle();
        }

        this._fallbackTimeout = setTimeout(runLoop, POLLING_INTERVAL_MS);
      };

      runLoop();
    } catch (e) {
      console.error('[AlertService] Critical error during start:', e);
      this.isPolling = false;
    }
  }

  stop() {
    this.isPolling = false;
    if (this._fallbackTimeout) {
      clearTimeout(this._fallbackTimeout);
      this._fallbackTimeout = null;
    }
    console.log('[AlertService] Stopped.');
  }
}

export default new AlertNotificationService();