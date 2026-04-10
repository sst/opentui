export const Worker = (globalThis.Worker ?? (await import("./nodejs/Worker.js")).Worker) as typeof globalThis.Worker
