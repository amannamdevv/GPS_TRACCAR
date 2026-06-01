import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

const ReportTable = ({ data }) => {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, { flex: 1 }]}>Time</Text>
        <Text style={[styles.headerCell, { flex: 2 }]}>Location</Text>
        <Text style={[styles.headerCell, { flex: 1 }]}>Speed</Text>
        <Text style={[styles.headerCell, { flex: 1 }]}>Distance</Text>
      </View>
      <ScrollView nestedScrollEnabled>
        {data.map((row, index) => (
          <View 
            key={index} 
            style={[
              styles.row, 
              { backgroundColor: index % 2 === 0 ? '#FFFFFF' : '#F5F5F5' }
            ]}
          >
            <Text style={[styles.cell, { flex: 1 }]}>{row.time}</Text>
            <Text style={[styles.cell, { flex: 2 }]} numberOfLines={2}>{row.location}</Text>
            <Text style={[styles.cell, { flex: 1 }]}>{row.speed}</Text>
            <Text style={[styles.cell, { flex: 1 }]}>{row.distance}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#1565C0',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  headerCell: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  cell: {
    color: '#212121',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default ReportTable;
