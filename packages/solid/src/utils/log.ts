export const log = (...args: any[]) => {
  if (process.env.DEBUG === "true" || process.env.DEBUG === "1" || process.env.DEBUG) {
    console.log("[Reconciler]", ...args)
  }
}
