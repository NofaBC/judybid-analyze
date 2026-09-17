// api/create-checkout-session.js
// Creates a Stripe Checkout Session for the JudyBid Analyze™ subscription.
// Uses the Stripe REST API directly (no stripe npm package required).
//
// Now verifies the caller's Firebase ID token server-side so the UID
// embedded in the session is trusted — not simply self-reported by the browser.
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL
//   FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY

import { verifyFirebaseToken } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId   = process.env.STRIPE_PRICE_ID;
  const appUrl    = process.env.APP_URL || 'https://judybid-analyze.vercel.app';

  if (!secretKey || !priceId) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { email, idToken } = req.body || {};

  // Verify the Firebase ID token to obtain a trusted Firebase UID.
  // The UID is embedded as client_reference_id and metadata.firebaseUid so the
  // webhook can reliably find the correct Firestore document after payment.
  let firebaseUid = null;
  if (idToken) {
    try {
      firebaseUid = await verifyFirebaseToken(idToken);
    } catch (e) {
      console.error('Firebase token verification failed:', e.message);
      return res.status(401).json({ error: 'Invalid authentication token. Please sign in and try again.' });
    }
  }

  const params = new URLSearchParams({
    mode:                      'subscription',
    'payment_method_types[0]': 'card',
    'line_items[0][price]':    priceId,
    'line_items[0][quantity]': '1',
    success_url:               `${appUrl}/?checkout=success`,
    cancel_url:                `${appUrl}/?checkout=cancel`,
  });

  if (email)       params.append('customer_email',           email);
  if (firebaseUid) params.append('client_reference_id',      firebaseUid);
  if (firebaseUid) params.append('metadata[firebaseUid]',    firebaseUid);

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe API error:', session.error);
      return res.status(stripeRes.status).json({ error: session.error?.message || 'Stripe error' });
    }

    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('create-checkout-session error:', e);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
