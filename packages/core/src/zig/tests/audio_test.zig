const std = @import("std");
const testing = std.testing;
const audio = @import("../audio.zig");

const TEST_SAMPLE_RATE: u32 = 48_000;
const TEST_MP3_PATH = "../tests/fixtures/audio/tone-750hz-48k-mono-1s.mp3";

fn expectStatusOk(status: i32) !void {
    try testing.expectEqual(audio.Status.ok, status);
}

fn createEngine(options_ptr: ?*const audio.CreateOptions) !*audio.Engine {
    return audio.create(testing.allocator, options_ptr) orelse error.TestUnexpectedResult;
}

fn streamOptions() audio.StreamOptions {
    return .{
        .capacity_ms = 10,
        .startup_ms = 2,
        .resume_ms = 1,
        .volume = 1,
        .pan = 0,
        .group_id = 0,
        .format = audio.StreamFormat.mp3,
    };
}

fn buildPcm16Wav(allocator: std.mem.Allocator, channels: u16, sample_rate: u32, samples: []const i16) ![]u8 {
    if (channels == 0 or samples.len == 0) return error.InvalidInput;
    if (samples.len % @as(usize, channels) != 0) return error.InvalidInput;

    const bytes_per_sample: usize = @sizeOf(i16);
    const data_size = try std.math.mul(usize, samples.len, bytes_per_sample);
    const total_size = 44 + data_size;

    const out = try allocator.alloc(u8, total_size);
    var stream = std.io.fixedBufferStream(out);
    const writer = stream.writer();

    const channels_u32: u32 = channels;
    const byte_rate: u32 = sample_rate * channels_u32 * 2;
    const block_align: u16 = channels * 2;

    try writer.writeAll("RIFF");
    try writer.writeInt(u32, @intCast(total_size - 8), .little);
    try writer.writeAll("WAVE");
    try writer.writeAll("fmt ");
    try writer.writeInt(u32, 16, .little);
    try writer.writeInt(u16, 1, .little);
    try writer.writeInt(u16, channels, .little);
    try writer.writeInt(u32, sample_rate, .little);
    try writer.writeInt(u32, byte_rate, .little);
    try writer.writeInt(u16, block_align, .little);
    try writer.writeInt(u16, 16, .little);
    try writer.writeAll("data");
    try writer.writeInt(u32, @intCast(data_size), .little);

    for (samples) |sample| {
        try writer.writeInt(i16, sample, .little);
    }

    return out;
}

fn loadSoundFromSamples(engine: *audio.Engine, channels: u16, samples: []const i16) !u32 {
    const wav = try buildPcm16Wav(testing.allocator, channels, TEST_SAMPLE_RATE, samples);
    defer testing.allocator.free(wav);

    var sound_id: u32 = 0;
    try expectStatusOk(audio.load(engine, wav.ptr, wav.len, &sound_id));
    try testing.expect(sound_id > 0);
    return sound_id;
}

fn createGroup(engine: *audio.Engine, name: []const u8) !u32 {
    var group_id: u32 = 0;
    try expectStatusOk(audio.createGroup(engine, name.ptr, name.len, &group_id));
    return group_id;
}

fn playLoop(engine: *audio.Engine, sound_id: u32, group_id: u32, pan: f32) !u32 {
    var voice_id: u32 = 0;
    const options = audio.VoiceOptions{
        .volume = 0.8,
        .pan = pan,
        .loop = true,
        .group_id = group_id,
    };
    try expectStatusOk(audio.play(engine, sound_id, &options, &voice_id));
    try testing.expect(voice_id > 0);
    return voice_id;
}

fn hasSignal(samples: []const f32) bool {
    for (samples) |sample| {
        if (@abs(sample) > 0.0005) return true;
    }
    return false;
}

fn writeAllStreamBytes(engine: *audio.Engine, stream_id: u32, bytes: []const u8) !void {
    var offset: usize = 0;
    var attempts: usize = 0;
    while (offset < bytes.len and attempts < 5_000) : (attempts += 1) {
        const written = audio.writeStream(engine, stream_id, bytes[offset..].ptr, @intCast(bytes.len - offset));
        try testing.expect(written >= 0);
        offset += @intCast(written);
        if (written == 0) std.Thread.sleep(std.time.ns_per_ms);
    }
    try testing.expectEqual(bytes.len, offset);
}

fn waitForBufferedFrames(engine: *audio.Engine, stream_id: u32, minimum: u32) !audio.StreamStats {
    var stats: audio.StreamStats = undefined;
    for (0..5_000) |_| {
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
        if (stats.buffered_frames >= minimum) return stats;
        if (stats.state == audio.StreamState.failed) return error.TestUnexpectedResult;
        std.Thread.sleep(std.time.ns_per_ms);
    }
    return error.TestUnexpectedResult;
}

fn mixStreamToEnd(engine: *audio.Engine, stream_id: u32) !audio.StreamStats {
    var mixed: [256 * 2]f32 = undefined;
    var heard_signal = false;
    var stats: audio.StreamStats = undefined;
    for (0..5_000) |_| {
        try expectStatusOk(audio.mixToBuffer(engine, &mixed, 256, 2));
        heard_signal = heard_signal or hasSignal(&mixed);
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
        if (stats.state == audio.StreamState.ended) {
            try testing.expect(heard_signal);
            return stats;
        }
        if (stats.state == audio.StreamState.failed) return error.TestUnexpectedResult;
        std.Thread.sleep(std.time.ns_per_ms);
    }
    return error.TestUnexpectedResult;
}

