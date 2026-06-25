import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
} from '@notifee/react-native';
import Tts from 'react-native-tts';
import moment from 'moment';
import { AppState } from 'react-native';
import { fetchAlarms, fetchDeviceList, fetchCustomEvents, reverseGeocode } from '../api/webApi';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const LAST_EVENT_ID_KEY = 'lastCustomEventId';
const LAST_ALARM_ID_KEY = 'lastAlarmId';
const POLLING_INTERVAL_MS = 300000; // 5 minutes (300,000 ms)

// ─── Alert visual config ──────────────────────────────────────────────────────
const ALERT_CONFIG = {
  ignitionOn: { title: '🟢 DG ON', color: '#00C853', speakPrefix: 'DG turned ON on' },
  ignitionOff: { title: '🔴 DG OFF', color: '#D50000', speakPrefix: 'DG turned OFF on' },
  deviceMoving: { title: '🚚 DG Move', color: '#FF9800', speakPrefix: 'DG moving on' },
  deviceStopped: { title: '🛑 DG Stop', color: '#D32F2F', speakPrefix: 'DG stopped on' },
  powerCut: { title: '⚡ Power Cut Detected', color: '#FF3D00', speakPrefix: 'Warning! Power Cut Detected on' },
  lowBattery: { title: '🔋 Low Battery Alert', color: '#FF9100', speakPrefix: 'Low Battery Alert on' },
  vibration: { title: '📳 Vibration Detected', color: '#AA00FF', speakPrefix: 'Vibration Detected on' },
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
    this._fallbackTimeout = null;
    this._appState = AppState.currentState;

    // Track app state — only poll when foreground
    AppState.addEventListener('change', next => { this._appState = next; });
    console.log('[AlertService] Initialized, appState:', this._appState);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async _init() {
    if (this._initDone) return;
    this._initDone = true;
    await this._requestPermission();
    await this._initChannel();
    this._registerForegroundHandler(); // ✅ KEY FIX — must call this
    this._initTts();
  }

  async _requestPermission() {
    try {
      const settings = await notifee.requestPermission({
        ios: {
          // iOS specific options if needed
        },
        android: {
          // Ensure Android 13+ permission for POST_NOTIFICATIONS
          // notifee handles this internally, but we keep for clarity
        },
      });
      this._permissionGranted =
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
      console.log('[AlertService] Notification permission status:', settings.authorizationStatus);
    } catch (err) {
      console.warn('[AlertService] Permission request error:', err);
      this._permissionGranted = true;
    }
  }

  async _initChannel() {
    try {
      // Clean old channels
      for (const old of ['gps_alerts', 'gps_alerts_v2', 'gps_alerts_v3', 'gps_alerts_v4']) {
        try { await notifee.deleteChannel(old); } catch (_) { }
      }
      this.channelId = await notifee.createChannel({
        id: 'gps_alerts_v5',
        name: 'GPS DG Alerts',
        description: 'Real-time GPS tracking alerts',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        vibration: true,
        sound: 'default',
        lights: true,
      });
    } catch (_) {
      this.channelId = 'gps_alerts_v5';
    }
  }

  // ✅ KEY FIX — Foreground me notification dikhne ke liye yeh MUST hai
  // Notifee by default foreground me notifications block karta hai
  // Yeh handler register karne ke baad foreground me bhi dikhega
  _registerForegroundHandler() {
    notifee.onForegroundEvent(({ type, detail }) => {
      // Bas register karna kaafi hai — notifee automatically dikhayega
      // EventType.PRESS pe kuch karna ho to yahan karo
      if (type === EventType.PRESS) {
        console.log('[AlertService] Notification pressed:', detail?.notification?.title);
      }
    });
    console.log('[AlertService] Foreground handler registered ✅');
  }

  _initTts() {
    try {
      Tts.getInitStatus()
        .then(() => {
          Tts.setDefaultRate(0.48);
          Tts.setDefaultPitch(1.0);
          try { Tts.setDefaultLanguage('en-IN'); } catch (_) { }
          this._ttsReady = true;
        })
        .catch(() => { });
    } catch (_) { }
  }

  // ── Device loader ─────────────────────────────────────────────────────────────
  async _loadDevices() {
    try {
      const data = await fetchDeviceList();
      if (!data?.devices) return;

      const nowMs = Date.now();

      for (const d of data.devices) {
        if (d.id == null) continue;

        const curIgnition = d.dg_status === 1 ? 1 : 0;
        const curMotion = d.motion_status === 1 ? 1 : 0;
        const deviceName = d.name || `Device ${d.id}`;

        this.deviceMap[d.id] = deviceName;
        this.deviceLocMap[d.id] = { lat: d.motion_lat, lon: d.motion_lon, address: d.address };

        const prevState = this.deviceStateCache[d.id];

        // First poll — store state only, no notification
        if (!prevState) {
          this.deviceStateCache[d.id] = { ignition: curIgnition, motion: curMotion };
          continue;
        }

        const timeLabel = moment().format('hh:mm A, DD MMM YYYY');
        const address = d.address || '';

        // DG ON / DG OFF
        if (curIgnition !== prevState.ignition) {
          const typeKey = curIgnition === 1 ? 'ignitionOn' : 'ignitionOff';
          const cooldownKey = `${d.id}_${typeKey}`;
          if (!this._isCoolingDown(cooldownKey)) {
            this.alertCooldowns[cooldownKey] = nowMs;
            const cfg = ALERT_CONFIG[typeKey];
            const body = address
              ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
              : `${deviceName}  •  ${timeLabel}`;
            await this._sendNotification({
              type: typeKey, title: cfg.title, body,
              speakText: `${cfg.speakPrefix} ${deviceName}`, timestamp: nowMs, color: cfg.color
            });
            this._speak(`${cfg.speakPrefix} ${deviceName}`);
            await this._delay(800);
          }
        }

        // DG MOVE / DG STOP
        if (curMotion !== prevState.motion) {
          const typeKey = curMotion === 1 ? 'deviceMoving' : 'deviceStopped';
          const cooldownKey = `${d.id}_${typeKey}`;
          if (!this._isCoolingDown(cooldownKey)) {
            this.alertCooldowns[cooldownKey] = nowMs;
            const cfg = ALERT_CONFIG[typeKey];
            const body = address
              ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
              : `${deviceName}  •  ${timeLabel}`;
            await this._sendNotification({
              type: typeKey, title: cfg.title, body,
              speakText: `${cfg.speakPrefix} ${deviceName}`, timestamp: nowMs, color: cfg.color
            });
            this._speak(`${cfg.speakPrefix} ${deviceName}`);
            await this._delay(800);
          }
        }

        this.deviceStateCache[d.id] = { ignition: curIgnition, motion: curMotion };
      }

      this.allowedDeviceIds = new Set(Object.keys(this.deviceMap).map(String));
    } catch (e) {
      console.warn('[AlertService] loadDevices error:', e.message);
    }
  }

  _getDeviceName(deviceId, fallbackName) {
    if (fallbackName && fallbackName !== 'Unknown Device') return fallbackName;
    return this.deviceMap[deviceId] || `Vehicle #${deviceId}`;
  }

  // ── Poll 1 — Custom events (ignitionOn/Off, moving/stopped) ─────────────────
  async _pollCustomEvents() {
    try {
      console.log('[AlertService] Requesting custom events');
      const events = await fetchCustomEvents();
      console.log('[AlertService] Received custom events count:', events?.length || 0);
      if (!events?.length) return;
      await this._handleCustomEvents(events);
    } catch (e) {
      console.warn('[AlertService] pollCustomEvents error:', e.message);
    }
  }

  async _handleCustomEvents(events) {
    let lastId = await this._getStoredId(LAST_EVENT_ID_KEY);
    let maxNewId = lastId;
    console.log('[AlertService] _handleCustomEvents start – lastId:', lastId);

    // First run — sync to latest ID, don't notify
    if (lastId === 0) {
      const maxId = events.reduce((m, e) => Math.max(m, parseInt(e.event_id, 10) || 0), 0);
      if (maxId > 0) await this._saveStoredId(LAST_EVENT_ID_KEY, maxId);
      console.log('[AlertService] First run – synced lastEventId to', maxId);
      return;
    }

    const fresh = events
      .filter(e => (parseInt(e.event_id, 10) || 0) > lastId)
      .sort((a, b) => parseInt(a.event_id, 10) - parseInt(b.event_id, 10));
    console.log('[AlertService] fresh events count:', fresh.length);
    if (!fresh.length) return;

    const nowMs = Date.now();

    for (const ev of fresh) {
      const evId = parseInt(ev.event_id, 10);
      console.log('[AlertService] processing eventId', evId, 'deviceId', ev.deviceid);
      if (evId > maxNewId) maxNewId = evId;

      const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : nowMs;
      if (nowMs - evTimeMs > 12 * 60 * 60 * 1000) continue; // skip >12hr old

      const typeKey = this._normaliseEventType(String(ev.event_type || ''));
      if (!typeKey) continue;

      const deviceId = ev.deviceid;
      if (!this.allowedDeviceIds.has(String(deviceId))) {
        console.log('[AlertService] deviceId', deviceId, 'not in allowedDeviceIds');
        continue;
      }

      const cooldownKey = `${deviceId}_${typeKey}`;
      if (this._isCoolingDown(cooldownKey)) continue;
      this.alertCooldowns[cooldownKey] = Date.now();

      const deviceName = this._getDeviceName(deviceId, ev.device_name);
      const payload = await this._buildCustomEventPayload(typeKey, deviceName, ev);
      if (!payload) continue;

      console.log('[AlertService] sending notification for eventId', evId);
      await this._sendNotification(payload);
      this._speak(`${payload.speakText}`);
      await this._delay(1200);
    }

    if (maxNewId > lastId) {
      await this._saveStoredId(LAST_EVENT_ID_KEY, maxNewId);
      console.log('[AlertService] updated LAST_EVENT_ID_KEY to', maxNewId);
    }
  }

  _normaliseEventType(raw) {
    const l = raw.toLowerCase();
    if (l === 'ignitionon' || l === 'ignition_on') return 'ignitionOn';
    if (l === 'ignitionoff' || l === 'ignition_off') return 'ignitionOff';
    if (l === 'devicemoving' || l.includes('moving')) return 'deviceMoving';
    if (l === 'devicestopped' || l.includes('stopped')) return 'deviceStopped';
    return null;
  }

  async _buildCustomEventPayload(typeKey, deviceName, ev) {
    const cfg = ALERT_CONFIG[typeKey];
    if (!cfg) return null;
    const evTimeMs = ev.event_time ? new Date(ev.event_time).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');
    let address = ev.address?.trim() || null;
    if (!address && (ev.latitude || ev.lat) && (ev.longitude || ev.lon)) {
      try { address = await reverseGeocode(ev.latitude || ev.lat, ev.longitude || ev.lon); } catch (_) { }
    }
    const body = address
      ? `${deviceName}  •  ${timeLabel}\n📍 ${address}`
      : `${deviceName}  •  ${timeLabel}`;
    return {
      type: typeKey, title: cfg.title, body,
      speakText: `${cfg.speakPrefix} ${deviceName}`, timestamp: evTimeMs, color: cfg.color
    };
  }

  // ── Poll 2 — Alarms (powerCut, lowBattery, vibration) ───────────────────────
  async _pollAlarms() {
    try {
      console.log('[AlertService] Requesting alarms');
      const data = await fetchAlarms();
      const alarmList = Array.isArray(data) ? data : (data?.data ?? []);
      console.log('[AlertService] Received alarms count:', alarmList?.length || 0);
      await this._handleAlarms(alarmList);
    } catch (e) {
      console.warn('[AlertService] pollAlarms error:', e.message);
    }
  }

  async _handleAlarms(alarms) {
    if (!alarms?.length) return;

    const lastId = await this._getStoredId(LAST_ALARM_ID_KEY);
    console.log('[AlertService] _handleAlarms start – lastId:', lastId);
    let maxNewId = lastId;

    if (lastId === 0) {
      const maxId = alarms.reduce((m, a) => Math.max(m, parseInt(a.id, 10) || 0), 0);
      if (maxId > 0) await this._saveStoredId(LAST_ALARM_ID_KEY, maxId);
      console.log('[AlertService] First run – synced lastAlarmId to', maxId);
      return;
    }

    const fresh = alarms
      .filter(a => (parseInt(a.id, 10) || 0) > lastId)
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
    console.log('[AlertService] fresh alarms count:', fresh.length);
    if (!fresh.length) return;

    const nowMs = Date.now();

    for (const alarm of fresh) {
      const alarmId = parseInt(alarm.id, 10);
      console.log('[AlertService] processing alarmId', alarmId, 'deviceId', alarm.deviceid);
      if (alarmId > maxNewId) maxNewId = alarmId;

      const evTimeMs = alarm.eventtime || alarm.serverTime
        ? new Date(alarm.eventtime || alarm.serverTime).getTime() : nowMs;
      if (nowMs - evTimeMs > 12 * 60 * 60 * 1000) continue;

      const deviceId = alarm.deviceid ?? alarm.deviceId ?? alarm.device_id;
      if (!this.allowedDeviceIds.has(String(deviceId))) {
        console.log('[AlertService] alarm deviceId', deviceId, 'not allowed');
        continue;
      }

      const deviceName = this._getDeviceName(deviceId, alarm.device_name);

      let address = null;
      let lat = alarm.latitude || alarm.lat || alarm.attributes?.latitude;
      let lon = alarm.longitude || alarm.lon || alarm.attributes?.longitude;
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

      console.log('[AlertService] sending notification for alarmId', alarmId);
      await this._sendNotification(payload);
      this._speak(payload.speakText);
      await this._delay(1200);
    }

    if (maxNewId > lastId) {
      await this._saveStoredId(LAST_ALARM_ID_KEY, maxNewId);
      console.log('[AlertService] updated LAST_ALARM_ID_KEY to', maxNewId);
    }
  }

  _parseAlarm(alarm, deviceName, address = null) {
    const rawType = String(alarm.type || '').toLowerCase();
    const rawAttr = String(alarm.attributes?.alarm || '').toLowerCase();
    const batRaw = alarm.attributes?.batteryLevel ?? alarm.attributes?.battery;
    const battery = batRaw != null ? parseFloat(batRaw) : null;
    const alarmTypes = String(alarm.alarm || alarm.attributes?.alarm || '').toLowerCase()
      .split(',').map(s => s.trim());

    const evTimeMs = alarm.eventtime || alarm.serverTime
      ? new Date(alarm.eventtime || alarm.serverTime).getTime() : Date.now();
    const timeLabel = moment(evTimeMs).format('hh:mm A, DD MMM YYYY');

    const make = (typeKey, detail) => {
      const cfg = ALERT_CONFIG[typeKey] || {};
      const fullBody = address && address !== '—'
        ? `${deviceName}  •  ${timeLabel}\n${detail}\n📍 ${address}`
        : `${deviceName}  •  ${timeLabel}\n${detail}`;
      return {
        type: typeKey, title: cfg.title || `🔔 ${typeKey}`,
        body: fullBody, speakText: `${cfg.speakPrefix || typeKey} ${deviceName}`,
        timestamp: evTimeMs, color: cfg.color || '#1565C0'
      };
    };

    if (rawType.includes('powercut') || rawAttr.includes('powercut') || alarmTypes.includes('powercut'))
      return make('powerCut', '🔌 Power supply disconnected');

    if (rawType.includes('lowbattery') || rawAttr.includes('lowbattery') ||
      alarmTypes.includes('lowbattery') || (battery !== null && battery >= 0 && battery <= 15)) {
      const pct = battery != null ? ` ${Math.round(battery)}%` : '';
      return make('lowBattery', `🔋 Battery low${pct}`);
    }

    if (rawType.includes('vibration') || rawAttr.includes('vibration') || alarmTypes.includes('vibration'))
      // return make('vibration', '📳 Vibration detected');
      return null;

    if (alarm.type) {
      const detail = rawAttr || alarm.type;
      const fullBody = address && address !== '—'
        ? `${deviceName}  •  ${timeLabel}\n${detail}\n📍 ${address}`
        : `${deviceName}  •  ${timeLabel}\n${detail}`;
      return {
        type: alarm.type, title: `🔔 ${alarm.type}`,
        body: fullBody, speakText: `${alarm.type} on ${deviceName}`,
        timestamp: evTimeMs, color: '#1565C0'
      };
    }
    return null;
  }

  // ── Send notification ─────────────────────────────────────────────────────────
  async _sendNotification(payload) {
    if (!this._permissionGranted) return;
    try {
      await notifee.displayNotification({
        title: payload.title,
        body: payload.body,
        android: {
          channelId: this.channelId,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          color: payload.color,
          showTimestamp: true,
          timestamp: payload.timestamp,
          pressAction: { id: 'default' },
          // ✅ FIX: smallIcon set karo — yeh missing hone se notification crash ho jaati hai
          smallIcon: 'ic_launcher',
        },
      });
      console.log('[AlertService] ✅ Notification sent:', payload.title);
    } catch (e) {
      console.error('[AlertService] ❌ Notification failed:', e.message);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────────
  _speak(text) {
    if (!text || !this._ttsReady) return;
    const spaced = text.replace(/(\d)/g, '$1 ');
    try { Tts.stop(); setTimeout(() => Tts.speak(spaced), 400); } catch (_) { }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  _isCoolingDown(key) {
    return Date.now() - (this.alertCooldowns[key] || 0) < 5000;
  }
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  async _getStoredId(key) {
    try { const v = await AsyncStorage.getItem(key); return v ? parseInt(v, 10) : 0; } catch { return 0; }
  }
  async _saveStoredId(key, id) {
    try { await AsyncStorage.setItem(key, id.toString()); } catch (_) { }
  }

  // ── One poll cycle ────────────────────────────────────────────────────────────
  async _runOneCycle() {
    // Poll cycle start
    console.log('[AlertService] Poll cycle started');
    await this._loadDevices();
    console.log('[AlertService] Devices loaded');
    // Always poll events; internal handlers will ignore unknown devices
    await this._pollCustomEvents();
    await this._pollAlarms();
    console.log('[AlertService] Poll cycle completed');
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  parseAlarm(alarm, deviceName) {
    return this._parseAlarm(alarm, deviceName, null);
  }

  async start() {
    console.log('[AlertService] start() called');
    if (this.isPolling) return;
    this.isPolling = true;
    await this._init();

    const runLoop = async () => {
      if (!this.isPolling) return;

      // ✅ Sirf foreground me poll karo
      if (this._appState === 'active') {
        await this._runOneCycle();
      } else {
        console.log('[AlertService] App not active — skipping cycle');
      }

      this._fallbackTimeout = setTimeout(runLoop, POLLING_INTERVAL_MS);
    };

    // Pehla cycle thoda delay ke baad — devices load hone ka time do
    setTimeout(runLoop, 3000);
  }

  stop() {
    this.isPolling = false;
    if (this._fallbackTimeout) {
      clearTimeout(this._fallbackTimeout);
      this._fallbackTimeout = null;
    }
    // Clear cached device data to avoid sending notifications for devices when logged out
    this.deviceMap = {};
    this.allowedDeviceIds = new Set();
    console.log('[AlertService] stopped and cleared device caches');
  }
}

export default new AlertNotificationService();