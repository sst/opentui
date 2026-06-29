#import <AppKit/AppKit.h>

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum {
    OT_CLIPBOARD_MACOS_STATUS_OK = 0,
    OT_CLIPBOARD_MACOS_STATUS_EMPTY = 1,
    OT_CLIPBOARD_MACOS_STATUS_LIMIT_EXCEEDED = 2,
    OT_CLIPBOARD_MACOS_STATUS_INVALID_ARGUMENT = 3,
    OT_CLIPBOARD_MACOS_STATUS_INVALID_TEXT = 4,
    OT_CLIPBOARD_MACOS_STATUS_FAILED = 5,
};

enum {
    OT_CLIPBOARD_MACOS_MIME_TEXT_PLAIN = 1,
    OT_CLIPBOARD_MACOS_MIME_IMAGE_PNG = 2,
};

int32_t ot_clipboard_macos_read(const uint32_t *preferred, uint32_t preferred_count, uint32_t max_bytes,
                                uint8_t **out_bytes, uint32_t *out_length, uint32_t *out_mime) {
    if (out_bytes == NULL || out_length == NULL || out_mime == NULL ||
        (preferred_count > 0 && preferred == NULL)) {
        return OT_CLIPBOARD_MACOS_STATUS_INVALID_ARGUMENT;
    }

    *out_bytes = NULL;
    *out_length = 0;
    *out_mime = 0;

    @autoreleasepool {
        @try {
            NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
            for (uint32_t index = 0; index < preferred_count; index++) {
                uint32_t mime = preferred[index];
                const void *source = NULL;
                NSUInteger length = 0;
                NSString *text = nil;
                NSData *data = nil;

                if (mime == OT_CLIPBOARD_MACOS_MIME_TEXT_PLAIN) {
                    text = [pasteboard stringForType:NSPasteboardTypeString];
                    if (text == nil) {
                        continue;
                    }
                    length = [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
                    source = [text UTF8String];
                } else if (mime == OT_CLIPBOARD_MACOS_MIME_IMAGE_PNG) {
                    data = [pasteboard dataForType:NSPasteboardTypePNG];
                    if (data == nil) {
                        continue;
                    }
                    length = [data length];
                    if (length == 0) {
                        continue;
                    }
                    source = [data bytes];
                } else {
                    continue;
                }

                if (length > max_bytes || length > UINT32_MAX) {
                    return OT_CLIPBOARD_MACOS_STATUS_LIMIT_EXCEEDED;
                }
                if (length > 0 && source == NULL) {
                    return OT_CLIPBOARD_MACOS_STATUS_FAILED;
                }

                uint8_t *copy = NULL;
                if (length > 0) {
                    copy = malloc(length);
                    if (copy == NULL) {
                        return OT_CLIPBOARD_MACOS_STATUS_FAILED;
                    }
                    memcpy(copy, source, length);
                }

                *out_bytes = copy;
                *out_length = (uint32_t)length;
                *out_mime = mime;
                return OT_CLIPBOARD_MACOS_STATUS_OK;
            }
            return OT_CLIPBOARD_MACOS_STATUS_EMPTY;
        } @catch (__unused NSException *exception) {
            return OT_CLIPBOARD_MACOS_STATUS_FAILED;
        }
    }
}

int32_t ot_clipboard_macos_write_text(const uint8_t *bytes, uint32_t length) {
    if (length > 0 && bytes == NULL) {
        return OT_CLIPBOARD_MACOS_STATUS_INVALID_ARGUMENT;
    }

    @autoreleasepool {
        @try {
            NSString *text = length == 0
                                 ? @""
                                 : [[NSString alloc] initWithBytes:bytes
                                                          length:length
                                                        encoding:NSUTF8StringEncoding];
            if (text == nil) {
                return OT_CLIPBOARD_MACOS_STATUS_INVALID_TEXT;
            }

            NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
            [pasteboard clearContents];
            if (![pasteboard setString:text forType:NSPasteboardTypeString]) {
                return OT_CLIPBOARD_MACOS_STATUS_FAILED;
            }
            return OT_CLIPBOARD_MACOS_STATUS_OK;
        } @catch (__unused NSException *exception) {
            return OT_CLIPBOARD_MACOS_STATUS_FAILED;
        }
    }
}

int32_t ot_clipboard_macos_clear(void) {
    @autoreleasepool {
        @try {
            [[NSPasteboard generalPasteboard] clearContents];
            return OT_CLIPBOARD_MACOS_STATUS_OK;
        } @catch (__unused NSException *exception) {
            return OT_CLIPBOARD_MACOS_STATUS_FAILED;
        }
    }
}

void ot_clipboard_macos_free_bytes(uint8_t *bytes, uint32_t length) {
    (void)length;
    free(bytes);
}
