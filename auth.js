import { getClient, cloudEnabled } from './db.js';

export { cloudEnabled };

export const Auth = {
  async session() {
    const c = await getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session;
  },
  async signIn(email, password) {
    const c = await getClient();
    return c.auth.signInWithPassword({ email, password });
  },
  async signUp(email, password) {
    const c = await getClient();
    return c.auth.signUp({ email, password });
  },
  async signInWithGoogle() {
    const c = await getClient();
    return c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
  },
  async signOut() {
    const c = await getClient();
    return c.auth.signOut();
  },
  async onChange(cb) {
    const c = await getClient();
    if (!c) return;
    c.auth.onAuthStateChange((_event, session) => cb(session));
  },

  // Two-factor (TOTP). A factor existing is not the same as a session being
  // fully authenticated — `assuranceLevel()` is what actually gates access;
  // `enroll`/`verifyEnrollment`/`unenroll` only manage which factors exist.
  mfa: {
    /* Verified TOTP factors on the current user. An unverified factor from an
     * abandoned enrollment attempt is excluded — it doesn't protect anything
     * and would otherwise show as "enabled" when it isn't. */
    async listFactors() {
      const c = await getClient();
      const { data, error } = await c.auth.mfa.listFactors();
      return { factors: (data?.totp ?? []).filter((f) => f.status === 'verified'), error };
    },
    /* Starts enrollment: returns a QR code (SVG data URI) + the raw secret
     * (for manual entry) + the factor id needed to complete verification. */
    async enroll() {
      const c = await getClient();
      const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp' });
      if (error) return { error };
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },
    /* Completes enrollment: proves the user's authenticator actually has the
     * secret (not just that the QR was displayed) before the factor counts
     * as verified and starts being required at sign-in. */
    async verifyEnrollment(factorId, code) {
      const c = await getClient();
      const { data: ch, error: chErr } = await c.auth.mfa.challenge({ factorId });
      if (chErr) return { error: chErr };
      return c.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    },
    async unenroll(factorId) {
      const c = await getClient();
      return c.auth.mfa.unenroll({ factorId });
    },
    /* { currentLevel, nextLevel }: nextLevel > currentLevel means a step-up
     * is required before the session should be treated as fully signed in —
     * this is the actual gate; enrollment alone changes nothing by itself. */
    async assuranceLevel() {
      const c = await getClient();
      const { data, error } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
      return { currentLevel: data?.currentLevel ?? null, nextLevel: data?.nextLevel ?? null, error };
    },
    async challenge(factorId) {
      const c = await getClient();
      return c.auth.mfa.challenge({ factorId });
    },
    async verifyLogin(factorId, challengeId, code) {
      const c = await getClient();
      return c.auth.mfa.verify({ factorId, challengeId, code });
    },
  },
};
