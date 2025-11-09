// Simple WebSocket client wrapper
(function(global){
  const USER_COLORS = [
    '#e53935', '#d81b60', '#8e24aa', '#5e35b1', 
    '#3949ab', '#1e88e5', '#039be5', '#00acc1',
    '#00897b', '#43a047', '#7cb342', '#c0ca33',
    '#fdd835', '#ffb300', '#fb8c00', '#f4511e'
  ];

  const WS = function(){
    this.ws = null;
    this.handlers = {};
    this.userId = null;
    this.userColors = {}; // Store colors for all users
    this.currentRoom = null;
    this.retryCount = 0;
    this.lastPing = Date.now();
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = Date.now();
    this.activeUsers = new Map();
    this.isDrawing = false;
  };

  WS.prototype.getActiveUsers = function() {
    return Array.from(this.activeUsers.values());
  };

  WS.prototype.connect = function(url){
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      console.log('Already connecting...');
      return;
    }

    console.log('WS connecting to:', url);
    try {
      this.ws = new WebSocket(url);
      
      this.ws.addEventListener('open', ()=>{ 
            this.retryCount = 0;
        this.updateConnectionStatus(true);
        // Start ping-pong for latency measurement
        this.startPingPong();
      });
      
      this.ws.addEventListener('error', (error)=>{
        this.updateConnectionStatus(false);
        this._dispatch({ type: 'error', error: 'Connection error' });
      });
      
      this.ws.addEventListener('close', (event)=>{
        this.updateConnectionStatus(false);
        this._dispatch({ type: 'disconnected' });
        
        // Only auto-reconnect if not a normal closure
        if (event.code !== 1000) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
          this.retryCount++;
          setTimeout(() => this.connect(url), delay);
        }
      });
    } catch (err) {
      this._dispatch({ type: 'error', error: err.message });
    }
    
    this.ws.addEventListener('message', (ev)=>{
      let msg = null;
      try{ 
        msg = JSON.parse(ev.data); 
      } catch(e){
        return;
      }
      this._dispatch(msg);
    });
  };

  WS.prototype.on = function(type, fn){ this.handlers[type] = fn; };
  WS.prototype._dispatch = function(msg){
    if (msg.type === 'connected'){
      this.userId = msg.userId;
      this.userColors[msg.userId] = msg.color;
    }
    
    // Update active users and colors if user list is updated
    if (msg.type === 'users-updated' && msg.users) {
      msg.users.forEach(user => {
        this.userColors[user.id] = user.color;
      });
    }
    
    const h = this.handlers[msg.type];
    if (h) h(msg);
  };

  WS.prototype.send = function(msg){
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  };

  WS.prototype.updateConnectionStatus = function(connected) {
    const el = document.getElementById('connection-status');
    if (el) {
      el.textContent = connected ? '● Connected' : '● Disconnected';
      el.className = connected ? 'connected' : 'disconnected';
    }
  };

  WS.prototype.startPingPong = function() {
    // Measure latency every 2 seconds
    setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.lastPing = Date.now();
        this.send({ type: 'ping' });
      }
    }, 2000);

    // Update FPS counter
    const updateFps = () => {
      const now = Date.now();
      const elapsed = (now - this.lastFpsUpdate) / 1000;
      this.fps = Math.round(this.frameCount / elapsed);
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      
      const fpsEl = document.getElementById('fps');
      if (fpsEl) fpsEl.textContent = this.fps;
      
      requestAnimationFrame(updateFps);
    };
    requestAnimationFrame(updateFps);
  };

  WS.prototype.recordFrame = function() {
    this.frameCount++;
  };

  WS.prototype.updateLatency = function(latency) {
    const el = document.getElementById('latency');
    if (el) el.textContent = latency;
  };

  WS.prototype.updateUsers = function(users) {
    // Update internal user tracking
    this.activeUsers.clear();
    users.forEach(user => {
      this.activeUsers.set(user.id, user);
    });

    // Update UI
    const el = document.getElementById('active-users');
    if (!el) return;
    
    el.innerHTML = users.map(u => `
      <div class="user-badge" style="--user-color: ${u.color}">
        <span class="user-status"></span>
        <span class="user-name">${u.id === this.userId ? 'You' : 'User ' + u.id.slice(0,4)}</span>
      </div>
    `).join('');
  };

  global.WSClient = WS;
})(window);
