import React, { useContext } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList, DrawerItem } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import MapScreen from '../screens/map/MapScreen';
import DevicesScreen from '../screens/devices/DevicesScreen';
import DeviceDetailScreen from '../screens/devices/DeviceDetailScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import AlertsScreen from '../screens/alerts/AlertsScreen';
import AlarmDashboardScreen from '../screens/alarms/AlarmDashboardScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import DgStatusLogScreen from '../screens/reports/DgStatusLogScreen';
import { AuthContext } from '../context/AuthContext';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Stack for Devices to handle details
const DevicesStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="DevicesList" component={DevicesScreen} />
    <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
    <Stack.Screen name="DgStatusLog" component={DgStatusLogScreen} />
  </Stack.Navigator>
);

// Bottom Tabs
const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size }) => {
          let iconName;
          if (route.name === 'Dashboard') iconName = 'view-dashboard';
          else if (route.name === 'Map') iconName = 'map-marker';
          else if (route.name === 'Devices') iconName = 'truck';
          else if (route.name === 'Reports') iconName = 'chart-bar';
          else if (route.name === 'Settings') iconName = 'cog';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#1565C0',
        tabBarInactiveTintColor: 'gray',
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Devices" component={DevicesStack} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

// Custom Drawer Content
const CustomDrawerContent = (props) => {
  const { userInfo, logout } = useContext(AuthContext);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
      <View style={styles.drawerHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{userInfo?.name ? userInfo.name.charAt(0) : 'U'}</Text>
        </View>
        <Text style={styles.drawerName}>{userInfo?.name || 'User'}</Text>
        <Text style={styles.drawerEmail}>{userInfo?.email || 'user@example.com'}</Text>
      </View>
      <View style={{ flex: 1, paddingTop: 10 }}>
        <DrawerItemList {...props} />
      </View>

      <View style={styles.drawerFooter}>
        <DrawerItem 
          label="Logout"
          labelStyle={{ color: '#d32f2f', fontWeight: 'bold' }}
          icon={({ color }) => <Icon name="logout" size={22} color="#d32f2f" />}
          onPress={() => {
            Alert.alert(
              'Logout',
              'Are you sure you want to logout?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Logout', style: 'destructive', onPress: () => logout() }
              ]
            );
          }}
        />
      </View>
    </DrawerContentScrollView>
  );
};

const DrawerNavigator = () => {
  return (
    <Drawer.Navigator
      drawerContent={props => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerActiveBackgroundColor: '#E3F2FD',
        drawerActiveTintColor: '#1565C0',
      }}
    >
      <Drawer.Screen 
        name="Dashboard" 
        component={TabNavigator} 
        options={{
          drawerIcon: ({ color }) => <Icon name="view-dashboard" size={22} color={color} />
        }}
      />
      <Drawer.Screen 
        name="Geofences" 
        component={MapScreen} 
        options={{
          drawerIcon: ({ color }) => <Icon name="vector-polygon" size={22} color={color} />
        }}
      />
      <Drawer.Screen 
        name="Drivers" 
        component={DevicesStack} 
        options={{
          drawerIcon: ({ color }) => <Icon name="card-account-details-outline" size={22} color={color} />
        }}
      />
      <Drawer.Screen 
        name="Current Alerts" 
        component={AlertsScreen} 
        options={{
          drawerIcon: ({ color }) => <Icon name="bell-ring-outline" size={22} color={color} />
        }}
      />
      <Drawer.Screen 
        name="DG Alarm Dashboard" 
        component={AlarmDashboardScreen} 
        options={{
          drawerIcon: ({ color }) => <Icon name="bell-alert-outline" size={22} color={color} />,
        }}
      />
      <Drawer.Screen 
        name="DG Report" 
        component={DgStatusLogScreen} 
        options={{
          drawerIcon: ({ color }) => <Icon name="file-document-outline" size={22} color={color} />
        }}
      />
    </Drawer.Navigator>
  );
};

const styles = StyleSheet.create({
  drawerHeader: {
    padding: 20,
    backgroundColor: '#1565C0',
    marginTop: -4,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    color: '#1565C0',
    fontSize: 24,
    fontWeight: 'bold',
  },
  drawerName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  drawerEmail: {
    color: '#E3F2FD',
    fontSize: 14,
    marginTop: 4,
  },
  drawerFooter: {
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    paddingBottom: 20,
  },
});

export default DrawerNavigator;
