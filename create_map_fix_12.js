const fs = require('fs');

let code = fs.readFileSync('src/screens/reports/SiteListReportScreen.js', 'utf8');

// 1. Update loadData signature and parameter logic
code = code.replace(
  /const loadData = async \(pageNumber = 1, isRefresh = false\) => \{[\s\S]*?try \{[\s\S]*?const params = \{/m,
  `const loadData = async (pageNumber = 1, isRefresh = false, overrideFilters = null) => {
    if (pageNumber === 1) {
      if (!isRefresh) setLoading(true);
    }
    
    try {
      const currentFilters = overrideFilters || filters;
      const params = {`
);

// Update inside loadData to use currentFilters
code = code.replace(/site_id: filters\.siteId,/g, "site_id: currentFilters.siteId,");
code = code.replace(/site_name: filters\.siteName,/g, "site_name: currentFilters.siteName,");
code = code.replace(/state: filters\.state,/g, "state: currentFilters.state,");
code = code.replace(/district: filters\.district,/g, "district: currentFilters.district,");
code = code.replace(/cluster: filters\.cluster,/g, "cluster: currentFilters.cluster,");
code = code.replace(/site_type: filters\.siteType,/g, "site_type: currentFilters.siteType,");
code = code.replace(/client: filters\.client/g, "client: currentFilters.client");


// 2. Update handleApplyFilters
const oldApply = `  const handleApplyFilters = () => {
    setShowFilters(false);
    loadData(1);
  };`;

const newApply = `  const handleApplyFilters = () => {
    setShowFilters(false);
    // Short timeout to let the UI hide the modal smoothly before heavy network/rendering
    setTimeout(() => {
      loadData(1);
    }, 50);
  };`;

code = code.replace(oldApply, newApply);

// 3. Update handleResetFilters
const oldReset = `  const handleResetFilters = () => {
    setFilters({ siteId: '', siteName: '', state: '', district: '', cluster: '', siteType: '', client: '' });
    setShowFilters(false);
    setTimeout(() => {
      loadData(1);
    }, 100);
  };`;

const newReset = `  const handleResetFilters = () => {
    const emptyFilters = { siteId: '', siteName: '', state: '', district: '', cluster: '', siteType: '', client: '' };
    setFilters(emptyFilters);
    setShowFilters(false);
    setTimeout(() => {
      loadData(1, false, emptyFilters);
    }, 50);
  };`;

code = code.replace(oldReset, newReset);

fs.writeFileSync('src/screens/reports/SiteListReportScreen.js', code);
