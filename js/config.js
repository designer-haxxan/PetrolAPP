// Deployment configuration for PetroPump ERP.
export const CONFIG = {
  APP_NAME: 'PetroPump ERP',
  // Namespace for everything this app stores in the browser (IndexedDB, LocalStorage, Cache Storage).
  // Other apps on the same web origin must use a different APP_ID.
  APP_ID: 'petropump',
  APP_VERSION: '2.0.1',
  SCHEMA_VERSION: 1,
  BACKUP_VERSION: 2,
  // Login API (eposwala accounts): POST {AUTH_API_BASE}/login. Accounts are created by eposwala, not in this app.
  // The API only allows browser requests from https://petrolapp.eposwala.com, so serve the app from that host.
  AUTH_API_BASE: 'https://eposwala.com/api',
  SUPPORT_PHONE: '0302-8863131',
};

// LocalStorage key inside this app's namespace, e.g. storageKey('settings') -> 'petropump.settings'.
export const storageKey = (name) => `${CONFIG.APP_ID}.${name}`;
