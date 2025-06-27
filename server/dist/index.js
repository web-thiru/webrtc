"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
app.use((0, cors_1.default)({
    origin: '*', // Allow requests from any origin
    methods: ['GET', 'POST'],
}));
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*", // Adjust for your frontend URL in production
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3001;
// Store all connected users by their socket ID
const users = new Map();
// Store users waiting for a call
const callQueue = []; // Contains socket IDs
// Function to attempt to match users from the queue
const attemptMatchmaking = () => {
    console.log('Attempting matchmaking...');
    console.log('Queue:', callQueue);
    if (callQueue.length >= 2) {
        const callerSocketId = callQueue.shift(); // Get first user
        const calleeSocketId = callQueue.shift(); // Get second user
        if (callerSocketId && calleeSocketId) {
            const caller = users.get(callerSocketId);
            const callee = users.get(calleeSocketId);
            if (caller && callee) {
                // Ensure both users are still available before initiating call
                if (caller.status === 'available' && callee.status === 'available') {
                    console.log(`Initiating call between ${caller.userId} (${callerSocketId}) and ${callee.userId} (${calleeSocketId})`);
                    caller.status = 'in-call';
                    caller.currentPeerSocketId = calleeSocketId;
                    callee.status = 'in-call';
                    callee.currentPeerSocketId = callerSocketId;
                    // Notify clients to start the WebRTC setup
                    io.to(callerSocketId).emit('call-initiated', callee.userId, calleeSocketId);
                    io.to(calleeSocketId).emit('call-incoming', caller.userId, callerSocketId);
                    // io.to(callerSocketId).emit('status', `Connecting with ${callee.userId}`);
                    // io.to(calleeSocketId).emit('status', `Connecting with ${caller.userId}`);
                    updateUserListForAll();
                    return; // Match made, exit
                }
                else {
                    // If one is no longer available, put the other back if they are
                    if (caller.status === 'available')
                        callQueue.unshift(callerSocketId);
                    if (callee.status === 'available')
                        callQueue.unshift(calleeSocketId);
                    attemptMatchmaking(); // Retry with remaining queue
                    return;
                }
            }
            else {
                // If user object not found (e.g., disconnected right after dequeue)
                // if (callerSocketId) io.to(callerSocketId).emit('status', 'Could not find peer, re-queuing.');
                // if (calleeSocketId) io.to(calleeSocketId).emit('status', 'Could not find peer, re-queuing.');
                if (callerSocketId)
                    callQueue.unshift(callerSocketId); // Put back if exists
                if (calleeSocketId)
                    callQueue.unshift(calleeSocketId); // Put back if exists
                attemptMatchmaking(); // Retry
            }
        }
    }
    else {
        // If only one person in queue, inform them they are waiting
        if (callQueue.length === 1) {
            const waitingUser = users.get(callQueue[0]);
            if (waitingUser) {
                io.to(waitingUser.socketId).emit('status', 'Waiting for another user to connect...');
            }
        }
    }
};
// Helper to emit updated user list (for debugging/monitoring)
const updateUserListForAll = () => {
    const usersInfo = Array.from(users.values()).map(u => {
        var _a;
        return ({
            id: u.userId,
            status: u.status,
            peer: u.currentPeerSocketId ? (_a = users.get(u.currentPeerSocketId)) === null || _a === void 0 ? void 0 : _a.userId : null
        });
    });
    io.emit('user-list', usersInfo);
};
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.on('register', (userId) => {
        // Check if userId already exists (prevent duplicates in a simple scenario)
        let existingUser = false;
        for (const [sId, user] of users.entries()) {
            if (user.userId === userId) {
                existingUser = true;
                // Optionally, disconnect old socket or reject new one
                io.to(socket.id).emit('status', `User ID "${userId}" already taken. Please choose another.`);
                socket.disconnect(true); // Disconnect the new connection
                return;
            }
        }
        if (!existingUser) {
            const newUser = {
                userId,
                socketId: socket.id,
                status: 'available',
                currentPeerSocketId: null,
            };
            users.set(socket.id, newUser);
            callQueue.push(socket.id); // Add to queue
            console.log(`User ${userId} registered with socket ID ${socket.id}. Added to queue.`);
            io.to(socket.id).emit('status', 'Connected.');
            updateUserListForAll();
            attemptMatchmaking(); // Try to match immediately
        }
    });
    socket.on('offer', (targetSocketId, offer) => {
        // console.log(`Offer from ${socket.id} to ${targetSocketId}`);
        io.to(targetSocketId).emit('offer', socket.id, offer);
    });
    socket.on('answer', (targetSocketId, answer) => {
        // console.log(`Answer from ${socket.id} to ${targetSocketId}`);
        io.to(targetSocketId).emit('answer', socket.id, answer);
    });
    socket.on('ice-candidate', (targetSocketId, candidate) => {
        // console.log(`ICE candidate from ${socket.id} to ${targetSocketId}`);
        io.to(targetSocketId).emit('ice-candidate', socket.id, candidate);
    });
    socket.on('end-room', () => {
        console.log(`User ${socket.id} requested to end the room.`);
        socket.disconnect(true); // Disconnect the user
    });
    socket.on('end-call', () => {
        const currentUser = users.get(socket.id);
        console.log(currentUser);
        if (currentUser && currentUser.status === 'in-call' && currentUser.currentPeerSocketId) {
            const peerSocketId = currentUser.currentPeerSocketId;
            const peer = users.get(peerSocketId);
            console.log(`${currentUser.userId} (${socket.id}) is ending call with ${peer === null || peer === void 0 ? void 0 : peer.userId} (${peerSocketId})`);
            // Update current user's status
            currentUser.status = 'available';
            currentUser.currentPeerSocketId = null;
            callQueue.push(socket.id); // Put the current user back into the queue
            // Notify the peer that the call ended
            if (peer) {
                io.to(peerSocketId).emit('call-ended-by-peer');
                // Put the peer into the queue as well (they are now available)
                peer.status = 'available';
                peer.currentPeerSocketId = null;
                callQueue.push(peerSocketId);
                io.to(peerSocketId).emit('status', `Call with ${currentUser.userId} ended. You are now available.`);
            }
            else {
                console.warn(`Peer ${peerSocketId} not found when ${currentUser.userId} ended call.`);
            }
            updateUserListForAll();
            attemptMatchmaking(); // Attempt to match the now-available users
        }
        else {
            console.log(`${currentUser === null || currentUser === void 0 ? void 0 : currentUser.userId} (${socket.id}) tried to end a call but was not in one.`);
        }
    });
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const disconnectedUser = users.get(socket.id);
        if (disconnectedUser) {
            users.delete(socket.id); // Remove from main users map
            // Remove from queue if present
            const queueIndex = callQueue.indexOf(socket.id);
            if (queueIndex > -1) {
                callQueue.splice(queueIndex, 1);
            }
            // If the user was in a call, notify their peer and re-queue the peer
            if (disconnectedUser.status === 'in-call' && disconnectedUser.currentPeerSocketId) {
                const peerSocketId = disconnectedUser.currentPeerSocketId;
                const peer = users.get(peerSocketId);
                if (peer) {
                    console.log(`Notifying ${peer.userId} (${peerSocketId}) that ${disconnectedUser.userId} disconnected.`);
                    io.to(peerSocketId).emit('call-ended-by-peer'); // Notify peer
                    // Put the peer back into the queue
                    peer.status = 'available';
                    peer.currentPeerSocketId = null;
                    callQueue.push(peerSocketId);
                    io.to(peerSocketId).emit('status', `Your peer (${disconnectedUser.userId}) disconnected. Looking for a new call...`);
                }
                else {
                    console.warn(`Disconnected user's peer ${peerSocketId} not found.`);
                }
            }
            updateUserListForAll();
            attemptMatchmaking(); // Attempt to match any newly available users
        }
    });
});
app.get('/', (req, res) => {
    res.send('Signaling server is running');
});
httpServer.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});
