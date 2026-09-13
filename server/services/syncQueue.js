// server/services/syncQueue.js
/**
 * SyncQueue – persists failed/offline operations and retries them automatically.
 *
 * Usage (in any route file):
 *   const syncQueue = require('../services/syncQueue');
 *   syncQueue.enqueue({ type: 'CREATE_REPORT', payload: { ... } });
 *
 * The queue is stored in-memory during runtime.  For production use, swap
 * the in-memory array for a persistent store (Redis, DB table, etc.).
 */

const pool = require('../db');

class SyncQueue {
  constructor() {
    /** @type {Array<{id:string, type:string, payload:any, attempts:number, createdAt:Date}>} */
    this._queue = [];
    this._processing = false;
    this._retryInterval = null;

    // Kick off a retry sweep every 30 seconds
    this._retryInterval = setInterval(() => this._flush(), 30_000);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Add an operation to the queue.
   * @param {{ type: string, payload: object }} item
   */
  enqueue(item) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: item.type,
      payload: item.payload,
      attempts: 0,
      createdAt: new Date(),
    };
    this._queue.push(entry);
    console.log(`[SyncQueue] Enqueued "${entry.type}" (id=${entry.id}). Queue size: ${this._queue.length}`);

    // Attempt immediately (non-blocking)
    this._flush().catch(() => {});
    return entry.id;
  }

  /** Current queue snapshot (read-only) */
  get snapshot() {
    return this._queue.map(e => ({ ...e }));
  }

  /** How many items are still pending */
  get size() {
    return this._queue.length;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async _flush() {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    console.log(`[SyncQueue] Flushing ${this._queue.length} item(s)…`);

    const remaining = [];
    for (const entry of this._queue) {
      const success = await this._process(entry);
      if (!success) remaining.push(entry);
    }

    this._queue.length = 0;
    this._queue.push(...remaining);
    this._processing = false;

    if (remaining.length > 0) {
      console.log(`[SyncQueue] ${remaining.length} item(s) still pending – will retry in 30 s`);
    } else {
      console.log('[SyncQueue] All items processed ✅');
    }
  }

  /**
   * Attempt to execute a single queued item.
   * Returns true if it succeeded (should be removed), false to keep it.
   */
  async _process(entry) {
    entry.attempts += 1;
    const MAX_ATTEMPTS = 5;

    if (entry.attempts > MAX_ATTEMPTS) {
      console.error(`[SyncQueue] Dropping "${entry.type}" (id=${entry.id}) after ${MAX_ATTEMPTS} attempts`);
      return true; // remove from queue — give up
    }

    try {
      await this._execute(entry);
      console.log(`[SyncQueue] ✅ Completed "${entry.type}" (id=${entry.id})`);
      return true;
    } catch (err) {
      console.warn(
        `[SyncQueue] ⚠️  Failed "${entry.type}" (id=${entry.id}), attempt ${entry.attempts}/${MAX_ATTEMPTS}: ${err.message}`
      );
      return false;
    }
  }

  /**
   * Route each item to its handler.
   * Add new types here as the app grows.
   */
  async _execute(entry) {
    switch (entry.type) {

      // ── Retry a failed report creation ──────────────────────────────────
      case 'CREATE_REPORT': {
        const { title, description, category, location, userId, latitude, longitude } = entry.payload;

        // Pick a random responder
        const respRes = await pool.query(
          "SELECT id FROM users WHERE role='responder' ORDER BY random() LIMIT 1"
        );
        const assignedTo = respRes.rows[0]?.id ?? null;
        const status     = assignedTo ? 'assigned' : 'pending';

        await pool.query(
          `INSERT INTO reports (title, description, category, location, user_id, latitude, longitude, assigned_to, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [title, description, category, location, userId, latitude, longitude, assignedTo, status]
        );
        break;
      }

      // ── Retry a failed status update ────────────────────────────────────
      case 'UPDATE_REPORT_STATUS': {
        const { reportId, status, updatedBy } = entry.payload;
        await pool.query(
          `UPDATE reports SET status=$1, assigned_to=$2, updated_at=NOW() WHERE id=$3`,
          [status, updatedBy, reportId]
        );
        break;
      }

      // ── Retry a failed response post ────────────────────────────────────
      case 'POST_RESPONSE': {
        const { reportId, userId, message } = entry.payload;
        await pool.query(
          `INSERT INTO report_responses (report_id, user_id, message) VALUES ($1,$2,$3)`,
          [reportId, userId, message]
        );
        break;
      }

      default:
        console.warn(`[SyncQueue] Unknown type "${entry.type}" – skipping`);
    }
  }

  /** Clean up the retry interval (call on server shutdown) */
  destroy() {
    clearInterval(this._retryInterval);
  }
}

// Export a singleton so all modules share the same queue
module.exports = new SyncQueue();