test "audio stream ABI layouts remain stable" {
    try testing.expectEqual(@as(usize, 32), @sizeOf(audio.StreamOptions));
    try testing.expectEqual(@as(usize, 0), @offsetOf(audio.StreamOptions, "capacity_ms"));
    try testing.expectEqual(@as(usize, 4), @offsetOf(audio.StreamOptions, "startup_ms"));
    try testing.expectEqual(@as(usize, 8), @offsetOf(audio.StreamOptions, "resume_ms"));
    try testing.expectEqual(@as(usize, 12), @offsetOf(audio.StreamOptions, "volume"));
    try testing.expectEqual(@as(usize, 16), @offsetOf(audio.StreamOptions, "pan"));
    try testing.expectEqual(@as(usize, 20), @offsetOf(audio.StreamOptions, "group_id"));
    try testing.expectEqual(@as(usize, 24), @offsetOf(audio.StreamOptions, "max_probe_bytes"));
    try testing.expectEqual(@as(usize, 28), @offsetOf(audio.StreamOptions, "format"));

    try testing.expectEqual(@as(usize, 56), @sizeOf(audio.StreamStats));
    try testing.expectEqual(@as(usize, 0), @offsetOf(audio.StreamStats, "bytes_received"));
    try testing.expectEqual(@as(usize, 8), @offsetOf(audio.StreamStats, "frames_decoded"));
    try testing.expectEqual(@as(usize, 16), @offsetOf(audio.StreamStats, "frames_played"));
    try testing.expectEqual(@as(usize, 24), @offsetOf(audio.StreamStats, "state"));
    try testing.expectEqual(@as(usize, 28), @offsetOf(audio.StreamStats, "sample_rate"));
    try testing.expectEqual(@as(usize, 32), @offsetOf(audio.StreamStats, "channels"));
    try testing.expectEqual(@as(usize, 36), @offsetOf(audio.StreamStats, "buffered_frames"));
    try testing.expectEqual(@as(usize, 40), @offsetOf(audio.StreamStats, "capacity_frames"));
    try testing.expectEqual(@as(usize, 44), @offsetOf(audio.StreamStats, "underruns"));
    try testing.expectEqual(@as(usize, 48), @offsetOf(audio.StreamStats, "error_code"));
    try testing.expectEqual(@as(usize, 52), @offsetOf(audio.StreamStats, "ready_generation"));
}

test "audio - create initializes engine with defaults" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    try testing.expectEqual(audio.default_sample_rate, engine.sample_rate);
    try testing.expectEqual(@as(u8, 2), engine.output_channels);
    try testing.expect(!engine.started);
}

test "audio - create applies custom sample rate and playback channels" {
    var options = audio.CreateOptions{
        .sample_rate = 44_100,
        .playback_channels = 4,
    };
    const engine = try createEngine(&options);
    defer audio.destroy(engine);

    try testing.expectEqual(@as(u32, 44_100), engine.sample_rate);
    try testing.expectEqual(@as(u8, 4), engine.output_channels);
}

test "audio - destroy works after create" {
    const engine = try createEngine(null);
    audio.destroy(engine);
}

test "audio - start requires playback device" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    var options = audio.StartOptions{
        .period_size_in_frames = 128,
        .periods = 2,
        .performance_profile = 1,
        .share_mode = 0,
    };

    const status = audio.start(engine, &options);
    if (status == audio.Status.ok) {
        try testing.expect(engine.started);
        try testing.expect(engine.has_device);
    } else {
        try testing.expectEqual(audio.Status.err_device, status);
        try testing.expect(!engine.started);
        try testing.expect(!engine.has_device);
        return;
    }

    try expectStatusOk(audio.stop(engine));
    try testing.expect(!engine.started);
    try testing.expect(!engine.has_device);
}

test "audio - startMixer enables mixing without playback device" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    try expectStatusOk(audio.startMixer(engine));
    try testing.expect(engine.started);
    try testing.expect(!engine.has_device);

    try expectStatusOk(audio.stop(engine));
    try testing.expect(!engine.started);
    try testing.expect(!engine.has_device);
}

test "audio - load valid wav returns sound id" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 0, 8000, -8000, 12_000, -12_000, 0 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try testing.expectEqual(@as(u32, 1), sound_id);

    var stats: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &stats));
    try testing.expectEqual(@as(u32, 1), stats.sounds_loaded);
}

test "audio - unload frees loaded sound and invalidates handle" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 0, 8000, -8000, 12_000, -12_000, 0 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);

    try expectStatusOk(audio.unload(engine, sound_id));

    var stats: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &stats));
    try testing.expectEqual(@as(u32, 0), stats.sounds_loaded);

    var voice_id: u32 = 0;
    const options = audio.VoiceOptions{ .volume = 1, .pan = 0, .loop = false, .group_id = 0 };
    try testing.expectEqual(audio.Status.err_not_found, audio.play(engine, sound_id, &options, &voice_id));
    try testing.expectEqual(audio.Status.err_not_found, audio.unload(engine, sound_id));
}

