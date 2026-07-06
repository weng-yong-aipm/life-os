import { Auth, cloudEnabled } from './auth.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

const statusEl = document.getElementById('auth-status');
const loginBox = document.getElementById('login-box');

async function refreshAuthUI() {
  if (!cloudEnabled) {
    statusEl.textContent = 'local mode (no Supabase config yet)';
    loginBox.hidden = true;
    return;
  }
  const session = await Auth.session();
  if (session) {
    statusEl.textContent = `signed in as ${session.user.email}`;
    loginBox.hidden = true;
  } else {
    statusEl.textContent = 'signed out';
    loginBox.hidden = false;
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await Auth.signIn(email, password);
  if (error) { alert(error.message); return; }
  refreshAuthUI();
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await Auth.signUp(email, password);
  if (error) { alert(error.message); return; }
  alert('Account created — check your email if confirmation is required, then sign in.');
});

refreshAuthUI();
