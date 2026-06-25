// webApi.js

import axios from 'axios';
import moment from 'moment';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'https://gps.shrotitele.com/api';

const webApi = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

// Automatically attach user ID to all API requests to ensure data is scoped to the logged-in user
webApi.interceptors.request.use(async (config) => {
  if (config.url && config.url.includes('/login')) return config;
  try {
    const userInfoStr = await AsyncStorage.getItem('userInfo');
    if (userInfoStr) {
      const userInfo = JSON.parse(userInfoStr);
      const aid = userInfo.id || userInfo.aid;
      if (aid) {
        config.params = { aid, userid: aid, user_id: aid, ...config.params };
      }
    }
  } catch (e) { }
  return config;
}, (error) => Promise.reject(error));

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
    const iccid = dev.iccid || 'N/A';

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
    if (String(dev.status).toLowerCase() === 'unknown' || String(dev.device_status).toLowerCase() === 'unknown') {
      status = 'offline';
    } else if (dev.status === 'online' || dev.status === 1 || dev.status === '1' ||
      dev.device_status === 'online' || dev.device_status === 1 || dev.device_status === '1') {
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
      motion_status: dev.motion === 1 || dev.motion === '1' || dev.motion === true ? 1 : 0,
      dg_status,
      battery_status: dev.charge === 1 || dev.charge === '1' || dev.charge === true ? 1 : 0,
      ignition_status: dev.ignition === 1 || dev.ignition === '1' || dev.ignition === true ? 1 : 0,
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
export const fetchDeviceList = (filters = {}) => _fetchDeviceList(filters);

const _fetchDeviceList = async (filters = {}) => {
  try {
    let userDeviceIds = new Set();
    let restrictDevices = false;
    let deviceIdsParam = '';
    try {
      const userInfoStr = await AsyncStorage.getItem('userInfo');
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        if (userInfo.device_ids) {
          if (Array.isArray(userInfo.device_ids)) {
            userInfo.device_ids.forEach(id => {
              if (id != null) userDeviceIds.add(String(id));
            });
          } else if (typeof userInfo.device_ids === 'string') {
            userInfo.device_ids.split(',').forEach(id => {
              if (id.trim()) userDeviceIds.add(String(id.trim()));
            });
          }
        }
      }
    } catch (e) { /* ignore */ }

    if (userDeviceIds.size > 0) {
      deviceIdsParam = Array.from(userDeviceIds).join(',');
      restrictDevices = true;
    }

    const params = deviceIdsParam ? { device_ids: deviceIdsParam, deviceid: deviceIdsParam } : {};
    // Pass filter params alongside device_ids — do NOT set aid/userid/user_id to null (breaks auth)
    const latestParams = { ...params, ...filters };

    const [latestResp, allResp] = await Promise.allSettled([
      getWithRetry('/dg_device_latest_json/', { params: latestParams }),
      getWithRetry('/devices', { params })
    ]);

    let latestData = [];
    if (latestResp.status === 'fulfilled' && latestResp.value?.data) {
      const raw = latestResp.value.data;
      if (Array.isArray(raw)) latestData = raw;
      else if (Array.isArray(raw.data)) latestData = raw.data;
      else if (Array.isArray(raw.devices)) latestData = raw.devices;
      else if (typeof raw === 'object') latestData = Object.values(raw);
    } else if (latestResp.status === 'rejected') {
      console.warn('[webApi] dg_device_latest_json failed', latestResp.reason);
    }

    let allDevices = [];
    if (allResp.status === 'fulfilled' && allResp.value?.data) {
      const raw = allResp.value.data;
      if (Array.isArray(raw)) allDevices = raw;
      else if (Array.isArray(raw.data)) allDevices = raw.data;
      else if (Array.isArray(raw.devices)) allDevices = raw.devices;
      else if (typeof raw === 'object') allDevices = Object.values(raw);
    }

    const map = new Map();
    const iccidMap = new Map();
    latestData.forEach(d => {
      const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
      if (id != null && d.iccid) {
        iccidMap.set(String(id), d.iccid);
      }
    });

    const allAvailableIds = new Set();
    const hasFilters = Object.keys(filters).length > 0;

    latestData.forEach(d => {
      const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
      if (id != null) allAvailableIds.add(String(id));
    });

    // Only include allDevices IDs as a fallback if NO filters are applied.
    // Otherwise, applying a filter that returns 0 devices would incorrectly show all devices.
    if (!hasFilters) {
      allDevices.forEach(d => {
        const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
        if (id != null) allAvailableIds.add(String(id));
      });
    }

    const allowedIds = new Set();
    allAvailableIds.forEach(id => {
      if (userDeviceIds.size === 0 || userDeviceIds.has(id)) {
        allowedIds.add(id);
      }
    });

    allDevices.forEach(d => {
      const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
      if (id != null && allowedIds.has(String(id))) {
        const iccid = iccidMap.get(String(id));
        map.set(String(id), { ...d, iccid: iccid ?? d.iccid });
      }
    });

    latestData.forEach(d => {
      const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
      if (id != null && allowedIds.has(String(id))) {
        const existing = map.get(String(id)) || {};
        map.set(String(id), { ...existing, ...d });
      }
    });

    const mergedArray = Array.from(map.values());
    const normalized = normalizeDeviceData(mergedArray);
    const devicesList = normalized.devices || [];
    return {
      success: true,
      devices: devicesList,
      total_devices: devicesList.length,
      active_devices: devicesList.filter(d => d.status === 'online').length,
      non_active_devices: devicesList.filter(d => d.status !== 'online').length,
    };
  } catch (error) {
    console.error('[webApi] Error fetching device list:', error);
    throw new Error(error?.response?.data?.message || 'Failed to fetch live devices from server.');
  }
};

