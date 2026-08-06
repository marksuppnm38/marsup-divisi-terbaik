"use strict";

const { RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS } = require("../config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` and retries on failure with exponential backoff.
 * `label` is only used for the warning message printed on each retry.
 */
async function withRetry(fn, label = "task") {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `  ! ${label} failed (attempt ${attempt}/${RETRY_ATTEMPTS}): ${err.message}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }
  }
  throw new Error(`${label} failed after ${RETRY_ATTEMPTS} attempts: ${lastError.message}`);
}

module.exports = { withRetry, sleep };
