// src/utils/cache.js
// Simple AsyncStorage based cache and deleted‑ids management

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Get cached JSON data for a key */
export const getCache = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

/** Set JSON cache for a key */
export const setCache = async (key, data) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (_) { }
};

/** Add an ID to a persisted deleted‑ids set */
export const addDeletedId = async (key, id) => {
  try {
    const existing = await AsyncStorage.getItem(key);
    const set = new Set(existing ? JSON.parse(existing) : []);
    set.add(String(id));
    await AsyncStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch (_) { }
};

/** Retrieve the set of deleted IDs for a key */
export const getDeletedIds = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw).map(String) : []);
  } catch (_) {
    return new Set();
  }
};

/**
 * Compare two arrays of objects by a unique id field.
 * Returns { added: [], updated: [], removed: [] } where each entry is the full object.
 */
export const diffAndMerge = (oldArr = [], newArr = [], idField = 'id') => {
  const oldMap = new Map(oldArr.map(item => [String(item[idField]), item]));
  const newMap = new Map(newArr.map(item => [String(item[idField]), item]));
  const added = [];
  const updated = [];
  const removed = [];

  for (const [id, newItem] of newMap.entries()) {
    if (!oldMap.has(id)) {
      added.push(newItem);
    } else {
      const oldItem = oldMap.get(id);
      // shallow compare – if JSON differs treat as updated
      if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        updated.push(newItem);
      }
    }
  }

  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) removed.push(oldMap.get(id));
  }

  return { added, updated, removed };
};
