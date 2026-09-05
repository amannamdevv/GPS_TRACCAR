import React from 'react';
import { View, StyleSheet, Linking, Pressable, TouchableOpacity, Text } from 'react-native';
import * as Animatable from 'react-native-animatable';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';

import { fetchSupportDetails } from '../api/webApi';
import { useEffect, useState } from 'react';

const SupportBottomSheet = ({ setStatus, mode }) => {
  const [supportDetail, setSupportDetail] = useState({
    number1: '07553122002',
    number2: '07553122005',
    email1: 'TPMS.Support@shrotigroup.in',
    whatsapp: '919755522181'
  });

  useEffect(() => {
    let isActive = true;
    fetchSupportDetails().then((data) => {
      if (isActive && data) {
        setSupportDetail(prev => ({ ...prev, ...data }));
      }
    });
    return () => { isActive = false; };
  }, []);

  const openTelegram = async () => {
    try {
      await Linking.openURL('tg://resolve?domain=Shroti_Internal_Bot');
    } catch (e) {
      await Linking.openURL('https://t.me/Shroti_Internal_Bot');
    }
  };

  const handlePress = (open, application) => {
    if (application) {
      Linking.openURL(`${open}${application}`);
    }
  };

  const closeBottomSheet = () => {
    setStatus(false);
  };

  return (
    <View style={styles.backDrop}>
      <Pressable onPress={closeBottomSheet} style={{ flex: 1, width: '100%' }}></Pressable>
      <Animatable.View
        style={[styles.bottomSheet, { backgroundColor: mode ? '#27272a' : 'white' }]}
        duration={500}
        animation={'slideInUp'}
      >
        <View style={[styles.header, { backgroundColor: mode ? '#3f3f3f' : '#0a478f' }]}>
          <Text style={styles.title}>Help & Support</Text>
        </View>
        <View style={styles.container}>
          {supportDetail.number1 ? (
            <TouchableOpacity onPress={() => handlePress('tel:', supportDetail.number1)}>
              <View style={[styles.box, { borderColor: mode ? '#52525b' : '#e2e8f0' }]}>
                <Icon name="phone" size={24} color={mode ? 'white' : '#0a478f'} />
                <Text style={[styles.text, { color: mode ? 'white' : 'black' }]}>{supportDetail.number1}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
          {supportDetail.number2 ? (
            <TouchableOpacity onPress={() => handlePress('tel:', supportDetail.number2)}>
              <View style={[styles.box, { borderColor: mode ? '#52525b' : '#e2e8f0' }]}>
                <Icon name="phone" size={24} color={mode ? 'white' : '#0a478f'} />
                <Text style={[styles.text, { color: mode ? 'white' : 'black' }]}>{supportDetail.number2}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
          {supportDetail.email1 ? (
            <TouchableOpacity onPress={() => handlePress('mailto:', supportDetail.email1)}>
              <View style={[styles.box, { borderColor: mode ? '#52525b' : '#e2e8f0' }]}>
                <Icon name="email" size={24} color={mode ? 'white' : '#0a478f'} />
                <Text style={[styles.text, { color: mode ? 'white' : 'black' }]}>{supportDetail.email1}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
          {supportDetail.whatsapp ? (
            <TouchableOpacity onPress={() => handlePress(`whatsapp://send?phone=`, supportDetail.whatsapp)}>
              <View style={[styles.box, { borderColor: mode ? '#52525b' : '#e2e8f0' }]}>
                <Icon name="whatsapp" size={24} color={mode ? 'white' : '#25D366'} />
                <Text style={[styles.text, { color: mode ? 'white' : 'black' }]}>{supportDetail.whatsapp}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={openTelegram}>
            <View style={[styles.box, { borderColor: mode ? '#52525b' : '#e2e8f0' }]}>
              <FontAwesome5 name="telegram" brand size={24} color={mode ? 'white' : '#2AABEE'} />
              <Text style={[styles.text, { color: mode ? 'white' : 'black' }]}>Shroti Bot</Text>
            </View>
          </TouchableOpacity>
        </View>
      </Animatable.View>
    </View>
  );
};

const styles = StyleSheet.create({
  backDrop: {
    position: 'absolute',
    flex: 1,
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: '100%',
    height: '100%',
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  bottomSheet: {
    width: '100%',
    paddingBottom: 20,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  container: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 16,
    justifyContent: 'center',
  },
  header: {
    padding: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  text: {
    fontSize: 15,
    marginLeft: 12,
    color: 'black',
    fontWeight: '600',
  },
  box: {
    flexDirection: 'row',
    padding: 14,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
});

export default SupportBottomSheet;
