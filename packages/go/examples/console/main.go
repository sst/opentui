package main

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/sst/opentui/packages/go"
)

// ConsoleButton represents a clickable button with hover and press states
type ConsoleButton struct {
	ID           string
	X, Y         int32
	Width, Height uint32
	Label        string
	LogType      string
	
	// Colors
	OriginalBg   opentui.RGBA
	HoverBg      opentui.RGBA
	PressBg      opentui.RGBA
	BorderColor  opentui.RGBA
	
	// State
	IsHovered    bool
	IsPressed    bool
	LastClickTime time.Time
	
	// Statistics
	ClickCount   int
}

// NewConsoleButton creates a new console button
func NewConsoleButton(id string, x, y int32, width, height uint32, color opentui.RGBA, label, logType string) *ConsoleButton {
	// Create brighter border color
	borderColor := opentui.NewRGBA(
		min(color.R*1.3, 1.0),
		min(color.G*1.3, 1.0), 
		min(color.B*1.3, 1.0),
		1.0,
	)
	
	// Create hover and press colors
	hoverBg := opentui.NewRGBA(
		min(color.R*1.2, 1.0),
		min(color.G*1.2, 1.0),
		min(color.B*1.2, 1.0),
		color.A,
	)
	
	pressBg := opentui.NewRGBA(
		color.R*0.8,
		color.G*0.8,
		color.B*0.8,
		color.A,
	)
	
	return &ConsoleButton{
		ID:           id,
		X:            x,
		Y:            y,
		Width:        width,
		Height:       height,
		Label:        label,
		LogType:      logType,
		OriginalBg:   color,
		HoverBg:      hoverBg,
		PressBg:      pressBg,
		BorderColor:  borderColor,
		IsHovered:    false,
		IsPressed:    false,
		ClickCount:   0,
	}
}

// Contains checks if a point is within the button bounds
func (b *ConsoleButton) Contains(x, y uint32) bool {
	return x >= uint32(b.X) && x < uint32(b.X)+b.Width &&
		   y >= uint32(b.Y) && y < uint32(b.Y)+b.Height
}

// Render draws the button to the buffer
func (b *ConsoleButton) Render(buffer *opentui.Buffer) error {
	// Choose background color based on state
	var bgColor opentui.RGBA
	if b.IsPressed {
		bgColor = b.PressBg
	} else if b.IsHovered {
		bgColor = b.HoverBg
	} else {
		bgColor = b.OriginalBg
	}
	
	// Draw the button box
	boxOptions := opentui.BoxOptions{
		Sides: opentui.BorderSides{
			Top:    true,
			Right:  true,
			Bottom: true,
			Left:   true,
		},
		Fill:           true,
		Title:          b.Label,
		TitleAlignment: opentui.AlignCenter,
		BorderChars:    opentui.DefaultBoxChars,
	}
	
	err := buffer.DrawBox(b.X, b.Y, b.Width, b.Height, boxOptions, b.BorderColor, bgColor)
	if err != nil {
		return fmt.Errorf("failed to draw button box: %v", err)
	}
	
	// Draw sparkle effect if recently clicked
	timeSinceClick := time.Since(b.LastClickTime)
	if timeSinceClick < 300*time.Millisecond {
		alpha := 1.0 - float32(timeSinceClick.Milliseconds())/300.0
		sparkleColor := opentui.NewRGBA(1, 1, 1, alpha)
		
		centerX := uint32(b.X) + b.Width/2
		centerY := uint32(b.Y) + b.Height/2
		
		// Draw sparkles
		buffer.SetCellWithAlphaBlending(centerX-1, centerY, '✦', sparkleColor, bgColor, 0)
		buffer.SetCellWithAlphaBlending(centerX+1, centerY, '✦', sparkleColor, bgColor, 0)
	}
	
	return nil
}

// Click handles a button click
func (b *ConsoleButton) Click() {
	b.IsPressed = true
	b.LastClickTime = time.Now()
	b.ClickCount++
	b.TriggerConsoleLog()
}

