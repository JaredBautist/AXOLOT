import React from 'react';

export function AutoUpdater() {
  return null;
}

export function useAutoUpdater() {
  return {
    latestVersion: null,
    isUpdating: false,
    update: async () => {}
  };
}
