// /api/create-checkout-session.js
// Creates a Stripe Checkout Session for the JudyBid Analyze™ subscription.
// Uses the Stripe REST API directly (no npm package required).
// Required Vercel env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL

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

  const { email } = req.body || {};

  const params = new URLSearchParams({
    mode:                          'subscription',
    'payment_method_types[0]':     'card',
    'line_items[0][price]':        priceId,
    'line_items[0][quantity]':     '1',
    success_url:                   `${appUrl}/?checkout=success`,
    cancel_url:                    `${appUrl}/?checkout=cancel`,
  });
  if (email) params.append('customer_email', email);

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
