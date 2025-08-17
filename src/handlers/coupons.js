// handlers/coupons.js
require('dotenv').config();
const { CouponStore } = require('../models/coupon');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * Coupon Handlers - All business logic for coupon operations
 */

// ========================
// PUBLIC COUPON HANDLERS
// ========================

/**
 * Get active coupons for dashboard display
 * GET /coupons/active
 */
const getActiveCoupons = async (req, res) => {
	try {
		const store = new CouponStore(req.app.locals.pool);
		const coupons = await store.getActiveCoupons();
		return res.status(200).json(coupons);
	} catch (error) {
		console.error('Get active coupons error:', error);
		return res.status(500).json({ error: 'Failed to retrieve coupons' });
	}
};

/**
 * Validate coupon code for PayPal checkout
 * POST /coupons/validate
 */
const validateCoupon = async (req, res) => {
	try {
		const { code } = req.body;
		
		if (!code || !code.trim()) {
			return res.status(400).json({ 
				valid: false, 
				error: 'Coupon code is required' 
			});
		}

		const store = new CouponStore(req.app.locals.pool);
		const result = await store.validateForPayPal(code.trim());
		
		return res.status(200).json(result);
	} catch (error) {
		console.error('Validate coupon error:', error);
		return res.status(500).json({ 
			valid: false, 
			error: 'Failed to validate coupon' 
		});
	}
};

// ========================
// ADMIN COUPON HANDLERS
// ========================

/**
 * Get all coupons (admin only)
 * GET /coupons/admin/all
 */
const getAllCoupons = async (req, res) => {
	try {
		const store = new CouponStore(req.app.locals.pool);
		const coupons = await store.index();
		return res.status(200).json(coupons);
	} catch (error) {
		console.error('Get all coupons error:', error);
		return res.status(500).json({ error: 'Failed to retrieve coupons' });
	}
};

/**
 * Get coupon by ID (admin only)
 * GET /coupons/admin/:id
 */
const getCoupon = async (req, res) => {
	try {
		const { id } = req.params;
		const store = new CouponStore(req.app.locals.pool);
		const coupon = await store.show(id);
		
		if (!coupon) {
			return res.status(404).json({ error: 'Coupon not found' });
		}
		
		return res.status(200).json(coupon);
	} catch (error) {
		console.error('Get coupon error:', error);
		return res.status(500).json({ error: 'Failed to retrieve coupon' });
	}
};

/**
 * Create new coupon (admin only)
 * POST /coupons/admin/create
 */
const createCoupon = async (req, res) => {
	try {
		const store = new CouponStore(req.app.locals.pool);
		const coupon = await store.create(req.body);
		return res.status(201).json(coupon);
	} catch (error) {
		console.error('Create coupon error:', error);
		if (error.message.includes('Validation error') || error.message.includes('already exists')) {
			return res.status(400).json({ error: error.message });
		}
		return res.status(500).json({ error: 'Failed to create coupon' });
	}
};

/**
 * Update coupon (admin only)
 * PUT /coupons/admin/:id
 */
const updateCoupon = async (req, res) => {
	try {
		const { id } = req.params;
		const store = new CouponStore(req.app.locals.pool);
		
		const coupon = await store.update(id, req.body);
		if (!coupon) {
			return res.status(404).json({ error: 'Coupon not found' });
		}
		
		return res.status(200).json(coupon);
	} catch (error) {
		console.error('Update coupon error:', error);
		if (error.message.includes('Validation error') || error.message.includes('already exists')) {
			return res.status(400).json({ error: error.message });
		}
		return res.status(500).json({ error: 'Failed to update coupon' });
	}
};

/**
 * Delete coupon (admin only)
 * DELETE /coupons/admin/:id
 */
const deleteCoupon = async (req, res) => {
	try {
		const { id } = req.params;
		const store = new CouponStore(req.app.locals.pool);
		
		const coupon = await store.delete(id);
		if (!coupon) {
			return res.status(404).json({ error: 'Coupon not found' });
		}
		
		return res.status(200).json({ message: 'Coupon deleted successfully', coupon });
	} catch (error) {
		console.error('Delete coupon error:', error);
		return res.status(500).json({ error: 'Failed to delete coupon' });
	}
};

/**
 * Coupon route handler - manages all coupon-related endpoints
 */
const coupon_route = (app) => {
	// Public routes
	app.get('/coupons/active', getActiveCoupons);
	app.post('/coupons/validate', validateCoupon);
	
	// Admin routes (protected)
	app.get('/coupons/admin/all', authenticationToken, requireAdmin, getAllCoupons);
	app.get('/coupons/admin/:id', authenticationToken, requireAdmin, getCoupon);
	app.post('/coupons/admin/create', authenticationToken, requireAdmin, createCoupon);
	app.put('/coupons/admin/:id', authenticationToken, requireAdmin, updateCoupon);
	app.delete('/coupons/admin/:id', authenticationToken, requireAdmin, deleteCoupon);
};

module.exports = {
	coupon_route,
	getActiveCoupons,
	validateCoupon,
	getAllCoupons,
	getCoupon,
	createCoupon,
	updateCoupon,
	deleteCoupon
};