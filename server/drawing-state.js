// Simple operational history for drawing operations
// Each operation is a stroke: { opId, userId, path: [{x,y}], color, width, mode }

// Drawing state management with improved undo/redo handling
class DrawingState {
  constructor() {
    this.ops = []; // Applied operations in order
    this.undoStack = []; // Global undo stack
    this.nextOpId = 1;
    this.userOperations = new Map(); // Track each user's operations
  }

  addOperation(input) {
    const op = {
      ...input.op,
      userId: input.userId,
      opId: this.nextOpId++,
      timestamp: Date.now(),
      type: 'draw'
    };
    
    // Add to global operations list
    this.ops.push(op);
    
    // Track operation by user
    if (!this.userOperations.has(input.userId)) {
      this.userOperations.set(input.userId, []);
    }
    this.userOperations.get(input.userId).push(op.opId);
    
    // Send current state with updated undo/redo capability
    const canUndo = this.userOperations.get(input.userId).length > 0;
    const canRedo = this.undoStack.filter(op => op.userId === input.userId).length > 0;

    console.log(`Added operation ${op.opId} for user ${input.userId}`);
    return op;
  }

  getSnapshot(userId) {
    const userOps = this.userOperations.get(userId) || [];
    const userUndoOps = this.undoStack.filter(op => op.userId === userId);
    
    return { 
      ops: this.ops.slice(),
      canUndo: userOps.length > 0,
      canRedo: userUndoOps.length > 0
    };
  }

  getUserLastOp(userId) {
    const userOps = this.userOperations.get(userId) || [];
    const lastOpId = userOps[userOps.length - 1];
    return this.ops.find(op => op.opId === lastOpId);
  }

  undo(requestingUserId) {
    // Find the user's last operation
    const lastOp = this.getUserLastOp(requestingUserId);

    if (!lastOp) {
      console.log(`No operations to undo for user ${requestingUserId}`);
      return { 
        success: false, 
        message: 'Nothing to undo',
        canUndo: false,
        canRedo: this.undoStack.length > 0
      };
    }

    // Remove operation from global list
    const opIndex = this.ops.findIndex(op => op.opId === lastOp.opId);
    if (opIndex === -1) {
      return { success: false, message: 'Operation not found' };
    }

    // Remove from ops array and add to undo stack
    const op = this.ops.splice(opIndex, 1)[0];
    this.undoStack.push(op);

    // Update user operations tracking
    const userOps = this.userOperations.get(requestingUserId);
    userOps.pop();

    console.log(`Undid operation ${op.opId} for user ${requestingUserId}`);
    return {
      success: true,
      op,
      canUndo: this.userOperations.get(requestingUserId)?.length > 0,
      canRedo: true,
      message: 'Operation undone'
    };
  }

  operationsOverlap(op1, op2) {
    // Check if operations overlap in space
    // This is a simple bounding box check
    if (!op1.path || !op2.path || op1.path.length < 2 || op2.path.length < 2) {
      return false;
    }
    
    // Calculate bounding boxes
    const box1 = this.getPathBoundingBox(op1.path);
    const box2 = this.getPathBoundingBox(op2.path);
    
    // Check for overlap with padding based on stroke width
    const padding = Math.max(op1.width || 4, op2.width || 4);
    return !(
      box1.maxX + padding < box2.minX ||
      box2.maxX + padding < box1.minX ||
      box1.maxY + padding < box2.minY ||
      box2.maxY + padding < box1.minY
    );
  }

  getPathBoundingBox(path) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const point of path) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    
    return { minX, maxX, minY, maxY };
  }

  redo(requestingUserId) {
    // Check if there are any operations to redo
    if (this.undoStack.length === 0) {
      console.log(`No operations to redo for user ${requestingUserId}`);
      return { 
        success: false, 
        message: 'Nothing to redo',
        canUndo: this.userOperations.get(requestingUserId)?.length > 0,
        canRedo: false
      };
    }

    // Find the latest undo operation from the requesting user
    let opIndex = this.undoStack.length - 1;
    let op = null;
    
    while (opIndex >= 0) {
      if (this.undoStack[opIndex].userId === requestingUserId) {
        op = this.undoStack[opIndex];
        break;
      }
      opIndex--;
    }
    
    // If no operation found for this user
    if (!op) {
      return { 
        success: false, 
        message: 'No operations to redo',
        canUndo: this.userOperations.get(requestingUserId)?.length > 0,
        canRedo: false
      };
    }
    
    // Check if there are newer operations that would conflict
    const latestOpTimestamp = this.ops.length > 0 ? this.ops[this.ops.length - 1].timestamp : 0;
    if (op.timestamp < latestOpTimestamp) {
      const hasNewerOps = this.ops.some(existingOp => 
        existingOp.timestamp > op.timestamp && 
        this.operationsOverlap(existingOp, op)
      );
      
      if (hasNewerOps) {
        return {
          success: false,
          message: 'Cannot redo due to newer overlapping operations',
          canUndo: this.userOperations.get(requestingUserId)?.length > 0,
          canRedo: false
        };
      }
    }

    // Remove from undo stack
    this.undoStack.pop();
    
    // Find correct position to reinsert (maintain chronological order)
    let insertIndex = this.ops.length;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (this.ops[i].timestamp <= op.timestamp) {
        insertIndex = i + 1;
        break;
      }
    }

    // Reinsert the operation
    this.ops.splice(insertIndex, 0, op);
    
    // Update user operations tracking
    if (!this.userOperations.has(requestingUserId)) {
      this.userOperations.set(requestingUserId, []);
    }
    this.userOperations.get(requestingUserId).push(op.opId);

    console.log(`Redid operation ${op.opId} for user ${requestingUserId}`);
    return {
      success: true,
      op,
      canUndo: true,
      canRedo: this.undoStack.length > 0,
      message: 'Operation redone'
    };
  }
}

module.exports = DrawingState;
