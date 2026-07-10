import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const CalendarPickerModal = ({
  open,
  title = "Select Date",
  date,
  minimumDate,
  maximumDate,
  onCancel,
  onConfirm
}) => {
  const [tempDate, setTempDate] = useState(date || new Date());

  useEffect(() => {
    if (open && date) {
      setTempDate(date);
    }
  }, [open, date]);

  const handleChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      if (event.type === 'set') {
        onConfirm(selectedDate || tempDate);
      } else {
        onCancel();
      }
    } else {
      if (selectedDate) {
        setTempDate(selectedDate);
      }
    }
  };

  const handleConfirmIOS = () => {
    onConfirm(tempDate);
  };



  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.dateModalCard}>
          <View style={styles.dateModalHeader}>
            <Icon name="calendar" size={22} color="#0284c7" />
            <Text style={styles.dateModalTitle}>{title}</Text>
            <TouchableOpacity onPress={onCancel}>
              <Icon name="close-circle" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {open && (
            <DateTimePicker
              value={tempDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
              onChange={handleChange}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              style={Platform.OS === 'ios' ? styles.datePickerInModal : undefined}
            />
          )}

          {Platform.OS === 'ios' && (
            <View style={styles.iosPickerActions}>
              <TouchableOpacity style={styles.iosCancelBtn} onPress={onCancel}>
                <Text style={styles.iosCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iosConfirmBtn} onPress={handleConfirmIOS}>
                <Text style={styles.iosConfirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  dateModalCard: {
    width: '85%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10
  },
  dateModalTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginLeft: 10
  },
  datePickerInModal: {
    height: 120,
    width: '100%'
  },
  iosPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12
  },
  iosCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f1f5f9'
  },
  iosCancelText: {
    color: '#64748b',
    fontWeight: '600'
  },
  iosConfirmBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0284c7'
  },
  iosConfirmText: {
    color: '#ffffff',
    fontWeight: '600'
  }
});

export default CalendarPickerModal;
