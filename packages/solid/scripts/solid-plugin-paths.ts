export const SOLID_SERVER_RUNTIME_FILTER = /[\\/]node_modules[\\/]solid-js[\\/]dist[\\/]server\.js$/

export const SOLID_STORE_SERVER_RUNTIME_FILTER = /[\\/]node_modules[\\/]solid-js[\\/]store[\\/]dist[\\/]server\.js$/

export const rewriteSolidServerRuntimePath = (path: string): string => path.replace("server.js", "solid.js")

export const rewriteSolidStoreServerRuntimePath = (path: string): string => path.replace("server.js", "store.js")
