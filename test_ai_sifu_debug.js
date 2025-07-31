#!/usr/bin/env node

// Test script to debug AI Sifu usage tracking
require('dotenv').config();
const { Pool } = require('pg');
const { AISifuStore } = require('./src/models/aiSifu');

async function testUsageTracking() {
    console.log('Testing AI Sifu usage tracking...');
    
    // Create database connection
    const pool = new Pool({
        user: process.env.DB_USER || 'jingwu_admin',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'JingWuFoundation',
        password: process.env.DB_PASSWORD || 'Rs14251425!',
        port: process.env.DB_PORT || 5432,
    });

    const store = new AISifuStore(pool);
    
    try {
        // First, get a real user ID from the database
        const userQuery = 'SELECT id, name, email FROM users WHERE is_admin = false LIMIT 1';
        const userResult = await pool.query(userQuery);
        
        if (userResult.rows.length === 0) {
            console.log('No users found in database');
            return;
        }
        
        const testUserId = userResult.rows[0].id;
        console.log(`Testing with user: ${userResult.rows[0].name} (ID: ${testUserId})`);
        
        console.log('\n=== Testing getUserUsage ===');
        const usage = await store.getUserUsage(testUserId);
        console.log('Current usage:', JSON.stringify(usage, null, 2));
        
        console.log('\n=== Testing canUserAsk ===');
        const accessCheck = await store.canUserAsk(testUserId);
        console.log('Access check result:', JSON.stringify(accessCheck, null, 2));
        
        console.log('\n=== Testing AI Sifu Settings ===');
        const settings = await store.getAiSifuSettings();
        console.log('Current settings:', JSON.stringify(settings, null, 2));
        
        // Test scenario: exhaust free questions and see what happens
        console.log('\n=== Testing with exhausted free questions ===');
        
        // Set global_free_usage to 3 (exhausted)
        const exhaustSql = `
            UPDATE ai_usage_tracking 
            SET global_free_usage = 3 
            WHERE user_id = $1 AND period_start = $2
        `;
        const currentPeriod = new Date().toISOString().split('T')[0].replace(/(\d{4})-(\d{2})-.*/, '$1-$2-01');
        await pool.query(exhaustSql, [testUserId, currentPeriod]);
        
        console.log('Set global_free_usage to 3 (exhausted)');
        
        // Check access when free questions are exhausted
        const exhaustedAccessCheck = await store.canUserAsk(testUserId);
        console.log('Access check with exhausted free questions:', JSON.stringify(exhaustedAccessCheck, null, 2));
        
        // Check what access they get for a specific course
        const courseAccessCheck = await store.canUserAsk(testUserId, 1); // Test with course ID 1
        console.log('Course-specific access check:', JSON.stringify(courseAccessCheck, null, 2));
        
        // Check if user actually has any orders or enrollments
        const orderCheck = await pool.query('SELECT * FROM orders WHERE user_id = $1 AND order_status = \'completed\'', [testUserId]);
        const enrollmentCheck = await pool.query('SELECT * FROM user_courses WHERE user_id = $1', [testUserId]);
        
        console.log('User orders:', orderCheck.rows.length);
        console.log('User enrollments:', enrollmentCheck.rows.length);
        
        if (orderCheck.rows.length > 0) {
            console.log('Orders found:', JSON.stringify(orderCheck.rows, null, 2));
        }
        if (enrollmentCheck.rows.length > 0) {
            console.log('Enrollments found:', JSON.stringify(enrollmentCheck.rows, null, 2));
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testUsageTracking();
}

module.exports = { testUsageTracking };