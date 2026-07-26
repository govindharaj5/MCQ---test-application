import { api, auth } from '../api.js';
import { initTheme } from '../theme.js';

initTheme();

// Already logged in? Skip straight to the dashboard.
if (auth.isLoggedIn()) {
  location.href = '/admin/dashboard.html';
}

const form = document.getElementById('loginForm');
const errorBanner = document.getElementById('errorBanner');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitLabel.innerHTML = isLoading ? '<span class="spinner"></span> Signing in…' : 'Sign In';
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBanner.classList.remove('visible');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Please enter both username and password.');
    return;
  }

  setLoading(true);
  try {
    const data = await api.post('/auth/login', { username, password });
    auth.setToken(data.token);
    location.href = '/admin/dashboard.html';
  } catch (err) {
    showError(err.message);
    setLoading(false);
  }
});
