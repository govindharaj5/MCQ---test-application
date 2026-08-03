import { auth } from '../api.js';

/** Call at the top of every admin page's script. Redirects to login if not authenticated. */
export function requireAuth() {
  if (!auth.isLoggedIn()) {
    location.href = '/admin/login.html';
    throw new Error('redirecting'); // stop the rest of the module executing
  }
}

/** Wires up a standard "Log Out" button by id (default: 'logoutBtn'). */
export function bindLogout(elementId = 'logoutBtn') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('click', () => {
    auth.clearToken();
    location.href = '/admin/login.html';
  });
}
