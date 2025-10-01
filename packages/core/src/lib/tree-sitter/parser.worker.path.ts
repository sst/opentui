// Resolves to the parser.worker.js file relative to this module
// When bundled, both parser.worker.path.js and parser.worker.js are in dist/
const workerPath = new URL("./parser.worker.js", import.meta.url).href

export default workerPath
