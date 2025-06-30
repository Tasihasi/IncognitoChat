const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
  }
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'IncognitoChat API is running' });
});

// Get all chat rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chat_rooms ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get messages for a specific room
app.get('/api/rooms/:roomId/messages', async (req, res) => {
  try {
    const { roomId } = req.params;
    const result = await pool.query(`
      SELECT m.*, u.username 
      FROM messages m 
      LEFT JOIN users u ON m.user_id = u.id 
      WHERE m.room_id = $1 
      ORDER BY m.created_at ASC
    `, [roomId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new message
app.post('/api/rooms/:roomId/messages', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content, isAnonymous = true } = req.body;
    
    const result = await pool.query(`
      INSERT INTO messages (content, room_id, is_anonymous, created_at) 
      VALUES ($1, $2, $3, NOW()) 
      RETURNING *
    `, [content, roomId, isAnonymous]);
    
    const newMessage = result.rows[0];
    
    // Emit the message to all connected clients in the room
    io.to(`room_${roomId}`).emit('new_message', newMessage);
    
    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error creating message:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join a chat room
  socket.on('join_room', (roomId) => {
    socket.join(`room_${roomId}`);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });
  
  // Leave a chat room
  socket.on('leave_room', (roomId) => {
    socket.leave(`room_${roomId}`);
    console.log(`User ${socket.id} left room ${roomId}`);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
