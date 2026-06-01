/**
 * MapMarker — Enhanced live marker with rotation based on course
 * Shows device icon, status color, name & speed
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const MapMarker = ({ device }) => {
  const status = (device.status || 'unknown').toLowerCase();

  const color =
    status === 'online'  ? '#4CAF50' :
    status === 'offline' ? '#F44336' : '#FF9800';

  const getIconName = (category) => {
    switch ((category || '').toLowerCase()) {
      case 'truck':       return 'truck';
      case 'car':         return 'car';
      case 'motorcycle':  return 'motorbike';
      case 'van':         return 'van-utility';
      case 'bus':         return 'bus';
      case 'boat':        return 'sail-boat';
      case 'bicycle':     return 'bicycle';
      case 'person':      return 'walk';
      default:            return 'map-marker-radius';
    }
  };

  const isMoving  = (device.speedKmh || 0) > 2;
  const ignition  = device.ignition;

  return (
    <View style={styles.container}>
      {/* Outer pulse ring for online devices */}
      {status === 'online' && (
        <View style={[styles.pulseRing, { borderColor: color }]} />
      )}

      {/* Main bubble */}
      <View style={[styles.markerBubble, { backgroundColor: color }]}>
        <Icon name={getIconName(device.category)} size={20} color="#FFFFFF" />
      </View>

      {/* Arrow */}
      <View style={[styles.arrow, { borderTopColor: color }]} />

      {/* Label */}
      <View style={styles.nameLabel}>
        <Text style={styles.nameText} numberOfLines={1}>{device.name}</Text>
        {isMoving && (
          <Text style={styles.speedText}>{device.speedKmh} km/h</Text>
        )}
        {!isMoving && ignition !== null && (
          <Text style={[styles.speedText, { color: ignition ? '#4CAF50' : '#F44336' }]}>
            {ignition ? 'DG ON' : 'DG OFF'}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position:    'absolute',
    width:       50,
    height:      50,
    borderRadius: 25,
    borderWidth: 2,
    opacity:     0.35,
    top:         -7,
  },
  markerBubble: {
    width:         38,
    height:        38,
    borderRadius:  19,
    justifyContent:'center',
    alignItems:    'center',
    elevation:     6,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius:  3,
    borderWidth:   2.5,
    borderColor:   '#FFFFFF',
  },
  arrow: {
    width:            0,
    height:           0,
    borderLeftWidth:  7,
    borderRightWidth: 7,
    borderTopWidth:   9,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    marginTop:        -2,
  },
  nameLabel: {
    backgroundColor:  'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderRadius:      5,
    marginTop:         3,
    borderWidth:       1,
    borderColor:       '#E0E0E0',
    minWidth:          60,
    alignItems:        'center',
    elevation:         2,
  },
  nameText: {
    fontSize:   10,
    fontWeight: 'bold',
    color:      '#212121',
    maxWidth:   90,
  },
  speedText: {
    fontSize:  9,
    color:     '#1565C0',
    textAlign: 'center',
    marginTop: 1,
  },
});

export default MapMarker;
