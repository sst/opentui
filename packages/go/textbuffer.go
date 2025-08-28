package opentui

/*
#include "opentui.h"
#include <stdlib.h>
*/
import "C"
import (
	"unsafe"
)

// TextBuffer wraps the TextBuffer from the C library.
// It represents a buffer of styled text fragments with efficient line tracking.
type TextBuffer struct {
	ptr *C.TextBuffer
}

// NewTextBuffer creates a new text buffer with the specified initial capacity.
// The widthMethod parameter controls how text width is calculated (use WidthMethodUnicode for full Unicode support).
func NewTextBuffer(length uint32, widthMethod uint8) *TextBuffer {
	if length == 0 {
		length = 1024 // Default capacity
	}
	
	ptr := C.createTextBuffer(C.uint32_t(length), C.uint8_t(widthMethod))
	if ptr == nil {
		return nil
	}
	
	tb := &TextBuffer{ptr: ptr}
	setFinalizer(tb, func(tb *TextBuffer) { tb.Close() })
	return tb
}

// Close releases the text buffer's resources.
// After calling Close, the text buffer should not be used.
func (tb *TextBuffer) Close() error {
	if tb.ptr != nil {
		clearFinalizer(tb)
		C.destroyTextBuffer(tb.ptr)
		tb.ptr = nil
	}
	return nil
}

// Length returns the current length of the text buffer in characters.
func (tb *TextBuffer) Length() (uint32, error) {
	if tb.ptr == nil {
		return 0, newError("text buffer is closed")
	}
	return uint32(C.textBufferGetLength(tb.ptr)), nil
}

// Capacity returns the current capacity of the text buffer.
func (tb *TextBuffer) Capacity() (uint32, error) {
	if tb.ptr == nil {
		return 0, newError("text buffer is closed")
	}
	return uint32(C.textBufferGetCapacity(tb.ptr)), nil
}

// SetCell sets a single character at the specified index with styling.
func (tb *TextBuffer) SetCell(index uint32, char rune, fg, bg RGBA, attributes uint16) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferSetCell(tb.ptr, C.uint32_t(index), C.uint32_t(char), fg.toCFloat(), bg.toCFloat(), C.uint16_t(attributes))
	return nil
}

// WriteChunk appends a text chunk with optional styling to the buffer.
// Returns the number of characters written.
func (tb *TextBuffer) WriteChunk(chunk TextChunk) (uint32, error) {
	if tb.ptr == nil {
		return 0, newError("text buffer is closed")
	}
	
	textPtr, textLen := stringToC(chunk.Text)
	if textPtr == nil {
		return 0, nil // Empty string
	}
	
	var fgPtr, bgPtr *C.float
	var attrPtr *C.uint8_t
	
	if chunk.Foreground != nil {
		fgPtr = chunk.Foreground.toCFloat()
	}
	if chunk.Background != nil {
		bgPtr = chunk.Background.toCFloat()
	}
	if chunk.Attributes != nil {
		attrPtr = (*C.uint8_t)(unsafe.Pointer(chunk.Attributes))
	}
	
	written := C.textBufferWriteChunk(tb.ptr, textPtr, C.uint32_t(textLen), fgPtr, bgPtr, attrPtr)
	return uint32(written), nil
}

// WriteString is a convenience method to write a string with default styling.
func (tb *TextBuffer) WriteString(text string) (uint32, error) {
	return tb.WriteChunk(TextChunk{Text: text})
}

// WriteStyledString writes a string with the specified colors and attributes.
func (tb *TextBuffer) WriteStyledString(text string, fg, bg *RGBA, attributes *uint8) (uint32, error) {
	return tb.WriteChunk(TextChunk{
		Text:       text,
		Foreground: fg,
		Background: bg,
		Attributes: attributes,
	})
}

// Concat concatenates this text buffer with another text buffer.
// Returns a new text buffer containing the combined content.
func (tb *TextBuffer) Concat(other *TextBuffer) (*TextBuffer, error) {
	if tb.ptr == nil {
		return nil, newError("text buffer is closed")
	}
	if other == nil || other.ptr == nil {
		return nil, newError("other text buffer is nil or closed")
	}
	
	resultPtr := C.textBufferConcat(tb.ptr, other.ptr)
	if resultPtr == nil {
		return nil, newError("failed to concatenate text buffers")
	}
	
	result := &TextBuffer{ptr: resultPtr}
	setFinalizer(result, func(tb *TextBuffer) { tb.Close() })
	return result, nil
}

// Resize changes the capacity of the text buffer.
func (tb *TextBuffer) Resize(newLength uint32) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferResize(tb.ptr, C.uint32_t(newLength))
	return nil
}

// Reset clears the text buffer content while preserving capacity.
func (tb *TextBuffer) Reset() error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferReset(tb.ptr)
	return nil
}

// SetSelection sets a text selection range with optional highlighting colors.
func (tb *TextBuffer) SetSelection(start, end uint32, bgColor, fgColor *RGBA) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	
	var bgPtr, fgPtr *C.float
	if bgColor != nil {
		bgPtr = bgColor.toCFloat()
	}
	if fgColor != nil {
		fgPtr = fgColor.toCFloat()
	}
	
	C.textBufferSetSelection(tb.ptr, C.uint32_t(start), C.uint32_t(end), bgPtr, fgPtr)
	return nil
}

// ResetSelection clears any active text selection.
func (tb *TextBuffer) ResetSelection() error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferResetSelection(tb.ptr)
	return nil
}

// SetDefaultForeground sets the default foreground color for new text.
func (tb *TextBuffer) SetDefaultForeground(fg *RGBA) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	
	var fgPtr *C.float
	if fg != nil {
		fgPtr = fg.toCFloat()
	}
	
	C.textBufferSetDefaultFg(tb.ptr, fgPtr)
	return nil
}

