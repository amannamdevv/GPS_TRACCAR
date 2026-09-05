const fs = require('fs');
let text = fs.readFileSync('C:/App/Traccar/src/screens/reports/SiteListReportScreen.js', 'utf8');

// 1. Add imports
text = text.replace(/import \{ fetchSiteList, fetchFilterDropdowns \} from '\.\.\/\.\.\/api\/webApi';/, 
  "import { fetchSiteList } from '../../api/webApi';\nimport GlobalFilterPanel from '../../components/GlobalFilterPanel';\nimport { useFilter } from '../../context/FilterContext';");

// 2. Remove CustomDropdown
text = text.replace(/const CustomDropdown = forwardRef\(\([\s\S]*?\}\);\n\n/, '');

// 3. Remove refs, dropdownOptions, filters
text = text.replace(/  const distDropdownRef = useRef\(null\);\n  const clusterDropdownRef = useRef\(null\);\n\n/, '');

text = text.replace(/  \/\/ Filters\n  const \[filters, setFilters\] = useState\(\{[\s\S]*?\}\);\n  const \[dropdownOptions, setDropdownOptions\] = useState\(\{[\s\S]*?\}\);\n\n/, 
  "  const { apiFilters } = useFilter();\n  const [extraFilters, setExtraFilters] = useState({ siteId: '', siteName: '', siteType: '' });\n\n");

text = text.replace(/  const mapOpt = \(\(arr\) => \([\s\S]*?\}\);\n\n/, '');
text = text.replace(/  const loadDropdowns = async \(\([\s\S]*?\}\n  \};\n\n/, '');

text = text.replace(/      loadDropdowns\(\);\n/, '');

text = text.replace(/  const handleStateSelect = async[\s\S]*?\}\n  \};\n\n/, '');
text = text.replace(/  const handleDistrictSelect = async[\s\S]*?\}\n  \};\n\n\n/, '');

// 4. Update loadData to use apiFilters and extraFilters
text = text.replace(/const currentFilters = overrideFilters \|\| filters;\n      const params = \{\n        page: pageNumber,\n        limit: 20,\n        site_id: currentFilters\.siteId,\n        site_name: currentFilters\.siteName,\n        state_id: currentFilters\.state_id,\n        dist_id: currentFilters\.dist_id,\n        cluster_id: currentFilters\.cluster_id,\n        site_type: currentFilters\.siteType,\n        client_id: currentFilters\.client_id\n      \};/,
  "const currentExtra = overrideFilters || extraFilters;\n      const params = {\n        page: pageNumber,\n        limit: 20,\n        site_id: currentExtra.siteId,\n        site_name: currentExtra.siteName,\n        site_type: currentExtra.siteType,\n        ...apiFilters\n      };");

text = text.replace(/  const handleResetFilters = \(\) => \{[\s\S]*?\};/, 
  "const handleResetFilters = () => {\n    const empty = { siteId: '', siteName: '', siteType: '' };\n    setExtraFilters(empty);\n    setShowFilters(false);\n    loadData(1, false, empty);\n  };");

text = text.replace(/value=\{filters\[key\]\}\n        onChangeText=\{\(val\) => setFilters\(prev => \(\{ \.\.\.prev, \[key\]: val \}\)\)\}/g, 
  "value={extraFilters[key]}\n        onChangeText={(val) => setExtraFilters(prev => ({ ...prev, [key]: val }))}");

// 5. Replace filter UI
text = text.replace(/\{showFilters && \(\n        <View style=\{\[styles\.filtersContainer, \{ zIndex: 10, elevation: 10 \}\]\}>[\s\S]*?<\/View>\n      \)\}/, 
  "{showFilters && (\n        <GlobalFilterPanel \n          visible={showFilters} \n          onClose={() => setShowFilters(false)}\n          onApplyExtra={() => loadData(1)}\n          onResetExtra={() => {\n             const empty = { siteId: '', siteName: '', siteType: '' };\n             setExtraFilters(empty);\n             loadData(1, false, empty);\n          }}\n        >\n          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 12 }}>\n            {renderFilterInput('siteId', 'Site ID')}\n            {renderFilterInput('siteName', 'Site Name')}\n            <View style={styles.filterInputWrapper}>\n              <Text style={styles.filterLabel}>Site Type</Text>\n              <TextInput\n                style={styles.filterTextInput}\n                placeholder=\"e.g. DG Site\"\n                value={extraFilters.siteType}\n                onChangeText={(val) => setExtraFilters(prev => ({ ...prev, siteType: val }))}\n                placeholderTextColor=\"#94a3b8\"\n              />\n            </View>\n          </View>\n        </GlobalFilterPanel>\n      )}");

fs.writeFileSync('C:/App/Traccar/src/screens/reports/SiteListReportScreen.js', text, 'utf8');
console.log('SiteListReportScreen updated!');
