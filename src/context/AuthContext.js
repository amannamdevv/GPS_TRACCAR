/**
 * AuthContext — Real Traccar API Integration
 * Uses cookie + Basic Auth fallback for reliable Android sessions.
 */

import React, { createContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import axios from 'axios';

const loginApi = async (serverUrl, email, password) => {
  try {
    const response = await axios.post('http://gps.shrotitele.com/api/login/', {
      login_id: email,
      password: password
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status) {
      const u = response.data.user;
      return { 
        id: u.aid, 
        name: u.fullname, 
        email: email, 
        ...u 
      };
    } else {
      throw new Error(response.data?.message || 'Invalid Login ID or Password');
    }
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || 'Login failed. Check credentials or server.');
  }
};
const logoutApi = async () => {};
const apiRestoreSession = async () => {
  return { id: 1, name: 'Gourav Admin' };
};

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState(null);
  const [userInfo,  setUserInfo]  = useState(null);
  const [error,     setError]     = useState(null);

  // ─── LOGIN ──────────────────────────────────────────────────────────────────
  const login = async (serverUrl, email, password) => {
    if (!serverUrl || !email || !password) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // loginApi stores: server, email, pass, cookie in AsyncStorage
      const user = await loginApi(serverUrl, email, password);

      const token = `traccar_${user.id}_${Date.now()}`;
      const info  = { ...user, server: serverUrl };

      setUserToken(token);
      setUserInfo(info);

      await AsyncStorage.setItem('userToken', token);
      await AsyncStorage.setItem('userInfo',  JSON.stringify(info));
    } catch (err) {
      const msg = err?.message || 'Login failed. Check credentials or server.';
      setError(msg);
      Alert.alert('Login Failed', msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── LOGOUT ─────────────────────────────────────────────────────────────────
  const logout = async () => {
    setIsLoading(true);
    try { await logoutApi(); } catch (_) {}
    setUserToken(null);
    setUserInfo(null);
    await AsyncStorage.multiRemove([
      'userToken', 'userInfo',
      'traccar_server', 'traccar_cookie',
      'traccar_email',  'traccar_pass',
    ]);
    setIsLoading(false);
  };

  // ─── RESTORE SESSION ON APP RESTART ─────────────────────────────────────────
  const restoreLocalSession = useCallback(async () => {
    try {
      const storedToken = await AsyncStorage.getItem('userToken');
      const storedUserInfo = await AsyncStorage.getItem('userInfo');
      
      if (storedToken && storedUserInfo) {
        setUserToken(storedToken);
        setUserInfo(JSON.parse(storedUserInfo));
      }
    } catch (e) {
      console.warn('Error restoring session', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreLocalSession();
  }, [restoreLocalSession]);

  return (
    <AuthContext.Provider
      value={{ login, logout, isLoading, userToken, userInfo, error }}
    >
      {children}
    </AuthContext.Provider>
  );
};