test "audio - unload stops active voices for sound" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 2000, -2000, 4000, -4000, 2000, -2000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));

    const voice_id = try playLoop(engine, sound_id, 0, 0);
    try testing.expect(engine.voices[voice_id - 1].active);

    try expectStatusOk(audio.unload(engine, sound_id));
    try testing.expect(!engine.voices[voice_id - 1].active);

    var stats: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &stats));
    try testing.expectEqual(@as(u32, 0), stats.sounds_loaded);
    try testing.expectEqual(@as(u32, 0), stats.voices_active);
}

test "audio - unloaded sound id is not reused by later loads" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const first_samples = [_]i16{ 0, 8000, -8000, 0 };
    const first_sound_id = try loadSoundFromSamples(engine, 1, &first_samples);
    try expectStatusOk(audio.unload(engine, first_sound_id));

    const second_samples = [_]i16{ 1000, -1000, 5000, -5000 };
    const second_sound_id = try loadSoundFromSamples(engine, 1, &second_samples);
    try testing.expect(second_sound_id != first_sound_id);

    try expectStatusOk(audio.startMixer(engine));

    var voice_id: u32 = 0;
    const options = audio.VoiceOptions{ .volume = 1, .pan = 0, .loop = false, .group_id = 0 };
    try testing.expectEqual(audio.Status.err_not_found, audio.play(engine, first_sound_id, &options, &voice_id));
    try expectStatusOk(audio.play(engine, second_sound_id, &options, &voice_id));
    try testing.expect(voice_id > 0);
}

test "audio - createGroup creates and deduplicates group" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const first = try createGroup(engine, "effects");
    const second = try createGroup(engine, "effects");
    try testing.expectEqual(first, second);
}

test "audio - play valid sound returns voice id" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 3000, -3000, 6000, -6000, 3000, -3000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));

    var voice_id: u32 = 0;
    const options = audio.VoiceOptions{ .volume = 1, .pan = 0, .loop = true, .group_id = 0 };
    try expectStatusOk(audio.play(engine, sound_id, &options, &voice_id));
    try testing.expect(voice_id > 0);
    try testing.expect(engine.voices[voice_id - 1].active);
}

test "audio - stopVoice stops active voice" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 2000, -2000, 4000, -4000, 2000, -2000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));

    const voice_id = try playLoop(engine, sound_id, 0, 0);
    try expectStatusOk(audio.stopVoice(engine, voice_id));
    try testing.expect(!engine.voices[voice_id - 1].active);
}

test "audio - setVoiceGroup moves voice between groups" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 1500, -1500, 5000, -5000, 1500, -1500 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    const group_a = try createGroup(engine, "group-a");
    const group_b = try createGroup(engine, "group-b");
    try expectStatusOk(audio.startMixer(engine));

    const voice_id = try playLoop(engine, sound_id, group_a, 0);
    try expectStatusOk(audio.setVoiceGroup(engine, voice_id, group_b));
    try testing.expectEqual(group_b, engine.voices[voice_id - 1].group_id);
}

test "audio - setGroupVolume applies clamped volume" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const group_id = try createGroup(engine, "mix-group");
    try expectStatusOk(audio.setGroupVolume(engine, group_id, 2.5));
    try testing.expectApproxEqAbs(@as(f32, 2.5), engine.groups.items[group_id].volume, 0.0001);

    try expectStatusOk(audio.setGroupVolume(engine, group_id, 8));
    try testing.expectApproxEqAbs(@as(f32, 4), engine.groups.items[group_id].volume, 0.0001);
}

test "audio - setMasterVolume applies clamped volume" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    try expectStatusOk(audio.setMasterVolume(engine, 1.7));
    try testing.expectApproxEqAbs(@as(f32, 1.7), engine.master_volume, 0.0001);

    try expectStatusOk(audio.setMasterVolume(engine, -3));
    try testing.expectApproxEqAbs(@as(f32, 0), engine.master_volume, 0.0001);
}

test "audio - mixToBuffer returns mixed samples" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 4000, -2000, 7000, -7000, 5000, -3000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));
    _ = try playLoop(engine, sound_id, 0, 0.2);

    var out: [128]f32 = [_]f32{0} ** 128;
    try expectStatusOk(audio.mixToBuffer(engine, out[0..].ptr, 64, 2));
    try testing.expect(hasSignal(&out));
}

