// Minimal canvas drawing logic with path batching and simple smoothing
(function(global){
  function CanvasApp(canvasEl, cursorsEl, ws){
    this.canvas = canvasEl;
    this.cursors = cursorsEl;
    this.ws = ws;
    this.ctx = this.canvas.getContext('2d');
    this.tool = 'brush';
    this.color = '#000';
    this.size = 4;
    this.drawing = false;
    this.path = [];
    this.remoteCursors = {};
    this.ops = []; // local applied ops (also mirror server ops)

    this.resize();
    window.addEventListener('resize', ()=>this.resize());

    this.bindEvents();
  }

  CanvasApp.prototype.resize = function(){
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    // redraw
    this.redraw();
  };

  CanvasApp.prototype.bindEvents = function(){
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this._start.bind(this));
    canvas.addEventListener('pointermove', this._move.bind(this));
    window.addEventListener('pointerup', this._end.bind(this));

    // ws handlers
    this.ws.on('room-joined', (msg)=>{
      this.ops = msg.state.ops || [];
      this.redraw();
      // Update initial undo/redo state with userId-specific state
      const snapshot = {
        canUndo: msg.state.ops && msg.state.ops.some(op => op.userId === this.ws.userId),
        canRedo: false // Start with no redo operations
      };
      this.updateUndoRedoState(snapshot);
    });

    this.ws.on('op', (msg)=>{
      console.log('received op:', JSON.stringify(msg.op));
      // Draw all ops (including our own for consistency)
      this.ops.push(msg.op);
      this.drawOp(msg.op);
    });

    this.ws.on('cursor', (msg)=>{
      this.showCursor(msg.userId, msg.x, msg.y);
    });

    this.ws.on('user-joined', ()=>this.updateUsers());
    this.ws.on('user-left', (msg)=>{
      this.updateUsers();
      // Remove cursor for user who left
      if (msg.userId && this.remoteCursors[msg.userId]) {
        this.remoteCursors[msg.userId].remove();
        delete this.remoteCursors[msg.userId];
      }
    });

    this.ws.on('undo', (msg)=>{
      console.log('received undo:', JSON.stringify(msg));
      if (msg.success && msg.op) {
        // Remove the operation from local state
        this.ops = this.ops.filter(op => op.opId !== msg.op.opId);
        // Full redraw to ensure consistency
        this.redraw();
        this.updateUndoRedoState(msg);
        
        // Show user-specific message
        const isOwnAction = msg.userId === this.ws.userId;
        this.showNotification(
          isOwnAction ? 'Action undone' : `${msg.userId.slice(0,4)} undid their action`,
          'info'
        );
        
        console.log('Operations after undo:', this.ops.length, this.ops);
      } else {
        console.warn('Undo failed:', msg.message);
        this.showNotification(msg.message, 'error');
      }
    });

    this.ws.on('redo', (msg)=>{
      console.log('received redo:', JSON.stringify(msg));
      if (msg.success && msg.op) {
        // Add back the operation
        this.ops.push(msg.op);
        // Sort operations by timestamp to maintain order
        this.ops.sort((a, b) => a.timestamp - b.timestamp);
        // Full redraw
        this.redraw();
        this.updateUndoRedoState(msg);
        
        // Show user-specific message
        const isOwnAction = msg.userId === this.ws.userId;
        this.showNotification(
          isOwnAction ? 'Action redone' : `${msg.userId.slice(0,4)} redid their action`,
          'info'
        );
        
        console.log('Operations after redo:', this.ops.length, this.ops);
      } else {
        console.warn('Redo failed:', msg.message);
        this.showNotification(msg.message, 'error');
      }
    });

    this.ws.on('clear', (msg)=>{
      console.log('received clear:', JSON.stringify(msg));
      if (msg.success) {
        // Clear local operations
        this.ops = [];
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Show user-specific message
        const isOwnAction = msg.userId === this.ws.userId;
        this.showNotification(
          isOwnAction ? 'Canvas cleared' : `${msg.userId.slice(0,4)} cleared the canvas`,
          'info'
        );
      }
    });

    this.ws.on('state-update', (msg)=>{
      this.updateUndoRedoState(msg);
    });

    // Add keyboard shortcuts for undo/redo
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) { // Ctrl/Cmd key
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.ws.send({ type: 'undo' });
        } else if ((e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          this.ws.send({ type: 'redo' });
        }
      }
    });
  };

  CanvasApp.prototype.updateUsers = function(){
    // simplistic: show count
    // improved: server could send list; for now just show placeholder
    document.getElementById('users').textContent = 'Users: (multiple)';
  };

  CanvasApp.prototype._start = function(e){
    this.drawing = true;
    this.path = [];
    const p = this._pos(e);
    this.path.push(p);
    this.lastSent = Date.now();
  };

  CanvasApp.prototype._move = function(e){
    const p = this._pos(e);
    // send cursor always
    this.ws.send({ type: 'cursor', x: p.x, y: p.y });
    if (!this.drawing) return;
    this.path.push(p);
    // draw incremental
    this.drawPathSegment(this.path, this.color, this.size, this.tool);
    // throttle sending path data to server
    const now = Date.now();
    if (now - (this.lastSent||0) > 50){
      this.flushPath(false);
      this.lastSent = now;
    }
  };

  CanvasApp.prototype._end = function(e){
    if (!this.drawing) return;
    this.drawing = false;
    this.flushPath(true);
  };

  CanvasApp.prototype._pos = function(e){
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  CanvasApp.prototype.flushPath = function(final){
    if (this.path.length < 2) return;
    
    // Validate and clean path data
    const cleanPath = this.path.filter(p => 
      typeof p === 'object' && 
      typeof p.x === 'number' && 
      typeof p.y === 'number' && 
      !isNaN(p.x) && 
      !isNaN(p.y)
    );
    
    if (cleanPath.length < 2) {
      console.warn('Not enough valid points in path');
      return;
    }
    
    const op = { 
      path: cleanPath, 
      color: this.color, 
      width: this.size, 
      mode: this.tool,
      userId: this.ws.userId
    };
    
    console.log('sending draw op:', JSON.stringify(op));
    // optimistic local op add (server will assign opId)
    this.ops.push(Object.assign({ opId: 'pending-' + Date.now() }, op));
    this.ws.send({ type: 'draw', op });
    if (final) this.path = [];
  };

  CanvasApp.prototype.drawPathSegment = function(path, color, width, mode){
    if (!path || !Array.isArray(path) || path.length < 2) {
      console.warn('Invalid path data:', path);
      return;
    }
    
    const ctx = this.ctx;
    ctx.save();
    if (mode === 'eraser'){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color || '#000';
    }
    ctx.lineWidth = width || 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++){
      const p = path[i];
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        ctx.lineTo(p.x, p.y);
      } else {
        console.warn('Invalid point:', p);
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  CanvasApp.prototype.drawOp = function(op){
    this.drawPathSegment(op.path, op.color, op.width, op.mode);
  };

  CanvasApp.prototype.redraw = function(){
    const ctx = this.ctx;
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    for (const op of this.ops){
      this.drawOp(op);
    }
  };

  CanvasApp.prototype.showNotification = function(message, type = 'info') {
    const notifications = document.getElementById('notifications');
    if (notifications) {
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.textContent = message;
      notifications.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
    }
  };

  CanvasApp.prototype.showCursor = function(userId, x, y){
    if (userId === this.ws.userId) return; // Don't show own cursor
    
    if (!this.remoteCursors[userId]){
      const el = document.createElement('div');
      el.className = 'cursor';
      el.style.background = this.ws.userColors[userId] || '#ff5722';
      el.setAttribute('data-user', `User ${userId.slice(0,4)}`);
      this.cursors.appendChild(el);
      this.remoteCursors[userId] = el;
    }
    
    const el = this.remoteCursors[userId];
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    // Update the cursor color if needed
    if (this.ws.userColors[userId]) {
      el.style.background = this.ws.userColors[userId];
    }
  };

  CanvasApp.prototype.updateUndoRedoState = function(state) {
    // Enable/disable undo/redo buttons based on state
    const undoBtn = document.getElementById('undo');
    const redoBtn = document.getElementById('redo');
    
    if (undoBtn) {
      undoBtn.disabled = !state.canUndo;
      undoBtn.classList.toggle('disabled', !state.canUndo);
      undoBtn.title = state.canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo';
    }
    
    if (redoBtn) {
      redoBtn.disabled = !state.canRedo;
      redoBtn.classList.toggle('disabled', !state.canRedo);
      redoBtn.title = state.canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo';
    }

    // Show notification for undo/redo status
    if (state.message) {
      const notifications = document.getElementById('notifications');
      if (notifications) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = state.message;
        notifications.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
      }
    }
  };

  global.CanvasApp = CanvasApp;
})(window);
