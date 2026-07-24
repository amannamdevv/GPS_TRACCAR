/**
 * FilterContext — Global Dashboard Filter State
 * Dashboard me jo filter apply hota hai vo sab screens me kaam kare.
 * Manually reset karne par hi filter hata.
 */
import React, { createContext, useState, useContext, useCallback } from 'react';

export const FilterContext = createContext();

export const FilterProvider = ({ children }) => {
  // Applied filter labels (for UI display - chips, badges)
  const [appliedClient, setAppliedClient] = useState(null);
  const [appliedState, setAppliedState] = useState(null);
  const [appliedDistrict, setAppliedDistrict] = useState(null);
  const [appliedCluster, setAppliedCluster] = useState(null);
  const [appliedDevice, setAppliedDevice] = useState(null);

  // API params that other screens will use when fetching devices
  const [apiFilters, setApiFilters] = useState({});

  // true if any filter is currently applied
  const hasFilter = Object.keys(apiFilters).length > 0 || appliedDevice != null;

  // Called from DashboardScreen when Apply is pressed
  const applyFilter = useCallback((labels, params) => {
    setAppliedClient(labels.client || null);
    setAppliedState(labels.state || null);
    setAppliedDistrict(labels.district || null);
    setAppliedCluster(labels.cluster || null);
    setAppliedDevice(labels.device || null);
    setApiFilters(params || {});
  }, []);

  // Called from DashboardScreen Clear, or any screen's Reset button
  const clearFilter = useCallback(() => {
    setAppliedClient(null);
    setAppliedState(null);
    setAppliedDistrict(null);
    setAppliedCluster(null);
    setAppliedDevice(null);
    setApiFilters({});
  }, []);

  // Human-readable active filter string for display
  const filterLabel = [appliedClient, appliedState, appliedDistrict, appliedCluster, appliedDevice]
    .filter(Boolean)
    .map(f => (typeof f === 'object' ? f.name : f))
    .join(' › ');

  return (
    <FilterContext.Provider value={{
      // Labels (for Dashboard filter panel sync)
      appliedClient, appliedState, appliedDistrict, appliedCluster, appliedDevice,
      // API params (for fetching in other screens)
      apiFilters,
      // State
      hasFilter,
      filterLabel,
      // Actions
      applyFilter,
      clearFilter,
    }}>
      {children}
    </FilterContext.Provider>
  );
};

export const useFilter = () => useContext(FilterContext);
