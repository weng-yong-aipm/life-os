import { Auth, cloudEnabled } from './auth.js';
import { demoMode } from './demo.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

const statusEl = document.getElementById('auth-status');
const loginBox = document.getElementById('login-box');
const signoutBtn = document.getElementById('signout-btn');
const hubGrid = document.getElementById('hub-grid');

const challengeBox = document.getElementById('mfa-challenge-box');
const challengeError = document.getElementById('mfa-challenge-error');
const mfaBox = document.getElementById('mfa-box');
const mfaStatus = document.getElementById('mfa-status');
const mfaEnableBtn = document.getElementById('mfa-enable-btn');
const mfaDisableBtn = document.getElementById('mfa-disable-btn');
const enrollBox = document.getElementById('mfa-enroll-box');
const enrollError = document.getElementById('mfa-enroll-error');

// Set while an enrollment or a login step-up is in progress, so the two
// small forms below know which factor/challenge they're completing without
// re-fetching it on every keystroke.
let pendingEnrollFactorId = null;
let pendingChallengeFactorId = null;

function hideAll() {
  loginBox.hidden = true;
  challengeBox.hidden = true;
  mfaBox.hidden = true;
  hubGrid.hidden = true;
  signoutBtn.hidden = true;
}

async function refreshAuthUI() {
  /* In demo mode the landing page is the product, not a gate. Signing in is
   * impossible anyway — getClient() returns null — so showing the form would
   * only be a dead end for whoever opened the link. */
  if (demoMode) {
    statusEl.textContent = 'demo';
    hideAll();
    hubGrid.hidden = false;
    return;
  }
  if (!cloudEnabled) {
    statusEl.textContent = 'local mode (no Supabase config yet)';
    hideAll();
    hubGrid.hidden = false;
    return;
  }
  const session = await Auth.session();
  if (!session) {
    statusEl.textContent = 'signed out';
    hideAll();
    loginBox.hidden = false;
    return;
  }

  // A session existing is not the same as being fully signed in — a factor
  // may require a step-up before this counts as authenticated. This check
  // is UX only: the real enforcement is in the database's RLS policies, so
  // skipping it (e.g. by navigating straight to a module page) still
  // returns no data, it just does so without this explanation.
  const { currentLevel, nextLevel } = await Auth.mfa.assuranceLevel();
  if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
    const { factors } = await Auth.mfa.listFactors();
    pendingChallengeFactorId = factors[0]?.id ?? null;
    statusEl.textContent = `${session.user.email} — verify to continue`;
    hideAll();
    challengeBox.hidden = false;
    signoutBtn.hidden = false; // still reachable from the challenge screen
    return;
  }

  statusEl.textContent = `signed in as ${session.user.email}`;
  hideAll();
  hubGrid.hidden = false;
  signoutBtn.hidden = false;
  await refreshMfaBox();
}

async function refreshMfaBox() {
  const { factors } = await Auth.mfa.listFactors();
  mfaBox.hidden = false;
  enrollBox.hidden = true;
  if (factors.length) {
    mfaStatus.textContent = '🔒 Two-factor authentication is ON.';
    mfaEnableBtn.hidden = true;
    mfaDisableBtn.hidden = false;
  } else {
    mfaStatus.textContent = 'Two-factor authentication is OFF.';
    mfaEnableBtn.hidden = false;
    mfaDisableBtn.hidden = true;
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
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { alert('Enter an email and a password first, then tap Create account.'); return; }
  if (password.length < 6) { alert('Password must be at least 6 characters.'); return; }
  const { error } = await Auth.signUp(email, password);
  if (error) { alert(error.message); return; }
  alert('Account created — check your email if confirmation is required, then sign in.');
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await Auth.signOut();
  refreshAuthUI();
});

// ---------------- MFA: login step-up ----------------

document.getElementById('mfa-challenge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  challengeError.hidden = true;
  if (!pendingChallengeFactorId) { challengeError.textContent = 'No factor to verify against — try signing out and back in.'; challengeError.hidden = false; return; }
  const code = document.getElementById('mfa-challenge-code').value.trim();
  const { data: ch, error: chErr } = await Auth.mfa.challenge(pendingChallengeFactorId);
  if (chErr) { challengeError.textContent = chErr.message; challengeError.hidden = false; return; }
  const { error: vErr } = await Auth.mfa.verifyLogin(pendingChallengeFactorId, ch.id, code);
  if (vErr) { challengeError.textContent = vErr.message; challengeError.hidden = false; return; }
  document.getElementById('mfa-challenge-code').value = '';
  refreshAuthUI();
});

document.getElementById('mfa-challenge-cancel').addEventListener('click', async () => {
  await Auth.signOut();
  refreshAuthUI();
});

// ---------------- MFA: enrollment ----------------

mfaEnableBtn.addEventListener('click', async () => {
  const { factorId, qrCode, secret, error } = await Auth.mfa.enroll();
  if (error) { alert(error.message); return; }
  pendingEnrollFactorId = factorId;
  document.getElementById('mfa-qr').src = qrCode;
  document.getElementById('mfa-secret').textContent = secret;
  enrollError.hidden = true;
  enrollBox.hidden = false;
});

document.getElementById('mfa-enroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  enrollError.hidden = true;
  const code = document.getElementById('mfa-enroll-code').value.trim();
  const { error } = await Auth.mfa.verifyEnrollment(pendingEnrollFactorId, code);
  if (error) { enrollError.textContent = error.message; enrollError.hidden = false; return; }
  document.getElementById('mfa-enroll-code').value = '';
  pendingEnrollFactorId = null;
  await refreshMfaBox();
});

document.getElementById('mfa-enroll-cancel').addEventListener('click', async () => {
  // Clean up the abandoned factor rather than leaving an unverified one
  // sitting on the account forever — it doesn't protect anything either way
  // (listFactors filters to verified-only) but there's no reason to keep it.
  if (pendingEnrollFactorId) await Auth.mfa.unenroll(pendingEnrollFactorId).catch(() => {});
  pendingEnrollFactorId = null;
  enrollBox.hidden = true;
});

mfaDisableBtn.addEventListener('click', async () => {
  if (!confirm('Disable two-factor authentication? Your account will go back to password-only.')) return;
  const { factors } = await Auth.mfa.listFactors();
  for (const f of factors) await Auth.mfa.unenroll(f.id);
  await refreshMfaBox();
});

refreshAuthUI();
