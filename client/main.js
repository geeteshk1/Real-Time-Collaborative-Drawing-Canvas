(function(){
  const ws = new WSClient();
  
  // Use current window location for WebSocket
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname === 'localhost' ? 'localhost:3000' : location.host;
  const wsUrl = `${wsProtocol}//${host}/ws`;
  
  // Add retry logic for connection
  const connectWithRetry = (url, maxAttempts = 5) => {
    let attempts = 0;
    const tryConnect = () => {
      if (attempts >= maxAttempts) {
        showError('Could not connect to server. Please refresh the page.');
        return;
      }
      attempts++;
      try {
        ws.connect(url);
      } catch (err) {
        console.error('Failed to connect:', err.message);
        setTimeout(tryConnect, Math.min(1000 * Math.pow(2, attempts), 10000));
      }
    };
    tryConnect();
  };

  // Add notification display function
  function showNotification(message, type = 'info') {
    const notifications = document.getElementById('notifications');
    if (notifications) {
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.textContent = message;
      notifications.appendChild(notification);
      
      // Remove old notifications if there are too many
      while (notifications.children.length > 3) {
        notifications.removeChild(notifications.firstChild);
      }
      
      setTimeout(() => {
        notification.style.animation = 'fade-out 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
      }, 3000);
    }
  }
  
  // Shorthand for error notifications
  function showError(message) {
    showNotification(message, 'error');
  }
  
  connectWithRetry(wsUrl);

  // Handle connection events
  ws.on('connected', (msg)=>{ 
    showNotification('Connected successfully', 'success');
    const roomSelect = document.getElementById('room');
    const selectedRoom = roomSelect ? roomSelect.value : 'default';
    ws.send({ type: 'join-room', roomId: selectedRoom });
  });
  
  ws.on('room-joined', (msg)=>{ 
    showNotification(`Joined ${msg.roomId} room`, 'success');
    document.getElementById('room').value = msg.roomId;
  });

  ws.on('users-updated', (msg)=>{
    ws.updateUsers(msg.users);
  });

  ws.on('pong', (msg)=>{
    const latency = Date.now() - ws.lastPing;
    ws.updateLatency(latency);
  });

  const canvasEl = document.getElementById('canvas');
  const cursorsEl = document.getElementById('cursors');
  const app = new CanvasApp(canvasEl, cursorsEl, ws);

  // Room selection
  document.getElementById('room').addEventListener('change', (e)=>{
    const roomId = e.target.value;
    ws.send({ type: 'join-room', roomId });
  });

  // Toolbar bindings with feedback
  document.getElementById('tool').addEventListener('change', (e)=>{ 
    app.tool = e.target.value; 
    showNotification(`Tool changed to ${e.target.value}`, 'info');
  });
  
  document.getElementById('color').addEventListener('change', (e)=>{ 
    app.color = e.target.value; 
  });
  
  document.getElementById('size').addEventListener('input', (e)=>{ 
    app.size = Number(e.target.value); 
    e.target.nextElementSibling.value = e.target.value + 'px';
  });
  
  document.getElementById('undo').addEventListener('click', ()=>{ 
    const button = document.getElementById('undo');
    if (!button.disabled) {
      ws.send({ type: 'undo' }); 
      button.classList.add('active');
      setTimeout(() => button.classList.remove('active'), 200);
    }
  });
  
  document.getElementById('redo').addEventListener('click', ()=>{ 
    const button = document.getElementById('redo');
    if (!button.disabled) {
      ws.send({ type: 'redo' }); 
      button.classList.add('active');
      setTimeout(() => button.classList.remove('active'), 200);
    }
  });
  
  document.getElementById('clear').addEventListener('click', ()=>{ 
    if (confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
      ws.send({ type: 'clear' });
    }
  });

  // Record frame for FPS counting
  function animate() {
    ws.recordFrame();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

})();
