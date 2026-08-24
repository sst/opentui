#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${1:-native-highlighted-editor}"
RECORDING_PATH="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export TERMCTRL_RUNTIME_DIR="${TERMCTRL_RUNTIME_DIR:-/tmp/opencode/termctrl-native-editor}"
mkdir -p "${TERMCTRL_RUNTIME_DIR}"
chmod 700 "${TERMCTRL_RUNTIME_DIR}"

cleanup() {
  termctrl stop "${SESSION_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mark() {
  if [[ -n "${RECORDING_PATH}" ]]; then
    termctrl mark "${SESSION_NAME}" "$1"
  fi
}

send_kitty_ctrl() {
  printf '\033[%d;5u' "$1" | termctrl send "${SESSION_NAME}" --stdin
}

type_human() {
  local text="$1"
  local index character delay
  local -a cadence=(0.055 0.075 0.065 0.095 0.060 0.080 0.070)
  for ((index = 0; index < ${#text}; index++)); do
    character="${text:index:1}"
    termctrl send "${SESSION_NAME}" "text:${character}"
    delay="${cadence[index % ${#cadence[@]}]}"
    sleep "${delay}"
  done
}

press_human() {
  local key="$1"
  local count="$2"
  local delay="${3:-0.06}"
  local index
  for ((index = 0; index < count; index++)); do
    termctrl send "${SESSION_NAME}" "${key}"
    sleep "${delay}"
  done
}

start_args=(start "${SESSION_NAME}" --host opentui --cols 132 --rows 30)
if [[ -n "${RECORDING_PATH}" ]]; then
  mkdir -p "$(dirname "${RECORDING_PATH}")"
  start_args+=(--record "${RECORDING_PATH}")
fi
start_args+=(-- bun src/native-highlighted-editor-demo.ts)

cd "${PACKAGE_ROOT}"
termctrl "${start_args[@]}"
termctrl wait "${SESSION_NAME}" "Ctrl+T toggles"
sleep 2
mark ready-static

termctrl send "${SESSION_NAME}" ctrl-t
termctrl wait "${SESSION_NAME}" "mode=incremental" --timeout 15000
sleep 3
mark incremental-enabled

# Move from the opening comment into the highlighted string on the const line.
press_human down 7 0.12
termctrl send "${SESSION_NAME}" ctrl-e
sleep 2
press_human left 13 0.07
mark string-edit-start
type_human "OpenTUO"
sleep 0.7
termctrl send "${SESSION_NAME}" backspace
sleep 0.4
type_human "I incremental"
sleep 2
mark string-expanded

# Split inside the string, delete the whole temporary line in one edit, and rejoin it.
termctrl send "${SESSION_NAME}" enter
sleep 2
type_human "split"
sleep 2
termctrl send "${SESSION_NAME}" ctrl-u
sleep 2
termctrl send "${SESSION_NAME}" backspace
sleep 2
mark string-rejoined

# Undo and redo only the newline deletion. Kitty code points 45/46 are Ctrl+-/Ctrl+., the editor's undo/redo keys.
send_kitty_ctrl 45
sleep 2
send_kitty_ctrl 46
sleep 2
mark rejoin-undo-redo

# Edit beside a highlighted keyword, then leave one small local edit as the final response.
termctrl send "${SESSION_NAME}" up ctrl-a
type_human "async "
sleep 3
mark keyword-adjacent-edit
termctrl send "${SESSION_NAME}" down ctrl-e
type_human " // partial"
termctrl wait "${SESSION_NAME}" "parse=incremental | query=partial" --timeout 15000
sleep 4
mark incremental-partial
termctrl send "${SESSION_NAME}" ctrl-a
sleep 1
termctrl show "${SESSION_NAME}"
