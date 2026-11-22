// Runs one headless job for the UI in a Web Worker when the browser has them,
// else on the main thread. Protocol, worker → page:
//   { type: "progress", p } … then { type: "done", result } | { type: "error", error }

/**
 * runInWorker({ make, message, local, onProgress, timeoutMs }) → Promise<result>
 *  make: () => Worker; message: what it is sent; local: the same job on this
 *  thread (no workers, or the worker never started).
 *  timeoutMs: stop a worker that runs longer (0 = no limit).
 */
export function runInWorker({ make, message, local, onProgress = () => {}, timeoutMs = 0 }) {
  if (typeof Worker === "undefined") return local();
  let worker;
  try {
    worker = make();
  } catch {
    return local();
  }
  return new Promise((resolve, reject) => {
    let heard = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            worker.terminate();
            reject(new Error(`the run took longer than ${Math.round(timeoutMs / 1000)} s and was stopped`));
          }, timeoutMs)
        : null;
    worker.onmessage = (e) => {
      heard = true;
      const msg = e.data || {};
      if (msg.type === "progress") onProgress(msg.p);
      else {
        clearTimeout(timer);
        worker.terminate();
        if (msg.type === "done") resolve(msg.result);
        else reject(new Error(msg.error || "the worker failed"));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      // The worker never started (e.g. blocked): fall back to the main thread.
      if (!heard) local().then(resolve, reject);
      else reject(new Error(e.message || "the worker failed"));
    };
    worker.postMessage(message);
  });
}
