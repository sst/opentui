const std = @import("std");
const audio = @import("../audio.zig");
const image = @import("../image.zig");
const video = @import("../video.zig");

const asset = "../tests/fixtures/video/dragon.mp4";

fn openVideo() !*video.Video {
    std.fs.cwd().access(asset, .{}) catch return error.SkipZigTest;
    return video.Video.open(std.testing.allocator, asset, false);
}

fn openVideoExternalAudio() !*video.Video {
    std.fs.cwd().access(asset, .{}) catch return error.SkipZigTest;
    return video.Video.open(std.testing.allocator, asset, true);
}

fn quantize6(value: u8) u8 {
    return @intCast(((@as(u32, value >> 2) * 255) + 31) / 63);
}

fn quantize7(value: u8) u8 {
    return @intCast(((@as(u32, value >> 1) * 255) + 63) / 127);
}

fn quantize5(value: u8) u8 {
    return @intCast(((@as(u32, value >> 3) * 255) + 15) / 31);
}

fn quantize4(value: u8) u8 {
    return @intCast(((@as(u32, value >> 4) * 255) + 7) / 15);
}

test "video PNG defaults to lossless RGB888 and supports adaptive RGB tiers" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(16, 16, false);
    _ = try value.update(0);

    const lossless = try image.decode(std.testing.allocator, value.current_image.?.encoded_png.?, .{});
    defer lossless.deinit();
    try std.testing.expectEqualSlices(u8, value.current_image.?.pixels, lossless.pixels);

    try value.configurePng(1, 4, 5);
    _ = try value.update(0);
    const rgb666 = try image.decode(std.testing.allocator, value.current_image.?.encoded_png.?, .{});
    defer rgb666.deinit();
    for (value.current_image.?.pixels, rgb666.pixels, 0..) |source, encoded, index| {
        if (index % 4 == 3)
            try std.testing.expectEqual(@as(u8, 255), encoded)
        else
            try std.testing.expectEqual(quantize6(source), encoded);
    }

    try value.configurePng(1, 2, 6);
    _ = try value.update(0);
    const rgb777 = try image.decode(std.testing.allocator, value.current_image.?.encoded_png.?, .{});
    defer rgb777.deinit();
    for (value.current_image.?.pixels, rgb777.pixels, 0..) |source, encoded, index| {
        if (index % 4 == 3)
            try std.testing.expectEqual(@as(u8, 255), encoded)
        else
            try std.testing.expectEqual(quantize7(source), encoded);
    }

    try value.configurePng(1, 4, 7);
    _ = try value.update(0);
    const rgb555 = try image.decode(std.testing.allocator, value.current_image.?.encoded_png.?, .{});
    defer rgb555.deinit();
    for (value.current_image.?.pixels, rgb555.pixels, 0..) |source, encoded, index| {
        if (index % 4 == 3)
            try std.testing.expectEqual(@as(u8, 255), encoded)
        else
            try std.testing.expectEqual(quantize5(source), encoded);
    }

    try value.configurePng(1, 4, 8);
    _ = try value.update(0);
    const rgb454 = try image.decode(std.testing.allocator, value.current_image.?.encoded_png.?, .{});
    defer rgb454.deinit();
    for (value.current_image.?.pixels, rgb454.pixels, 0..) |source, encoded, index| {
        if (index % 4 == 3)
            try std.testing.expectEqual(@as(u8, 255), encoded)
        else if (index % 4 == 1)
            try std.testing.expectEqual(quantize5(source), encoded)
        else
            try std.testing.expectEqual(quantize4(source), encoded);
    }
}

