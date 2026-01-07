<script setup lang="ts">
import { bold, fg, italic, t, TextAttributes, type KeyEvent } from "@opentui/core"
import { ref, computed } from "vue"
import { useKeyboard } from "@opentui/vue"

const username = ref("")
const password = ref("")
const focused = ref<"username" | "password">("username")
const status = ref<"idle" | "invalid" | "success">("idle")

useKeyboard((key: KeyEvent) => {
  if (key.name === "tab") {
    focused.value = focused.value === "username" ? "password" : "username"
  }
})

const handleUsernameChange = (value: string) => {
  username.value = value
}

const handlePasswordChange = (value: string) => {
  password.value = value
}

const handleSubmit = () => {
  if (username.value === "admin" && password.value === "secret") {
    status.value = "success"
  } else {
    status.value = "invalid"
  }
}

const titleTextStyles = {
  fg: "#FFFF00",
  attributes: TextAttributes.BOLD | TextAttributes.ITALIC,
}
const boxStyles = { width: 40, height: 3, marginTop: 1 }
const passwordBoxStyles = { ...boxStyles, marginBottom: 1 }
const inputStyles = { focusedBackgroundColor: "#000000" }

const statusColor = computed(() => {
  switch (status.value) {
    case "idle":
      return "#AAAAAA"
    case "success":
      return "green"
    case "invalid":
      return "red"
    default:
      return "#AAAAAA"
  }
})

const styledText = computed(() => {
  return t`${bold(italic(fg("cyan")(`Styled Text!`)))}`
})
</script>

<template>
  <textRenderable content="OpenTUI with Vue!" :style="titleTextStyles" />
  <textRenderable :content="styledText" />
  <boxRenderable title="Username" :style="boxStyles">
    <inputRenderable
      placeholder="Enter your username..."
      :onInput="handleUsernameChange"
      :onSubmit="handleSubmit"
      :focused="focused === 'username'"
      :style="inputStyles"
    />
  </boxRenderable>
  <boxRenderable title="Password" :style="passwordBoxStyles">
    <inputRenderable
      placeholder="Enter your password..."
      :onInput="handlePasswordChange"
      :onSubmit="handleSubmit"
      :focused="focused === 'password'"
      :style="inputStyles"
    />
  </boxRenderable>
  <textRenderable :content="status.toUpperCase()" :style="{ fg: statusColor }" />
</template>
