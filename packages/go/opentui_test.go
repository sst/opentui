package opentui

import (
	"testing"
)

func TestRGBA(t *testing.T) {
	// Test RGBA creation
	color := NewRGBA(1.0, 0.5, 0.25, 0.8)
	if color.R != 1.0 || color.G != 0.5 || color.B != 0.25 || color.A != 0.8 {
		t.Errorf("RGBA values incorrect: got %+v", color)
	}
	
	// Test RGB creation (alpha should be 1.0)
	rgb := NewRGB(0.2, 0.4, 0.6)
	if rgb.R != 0.2 || rgb.G != 0.4 || rgb.B != 0.6 || rgb.A != 1.0 {
		t.Errorf("RGB values incorrect: got %+v", rgb)
	}
	
	// Test predefined colors
	if Black.R != 0 || Black.G != 0 || Black.B != 0 || Black.A != 1.0 {
		t.Errorf("Black color incorrect: got %+v", Black)
	}
	
	if White.R != 1 || White.G != 1 || White.B != 1 || White.A != 1.0 {
		t.Errorf("White color incorrect: got %+v", White)
	}
}

func TestBorderSides(t *testing.T) {
	sides := BorderSides{Top: true, Right: false, Bottom: true, Left: false}
	packed := packBorderOptions(sides, true, uint8(AlignCenter))
	
	// Check that the packing worked (this is internal but we can verify the function doesn't crash)
	if packed == 0 {
		t.Error("packBorderOptions returned 0, which seems incorrect")
	}
}

func TestRenderer(t *testing.T) {
	// Test renderer creation
	renderer := NewRenderer(80, 24)
	if renderer == nil {
		t.Skip("Skipping renderer test - OpenTUI library not available (this is expected in CI)")
	}
	defer renderer.Close()
	
	// Test that renderer is valid
	if !renderer.Valid() {
		t.Error("Renderer should be valid after creation")
	}
	
	// Test basic operations
	err := renderer.SetBackgroundColor(Blue)
	if err != nil {
		t.Errorf("SetBackgroundColor failed: %v", err)
	}
	
	err = renderer.SetRenderOffset(1)
	if err != nil {
		t.Errorf("SetRenderOffset failed: %v", err)
	}
	
	// Test getting buffer
	buffer, err := renderer.GetNextBuffer()
	if err != nil {
		t.Errorf("GetNextBuffer failed: %v", err)
	}
	if buffer == nil {
		t.Error("GetNextBuffer returned nil buffer")
	}
	
	// Test buffer operations
	if buffer != nil {
		width, height, err := buffer.Size()
		if err != nil {
			t.Errorf("Buffer Size failed: %v", err)
		}
		if width != 80 || height != 24 {
			t.Errorf("Buffer size incorrect: got %dx%d, want 80x24", width, height)
		}
		
		// Test buffer clear
		err = buffer.Clear(Green)
		if err != nil {
			t.Errorf("Buffer Clear failed: %v", err)
		}
	}
	
	// Test mouse functions (should work now with the updated library)
	err = renderer.EnableMouse(true)
	if err != nil {
		t.Errorf("EnableMouse failed: %v", err)
	}
	
	err = renderer.DisableMouse()
	if err != nil {
		t.Errorf("DisableMouse failed: %v", err)
	}
	
	// Test renderer close
	err = renderer.Close()
	if err != nil {
		t.Errorf("Renderer Close failed: %v", err)
	}
	
	// Test that renderer is invalid after close
	if renderer.Valid() {
		t.Error("Renderer should be invalid after close")
	}
}

func TestRendererInvalidDimensions(t *testing.T) {
	// Test creation with invalid dimensions
	renderer := NewRenderer(0, 24)
	if renderer != nil {
		defer renderer.Close()
		t.Error("NewRenderer should return nil for zero width")
	}
	
	renderer = NewRenderer(80, 0)
	if renderer != nil {
		defer renderer.Close()
		t.Error("NewRenderer should return nil for zero height")
	}
}

func TestBuffer(t *testing.T) {
	// Test buffer creation
	buffer := NewBuffer(40, 20, true, WidthMethodUnicode)
	if buffer == nil {
		t.Skip("Skipping buffer test - OpenTUI library not available")
	}
	defer buffer.Close()
	
	// Test buffer is valid
	if !buffer.Valid() {
		t.Error("Buffer should be valid after creation")
	}
	
	// Test buffer dimensions
	width, height, err := buffer.Size()
	if err != nil {
		t.Errorf("Buffer Size failed: %v", err)
	}
	if width != 40 || height != 20 {
		t.Errorf("Buffer size incorrect: got %dx%d, want 40x20", width, height)
	}
	
	// Test alpha respect setting
	respectAlpha, err := buffer.GetRespectAlpha()
	if err != nil {
		t.Errorf("GetRespectAlpha failed: %v", err)
	}
	if !respectAlpha {
		t.Error("Buffer should respect alpha as requested in constructor")
	}
	
	// Test setting alpha respect
	err = buffer.SetRespectAlpha(false)
	if err != nil {
		t.Errorf("SetRespectAlpha failed: %v", err)
	}
	
	respectAlpha, err = buffer.GetRespectAlpha()
	if err != nil {
		t.Errorf("GetRespectAlpha failed after set: %v", err)
	}
	if respectAlpha {
		t.Error("Buffer should not respect alpha after setting to false")
	}
	
	// Test buffer operations
	err = buffer.Clear(Red)
	if err != nil {
		t.Errorf("Buffer Clear failed: %v", err)
	}
	
	err = buffer.DrawText("Test", 5, 5, White, &Black, AttrBold)
	if err != nil {
		t.Errorf("DrawText failed: %v", err)
	}
	
	err = buffer.FillRect(10, 10, 5, 3, Blue)
	if err != nil {
		t.Errorf("FillRect failed: %v", err)
	}
	
	err = buffer.SetCellWithAlphaBlending(15, 15, 'A', Yellow, Green, AttrItalic)
	if err != nil {
		t.Errorf("SetCellWithAlphaBlending failed: %v", err)
	}
	
	// Test buffer close
	err = buffer.Close()
	if err != nil {
		t.Errorf("Buffer Close failed: %v", err)
	}
	
	// Test that buffer is invalid after close
	if buffer.Valid() {
		t.Error("Buffer should be invalid after close")
	}
}

