// /api/firebase-config.js
// Returns the Firebase web app configuration from Vercel environment variables.
// Firebase client config is not a secret — it is safe to expose to the browser.
// Keeping it here (rather than hard-coded in index.html) lets you manage it via
// Vercel environment variables without touching the frontend file.

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  };

  if (!config.apiKey || !config.projectId) {
    // Environment variables not set — app will run in guest mode
    return res.status(503).json({ error: 'Firebase not configured' });
  }

  res.status(200).json(config);
}
