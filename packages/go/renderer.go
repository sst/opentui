package opentui

/*
#include "opentui.h"
#include <stdlib.h>
*/
import "C"
import (
	"unsafe"
)

// Renderer wraps the CliRenderer from the C library.
// It provides high-level access to terminal rendering functionality.
type Renderer struct {
	ptr *C.CliRenderer
}

// NewRenderer creates a new renderer with the specified dimensions.
// Returns nil if the renderer could not be created.
func NewRenderer(width, height uint32) *Renderer {
	if width == 0 || height == 0 {
		return nil
	}
	
	ptr := C.createRenderer(C.uint32_t(width), C.uint32_t(height))
	if ptr == nil {
		return nil
	}
	
	r := &Renderer{ptr: ptr}
	setFinalizer(r, func(r *Renderer) { r.Close() })
	return r
}

// Close destroys the renderer and releases its resources.
// After calling Close, the renderer should not be used.
func (r *Renderer) Close() error {
	if r.ptr != nil {
		clearFinalizer(r)
		C.destroyRenderer(r.ptr, C.bool(false), C.uint32_t(0))
		r.ptr = nil
	}
	return nil
}

// CloseWithOptions destroys the renderer with specific cleanup options.
func (r *Renderer) CloseWithOptions(useAlternateScreen bool, splitHeight uint32) error {
	if r.ptr != nil {
		clearFinalizer(r)
		C.destroyRenderer(r.ptr, C.bool(useAlternateScreen), C.uint32_t(splitHeight))
		r.ptr = nil
	}
	return nil
}

// SetUseThread enables or disables threaded rendering.
func (r *Renderer) SetUseThread(useThread bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setUseThread(r.ptr, C.bool(useThread))
	return nil
}

// SetBackgroundColor sets the global background color for the renderer.
func (r *Renderer) SetBackgroundColor(color RGBA) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setBackgroundColor(r.ptr, color.toCFloat())
	return nil
}

// SetRenderOffset sets the vertical offset for rendering.
func (r *Renderer) SetRenderOffset(offset uint32) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setRenderOffset(r.ptr, C.uint32_t(offset))
	return nil
}

// UpdateStats updates the renderer's performance statistics.
func (r *Renderer) UpdateStats(stats Stats) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.updateStats(r.ptr, C.double(stats.Time), C.uint32_t(stats.FPS), C.double(stats.FrameCallbackTime))
	return nil
}

// UpdateMemoryStats updates the renderer's memory usage statistics.
func (r *Renderer) UpdateMemoryStats(stats MemoryStats) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.updateMemoryStats(r.ptr, C.uint32_t(stats.HeapUsed), C.uint32_t(stats.HeapTotal), C.uint32_t(stats.ArrayBuffers))
	return nil
}

// GetNextBuffer returns the next buffer for rendering.
// This buffer can be used to draw content that will be displayed on the next render.
func (r *Renderer) GetNextBuffer() (*Buffer, error) {
	if r.ptr == nil {
		return nil, newError("renderer is closed")
	}
	
	bufferPtr := C.getNextBuffer(r.ptr)
	if bufferPtr == nil {
		return nil, newError("failed to get next buffer")
	}
	
	// Don't set a finalizer for buffers obtained from renderer,
	// they are managed by the renderer itself
	return &Buffer{ptr: bufferPtr, managed: true}, nil
}

// GetCurrentBuffer returns the current buffer being rendered.
func (r *Renderer) GetCurrentBuffer() (*Buffer, error) {
	if r.ptr == nil {
		return nil, newError("renderer is closed")
	}
	
	bufferPtr := C.getCurrentBuffer(r.ptr)
	if bufferPtr == nil {
		return nil, newError("failed to get current buffer")
	}
	
	return &Buffer{ptr: bufferPtr, managed: true}, nil
}

// Render renders the current buffer to the terminal.
// If force is true, forces a complete re-render even if nothing has changed.
func (r *Renderer) Render(force bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.render(r.ptr, C.bool(force))
	return nil
}

// Resize changes the renderer dimensions.
func (r *Renderer) Resize(width, height uint32) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	if width == 0 || height == 0 {
		return newError("invalid dimensions")
	}
	C.resizeRenderer(r.ptr, C.uint32_t(width), C.uint32_t(height))
	return nil
}

// EnableMouse enables mouse tracking.
// If enableMovement is true, also tracks mouse movement events.
func (r *Renderer) EnableMouse(enableMovement bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.enableMouse(r.ptr, C.bool(enableMovement))
	return nil
}

// DisableMouse disables mouse tracking.
func (r *Renderer) DisableMouse() error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.disableMouse(r.ptr)
	return nil
}

