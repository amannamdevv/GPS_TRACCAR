/**
 * @format
 */

import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './App';
import { name as appName } from './app.json';
import AlertNotificationService from './src/services/AlertNotificationService';

// Restart background service if app was killed and user is logged in
AsyncStorage.getItem('aid').then(aid => {
  if (aid) {
    AlertNotificationService.start();
  }
}).catch(() => {});

AppRegistry.registerComponent(appName, () => App);