test "video audio decodes real AAC into its native PCM ring" {
    const value = try openVideo();
    defer value.deinit();
    try std.testing.expect(value.info.has_audio != 0);
    try std.testing.expect(value.audio_engine != null);

    const produced = try value.refillAudio(4096);
    try std.testing.expect(produced > 0);
    try std.testing.expectEqual(produced, audio.getPcmQueuedFrames(value.audio_engine.?));

    try std.testing.expectEqual(audio.Status.ok, audio.startMixer(value.audio_engine.?));
    const output = try std.testing.allocator.alloc(f32, @as(usize, produced) * 2);
    defer std.testing.allocator.free(output);
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, output.ptr, produced, 2));
    try std.testing.expectEqual(@as(u64, produced), audio.getPcmConsumedFrames(value.audio_engine.?));
    var has_signal = false;
    for (output) |sample| has_signal = has_signal or @abs(sample) > 0.0001;
    try std.testing.expect(has_signal);
}

test "video audio refill is bounded and preserves pending samples" {
    const value = try openVideo();
    defer value.deinit();

    try std.testing.expectEqual(@as(u32, 1024), try value.refillAudio(1024));
    try std.testing.expectEqual(@as(u32, 1024), audio.getPcmQueuedFrames(value.audio_engine.?));
    try std.testing.expectEqual(@as(u32, 1024), try value.refillAudio(1024));
    try std.testing.expectEqual(@as(u32, 2048), audio.getPcmQueuedFrames(value.audio_engine.?));
}

test "video audio service does not decode or encode a new video frame" {
    const value = try openVideo();
    defer value.deinit();
    value.audio_offline = true;
    value.play();
    _ = try value.update(0);
    const frame_serial = value.state.frame_serial;

    try value.service(100_000);

    try std.testing.expectEqual(frame_serial, value.state.frame_serial);
    try std.testing.expect(value.state.audio_produced_frames > 0);
}

test "video frame preparation does not advance audio or media time" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    for (0..3) |_| _ = try value.update(0);

    var output: [1920]f32 = undefined;
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 960, 2));
    const before = value.getState();
    const queued = before.audio_queued_frames;

    try std.testing.expect(try value.prepare(500_000));
    value.drainPreparation();
    const after = value.getState();

    try std.testing.expectEqual(before.current_time_us, after.current_time_us);
    try std.testing.expectEqual(before.audio_consumed_frames, after.audio_consumed_frames);
    try std.testing.expectEqual(queued, after.audio_queued_frames);
    try std.testing.expectEqual(before.frame_pts_us, after.frame_pts_us);
    try std.testing.expectEqual(@as(i64, 500_000), after.prepared_pts_us);
}

test "video frame preparation clamps ahead of EOF without ending playback" {
    const value = try openVideo();
    defer value.deinit();

    _ = try value.prepare(value.info.duration_us + 1_000_000);
    value.drainPreparation();

    const state = value.getState();
    try std.testing.expectEqual(@as(u32, 0), state.ended);
    try std.testing.expect(state.prepared_pts_us < value.info.duration_us);
}

test "native video scheduler waits presents and drops one prepared frame" {
    const value = try openVideo();
    defer value.deinit();
    _ = try value.update(0);

    try std.testing.expect(try value.prepare(500_000));
    value.drainPreparation();
    value.frameSubmitted(0);
    try value.schedule(400_000, 33_333, 2, 30_000);
    try std.testing.expectEqual(@as(i64, 500_000), value.getState().prepared_pts_us);

    try value.schedule(470_000, 33_333, 3, 30_000);
    try std.testing.expectEqual(@as(i64, 500_000), value.getState().frame_pts_us);
    try std.testing.expectEqual(@as(i64, -1), value.getState().prepared_pts_us);

    try std.testing.expect(try value.prepare(550_000));
    value.drainPreparation();
    try value.schedule(600_000, 33_333, 4, 30_000);
    try std.testing.expectEqual(@as(i64, -1), value.getState().prepared_pts_us);
    try std.testing.expectEqual(@as(i64, 500_000), value.getState().frame_pts_us);
}

test "native video scheduler derives future targets from native latency windows" {
    const value = try openVideo();
    defer value.deinit();

    _ = try value.update(1_000_000);
    value.frameSubmitted(0);
    try value.schedule(1_000_000, 33_333, 2, 34_000);
    try std.testing.expect(try value.prepareNext(33_333, 3, 34_000));
    value.drainPreparation();
    const state = value.getState();

    try std.testing.expect(state.sync_lead_us >= 34_000);
    try std.testing.expect(state.prepared_pts_us > 1_030_000);
}

