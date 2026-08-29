console.error(`fault_consumer_pid=${process.pid}`)
if (process.env.GPU_SHARING_FAULT === "exit") process.exit(23)
await Bun.sleep(10_000)
throw new Error("The producer failed to kill its stalled consumer")
