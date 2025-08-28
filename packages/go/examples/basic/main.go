package main

import (
	"fmt"
	"time"
	
	opentui "github.com/sst/opentui/packages/go"
)

func main() {
	fmt.Println("Starting OpenTUI Go Basic Example...")
	
	// Create a new renderer with 80x24 dimensions
	renderer := opentui.NewRenderer(80, 24)
	if renderer == nil {
		panic("Failed to create renderer - make sure the OpenTUI library is available")
	}
	defer renderer.Close()
	
	// Set a dark blue background
	err := renderer.SetBackgroundColor(opentui.NewRGB(0.1, 0.1, 0.3))
	if err != nil {
		panic(fmt.Sprintf("Failed to set background color: %v", err))
	}
	
	// Clear the terminal first
	err = renderer.ClearTerminal()
	if err != nil {
		panic(fmt.Sprintf("Failed to clear terminal: %v", err))
	}
	
	// Get the buffer for drawing
	buffer, err := renderer.GetNextBuffer()
	if err != nil {
		panic(fmt.Sprintf("Failed to get buffer: %v", err))
	}
	
	// Clear the buffer with the background color
	err = buffer.Clear(opentui.NewRGB(0.1, 0.1, 0.3))
	if err != nil {
		panic(fmt.Sprintf("Failed to clear buffer: %v", err))
	}
	
	// Draw a title
	err = buffer.DrawText("OpenTUI Go Demo", 30, 2, 
		opentui.Yellow, nil, opentui.AttrBold)
	if err != nil {
		panic(fmt.Sprintf("Failed to draw title: %v", err))
	}
	
	// Draw some colored text
	colors := []opentui.RGBA{
		opentui.Red,
		opentui.Green,
		opentui.Blue,
		opentui.Cyan,
		opentui.Magenta,
		opentui.Yellow,
	}
	
	messages := []string{
		"Hello, World!",
		"This is red text",
		"This is green text",
		"This is blue text",
		"This is cyan text",
		"This is magenta text",
	}
	
	for i, msg := range messages {
		color := opentui.White
		if i > 0 {
			color = colors[i-1]
		}
		
		attrs := uint8(0)
		if i == 0 {
			attrs = opentui.AttrBold | opentui.AttrUnderline
		}
		
		err = buffer.DrawText(msg, 10, uint32(5+i*2), color, nil, attrs)
		if err != nil {
			panic(fmt.Sprintf("Failed to draw text: %v", err))
		}
	}
	
	// Draw a box around some content
	boxOptions := opentui.BoxOptions{
		Sides: opentui.BorderSides{
			Top:    true,
			Right:  true,
			Bottom: true,
			Left:   true,
		},
		Fill:           true,
		Title:          "Information Box",
		TitleAlignment: opentui.AlignCenter,
		BorderChars:    opentui.DefaultBoxChars,
	}
	
	err = buffer.DrawBox(50, 6, 25, 8, boxOptions, 
		opentui.White, opentui.NewRGB(0.2, 0.2, 0.4))
	if err != nil {
		panic(fmt.Sprintf("Failed to draw box: %v", err))
	}
	
	// Add content inside the box
	err = buffer.DrawText("Terminal UI Demo", 52, 8, 
		opentui.Green, nil, opentui.AttrBold)
	if err != nil {
		panic(fmt.Sprintf("Failed to draw box content: %v", err))
	}
	
	err = buffer.DrawText("Built with OpenTUI", 52, 9, 
		opentui.Cyan, nil, 0)
	if err != nil {
		panic(fmt.Sprintf("Failed to draw box content: %v", err))
	}
	
	err = buffer.DrawText("Go Bindings v1.0", 52, 10, 
		opentui.Yellow, nil, 0)
	if err != nil {
		panic(fmt.Sprintf("Failed to draw box content: %v", err))
	}
	
	// Fill a colored rectangle
	err = buffer.FillRect(10, 18, 60, 3, opentui.NewRGB(0.8, 0.2, 0.2))
	if err != nil {
		panic(fmt.Sprintf("Failed to fill rectangle: %v", err))
	}
	
	err = buffer.DrawText("Press Ctrl+C to exit", 25, 19, 
		opentui.White, nil, opentui.AttrBold)
	if err != nil {
		panic(fmt.Sprintf("Failed to draw exit message: %v", err))
	}
	
	// Render the buffer to the screen
	err = renderer.Render(true)
	if err != nil {
		panic(fmt.Sprintf("Failed to render: %v", err))
	}
	
	fmt.Println("Demo rendered successfully! The display will remain for 10 seconds...")
	
	// Keep the display visible for a while
	time.Sleep(10 * time.Second)
	
	// Clear terminal before exit
	err = renderer.ClearTerminal()
	if err != nil {
		fmt.Printf("Warning: Failed to clear terminal on exit: %v\n", err)
	}
	
	fmt.Println("OpenTUI Go Basic Example completed!")
}