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
termctrl send "${SESSION_NAME}" down down down down down down down ctrl-e
sleep 2
for _ in $(seq 1 13); do termctrl send "${SESSION_NAME}" left; done
mark string-edit-start
termctrl send "${SESSION_NAME}" text:Open
sleep 1
termctrl send "${SESSION_NAME}" text:TUI
sleep 1
termctrl send "${SESSION_NAME}" text:" incremental"
sleep 2
mark string-expanded

# Split inside the string, delete the whole temporary line in one edit, and rejoin it.
termctrl send "${SESSION_NAME}" enter
sleep 2
termctrl send "${SESSION_NAME}" text:split
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
termctrl send "${SESSION_NAME}" up ctrl-a text:async
sleep 1
termctrl send "${SESSION_NAME}" text:" "
sleep 3
mark keyword-adjacent-edit
termctrl send "${SESSION_NAME}" down ctrl-e text:" // partial"
termctrl wait "${SESSION_NAME}" "parse=incremental | query=partial" --timeout 15000
sleep 4
mark incremental-partial
termctrl send "${SESSION_NAME}" ctrl-a
sleep 1
termctrl show "${SESSION_NAME}"
