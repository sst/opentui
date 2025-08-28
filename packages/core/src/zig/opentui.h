#ifndef OPENTUI_H
#define OPENTUI_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

// Opaque type definitions
typedef struct CliRenderer CliRenderer;
typedef struct OptimizedBuffer OptimizedBuffer;
typedef struct TextBuffer TextBuffer;

// Terminal capabilities structure
typedef struct {
    bool supports_truecolor;
    bool supports_mouse;
    bool supports_kitty_keyboard;
    bool supports_alternate_screen;
} Capabilities;

// RGBA color type - array of 4 floats [r, g, b, a]
typedef float RGBA[4];

// Renderer management functions
CliRenderer* createRenderer(uint32_t width, uint32_t height);
void setUseThread(CliRenderer* renderer, bool useThread);
void destroyRenderer(CliRenderer* renderer, bool useAlternateScreen, uint32_t splitHeight);
void setBackgroundColor(CliRenderer* renderer, const float* color);
void setRenderOffset(CliRenderer* renderer, uint32_t offset);
void updateStats(CliRenderer* renderer, double time, uint32_t fps, double frameCallbackTime);
void updateMemoryStats(CliRenderer* renderer, uint32_t heapUsed, uint32_t heapTotal, uint32_t arrayBuffers);
OptimizedBuffer* getNextBuffer(CliRenderer* renderer);
OptimizedBuffer* getCurrentBuffer(CliRenderer* renderer);
void render(CliRenderer* renderer, bool force);
void resizeRenderer(CliRenderer* renderer, uint32_t width, uint32_t height);
void enableMouse(CliRenderer* renderer, bool enableMovement);
void disableMouse(CliRenderer* renderer);

// Buffer management functions
OptimizedBuffer* createOptimizedBuffer(uint32_t width, uint32_t height, bool respectAlpha, uint8_t widthMethod);
void destroyOptimizedBuffer(OptimizedBuffer* buffer);
void destroyFrameBuffer(OptimizedBuffer* frameBuffer);
uint32_t getBufferWidth(OptimizedBuffer* buffer);
uint32_t getBufferHeight(OptimizedBuffer* buffer);

// Buffer drawing functions
void bufferClear(OptimizedBuffer* buffer, const float* bg);
uint32_t* bufferGetCharPtr(OptimizedBuffer* buffer);
float* bufferGetFgPtr(OptimizedBuffer* buffer);
float* bufferGetBgPtr(OptimizedBuffer* buffer);
uint8_t* bufferGetAttributesPtr(OptimizedBuffer* buffer);
bool bufferGetRespectAlpha(OptimizedBuffer* buffer);
void bufferSetRespectAlpha(OptimizedBuffer* buffer, bool respectAlpha);
void bufferDrawText(OptimizedBuffer* buffer, const uint8_t* text, size_t textLen, uint32_t x, uint32_t y, const float* fg, const float* bg, uint8_t attributes);
void bufferSetCellWithAlphaBlending(OptimizedBuffer* buffer, uint32_t x, uint32_t y, uint32_t char_code, const float* fg, const float* bg, uint8_t attributes);
void bufferFillRect(OptimizedBuffer* buffer, uint32_t x, uint32_t y, uint32_t width, uint32_t height, const float* bg);
void bufferDrawPackedBuffer(OptimizedBuffer* buffer, const uint8_t* data, size_t dataLen, uint32_t posX, uint32_t posY, uint32_t terminalWidthCells, uint32_t terminalHeightCells);
void bufferDrawSuperSampleBuffer(OptimizedBuffer* buffer, uint32_t x, uint32_t y, const uint8_t* pixelData, size_t len, uint8_t format, uint32_t alignedBytesPerRow);
void bufferDrawBox(OptimizedBuffer* buffer, int32_t x, int32_t y, uint32_t width, uint32_t height, const uint32_t* borderChars, uint32_t packedOptions, const float* borderColor, const float* backgroundColor, const uint8_t* title, uint32_t titleLen);
void bufferResize(OptimizedBuffer* buffer, uint32_t width, uint32_t height);
void drawFrameBuffer(OptimizedBuffer* target, int32_t destX, int32_t destY, OptimizedBuffer* frameBuffer, uint32_t sourceX, uint32_t sourceY, uint32_t sourceWidth, uint32_t sourceHeight);

