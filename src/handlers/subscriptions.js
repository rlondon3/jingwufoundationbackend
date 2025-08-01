// handlers/subscriptions.js
require('dotenv').config();
const Stripe = require('stripe');
const { authenticationToken } = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Get user's active subscriptions
 * GET /subscriptions
 */
const getUserSubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const sql = `
      SELECT 
        s.id,
        s.stripe_subscription_id,
        s.subscription_type,
        s.resource_id,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        s.price_cents,
        s.metadata
      FROM subscriptions s
      INNER JOIN stripe_subscriptions ss ON s.stripe_subscription_id = ss.subscription_id
      WHERE s.user_id = $1 
      AND s.status IN ('active', 'past_due')
      AND ss.status IN ('active', 'past_due')
      ORDER BY s.created_at DESC
    `;
    
    const client = await req.app.locals.pool.connect();
    const result = await client.query(sql, [userId]);
    client.release();
    
    res.json({ subscriptions: result.rows });
  } catch (error) {
    console.error('Error fetching user subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
};

/**
 * Get subscription by booking ID (for intensive mentorship)
 * GET /subscriptions/booking/:bookingId
 */
const getSubscriptionByBookingId = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    
    // First get the booking to verify ownership and get metadata
    const bookingSql = `
      SELECT start_time, appointment_type 
      FROM bookings 
      WHERE id = $1 AND user_id = $2
    `;
    
    const client = await req.app.locals.pool.connect();
    const bookingResult = await client.query(bookingSql, [bookingId, userId]);
    
    if (bookingResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const booking = bookingResult.rows[0];
    
    // Only intensive mentorship bookings have subscriptions
    if (booking.appointment_type !== 'intensive_mentorship') {
      client.release();
      return res.json({ subscription: null });
    }
    
    // Find subscription for intensive mentorship around the booking time
    const subscriptionSql = `
      SELECT 
        id,
        stripe_subscription_id,
        subscription_type,
        resource_id,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        price_cents,
        metadata
      FROM subscriptions 
      WHERE user_id = $1 
      AND subscription_type = 'intensive_mentorship'
      AND current_period_start <= $2
      AND current_period_end >= $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const subscriptionResult = await client.query(subscriptionSql, [userId, booking.start_time]);
    client.release();
    
    const subscription = subscriptionResult.rows[0] || null;
    res.json({ subscription });
  } catch (error) {
    console.error('Error fetching subscription by booking ID:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
};

/**
 * Cancel intensive mentorship subscription (following AI Sifu pattern)
 * POST /subscriptions/cancel-intensive-mentorship
 */
const cancelIntensiveMentorshipSubscription = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get active intensive mentorship subscription from database
    const subscriptionQuery = await req.app.locals.pool.query(
      'SELECT stripe_subscription_id, current_period_end FROM subscriptions WHERE user_id = $1 AND subscription_type = $2 AND status = $3',
      [userId, 'intensive_mentorship', 'active']
    );

    if (subscriptionQuery.rows.length === 0) {
      return res.status(404).json({ error: 'No active Intensive Mentorship subscription found' });
    }

    const stripeSubscriptionId = subscriptionQuery.rows[0].stripe_subscription_id;
    const currentPeriodEnd = subscriptionQuery.rows[0].current_period_end;

    // Cancel subscription in Stripe
    const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    // Update subscription in database
    await req.app.locals.pool.query(
      'UPDATE subscriptions SET cancel_at_period_end = true, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = $1',
      [stripeSubscriptionId]
    );


    res.json({
      success: true,
      message: `Intensive Mentorship cancelled successfully. You will retain access until ${new Date(currentPeriodEnd).toLocaleDateString()}.`,
      cancels_at: currentPeriodEnd
    });
  } catch (error) {
    console.error('Error cancelling intensive mentorship subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};

/**
 * Activate intensive mentorship subscription manually (fallback if webhook fails)
 * POST /subscriptions/activate-intensive-mentorship
 */
const activateIntensiveMentorshipSubscription = async (req, res) => {
  try {
    const { session_id } = req.body;
    const userId = req.user.id;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Get checkout session details from Stripe to get the subscription ID
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    if (!checkoutSession || !checkoutSession.subscription) {
      return res.status(404).json({ error: 'Checkout session or subscription not found' });
    }

    // Get the actual subscription details
    const subscription = await stripe.subscriptions.retrieve(checkoutSession.subscription);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Create subscription record in database
    const subscriptionSql = `
      INSERT INTO subscriptions (
        user_id, stripe_subscription_id, subscription_type, resource_id, 
        status, current_period_start, current_period_end, cancel_at_period_end,
        price_cents, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (stripe_subscription_id) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;

    const metadata = {
      description: 'Intensive Mentorship Monthly Subscription',
      features: ['Weekly 20-min calls', '3 questions per week', 'Advanced training', 'Dedicated instructor relationship']
    };

    // Calculate price in cents from subscription
    const priceCents = subscription.items.data[0]?.price?.unit_amount || 10000; // Default to $100

    // Validate and convert timestamps
    const startDate = subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : new Date();
    const endDate = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    

    const result = await req.app.locals.pool.query(subscriptionSql, [
      userId,
      subscription.id,
      'intensive_mentorship',
      null, // resource_id
      subscription.status,
      startDate,
      endDate,
      subscription.cancel_at_period_end,
      priceCents,
      JSON.stringify(metadata)
    ]);


    res.json({
      success: true,
      message: 'Intensive mentorship subscription activated successfully',
      subscription_id: result.rows[0].id
    });
  } catch (error) {
    console.error('Error activating intensive mentorship subscription:', error);
    res.status(500).json({ error: 'Failed to activate subscription' });
  }
};

/**
 * Cleanup orphaned subscriptions that don't exist in Stripe
 * POST /subscriptions/cleanup-orphaned (admin only)
 */
const cleanupOrphanedSubscriptions = async (req, res) => {
  try {
    // Mark subscriptions as cancelled if they don't have a corresponding active record in stripe_subscriptions
    const cleanupSql = `
      UPDATE subscriptions 
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('active', 'past_due')
      AND stripe_subscription_id NOT IN (
        SELECT subscription_id 
        FROM stripe_subscriptions 
        WHERE status IN ('active', 'past_due')
        AND subscription_id IS NOT NULL
      )
      RETURNING id, stripe_subscription_id, subscription_type, status
    `;

    const result = await req.app.locals.pool.query(cleanupSql);
    

    res.json({
      success: true,
      message: `Cleaned up ${result.rows.length} orphaned subscriptions`,
      updated_subscriptions: result.rows
    });
  } catch (error) {
    console.error('Error cleaning up orphaned subscriptions:', error);
    res.status(500).json({ error: 'Failed to cleanup orphaned subscriptions' });
  }
};

/**
 * Subscription route handler - manages all subscription-related endpoints
 */
const subscriptions_route = (app) => {
  // Protected routes
  app.get('/subscriptions', authenticationToken, getUserSubscriptions);
  app.get('/subscriptions/booking/:bookingId', authenticationToken, getSubscriptionByBookingId);
  app.post('/subscriptions/cancel-intensive-mentorship', authenticationToken, cancelIntensiveMentorshipSubscription);
  app.post('/subscriptions/activate-intensive-mentorship', authenticationToken, activateIntensiveMentorshipSubscription);
  app.post('/subscriptions/cleanup-orphaned', authenticationToken, cleanupOrphanedSubscriptions); // Should add admin check
};

module.exports = subscriptions_route;