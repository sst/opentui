import { Box, Input, Text, useRenderer } from "@opentui/solid";
import { createSignal, onMount } from "solid-js";

const InputScene = () => {
  const renderer = useRenderer();
  onMount(() => {
    renderer.setBackgroundColor("#001122");
  });

  const [nameValue, setNameValue] = createSignal("");

  return (
    <Box height={4}>
      <Text>Name: {nameValue()}</Text>
      <Input focused onChange={(value) => setNameValue(value)} />
    </Box>
  );
};

export default InputScene;