test "audio - mixToBuffer mono downmix averages stereo" {
    const stereo_engine = try createEngine(null);
    defer audio.destroy(stereo_engine);
    const mono_engine = try createEngine(null);
    defer audio.destroy(mono_engine);

    const mono_samples = [_]i16{ 5000, -2000, 8000, -8000, 5000, -2000 };
    const stereo_sound_id = try loadSoundFromSamples(stereo_engine, 1, &mono_samples);
    const mono_sound_id = try loadSoundFromSamples(mono_engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(stereo_engine));
    try expectStatusOk(audio.startMixer(mono_engine));

    _ = try playLoop(stereo_engine, stereo_sound_id, 0, 0.7);
    _ = try playLoop(mono_engine, mono_sound_id, 0, 0.7);

    var stereo_warmup: [64]f32 = [_]f32{0} ** 64;
    var mono_warmup: [32]f32 = [_]f32{0} ** 32;
    try expectStatusOk(audio.mixToBuffer(stereo_engine, stereo_warmup[0..].ptr, 32, 2));
    try expectStatusOk(audio.mixToBuffer(mono_engine, mono_warmup[0..].ptr, 32, 1));

    var stereo: [128]f32 = [_]f32{0} ** 128;
    var mono: [64]f32 = [_]f32{0} ** 64;
    try expectStatusOk(audio.mixToBuffer(stereo_engine, stereo[0..].ptr, 64, 2));
    try expectStatusOk(audio.mixToBuffer(mono_engine, mono[0..].ptr, 64, 1));

    for (0..64) |i| {
        const expected = std.math.clamp((stereo[i * 2] + stereo[i * 2 + 1]) * 0.5, -1, 1);
        try testing.expectApproxEqAbs(expected, mono[i], 0.0001);
    }
}

test "audio - mixToBuffer multichannel keeps extra channels zero" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 2500, -1500, 7000, -7000, 2500, -1500 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));
    _ = try playLoop(engine, sound_id, 0, 0);

    var quad: [256]f32 = [_]f32{0} ** 256;
    try expectStatusOk(audio.mixToBuffer(engine, quad[0..].ptr, 64, 4));

    for (0..64) |frame| {
        const base = frame * 4;
        try testing.expectEqual(@as(f32, 0), quad[base + 2]);
        try testing.expectEqual(@as(f32, 0), quad[base + 3]);
    }
}

test "audio - enableTap and readTap return captured frames" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 1000, -1000, 4000, -4000, 1000, -1000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    try expectStatusOk(audio.startMixer(engine));
    _ = try playLoop(engine, sound_id, 0, 0.35);

    try expectStatusOk(audio.enableTap(engine, true, 256));

    var mixed: [256]f32 = [_]f32{0} ** 256;
    try expectStatusOk(audio.mixToBuffer(engine, mixed[0..].ptr, 128, 2));

    var tapped: [128]f32 = [_]f32{0} ** 128;
    var frames_read: u32 = 0;
    try expectStatusOk(audio.readTap(engine, tapped[0..].ptr, 64, 2, &frames_read));
    try testing.expect(frames_read > 0);
    try testing.expect(hasSignal(tapped[0 .. @as(usize, frames_read) * 2]));

    try expectStatusOk(audio.enableTap(engine, false, 0));
}

test "audio - refresh and playback device selection APIs" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const refresh_status = audio.refreshPlaybackDevices(engine);
    if (refresh_status != audio.Status.ok) return error.SkipZigTest;

    const count = audio.getPlaybackDeviceCount(engine);
    try testing.expectEqual(@as(u32, @intCast(engine.playback_devices.items.len)), count);
    if (count == 0) return error.SkipZigTest;

    var name_buf: [256]u8 = [_]u8{0} ** 256;
    const copied = audio.getPlaybackDeviceName(engine, 0, name_buf[0..].ptr, name_buf.len);
    try testing.expect(copied <= name_buf.len);

    _ = audio.isPlaybackDeviceDefault(engine, 0);

    try expectStatusOk(audio.selectPlaybackDevice(engine, 0));
    try testing.expectEqual(@as(?u32, 0), engine.selected_playback_index);

    audio.clearPlaybackDeviceSelection(engine);
    try testing.expectEqual(@as(?u32, null), engine.selected_playback_index);
}

test "audio - getStats returns current counters" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 3000, -3000, 9000, -9000, 3000, -3000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);

    var before: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &before));

    try expectStatusOk(audio.startMixer(engine));
    const voice_id = try playLoop(engine, sound_id, 0, 0);

    var out: [128]f32 = [_]f32{0} ** 128;
    try expectStatusOk(audio.mixToBuffer(engine, out[0..].ptr, 64, 2));

    var after: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &after));

    try testing.expectEqual(@as(u32, 1), after.sounds_loaded);
    try testing.expect(after.voices_active >= 1);
    try testing.expect(after.frames_mixed > before.frames_mixed);
    try testing.expect(after.last_peak > 0);
    try testing.expect(after.last_rms > 0);

    try expectStatusOk(audio.stopVoice(engine, voice_id));
}

test "audio stream preflight rejects invalid group without allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;

    var options = streamOptions();
    options.group_id = std.math.maxInt(u32);
    var stream_id: u32 = 0xdeadbeef;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
}

test "audio stream preflight rejects malformed options without allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;
    var stream_id: u32 = 0xdeadbeef;
    var options = streamOptions();

    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, null, &stream_id));
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, null));
    options.max_probe_bytes = 0;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    options = streamOptions();
    options.format = 999;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    options = streamOptions();
    options.capacity_ms = 0;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    options = streamOptions();
    options.startup_ms = options.capacity_ms + 1;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    options = streamOptions();
    options.resume_ms = options.capacity_ms + 1;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));

    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
}

