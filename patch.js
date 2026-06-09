const fs = require('fs');
const file = 'c:/App/Traccar/src/screens/devices/DeviceDetailScreen.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add imports
content = content.replace('  StatusBar,\r\n  Linking,\r\n} from \\'react-native\\';', '  StatusBar,\n  Linking,\n  Modal,\n  Dimensions,\n} from \\'react-native\\';');
content = content.replace('  StatusBar,\n  Linking,\n} from \\'react-native\\';', '  StatusBar,\n  Linking,\n  Modal,\n  Dimensions,\n} from \\'react-native\\';');
content = content.replace('import moment from \\'moment\\';', 'import moment from \\'moment\\';\nimport DatePicker from \\'react-native-date-picker\\';');

// 2. Add BASE_URL and fmt
content = content.replace('const BASE_URL = \\'https://gps.shrotitele.com/api\\';', 'const BASE_URL = \\'https://gps.shrotitele.com/api\\';\nconst { width } = Dimensions.get(\\'window\\');\nconst fmt = (m) => m.format(\\'YYYY-MM-DD HH:mm:ss\\');');

// 3. Add States
const stateCode = `
  // DG Time filter modal
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [timeframe, setTimeframe] = useState('today');
  const [tempTf, setTempTf] = useState('today');
  const [customStart, setCustomStart] = useState(new Date());
  const [customEnd, setCustomEnd] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const getTimeRange = useCallback((tf) => {
    const now = moment();
    if (tf === 'today') return { from: fmt(now.clone().startOf('day')), to: fmt(now) };
    if (tf === 'yesterday') {
      const yday = now.clone().subtract(1, 'day');
      return { from: fmt(yday.clone().startOf('day')), to: fmt(yday.clone().endOf('day')) };
    }
    if (tf === 'hour') return { from: fmt(now.clone().subtract(1, 'hour')), to: fmt(now) };
    return { from: fmt(moment(customStart)), to: fmt(moment(customEnd)) };
  }, [customStart, customEnd]);

  const tfLabel = {
    today: 'Today',
    yesterday: 'Yesterday',
    hour: 'Last 1 Hr',
    custom: \`\${moment(customStart).format('DD MMM')} – \${moment(customEnd).format('DD MMM')}\`,
  };

  const formatTime = (raw) => {
`;
content = content.replace('  const formatTime = (raw) => {', stateCode.trim());

// 4. modify loadDgLogs
const loadDgLogsOld = `  const loadDgLogs = useCallback(async () => {
    if (dgLoading) return;
    setDgLoading(true);
    try {
      const rows = await fetchDgStatusLogs({
        device_id: device.id,
        dg_name: device.name,
        page: 1,
        limit: 99999,
      });`;
const loadDgLogsNew = `  const loadDgLogs = useCallback(async (tf = timeframe) => {
    if (dgLoading) return;
    setDgLoading(true);
    try {
      const tr = getTimeRange(tf);
      const rows = await fetchDgStatusLogs({
        device_id: device.id,
        deviceid: device.id,
        dg_name: device.name,
        page: 1,
        limit: 99999,
        from: tr.from,
        to: tr.to,
      });`;
content = content.replace(loadDgLogsOld, loadDgLogsNew);

// 5. modify useEffect
content = content.replace('if (activeSegment === \\'DG_REPORT\\') loadDgLogs();', 'if (activeSegment === \\'DG_REPORT\\') loadDgLogs(timeframe);');

// 6. modify UI
const uiOld = `<View style={styles.dgSummaryBox}>
                <Text style={styles.dgSummaryTitle}>DG Merged Reports</Text>
                <TouchableOpacity onPress={loadDgLogs} disabled={dgLoading}>
                  <Icon name=\"refresh\" size={18} color=\"#1565C0\" />
                </TouchableOpacity>
              </View>`;
const uiNew = `<View style={styles.dgSummaryBox}>
                <Text style={styles.dgSummaryTitle}>DG Merged Reports</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity
                    style={styles.filterChip}
                    onPress={() => { setTempTf(timeframe); setShowTimeModal(true); }}
                  >
                    <Icon name=\"clock-outline\" size={14} color=\"#f97316\" />
                    <Text style={styles.filterChipTxt}>{tfLabel[timeframe] || 'Today'}</Text>
                    <Icon name=\"chevron-down\" size={14} color=\"#f97316\" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => loadDgLogs(timeframe)} disabled={dgLoading}>
                    <Icon name=\"refresh\" size={20} color=\"#1565C0\" />
                  </TouchableOpacity>
                </View>
              </View>`;
content = content.replace(uiOld, uiNew);

// 7. Add Modals at the end of return
const modalCode = `
      {/* ══════════════════════════════════════════════════
          TIME FILTER MODAL
      ══════════════════════════════════════════════════ */}
      <Modal visible={showTimeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select Date Range</Text>

            <View style={styles.modalBody}>
              {[
                { key: 'today', label: 'Today', sub: \`\${moment().format('DD MMM YYYY')}  ·  12:00 AM → Live\` },
                { key: 'yesterday', label: 'Yesterday', sub: \`\${moment().subtract(1, 'day').format('DD MMM YYYY')}  ·  12:00 AM – 11:59 PM\` },
                { key: 'hour', label: 'Last 1 Hour', sub: \`\${moment().subtract(1, 'hour').format('HH:mm')} → \${moment().format('HH:mm')} now\` },
                { key: 'custom', label: 'Custom Range', sub: 'Choose your custom time range' },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.radioRow, tempTf === opt.key && styles.radioRowActive]}
                  activeOpacity={0.75}
                  onPress={() => setTempTf(opt.key)}
                >
                  <Icon
                    name={tempTf === opt.key ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={tempTf === opt.key ? '#f97316' : '#4b5563'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.radioLabel, tempTf === opt.key && { color: '#f97316' }]}>{opt.label}</Text>
                    <Text style={styles.radioSub}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              {tempTf === 'custom' && (
                <View style={styles.dateInputsBox}>
                  <TouchableOpacity style={styles.dateInput} onPress={() => setShowStartPicker(true)}>
                    <Icon name="calendar-start" size={15} color="#f97316" />
                    <Text style={styles.dateInputText}>Start: {fmt(moment(customStart))}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateInput} onPress={() => setShowEndPicker(true)}>
                    <Icon name="calendar-end" size={15} color="#f97316" />
                    <Text style={styles.dateInputText}>End:   {fmt(moment(customEnd))}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setShowTimeModal(false)}>
                <Text style={styles.modalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <View style={styles.modalBtnDiv} />
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => {
                  setTimeframe(tempTf);
                  setShowTimeModal(false);
                  loadDgLogs(tempTf);
                }}
              >
                <Text style={[styles.modalBtnTxt, { color: '#f97316', fontWeight: '800' }]}>Apply Filter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <DatePicker
        modal open={showStartPicker} date={customStart} maximumDate={new Date()}
        onConfirm={d => { setShowStartPicker(false); setCustomStart(d); }}
        onCancel={() => setShowStartPicker(false)}
        title="Start Date/Time"
      />
      <DatePicker
        modal open={showEndPicker} date={customEnd} minimumDate={customStart}
        onConfirm={d => { setShowEndPicker(false); setCustomEnd(d); }}
        onCancel={() => setShowEndPicker(false)}
        title="End Date/Time"
      />
    </View>
  );`;

content = content.replace('    </View>\r\n  );\r\n};', modalCode);
content = content.replace('    </View>\n  );\n};', modalCode);

const stylesToAdd = `
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(249,115,22,0.12)',
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)',
  },
  filterChipTxt: { fontSize: 11.5, color: '#f97316', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { width: width * 0.88, backgroundColor: '#0f1420', borderRadius: 18, elevation: 30, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)' },
  modalTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', textAlign: 'center', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#1a2030', letterSpacing: 0.3 },
  modalBody: { padding: 18 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12, marginBottom: 4 },
  radioRowActive: { backgroundColor: 'rgba(249,115,22,0.08)' },
  radioLabel: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  radioSub: { fontSize: 11, color: '#4b5563', marginTop: 1 },
  dateInputsBox: { gap: 8, marginTop: 8 },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0d1117', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)' },
  dateInputText: { color: '#f1f5f9', fontSize: 12.5, fontWeight: '600' },
  modalFooter: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1a2030' },
  modalBtn: { flex: 1, paddingVertical: 16, justifyContent: 'center', alignItems: 'center' },
  modalBtnTxt: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  modalBtnDiv: { width: 1, backgroundColor: '#1a2030' },
`;
content = content.replace('const styles = StyleSheet.create({', 'const styles = StyleSheet.create({\n' + stylesToAdd);

fs.writeFileSync(file, content, 'utf8');
