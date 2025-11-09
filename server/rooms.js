const DrawingState = require('./drawing-state');

class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.drawingState = new DrawingState();
    this.lastActivity = Date.now();
    this.userColors = new Map(); // Track user colors consistently
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.roomId = this.id;
    this.lastActivity = Date.now();
    
    // Ensure consistent color for user across reconnects
    if (!this.userColors.has(ws.userId)) {
      this.userColors.set(ws.userId, ws.color);
    } else {
      ws.color = this.userColors.get(ws.userId);
    }
  }

  removeClient(ws) {
    this.clients.delete(ws);
    ws.roomId = null;
    this.lastActivity = Date.now();
    
    // Only remove color if user's last connection
    const hasOtherConnections = Array.from(this.clients)
      .some(client => client.userId === ws.userId);
    
    if (!hasOtherConnections) {
      this.userColors.delete(ws.userId);
    }
  }

  getActiveUsers() {
    const users = new Map();
    for (const client of this.clients) {
      users.set(client.userId, {
        id: client.userId,
        color: this.userColors.get(client.userId)
      });
    }
    return Array.from(users.values());
  }
}

class Rooms {
  constructor() {
    this.map = new Map();
    // Start room cleanup interval
    setInterval(() => this.cleanupEmptyRooms(), 60000);
  }

  create(id) {
    // Check if room already exists
    const existing = this.map.get(id);
    if (existing) {
      return existing;
    }
    
    console.log(`Creating new room: ${id}`);
    const r = new Room(id);
    this.map.set(id, r);
    return r;
  }

  get(id) {
    return this.map.get(id);
  }

  findBySocket(ws) {
    if (!ws.roomId) return null;
    return this.map.get(ws.roomId);
  }

  cleanupEmptyRooms() {
    let cleaned = 0;
    for (const [id, room] of this.map.entries()) {
      // Don't remove default room
      if (id === 'default') continue;
      
      // Remove room if empty for more than 5 minutes
      if (room.clients.size === 0) {
        this.map.delete(id);
        cleaned++;
        console.log(`Cleaned up empty room: ${id}`);
      }
    }
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} empty rooms`);
    }
  }
}

module.exports = Rooms;