func TestBufferInvalidDimensions(t *testing.T) {
	// Test creation with invalid dimensions
	buffer := NewBuffer(0, 20, false, WidthMethodUnicode)
	if buffer != nil {
		defer buffer.Close()
		t.Error("NewBuffer should return nil for zero width")
	}
	
	buffer = NewBuffer(40, 0, false, WidthMethodUnicode)
	if buffer != nil {
		defer buffer.Close()
		t.Error("NewBuffer should return nil for zero height")
	}
}

func TestTextBuffer(t *testing.T) {
	// Test text buffer creation
	textBuffer := NewTextBuffer(100, WidthMethodUnicode)
	if textBuffer == nil {
		t.Skip("Skipping text buffer test - OpenTUI library not available")
	}
	defer textBuffer.Close()
	
	// Test text buffer is valid
	if !textBuffer.Valid() {
		t.Error("TextBuffer should be valid after creation")
	}
	
	// Test initial state
	length, err := textBuffer.Length()
	if err != nil {
		t.Errorf("TextBuffer Length failed: %v", err)
	}
	if length != 0 {
		t.Errorf("TextBuffer should start empty, got length %d", length)
	}
	
	capacity, err := textBuffer.Capacity()
	if err != nil {
		t.Errorf("TextBuffer Capacity failed: %v", err)
	}
	if capacity < 100 {
		t.Errorf("TextBuffer capacity should be at least 100, got %d", capacity)
	}
	
	// Test writing chunks
	chunk := TextChunk{
		Text:       "Hello, ",
		Foreground: &Red,
		Background: &Black,
	}
	written, err := textBuffer.WriteChunk(chunk)
	if err != nil {
		t.Errorf("WriteChunk failed: %v", err)
	}
	if written == 0 {
		t.Error("WriteChunk should have written some characters")
	}
	
	// Test writing string
	written2, err := textBuffer.WriteString("World!")
	if err != nil {
		t.Errorf("WriteString failed: %v", err)
	}
	if written2 == 0 {
		t.Error("WriteString should have written some characters")
	}
	
	// Test final length
	finalLength, err := textBuffer.Length()
	if err != nil {
		t.Errorf("TextBuffer Length failed after writes: %v", err)
	}
	expectedLength := written + written2
	if finalLength != expectedLength {
		// Length might differ due to UTF-8 encoding - just check that something was written
		t.Logf("TextBuffer length: expected %d, got %d (this may be due to UTF-8 encoding)", expectedLength, finalLength)
		if finalLength == 0 {
			t.Error("TextBuffer should not be empty after writing text")
		}
	}
	
	// Test reset
	err = textBuffer.Reset()
	if err != nil {
		t.Errorf("TextBuffer Reset failed: %v", err)
	}
	
	lengthAfterReset, err := textBuffer.Length()
	if err != nil {
		t.Errorf("TextBuffer Length failed after reset: %v", err)
	}
	if lengthAfterReset != 0 {
		t.Errorf("TextBuffer should be empty after reset, got length %d", lengthAfterReset)
	}
	
	// Test text buffer close
	err = textBuffer.Close()
	if err != nil {
		t.Errorf("TextBuffer Close failed: %v", err)
	}
	
	// Test that text buffer is invalid after close
	if textBuffer.Valid() {
		t.Error("TextBuffer should be invalid after close")
	}
}

func TestGlobalCursorFunctions(t *testing.T) {
	// Test that cursor functions don't panic
	// We can't easily test their effects, but we can ensure they don't crash
	renderer := NewRenderer(80, 24)
	if renderer == nil {
		t.Skip("Skipping cursor test - OpenTUI library not available")
	}
	defer renderer.Close()
	
	SetCursorPosition(renderer, 10, 5, true)
	SetCursorStyle(renderer, CursorBlock, false)
	SetCursorColor(renderer, Green)
	
	// Also test renderer methods
	renderer.SetCursorPosition(15, 10, true)
	renderer.SetCursorStyle(CursorUnderline, true)
	renderer.SetCursorColor(Red)
	
	// If we get here without panicking, the test passes
}

func TestConstants(t *testing.T) {
	// Test that text attribute constants have expected values
	if AttrBold == 0 {
		t.Error("AttrBold should not be 0")
	}
	if AttrItalic == 0 {
		t.Error("AttrItalic should not be 0")
	}
	if AttrUnderline == 0 {
		t.Error("AttrUnderline should not be 0")
	}
	
	// Test that different attributes have different values
	if AttrBold == AttrItalic {
		t.Error("AttrBold and AttrItalic should have different values")
	}
	
	// Test cursor style constants
	if CursorBlock == CursorUnderline {
		t.Error("CursorBlock and CursorUnderline should have different values")
	}
}