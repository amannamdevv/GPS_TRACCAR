import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import MapScreen from '../screens/map/MapScreen';
import TrackingScreen from '../screens/map/TrackingScreen';
import PlaybackScreen from '../screens/map/PlaybackScreen';
import DevicesScreen from '../screens/devices/DevicesScreen';
import DeviceDetailScreen from '../screens/devices/DeviceDetailScreen';
import DetailsInfoScreen from '../screens/devices/DetailsInfoScreen';
import DgStatusLogScreen from '../screens/reports/DgStatusLogScreen';
import AlertsScreen from '../screens/alerts/AlertsScreen';
import AlertDetailsScreen from '../screens/alerts/AlertDetailsScreen';
import MeScreen from '../screens/settings/MeScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import AlarmDashboardScreen from '../screens/alarms/AlarmDashboardScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// ─── STACK NAVIGATORS ────────────────────────────────────────────────────────
const MonitorStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="MonitorMain" component={MapScreen} />
    <Stack.Screen name="Tracking" component={TrackingScreen} />
    <Stack.Screen name="Playback" component={PlaybackScreen} />
    <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
    <Stack.Screen name="DetailInfo" component={DetailsInfoScreen} />
  </Stack.Navigator>
);

const DevicesStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="DevicesList" component={DevicesScreen} />
    <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
    <Stack.Screen name="Tracking" component={TrackingScreen} />
    <Stack.Screen name="Playback" component={PlaybackScreen} />
    <Stack.Screen name="DetailInfo" component={DetailsInfoScreen} />
    <Stack.Screen name="DgStatusLog" component={DgStatusLogScreen} />
  </Stack.Navigator>
);

const AlertsStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="AlertsList" component={AlertsScreen} />
    <Stack.Screen name="AlertDetails" component={AlertDetailsScreen} />
  </Stack.Navigator>
);

const MeStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="MeMain" component={MeScreen} />
    <Stack.Screen name="Dashboard" component={DashboardScreen} />
    <Stack.Screen name="Reports" component={ReportsScreen} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="AlarmDashboard" component={AlarmDashboardScreen} />
  </Stack.Navigator>
);

// ─── MAIN TAB NAVIGATOR ──────────────────────────────────────────────────────
const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size, focused }) => {
          let iconName;
          if (route.name === 'MonitorTab') {
            iconName = focused ? 'map-search' : 'map-search-outline';
          } else if (route.name === 'DeviceTab') {
            iconName = focused ? 'truck' : 'truck-outline';
          } else if (route.name === 'AlertTab') {
            iconName = focused ? 'bell' : 'bell-outline';
          } else if (route.name === 'MeTab') {
            iconName = focused ? 'account' : 'account-outline';
          }
          return <Icon name={iconName} size={24} color={color} />;
        },
        tabBarActiveTintColor: '#1565C0',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#e2e8f0',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="MonitorTab"
        component={MonitorStack}
        options={{ tabBarLabel: 'Monitor' }}
      />
      <Tab.Screen
        name="DeviceTab"
        component={DevicesStack}
        options={{ tabBarLabel: 'Device' }}
      />
      <Tab.Screen
        name="AlertTab"
        component={AlertsStack}
        options={{ tabBarLabel: 'Alert' }}
      />
      <Tab.Screen
        name="MeTab"
        component={MeStack}
        options={{ tabBarLabel: 'Me' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
