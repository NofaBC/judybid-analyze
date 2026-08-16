// /api/stripe-webhook.js
// V1 stub: receives Stripe webhook events and acknowledges them.
// TODO V2: verify Stripe-Signature header and update Firestore subscription
//          status via Firebase Admin SDK when checkout.session.completed fires.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Log event type for visibility in Vercel function logs
  console.log('Stripe webhook received:', event?.type, event?.id);

  // V1: acknowledge all events without acting on them
  // V2 will handle: checkout.session.completed → update users/{uid}/subscription.status
  res.status(200).json({ received: true });
}