// TriggerConsoleLog simulates console logging based on the button type
func (b *ConsoleButton) TriggerConsoleLog() {
	timestamp := time.Now().Format("15:04:05")
	
	switch b.LogType {
	case "log":
		fmt.Printf("Console Log #%d triggered at %s\n", b.ClickCount, timestamp)
		fmt.Printf("  Data: This is a regular log message\n")
		fmt.Printf("  Count: %d\n", b.ClickCount)
		fmt.Printf("  Metadata: {source: console-demo, type: log}\n\n")
		
	case "info":
		log.Printf("INFO: Info Log #%d triggered at %s", b.ClickCount, timestamp)
		log.Printf("INFO:   Message: This is an informational message")
		log.Printf("INFO:   Details: Info messages are used for general information")
		log.Printf("INFO:   Count: %d\n", b.ClickCount)
		
	case "warn":
		log.Printf("WARN: Warning Log #%d triggered at %s", b.ClickCount, timestamp)
		log.Printf("WARN:   Warning: This is a warning message")
		log.Printf("WARN:   Reason: Something might need attention")
		log.Printf("WARN:   Count: %d\n", b.ClickCount)
		
	case "error":
		log.Printf("ERROR: Error Log #%d triggered at %s", b.ClickCount, timestamp)
		log.Printf("ERROR:   Error: This is an error message")
		log.Printf("ERROR:   Details: Something went wrong (simulated)")
		log.Printf("ERROR:   ErrorCode: ERR_%d", b.ClickCount)
		log.Printf("ERROR:   Count: %d\n", b.ClickCount)
		
	case "debug":
		log.Printf("DEBUG: Debug Log #%d triggered at %s", b.ClickCount, timestamp)
		log.Printf("DEBUG:   Debug: This is a debug message")
		log.Printf("DEBUG:   Variables: {count: %d}", b.ClickCount)
		log.Printf("DEBUG:   State: debugging\n")
	}
}

// DemoState holds the state of the demo
type DemoState struct {
	Renderer    *opentui.Renderer
	Buffer      *opentui.Buffer
	Buttons     []*ConsoleButton
	StatusText  string
	Running     bool
	MouseX      uint32
	MouseY      uint32
}

// NewDemoState creates a new demo state
func NewDemoState() (*DemoState, error) {
	renderer := opentui.NewRenderer(80, 30)
	if renderer == nil {
		return nil, fmt.Errorf("failed to create renderer")
	}
	
	// Enable mouse tracking
	err := renderer.EnableMouse(true)
	if err != nil {
		renderer.Close()
		return nil, fmt.Errorf("failed to enable mouse: %v", err)
	}
	
	// Set background color
	backgroundColor := opentui.NewRGBA(18.0/255, 22.0/255, 35.0/255, 1.0)
	err = renderer.SetBackgroundColor(backgroundColor)
	if err != nil {
		renderer.Close()
		return nil, fmt.Errorf("failed to set background color: %v", err)
	}
	
	buffer, err := renderer.GetNextBuffer()
	if err != nil {
		renderer.Close()
		return nil, fmt.Errorf("failed to get buffer: %v", err)
	}
	
	// Create buttons
	logColor := opentui.NewRGBA(160.0/255, 160.0/255, 170.0/255, 1.0)
	infoColor := opentui.NewRGBA(100.0/255, 180.0/255, 200.0/255, 1.0)
	warnColor := opentui.NewRGBA(220.0/255, 180.0/255, 100.0/255, 1.0)
	errorColor := opentui.NewRGBA(200.0/255, 120.0/255, 120.0/255, 1.0)
	debugColor := opentui.NewRGBA(140.0/255, 140.0/255, 150.0/255, 1.0)
	
	startY := int32(8)
	buttonWidth := uint32(14)
	buttonHeight := uint32(5)
	spacing := int32(16)
	
	buttons := []*ConsoleButton{
		NewConsoleButton("log", 2, startY, buttonWidth, buttonHeight, logColor, "LOG", "log"),
		NewConsoleButton("info", 2+spacing, startY, buttonWidth, buttonHeight, infoColor, "INFO", "info"),
		NewConsoleButton("warn", 2+spacing*2, startY, buttonWidth, buttonHeight, warnColor, "WARN", "warn"),
		NewConsoleButton("error", 2+spacing*3, startY, buttonWidth, buttonHeight, errorColor, "ERROR", "error"),
		NewConsoleButton("debug", 2+spacing*4, startY, buttonWidth, buttonHeight, debugColor, "DEBUG", "debug"),
	}
	
	return &DemoState{
		Renderer:   renderer,
		Buffer:     buffer,
		Buttons:    buttons,
		StatusText: "Click any button to start logging...",
		Running:    true,
	}, nil
}

// Close cleans up the demo state
func (d *DemoState) Close() {
	if d.Renderer != nil {
		d.Renderer.DisableMouse()
		d.Renderer.ClearTerminal()
		d.Renderer.Close()
	}
}

