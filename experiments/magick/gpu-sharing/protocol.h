#ifndef GPU_SHARING_PROTOCOL_H
#define GPU_SHARING_PROTOCOL_H
#include <errno.h>
#include <inttypes.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

enum { SLOT_COUNT = 2, FRAME_COUNT = 8, DIMENSION_MAX = 2048, WAIT_MS = 5000 };
enum { HELLO = 1, REGISTER, FRAME, RELEASE, STOP };
static bool is_producer = true;
static int connection = -1;
static uint32_t width, height;

/* Local-only protocol: fixed messages, one descriptor, no pixel payload. */
struct packet {
    uint32_t kind, slot, sequence, width, height, fourcc, stride, offset;
    uint64_t modifier;
    uint32_t external_family, old_layout, new_layout, vendor_id, device_id, reserved;
};
_Static_assert(sizeof(struct packet) == 64, "Protocol layout changed");

static void fail(const char *operation, int64_t code) {
    fprintf(stderr, "{\"status\":\"fail\",\"role\":\"%s\",\"operation\":\"%s\",\"code\":%" PRId64 "}\n",
            is_producer ? "producer" : "consumer", operation, code);
    exit(EXIT_FAILURE);
}

#define REQUIRE(test, operation)                                                                                       \
    do {                                                                                                               \
        if (!(test))                                                                                                   \
            fail(operation, errno);                                                                                    \
    } while (0)

static void send_packet(struct packet packet, int fd) {
    union {
        struct cmsghdr align;
        char data[CMSG_SPACE(sizeof(int))];
    } control = {0};
    struct iovec iov = {.iov_base = &packet, .iov_len = sizeof(packet)};
    struct msghdr message = {.msg_iov = &iov, .msg_iovlen = 1};
    if (fd >= 0) {
        message.msg_control = control.data;
        message.msg_controllen = sizeof(control.data);
        struct cmsghdr *header = CMSG_FIRSTHDR(&message);
        header->cmsg_level = SOL_SOCKET;
        header->cmsg_type = SCM_RIGHTS;
        header->cmsg_len = CMSG_LEN(sizeof(int));
        memcpy(CMSG_DATA(header), &fd, sizeof(fd));
    }
    struct pollfd poll_fd = {.fd = connection, .events = POLLOUT};
    REQUIRE(poll(&poll_fd, 1, WAIT_MS) == 1, "send poll timeout/error");
    REQUIRE(sendmsg(connection, &message, MSG_NOSIGNAL | MSG_DONTWAIT) == sizeof(packet), "sendmsg");
}

static struct packet receive_packet(uint32_t kind, bool with_fd, int *fd) {
    struct packet packet = {0};
    union {
        struct cmsghdr align;
        char data[CMSG_SPACE(sizeof(int))];
    } control = {0};
    struct iovec iov = {.iov_base = &packet, .iov_len = sizeof(packet)};
    struct msghdr message = {
        .msg_iov = &iov, .msg_iovlen = 1, .msg_control = control.data, .msg_controllen = sizeof(control.data)};
    struct pollfd poll_fd = {.fd = connection, .events = POLLIN};
    REQUIRE(poll(&poll_fd, 1, WAIT_MS) == 1, "receive poll timeout/error");
    REQUIRE(recvmsg(connection, &message, MSG_CMSG_CLOEXEC | MSG_DONTWAIT) == sizeof(packet), "recvmsg size/EOF");
    REQUIRE(!(message.msg_flags & (MSG_TRUNC | MSG_CTRUNC)), "recvmsg truncation");
    struct cmsghdr *header = CMSG_FIRSTHDR(&message);
    REQUIRE((header != NULL) == with_fd, "descriptor count");
    if (with_fd) {
        REQUIRE(header->cmsg_level == SOL_SOCKET && header->cmsg_type == SCM_RIGHTS &&
                    header->cmsg_len == CMSG_LEN(sizeof(int)),
                "descriptor ancillary data");
        memcpy(fd, CMSG_DATA(header), sizeof(*fd));
        REQUIRE(*fd >= 0 && CMSG_NXTHDR(&message, header) == NULL, "descriptor bounds");
    }
    REQUIRE(packet.kind == kind, "packet kind");
    return packet;
}

static void verify_pixels(const uint8_t *pixels, uint32_t sequence) {
    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width; x++) {
            uint8_t expected[4] = {(x * 17 + sequence * 43) & 255, (y * 29 + sequence * 71) & 255,
                                   ((x ^ y) * 13 + sequence * 19) & 255, 255};
            size_t offset = ((size_t)y * width + x) * 4;
            for (uint32_t channel = 0; channel < 4; channel++) {
                int difference = (int)pixels[offset + channel] - expected[channel];
                if (difference < -1 || difference > 1) {
                    fprintf(stderr, "pixel mismatch sequence=%u x=%u y=%u channel=%u expected=%u actual=%u\n", sequence,
                            x, y, channel, expected[channel], pixels[offset + channel]);
                    fail("sampled pixel mismatch", difference);
                }
            }
        }
    }
}
#endif
