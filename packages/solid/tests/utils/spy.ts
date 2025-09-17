export function createSpy() {
  const calls: any[][] = []
  const spy = (...args: any[]) => {
    calls.push(args)
  }
  spy.calls = calls
  spy.callCount = () => calls.length
  spy.calledWith = (...expected: any[]) => {
    return calls.some((call) => JSON.stringify(call) === JSON.stringify(expected))
  }
  spy.reset = () => (calls.length = 0)
  return spy
}
