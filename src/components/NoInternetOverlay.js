import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, Modal } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width, height } = Dimensions.get('window');

const NoInternetOverlay = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      // isConnected could be null initially
      setIsConnected(state.isConnected ?? true);
    });

    // Initial check
    NetInfo.fetch().then(state => {
      setIsConnected(state.isConnected ?? true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleRetry = () => {
    setIsChecking(true);
    NetInfo.fetch().then(state => {
      setIsConnected(state.isConnected ?? true);
      setTimeout(() => {
        setIsChecking(false);
      }, 500); // small delay to show feedback
    });
  };

  if (isConnected) {
    return null; // Don't render anything if connected
  }

  return (
    <Modal visible={!isConnected} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Icon name="wifi-off" size={80} color="#FF3B30" />
        </View>
        <Text style={styles.title}>No Internet Connection</Text>
        <Text style={styles.message}>
          Please check your network settings, ensure Wi-Fi or mobile data is turned on, and try again.
        </Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={handleRetry}
          disabled={isChecking}
        >
          <Text style={styles.buttonText}>
            {isChecking ? 'Checking...' : 'Try Again'}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  iconContainer: {
    width: 130,
    height: 130,
    backgroundColor: '#FFE5E5',
    borderRadius: 65,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#1565C0',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default NoInternetOverlay;
