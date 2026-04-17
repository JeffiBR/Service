// Global config for frontend deployments (GitHub Pages + Render API)
(function () {
  const host = window.location.hostname || '';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  // Priority:
  // 1) window.__API_BASE__ (set manually before this file)
  // 2) localStorage.tp_api_base (optional local override)
  // 3) default by environment
  const runtimeApiBase = window.__API_BASE__ || localStorage.getItem('tp_api_base');

  if (runtimeApiBase) {
    window.API_BASE = runtimeApiBase.replace(/\/+$/, '');
  } else if (isLocalHost) {
    window.API_BASE = 'http://localhost:3000/api';
  } else {
    window.API_BASE = 'https://certobackend.onrender.com/api';
  }

  // Session duration in ms (default 30 days)
  window.AUTH_TTL_MS = window.AUTH_TTL_MS || (30 * 24 * 60 * 60 * 1000);

  // Clerk config (set your publishable key to enable)
  window.CLERK_PUBLISHABLE_KEY =
    window.CLERK_PUBLISHABLE_KEY || 'pk_test_dW5pZmllZC1hbHBhY2EtMjMuY2xlcmsuYWNjb3VudHMuZGV2JA';
  window.CLERK_ENABLED = window.CLERK_ENABLED === true || !!window.CLERK_PUBLISHABLE_KEY;
  window.CLERK_AFTER_SIGN_IN_URL = window.CLERK_AFTER_SIGN_IN_URL || 'index.html';
  window.CLERK_AFTER_SIGN_UP_URL = window.CLERK_AFTER_SIGN_UP_URL || 'index.html';

  // Set to true to disable auth checks
  if (typeof window.AUTH_DISABLED !== 'boolean') {
    window.AUTH_DISABLED = false;
  }
})();
