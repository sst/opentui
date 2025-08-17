import { Box, Group, render, Text } from "../"

export const App = () => {
  return (
    <>
      <Group flexDirection="row">
        <Box borderStyle="single">
          <Text content="Single" />
        </Box>
        <Box borderStyle="double">
          <Text content="Double" />
        </Box>
        <Box borderStyle="rounded">
          <Text content="Rounded" />
        </Box>
        <Box borderStyle="heavy">
          <Text content="Heavy" />
        </Box>
      </Group>
    </>
  )
}

render(<App />)
