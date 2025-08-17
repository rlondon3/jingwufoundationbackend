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
        s.paypal_subscription_id,
        s.subscription_type,
        s.resource_id,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        s.price_cents,
        s.metadata
      FROM subscriptions s
      LEFT JOIN stripe_subscriptions ss ON s.stripe_subscription_id = ss.subscription_id
      LEFT JOIN bookings b ON (
        -- For intensive_mentorship, require a corresponding booking
        (s.subscription_type = 'intensive_mentorship' AND b.appointment_type = 'intensive_mentorship' AND b.user_id = s.user_id AND b.status = 'confirmed')
        OR
        -- For ai_sifu, no booking required
        (s.subscription_type = 'ai_sifu')
      )
      WHERE s.user_id = $1 
      AND s.status IN ('active', 'past_due')
      AND (
        -- Include Stripe subscriptions that are active
        (s.stripe_subscription_id IS NOT NULL AND ss.status IN ('active', 'past_due'))
        OR 
        -- Include PayPal subscriptions (no need for stripe_subscriptions check)
        (s.paypal_subscription_id IS NOT NULL)
      )
      AND (
        -- For intensive_mentorship, must have a booking
        (s.subscription_type = 'intensive_mentorship' AND b.id IS NOT NULL)
        OR
        -- For ai_sifu, no booking required
        (s.subscription_type = 'ai_sifu')
      )
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

    // Get active intensive mentorship subscription from database (both Stripe and PayPal)
    // Order by creation date DESC to get the most recent active subscription
    const subscriptionQuery = await req.app.locals.pool.query(
      'SELECT id, stripe_subscription_id, paypal_subscription_id, current_period_end FROM subscriptions WHERE user_id = $1 AND subscription_type = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
      [userId, 'intensive_mentorship', 'active']
    );

    if (subscriptionQuery.rows.length === 0) {
      return res.status(404).json({ error: 'No active Intensive Mentorship subscription found' });
    }

    const subscription = subscriptionQuery.rows[0];
    const { id: subscriptionId, stripe_subscription_id, paypal_subscription_id, current_period_end } = subscription;

    // Handle Stripe subscription cancellation
    if (stripe_subscription_id) {
      // Cancel subscription in Stripe
      await stripe.subscriptions.update(stripe_subscription_id, {
        cancel_at_period_end: true
      });

      // Update subscription in database
      await req.app.locals.pool.query(
        'UPDATE subscriptions SET cancel_at_period_end = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [subscriptionId]
      );
    }
    // Handle PayPal subscription cancellation
    else if (paypal_subscription_id) {
      // Get PayPal access token
      const paypalAuth = await fetch(`${process.env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en_US',
          'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!paypalAuth.ok) {
        throw new Error('Failed to get PayPal access token');
      }

      const { access_token } = await paypalAuth.json();

      // Cancel PayPal subscription
      const cancelResponse = await fetch(`${process.env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'}/v1/billing/subscriptions/${paypal_subscription_id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
          'PayPal-Request-Id': `cancel-${paypal_subscription_id}-${Date.now()}`
        },
        body: JSON.stringify({
          reason: 'User requested cancellation'
        })
      });

      if (!cancelResponse.ok) {
        throw new Error('PayPal cancellation failed');
      }

      // Update subscription in database - PayPal subscriptions cancel immediately
      await req.app.locals.pool.query(
        'UPDATE subscriptions SET status = $1, cancel_at_period_end = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['cancelled', subscriptionId]
      );
    } else {
      return res.status(400).json({ error: 'Subscription has no valid payment method ID' });
    }

    res.json({
      success: true,
      message: stripe_subscription_id 
        ? `Intensive Mentorship cancelled successfully. You will retain access until ${new Date(current_period_end).toLocaleDateString()}.`
        : 'Intensive Mentorship cancelled successfully.',
      cancels_at: current_period_end
    });
  } catch (error) {
    console.error('Error cancelling intensive mentorship subscription:', error.message);
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
 * Cleanup orphaned subscriptions that don't exist in Stripe or PayPal
 * POST /subscriptions/cleanup-orphaned (admin only)
 */
const cleanupOrphanedSubscriptions = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await req.app.locals.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const cleanupResults = {
        stripe_orphaned: 0,
        paypal_orphaned: 0,
        orphaned_bookings: 0,
        total_cleaned: 0
      };

      // 1. Mark Stripe subscriptions as cancelled if they don't have corresponding active records
      const stripeCleanupSql = `
        UPDATE subscriptions 
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('active', 'past_due')
        AND stripe_subscription_id IS NOT NULL
        AND stripe_subscription_id NOT IN (
          SELECT subscription_id 
          FROM stripe_subscriptions 
          WHERE status IN ('active', 'past_due')
          AND subscription_id IS NOT NULL
        )
        RETURNING id, stripe_subscription_id, subscription_type, status
      `;

      const stripeResult = await client.query(stripeCleanupSql);
      cleanupResults.stripe_orphaned = stripeResult.rows.length;

      // 2. Handle PayPal subscriptions - mark as cancelled if no valid PayPal records exist
      const paypalOrphanedSubs = await client.query(`
        SELECT s.id, s.user_id, s.paypal_subscription_id, s.paypal_order_id, s.subscription_type
        FROM subscriptions s
        WHERE s.status IN ('active', 'past_due')
        AND s.paypal_subscription_id IS NOT NULL
        AND (
          -- No matching PayPal subscription record
          NOT EXISTS (
            SELECT 1 FROM paypal_subscriptions ps 
            WHERE ps.subscription_id = s.paypal_subscription_id
            AND ps.subscription_status = 'ACTIVE'
          )
          OR
          -- No matching PayPal order with completed payment
          (s.paypal_order_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM paypal_orders po
            WHERE po.paypal_order_id = s.paypal_order_id 
            AND po.payment_status = 'COMPLETED'
          ))
        )
      `);

      for (const sub of paypalOrphanedSubs.rows) {
        // Mark subscription as cancelled
        await client.query(
          'UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['cancelled', sub.id]
        );
        
        // Cancel related intensive mentorship bookings
        if (sub.subscription_type === 'intensive_mentorship') {
          const cancelledBookings = await client.query(
            `UPDATE bookings 
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
             WHERE user_id = $1 AND appointment_type = 'intensive_mentorship' 
             AND status IN ('confirmed', 'scheduled')
             RETURNING id`,
            [sub.user_id]
          );
          cleanupResults.orphaned_bookings += cancelledBookings.rows.length;
        }
        
        cleanupResults.paypal_orphaned++;
      }

      cleanupResults.total_cleaned = cleanupResults.stripe_orphaned + cleanupResults.paypal_orphaned;

      await client.query('COMMIT');
      client.release();

      res.json({
        success: true,
        message: `Cleaned up ${cleanupResults.total_cleaned} orphaned subscriptions`,
        results: cleanupResults
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error cleaning up orphaned subscriptions:', error);
    res.status(500).json({ error: 'Failed to cleanup orphaned subscriptions' });
  }
};

/**
 * Get all subscriptions for admin management
 * GET /subscriptions/admin/all
 */
const getAllSubscriptionsAdmin = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const sql = `
      SELECT 
        s.id,
        s.user_id,
        s.stripe_subscription_id,
        s.paypal_subscription_id,
        s.subscription_type,
        s.resource_id,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        s.price_cents,
        s.metadata,
        s.created_at,
        s.updated_at,
        u.name as user_name,
        u.email as user_email
      FROM subscriptions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `;
    
    const client = await req.app.locals.pool.connect();
    const result = await client.query(sql);
    client.release();
    
    res.json({ subscriptions: result.rows });
  } catch (error) {
    console.error('Error fetching all subscriptions for admin:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
};

/**
 * Delete subscription (admin only)
 * DELETE /subscriptions/admin/:subscriptionId
 */
const deleteSubscriptionAdmin = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { subscriptionId } = req.params;
    
    const client = await req.app.locals.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get subscription details before deletion
      const getSubscriptionSql = 'SELECT * FROM subscriptions WHERE id = $1';
      const subscriptionResult = await client.query(getSubscriptionSql, [subscriptionId]);
      
      if (subscriptionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Subscription not found' });
      }
      
      const subscription = subscriptionResult.rows[0];
      
      // Cancel PayPal subscription if it exists
      if (subscription.paypal_subscription_id && subscription.status === 'active') {
        try {
          // Get PayPal access token
          const paypalAuth = await fetch(`${process.env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Accept-Language': 'en_US',
              'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
          });

          if (paypalAuth.ok) {
            const { access_token } = await paypalAuth.json();

            // Cancel PayPal subscription
            await fetch(`${process.env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'}/v1/billing/subscriptions/${subscription.paypal_subscription_id}/cancel`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`,
                'Accept': 'application/json',
                'PayPal-Request-Id': `admin-cancel-${subscription.paypal_subscription_id}-${Date.now()}`
              },
              body: JSON.stringify({
                reason: 'Admin deleted subscription'
              })
            });
          }
        } catch (paypalError) {
          console.error('Failed to cancel PayPal subscription:', paypalError);
          // Continue with deletion even if PayPal cancellation fails
        }
      }
      
      // Cancel Stripe subscription if it exists  
      if (subscription.stripe_subscription_id && subscription.status === 'active') {
        try {
          const Stripe = require('stripe');
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
        } catch (stripeError) {
          console.error('Failed to cancel Stripe subscription:', stripeError);
          // Continue with deletion even if Stripe cancellation fails
        }
      }
      
      // Cancel/delete associated bookings for intensive mentorship
      if (subscription.subscription_type === 'intensive_mentorship') {
        await client.query(
          `UPDATE bookings 
           SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
           WHERE user_id = $1 
           AND appointment_type = 'intensive_mentorship' 
           AND status IN ('confirmed', 'scheduled')`,
          [subscription.user_id]
        );
      }
      
      // Clean up PayPal-related tables if PayPal subscription exists
      if (subscription.paypal_subscription_id) {
        // Delete from paypal_subscriptions table
        await client.query(
          'DELETE FROM paypal_subscriptions WHERE subscription_id = $1',
          [subscription.paypal_subscription_id]
        );
        
        // Get payer_id for cleaning up customer record if needed
        const payerResult = await client.query(
          'SELECT payer_id FROM paypal_customers WHERE user_id = $1',
          [subscription.user_id]
        );
        
        if (payerResult.rows.length > 0) {
          const payerId = payerResult.rows[0].payer_id;
          
          // Delete related paypal_orders for this payer
          await client.query(
            'DELETE FROM paypal_orders WHERE payer_id = $1',
            [payerId]
          );
        }
      }
      
      // Clean up orders table entries with paypal_order_id or paypal subscription reference
      if (subscription.paypal_subscription_id) {
        await client.query(
          'DELETE FROM orders WHERE paypal_order_id = $1',
          [subscription.paypal_subscription_id]
        );
      }
      
      if (subscription.paypal_order_id) {
        await client.query(
          'DELETE FROM orders WHERE paypal_order_id = $1',
          [subscription.paypal_order_id]
        );
      }
      
      // Delete the subscription
      const deleteSql = 'DELETE FROM subscriptions WHERE id = $1 RETURNING *';
      const deleteResult = await client.query(deleteSql, [subscriptionId]);
      
      await client.query('COMMIT');
      client.release();
      
      res.json({ 
        success: true, 
        message: 'Subscription cancelled and deleted successfully',
        deleted_subscription: deleteResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error deleting subscription:', error);
    res.status(500).json({ error: 'Failed to delete subscription' });
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
  app.post('/subscriptions/cleanup-orphaned', authenticationToken, cleanupOrphanedSubscriptions);
  
  // Admin routes
  app.get('/subscriptions/admin/all', authenticationToken, getAllSubscriptionsAdmin);
  app.delete('/subscriptions/admin/:subscriptionId', authenticationToken, deleteSubscriptionAdmin);
};

module.exports = subscriptions_route;