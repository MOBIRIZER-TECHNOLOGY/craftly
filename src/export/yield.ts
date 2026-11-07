/**
 * Hands the thread back to the browser so it can paint and handle input between heavy steps.
 *
 * A MessageChannel round trip is used instead of `setTimeout(0)`: it is a real macrotask but, unlike timers, it is
 * not throttled to once a second when the tab is in the background - a long export keeps running at full speed if
 * the user switches tabs while it works.
 */
export function nextMacrotask(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(0);
  });
}