// SetDebugOverlay enables or disables the debug overlay.
func (r *Renderer) SetDebugOverlay(enabled bool, corner DebugOverlayCorner) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setDebugOverlay(r.ptr, C.bool(enabled), C.uint8_t(corner))
	return nil
}

// ClearTerminal clears the terminal screen.
func (r *Renderer) ClearTerminal() error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.clearTerminal(r.ptr)
	return nil
}

// AddToHitGrid adds a rectangular area to the mouse hit testing grid.
// When the mouse is clicked in this area, the specified ID will be returned.
func (r *Renderer) AddToHitGrid(x, y int32, width, height, id uint32) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.addToHitGrid(r.ptr, C.int32_t(x), C.int32_t(y), C.uint32_t(width), C.uint32_t(height), C.uint32_t(id))
	return nil
}

// CheckHit performs a hit test at the specified coordinates.
// Returns the ID of the hit area, or 0 if no hit was found.
func (r *Renderer) CheckHit(x, y uint32) (uint32, error) {
	if r.ptr == nil {
		return 0, newError("renderer is closed")
	}
	id := C.checkHit(r.ptr, C.uint32_t(x), C.uint32_t(y))
	return uint32(id), nil
}

// DumpHitGrid outputs debug information about the hit testing grid.
func (r *Renderer) DumpHitGrid() error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.dumpHitGrid(r.ptr)
	return nil
}

// DumpBuffers outputs debug information about the renderer buffers.
func (r *Renderer) DumpBuffers(timestamp int64) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.dumpBuffers(r.ptr, C.int64_t(timestamp))
	return nil
}

// DumpStdoutBuffer outputs debug information about the stdout buffer.
func (r *Renderer) DumpStdoutBuffer(timestamp int64) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.dumpStdoutBuffer(r.ptr, C.int64_t(timestamp))
	return nil
}

// GetTerminalCapabilities returns the current terminal capabilities.
func (r *Renderer) GetTerminalCapabilities() (*Capabilities, error) {
	if r.ptr == nil {
		return nil, newError("renderer is closed")
	}
	
	var caps C.Capabilities
	C.getTerminalCapabilities(r.ptr, &caps)
	
	return &Capabilities{
		SupportsTruecolor:       bool(caps.supports_truecolor),
		SupportsMouse:          bool(caps.supports_mouse),
		SupportsKittyKeyboard:  bool(caps.supports_kitty_keyboard),
		SupportsAlternateScreen: bool(caps.supports_alternate_screen),
	}, nil
}

// ProcessCapabilityResponse processes a terminal capability response.
func (r *Renderer) ProcessCapabilityResponse(response []byte) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	if len(response) == 0 {
		return nil
	}
	
	responsePtr, responseLen := sliceToC(response)
	C.processCapabilityResponse(r.ptr, (*C.uint8_t)(responsePtr), C.size_t(responseLen))
	return nil
}

// EnableKittyKeyboard enables the Kitty keyboard protocol with the specified flags.
func (r *Renderer) EnableKittyKeyboard(flags uint8) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.enableKittyKeyboard(r.ptr, C.uint8_t(flags))
	return nil
}

// DisableKittyKeyboard disables the Kitty keyboard protocol.
func (r *Renderer) DisableKittyKeyboard() error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.disableKittyKeyboard(r.ptr)
	return nil
}

// SetupTerminal sets up the terminal with optional alternate screen buffer.
func (r *Renderer) SetupTerminal(useAlternateScreen bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setupTerminal(r.ptr, C.bool(useAlternateScreen))
	return nil
}

// SetCursorPosition sets the cursor position and visibility.
func (r *Renderer) SetCursorPosition(x, y int32, visible bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setCursorPosition(r.ptr, C.int32_t(x), C.int32_t(y), C.bool(visible))
	return nil
}

// SetCursorStyle sets the cursor style and blinking state.
func (r *Renderer) SetCursorStyle(style CursorStyle, blinking bool) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	cStyle := C.CString(string(style))
	defer C.free(unsafe.Pointer(cStyle))
	C.setCursorStyle(r.ptr, (*C.uint8_t)(unsafe.Pointer(cStyle)), C.size_t(len(style)), C.bool(blinking))
	return nil
}

// SetCursorColor sets the cursor color.
func (r *Renderer) SetCursorColor(color RGBA) error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	C.setCursorColor(r.ptr, color.toCFloat())
	return nil
}

// Valid checks if the renderer is still valid (not closed).
func (r *Renderer) Valid() bool {
	return r.ptr != nil
}

// ensureRenderer is a helper that checks if renderer is valid
func (r *Renderer) ensureValid() error {
	if r.ptr == nil {
		return newError("renderer is closed")
	}
	return nil
}