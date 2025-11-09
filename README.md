# Collaborative Canvas

A minimal real-time collaborative drawing canvas using vanilla JavaScript and Node.js WebSockets.

## Quick start

1. Install dependencies

```powershell
npm install
```

2. Start the server

```powershell
npm start
```

3. Open http://localhost:3000 in multiple browser tabs to test collaboration.

## What is included

- Server: Express static server + WebSocket server (ws)
- Client: Vanilla JS drawing canvas, toolbar, cursor sync
- Basic global undo/redo implemented on server-side (last-op undo)

## Known limitations

- Undo is global and removes the last operation regardless of author.
- No authentication; user colors are not per-user assigned.
- No persistence; everything is in-memory.

## Time spent

~1.5 hours (scaffold + basic implementation)
