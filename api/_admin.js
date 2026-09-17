// api/_admin.js
// Firebase Admin SDK singleton — shared by serverless functions.
// Underscore prefix prevents Vercel from treating this as an API route.
//
// Required Vercel env vars:
//   FIREBASE_ADMIN_PROJECT_ID
//   FIREBASE_ADMIN_CLIENT_EMAIL
//   FIREBASE_ADMIN_PRIVATE_KEY   (escaped \\n handled automatically below)

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { getAuth }                       from 'firebase-admin/auth';

function ensureApp() {
  if (getApps().length > 0) return;                // warm invocation — already initialised

  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n');                        // handle env var escaped newlines

  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

/** Returns the Firestore Admin instance. */
export function getAdminDb() {
  ensureApp();
  return getFirestore();
}

/** Returns the Auth Admin instance. */
export function getAdminAuth() {
  ensureApp();
  return getAuth();
}

/**
 * Verifies a Firebase ID token (supplied by the browser after sign-in).
 * Returns the verified uid — never trust a UID sent directly by the client.
 */
export async function verifyFirebaseToken(idToken) {
  const auth = getAdminAuth();
  const decoded = await auth.verifyIdToken(idToken);
  return decoded.uid;
}

/**
 * Writes/merges subscription data into users/{uid}.subscription in Firestore.
 * Does not overwrite any other field on the user document.
 *
 * @param {string} uid         Firebase UID
 * @param {object} data        Subscription fields to write (see stripe-webhook.js)
 */
export async function updateSubscription(uid, data) {
  const db = getAdminDb();
  await db.collection('users').doc(uid).set(
    { subscription: { ...data, updatedAt: FieldValue.serverTimestamp() } },
    { merge: true }
  );
}