// ─── fetchCustomEvents ────────────────────────────────────────────────────────
export const fetchCustomEvents = async () => {
  try {
    const response = await webApi.get('/custom_events_with_address_api/');
    const raw = response.data;
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
export const fetchAlarms = async (deviceId) => {
  try {
    const url = deviceId ? `/alaram/${deviceId}/` : '/alaram/';
    // Fetch alarms AND user-scoped device list in parallel (using /devices to cover all 243 devices)
    const [alarmsResp, scopeResp] = await Promise.allSettled([
      webApi.get(url),
      getWithRetry('/devices'),
    ]);

    let raw = [];
    if (alarmsResp.status === 'fulfilled') {
      const responseData = alarmsResp.value?.data;
      if (responseData && Array.isArray(responseData.data)) {
        raw = responseData.data;
      } else if (Array.isArray(responseData)) {
        raw = responseData;
      } else if (responseData && Array.isArray(responseData.alarms)) {
        raw = responseData.alarms;
      }
    }

    // Build allowed device IDs set
    const allowedIds = new Set();
    if (scopeResp.status === 'fulfilled' && scopeResp.value?.data) {
      const scopeRaw = scopeResp.value.data;
      let scopeList = [];
      if (Array.isArray(scopeRaw)) scopeList = scopeRaw;
      else if (Array.isArray(scopeRaw.data)) scopeList = scopeRaw.data;
      else if (typeof scopeRaw === 'object') scopeList = Object.values(scopeRaw);
      scopeList.forEach(d => {
        const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
        if (id != null) allowedIds.add(String(id));
      });
    }

    // Filter alarms to only user's devices
    if (allowedIds.size > 0 && Array.isArray(raw)) {
      return raw.filter(a => {
        const devId = a.deviceid ?? a.deviceId ?? a.device_id;
        return devId != null && allowedIds.has(String(devId));
      });
    }
    return Array.isArray(raw) ? raw : [];
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
    // Fetch DG status logs AND the user-scoped device list in parallel
    const [statusResp, scopeResp] = await Promise.allSettled([
      webApi.get('/dg_merged_status_api/', { params }),
      getWithRetry('/dg_device_latest_json/'),
    ]);

    // Parse status logs
    let result = [];
    if (statusResp.status === 'fulfilled') {
      const raw = statusResp.value?.data;
      result = raw && raw.data ? raw.data : (Array.isArray(raw) ? raw : (raw && Array.isArray(raw.results) ? raw.results : []));
    } else {
      throw statusResp.reason;
    }

    // Build set of allowed device IDs from the user-scoped endpoint
    const allowedIds = new Set();
    if (scopeResp.status === 'fulfilled' && scopeResp.value?.data) {
      const scopeRaw = scopeResp.value.data;
      let scopeList = [];
      if (Array.isArray(scopeRaw)) scopeList = scopeRaw;
      else if (Array.isArray(scopeRaw.data)) scopeList = scopeRaw.data;
      else if (typeof scopeRaw === 'object') scopeList = Object.values(scopeRaw);
      scopeList.forEach(d => {
        const id = d.deviceid != null ? d.deviceid : (d.id != null ? d.id : null);
        if (id != null) allowedIds.add(String(id));
      });
    }

    // Filter: only keep logs for devices that belong to this user
    if (allowedIds.size > 0) {
      return result.filter(d => {
        const devId = d.deviceid ?? d.device_id ?? d.deviceId;
        return devId != null && allowedIds.has(String(devId));
      });
    }

    return result;
  } catch (e) {
    console.error('[webApi] Failed to fetch DG status logs:', e.message);
    throw e;
  }
};

// ─── NEW: fetchPositionHistory (for playback) ─────────────────────────────────
// Uses the positions_view endpoint.
// Expects parameters: deviceid, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
// Returns an array of position objects [{ latitude, longitude, speed, course, fixtime, ... }]
export const fetchPositionHistory = async (deviceId, startDate, endDate) => {
  try {
    const response = await webApi.get('/positions_view/', {
      params: {
        deviceid: deviceId,
        start_date: startDate,
        end_date: endDate,
      },
    });
    const raw = response.data; // { status: true, count, filters, data: [...] }
    if (raw && Array.isArray(raw.data)) {
      return raw.data;
    }
    return [];
  } catch (e) {
    console.warn('[webApi] Failed to fetch position history:', e.message);
    return [];
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

// ─── loginApi ────────────────────────────────────────────────────────────────
export const loginApi = async (serverUrl, email, password) => {
  try {
    const response = await webApi.post('/login/', {
      login_id: email,
      password: password
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status) {
      const u = response.data.user;
      return {
        id: u.aid,
        name: u.fullname,
        email: email,
        ...u
      };
    } else {
      throw new Error(response.data?.message || 'Invalid Login ID or Password');
    }
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || 'Login failed. Check credentials or server.');
  }
};

// ─── getTripsReport ──────────────────────────────────────────────────────────
export const getTripsReport = async (deviceId, from, to) => {
  try {
    const resp = await webApi.get('/dg_merged_status_api/', {
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

    return filtered.map(t => ({
      startTime: t.start_time ?? t.position_time,
      endTime: t.end_time ?? t.position_time,
      duration: (parseFloat(t.total_duration_minutes ?? t.duration_minutes ?? 0)) * 60,
      distance: (parseFloat(t.covered_distance_km ?? 0)) * 1000,
      startLat: parseFloat(t.start_latitude ?? t.latitude ?? 0),
      startLon: parseFloat(t.start_longitude ?? t.longitude ?? 0),
      endLat: parseFloat(t.end_latitude ?? t.latitude ?? 0),
      endLon: parseFloat(t.end_longitude ?? t.longitude ?? 0),
      startAddress: t.start_address || null,
      endAddress: t.end_address || null,
      status: String(t.final_status || t.motion_status || 'UNKNOWN').toUpperCase()
    })).filter(t => t.status === 'MOVE' || t.status === 'MOVING');
  } catch (e) {
    console.warn('[getTripsReport]', e.message);
    return [];
  }
};

// ─── fetchFilterDropdowns ─────────────────────────────────────────────────────
export const fetchFilterDropdowns = async (clientId = null, stateId = null, distId = null) => {
  try {
    const params = {};
    if (clientId) params.client_id = clientId;
    if (stateId) params.state_id = stateId;
    if (distId) params.dist_id = distId;
    const resp = await webApi.get('/filter-dropdowns/', { params });
    const raw = resp.data;
    return {
      clients: Array.isArray(raw.clients) ? raw.clients : [],
      states: Array.isArray(raw.states) ? raw.states : [],
      districts: Array.isArray(raw.districts) ? raw.districts : [],
      clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
    };
  } catch (e) {
    console.warn('[fetchFilterDropdowns]', e.message);
    return { clients: [], states: [], districts: [], clusters: [] };
  }
};

// ─── fetchDgDashboard ────────────────────────────────────────────────────────
export const fetchDgDashboard = async () => {
  try {
    const resp = await webApi.get('/dg_dashboard/', { timeout: 15000 });
    return resp.data || { top_moving: [], top_idle: [] };
  } catch (e) {
    console.warn('[fetchDgDashboard]', e.message);
    return { top_moving: [], top_idle: [] };
  }
};

export default webApi;