test "native video scheduler owns one prepared slot and seek clears it" {
    const value = try openVideo();
    defer value.deinit();
    _ = try value.update(0);

    try std.testing.expect(try value.prepareNext(33_333, 0, 20_000));
    value.drainPreparation();
    const prepared = value.getState().prepared_pts_us;
    try std.testing.expect(prepared > 0);
    try std.testing.expect(!(try value.prepareNext(33_333, 0, 40_000)));
    try std.testing.expectEqual(prepared, value.getState().prepared_pts_us);

    try value.seek(1_000_000);
    try std.testing.expectEqual(@as(i64, -1), value.getState().prepared_pts_us);
}

test "native latency window expires old maxima without allocation" {
    var window = video.LatencyWindow{};
    window.add(90_000);
    for (0..30) |_| window.add(20_000);
    try std.testing.expectEqual(@as(u32, 20_000), window.maximum());
}

test "native scheduler ignores output samples before its first submitted video frame" {
    const value = try openVideo();
    defer value.deinit();
    _ = try value.update(0);

    try value.schedule(0, 33_333, 100, 900_000);
    try std.testing.expectEqual(@as(u32, 0), value.getState().sync_lead_us);

    value.frameSubmitted(100);
    try value.schedule(0, 33_333, 101, 900_000);
    try std.testing.expectEqual(@as(u32, 0), value.getState().sync_lead_us);
    try value.schedule(0, 33_333, 102, 20_000);
    try std.testing.expectEqual(@as(u32, 20_000), value.getState().sync_lead_us);
}

test "video AV sync offset changes only the selected frame target" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    for (0..3) |_| _ = try value.update(0);

    var output: [9600]f32 = undefined;
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 4800, 2));

    value.setAvSyncOffset(100_000);
    _ = try value.update(0);
    const advanced = value.getState();
    try std.testing.expectEqual(@as(i64, 100_000), advanced.current_time_us);
    try std.testing.expect(advanced.frame_pts_us > advanced.current_time_us);
    try std.testing.expect(advanced.frame_pts_us <= advanced.current_time_us + 100_000);

    try value.seek(0);
    value.setAvSyncOffset(-100_000);
    for (0..3) |_| _ = try value.update(0);
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 4800, 2));

    _ = try value.update(0);
    const delayed = value.getState();
    try std.testing.expectEqual(@as(i64, 100_000), delayed.current_time_us);
    try std.testing.expectEqual(@as(i64, 0), delayed.frame_pts_us);
}

test "video AV sync offset does not make service decode a frame" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    value.setAvSyncOffset(250_000);

    try value.service(0);

    const state = value.getState();
    try std.testing.expectEqual(@as(u64, 0), state.frame_serial);
    try std.testing.expectEqual(@as(u32, 0), state.has_frame);
}

test "video AV sync offset does not change end-of-playback timing" {
    const value = try openVideo();
    defer value.deinit();
    const before_end = value.info.duration_us - 100_000;

    try value.seek(before_end);
    value.setAvSyncOffset(500_000);
    _ = try value.update(before_end);
    try std.testing.expectEqual(@as(u32, 0), value.getState().ended);

    value.setAvSyncOffset(-500_000);
    _ = try value.update(value.info.duration_us);
    try std.testing.expectEqual(@as(u32, 1), value.getState().ended);
}

test "video audio seek clears old PCM and refills from target" {
    const value = try openVideo();
    defer value.deinit();
    _ = try value.refillAudio(4096);
    try std.testing.expect(audio.getPcmQueuedFrames(value.audio_engine.?) > 0);

    try value.seek(1_375_000);
    try std.testing.expectEqual(@as(u32, 0), audio.getPcmQueuedFrames(value.audio_engine.?));
    try std.testing.expect((try value.refillAudio(4096)) > 0);
}

