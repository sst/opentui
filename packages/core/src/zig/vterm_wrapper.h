#ifndef VTERM_WRAPPER_H
#define VTERM_WRAPPER_H

// Include the full libvterm header
#include <vterm.h>

// Wrapper functions to avoid problematic types in Zig FFI
// These functions work around Zig's @cImport limitations with opaque types

// Core VTerm operations
VTerm* vterm_wrapper_new(int rows, int cols);
void vterm_wrapper_free(VTerm *vt);
void vterm_wrapper_set_size(VTerm *vt, int rows, int cols);
void vterm_wrapper_set_utf8(VTerm *vt, int is_utf8);
size_t vterm_wrapper_input_write(VTerm *vt, const char *bytes, size_t len);

// Screen operations
VTermScreen* vterm_wrapper_obtain_screen(VTerm *vt);
void vterm_wrapper_screen_enable_altscreen(VTermScreen *screen, int altscreen);
void vterm_wrapper_screen_flush_damage(VTermScreen *screen);
void vterm_wrapper_screen_reset(VTermScreen *screen, int hard);
int vterm_wrapper_screen_get_cell(VTermScreen *screen, int row, int col, 
                                 uint32_t *chars, char *width,
                                 int *bold, int *underline, int *italic, int *blink,
                                 int *reverse, int *conceal, int *strike,
                                 int *fg_r, int *fg_g, int *fg_b, int *fg_default,
                                 int *bg_r, int *bg_g, int *bg_b, int *bg_default);

// State operations  
VTermState* vterm_wrapper_obtain_state(VTerm *vt);

// Input operations
void vterm_wrapper_keyboard_unichar(VTerm *vt, uint32_t c, unsigned int mod);
void vterm_wrapper_keyboard_key(VTerm *vt, unsigned int key, unsigned int mod);
void vterm_wrapper_mouse_move(VTerm *vt, int row, int col, unsigned int mod);
void vterm_wrapper_mouse_button(VTerm *vt, int button, int pressed, unsigned int mod);

// State queries
void vterm_wrapper_state_get_cursorpos(VTermState *state, int *row, int *col);
void vterm_wrapper_state_get_default_colors(
    VTermState *state,
    int *fg_r,
    int *fg_g,
    int *fg_b,
    int *bg_r,
    int *bg_g,
    int *bg_b);

void vterm_wrapper_enable_callbacks(VTermScreen *screen);
void vterm_wrapper_disable_callbacks(VTermScreen *screen);
void vterm_wrapper_poll_callbacks(
    VTermScreen *screen,
    int *cursor_row,
    int *cursor_col,
    int *cursor_visible,
    int *damage_pending,
    VTermRect *damage_rect);

#endif // VTERM_WRAPPER_H
