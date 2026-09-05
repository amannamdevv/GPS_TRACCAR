import 'react-native-gesture-handler';
import React, { useEffect, useContext } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { FilterProvider } from './src/context/FilterContext';
import AppNavigator from './src/navigation/AppNavigator';
import AlertNotificationService from './src/services/AlertNotificationService';
import UpdateModal from './src/components/UpdateModal';
import UpdateChecker from './src/services/UpdateChecker';
import NoInternetOverlay from './src/components/NoInternetOverlay';

// ─── Inner component — AuthContext yahan available hai ────────────────────────
const AppInner = () => {
  const { userToken, isLoading } = useContext(AuthContext);

  useEffect(() => {
    // Login hone ke baad hi start karo — token milte hi
    if (!isLoading && userToken) {
      console.log('[App] User logged in — starting AlertNotificationService');
      AlertNotificationService.start();
    }

    // Logout hone pe band karo
    if (!isLoading && !userToken) {
      console.log('[App] User logged out — stopping AlertNotificationService');
      AlertNotificationService.stop();
    }

    // App band hone pe bhi band karo
    return () => {
      AlertNotificationService.stop();
    };
  }, [userToken, isLoading]);

  return <AppNavigator />;
};

// ─── Root component ───────────────────────────────────────────────────────────
const App = () => {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1565C0" />
      <AuthProvider>
        <FilterProvider>
          <AppInner />
          <UpdateModal />
          <NoInternetOverlay />
        </FilterProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
};

export default App;