test "audio stream entry points reject invalid arguments without retiring a live stream" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);
    const options = streamOptions();
    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));

    var stats = std.mem.zeroes(audio.StreamStats);
    try testing.expectEqual(audio.Status.err_invalid, audio.writeStream(engine, 0, null, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.writeStream(engine, stream_id, null, 1));
    try testing.expectEqual(@as(i32, 0), audio.writeStream(engine, stream_id, null, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.endStream(engine, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.restartStream(engine, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.setStreamVolume(engine, 0, 1));
    try testing.expectEqual(audio.Status.err_invalid, audio.setStreamPan(engine, 0, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.setStreamGroup(engine, 0, 0));
    try testing.expectEqual(audio.Status.err_invalid, audio.getStreamStats(engine, 0, &stats));
    try testing.expectEqual(audio.Status.err_invalid, audio.getStreamStats(engine, stream_id, null));
    try testing.expectEqual(
        audio.Status.err_invalid,
        audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, null),
    );
    try testing.expectEqual(
        audio.Status.err_invalid,
        audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed + 1, &stats),
    );

    try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
    try testing.expectEqual(audio.StreamState.initializing, stats.state);
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &stats));
}

test "audio stream allocation failures clean up each partial allocation" {
    for (0..3) |failure_offset| {
        var failing = testing.FailingAllocator.init(testing.allocator, .{});
        const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
        defer audio.destroy(engine);
        const allocation_index = failing.alloc_index;
        failing.fail_index = allocation_index + failure_offset;

        const options = streamOptions();
        var stream_id: u32 = 0xdeadbeef;
        try testing.expectEqual(audio.Status.err_no_space, audio.createStream(engine, &options, &stream_id));
        try testing.expect(failing.has_induced_failure);
        try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
        for (engine.streams) |stream| try testing.expect(stream == null);
        var stats: audio.Stats = undefined;
        try expectStatusOk(audio.getStats(engine, &stats));
        try testing.expectEqual(@as(u32, 0), stats.voices_active);
    }
}

test "audio stream preflight rejects millisecond capacity above miniaudio limit without allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;

    var options = streamOptions();
    options.capacity_ms = @intCast((@as(u64, audio.max_stream_pcm_capacity_frames) * 1_000) / TEST_SAMPLE_RATE + 1);
    options.startup_ms = 1;
    options.resume_ms = 1;
    var stream_id: u32 = 0xdeadbeef;
    try testing.expectEqual(audio.Status.err_invalid, audio.createStream(engine, &options, &stream_id));
    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
}

test "audio stream preflight accepts the largest millisecond capacity within the miniaudio bound" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;

    var options = streamOptions();
    options.capacity_ms = @intCast((@as(u64, audio.max_stream_pcm_capacity_frames) * 1_000) / TEST_SAMPLE_RATE);
    options.startup_ms = 1;
    options.resume_ms = 1;
    var stream_id: u32 = 0;
    try testing.expectEqual(audio.Status.err_no_space, audio.createStream(engine, &options, &stream_id));
    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(failing.has_induced_failure);
}

test "audio stream duration conversion rounds up at 44.1kHz" {
    var create_options = audio.CreateOptions{ .sample_rate = 44_100 };
    const engine = try createEngine(&create_options);
    defer audio.destroy(engine);

    var options = streamOptions();
    options.capacity_ms = 1;
    options.startup_ms = 1;
    options.resume_ms = 1;
    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));

    var stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
    try testing.expectEqual(@as(u32, 44_100), stats.sample_rate);
    try testing.expectEqual(@as(u32, 45), stats.capacity_frames);

    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &stats));
}

test "audio stream preflight rejects shared voice exhaustion without allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    const mono_samples = [_]i16{ 2000, -2000, 4000, -4000, 2000, -2000 };
    const sound_id = try loadSoundFromSamples(engine, 1, &mono_samples);
    for (0..audio.max_voices) |_| {
        _ = try playLoop(engine, sound_id, 0, 0);
    }

    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;

    var options = streamOptions();
    var stream_id: u32 = 0xdeadbeef;
    try testing.expectEqual(audio.Status.err_no_space, audio.createStream(engine, &options, &stream_id));
    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
}

test "audio stream preflight rejects retired slots without allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const engine = audio.create(failing.allocator(), null) orelse return error.TestUnexpectedResult;
    defer audio.destroy(engine);

    @memset(&engine.stream_generations, 0);
    const allocation_index = failing.alloc_index;
    failing.fail_index = allocation_index;

    var options = streamOptions();
    var stream_id: u32 = 0xdeadbeef;
    try testing.expectEqual(audio.Status.err_no_space, audio.createStream(engine, &options, &stream_id));
    try testing.expectEqual(allocation_index, failing.alloc_index);
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(@as(u32, 0xdeadbeef), stream_id);
}