test "video audio reaches EOF and drains resampler output" {
    const value = try openVideo();
    defer value.deinit();
    try value.seek(5_900_000);

    var total: u64 = 0;
    while (!value.audio_ended) {
        const produced = try value.refillAudio(4096);
        total += produced;
        if (produced == 0 and !value.audio_ended) return error.TestUnexpectedResult;
        if (audio.getPcmQueuedFrames(value.audio_engine.?) > 16_000) {
            try std.testing.expectEqual(audio.Status.ok, audio.startMixer(value.audio_engine.?));
            var output: [8192]f32 = undefined;
            try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 4096, 2));
        }
    }
    try std.testing.expect(total > 0);
}

test "video playback incrementally prebuffers through production updates" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();

    _ = try value.update(0);
    var state = value.getState();
    try std.testing.expectEqual(@as(u32, 4096), state.audio_queued_frames);
    try std.testing.expectEqual(@as(u32, 1), state.buffering);
    try std.testing.expectEqual(@as(u32, 0), state.audio_active);

    _ = try value.update(33_333);
    state = value.getState();
    try std.testing.expectEqual(@as(u32, 8192), state.audio_queued_frames);
    try std.testing.expectEqual(@as(u32, 1), state.buffering);

    _ = try value.update(66_666);
    state = value.getState();
    try std.testing.expect(state.audio_queued_frames >= 12_000);
    try std.testing.expectEqual(@as(u32, 0), state.buffering);
    try std.testing.expectEqual(@as(u32, 1), state.audio_active);
}

test "video pause and resume preserve queued PCM and native clock" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    for (0..3) |index| _ = try value.update(@intCast(index * 33_333));

    var output: [3200]f32 = undefined;
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 1600, 2));
    const before_pause = value.getState();
    try std.testing.expect(before_pause.current_time_us >= 33_000);
    const queued = before_pause.audio_queued_frames;

    value.pause();
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 1600, 2));
    const paused = value.getState();
    try std.testing.expectEqual(before_pause.audio_consumed_frames, paused.audio_consumed_frames);
    try std.testing.expectEqual(queued, paused.audio_queued_frames);

    value.play();
    _ = try value.update(paused.current_time_us);
    try std.testing.expectEqual(@as(u32, 1), value.getState().audio_active);
}

test "video mute outputs silence while native media clock advances" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    for (0..3) |index| _ = try value.update(@intCast(index * 33_333));
    try value.setMuted(true);

    var output: [3200]f32 = undefined;
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, &output, 1600, 2));
    for (output) |sample| try std.testing.expectEqual(@as(f32, 0), sample);
    try std.testing.expect(value.getState().current_time_us >= 33_000);
}

test "video underrun freezes media clock and recovers after watermark refill" {
    const value = try openVideo();
    defer value.deinit();
    value.setAudioOffline(true);
    value.play();
    for (0..3) |index| _ = try value.update(@intCast(index * 33_333));

    const queued = value.getState().audio_queued_frames;
    const output = try std.testing.allocator.alloc(f32, @as(usize, queued + 1600) * 2);
    defer std.testing.allocator.free(output);
    try std.testing.expectEqual(audio.Status.ok, audio.mixToBuffer(value.audio_engine.?, output.ptr, queued + 1600, 2));
    const stalled_time = value.getState().current_time_us;
    _ = try value.update(1_000_000);
    var state = value.getState();
    try std.testing.expectEqual(@as(u32, 1), state.buffering);
    try std.testing.expectEqual(stalled_time, state.current_time_us);
    try std.testing.expect(state.audio_underruns > 0);

    _ = try value.update(1_033_333);
    _ = try value.update(1_066_666);
    state = value.getState();
    try std.testing.expectEqual(@as(u32, 1), state.audio_active);
    try std.testing.expectEqual(@as(u32, 0), state.buffering);
}

