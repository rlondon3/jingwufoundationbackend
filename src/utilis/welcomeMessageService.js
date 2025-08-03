/**
 * Welcome Message Service
 * Handles sending personalized welcome messages to new users
 */

const { MessageStore } = require('../models/message');
const { CourseStore } = require('../models/course');
const OptimizedNeigongAgent = require('./optimizedAgent');

class WelcomeMessageService {
    constructor(pool) {
        this.pool = pool;
        this.messageStore = new MessageStore(pool);
        this.courseStore = new CourseStore(pool);
        this.aiAgent = new OptimizedNeigongAgent(pool);
    }

    /**
     * Send welcome message to new user
     * @param {Object} newUser - The newly created user object
     */
    async sendWelcomeMessage(newUser) {
        try {
            console.log(`🎉 Sending welcome message to new user: ${newUser.name} (ID: ${newUser.id})`);

            // Get the instructor user (admin user to send welcome from)
            const instructor = await this.getInstructor();
            if (!instructor) {
                console.warn('No instructor found to send welcome message from');
                return;
            }

            // Get the latest published course for the call-to-action
            const latestCourse = await this.getLatestCourse();
            
            // Generate personalized welcome message
            const welcomeMessage = await this.generateWelcomeMessage(newUser, latestCourse, instructor);

            // Send the welcome message
            await this.messageStore.sendMessage(instructor.id, newUser.id, welcomeMessage);

            console.log(`✅ Welcome message sent successfully to ${newUser.name}`);
        } catch (error) {
            console.error('Error sending welcome message:', error);
            // Don't throw error - welcome message failure shouldn't block user registration
        }
    }

    /**
     * Get instructor user (first admin user found) with name
     */
    async getInstructor() {
        try {
            const sql = 'SELECT id, name FROM users WHERE is_admin = true ORDER BY created_at ASC LIMIT 1';
            const client = await this.pool.connect();
            const res = await client.query(sql);
            client.release();
            
            return res.rows.length > 0 ? res.rows[0] : null;
        } catch (error) {
            console.error('Error getting instructor:', error);
            return null;
        }
    }

    /**
     * Get the latest published course
     */
    async getLatestCourse() {
        try {
            const sql = `
                SELECT id, title, description, price 
                FROM courses 
                WHERE is_published = true 
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            const client = await this.pool.connect();
            const res = await client.query(sql);
            client.release();
            
            return res.rows.length > 0 ? res.rows[0] : null;
        } catch (error) {
            console.error('Error getting latest course:', error);
            return null;
        }
    }

    /**
     * Generate personalized welcome message
     */
    async generateWelcomeMessage(user, latestCourse, instructor) {
        try {
            const courseInfo = latestCourse 
                ? `Our latest course "${latestCourse.title}" is now available: https://jingwufoundation.com/courses/${latestCourse.id}`
                : 'Check our courses page for available training opportunities.';

            const prompt = `Write a brief, professional welcome message for a new student named ${user.name} who just registered for the Jing Wu Foundation app.

Structure:
1. Welcome them personally
2. One sentence about who we are (traditional martial arts focused on direct instructor interaction, not course binging)
3. Call to action: ${courseInfo}

Tone: Professional, concise, direct. Sign with the instructor's name: ${instructor.name}

Length: Keep it very brief - 2-3 sentences maximum.`;

            const response = await this.aiAgent.handleQuery(prompt);
            
            // Return the AI-generated message, fallback to default if AI fails
            return response.response || this.getDefaultWelcomeMessage(user, latestCourse, instructor);
            
        } catch (error) {
            console.error('Error generating AI welcome message:', error);
            return this.getDefaultWelcomeMessage(user, latestCourse, instructor);
        }
    }

    /**
     * Fallback welcome message if AI generation fails
     */
    getDefaultWelcomeMessage(user, latestCourse, instructor) {
        const courseText = latestCourse 
            ? ` Our latest course "${latestCourse.title}" is now available: https://jingwufoundation.com/courses/${latestCourse.id}`
            : ' Check our courses page for available training opportunities.';

        return `Welcome to Jing Wu Foundation, ${user.name}! We focus on traditional martial arts with direct instructor interaction, not course binging.${courseText}

- ${instructor.name}`;
    }
}

module.exports = WelcomeMessageService;