test "audio stream reuses retired slot with a new generation" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    var options = streamOptions();
    var first_stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &first_stream_id));
    try testing.expect(first_stream_id != 0);
    var first_final: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, first_stream_id, audio.StreamCloseReason.preserve_native_terminal, &first_final));
    try testing.expectEqual(audio.StreamState.cancelled, first_final.state);
    try testing.expectEqual(@as(u32, 0), first_final.buffered_frames);

    var second_stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &second_stream_id));
    try testing.expect(second_stream_id != 0);
    try testing.expect(first_stream_id != second_stream_id);

    const byte = [_]u8{0};
    var stale_stats: audio.StreamStats = undefined;
    var stale_final = std.mem.zeroes(audio.StreamStats);
    try testing.expectEqual(audio.Status.err_not_found, audio.writeStream(engine, first_stream_id, &byte, byte.len));
    try testing.expectEqual(audio.Status.err_not_found, audio.endStream(engine, first_stream_id));
    try testing.expectEqual(audio.Status.err_not_found, audio.restartStream(engine, first_stream_id));
    try testing.expectEqual(audio.Status.err_not_found, audio.setStreamVolume(engine, first_stream_id, 0.5));
    try testing.expectEqual(audio.Status.err_not_found, audio.setStreamPan(engine, first_stream_id, 0.5));
    try testing.expectEqual(audio.Status.err_not_found, audio.setStreamGroup(engine, first_stream_id, 0));
    try testing.expectEqual(audio.Status.err_not_found, audio.getStreamStats(engine, first_stream_id, &stale_stats));
    try testing.expectEqual(
        audio.Status.err_not_found,
        audio.closeStream(engine, first_stream_id, audio.StreamCloseReason.disposed, &stale_final),
    );

    var second_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, second_stream_id, &second_stats));
    try testing.expectEqual(audio.StreamState.initializing, second_stats.state);
    try testing.expectEqual(@as(u64, 0), second_stats.bytes_received);
    try testing.expectEqual(@as(u64, 0), second_stats.frames_decoded);
    try testing.expectEqual(@as(u64, 0), second_stats.frames_played);
    try testing.expectEqual(TEST_SAMPLE_RATE, second_stats.sample_rate);
    try testing.expectEqual(@as(u32, 2), second_stats.channels);
    try testing.expectEqual(@as(u32, 0), second_stats.buffered_frames);
    try testing.expectEqual(options.capacity_ms * (TEST_SAMPLE_RATE / 1_000), second_stats.capacity_frames);
    try testing.expectEqual(@as(u32, 0), second_stats.underruns);
    try testing.expectEqual(@as(i32, 0), second_stats.error_code);
    try testing.expectEqual(@as(u32, 0), second_stats.ready_generation);
    try testing.expectEqual(
        audio.Status.err_invalid,
        audio.closeStream(engine, second_stream_id, audio.StreamCloseReason.disposed + 1, &stale_final),
    );
    try expectStatusOk(audio.getStreamStats(engine, second_stream_id, &second_stats));

    var second_final: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, second_stream_id, audio.StreamCloseReason.disposed, &second_final));
    try testing.expectEqual(audio.StreamState.cancelled, second_final.state);
    try testing.expectEqual(@as(u32, 0), second_final.buffered_frames);

    var stats: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &stats));
    try testing.expectEqual(@as(u32, 0), stats.voices_active);
}

test "audio stream transport close publishes failed final state" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    var options = streamOptions();
    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));

    var final_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.transport_error, &final_stats));
    try testing.expectEqual(audio.StreamState.failed, final_stats.state);
    try testing.expectEqual(@as(u32, 0), final_stats.buffered_frames);
}

test "audio stream restart retains PCM and resumes decoding with the same id" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);
    try expectStatusOk(audio.startMixer(engine));
    const mp3 = try std.fs.cwd().readFileAlloc(testing.allocator, TEST_MP3_PATH, 16 * 1024);
    defer testing.allocator.free(mp3);

    var options = streamOptions();
    options.capacity_ms = 400;
    options.startup_ms = 6;
    options.resume_ms = 3;

    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));
    for (0..8) |_| try writeAllStreamBytes(engine, stream_id, mp3);
    _ = try waitForBufferedFrames(engine, stream_id, 8 * 1024);

    var warmup: [512 * 2]f32 = undefined;
    try expectStatusOk(audio.mixToBuffer(engine, &warmup, 512, 2));

    var before_restart: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &before_restart));
    try testing.expect(before_restart.frames_played > 0);
    try testing.expect(before_restart.buffered_frames > 4 * 1024);

    try expectStatusOk(audio.restartStream(engine, stream_id));

    var reconnecting: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &reconnecting));
    try testing.expectEqual(audio.StreamState.reconnecting, reconnecting.state);
    try testing.expectEqual(before_restart.bytes_received, reconnecting.bytes_received);
    try testing.expect(reconnecting.frames_decoded >= before_restart.frames_decoded);
    try testing.expectEqual(before_restart.frames_played, reconnecting.frames_played);
    try testing.expectEqual(before_restart.ready_generation, reconnecting.ready_generation);

    var retained: [256 * 2]f32 = undefined;
    var heard_retained_pcm = false;
    var after_retained: audio.StreamStats = undefined;
    for (0..100) |_| {
        try expectStatusOk(audio.mixToBuffer(engine, &retained, 256, 2));
        heard_retained_pcm = heard_retained_pcm or hasSignal(&retained);
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &after_retained));
        if (after_retained.buffered_frames == 0) break;
    }
    try testing.expect(heard_retained_pcm);
    try testing.expectEqual(@as(u32, 0), after_retained.buffered_frames);
    try testing.expectEqual(audio.StreamState.reconnecting, after_retained.state);
    try testing.expectEqual(reconnecting.frames_played + reconnecting.buffered_frames, after_retained.frames_played);

    var silence: [256 * 2]f32 = undefined;
    var reached_silence = false;
    for (0..16) |_| {
        try expectStatusOk(audio.mixToBuffer(engine, &silence, 256, 2));
        if (!hasSignal(&silence)) {
            reached_silence = true;
            break;
        }
    }
    try testing.expect(reached_silence);
    var after_silence: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &after_silence));
    try testing.expectEqual(audio.StreamState.reconnecting, after_silence.state);
    try testing.expectEqual(after_retained.frames_played, after_silence.frames_played);

    try writeAllStreamBytes(engine, stream_id, mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));

    var mixed: [256 * 2]f32 = undefined;
    var final_stats: audio.StreamStats = undefined;
    for (0..5_000) |_| {
        try expectStatusOk(audio.mixToBuffer(engine, &mixed, 256, 2));
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &final_stats));
        if (final_stats.state == audio.StreamState.ended) break;
        if (final_stats.state == audio.StreamState.failed) return error.TestUnexpectedResult;
        std.Thread.sleep(std.time.ns_per_ms);
    }

    try testing.expectEqual(audio.StreamState.ended, final_stats.state);
    try testing.expect(final_stats.frames_decoded > reconnecting.frames_decoded);
    try testing.expect(final_stats.frames_played > after_retained.frames_played);
    try testing.expectEqual(@as(u64, mp3.len * 9), final_stats.bytes_received);
    try testing.expect(final_stats.ready_generation != reconnecting.ready_generation);
}

