#include "vterm_wrapper.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int cursor_row;
    int cursor_col;
    int cursor_visible;
    int damage_pending;
    VTermRect damage_rect;
    VTermScreenCallbacks callbacks;
} VTermWrapperCallbackContext;

// Core VTerm operations
VTerm* vterm_wrapper_new(int rows, int cols) {
    return vterm_new(rows, cols);
}

void vterm_wrapper_free(VTerm *vt) {
    vterm_free(vt);
}

void vterm_wrapper_set_size(VTerm *vt, int rows, int cols) {
    vterm_set_size(vt, rows, cols);
}

void vterm_wrapper_set_utf8(VTerm *vt, int is_utf8) {
    vterm_set_utf8(vt, is_utf8);
}

size_t vterm_wrapper_input_write(VTerm *vt, const char *bytes, size_t len) {
    if (!vt || !bytes) return 0;
    return vterm_input_write(vt, bytes, len);
}

// Screen operations
VTermScreen* vterm_wrapper_obtain_screen(VTerm *vt) {
    return vterm_obtain_screen(vt);
}

void vterm_wrapper_screen_enable_altscreen(VTermScreen *screen, int altscreen) {
    vterm_screen_enable_altscreen(screen, altscreen);
}

void vterm_wrapper_screen_flush_damage(VTermScreen *screen) {
    vterm_screen_flush_damage(screen);
}

void vterm_wrapper_screen_reset(VTermScreen *screen, int hard) {
    vterm_screen_reset(screen, hard);
}

int vterm_wrapper_screen_get_cell(VTermScreen *screen, int row, int col, 
                                 uint32_t *chars, char *width,
                                 int *bold, int *underline, int *italic, int *blink,
                                 int *reverse, int *conceal, int *strike,
                                 int *fg_r, int *fg_g, int *fg_b, int *fg_default,
                                 int *bg_r, int *bg_g, int *bg_b, int *bg_default) {
    VTermPos pos = { .row = row, .col = col };
    VTermScreenCell cell;
    
    int result = vterm_screen_get_cell(screen, pos, &cell);
    if (result == 0) return 0;
    
    // Copy character data
    for (int i = 0; i < VTERM_MAX_CHARS_PER_CELL && i < 6; i++) {
        chars[i] = cell.chars[i];
    }
    *width = cell.width;
    
    // Copy attributes
    *bold = cell.attrs.bold;
    *underline = cell.attrs.underline;
    *italic = cell.attrs.italic;
    *blink = cell.attrs.blink;
    *reverse = cell.attrs.reverse;
    *conceal = cell.attrs.conceal;
    *strike = cell.attrs.strike;
    
    // Copy colors
    VTermColor fg = cell.fg;
    const int fg_is_default = VTERM_COLOR_IS_DEFAULT_FG(&fg);
    if (!VTERM_COLOR_IS_RGB(&fg)) {
        // Convert palette or indexed colours to RGB so Zig can render them correctly
        vterm_screen_convert_color_to_rgb(screen, &fg);
    }
    *fg_r = fg.rgb.red;
    *fg_g = fg.rgb.green;
    *fg_b = fg.rgb.blue;
    *fg_default = fg_is_default;

    VTermColor bg = cell.bg;
    const int bg_is_default = VTERM_COLOR_IS_DEFAULT_BG(&bg);
    if (!VTERM_COLOR_IS_RGB(&bg)) {
        vterm_screen_convert_color_to_rgb(screen, &bg);
    }
    *bg_r = bg.rgb.red;
    *bg_g = bg.rgb.green;
    *bg_b = bg.rgb.blue;
    *bg_default = bg_is_default;
    
    return 1;
}

// State operations
VTermState* vterm_wrapper_obtain_state(VTerm *vt) {
    return vterm_obtain_state(vt);
}

void vterm_wrapper_state_get_cursorpos(VTermState *state, int *row, int *col) {
    if (!state || !row || !col) return;

    VTermPos pos;
    vterm_state_get_cursorpos(state, &pos);
    *row = pos.row;
    *col = pos.col;
}