test "video output geometry changes preserve native audio queue" {
    const value = try openVideo();
    defer value.deinit();
    _ = try value.refillAudio(4096);
    const queued = audio.getPcmQueuedFrames(value.audio_engine.?);
    try value.configureOutput(320, 480, false);
    try std.testing.expectEqual(queued, audio.getPcmQueuedFrames(value.audio_engine.?));
}

test "video manual PCM reads are rejected while native playback owns audio" {
    const value = try openVideo();
    defer value.deinit();
    value.play();
    var samples: [512]f32 = undefined;
    try std.testing.expectError(error.InvalidArgument, value.readAudio(&samples, 256));
}

test "video external audio open decodes PCM through manual reads" {
    const value = try openVideoExternalAudio();
    defer value.deinit();
    try std.testing.expect(value.info.has_audio != 0);
    try std.testing.expectEqual(@as(u32, 48_000), value.info.audio_sample_rate);
    try std.testing.expectEqual(@as(u32, 2), value.info.audio_channels);

    var samples: [512]f32 = undefined;
    const first = try value.readAudio(&samples, 256);
    try std.testing.expect(first > 0);
    const second = try value.readAudio(&samples, 256);
    try std.testing.expect(second > 0);

    var has_signal = false;
    var total: u64 = first + second;
    while (total < 96_000) {
        const frames = try value.readAudio(&samples, 256);
        if (frames == 0) break;
        total += frames;
        for (samples[0 .. frames * 2]) |sample| {
            if (@abs(sample) > 0.01) has_signal = true;
        }
    }
    try std.testing.expect(has_signal);
}

test "video external audio manual reads honor seek targets" {
    const value = try openVideoExternalAudio();
    defer value.deinit();
    var samples: [512]f32 = undefined;
    const before = try value.readAudio(&samples, 256);
    try std.testing.expect(before > 0);

    // Seek near the end and drain: the remaining PCM must be bounded by the
    // remaining media time rather than restarting from the file beginning.
    const duration = value.info.duration_us;
    try std.testing.expect(duration > 1_000_000);
    try value.seek(duration - 500_000);
    var remaining: u64 = 0;
    while (true) {
        const frames = try value.readAudio(&samples, 256);
        if (frames == 0) break;
        remaining += frames;
        if (remaining > 96_000) break;
    }
    try std.testing.expect(remaining > 0);
    // 0.5s at 48kHz is 24000 frames; allow one decode chunk of slack.
    try std.testing.expect(remaining <= 24_000 + 4_096);
}

test "video external audio open keeps playback silent but functional" {
    const value = try openVideoExternalAudio();
    defer value.deinit();
    value.play();
    const updated = try value.update(0);
    try std.testing.expect(updated);
    const state = value.getState();
    try std.testing.expectEqual(@as(u32, 1), state.playing);
    try std.testing.expectEqual(@as(u32, 0), state.audio_active);
    try std.testing.expectEqual(@as(u32, 1), state.has_frame);
    // Manual reads stay available while video frames advance.
    var samples: [512]f32 = undefined;
    try std.testing.expect(try value.readAudio(&samples, 256) > 0);
}

test "video open failures expose the native error detail" {
    try std.testing.expectError(
        error.OpenFailed,
        video.Video.open(std.testing.allocator, "../tests/fixtures/images/rgba.png", false),
    );
    try std.testing.expect(video.lastOpenError().len > 0);

    try std.testing.expectError(
        error.OpenFailed,
        video.Video.open(std.testing.allocator, "../tests/fixtures/video/missing.mp4", false),
    );
    try std.testing.expect(std.ascii.indexOfIgnoreCase(video.lastOpenError(), "no such file") != null);
}

test "video png encoding is skipped when disabled" {
    const value = try openVideo();
    defer value.deinit();
    value.setPngEnabled(false);
    try std.testing.expect(try value.update(0));
    try std.testing.expect(value.current_image.?.encoded_png == null);

    // Re-enabling produces a PNG for the next decoded frame.
    value.setPngEnabled(true);
    try std.testing.expect(try value.update(500_000));
    try std.testing.expect(value.current_image.?.encoded_png != null);
    try std.testing.expect(value.current_image.?.encoded_png.?.len > 0);
}

