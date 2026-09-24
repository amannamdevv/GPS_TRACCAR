// webApi.js

import axios from 'axios';
import moment from 'moment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

const BASE_URL = 'https://gps.shrotitele.com/api';

const webApi = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

// Automatically attach user ID (+ user_type/emp_type) to all API requests
// so data stays scoped to the logged-in user. user_type/emp_type added
// because some endpoints (like dg_device_detail_json) key off these too.
webApi.interceptors.request.use(async (config) => {
  if (config.url && config.url.includes('/login')) return config;
  try {
    const userInfoStr = await AsyncStorage.getItem('userInfo');
    if (userInfoStr) {
      const userInfo = JSON.parse(userInfoStr);
      const aid = userInfo.id || userInfo.aid;
      if (aid) {
        config.params = {
          aid,
          userid: aid,
          user_id: aid,
          user_type: userInfo.user_type || '',
          emp_type: userInfo.emp_type ?? '',
          ...config.params,
        };
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

    const site_id = dev.site_id ?? dev.nearest_indus_id ?? attrs.site_id ?? attrs.nearest_indus_id ?? attrs.nearestSite ?? null;
    const site_distance = dev.site_distance ?? dev.nearest_distance_m ?? attrs.site_distance ?? attrs.nearest_distance_m ?? attrs.nearestDistance ?? null;
    const adc1 = dev.adc1 ?? attrs.adc1 ?? attrs.voltage ?? null;

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
      site_id,
      site_distance,
      nearest_indus_id: site_id,
      nearest_distance_m: site_distance,
      adc1,
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
export const fetchDeviceList = (filters = {}, isRefresh = false) => _fetchDeviceList(filters, isRefresh);

export const fetchDeviceLatestMapApi = async (deviceId = null) => {
  try {
    const params = deviceId ? { device_id: deviceId } : {};
    const resp = await webApi.get('/device_latest_map_api/', { params });
    return resp.data || { towers: [] };
  } catch (e) {
    console.warn('[fetchDeviceLatestMapApi] error:', e.message);
    return { towers: [] };
  }
};

// ─── FIX: normalize cluster/district filter for /dg_device_latest_json/ ──────
// The website (and this endpoint on the backend) only understands a SINGLE
// param name for cluster/district: `dist_id`. It does NOT understand
// `cluster_id` or `district_id`.
//
// DashboardScreen.js builds its shared `apiFilters` object with BOTH
// `cluster_id` and `district_id` keys (needed by /dg_dashboard/ and
// /dg_dashboard_top10_api/, which DO accept those names). Previously this
// raw object was spread directly into the device-list request too, so the
// backend received `cluster_id`/`district_id` (which it doesn't recognize
// for this endpoint) instead of `dist_id` — causing 0 devices to come back
// as soon as a Cluster was selected, even though every other filter
// (OM, AOM, FSE, Technician) worked fine.
//
// This helper only touches the params sent to THIS endpoint. It does not
// change fetchDgDashboard / fetchDgDashboardTop10 / fetchFilterDropdowns,
// which already do their own (correct) normalization.
const normalizeFiltersForDeviceListApi = (filters = {}) => {
  const normalized = { ...filters };
  const clusterVal = normalized.cluster_id ?? normalized.district_id;

  // Drop the names this endpoint doesn't understand...
  delete normalized.cluster_id;
  delete normalized.district_id;

  // ...and send the one name it does understand (same as the website).
  if (clusterVal !== undefined && clusterVal !== null && clusterVal !== '') {
    normalized.dist_id = clusterVal;
  }

  return normalized;
};

const _fetchDeviceList = async (filters = {}, isRefresh = false) => {
  try {
    let userDeviceIds = new Set();
    let restrictDevices = false;
    let deviceIdsParam = '';
    let parsedUserInfo = null;

    if (isRefresh) {
      console.log("Refreshing dashboard...");
      console.log("Fetching latest device list from server...");
      try {
        const email = await AsyncStorage.getItem('traccar_email');
        const pass = await AsyncStorage.getItem('traccar_pass');
        const server = await AsyncStorage.getItem('traccar_server');
        if (email && pass) {
          // Silently re-login to fetch fresh user profile (which contains updated device_ids)
          const user = await loginApi(server || '', email, pass);
          parsedUserInfo = { ...user, server: server || '' };
          await AsyncStorage.setItem('userInfo', JSON.stringify(parsedUserInfo));
        }
      } catch (err) {
        console.warn("Silent re-login failed during refresh", err);
      }
    }

    try {
      if (!parsedUserInfo) {
        const userInfoStr = await AsyncStorage.getItem('userInfo');
        if (userInfoStr) {
          parsedUserInfo = JSON.parse(userInfoStr);
        }
      }

      if (parsedUserInfo && parsedUserInfo.device_ids) {
        if (Array.isArray(parsedUserInfo.device_ids)) {
          parsedUserInfo.device_ids.forEach(id => {
            if (id != null) userDeviceIds.add(String(id));
          });
        } else if (typeof parsedUserInfo.device_ids === 'string') {
          parsedUserInfo.device_ids.split(',').forEach(id => {
            if (id.trim()) userDeviceIds.add(String(id.trim()));
          });
        }
      }
    } catch (e) { /* ignore */ }

    if (userDeviceIds.size > 0) {
      deviceIdsParam = Array.from(userDeviceIds).join(',');
      restrictDevices = true;
    }

    const params = deviceIdsParam ? { device_ids: deviceIdsParam, deviceid: deviceIdsParam } : {};
    // Pass filter params alongside device_ids — do NOT set aid/userid/user_id to null (breaks auth)
    // FIX: normalize cluster/district naming (cluster_id/district_id -> dist_id)
    // before sending to /dg_device_latest_json/, matching the website's behavior.
    const normalizedFilters = normalizeFiltersForDeviceListApi(filters);
    const latestParams = { ...params, ...normalizedFilters };

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

    if (isRefresh) {
      console.log("Total devices received:", devicesList.length);
    }

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
export const fetchCustomEvents = async (params = {}) => {
  try {
    const response = await webApi.get('/custom_events_with_address_api/', { params });
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
export const fetchAlarms = async (paramsOrDeviceId = {}) => {
  try {
    const isDeviceId = typeof paramsOrDeviceId === 'string' || typeof paramsOrDeviceId === 'number';
    const url = isDeviceId ? `/alaram/${paramsOrDeviceId}/` : '/alaram/';
    const params = isDeviceId ? {} : paramsOrDeviceId;

    // Fetch alarms AND user-scoped device list in parallel (using /devices to cover all 243 devices)
    const [alarmsResp, scopeResp] = await Promise.allSettled([
      webApi.get(url, { params }),
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
    // FIX: Normalize params before passing to dg_device_latest_json
    // so that cluster filters work correctly
    const deviceParams = normalizeFiltersForDeviceListApi(params);

    // Fetch DG status logs AND the user-scoped device list in parallel
    const [statusResp, scopeResp] = await Promise.allSettled([
      webApi.get('/dg_merged_status_api/', { params }),
      getWithRetry('/dg_device_latest_json/', { params: deviceParams }),
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
    let isScopeFulfilled = false;
    
    if (scopeResp.status === 'fulfilled' && scopeResp.value?.data) {
      isScopeFulfilled = true;
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

    let finalData = result;
    // Filter: only keep logs for devices that belong to this user / match filters
    if (isScopeFulfilled) {
      if (allowedIds.size > 0) {
        finalData = result.filter(d => {
          const devId = d.deviceid ?? d.device_id ?? d.deviceId;
          return devId != null && allowedIds.has(String(devId));
        });
      } else {
        // If API returned successfully but 0 devices match the filter, 
        // we should show 0 logs, not ALL logs.
        finalData = [];
      }
    }

    // Extract total count from the raw response for pagination support
    const rawData = statusResp.status === 'fulfilled' ? statusResp.value?.data : null;
    const backendCount = rawData?.count || rawData?.total_count || rawData?.totalCount;

    return {
      data: finalData,
      totalCount: backendCount !== undefined ? backendCount : finalData.length
    };
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
            { headers: { 'User-Agent': 'TraccarFleet/1.0', 'Accept-Language': 'en' }, timeout: 15000 }
          );
          const displayName = response.data?.display_name;
          if (displayName) {
            const parts = displayName.split(',');
            const filtered = [];
            for (let i = 0; i < parts.length; i++) {
              const p = parts[i].trim();
              if (p.toLowerCase() !== 'india' && !/^\d+$/.test(p)) {
                filtered.push(p);
              }
            }
            const finalAddress = filtered.join(', ');
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
// isNewLogin = true  → actual Login button click → backend inserts session log
// isNewLogin = false → silent re-auth (refresh/navigation) → no session log
export const loginApi = async (serverUrl, email, password, isNewLogin = false) => {
  try {
    const body = {
      login_id: email,
      password: password
    };
    if (isNewLogin) {
      body.is_new_login = true;
      body.device_id = await DeviceInfo.getUniqueId();
    }
    const response = await webApi.post('/login/', body, {
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

// ─── logoutApi ───────────────────────────────────────────────────────────────
export const logoutApi = async (loginId) => {
  try {
    // using the webApi client so it respects the current BASE_URL (e.g. test port or live)
    await webApi.post('/api_logout_test/', { login_id: loginId }, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.warn('[logoutApi]', error.message);
  }
};

// ─── getTripsReport ──────────────────────────────────────────────────────────
export const getTripsReport = async (deviceId, from, to) => {
  try {
    const resp = await webApi.get('/dg_merged_status_api/', {
      params: { deviceid: deviceId, start_date: from, end_date: to },
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
      status: String(t.final_status || t.motion_status || 'UNKNOWN').toUpperCase(),
      // Keep all original fields too
      ...t,
    }));
  } catch (e) {
    console.warn('[getTripsReport]', e.message);
    return [];
  }
};

// ─── fetchFilterDropdowns ─────────────────────────────────────────────────────
export const fetchFilterDropdowns = async (clientId = null, stateId = null, omId = null, aomId = null, distId = null, fseId = null, technicianId = null) => {
  try {
    const params = {};
    if (clientId) params.client_id = clientId;
    if (stateId) { params.state_id = stateId; params.circle_id = stateId; }
    if (omId) { params.om_head = omId; params.om_id = omId; }
    if (aomId) { params.aom_id = aomId; params.aom = aomId; }
    if (distId) { params.dist_id = distId; params.district_id = distId; params.cluster_id = distId; }
    if (fseId) { params.fse_id = fseId; }
    if (technicianId) { params.technician_id = technicianId; }
    const resp = await webApi.get('/filter-dropdowns/', { params });
    const raw = resp.data;

    const mapItem = (item) => {
      if (!item) return item;
      return {
        ...item,
        id: item.id !== undefined ? item.id : item.aid,
        name: item.name !== undefined ? item.name : (item.fullname !== undefined ? item.fullname : item.label)
      };
    };

    const mapList = (list) => (Array.isArray(list) ? list.map(mapItem) : []);

    return {
      clients: mapList(raw.clients),
      states: mapList(raw.states),
      oms: mapList(raw.OM_Head || raw.OM_head || raw.om_head || raw.om_heads || raw.oms || raw.om),
      aoms: mapList(raw.AOM || raw.aom || raw.aoms || raw.aom_head),
      districts: mapList(raw.districts || raw.clusters),
      clusters: mapList(raw.clusters || raw.districts),
      fses: mapList(raw.FSE || raw.fses || raw.fse),
      technicians: mapList(raw.Technician || raw.technicians || raw.technician),
    };
  } catch (e) {
    console.warn('[fetchFilterDropdowns]', e.message);
    return { clients: [], states: [], oms: [], aoms: [], districts: [], clusters: [], fses: [], technicians: [] };
  }
};

export const fetchSupportDetails = async () => {
  try {
    const resp = await webApi.get('/dg_daily_gps_support_details/');
    if (resp.data && resp.data.success) {
      return resp.data.data;
    }
    return null;
  } catch (e) {
    console.warn('[fetchSupportDetails]', e.message);
    return null;
  }
};

export const fetchDesignationUsers = async (desigName, parentParams = {}) => {
  try {
    const params = { desig_name: desigName, ...parentParams };
    const resp = await webApi.get('/designation_users_api/', { params });
    if (resp.data && resp.data.status && Array.isArray(resp.data.data)) {
      return resp.data.data.map(u => ({
        id: u.aid,
        name: u.fullname
      }));
    }
    return [];
  } catch (e) {
    console.warn(`[fetchDesignationUsers] ${desigName}:`, e.message);
    return [];
  }
};

// ─── fetchDgDashboard ────────────────────────────────────────────────────────
export const fetchDgDashboard = async (options = {}) => {
  try {
    const params = {};
    if (options.client_id) params.client_id = options.client_id;
    if (options.state_id) { params.state_id = options.state_id; params.circle_id = options.state_id; }
    // Backend accepts om_id (not om_head)
    if (options.om_id) params.om_id = options.om_id;
    if (options.om_head) params.om_id = options.om_head;
    if (options.aom_id) params.aom_id = options.aom_id;
    // cluster_id and district_id both map to dist_id on backend
    const clustVal = options.cluster_id || options.district_id;
    if (clustVal) { params.dist_id = clustVal; }
    if (options.fse_id) params.fse_id = options.fse_id;
    if (options.technician_id) params.technician_id = options.technician_id;
    if (options.ime) params.ime = options.ime;

    const resp = await webApi.get('/dg_dashboard/', {
      params,
      timeout: 15000
    });
    return resp.data || { top_moving: [], top_idle: [] };
  } catch (e) {
    console.warn('[fetchDgDashboard]', e.message);
    return { top_moving: [], top_idle: [] };
  }
};

// ─── fetchDgDashboardTop10 ───────────────────────────────────────────────────
export const fetchDgDashboardTop10 = async (options = {}) => {
  try {
    const params = { limit: 10 };
    if (options.from_date) params.from_date = options.from_date;
    if (options.to_date) params.to_date = options.to_date;
    if (options.client_id) params.client_id = options.client_id;
    if (options.state_id) { params.state_id = options.state_id; params.circle_id = options.state_id; }
    // Backend accepts om_id (not om_head)
    if (options.om_id) params.om_id = options.om_id;
    if (options.om_head) params.om_id = options.om_head;
    if (options.aom_id) params.aom_id = options.aom_id;
    // cluster_id and district_id both map to dist_id on backend
    const clustVal = options.cluster_id || options.district_id;
    if (clustVal) { params.dist_id = clustVal; }
    if (options.fse_id) params.fse_id = options.fse_id;
    if (options.technician_id) params.technician_id = options.technician_id;
    if (options.ime) params.ime = options.ime;

    const resp = await webApi.get('/dg_dashboard_top10_api/', {
      params,
      timeout: 20000,
    });

    const data = resp.data || {};
    return {
      top_moving: Array.isArray(data.top_moving) ? data.top_moving : [],
      top_running: Array.isArray(data.top_running) ? data.top_running : [],
      top_idle: Array.isArray(data.top_idle) ? data.top_idle : [],
    };
  } catch (e) {
    console.warn('[fetchDgDashboardTop10]', e.message);
    return { top_moving: [], top_running: [], top_idle: [] };
  }
};

// ─── fetchDgDeviceDetail ───────────────────────────────────────────────────
// Powers the "Device Information" screen.
export const fetchDgDeviceDetail = async (extraParams = {}) => {
  try {
    const resp = await webApi.get('/dg_device_detail/', {
      params: {
        limit: 500,
        om_id: '',
        aom_id: '',
        fse_id: '',
        technician_id: '',
        ime: '',
        client_id: '',
        state_id: '',
        dist_id: '',
        cluster_id: '',
        ...extraParams,
      },
      timeout: 20000,
    });
    return resp.data || { status: false, data: [] };
  } catch (e) {
    console.warn('[fetchDgDeviceDetail]', e.message);
    return { status: false, data: [], error: e.message };
  }
};

export const clearDashboardFilter = async () => {
  try {
    const resp = await webApi.get('/clear_dashboard_filter/');
    return resp.data;
  } catch (e) {
    console.warn('[clearDashboardFilter]', e.message);
    return null;
  }
};

// ─── fetchLiveVoltageStatus ──────────────────────────────────────────────────
export const fetchLiveVoltageStatus = async (options = {}) => {
  try {
    const resp = await webApi.get('/dg_current_device_voltage_api/', options);
    return resp.data;
  } catch (e) {
    console.warn('[fetchLiveVoltageStatus]', e.message);
    throw e;
  }
};

// ─── fetchDgBySiteReport ─────────────────────────────────────────────────────
export const fetchDgBySiteReport = async (params = {}) => {
  try {
    const resp = await webApi.get('/dg_by_site_api/', {
      params,
      timeout: 30000
    });
    return resp.data;
  } catch (e) {
    console.warn('[fetchDgBySiteReport]', e.message);
    throw e;
  }
};

// ─── fetchSiteList ───────────────────────────────────────────────────────────
export const fetchSiteList = async (params = {}) => {
  try {
    const normalized = { ...params };
    const clustVal = normalized.cluster_id || normalized.district_id || normalized.dist_id;
    if (clustVal) {
      normalized.dist_id = clustVal;
    }
    delete normalized.cluster_id;
    delete normalized.district_id;

    const resp = await webApi.get('/site_list_api/', {
      params: normalized,
      timeout: 20000
    });
    return resp.data;
  } catch (e) {
    console.warn('[fetchSiteList]', e.message);
    throw e;
  }
};

// ─── fetchNearbyDg ───────────────────────────────────────────────────────────
export const fetchNearbyDg = async (params = {}) => {
  try {
    const resp = await webApi.get('/nearby_dg_api/', {
      params,
      timeout: 30000
    });
    return resp.data;
  } catch (e) {
    console.warn('[fetchNearbyDg]', e.message);
    throw e;
  }
};

// ─── fetchDgCurrentDeviceVoltage ─────────────────────────────────────────────
export const fetchDgCurrentDeviceVoltage = async (params = {}) => {
  try {
    const resp = await webApi.get('/dg_current_device_voltage_api/', { params, timeout: 15000 });
    return resp.data;
  } catch (error) {
    console.warn('[fetchDgCurrentDeviceVoltage]', error.message);
    return null;
  }
};

// ─── fetchDgDailySummary ───────────────────────────────────────────────────
export const fetchDgDailySummary = async (deviceId, startDate, endDate, options = {}) => {
  try {
    const params = {
      deviceid: deviceId,
      start_date: startDate,
      end_date: endDate,
      from_date: startDate,
      to_date: endDate,
    };
    const resp = await webApi.get('/dg_daily_summary_api/', { params, ...options });
    return resp.data;
  } catch (e) {
    console.warn('[fetchDgDailySummary]', e.message);
    return null;
  }
};

export const fetchImeList = async () => {
  try {
    const resp = await webApi.get('/user_ime_list_api/');
    const raw = resp.data;
    const list = Array.isArray(raw) ? raw : (raw.data || []);
    return list.map(item => {
      if (typeof item === 'string') return { id: item, name: item };
      return { id: item.ime || item.name || item.id, name: item.ime || item.name || String(item.id) };
    });
  } catch (e) {
    console.warn('[fetchImeList]', e.message);
    return [];
  }
};

export default webApi;