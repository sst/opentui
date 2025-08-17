import { Box, Group, render, Text } from "../"

export const App = () => {
  return (
    <>
      <Group flexDirection="column">
        <Text attributes={1} content="Box Examples" />
        <Box>
          <Text content="1. Standard Box" />
        </Box>
        <Box title="Title">
          <Text content="2. Box with Title" />
        </Box>
        <Box backgroundColor="blue">
          <Text content="3. Box with Background Color" />
        </Box>
        <Box padding={1}>
          <Text content="4. Box with Padding" />
        </Box>
        <Box margin={1}>
          <Text content="5. Box with Margin" />
        </Box>
        <Box alignItems="center">
          <Text content="6. Centered Text" />
        </Box>
        <Box justifyContent="center" height={5}>
          <Text content="7. Justified Center" />
        </Box>
        <Box title="Nested Boxes" backgroundColor="red">
          <Box backgroundColor="blue">
            <Text content="8. Nested Box" />
          </Box>
        </Box>
      </Group>
    </>
  )
}

render(<App />)
