const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Database setup
const db = new sqlite3.Database('locations.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        socket_id TEXT UNIQUE,
        role TEXT CHECK(role IN ('user', 'worker')),
        name TEXT,
        latitude REAL,
        longitude REAL,
        accuracy REAL,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_socket_id TEXT,
        worker_socket_id TEXT,
        status TEXT CHECK(status IN ('pending', 'accepted', 'completed', 'cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accepted_at DATETIME,
        FOREIGN KEY (user_socket_id) REFERENCES users (socket_id),
        FOREIGN KEY (worker_socket_id) REFERENCES users (socket_id)
    )`);
});

// Serve static files
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/map', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle role selection
    socket.on('select-role', (data) => {
        const { role, name } = data;
        
        // Insert or update user in database
        db.run(
            `INSERT OR REPLACE INTO users (socket_id, role, name, last_seen) 
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [socket.id, role, name],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    socket.emit('error', { message: 'Failed to save user data' });
                } else {
                    socket.emit('role-selected', { role, name });
                    console.log(`User ${socket.id} selected role: ${role} as ${name}`);
                }
            }
        );
    });

    // Handle location updates
    socket.on('location-update', (data) => {
        const { latitude, longitude, accuracy } = data;
        
        // Update user location in database
        db.run(
            `UPDATE users SET latitude = ?, longitude = ?, accuracy = ?, last_seen = CURRENT_TIMESTAMP 
             WHERE socket_id = ?`,
            [latitude, longitude, accuracy, socket.id],
            function(err) {
                if (err) {
                    console.error('Location update error:', err);
                } else {
                    console.log(`Location updated for ${socket.id}: ${latitude}, ${longitude}`);
                    
                    // Get user role
                    db.get(
                        `SELECT role, name FROM users WHERE socket_id = ?`,
                        [socket.id],
                        (err, user) => {
                            if (!err && user) {
                                // Broadcast location to opposite role
                                const targetRole = user.role === 'user' ? 'worker' : 'user';
                                
                                db.all(
                                    `SELECT * FROM users WHERE role = ? AND latitude IS NOT NULL AND longitude IS NOT NULL`,
                                    [targetRole],
                                    (err, targets) => {
                                        if (!err && targets.length > 0) {
                                            targets.forEach(target => {
                                                io.to(target.socket_id).emit('location-shared', {
                                                    id: socket.id,
                                                    name: user.name,
                                                    role: user.role,
                                                    latitude,
                                                    longitude,
                                                    accuracy
                                                });
                                            });
                                        }
                                    }
                                );
                            }
                        }
                    );
                }
            }
        );
    });

    // Handle getting all locations for a role
    socket.on('get-locations', (role) => {
        const targetRole = role === 'user' ? 'worker' : 'user';
        
        db.all(
            `SELECT * FROM users WHERE role = ? AND latitude IS NOT NULL AND longitude IS NOT NULL`,
            [targetRole],
            (err, locations) => {
                if (!err) {
                    socket.emit('locations-data', locations.map(loc => ({
                        id: loc.socket_id,
                        name: loc.name,
                        role: loc.role,
                        latitude: loc.latitude,
                        longitude: loc.longitude,
                        accuracy: loc.accuracy,
                        last_seen: loc.last_seen
                    })));
                }
            }
        );
    });

    // Handle request creation
    socket.on('create-request', (data) => {
        const { workerId } = data;
        
        // Get user info
        db.get(
            `SELECT * FROM users WHERE socket_id = ?`,
            [socket.id],
            (err, user) => {
                if (!err && user) {
                    // Create request
                    db.run(
                        `INSERT INTO requests (user_socket_id, worker_socket_id, status) VALUES (?, ?, 'pending')`,
                        [socket.id, workerId],
                        function(err) {
                            if (!err) {
                                const requestId = this.lastID;
                                
                                // Notify worker about the request
                                io.to(workerId).emit('new-request', {
                                    requestId,
                                    userId: socket.id,
                                    userName: user.name,
                                    userLat: user.latitude,
                                    userLng: user.longitude
                                });
                                
                                // Notify user
                                socket.emit('request-created', { requestId, status: 'pending' });
                                
                                console.log(`Request created: ${requestId} from ${user.name} to worker ${workerId}`);
                            } else {
                                console.error('Error creating request:', err);
                                socket.emit('error', { message: 'Failed to create request' });
                            }
                        }
                    );
                }
            }
        );
    });

    // Handle request acceptance
    socket.on('accept-request', (data) => {
        const { requestId } = data;
        
        // Update request status
        db.run(
            `UPDATE requests SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, worker_socket_id = ? WHERE id = ?`,
            [socket.id, requestId],
            function(err) {
                if (!err) {
                    // Get request details
                    db.get(
                        `SELECT r.*, u.name as user_name, u.latitude as user_lat, u.longitude as user_lng,
                                w.name as worker_name, w.latitude as worker_lat, w.longitude as worker_lng
                         FROM requests r
                         JOIN users u ON r.user_socket_id = u.socket_id
                         JOIN users w ON r.worker_socket_id = w.socket_id
                         WHERE r.id = ?`,
                        [requestId],
                        (err, request) => {
                            if (!err && request) {
                                // Notify both user and worker
                                io.to(request.user_socket_id).emit('request-accepted', {
                                    requestId,
                                    workerId: socket.id,
                                    workerName: request.worker_name,
                                    workerLat: request.worker_lat,
                                    workerLng: request.worker_lng,
                                    userLat: request.user_lat,
                                    userLng: request.user_lng
                                });
                                
                                io.to(socket.id).emit('request-accepted', {
                                    requestId,
                                    workerId: socket.id,
                                    workerName: request.worker_name,
                                    workerLat: request.worker_lat,
                                    workerLng: request.worker_lng,
                                    userLat: request.user_lat,
                                    userLng: request.user_lng
                                });
                                
                                console.log(`Request ${requestId} accepted by ${request.worker_name}`);
                            }
                        }
                    );
                } else {
                    console.error('Error accepting request:', err);
                    socket.emit('error', { message: 'Failed to accept request' });
                }
            }
        );
    });

    // Handle request cancellation
    socket.on('cancel-request', (data) => {
        const { requestId } = data;
        
        db.run(
            `UPDATE requests SET status = 'cancelled' WHERE id = ? AND user_socket_id = ?`,
            [requestId, socket.id],
            function(err) {
                if (!err) {
                    socket.emit('request-cancelled', { requestId });
                    console.log(`Request ${requestId} cancelled`);
                }
            }
        );
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove user from database
        db.run(`DELETE FROM users WHERE socket_id = ?`, [socket.id]);
        
        // Notify others that this user is offline
        socket.broadcast.emit('user-offline', { id: socket.id });
    });
});

// Use the port provided by Render, or default to 3000
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Server running on http://localhost:${PORT}`);
});
