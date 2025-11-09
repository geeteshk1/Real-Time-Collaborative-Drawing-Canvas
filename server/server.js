const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Rooms = require('./rooms');
const DrawingState = require('./drawing-state');

// Initialize express app with security middleware
const app = express();

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const server = http.createServer(app);

// Environment variables with defaults
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

// Initialize WebSocket server with ping timeout
const wss = new WebSocket.Server({ 
  noServer: true,  // Use server upgrade event instead
  clientTracking: true,
  maxPayload: 50 * 1024 // 50kb max payload size
});

// Handle upgrade to WebSocket
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '..', 'client')));

// Log all HTTP requests
app.use((req, res, next) => {
  console.log('HTTP:', req.method, req.url);
  next();
});

// Simple in-memory rooms manager
const rooms = new Rooms();

const USER_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1', 
  '#3949ab', '#1e88e5', '#039be5', '#00acc1',
  '#00897b', '#43a047', '#7cb342', '#c0ca33',
  '#fdd835', '#ffb300', '#fb8c00', '#f4511e'
];

wss.on('connection', (ws, req) => {
  const userId = uuidv4();
  ws.userId = userId;
  ws.isAlive = true;
  ws.color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

  console.log('New WebSocket connection, assigned userId:', userId);

  ws.on('pong', () => { 
    ws.isAlive = true; 
    ws.send(JSON.stringify({ type: 'pong' }));
  });

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      console.log('Received message from', userId + ':', JSON.stringify(msg));
      handleMessage(ws, msg);
    } catch (err) {
      console.error('Invalid message from', userId + ':', err);
    }
  });

  ws.on('close', () => {
    // remove from room
    const room = rooms.findBySocket(ws);
    if (room) {
      room.removeClient(ws);
      broadcastRoom(room, { type: 'user-left', userId: ws.userId });
    }
  });

  // Send initial connection with color
  ws.send(JSON.stringify({ 
    type: 'connected', 
    userId,
    color: ws.color
  }));
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }
    case 'join-room': {
      // Remove from current room if any
      const oldRoom = rooms.findBySocket(ws);
      if (oldRoom) {
        oldRoom.removeClient(ws);
        broadcastRoom(oldRoom, { 
          type: 'users-updated', 
          users: Array.from(oldRoom.clients).map(c => ({ 
            id: c.userId, 
            color: c.color 
          }))
        });
      }

      const roomId = msg.roomId || 'default';
      let room = rooms.get(roomId);
      if (!room) {
        room = rooms.create(roomId);
      }
      room.addClient(ws);

      // send existing state
      ws.send(JSON.stringify({ type: 'room-joined', roomId, state: room.drawingState.getSnapshot() }));

      // send updated user list to everyone in the room
      broadcastRoom(room, { 
        type: 'users-updated', 
        users: Array.from(room.clients).map(c => ({ 
          id: c.userId, 
          color: c.color 
        }))
      });
      break;
    }
    case 'draw': {
      const room = rooms.findBySocket(ws);
      if (!room) {
        console.log('draw: no room found for socket');
        return;
      }
      // msg contains stroke data
      console.log('received draw from', ws.userId, ':', JSON.stringify(msg.op));
      const op = room.drawingState.addOperation({ userId: ws.userId, op: msg.op });
      console.log('broadcasting op:', JSON.stringify(op));
      // broadcast op with assigned opId to all clients including sender
      room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'op', 
            op: op 
          }));
        }
      });
      break;
    }
    case 'cursor': {
      const room = rooms.findBySocket(ws);
      if (!room) return;
      // broadcast cursor positions to others
      broadcastRoom(room, { type: 'cursor', userId: ws.userId, x: msg.x, y: msg.y });
      break;
    }
    case 'undo': {
      const room = rooms.findBySocket(ws);
      if (!room) {
        ws.send(JSON.stringify({ 
          type: 'undo', 
          success: false, 
          message: 'Not in a room' 
        }));
        return;
      }
      
      const res = room.drawingState.undo(ws.userId);
      console.log('undo result:', JSON.stringify(res));
      
      if (res.success) {
        // Update all clients with the new state
        broadcastRoom(room, { 
          type: 'undo', 
          success: true,
          op: res.op,
          canUndo: res.canUndo,
          canRedo: res.canRedo,
          message: 'Operation undone',
          userId: ws.userId // Include userId for client-side filtering
        });

        // Send updated state to each client with their specific undo/redo state
        room.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            const userSnapshot = room.drawingState.getSnapshot(client.userId);
            client.send(JSON.stringify({
              type: 'state-update',
              ops: userSnapshot.ops,
              canUndo: userSnapshot.canUndo,
              canRedo: userSnapshot.canRedo,
              users: room.getActiveUsers()
            }));
          }
        });
      } else {
        // Send failure only to requesting client
        ws.send(JSON.stringify({
          type: 'undo',
          success: false,
          message: res.message,
          canUndo: res.canUndo,
          canRedo: res.canRedo
        }));
      }
      break;
    }
    case 'clear': {
      const room = rooms.findBySocket(ws);
      if (!room) {
        ws.send(JSON.stringify({ 
          type: 'clear', 
          success: false, 
          message: 'Not in a room' 
        }));
        return;
      }

      // Clear the room's drawing state
      room.drawingState = new DrawingState();
      
      // Broadcast the clear event to all clients
      broadcastRoom(room, {
        type: 'clear',
        success: true,
        message: 'Canvas cleared',
        userId: ws.userId
      });

      // Send empty state to all clients
      const snapshot = room.drawingState.getSnapshot();
      broadcastRoom(room, {
        type: 'state-update',
        ops: snapshot.ops,
        canUndo: snapshot.canUndo,
        canRedo: snapshot.canRedo,
        users: room.getActiveUsers()
      });
      break;
    }
    case 'redo': {
      const room = rooms.findBySocket(ws);
      if (!room) {
        ws.send(JSON.stringify({ 
          type: 'redo', 
          success: false, 
          message: 'Not in a room' 
        }));
        return;
      }
      
      const res = room.drawingState.redo(ws.userId);
      console.log('redo result:', JSON.stringify(res));
      
      if (res.success) {
        // Update all clients with the new state
        broadcastRoom(room, { 
          type: 'redo', 
          success: true,
          op: res.op,
          canUndo: res.canUndo,
          canRedo: res.canRedo,
          message: 'Operation redone',
          userId: ws.userId // Include userId for client-side filtering
        });

        // Send updated state to each client with their specific undo/redo state
        room.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            const userSnapshot = room.drawingState.getSnapshot(client.userId);
            client.send(JSON.stringify({
              type: 'state-update',
              ops: userSnapshot.ops,
              canUndo: userSnapshot.canUndo,
              canRedo: userSnapshot.canRedo,
              users: room.getActiveUsers()
            }));
          }
        });
      } else {
        // Send failure only to requesting client
        ws.send(JSON.stringify({
          type: 'redo',
          success: false,
          message: res.message,
          canUndo: res.canUndo,
          canRedo: res.canRedo
        }));
      }
      break;
    }
    default:
      console.warn('Unknown message type', msg.type);
  }
}

function broadcastRoom(room, data) {
  const str = JSON.stringify(data);
  room.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(str);
  });
}

// heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
