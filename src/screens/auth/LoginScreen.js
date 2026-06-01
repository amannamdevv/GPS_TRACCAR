/**
 * LoginScreen — Real Traccar API Login
 * Calls POST /api/session with email+password.
 * Replaces fake setTimeout login.
 */

import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AuthContext } from '../../context/AuthContext';

const DEFAULT_SERVER = 'http://shrotitele.com:8082';

const LoginScreen = ({ navigation }) => {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [showPass,  setShowPass]  = useState(false);

  const { login, isLoading } = useContext(AuthContext);

  const handleLogin = () => {
    if (!email.trim()) {
      Alert.alert('Validation', 'Please enter your email / username.');
      return;
    }
    if (!password) {
      Alert.alert('Validation', 'Please enter your password.');
      return;
    }
    login(serverUrl.trim() || DEFAULT_SERVER, email.trim(), password);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.iconCircle}>
            <Icon name="truck-fast" size={60} color="#1565C0" />
          </View>
          <Text style={styles.title}>Traccar Manager</Text>
          <Text style={styles.subtitle}>Real-time GPS Tracking</Text>
        </View>

        {/* Form Card */}
        <View style={styles.formContainer}>

          {/* Server URL */}
          <Text style={styles.fieldLabel}>Server URL</Text>
          <View style={styles.inputContainer}>
            <Icon name="server" size={20} color="#757575" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="http://shrotitele.com:8082"
              placeholderTextColor="#AAAAAA"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="next"
            />
          </View>

          {/* Email */}
          <Text style={styles.fieldLabel}>Email / Username</Text>
          <View style={styles.inputContainer}>
            <Icon name="account" size={20} color="#757575" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="admin@example.com"
              placeholderTextColor="#AAAAAA"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />
          </View>

          {/* Password */}
          <Text style={styles.fieldLabel}>Password</Text>
          <View style={styles.inputContainer}>
            <Icon name="lock" size={20} color="#757575" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#AAAAAA"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity onPress={() => setShowPass(!showPass)}>
              <Icon
                name={showPass ? 'eye-off' : 'eye'}
                size={20}
                color="#757575"
              />
            </TouchableOpacity>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginButtonText}>LOGIN</Text>
            )}
          </TouchableOpacity>

          {/* Register link */}
          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.registerText}>
              Don&apos;t have an account?{' '}
              <Text style={styles.registerTextBold}>Register</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a237e',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 36,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: '#E3F2FD',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  formContainer: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#757575',
    marginBottom: 6,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    marginBottom: 14,
    paddingHorizontal: 12,
    backgroundColor: '#F8F9FA',
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#212121',
    fontSize: 15,
  },
  loginButton: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    elevation: 4,
    shadowColor: '#1565C0',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  loginButtonDisabled: {
    backgroundColor: '#90CAF9',
    elevation: 0,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  registerLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  registerText: {
    color: '#757575',
    fontSize: 14,
  },
  registerTextBold: {
    color: '#1565C0',
    fontWeight: 'bold',
  },
});

export default LoginScreen;
