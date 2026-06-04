const axios = require('axios');
(async () => {
  const lat = 23.31827333333333;
  const lon = 77.41868333333333;
  try {
    const res = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
      headers: { 'User-Agent': 'TraccarFleet/1.0' },
      timeout: 15000,
    });
    console.log('🗺️ OSM address →', res.data.display_name);
  } catch (e) {
    console.warn('OSM failed →', e.message);
    try {
      const b = await axios.get(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { timeout: 8000 });
      const parts = [b.data.locality, b.data.city, b.data.principalSubdivision, b.data.countryName].filter(Boolean);
      console.log('🔁 BigDataCloud address →', parts.join(', '));
    } catch (e2) {
      console.error('Both services failed →', e2.message);
    }
  }
})();
