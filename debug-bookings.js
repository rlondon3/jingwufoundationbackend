// Debug script to check bookings in database
const { Pool } = require('pg');
const { BookingsStore } = require('./src/models/booking');

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function debugBookings() {
    try {
        console.log('Checking bookings in database...');
        
        const store = new BookingsStore(pool);
        
        // Get all bookings
        const allBookings = await store.getAllBookings(10, 0);
        console.log('\nAll bookings:');
        allBookings.forEach(booking => {
            console.log(`ID: ${booking.id}`);
            console.log(`Type: ${booking.appointment_type}`);
            console.log(`Name: ${booking.full_name}`);
            console.log(`Start: ${booking.start_time}`);
            console.log(`End: ${booking.end_time}`);
            console.log(`Status: ${booking.status}`);
            console.log('---');
        });
        
        // Get bookings for current month
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        
        console.log(`\nGetting bookings for date range: ${startDate} to ${endDate}`);
        const monthBookings = await store.getBookingsByDateRange(startDate, endDate);
        console.log('Month bookings:');
        monthBookings.forEach(booking => {
            const startDate = new Date(booking.start_time);
            console.log(`${booking.appointment_type} - ${booking.full_name} on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString()}`);
        });
        
    } catch (error) {
        console.error('Debug error:', error);
    } finally {
        await pool.end();
    }
}

debugBookings();