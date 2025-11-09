# Architecture

## Data flow

- Client captures pointer events and batches path points into "ops".
- Client sends "draw" op to server; server assigns opId and broadcasts to all clients.
- Clients apply ops immediately (optimistic) and reconcile when server op arrives.

## WebSocket protocol

- connected: { type: 'connected', userId }
- join-room: { type: 'join-room', roomId }
- room-joined: { type: 'room-joined', roomId, state }
- draw: { type: 'draw', op }
- op: { type: 'op', op }
- cursor: { type: 'cursor', userId, x, y }
- undo: { type: 'undo' }
- redo: { type: 'redo' }

## Undo/Redo strategy

- Server keeps linear operation history (array of ops) and an undo stack.
- Undo removes the last op globally; redo re-applies the last undone op.
- This is simple and deterministic but may be surprising (undo affects others).

## Performance decisions

- Client throttles path sending (~50ms) to batch multiple points.
- Canvas redraw is full-screen on resize and for undo/redo; incremental draw for incoming ops.
- No compression applied to ops; could be added by path simplification or delta-encoding.

## Conflict resolution

- Operations are applied in the order server receives them. Last-writer wins for overlapping pixels.
- For global undo, we simply remove last op that was applied. A CRDT-based approach would be better for production.
