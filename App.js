import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import AlertNotificationService from './src/services/AlertNotificationService';
import UpdateChecker from './src/services/UpdateChecker';

const App = () => {
  useEffect(() => {
    AlertNotificationService.start();
    UpdateChecker.checkForUpdate();
    return () => {
      AlertNotificationService.stop();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1565C0" />
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
};

export default App;
