import { Auth, cloudEnabled } from './auth.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

const statusEl = document.getElementById('auth-status');
const loginBox = document.getElementById('login-box');
const signoutBtn = document.getElementById('signout-btn');

async function refreshAuthUI() {
  if (!cloudEnabled) {
    statusEl.textContent = 'local mode (no Supabase config yet)';
    loginBox.hidden = true;
    signoutBtn.hidden = true;
    return;
  }
  const session = await Auth.session();
  if (session) {
    statusEl.textContent = `signed in as ${session.user.email}`;
    loginBox.hidden = true;
    signoutBtn.hidden = false;
  } else {
    statusEl.textContent = 'signed out';
    loginBox.hidden = false;
    signoutBtn.hidden = true;
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

document.getElementById('google-signin').addEventListener('click', async () => {
  if (!cloudEnabled) { alert('Google sign-in needs Supabase configured in config.js.'); return; }
  const { error } = await Auth.signInWithGoogle();
  if (error) alert(error.message);
  // on success the browser redirects to Google, then back here signed in
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await Auth.signUp(email, password);
  if (error) { alert(error.message); return; }
  alert('Account created — check your email if confirmation is required, then sign in.');
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await Auth.signOut();
  refreshAuthUI();
});

refreshAuthUI();
