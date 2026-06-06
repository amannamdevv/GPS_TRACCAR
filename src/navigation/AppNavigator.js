import React, { useContext, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Image, Dimensions, Animated, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import AuthNavigator from './AuthNavigator';
import MainTabNavigator from './MainTabNavigator';
import { AuthContext } from '../context/AuthContext';

const AppNavigator = () => {
  const { isLoading, userToken } = useContext(AuthContext);

  const slideAnim = useRef(new Animated.Value(-300)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.splashContainer}>
        <Animated.View style={{ opacity: opacityAnim, transform: [{ translateY: slideAnim }], alignItems: 'center' }}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.splashImage}
            resizeMode="contain"
          />
          <Text style={styles.welcomeText}>Welcome to Shroti Telecom{'\n'}Pvt Ltd</Text>
        </Animated.View>
        <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 30 }} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {userToken !== null ? <MainTabNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#c5d4eeff', // Match RMS background color
  },
  splashImage: {
    width: 150,
    height: 150,
  },
  welcomeText: {
    color: '#02006B',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 20,
  },
});

export default AppNavigator;

