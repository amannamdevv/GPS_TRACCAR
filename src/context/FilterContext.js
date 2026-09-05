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
  const [appliedIme, setAppliedIme] = useState(null);
  const [appliedState, setAppliedState] = useState(null);
  const [appliedOm, setAppliedOm] = useState(null);
  const [appliedAom, setAppliedAom] = useState(null);
  const [appliedCluster, setAppliedCluster] = useState(null);
  const [appliedFse, setAppliedFse] = useState(null);
  const [appliedTechnician, setAppliedTechnician] = useState(null);
  const [appliedDevice, setAppliedDevice] = useState(null);

  // API params that other screens will use when fetching devices
  const [apiFilters, setApiFilters] = useState({});

  // true if any filter is currently applied
  const hasFilter = Object.keys(apiFilters).length > 0 || appliedDevice != null;

  // Called from DashboardScreen when Apply is pressed
  const applyFilter = useCallback((labels, params) => {
    setAppliedClient(labels.client || null);
    setAppliedIme(labels.ime || null);
    setAppliedState(labels.state || null);
    setAppliedOm(labels.om || null);
    setAppliedAom(labels.aom || null);
    setAppliedCluster(labels.cluster || null);
    setAppliedFse(labels.fse || null);
    setAppliedTechnician(labels.technician || null);
    setAppliedDevice(labels.device || null);
    setApiFilters(params || {});
  }, []);

  // Called from DashboardScreen Clear, or any screen's Reset button
  const clearFilter = useCallback(() => {
    setAppliedClient(null);
    setAppliedIme(null);
    setAppliedState(null);
    setAppliedOm(null);
    setAppliedAom(null);
    setAppliedCluster(null);
    setAppliedFse(null);
    setAppliedTechnician(null);
    setAppliedDevice(null);
    setApiFilters({});
  }, []);

  // Human-readable active filter string for display
  const filterLabel = [appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, appliedDevice]
    .filter(Boolean)
    .map(f => (typeof f === 'object' ? f.name : f))
    .join(' › ');

  return (
    <FilterContext.Provider value={{
      // Labels (for Dashboard filter panel sync)
      appliedClient, appliedIme, appliedState, appliedOm, appliedAom, appliedCluster, appliedFse, appliedTechnician, appliedDevice,
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
