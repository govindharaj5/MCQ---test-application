// ============================================================================
// api.js
// ============================================================================

const TOKEN_KEY = 'mcq_admin_token';

// 👇 Render Backend URL

const API_BASE =
  location.hostname === "localhost"
    ? "http://localhost:5000"
    : "https://mcq-test-application.onrender.com";

export const auth = {
  getToken() { return localStorage.getItem(TOKEN_KEY); },
  setToken(token) { localStorage.setItem(TOKEN_KEY, token); },
  clearToken() { localStorage.removeItem(TOKEN_KEY); },
  isLoggedIn() { return !!localStorage.getItem(TOKEN_KEY); },
};

// `headers` (NEW, Phase 2, Feature 14) lets callers attach the per-attempt
// session token (X-Attempt-Token) to student-facing requests.
async function request(path, { method = 'GET', body, auth: withAuth = false, raw = false, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (withAuth) {
    const token = auth.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }

  if (raw) {
    if (!response.ok) throw new Error('Download failed. Please try again.');
    return response;
  }

  let payload;

  try {
    payload = await response.json();
  } catch (parseErr) {
    throw new Error('Unexpected server response. Please try again.');
  }

  if (!response.ok || !payload.success) {
    if (response.status === 401 && withAuth) {
      auth.clearToken();
      if (!location.pathname.endsWith('/login.html')) {
        location.href = '/admin/login.html';
      }
    }

    const err = new Error(payload.message || 'Something went wrong. Please try again.');
    err.code = payload.code || null; // NEW: machine-readable error code (e.g. 'session_revoked')
    throw err;
  }

  return payload.data !== undefined ? payload.data : payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),

  adminGet: (path) => request(path, { method: 'GET', auth: true }),
  adminPost: (path, body) => request(path, { method: 'POST', body, auth: true }),
  adminPut: (path, body) => request(path, { method: 'PUT', body, auth: true }),
  adminDelete: (path) => request(path, { method: 'DELETE', auth: true }),
};

export async function downloadAuthenticated(path, filenameFallback) {
  const token = auth.getToken();

  const response = await fetch(`${API_BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) throw new Error('Export failed. Please try again.');

  const blob = await response.blob();

  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);

  const filename = match ? match[1] : filenameFallback;

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(url);
}