// Cursor functions  
void setCursorPosition(CliRenderer* renderer, int32_t x, int32_t y, bool visible);
void setCursorStyle(CliRenderer* renderer, const uint8_t* style, size_t styleLen, bool blinking);
void setCursorColor(CliRenderer* renderer, const float* color);

// Terminal capability functions
void getTerminalCapabilities(CliRenderer* renderer, Capabilities* caps);
void processCapabilityResponse(CliRenderer* renderer, const uint8_t* response, size_t responseLen);

// Debug and utility functions
void setDebugOverlay(CliRenderer* renderer, bool enabled, uint8_t corner);
void clearTerminal(CliRenderer* renderer);
void addToHitGrid(CliRenderer* renderer, int32_t x, int32_t y, uint32_t width, uint32_t height, uint32_t id);
uint32_t checkHit(CliRenderer* renderer, uint32_t x, uint32_t y);
void dumpHitGrid(CliRenderer* renderer);
void dumpBuffers(CliRenderer* renderer, int64_t timestamp);
void dumpStdoutBuffer(CliRenderer* renderer, int64_t timestamp);

// Keyboard and terminal setup functions
void enableKittyKeyboard(CliRenderer* renderer, uint8_t flags);
void disableKittyKeyboard(CliRenderer* renderer);
void setupTerminal(CliRenderer* renderer, bool useAlternateScreen);

// TextBuffer functions
TextBuffer* createTextBuffer(uint32_t length, uint8_t widthMethod);
void destroyTextBuffer(TextBuffer* textBuffer);
uint32_t* textBufferGetCharPtr(TextBuffer* textBuffer);
float* textBufferGetFgPtr(TextBuffer* textBuffer);
float* textBufferGetBgPtr(TextBuffer* textBuffer);
uint16_t* textBufferGetAttributesPtr(TextBuffer* textBuffer);
uint32_t textBufferGetLength(TextBuffer* textBuffer);
void textBufferSetCell(TextBuffer* textBuffer, uint32_t index, uint32_t char_code, const float* fg, const float* bg, uint16_t attr);
TextBuffer* textBufferConcat(TextBuffer* tb1, TextBuffer* tb2);
void textBufferResize(TextBuffer* textBuffer, uint32_t newLength);
void textBufferReset(TextBuffer* textBuffer);
void textBufferSetSelection(TextBuffer* textBuffer, uint32_t start, uint32_t end, const float* bgColor, const float* fgColor);
void textBufferResetSelection(TextBuffer* textBuffer);
void textBufferSetDefaultFg(TextBuffer* textBuffer, const float* fg);
void textBufferSetDefaultBg(TextBuffer* textBuffer, const float* bg);
void textBufferSetDefaultAttributes(TextBuffer* textBuffer, const uint8_t* attr);
void textBufferResetDefaults(TextBuffer* textBuffer);
uint32_t textBufferWriteChunk(TextBuffer* textBuffer, const uint8_t* textBytes, uint32_t textLen, const float* fg, const float* bg, const uint8_t* attr);
uint32_t textBufferGetCapacity(TextBuffer* textBuffer);
void textBufferFinalizeLineInfo(TextBuffer* textBuffer);
const uint32_t* textBufferGetLineStartsPtr(TextBuffer* textBuffer);
const uint32_t* textBufferGetLineWidthsPtr(TextBuffer* textBuffer);
uint32_t textBufferGetLineCount(TextBuffer* textBuffer);
void bufferDrawTextBuffer(OptimizedBuffer* buffer, TextBuffer* textBuffer, int32_t x, int32_t y, int32_t clipX, int32_t clipY, uint32_t clipWidth, uint32_t clipHeight, bool hasClipRect);

#ifdef __cplusplus
}
#endif

#endif // OPENTUI_H