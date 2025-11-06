// Delete when fixed

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

export const App = () => {
  return (
    <>
      {/* This does not work as expected. The text should wrap at the box width but overflows when using flex. */}
      <box width="50%" alignItems="flex-start" border>
        <text wrapMode="word">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
          magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
          consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id
          est laborum.
        </text>
      </box>

      {/* This does work as expected. */}
      <box width="50%" border>
        <text wrapMode="word">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
          magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
          consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id
          est laborum.
        </text>
      </box>
    </>
  )
}

const renderer = await createCliRenderer()
renderer.console.show()
createRoot(renderer).render(<App />)
