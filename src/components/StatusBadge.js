import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const StatusBadge = ({ status }) => {
  const isOnline = status.toLowerCase() === 'online';
  
  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: isOnline ? '#4CAF50' : '#F44336' }]} />
      <Text style={[styles.text, { color: isOnline ? '#4CAF50' : '#F44336' }]}>
        {isOnline ? 'Online' : 'Offline'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default StatusBadge;
