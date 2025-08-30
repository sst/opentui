package opentui

/*
#cgo pkg-config: opentui
#include <opentui.h>
#include <stdlib.h>
*/
import "C"
import (
	"runtime"
	"unsafe"
)

// Package opentui provides Go bindings for the OpenTUI terminal UI library.
//
// OpenTUI is a high-performance terminal user interface library built with Zig,
// providing advanced features like mouse support, transparency, and hardware-accelerated
// rendering through WebGPU.

// init ensures proper library initialization and cleanup
func init() {
	runtime.LockOSThread()
}

// RGBA represents a color with red, green, blue, and alpha components.
// Each component is a float32 value between 0.0 and 1.0.
type RGBA struct {
	R, G, B, A float32
}

// NewRGBA creates a new RGBA color.
func NewRGBA(r, g, b, a float32) RGBA {
	return RGBA{R: r, G: g, B: b, A: a}
}

// NewRGB creates a new RGBA color with alpha set to 1.0 (fully opaque).
func NewRGB(r, g, b float32) RGBA {
	return RGBA{R: r, G: g, B: b, A: 1.0}
}

// toCFloat converts RGBA to C float array
func (c RGBA) toCFloat() *C.float {
	arr := [4]C.float{C.float(c.R), C.float(c.G), C.float(c.B), C.float(c.A)}
	return (*C.float)(unsafe.Pointer(&arr[0]))
}

// Common colors
var (
	Black     = NewRGB(0, 0, 0)
	White     = NewRGB(1, 1, 1)
	Red       = NewRGB(1, 0, 0)
	Green     = NewRGB(0, 1, 0)
	Blue      = NewRGB(0, 0, 1)
	Yellow    = NewRGB(1, 1, 0)
	Cyan      = NewRGB(0, 1, 1)
	Magenta   = NewRGB(1, 0, 1)
	Gray      = NewRGB(0.5, 0.5, 0.5)
	Transparent = NewRGBA(0, 0, 0, 0)
)

// CursorStyle defines the cursor appearance
type CursorStyle string

const (
	CursorBlock     CursorStyle = "block"
	CursorUnderline CursorStyle = "underline"
	CursorBar       CursorStyle = "bar"
)

// DebugOverlayCorner defines where to position the debug overlay
type DebugOverlayCorner uint8

const (
	DebugTopLeft DebugOverlayCorner = iota
	DebugTopRight
	DebugBottomLeft
	DebugBottomRight
)

// SetCursorPosition sets the cursor position and visibility for a specific renderer.
func SetCursorPosition(renderer *Renderer, x, y int32, visible bool) {
	if renderer == nil || renderer.ptr == nil {
		return
	}
	C.setCursorPosition(renderer.ptr, C.int32_t(x), C.int32_t(y), C.bool(visible))
}

// SetCursorStyle sets the cursor style and blinking state for a specific renderer.
func SetCursorStyle(renderer *Renderer, style CursorStyle, blinking bool) {
	if renderer == nil || renderer.ptr == nil {
		return
	}
	cStyle := C.CString(string(style))
	defer C.free(unsafe.Pointer(cStyle))
	C.setCursorStyle(renderer.ptr, (*C.uint8_t)(unsafe.Pointer(cStyle)), C.size_t(len(style)), C.bool(blinking))
}

// SetCursorColor sets the cursor color for a specific renderer.
func SetCursorColor(renderer *Renderer, color RGBA) {
	if renderer == nil || renderer.ptr == nil {
		return
	}
	C.setCursorColor(renderer.ptr, color.toCFloat())
}

// stringToC converts a Go string to C string parameters
func stringToC(s string) (*C.uint8_t, C.size_t) {
	if len(s) == 0 {
		return nil, 0
	}
	bytes := []byte(s)
	return (*C.uint8_t)(unsafe.Pointer(&bytes[0])), C.size_t(len(bytes))
}

// BorderSides represents which sides of a box border to draw
type BorderSides struct {
	Top    bool
	Right  bool
	Bottom bool
	Left   bool
}

// packBorderOptions packs border options into a single uint32
func packBorderOptions(sides BorderSides, fill bool, titleAlignment uint8) C.uint32_t {
	var packed C.uint32_t
	if sides.Top {
		packed |= 0b1000
	}
	if sides.Right {
		packed |= 0b0100
	}
	if sides.Bottom {
		packed |= 0b0010
	}
	if sides.Left {
		packed |= 0b0001
	}
	if fill {
		packed |= (1 << 4)
	}
	packed |= C.uint32_t(titleAlignment&0b11) << 5
	return packed
}

// TextAlignment defines text alignment options
type TextAlignment uint8

const (
	AlignLeft TextAlignment = iota
	AlignCenter
	AlignRight
)