"use strict";

/**
 * Runs `worker(item, index)` over `items` with at most `concurrency` running
 * at once. Errors from individual workers are caught internally by the
 * worker itself (this pool doesn't swallow unexpected throws — it just
 * won't stop the whole batch because of one bad item, as long as the
 * worker handles its own errors).
 */
async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

module.exports = { runPool };