test "video frames draw into buffers natively without object handles" {
    const gp = @import("../grapheme.zig");
    const link = @import("../link.zig");
    const buffer_mod = @import("../buffer.zig");
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);

    var pool = gp.GraphemePool.init(std.testing.allocator);
    defer pool.deinit();
    var link_pool = link.LinkPool.init(std.testing.allocator);
    defer link_pool.deinit();
    const target = try buffer_mod.OptimizedBuffer.init(std.testing.allocator, 8, 4, .{ .pool = &pool, .link_pool = &link_pool });
    defer target.deinit();

    // No frame decoded yet: drawing is a no-op.
    try std.testing.expect(value.current_image == null);

    try std.testing.expect(try value.update(0));
    const first_frame = value.current_image.?;
    const first_serial = value.state.frame_serial;
    const first_content = (@as(u64, 7777) << 32) | @as(u32, @truncate(first_serial));
    try std.testing.expect(try target.drawImage(first_frame, first_content, 0, 0, 4, 2, 8, 4, 0, 0, 8, 4, .auto));
    try std.testing.expectEqual(@as(usize, 1), target.image_placements.items.len);
    try std.testing.expectEqual(first_content, target.image_placements.items[0].content_id);

    // The placement holds its own reference: replacing the frame keeps the
    // drawn pixels alive until the buffer clears.
    try std.testing.expect(try value.update(500_000));
    try std.testing.expect(value.state.frame_serial != first_serial);
    try std.testing.expect(value.current_image.? != first_frame);
    try std.testing.expectEqual(first_frame, target.image_placements.items[0].image);
    try std.testing.expect(first_frame.pixels.len > 0);

    // A new frame draws under a new content identity.
    const second_content = (@as(u64, 7777) << 32) | @as(u32, @truncate(value.state.frame_serial));
    try std.testing.expect(second_content != first_content);
    try std.testing.expect(try target.drawImage(value.current_image.?, second_content, 4, 2, 4, 2, 8, 4, 0, 0, 8, 4, .auto));
    try std.testing.expectEqual(@as(usize, 2), target.image_placements.items.len);
    try std.testing.expectEqual(second_content, target.image_placements.items[1].content_id);
}

test "video keeps the current frame presentable across reconfiguration" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);
    try std.testing.expect(try value.update(0));
    try std.testing.expect(value.current_image != null);

    // Adaptive quality changes must not blank the placement.
    try value.configurePng(2, 2, 5);
    try std.testing.expect(value.current_image != null);

    // Nor do output size changes; the replacement arrives with the next decode.
    try value.configureOutput(16, 8, false);
    try std.testing.expect(value.current_image != null);
    try std.testing.expect(try value.update(100_000));
    try std.testing.expectEqual(@as(u32, 16), value.current_image.?.width());
}

test "video hardware and software decode produce identical frames" {
    const builtin = @import("builtin");
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    // Hardware decoding is opt-in; force it for the first decoder. Platforms
    // without a device fall back to software and compare trivially.
    const setenv_fn = @extern(*const fn ([*:0]const u8, [*:0]const u8, c_int) callconv(.c) c_int, .{ .name = "setenv" });
    const unsetenv_fn = @extern(*const fn ([*:0]const u8) callconv(.c) c_int, .{ .name = "unsetenv" });
    _ = setenv_fn("OPENTUI_VIDEO_HWACCEL", "1", 1);
    const hardware = try openVideo();
    try hardware.configureOutput(64, 96, false);
    const decoded = hardware.update(500_000) catch |err| {
        _ = unsetenv_fn("OPENTUI_VIDEO_HWACCEL");
        hardware.deinit();
        return err;
    };
    try std.testing.expect(decoded);
    const hardware_pixels = try std.testing.allocator.dupe(u8, hardware.current_image.?.pixels);
    defer std.testing.allocator.free(hardware_pixels);
    hardware.deinit();
    _ = unsetenv_fn("OPENTUI_VIDEO_HWACCEL");

    // H.264 reconstruction is bit-exact by specification, so the VideoToolbox
    // path (when active on this platform) must match the software decoder.
    const software = try openVideo();
    defer software.deinit();
    try software.configureOutput(64, 96, false);
    try std.testing.expect(try software.update(500_000));
    try std.testing.expectEqualSlices(u8, hardware_pixels, software.current_image.?.pixels);
}

