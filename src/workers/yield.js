/**
 * Cooperative yield for compute workers.
 *
 * The coverage/recommend sweeps are long synchronous loops; without yielding,
 * a worker can't process an incoming message until the current loop finishes.
 * That means a superseded job (a newer 'compute', or a 'cancel' from clear())
 * runs to completion and competes for CPU with the job the user actually wants.
 *
 * Awaiting a microtask (Promise.resolve()) does NOT help — the microtask queue
 * drains before the next macrotask, so a queued postMessage is still not
 * delivered. A MessageChannel round-trip is a macrotask, so awaiting one lets
 * the event loop deliver pending messages, and it avoids setTimeout's nested-
 * timer 4 ms clamp — the per-chunk cost stays sub-millisecond.
 */
export function createYielder() {
  const channel = new MessageChannel();
  // FIFO of resolvers: MessageChannel delivers one message per post in order,
  // so when two jobs briefly overlap (a newer 'compute' arriving while the old
  // sweep is parked at a yield) each pending yield is still resolved exactly
  // once — no resolver is dropped and no async frame is left stuck.
  const queue = [];
  channel.port1.onmessage = () => {
    const resolve = queue.shift();
    if (resolve) resolve();
  };
  return function yieldToEventLoop() {
    return new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(0);
    });
  };
}
