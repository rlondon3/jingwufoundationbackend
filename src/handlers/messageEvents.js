/**
 * Server-Sent Events for real-time message updates
 */

const clients = new Map(); // Store active SSE connections

/**
 * SSE endpoint for real-time message events
 * GET /api/messages/events/:userId
 */
const messageEvents = (req, res) => {
    const userId = parseInt(req.params.userId);
    
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

    // Store client connection
    clients.set(userId, res);

    // Handle client disconnect
    req.on('close', () => {
        clients.delete(userId);
        console.log(`SSE client ${userId} disconnected`);
    });

    req.on('error', (error) => {
        console.error(`SSE error for user ${userId}:`, error);
        clients.delete(userId);
    });

    console.log(`SSE client ${userId} connected`);
};

/**
 * Broadcast new message event to specific user
 */
const broadcastNewMessage = (userId, data) => {
    const client = clients.get(userId);
    if (client) {
        try {
            client.write(`event: new-message\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`Failed to send message to user ${userId}:`, error);
            clients.delete(userId);
        }
    }
};

/**
 * Broadcast message read event to specific user
 */
const broadcastMessageRead = (userId, data) => {
    const client = clients.get(userId);
    if (client) {
        try {
            client.write(`event: message-read\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`Failed to send read event to user ${userId}:`, error);
            clients.delete(userId);
        }
    }
};

/**
 * Get count of active SSE connections
 */
const getActiveConnections = () => {
    return clients.size;
};

module.exports = (app) => {
    app.get('/api/messages/events/:userId', messageEvents);
};

module.exports.broadcastNewMessage = broadcastNewMessage;
module.exports.broadcastMessageRead = broadcastMessageRead;
module.exports.getActiveConnections = getActiveConnections;