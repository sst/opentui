export const log = (...args: any[]) => {
  if (process.env.DEBUG) {
    console.log("[Reconciler]", ...args)
  }
}
