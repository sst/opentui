import { test, expect } from "bun:test"

test("components that wrap opentui react components support React key prop", () => {
  const Double = ({ children }: { children: number }) => <text>{children * 2}</text>

  const numbers = [1, 2, 3]

  expect(() => (
    <box>
      {numbers.map((number) => (
        <Double key={number}>{1}</Double>
      ))}
    </box>
  )).not.toThrow()
})
