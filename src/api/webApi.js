import axios from 'axios';
import moment from 'moment';

const BASE_URL = 'http://gps.shrotitele.com:1061/api';

const webApi = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

// ─── Helper: GET with retry on 503 ───────────────────────────────────────────
const getWithRetry = async (url, config = {}, maxAttempts = 3, delayMs = 2000) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await webApi.get(url, config);
    } catch (err) {
      const status = err.response?.status;
      if (status === 503 && attempt < maxAttempts) {
        console.warn(`[webApi] 503 on ${url}, retry ${attempt}/${maxAttempts}`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
};

// ─── Normalize device list ────────────────────────────────────────────────────
const normalizeDeviceData = (rawData) => {
  let devicesArray = [];
  if (rawData) {
    if (Array.isArray(rawData)) devicesArray = rawData;
    else if (Array.isArray(rawData.data)) devicesArray = rawData.data;
    else if (Array.isArray(rawData.devices)) devicesArray = rawData.devices;
    else if (rawData.data && typeof rawData.data === 'object') devicesArray = Object.values(rawData.data);
    else if (rawData.devices && typeof rawData.devices === 'object') devicesArray = Object.values(rawData.devices);
  }

  const normalizedDevices = devicesArray.map((dev) => {
    const id = dev.deviceid != null ? dev.deviceid : (dev.id != null ? dev.id : null);
    const name = dev.device_name || dev.name || 'Unknown Device';
    const uniqueId = dev.uniqueid || dev.uniqueId || dev.imei || dev.iccid || '';
    const iccid = dev.uniqueid || dev.uniqueId || dev.imei || dev.iccid || 'N/A';

    let attrs = {};
    if (dev.current_attributes) {
      if (typeof dev.current_attributes === 'object') {
        attrs = dev.current_attributes;
      } else if (typeof dev.current_attributes === 'string') {
        try { attrs = JSON.parse(dev.current_attributes); } catch (_) { }
      }
    }

    const motion_lat = attrs.motionLat ?? dev.motion_lat ?? dev.latitude ?? dev.lat ?? null;
    const motion_lon = attrs.motionLon ?? dev.motion_lon ?? dev.longitude ?? dev.lon ?? null;
    const position_time = dev.position_time || dev.lastupdate || dev.devicetime || dev.fixtime || null;

    let status = 'offline';
    if (dev.status === 'online' || dev.device_status === 'online') {
      status = 'online';
    } else if (position_time) {
      const diff = Date.now() - new Date(position_time).getTime();
      if (diff < 10 * 60 * 1000) status = 'online';
    }

    const dg_status = dev.dg_status != null
      ? (dev.dg_status === 1 || dev.dg_status === '1' || dev.dg_status === 'ON' || dev.dg_status === true ? 1 : 0)
      : (dev.ignition === 1 || dev.ignition === '1' || dev.ignition === true ? 1 : 0);

    return {
      ...dev,
      id,
      name,
      uniqueid: uniqueId,
      uniqueId,
      iccid,
      status,
      motion_lat,
      motion_lon,
      position_time,
      battery_level: dev.battery_level != null ? parseFloat(dev.battery_level) : null,
      motion_status: dev.motion_status ?? dev.motion ?? null,
      dg_status,
      battery_status: dev.battery_status ?? dev.charge ?? null,
      ignition_status: dev.ignition_status ?? dev.ignition ?? null,
      rssi: dev.rssi ?? null,
      alarm: dev.alarm || null,
    };
  });

  return {
    success: true,
    devices: normalizedDevices,
    total_devices: normalizedDevices.length,
    active_devices: normalizedDevices.filter(d => d.status === 'online').length,
    non_active_devices: normalizedDevices.filter(d => d.status !== 'online').length,
  };
};

// ─── fetchDeviceList ──────────────────────────────────────────────────────────
export const fetchDeviceList = async () => {
  try {
    const response = await getWithRetry('/dg_device_latest_json/');
    return normalizeDeviceData(response.data);
  } catch (error) {
    console.error('[webApi] Error fetching device list:', error);
    throw new Error(error.response?.data?.message || 'Failed to fetch live devices from server.');
  }
};

// ─── fetchCustomEvents ────────────────────────────────────────────────────────
// Returns: ignitionOn, ignitionOff, deviceMoving, deviceStopped  — with address & event_time
// Fields per item: event_id, deviceid, device_name, event_type, event_value,
//                  latitude, longitude, event_time, created_at, address
export const fetchCustomEvents = async () => {
  try {
    const response = await webApi.get('/custom_events_with_address_api/');
    const raw = response.data;
    // API returns { status, count, data: [...] }
    if (raw && Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw)) return raw;
    return [];
  } catch (e) {
    if (e.message !== 'Network Error') {
      console.warn('[webApi] Failed to fetch custom events:', e.message);
    }
    return [];
  }
};

// ─── fetchAlarms ─────────────────────────────────────────────────────────────
// Returns: powerCut, lowBattery, vibration  (and any other alarm types)
export const fetchAlarms = async (deviceId) => {
  try {
    const url = deviceId ? `/alaram/${deviceId}/` : '/alaram/';
    const response = await webApi.get(url);
    return response.data || [];
  } catch (e) {
    if (e.message !== 'Network Error') {
      console.warn('[webApi] Failed to fetch alarms:', e.message);
    }
    return [];
  }
};

// ─── fetchDgStatusLogs ────────────────────────────────────────────────────────
export const fetchDgStatusLogs = async (params = {}) => {
  try {
    const response = await webApi.get('/dg_merged_status_api/', { params });

    const raw = response.data;

    // Backend { status: true, data: [...] } ya direct array return kar sakta hai
    if (raw && Array.isArray(raw.data)) return raw.data;
    if (raw && Array.isArray(raw.results)) return raw.results;
    if (Array.isArray(raw)) return raw;

    // Kuch aur structure hai — console mein dekho
    console.warn('[webApi] fetchDgStatusLogs unexpected response:', raw);
    return [];

  } catch (e) {
    console.error('[webApi] Failed to fetch DG status logs:', e.message);
    throw e;
  }
};


// ─── reverseGeocode ───────────────────────────────────────────────────────────
const addressCache = {};
let geocodeQueue = Promise.resolve();

export const reverseGeocode = async (lat, lon) => {
  if (lat == null || lon == null) return '';
  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);
  if (latF === 0 && lonF === 0) return 'GPS signal not found';

  const key = `${latF.toFixed(5)},${lonF.toFixed(5)}`;
  if (addressCache[key]) return addressCache[key];

  return new Promise((resolve) => {
    geocodeQueue = geocodeQueue.then(async () => {
      if (addressCache[key]) { resolve(addressCache[key]); return; }

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await axios.get(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latF}&lon=${lonF}&zoom=18&addressdetails=1`,
            { headers: { 'User-Agent': 'TraccarFleet/1.0' }, timeout: 15000 }
          );
          const displayName = response.data?.display_name;
          if (displayName) {
            const parts = displayName.split(',').map(s => s.trim()).filter(Boolean);
            while (parts.length > 0 && /^(India|[0-9]+)$/i.test(parts[parts.length - 1])) parts.pop();
            const finalAddress = parts.join(', ');
            addressCache[key] = finalAddress;
            resolve(finalAddress);
            await delay(1100);
            return;
          }
        } catch (e) {
          if (e.message !== 'Network Error') {
            console.warn('[webApi] Nominatim failed, trying BigDataCloud...', e.message);
          }
          try {
            const bdcResponse = await axios.get(
              `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latF}&longitude=${lonF}&localityLanguage=en`,
              { timeout: 8000 }
            );
            const bdcData = bdcResponse.data;
            if (bdcData) {
              const parts = [];
              if (bdcData.locality) parts.push(bdcData.locality);
              if (bdcData.city && bdcData.city !== bdcData.locality) parts.push(bdcData.city);
              if (bdcData.principalSubdivision && bdcData.principalSubdivision !== bdcData.city) parts.push(bdcData.principalSubdivision);
              if (bdcData.countryName) parts.push(bdcData.countryName);
              if (parts.length > 0) {
                const finalAddress = parts.join(', ');
                addressCache[key] = finalAddress;
                resolve(finalAddress);
                return;
              }
            }
          } catch (bdcError) {
            if (bdcError.message !== 'Network Error') console.warn('[webApi] BigDataCloud failed:', bdcError.message);
          }
          if (attempt < 3) await delay(1500 * attempt);
        }
      }

      addressCache[key] = '—';
      resolve('—');
      await delay(1100);
    });
  });
};

export default webApi;