// Render draws the demo interface
func (d *DemoState) Render() error {
	// Clear buffer
	backgroundColor := opentui.NewRGBA(18.0/255, 22.0/255, 35.0/255, 1.0)
	err := d.Buffer.Clear(backgroundColor)
	if err != nil {
		return fmt.Errorf("failed to clear buffer: %v", err)
	}
	
	// Draw title
	titleColor := opentui.NewRGBA(255.0/255, 215.0/255, 135.0/255, 1.0)
	err = d.Buffer.DrawText("Console Logging Demo", 2, 1, titleColor, nil, opentui.AttrBold)
	if err != nil {
		return fmt.Errorf("failed to draw title: %v", err)
	}
	
	// Draw instructions
	instrColor := opentui.NewRGBA(176.0/255, 196.0/255, 222.0/255, 1.0)
	instructions := "Click buttons to trigger different console log levels • Press 'q' to quit • ESC to exit"
	err = d.Buffer.DrawText(instructions, 2, 2, instrColor, nil, 0)
	if err != nil {
		return fmt.Errorf("failed to draw instructions: %v", err)
	}
	
	// Draw mouse position (for debugging)
	mouseInfo := fmt.Sprintf("Mouse: (%d, %d)", d.MouseX, d.MouseY)
	err = d.Buffer.DrawText(mouseInfo, 2, 3, opentui.Gray, nil, 0)
	if err != nil {
		return fmt.Errorf("failed to draw mouse info: %v", err)
	}
	
	// Draw status
	statusColor := opentui.NewRGBA(144.0/255, 238.0/255, 144.0/255, 1.0)
	err = d.Buffer.DrawText(d.StatusText, 2, 5, statusColor, nil, opentui.AttrItalic)
	if err != nil {
		return fmt.Errorf("failed to draw status: %v", err)
	}
	
	// Draw buttons
	for _, button := range d.Buttons {
		err = button.Render(d.Buffer)
		if err != nil {
			return fmt.Errorf("failed to render button %s: %v", button.ID, err)
		}
	}
	
	// Draw decorations
	decorColor := opentui.NewRGBA(100.0/255, 120.0/255, 150.0/255, 120.0/255)
	decoration := "✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦"
	err = d.Buffer.DrawText(decoration, 2, 16, decorColor, nil, 0)
	if err != nil {
		return fmt.Errorf("failed to draw decoration: %v", err)
	}
	
	// Draw console info
	consoleInfoColor := opentui.NewRGBA(120.0/255, 140.0/255, 160.0/255, 200.0/255)
	consoleInfo := "Console output appears in the terminal. Check your terminal for log messages."
	err = d.Buffer.DrawText(consoleInfo, 2, 18, consoleInfoColor, nil, opentui.AttrItalic)
	if err != nil {
		return fmt.Errorf("failed to draw console info: %v", err)
	}
	
	// Draw button stats
	statsY := uint32(22)
	for i, button := range d.Buttons {
		stats := fmt.Sprintf("%s: %d clicks", button.LogType, button.ClickCount)
		statsColor := opentui.NewRGBA(200.0/255, 200.0/255, 200.0/255, 1.0)
		err = d.Buffer.DrawText(stats, uint32(2+i*15), statsY, statsColor, nil, 0)
		if err != nil {
			return fmt.Errorf("failed to draw stats: %v", err)
		}
	}
	
	// Render to screen
	return d.Renderer.Render(false)
}

// HandleMouseMove processes mouse movement
func (d *DemoState) HandleMouseMove(x, y uint32) {
	d.MouseX = x
	d.MouseY = y
	
	// Update hover states
	for _, button := range d.Buttons {
		wasHovered := button.IsHovered
		button.IsHovered = button.Contains(x, y)
		
		// Reset press state when mouse leaves
		if wasHovered && !button.IsHovered {
			button.IsPressed = false
		}
	}
}

// HandleMouseClick processes mouse clicks
func (d *DemoState) HandleMouseClick(x, y uint32) {
	for _, button := range d.Buttons {
		if button.Contains(x, y) {
			button.Click()
			timestamp := time.Now().Format("15:04:05")
			d.StatusText = fmt.Sprintf("Last triggered: %s #%d at %s", 
				button.LogType, button.ClickCount, timestamp)
			break
		}
	}
}