test "audio stream repeatedly restarts after clean EOF with one persistent voice" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);
    try expectStatusOk(audio.startMixer(engine));
    const mp3 = try std.fs.cwd().readFileAlloc(testing.allocator, TEST_MP3_PATH, 16 * 1024);
    defer testing.allocator.free(mp3);

    const first_group = try createGroup(engine, "session-a");
    const second_group = try createGroup(engine, "session-b");
    var options = streamOptions();
    options.capacity_ms = 200;
    options.startup_ms = 6;
    options.resume_ms = 3;
    options.volume = 0.6;
    options.pan = -0.25;
    options.group_id = first_group;

    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));
    const stream_ptr = engine.streams[0].?;
    const pcm_buffer_ptr = stream_ptr.pcm_buffer.ptr;
    try writeAllStreamBytes(engine, stream_id, mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));
    const first_end = try mixStreamToEnd(engine, stream_id);
    try testing.expectEqual(@as(u64, mp3.len), first_end.bytes_received);
    try testing.expectEqual(options.capacity_ms * (TEST_SAMPLE_RATE / 1_000), first_end.capacity_frames);
    try testing.expect(first_end.ready_generation != 0);
    try testing.expect(stream_ptr.has_started_playback);

    var engine_stats: audio.Stats = undefined;
    try expectStatusOk(audio.getStats(engine, &engine_stats));
    try testing.expectEqual(@as(u32, 1), engine_stats.voices_active);

    var stopped_mix: [256 * 2]f32 = undefined;
    try expectStatusOk(audio.mixToBuffer(engine, &stopped_mix, 256, 2));
    try expectStatusOk(audio.restartStream(engine, stream_id));

    var first_restart: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &first_restart));
    try testing.expectEqual(audio.StreamState.reconnecting, first_restart.state);
    try testing.expectEqual(first_end.bytes_received, first_restart.bytes_received);
    try testing.expectEqual(first_end.frames_decoded, first_restart.frames_decoded);
    try testing.expectEqual(first_end.frames_played, first_restart.frames_played);
    try testing.expectEqual(first_end.capacity_frames, first_restart.capacity_frames);
    try testing.expectEqual(first_end.ready_generation, first_restart.ready_generation);
    try testing.expectEqual(stream_ptr, engine.streams[0].?);
    try testing.expectEqual(pcm_buffer_ptr, stream_ptr.pcm_buffer.ptr);
    try testing.expect(stream_ptr.has_started_playback);

    var waiting_mix: [256 * 2]f32 = undefined;
    try expectStatusOk(audio.mixToBuffer(engine, &waiting_mix, 256, 2));
    try testing.expect(!hasSignal(&waiting_mix));
    var waiting_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.getStreamStats(engine, stream_id, &waiting_stats));
    try testing.expectEqual(audio.StreamState.reconnecting, waiting_stats.state);
    try testing.expectEqual(first_restart.frames_played, waiting_stats.frames_played);

    try expectStatusOk(audio.setStreamVolume(engine, stream_id, 0.8));
    try expectStatusOk(audio.setStreamPan(engine, stream_id, 0.35));
    try expectStatusOk(audio.setStreamGroup(engine, stream_id, second_group));
    try expectStatusOk(audio.getStats(engine, &engine_stats));
    try testing.expectEqual(@as(u32, 1), engine_stats.voices_active);

    try writeAllStreamBytes(engine, stream_id, mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));
    const second_end = try mixStreamToEnd(engine, stream_id);
    try testing.expectEqual(@as(u64, mp3.len * 2), second_end.bytes_received);
    try testing.expect(second_end.frames_decoded > first_end.frames_decoded);
    try testing.expect(second_end.frames_played > first_end.frames_played);

    try expectStatusOk(audio.restartStream(engine, stream_id));
    try expectStatusOk(audio.setStreamVolume(engine, stream_id, 0.4));
    try expectStatusOk(audio.setStreamPan(engine, stream_id, -0.4));
    try expectStatusOk(audio.setStreamGroup(engine, stream_id, first_group));
    try writeAllStreamBytes(engine, stream_id, mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));
    const third_end = try mixStreamToEnd(engine, stream_id);
    try testing.expectEqual(@as(u64, mp3.len * 3), third_end.bytes_received);
    try testing.expect(third_end.frames_decoded > second_end.frames_decoded);
    try testing.expect(third_end.frames_played > second_end.frames_played);
    try testing.expect(third_end.underruns >= first_end.underruns);
    try testing.expectEqual(first_end.capacity_frames, third_end.capacity_frames);
    try expectStatusOk(audio.getStats(engine, &engine_stats));
    try testing.expectEqual(@as(u32, 1), engine_stats.voices_active);

    try expectStatusOk(audio.restartStream(engine, stream_id));
    var final_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &final_stats));
    try testing.expectEqual(audio.StreamState.cancelled, final_stats.state);
    try testing.expectEqual(@as(u32, 0), final_stats.buffered_frames);
    try expectStatusOk(audio.getStats(engine, &engine_stats));
    try testing.expectEqual(@as(u32, 0), engine_stats.voices_active);
    try testing.expectEqual(audio.Status.err_not_found, audio.restartStream(engine, stream_id));
}