test "video frame preparation runs asynchronously" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);
    try std.testing.expect(try value.update(0));

    // The post returns without a produced frame; production happens on the
    // worker and is collected later.
    try std.testing.expect(try value.prepare(500_000));
    try std.testing.expectEqual(@as(i64, -1), value.state.prepared_pts_us);
    value.drainPreparation();
    const first_prepared = value.state.prepared_pts_us;
    try std.testing.expect(first_prepared >= 0);
    try std.testing.expect(value.state.prepare_time_us > 0);

    // A raw prepare replaces the prepared slot, matching the synchronous
    // semantics; prepareNext() is the entry point that respects a full slot.
    try std.testing.expect(try value.prepare(600_000));
    value.drainPreparation();
    try std.testing.expect(value.state.prepared_pts_us > first_prepared);
}

test "video seek discards in flight preparation" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);
    try std.testing.expect(try value.update(0));
    try std.testing.expect(try value.prepare(500_000));

    try value.seek(1_000_000);
    value.drainPreparation();
    try std.testing.expectEqual(@as(i64, -1), value.state.prepared_pts_us);

    // The decoder is coherent after the cancelled preparation.
    try std.testing.expect(try value.update(1_000_000));
    try std.testing.expect(value.state.frame_pts_us >= 900_000);
}

test "video production steps through consecutive source frames" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);
    try std.testing.expect(try value.update(0));

    // Stepping is deterministic and independent of the scheduling clock: each
    // preparation yields exactly the next source frame.
    var expected_pts: i64 = 0;
    for (0..5) |_| {
        try std.testing.expect(try value.prepareNext(41_667, 0, 0));
        value.drainPreparation();
        const prepared = value.state.prepared_pts_us;
        try std.testing.expect(prepared > expected_pts);
        try std.testing.expect(prepared - expected_pts < 43_000);
        expected_pts = prepared;
        // Consume the slot the way schedule() would.
        value.clearPrepared();
    }
}

test "video dropping a stale frame resynchronizes production to the clock" {
    const value = try openVideo();
    defer value.deinit();
    try value.configureOutput(8, 4, false);
    try std.testing.expect(try value.update(0));
    try std.testing.expect(try value.prepareNext(41_667, 0, 0));
    value.drainPreparation();
    try std.testing.expect(value.state.prepared_pts_us < 100_000);

    // The clock has moved far past the prepared frame: schedule drops it and
    // the next preparation re-anchors near the clock instead of stepping.
    try value.schedule(2_000_000, 41_667, 0, 0);
    try std.testing.expectEqual(@as(i64, -1), value.state.prepared_pts_us);
    try std.testing.expect(try value.prepareNext(41_667, 0, 0));
    value.drainPreparation();
    try std.testing.expect(value.state.prepared_pts_us > 1_900_000);
}

test "video audio tap observes playback without consuming decoder audio" {
    const value = try openVideo();
    defer value.deinit();
    try value.enableAudioTap(true, 256);

    var samples: [512]f32 = undefined;
    var end_frame: u64 = 99;
    try std.testing.expectEqual(@as(u32, 0), try value.readAudioTap(&samples, 256, 2, &end_frame));
    try std.testing.expectEqual(@as(u64, 0), end_frame);
    try std.testing.expectEqual(@as(u32, 4096), try value.refillAudio(4096));
    try std.testing.expectEqual(@as(u32, 4096), audio.getPcmQueuedFrames(value.audio_engine.?));

    try value.enableAudioTap(false, 0);
}
