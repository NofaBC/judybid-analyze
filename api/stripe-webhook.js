// api/stripe-webhook.js
// Receives Stripe webhook events, verifies the Stripe-Signature header using
// HMAC-SHA256 (no Stripe npm package needed), then writes subscription status
// to Firestore via the Firebase Admin SDK.
//
// Required Vercel env vars:
//   STRIPE_WEBHOOK_SECRET   — signing secret from Stripe Dashboard → Webhooks
//   STRIPE_SECRET_KEY       — for fetching subscription details from Stripe API
//   FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY
//
// Stripe webhook URL:  https://judybid-analyze.vercel.app/api/stripe-webhook
//
// Events to enable in Stripe Dashboard:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted

import crypto            from 'crypto';
import { updateSubscription } from './_admin.js';

// ----- Vercel: disable automatic body parsing so we can read the raw body -----
export const config = { api: { bodyParser: false } };

// Read the raw request body as a Buffer (required for Stripe signature verification)
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c  => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error',    reject);
  });
}

// Verify Stripe webhook signature using Node.js built-in crypto.
// Stripe signs with:  HMAC-SHA256( STRIPE_WEBHOOK_SECRET, "{timestamp}.{rawBody}" )
function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = {};
  sigHeader.split(',').forEach(p => {
    const [k, v] = p.trim().split('=');
    if (k && v) parts[k] = v;
  });

  const { t, v1 } = parts;
  if (!t || !v1) throw new Error('Stripe-Signature header missing t or v1 component');

  // Reject events older than 5 minutes (replay attack protection)
  const ageSeconds = Math.abs(Date.now() / 1000 - parseInt(t, 10));
  if (ageSeconds > 300) throw new Error(`Stripe webhook timestamp too old (${Math.round(ageSeconds)}s)`);

  const payload  = `${t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))) {
    throw new Error('Stripe webhook signature mismatch');
  }
}

// Map Stripe subscription statuses to JudyBid access levels.
//
//  active / trialing           →  'active'    (full access)
//  past_due                    →  'past_due'  (access preserved; Stripe retrying payment)
//  canceled / unpaid /
//    incomplete_expired /
//    incomplete / paused       →  'free'      (no access)
//
// past_due treatment: the user paid for the current period; Stripe retries payment
// automatically. Cutting access during retries creates unnecessary support load.
// If all retries fail, Stripe moves to 'unpaid' or 'canceled', which triggers
// another webhook and we update to 'free' at that point.
function toAccessStatus(stripeStatus) {
  if (['active', 'trialing'].includes(stripeStatus)) return 'active';
  if (stripeStatus === 'past_due')                   return 'past_due';
  return 'free';
}

// Build the subscription object written to Firestore from a Stripe subscription resource
function buildSubData(stripeStatus, sub, customerId) {
  return {
    status:                    toAccessStatus(stripeStatus),
    stripeCustomerId:          customerId || sub.customer || null,
    stripeSubscriptionId:      sub.id     || null,
    stripePriceId:             sub.items?.data?.[0]?.price?.id || null,
    currentBillingPeriodStart: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString() : null,
    currentBillingPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  };
}

// Fetch a Stripe subscription by ID (used after checkout.session.completed)
async function fetchStripeSubscription(subscriptionId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  return res.json();
}

// Tag the Stripe subscription's metadata with the Firebase UID so future
// subscription.updated / deleted events can find the correct Firestore user.
async function tagSubscriptionMetadata(subscriptionId, uid, secretKey) {
  await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ 'metadata[firebaseUid]': uid }).toString(),
  });
}

// ---- Main handler -------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sigHeader  = req.headers['stripe-signature'];
  const secret     = process.env.STRIPE_WEBHOOK_SECRET;
  const secretKey  = process.env.STRIPE_SECRET_KEY;

  if (!sigHeader || !secret) {
    return res.status(400).json({ error: 'Missing Stripe-Signature or webhook secret' });
  }

  // Read raw body before any parsing
  const rawBody = await getRawBody(req);

  // Verify signature — reject unsigned payloads
  try {
    verifyStripeSignature(rawBody, sigHeader, secret);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).json({ error: e.message });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  console.log('Stripe webhook received:', event.type, event.id);

  try {
    switch (event.type) {

      // ── checkout.session.completed ──────────────────────────────────────
      // Fires when a user completes Stripe Checkout. We embed the Firebase UID
      // in client_reference_id (set by create-checkout-session.js).
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid     = session.client_reference_id || session.metadata?.firebaseUid;

        if (!uid) {
          console.warn('checkout.session.completed: no Firebase UID — cannot update Firestore');
          break;
        }

        const subscriptionId = session.subscription;
        const customerId     = session.customer;

        let sub = {};
        if (subscriptionId && secretKey) {
          sub = await fetchStripeSubscription(subscriptionId, secretKey);

          // Tag subscription metadata so future events can find this user without a DB query
          await tagSubscriptionMetadata(subscriptionId, uid, secretKey);
        }

        await updateSubscription(uid, {
          ...buildSubData('active', sub, customerId),
          stripeSubscriptionId: subscriptionId,
        });

        console.log(`✓ Activated subscription for Firebase UID: ${uid}`);
        break;
      }

      // ── customer.subscription.updated ───────────────────────────────────
      // Fires on renewal, plan change, cancellation scheduling, past_due, etc.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const uid = sub.metadata?.firebaseUid;

        if (!uid) {
          console.warn('subscription.updated: no firebaseUid in Stripe metadata — cannot update Firestore');
          break;
        }

        await updateSubscription(uid, buildSubData(sub.status, sub, sub.customer));
        console.log(`✓ Subscription updated: ${uid} → ${toAccessStatus(sub.status)} (Stripe: ${sub.status})`);
        break;
      }

      // ── customer.subscription.deleted ───────────────────────────────────
      // Fires when a subscription is fully canceled (at period end or immediately).
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = sub.metadata?.firebaseUid;

        if (!uid) {
          console.warn('subscription.deleted: no firebaseUid in Stripe metadata — cannot update Firestore');
          break;
        }

        await updateSubscription(uid, {
          status:               'free',
          stripeCustomerId:     sub.customer || null,
          stripeSubscriptionId: sub.id       || null,
          cancelAtPeriodEnd:    false,
        });

        console.log(`✓ Subscription canceled: ${uid} → free`);
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  // Always return 200 so Stripe does not retry successfully verified events
  res.status(200).json({ received: true });
}
