/**
 * Test script for welcome message functionality
 * Run this to test the welcome message system without creating actual users
 */

require('dotenv').config();
const { Pool } = require('pg');
const WelcomeMessageService = require('../src/utilis/welcomeMessageService');

async function testWelcomeMessage() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    const welcomeService = new WelcomeMessageService(pool);

    // Mock user data for testing
    const mockUser = {
        id: 999, // Use a high ID that won't conflict
        name: 'Test User',
        email: 'test@example.com',
        is_admin: false
    };

    try {
        console.log('🧪 Testing welcome message service...');
        
        // Test getting instructor
        const instructor = await welcomeService.getInstructor();
        console.log('Instructor:', instructor);

        // Test getting latest course
        const latestCourse = await welcomeService.getLatestCourse();
        console.log('Latest course:', latestCourse);

        // Test generating welcome message
        const message = await welcomeService.generateWelcomeMessage(mockUser, latestCourse, instructor);
        console.log('\n📧 Generated welcome message:');
        console.log('=' .repeat(50));
        console.log(message);
        console.log('=' .repeat(50));

        console.log('\n✅ Welcome message service test completed successfully!');
        console.log('\nNote: This test did not actually send a message to avoid creating test data in your system.');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the test
testWelcomeMessage();