// SetDefaultBackground sets the default background color for new text.
func (tb *TextBuffer) SetDefaultBackground(bg *RGBA) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	
	var bgPtr *C.float
	if bg != nil {
		bgPtr = bg.toCFloat()
	}
	
	C.textBufferSetDefaultBg(tb.ptr, bgPtr)
	return nil
}

// SetDefaultAttributes sets the default text attributes for new text.
func (tb *TextBuffer) SetDefaultAttributes(attributes *uint8) error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	
	var attrPtr *C.uint8_t
	if attributes != nil {
		attrPtr = (*C.uint8_t)(unsafe.Pointer(attributes))
	}
	
	C.textBufferSetDefaultAttributes(tb.ptr, attrPtr)
	return nil
}

// ResetDefaults clears all default styling settings.
func (tb *TextBuffer) ResetDefaults() error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferResetDefaults(tb.ptr)
	return nil
}

// FinalizeLineInfo processes the text buffer to generate line information.
// This should be called after adding text and before querying line information.
func (tb *TextBuffer) FinalizeLineInfo() error {
	if tb.ptr == nil {
		return newError("text buffer is closed")
	}
	C.textBufferFinalizeLineInfo(tb.ptr)
	return nil
}

// LineCount returns the number of lines in the text buffer.
// FinalizeLineInfo must be called first.
func (tb *TextBuffer) LineCount() (uint32, error) {
	if tb.ptr == nil {
		return 0, newError("text buffer is closed")
	}
	return uint32(C.textBufferGetLineCount(tb.ptr)), nil
}

// GetLineInfo returns information about all lines in the text buffer.
// FinalizeLineInfo must be called first.
func (tb *TextBuffer) GetLineInfo() ([]LineInfo, error) {
	if tb.ptr == nil {
		return nil, newError("text buffer is closed")
	}
	
	lineCount := uint32(C.textBufferGetLineCount(tb.ptr))
	if lineCount == 0 {
		return []LineInfo{}, nil
	}
	
	startsPtr := C.textBufferGetLineStartsPtr(tb.ptr)
	widthsPtr := C.textBufferGetLineWidthsPtr(tb.ptr)
	
	starts := cArrayToSlice((*uint32)(startsPtr), int(lineCount))
	widths := cArrayToSlice((*uint32)(widthsPtr), int(lineCount))
	
	lines := make([]LineInfo, lineCount)
	for i := uint32(0); i < lineCount; i++ {
		lines[i] = LineInfo{
			StartIndex: starts[i],
			Width:      widths[i],
		}
	}
	
	return lines, nil
}

// GetDirectAccess returns direct access to the text buffer's internal arrays.
// This is an advanced feature for performance-critical operations.
func (tb *TextBuffer) GetDirectAccess() (*TextBufferDirectAccess, error) {
	if tb.ptr == nil {
		return nil, newError("text buffer is closed")
	}
	
	length := uint32(C.textBufferGetLength(tb.ptr))
	if length == 0 {
		return &TextBufferDirectAccess{
			Chars:      []uint32{},
			Foreground: []RGBA{},
			Background: []RGBA{},
			Attributes: []uint16{},
			Length:     0,
		}, nil
	}
	
	charPtr := C.textBufferGetCharPtr(tb.ptr)
	fgPtr := C.textBufferGetFgPtr(tb.ptr)
	bgPtr := C.textBufferGetBgPtr(tb.ptr)
	attrPtr := C.textBufferGetAttributesPtr(tb.ptr)
	
	return &TextBufferDirectAccess{
		Chars:      cArrayToSlice((*uint32)(charPtr), int(length)),
		Foreground: cArrayToSlice((*RGBA)(unsafe.Pointer(fgPtr)), int(length)),
		Background: cArrayToSlice((*RGBA)(unsafe.Pointer(bgPtr)), int(length)),
		Attributes: cArrayToSlice((*uint16)(attrPtr), int(length)),
		Length:     length,
	}, nil
}

// TextBufferDirectAccess provides direct access to text buffer internal arrays.
type TextBufferDirectAccess struct {
	Chars      []uint32 // Character codes (Unicode code points)
	Foreground []RGBA   // Foreground colors
	Background []RGBA   // Background colors
	Attributes []uint16 // Text attributes
	Length     uint32   // Buffer length
}

// GetChar returns the character at the specified index.
func (da *TextBufferDirectAccess) GetChar(index uint32) (rune, error) {
	if index >= da.Length {
		return 0, newError("index out of bounds")
	}
	return rune(da.Chars[index]), nil
}

// SetChar sets the character at the specified index.
func (da *TextBufferDirectAccess) SetChar(index uint32, char rune) error {
	if index >= da.Length {
		return newError("index out of bounds")
	}
	da.Chars[index] = uint32(char)
	return nil
}

// GetStyle returns the styling at the specified index.
func (da *TextBufferDirectAccess) GetStyle(index uint32) (RGBA, RGBA, uint16, error) {
	if index >= da.Length {
		return RGBA{}, RGBA{}, 0, newError("index out of bounds")
	}
	return da.Foreground[index], da.Background[index], da.Attributes[index], nil
}

// SetStyle sets the styling at the specified index.
func (da *TextBufferDirectAccess) SetStyle(index uint32, fg, bg RGBA, attributes uint16) error {
	if index >= da.Length {
		return newError("index out of bounds")
	}
	da.Foreground[index] = fg
	da.Background[index] = bg
	da.Attributes[index] = attributes
	return nil
}

// Valid checks if the text buffer is still valid (not closed).
func (tb *TextBuffer) Valid() bool {
	return tb.ptr != nil
}