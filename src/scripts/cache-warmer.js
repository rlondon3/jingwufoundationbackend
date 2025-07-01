// scripts/cache-warmer.js
scripts / cache - warmer.js;
//
// RAILWAY DEPLOYMENT SETUP:
//
// This script runs weekly to pre-cache popular questions for faster responses.
//
// TO SET UP ON RAILWAY:
//
// Option 1 - Railway Dashboard:
// 1. Go to your Railway project dashboard
// 2. Navigate to "Settings" > "Cron Jobs"
// 3. Click "Add Cron Job"
// 4. Name: "weekly-cache-warmer"
// 5. Schedule: "0 2 * * 0" (Every Sunday at 2 AM)
// 6. Command: "node src/scripts/cache-warmer.js"
// 7. Save
//
// Option 2 - Railway CLI:
// Run this command from your project directory:
// railway cron add "weekly-cache-warmer" "0 2 * * 0" "node src/scripts/cache-warmer.js"
//
// Option 3 - railway.toml file:
// Add this to your railway.toml:
// [cron.weekly_cache_warmer]
// schedule = "0 2 * * 0"
// command = "node src/scripts/cache-warmer.js"
//
// TO VERIFY IT'S WORKING:
// 1. Check Railway logs after Sunday 2 AM: railway logs --filter "cache-warmer"
// 2. Query database: SELECT COUNT(*) FROM ai_response_cache WHERE created_at >= CURRENT_DATE - INTERVAL '7 days';
// 3. Test API with popular questions - should return cached: true
//
// MANUAL EXECUTION (for testing):
// railway run node src/scripts/cache-warmer.js
//

require('dotenv').config();
const { Pool } = require('pg');
const { NeigongManualAgent } = require('../utilis/agent');
const { AISifuStore } = require('../models/aiSifu');

class CacheWarmer {
	constructor() {
		this.pool = new Pool({
			host: process.env.DB_HOST,
			port: process.env.DB_PORT,
			database: process.env.DB_NAME,
			user: process.env.DB_USER,
			password: process.env.DB_PASSWORD,
		});
		this.store = new AISifuStore(this.pool);
		this.agent = new NeigongManualAgent();
	}

	async getPopularQuestions(limit = 10) {
		const sql = `
            SELECT 
                aqa.question_text,
                COUNT(*) as ask_count,
                AVG(aqa.response_time_ms) as avg_response_time,
                MAX(aqa.created_at) as last_asked
            FROM ai_question_analytics aqa
            JOIN users u ON aqa.user_id = u.id
            WHERE 
                aqa.created_at >= CURRENT_DATE - INTERVAL '30 days'
                AND u.is_admin = false
                AND LENGTH(aqa.question_text) BETWEEN 10 AND 200
                AND aqa.question_text NOT ILIKE '%test%'
                AND aqa.question_text NOT ILIKE '%debug%'
            GROUP BY aqa.question_text
            HAVING COUNT(*) >= 2
            ORDER BY ask_count DESC, avg_response_time DESC
            LIMIT $1
        `;

		try {
			const result = await this.pool.query(sql, [limit]);
			return result.rows;
		} catch (error) {
			console.error('Error fetching popular questions:', error);
			return [];
		}
	}

	async preCacheQuestion(questionText) {
		try {
			console.log(`Pre-caching: "${questionText}"`);

			// Check if already cached and not expired
			const existingCache = await this.store.getCachedResponse(questionText);
			if (existingCache) {
				console.log(`  → Already cached, skipping`);
				return { success: true, skipped: true };
			}

			// Generate AI response
			const startTime = Date.now();
			const response = await this.agent.handleQuery(questionText);
			const responseTime = Date.now() - startTime;

			// Cache with extended expiration (10 days for pre-cached content)
			const questionHash = this.store.hashQuestion(questionText);
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 10); // 10 days instead of normal 7

			const cacheSql = `
                INSERT INTO ai_response_cache (question_hash, question_text, response_data, expires_at, usage_count)
                VALUES ($1, $2, $3, $4, 0)
                ON CONFLICT (question_hash) 
                DO UPDATE SET 
                    response_data = EXCLUDED.response_data,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `;

			await this.pool.query(cacheSql, [
				questionHash,
				questionText,
				JSON.stringify(response),
				expiresAt,
			]);

			console.log(`  → Cached successfully (${responseTime}ms)`);
			return {
				success: true,
				responseTime,
				termsUsed: response.terms_used?.length || 0,
			};
		} catch (error) {
			console.error(`  → Error pre-caching: ${error.message}`);
			return { success: false, error: error.message };
		}
	}

	async warmCache() {
		console.log('🔥 Starting weekly cache warming...');
		console.log('📅 Date:', new Date().toISOString());

		try {
			// Get popular questions
			console.log('📊 Fetching popular questions...');
			const popularQuestions = await this.getPopularQuestions(10);

			if (popularQuestions.length === 0) {
				console.log('⚠️  No popular questions found');
				return;
			}

			console.log(`📝 Found ${popularQuestions.length} popular questions:`);
			popularQuestions.forEach((q, index) => {
				console.log(
					`   ${index + 1}. "${q.question_text}" (asked ${q.ask_count} times)`
				);
			});

			// Pre-cache each question
			console.log('\n🤖 Starting AI pre-processing...');
			const results = {
				total: popularQuestions.length,
				success: 0,
				skipped: 0,
				failed: 0,
				totalTime: 0,
			};

			for (const questionData of popularQuestions) {
				const result = await this.preCacheQuestion(questionData.question_text);

				if (result.success) {
					if (result.skipped) {
						results.skipped++;
					} else {
						results.success++;
						results.totalTime += result.responseTime || 0;
					}
				} else {
					results.failed++;
				}
			}

			// Summary
			console.log('\n✅ Cache warming completed!');
			console.log(
				`📈 Results: ${results.success} cached, ${results.skipped} skipped, ${results.failed} failed`
			);
			if (results.success > 0) {
				console.log(
					`⏱️  Average processing time: ${Math.round(
						results.totalTime / results.success
					)}ms`
				);
			}
		} catch (error) {
			console.error('❌ Cache warming failed:', error);
		} finally {
			await this.pool.end();
		}
	}

	// Clean up old cache entries while we're at it
	async cleanExpiredCache() {
		try {
			console.log('🧹 Cleaning expired cache entries...');
			const deletedCount = await this.store.cleanExpiredCache();
			console.log(`🗑️  Removed ${deletedCount} expired entries`);
		} catch (error) {
			console.error('Error cleaning cache:', error);
		}
	}
}

// Script execution
async function main() {
	const warmer = new CacheWarmer();

	try {
		// Clean old cache first
		await warmer.cleanExpiredCache();

		// Warm cache with popular questions
		await warmer.warmCache();
	} catch (error) {
		console.error('Script failed:', error);
		process.exit(1);
	}
}

// Run if called directly
if (require.main === module) {
	main();
}

module.exports = { CacheWarmer };
