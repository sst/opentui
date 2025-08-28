package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// TerminalInput handles raw terminal input using external stty command
type TerminalInput struct {
	stdin  *os.File
	reader *bufio.Reader
}

// NewTerminalInput creates a new terminal input handler
func NewTerminalInput() (*TerminalInput, error) {
	stdin := os.Stdin
	
	// Try to set raw mode using stty
	err := SetTerminalRaw()
	if err != nil {
		return nil, fmt.Errorf("failed to set terminal to raw mode: %v", err)
	}
	
	return &TerminalInput{
		stdin:  stdin,
		reader: bufio.NewReader(stdin),
	}, nil
}

// Close restores the terminal to its original state
func (t *TerminalInput) Close() error {
	return RestoreTerminal()
}

// InputEvent represents different types of input events
type InputEvent struct {
	Type   string // "key", "mouse_move", "mouse_click", "mouse_release"
	Key    rune
	MouseX uint32
	MouseY uint32
	Button int
}

// ReadInput reads input events from the terminal
func (t *TerminalInput) ReadInput() (*InputEvent, error) {
	b, err := t.reader.ReadByte()
	if err != nil {
		return nil, err
	}
	
	// Handle escape sequences
	if b == 27 { // ESC
		// Check if there's more data
		next, err := t.reader.ReadByte()
		if err != nil {
			// Just ESC key
			return &InputEvent{Type: "key", Key: 27}, nil
		}
		
		if next == '[' {
			// ANSI escape sequence
			return t.parseAnsiSequence()
		} else {
			// Put back the byte and return ESC
			// Note: This is simplified - proper implementation would use unread
			return &InputEvent{Type: "key", Key: 27}, nil
		}
	}
	
	// Regular key
	return &InputEvent{Type: "key", Key: rune(b)}, nil
}

// parseAnsiSequence parses ANSI escape sequences for mouse events
func (t *TerminalInput) parseAnsiSequence() (*InputEvent, error) {
	// Read the sequence
	var seq strings.Builder
	for {
		b, err := t.reader.ReadByte()
		if err != nil {
			return nil, err
		}
		seq.WriteByte(b)
		
		// Mouse sequences typically end with 'M' or 'm'
		if b == 'M' || b == 'm' {
			break
		}
		
		// Other sequences might end with letters
		if b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' {
			break
		}
		
		// Prevent infinite loops
		if seq.Len() > 20 {
			break
		}
	}
	
	sequence := seq.String()
	
	// Parse mouse events (simplified)
	// Real mouse parsing is more complex
	if strings.Contains(sequence, "M") {
		// Mouse click/release
		return &InputEvent{Type: "mouse_click", MouseX: 10, MouseY: 10, Button: 1}, nil
	}
	
	// Default to unknown key sequence
	return &InputEvent{Type: "key", Key: 0}, nil
}

// KeyboardOnlyInput provides a simpler keyboard-only input for the demo
type KeyboardOnlyInput struct {
	input *TerminalInput
}

// NewKeyboardOnlyInput creates a keyboard-only input handler
func NewKeyboardOnlyInput() (*KeyboardOnlyInput, error) {
	input, err := NewTerminalInput()
	if err != nil {
		return nil, err
	}
	
	return &KeyboardOnlyInput{input: input}, nil
}

// Close restores terminal state
func (k *KeyboardOnlyInput) Close() error {
	return k.input.Close()
}

// ReadKey reads a single key press
func (k *KeyboardOnlyInput) ReadKey() (rune, error) {
	event, err := k.input.ReadInput()
	if err != nil {
		return 0, err
	}
	
	if event.Type == "key" {
		return event.Key, nil
	}
	
	// Non-key events, try again
	return k.ReadKey()
}

// SimpleInput provides a cross-platform simple input solution
type SimpleInput struct {
	reader *bufio.Scanner
}

// NewSimpleInput creates a simple line-based input handler
func NewSimpleInput() *SimpleInput {
	return &SimpleInput{
		reader: bufio.NewScanner(os.Stdin),
	}
}

// ReadLine reads a line of input
func (s *SimpleInput) ReadLine() (string, error) {
	if s.reader.Scan() {
		return s.reader.Text(), nil
	}
	return "", s.reader.Err()
}

// SetTerminalRaw attempts to set the terminal to raw mode (Unix only)
func SetTerminalRaw() error {
	cmd := exec.Command("stty", "-echo", "cbreak")
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// RestoreTerminal attempts to restore normal terminal mode (Unix only)  
func RestoreTerminal() error {
	cmd := exec.Command("stty", "echo", "-cbreak")
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// GetTerminalSize gets the terminal dimensions
func GetTerminalSize() (int, int, error) {
	cmd := exec.Command("stty", "size")
	cmd.Stdin = os.Stdin
	out, err := cmd.Output()
	if err != nil {
		return 80, 24, nil // Default fallback
	}
	
	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) != 2 {
		return 80, 24, nil
	}
	
	rows, err1 := strconv.Atoi(parts[0])
	cols, err2 := strconv.Atoi(parts[1])
	
	if err1 != nil || err2 != nil {
		return 80, 24, nil
	}
	
	return cols, rows, nil
}