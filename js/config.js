// Deployment configuration for PetroPump ERP.
export const CONFIG = {
  APP_NAME: 'PetroPump ERP',
  // Namespace for everything this app stores in the browser (IndexedDB, LocalStorage, Cache Storage).
  // Other apps on the same web origin must use a different APP_ID.
  APP_ID: 'petropump',
  APP_VERSION: '2.0.0',
  SCHEMA_VERSION: 1,
  BACKUP_VERSION: 2,
};

// LocalStorage key inside this app's namespace, e.g. storageKey('settings') -> 'petropump.settings'.
export const storageKey = (name) => `${CONFIG.APP_ID}.${name}`;
