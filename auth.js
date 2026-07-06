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
  async signOut() {
    const c = await getClient();
    return c.auth.signOut();
  },
  async onChange(cb) {
    const c = await getClient();
    if (!c) return;
    c.auth.onAuthStateChange((_event, session) => cb(session));
  },
};