void vterm_wrapper_state_get_default_colors(
    VTermState *state,
    int *fg_r,
    int *fg_g,
    int *fg_b,
    int *bg_r,
    int *bg_g,
    int *bg_b) {
    if (!state) {
        if (fg_r) *fg_r = 255;
        if (fg_g) *fg_g = 255;
        if (fg_b) *fg_b = 255;
        if (bg_r) *bg_r = 0;
        if (bg_g) *bg_g = 0;
        if (bg_b) *bg_b = 0;
        return;
    }

    VTermColor fg;
    VTermColor bg;
    vterm_state_get_default_colors(state, &fg, &bg);

    if (!VTERM_COLOR_IS_RGB(&fg)) {
        vterm_state_convert_color_to_rgb(state, &fg);
    }
    if (!VTERM_COLOR_IS_RGB(&bg)) {
        vterm_state_convert_color_to_rgb(state, &bg);
    }

    if (fg_r) *fg_r = fg.rgb.red;
    if (fg_g) *fg_g = fg.rgb.green;
    if (fg_b) *fg_b = fg.rgb.blue;
    if (bg_r) *bg_r = bg.rgb.red;
    if (bg_g) *bg_g = bg.rgb.green;
    if (bg_b) *bg_b = bg.rgb.blue;
}

// Input operations
void vterm_wrapper_keyboard_unichar(VTerm *vt, uint32_t c, unsigned int mod) {
    vterm_keyboard_unichar(vt, c, (VTermModifier)mod);
}

void vterm_wrapper_keyboard_key(VTerm *vt, unsigned int key, unsigned int mod) {
    vterm_keyboard_key(vt, (VTermKey)key, (VTermModifier)mod);
}

void vterm_wrapper_mouse_move(VTerm *vt, int row, int col, unsigned int mod) {
    vterm_mouse_move(vt, row, col, (VTermModifier)mod);
}

void vterm_wrapper_mouse_button(VTerm *vt, int button, int pressed, unsigned int mod) {
    vterm_mouse_button(vt, button, pressed, (VTermModifier)mod);
}

// Internal callback wrappers
static int damage_wrapper(VTermRect rect, void *user) {
    VTermWrapperCallbackContext *ctx = (VTermWrapperCallbackContext *)user;
    if (ctx) {
        ctx->damage_pending = 1;
        ctx->damage_rect = rect;
    }
    return 1;
}

static int movecursor_wrapper(VTermPos pos, VTermPos oldpos, int visible, void *user) {
    VTermWrapperCallbackContext *ctx = (VTermWrapperCallbackContext *)user;
    if (ctx) {
        ctx->cursor_row = pos.row;
        ctx->cursor_col = pos.col;
        ctx->cursor_visible = visible;
    }
    return 1;
}

void vterm_wrapper_enable_callbacks(VTermScreen *screen) {
    VTermWrapperCallbackContext *ctx = (VTermWrapperCallbackContext *)vterm_screen_get_cbdata(screen);
    if (ctx) {
        memset(ctx, 0, sizeof(VTermWrapperCallbackContext));
    } else {
        ctx = (VTermWrapperCallbackContext *)calloc(1, sizeof(VTermWrapperCallbackContext));
        if (!ctx) {
            return;
        }
    }

    memset(&ctx->callbacks, 0, sizeof(ctx->callbacks));
    ctx->callbacks.damage = damage_wrapper;
    ctx->callbacks.movecursor = movecursor_wrapper;

    vterm_screen_set_callbacks(screen, &ctx->callbacks, ctx);
}

void vterm_wrapper_disable_callbacks(VTermScreen *screen) {
    VTermWrapperCallbackContext *ctx = (VTermWrapperCallbackContext *)vterm_screen_get_cbdata(screen);
    if (ctx) {
        free(ctx);
    }

    VTermScreenCallbacks empty_callbacks;
    memset(&empty_callbacks, 0, sizeof(empty_callbacks));
    vterm_screen_set_callbacks(screen, &empty_callbacks, NULL);
}

void vterm_wrapper_poll_callbacks(
    VTermScreen *screen,
    int *cursor_row,
    int *cursor_col,
    int *cursor_visible,
    int *damage_pending,
    VTermRect *damage_rect) {
    VTermWrapperCallbackContext *ctx = (VTermWrapperCallbackContext *)vterm_screen_get_cbdata(screen);
    if (!ctx) {
        if (cursor_row) *cursor_row = -1;
        if (cursor_col) *cursor_col = -1;
        if (cursor_visible) *cursor_visible = -1;
        if (damage_pending) *damage_pending = 0;
        if (damage_rect) memset(damage_rect, 0, sizeof(VTermRect));
        return;
    }

    if (cursor_row) *cursor_row = ctx->cursor_row;
    if (cursor_col) *cursor_col = ctx->cursor_col;
    if (cursor_visible) *cursor_visible = ctx->cursor_visible;
    if (damage_pending) {
        *damage_pending = ctx->damage_pending;
        if (ctx->damage_pending && damage_rect) {
            *damage_rect = ctx->damage_rect;
        }
        ctx->damage_pending = 0;
    } else if (damage_rect) {
        memset(damage_rect, 0, sizeof(VTermRect));
    }
}