test "audio stream ready generation wraps to one" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);
    const mp3 = try std.fs.cwd().readFileAlloc(testing.allocator, TEST_MP3_PATH, 16 * 1024);
    defer testing.allocator.free(mp3);

    const options = streamOptions();
    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));
    const stream = engine.streams[0] orelse return error.TestUnexpectedResult;
    @atomicStore(u32, &stream.ready_generation, std.math.maxInt(u32), .release);

    try writeAllStreamBytes(engine, stream_id, mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));
    var stats: audio.StreamStats = undefined;
    for (0..5_000) |_| {
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
        if (stats.ready_generation == 1) break;
        if (stats.state == audio.StreamState.failed) return error.TestUnexpectedResult;
        std.Thread.sleep(std.time.ns_per_ms);
    }
    try testing.expectEqual(@as(u32, 1), stats.ready_generation);

    var final_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &final_stats));
}

test "audio stream restart rejects failed streams" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);

    var options = streamOptions();
    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));

    const invalid_mp3 = "not an mp3 stream";
    try writeAllStreamBytes(engine, stream_id, invalid_mp3);
    try expectStatusOk(audio.endStream(engine, stream_id));

    var stats: audio.StreamStats = undefined;
    for (0..5_000) |_| {
        try expectStatusOk(audio.getStreamStats(engine, stream_id, &stats));
        if (stats.state == audio.StreamState.failed) break;
        std.Thread.sleep(std.time.ns_per_ms);
    }
    try testing.expectEqual(audio.StreamState.failed, stats.state);
    try testing.expectEqual(audio.Status.err_invalid, audio.writeStream(engine, stream_id, invalid_mp3, invalid_mp3.len));
    try testing.expectEqual(audio.Status.err_invalid, audio.endStream(engine, stream_id));
    try testing.expectEqual(audio.Status.err_invalid, audio.restartStream(engine, stream_id));
    var final_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &final_stats));
    try testing.expectEqual(audio.StreamState.failed, final_stats.state);
    try testing.expectEqual(stats.error_code, final_stats.error_code);
    try testing.expectEqual(@as(u32, 0), final_stats.buffered_frames);
}

test "audio stream close wakes a restarted decoder waiting for bytes" {
    const engine = try createEngine(null);
    defer audio.destroy(engine);
    const mp3 = try std.fs.cwd().readFileAlloc(testing.allocator, TEST_MP3_PATH, 16 * 1024);
    defer testing.allocator.free(mp3);

    var options = streamOptions();
    options.capacity_ms = 200;
    options.startup_ms = 6;
    options.resume_ms = 3;

    var stream_id: u32 = 0;
    try expectStatusOk(audio.createStream(engine, &options, &stream_id));
    for (0..8) |_| try writeAllStreamBytes(engine, stream_id, mp3);
    _ = try waitForBufferedFrames(engine, stream_id, 4 * 1024);

    try expectStatusOk(audio.restartStream(engine, stream_id));
    var final_stats: audio.StreamStats = undefined;
    try expectStatusOk(audio.closeStream(engine, stream_id, audio.StreamCloseReason.disposed, &final_stats));
    try testing.expectEqual(audio.StreamState.cancelled, final_stats.state);
    try testing.expectEqual(@as(u32, 0), final_stats.buffered_frames);
    try testing.expectEqual(audio.Status.err_not_found, audio.restartStream(engine, stream_id));
}
