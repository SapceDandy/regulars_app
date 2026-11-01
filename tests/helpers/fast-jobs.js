// Keep the real local-server job callback and shutdown path, shorten only the test clock.
const interval=globalThis.setInterval;
globalThis.setInterval=(fn,ms,...args)=>interval(fn,Math.min(ms,25),...args);