func min(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println("🎮 OpenTUI Console Demo")
	fmt.Println("======================")
	fmt.Println()
	fmt.Println("Controls:")
	fmt.Println("  1-5: Click buttons (LOG, INFO, WARN, ERROR, DEBUG)")
	fmt.Println("  q/Q: Quit demo")
	fmt.Println("  ESC: Exit")
	fmt.Println()
	fmt.Println("Mouse support is enabled - try clicking in supported terminals!")
	fmt.Println("Log output will appear in this terminal window.")
	fmt.Println()
	
	// Try to set terminal to raw mode for better input handling
	SetTerminalRaw()
	defer RestoreTerminal()
	
	// Create demo state
	demo, err := NewDemoState()
	if err != nil {
		log.Fatalf("Failed to initialize demo: %v", err)
	}
	defer demo.Close()
	
	// Create input handler
	input, err := NewKeyboardOnlyInput()
	if err != nil {
		log.Printf("Failed to create input handler, using simple input: %v", err)
		runSimpleDemo(demo)
		return
	}
	defer input.Close()
	
	// Print initial console message
	fmt.Println("✨ Console Demo initialized! Use keyboard controls or try clicking the buttons.")
	fmt.Println()
	
	// Channel for input events
	inputChan := make(chan rune, 1)
	
	// Start input goroutine
	go func() {
		for {
			key, err := input.ReadKey()
			if err != nil {
				return
			}
			select {
			case inputChan <- key:
			default:
				// Buffer full, skip
			}
		}
	}()
	
	// Main demo loop
	lastRender := time.Now()
	renderInterval := 50 * time.Millisecond
	
	for demo.Running {
		// Handle input
		select {
		case key := <-inputChan:
			if !handleInput(demo, key) {
				demo.Running = false
				continue
			}
		default:
			// No input available
		}
		
		// Render at regular intervals
		if time.Since(lastRender) >= renderInterval {
			err := demo.Render()
			if err != nil {
				log.Printf("Render error: %v", err)
				break
			}
			lastRender = time.Now()
		}
		
		// Small sleep to prevent busy waiting
		time.Sleep(10 * time.Millisecond)
	}
	
	fmt.Println("\n🎉 Console Demo completed!")
	fmt.Println("Thanks for trying OpenTUI Go!")
}

// handleInput processes keyboard input and returns false to exit
func handleInput(demo *DemoState, key rune) bool {
	switch key {
	case 'q', 'Q':
		return false
	case 27: // ESC
		return false
	case '1':
		if len(demo.Buttons) > 0 {
			demo.Buttons[0].Click()
			demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
				demo.Buttons[0].LogType, demo.Buttons[0].ClickCount)
		}
	case '2':
		if len(demo.Buttons) > 1 {
			demo.Buttons[1].Click()
			demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
				demo.Buttons[1].LogType, demo.Buttons[1].ClickCount)
		}
	case '3':
		if len(demo.Buttons) > 2 {
			demo.Buttons[2].Click()
			demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
				demo.Buttons[2].LogType, demo.Buttons[2].ClickCount)
		}
	case '4':
		if len(demo.Buttons) > 3 {
			demo.Buttons[3].Click()
			demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
				demo.Buttons[3].LogType, demo.Buttons[3].ClickCount)
		}
	case '5':
		if len(demo.Buttons) > 4 {
			demo.Buttons[4].Click()
			demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
				demo.Buttons[4].LogType, demo.Buttons[4].ClickCount)
		}
	}
	return true
}

// runSimpleDemo runs a simplified version with line-based input
func runSimpleDemo(demo *DemoState) {
	input := NewSimpleInput()
	
	fmt.Println("Simple input mode - type commands and press Enter:")
	fmt.Println("Commands: 1-5 (buttons), q (quit)")
	
	for demo.Running {
		// Render interface
		err := demo.Render()
		if err != nil {
			log.Printf("Render error: %v", err)
			break
		}
		
		fmt.Print("> ")
		line, err := input.ReadLine()
		if err != nil {
			break
		}
		
		line = strings.TrimSpace(line)
		if line == "q" || line == "quit" {
			break
		}
		
		// Handle button commands
		switch line {
		case "1":
			if len(demo.Buttons) > 0 {
				demo.Buttons[0].Click()
				demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
					demo.Buttons[0].LogType, demo.Buttons[0].ClickCount)
			}
		case "2":
			if len(demo.Buttons) > 1 {
				demo.Buttons[1].Click() 
				demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
					demo.Buttons[1].LogType, demo.Buttons[1].ClickCount)
			}
		case "3":
			if len(demo.Buttons) > 2 {
				demo.Buttons[2].Click()
				demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
					demo.Buttons[2].LogType, demo.Buttons[2].ClickCount)
			}
		case "4":
			if len(demo.Buttons) > 3 {
				demo.Buttons[3].Click()
				demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
					demo.Buttons[3].LogType, demo.Buttons[3].ClickCount)
			}
		case "5":
			if len(demo.Buttons) > 4 {
				demo.Buttons[4].Click()
				demo.StatusText = fmt.Sprintf("Triggered: %s #%d", 
					demo.Buttons[4].LogType, demo.Buttons[4].ClickCount)
			}
		default:
			fmt.Println("Unknown command. Try 1-5 for buttons, or 'q' to quit.")
		}
	}
}