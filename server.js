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

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove user from database
        db.run(`DELETE FROM users WHERE socket_id = ?`, [socket.id]);
        
        // Notify others that this user is offline
        socket.broadcast.emit('user-offline', { id: socket.id });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
