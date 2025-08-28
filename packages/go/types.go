package opentui

/*
#include "opentui.h"
*/
import "C"
import (
	"runtime"
	"unsafe"
)

// Cell represents a single terminal cell with character, colors, and attributes
type Cell struct {
	Char       rune  // Unicode character
	Foreground RGBA  // Foreground color
	Background RGBA  // Background color
	Attributes uint8 // Text attributes (bold, italic, etc.)
}

// Text attributes constants
const (
	AttrBold      uint8 = 1 << 0
	AttrDim       uint8 = 1 << 1
	AttrItalic    uint8 = 1 << 2
	AttrUnderline uint8 = 1 << 3
	AttrBlink     uint8 = 1 << 4
	AttrReverse   uint8 = 1 << 5
	AttrStrike    uint8 = 1 << 6
)

// ClipRect defines a rectangular clipping region
type ClipRect struct {
	X      int32
	Y      int32
	Width  uint32
	Height uint32
}

// Stats holds renderer statistics
type Stats struct {
	Time              float64
	FPS               uint32
	FrameCallbackTime float64
}

// MemoryStats holds memory usage statistics
type MemoryStats struct {
	HeapUsed     uint32
	HeapTotal    uint32
	ArrayBuffers uint32
}

// BoxOptions holds options for drawing boxes
type BoxOptions struct {
	Sides          BorderSides
	Fill           bool
	Title          string
	TitleAlignment TextAlignment
	BorderChars    [8]rune // Top-left, top, top-right, right, bottom-right, bottom, bottom-left, left
}

// DefaultBoxChars provides default Unicode box drawing characters
var DefaultBoxChars = [8]rune{
	'┌', '─', '┐',
	'│',       '│',
	'└', '─', '┘',
}

// SuperSampleFormat defines pixel formats for super-sampling
type SuperSampleFormat uint8

const (
	FormatRGBA SuperSampleFormat = iota
	FormatRGB
	FormatBGRA
	FormatBGR
)

// TextChunk represents a styled text fragment
type TextChunk struct {
	Text       string
	Foreground *RGBA
	Background *RGBA
	Attributes *uint8
}

// LineInfo represents information about a line in a text buffer
type LineInfo struct {
	StartIndex uint32
	Width      uint32
}

// HitTestResult represents the result of a mouse hit test
type HitTestResult struct {
	ID    uint32
	Found bool
}

// Error represents an OpenTUI error
type Error struct {
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

// newError creates a new OpenTUI error
func newError(msg string) error {
	return &Error{Message: msg}
}

// finalizer is a helper to set up automatic cleanup for CGO objects
func setFinalizer[T any](obj *T, cleanup func(*T)) {
	if obj != nil {
		runtime.SetFinalizer(obj, func(o *T) { cleanup(o) })
	}
}

// clearFinalizer removes the finalizer from an object
func clearFinalizer[T any](obj *T) {
	if obj != nil {
		runtime.SetFinalizer(obj, nil)
	}
}

// sliceToC converts a Go slice to C array parameters
func sliceToC[T any](slice []T) (*T, C.size_t) {
	if len(slice) == 0 {
		return nil, 0
	}
	return (*T)(unsafe.Pointer(&slice[0])), C.size_t(len(slice))
}

// cArrayToSlice converts a C array to a Go slice (read-only view)
func cArrayToSlice[T any](ptr *T, length int) []T {
	if ptr == nil || length == 0 {
		return nil
	}
	return unsafe.Slice(ptr, length)
}

// runesToC converts a rune slice to uint32 C array
func runesToC(runes []rune) *C.uint32_t {
	if len(runes) == 0 {
		return nil
	}
	// Convert runes to uint32
	uint32s := make([]uint32, len(runes))
	for i, r := range runes {
		uint32s[i] = uint32(r)
	}
	return (*C.uint32_t)(unsafe.Pointer(&uint32s[0]))
}

// Position represents a 2D coordinate
type Position struct {
	X int32
	Y int32
}

// Size represents 2D dimensions
type Size struct {
	Width  uint32
	Height uint32
}

// Rect combines position and size
type Rect struct {
	Position
	Size
}

// Contains checks if a point is inside the rectangle
func (r Rect) Contains(x, y int32) bool {
	return x >= r.X && x < r.X+int32(r.Width) &&
		y >= r.Y && y < r.Y+int32(r.Height)
}

// Overlaps checks if two rectangles overlap
func (r Rect) Overlaps(other Rect) bool {
	return r.X < other.X+int32(other.Width) &&
		r.X+int32(r.Width) > other.X &&
		r.Y < other.Y+int32(other.Height) &&
		r.Y+int32(r.Height) > other.Y
}

// MouseEvent represents a mouse interaction
type MouseEvent struct {
	Position Position
	Button   uint8
	Pressed  bool
}

// KeyEvent represents a keyboard interaction
type KeyEvent struct {
	Key      rune
	Modifiers uint8
}

// Key modifier constants
const (
	ModShift   uint8 = 1 << 0
	ModCtrl    uint8 = 1 << 1
	ModAlt     uint8 = 1 << 2
	ModSuper   uint8 = 1 << 3
)

// Capabilities represents terminal capabilities
type Capabilities struct {
	SupportsTruecolor       bool // Terminal supports 24-bit color
	SupportsMouse          bool // Terminal supports mouse events
	SupportsKittyKeyboard  bool // Terminal supports Kitty keyboard protocol
	SupportsAlternateScreen bool // Terminal supports alternate screen buffer
}