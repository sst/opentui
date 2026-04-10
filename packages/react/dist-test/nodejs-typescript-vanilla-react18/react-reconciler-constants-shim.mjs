// ESM re-export of react-reconciler/constants for React 18's CJS build,
// which Node.js cannot statically analyze for named exports.
// Also polyfills NoEventPriority (added in react-reconciler 0.32 / React 19).
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const constants = require("react-reconciler/constants")
export const {
  ConcurrentRoot,
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  IdleEventPriority,
  LegacyRoot,
} = constants
// NoEventPriority was added in react-reconciler 0.32; in 0.29 it's 0.
export const NoEventPriority = constants.NoEventPriority ?? 0
