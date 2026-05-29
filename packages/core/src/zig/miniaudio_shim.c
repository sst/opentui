#define MINIAUDIO_IMPLEMENTATION

#if defined(__linux__)
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_ALSA
#define MA_ENABLE_PULSEAUDIO
#endif

#if defined(__APPLE__)
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_COREAUDIO
#endif

#if defined(__FreeBSD__)
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_OSS
#endif

#if defined(_WIN32)
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_WASAPI
#define MA_ENABLE_DSOUND
#define MA_ENABLE_WINMM
#endif

#include "vendor/miniaudio/miniaudio.h"
