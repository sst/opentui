const std = @import("std");
const audio = @import("audio.zig");
const image = @import("image.zig");
const png = @import("png-encode.zig");

const Allocator = std.mem.Allocator;

const Decoder = opaque {};
const audio_capacity_frames: u32 = 24_000;
const audio_decode_frames: u32 = 4096;
const audio_start_frames: u32 = 12_000;

pub const Status = enum(u32) {
    ok = 0,
    invalid_handle = 1,
    invalid_argument = 2,
    open_failed = 3,
    decode_failed = 4,
    seek_failed = 5,
    out_of_memory = 6,
    no_frame = 7,
};

pub const Info = extern struct {
    duration_us: i64 = 0,
    width: u32 = 0,
    height: u32 = 0,
    fps_num: u32 = 0,
    fps_den: u32 = 1,
    has_audio: u32 = 0,
    audio_sample_rate: u32 = 0,
    audio_channels: u32 = 0,
};

pub const State = extern struct {
    current_time_us: i64 = 0,
    frame_pts_us: i64 = -1,
    frame_serial: u64 = 0,
    has_frame: u32 = 0,
    ended: u32 = 0,
    playing: u32 = 0,
    buffering: u32 = 0,
    audio_active: u32 = 0,
    audio_ended: u32 = 0,
    audio_failed: u32 = 0,
    audio_queued_frames: u32 = 0,
    audio_refill_time_us: u32 = 0,
    audio_consumed_frames: u64 = 0,
    audio_produced_frames: u64 = 0,
    audio_underruns: u64 = 0,
    audio_underrun_frames: u64 = 0,
    prepared_pts_us: i64 = -1,
    sync_lead_us: u32 = 0,
    prepare_time_us: u32 = 0,
};

// Native core entry is serialized by contract; the buffer holds the failure
// detail from the most recent open attempt, which frees its decoder before
// returning and therefore cannot expose the error through a handle.
var open_error: [256]u8 = [_]u8{0} ** 256;

pub fn lastOpenError() []const u8 {
    return std.mem.sliceTo(&open_error, 0);
}

const latency_window_size = 30;

pub const LatencyWindow = struct {
    samples: [latency_window_size]u32 = [_]u32{0} ** latency_window_size,
    count: u8 = 0,
    cursor: u8 = 0,

    pub fn add(self: *LatencyWindow, sample: u32) void {
        self.samples[self.cursor] = sample;
        self.cursor = @intCast((@as(usize, self.cursor) + 1) % latency_window_size);
        if (self.count < latency_window_size) self.count += 1;
    }

    pub fn maximum(self: *const LatencyWindow) u32 {
        var result: u32 = 0;
        for (self.samples[0..self.count]) |sample| result = @max(result, sample);
        return result;
    }

    fn reset(self: *LatencyWindow) void {
        self.* = .{};
    }
};

const PreparedFrame = struct {
    value: *image.Image,
    pts_us: i64,
    serial: u64,
};

const ProduceRequest = struct {
    target_us: i64,
    known_frame_serial: u64,
    known_prepared_serial: u64,
    png_enabled: bool,
    png_options: png.Options,
};

const ProduceOutcome = struct {
    frame: ?PreparedFrame = null,
    reached_end: bool = false,
    failed: ?anyerror = null,
    elapsed_us: u32 = 0,
};

extern fn ot_video_open(
    path: [*:0]const u8,
    out_decoder: *?*Decoder,
    out_info: *Info,
    error_out: [*]u8,
    error_cap: u32,
) c_int;
extern fn ot_video_close(decoder: *?*Decoder) void;
extern fn ot_video_seek(decoder: *Decoder, target_us: i64) c_int;
extern fn ot_video_seek_video(decoder: *Decoder, target_us: i64) c_int;
extern fn ot_video_set_output_size(decoder: *Decoder, width: u32, height: u32, cover: u32) c_int;
extern fn ot_video_decode_frame(
    decoder: *Decoder,
    target_us: i64,
    out_rgba: *?[*]const u8,
    out_width: *u32,
    out_height: *u32,
    out_stride: *u32,
    out_pts_us: *i64,
    out_serial: *u64,
) c_int;
extern fn ot_video_read_audio(decoder: *Decoder, out_samples: ?[*]f32, capacity_frames: u32, out_frames: *u32) c_int;
extern fn ot_video_last_error(decoder: *const Decoder) [*:0]const u8;
extern fn ot_video_stream_error(decoder: *const Decoder, audio_stream: u32) [*:0]const u8;

pub const Video = struct {
    allocator: Allocator,
    decoder: *Decoder,
    info: Info,
    state: State = .{},
    current_image: ?*image.Image = null,
    prepared_image: ?*image.Image = null,
    prepared_serial: u64 = 0,
    last_presented_pts_us: i64 = -1,
    last_produced_pts_us: i64 = -1,
    // Set when the media position no longer follows production stepping
    // (start, seek, reconfiguration, or a dropped stale frame); the next
    // preparation then re-anchors to the clock instead of stepping.
    resync_pending: bool = true,
    preparation_latency: LatencyWindow = .{},
    output_latency: LatencyWindow = .{},
    output_start_frame: ?u64 = null,
    last_output_frame: u64 = 0,
    output_width: u32,
    output_height: u32,
    output_cover: bool = false,
    audio_engine: ?*audio.Engine = null,
    audio_buffer: ?[]f32 = null,
    audio_ended: bool = false,
    wants_playback: bool = false,
    audio_started: bool = false,
    audio_failed: bool = false,
    muted: bool = false,
    volume: f32 = 1,
    audio_base_us: i64 = 0,
    audio_consumed_origin: u64 = 0,
    last_audio_underruns: u64 = 0,
    audio_offline: bool = false,
    audio_start_thread: ?std.Thread = null,
    audio_device_status: std.atomic.Value(i32) = std.atomic.Value(i32).init(0),
    audio_produced_frames: u64 = 0,
    audio_gain_dirty: bool = true,
    av_sync_offset_us: i64 = 0,
    // Frame production runs on a dedicated worker so decode, hardware
    // readback, scaling, and PNG encoding overlap with rendering. The worker
    // is the only thread touching the decoder's video stream; the caller
    // keeps audio, seeking, and reconfiguration, which quiesce the worker
    // first. Results hand over fully built frames under the mutex.
    worker: ?std.Thread = null,
    worker_mutex: std.Thread.Mutex = .{},
    worker_wake: std.Thread.Condition = .{},
    worker_done: std.Thread.Condition = .{},
    worker_pending: ?ProduceRequest = null,
    worker_busy: bool = false,
    worker_quit: bool = false,
    worker_result: ?ProduceOutcome = null,
    last_error_buf: [256]u8 = [_]u8{0} ** 256,
    last_error_len: usize = 0,
    png_enabled: bool = true,
    png_options: png.Options = .{},
    png_pool: ?*std.Thread.Pool = null,

    // With external_audio the caller owns the audio stream: no engine or device
    // is created and decoded PCM is pulled manually through readAudio.
    pub fn open(allocator: Allocator, path: []const u8, external_audio: bool) !*Video {
        if (path.len == 0 or std.mem.indexOfScalar(u8, path, 0) != null) return error.InvalidArgument;
        const path_z = try allocator.dupeZ(u8, path);
        defer allocator.free(path_z);
        var decoder: ?*Decoder = null;
        var info = Info{};
        open_error[0] = 0;
        if (ot_video_open(path_z.ptr, &decoder, &info, &open_error, open_error.len) != 0 or decoder == null) {
            return error.OpenFailed;
        }
        errdefer ot_video_close(&decoder);
        const video = try allocator.create(Video);
        errdefer allocator.destroy(video);
        video.* = .{
            .allocator = allocator,
            .decoder = decoder.?,
            .info = info,
            .output_width = info.width,
            .output_height = info.height,
        };
        if (info.has_audio != 0 and !external_audio) {
            const engine = audio.create(allocator, &.{ .sample_rate = 48_000, .playback_channels = 2 }) orelse return error.OutOfMemory;
            errdefer audio.destroy(engine);
            if (audio.enablePcmStream(engine, true, audio_capacity_frames, 2) != audio.Status.ok) return error.OutOfMemory;
            video.audio_engine = engine;
            video.audio_buffer = try allocator.alloc(f32, audio_decode_frames * 2);
        }
        return video;
    }

    pub fn deinit(self: *Video) void {
        self.quiesceWorker();
        self.worker_mutex.lock();
        self.worker_quit = true;
        self.worker_wake.broadcast();
        self.worker_mutex.unlock();
        if (self.worker) |thread| thread.join();
        if (self.png_pool) |pool| {
            pool.deinit();
            self.allocator.destroy(pool);
        }
        if (self.audio_start_thread) |thread| thread.join();
        if (self.audio_engine) |engine| audio.destroy(engine);
        if (self.audio_buffer) |buffer| self.allocator.free(buffer);
        if (self.current_image) |value| value.deinit();
        if (self.prepared_image) |value| value.deinit();
        var decoder: ?*Decoder = self.decoder;
        ot_video_close(&decoder);
        self.allocator.destroy(self);
    }

    pub fn configureOutput(self: *Video, width: u32, height: u32, cover: bool) !void {
        if (width == 0 or height == 0) return error.InvalidArgument;
        if (width == self.output_width and height == self.output_height and cover == self.output_cover) return;
        self.quiesceWorker();
        if (ot_video_set_output_size(self.decoder, width, height, @intFromBool(cover)) != 0) return error.DecodeFailed;
        self.output_width = width;
        self.output_height = height;
        self.output_cover = cover;
        if (ot_video_seek_video(self.decoder, self.state.current_time_us) != 0) return error.SeekFailed;
        // The stale-sized frame stays presentable until its replacement is
        // decoded, so reconfiguring does not blank the placement.
        self.clearPrepared();
        self.resetScheduler();
        self.state.frame_serial = 0;
        self.state.frame_pts_us = -1;
    }

    // Kitty is the only consumer of the per-frame PNG stream; other protocols
    // skip the encoder entirely.
    pub fn setPngEnabled(self: *Video, enabled: bool) void {
        self.quiesceWorker();
        self.png_enabled = enabled;
    }

    pub fn configurePng(self: *Video, compression_level: u32, predictor: u32, color_mode: u32) !void {
        if (compression_level > 9 or predictor > 5 or color_mode > 8) return error.InvalidArgument;
        self.quiesceWorker();
        self.png_options = .{ .level = compression_level, .predictor = predictor, .color_mode = color_mode };
        // Keep the current frame visible; resetting the serial forces the next
        // decode to replace it with the new PNG settings.
        self.state.frame_serial = 0;
        self.state.frame_pts_us = -1;
        self.clearPrepared();
        self.preparation_latency.reset();
    }

    pub fn seek(self: *Video, target_us: i64) !void {
        if (target_us < 0) return error.InvalidArgument;
        self.quiesceWorker();
        const was_started = self.audio_started;
        if (was_started) audio.suspendMixer(self.audio_engine.?);
        if (ot_video_seek(self.decoder, target_us) != 0) {
            if (was_started) audio.resumeMixer(self.audio_engine.?);
            return error.SeekFailed;
        }
        if (self.audio_engine) |engine| {
            if (audio.enablePcmStream(engine, true, audio_capacity_frames, 2) != audio.Status.ok) return error.DecodeFailed;
        }
        self.audio_ended = false;
        self.audio_started = false;
        self.audio_failed = false;
        self.audio_base_us = target_us;
        self.audio_consumed_origin = 0;
        self.last_audio_underruns = 0;
        self.audio_produced_frames = 0;
        self.state.audio_refill_time_us = 0;
        self.state.current_time_us = target_us;
        self.state.frame_pts_us = -1;
        self.state.ended = 0;
        self.state.frame_serial = 0;
        self.state.has_frame = 0;
        if (self.current_image) |value| value.deinit();
        self.current_image = null;
        self.clearPrepared();
        self.last_presented_pts_us = -1;
        self.last_produced_pts_us = -1;
        self.resync_pending = true;
    }

    pub fn update(self: *Video, target_us: i64) !bool {
        if (target_us < 0) return error.InvalidArgument;
        const effective_target = try self.updateAudio(target_us);
        var frame_target = std.math.add(i64, effective_target, self.av_sync_offset_us) catch
            if (self.av_sync_offset_us > 0) @as(i64, std.math.maxInt(i64)) else @as(i64, std.math.minInt(i64));
        frame_target = @max(0, frame_target);
        if (self.info.duration_us > 0) {
            frame_target = if (effective_target >= self.info.duration_us)
                self.info.duration_us
            else
                @min(frame_target, self.info.duration_us - 1);
        }
        self.state.current_time_us = effective_target;
        const outcome = self.produceBlocking(frame_target);
        self.state.prepare_time_us = outcome.elapsed_us;
        if (outcome.failed) |err| {
            self.captureVideoError();
            return err;
        }
        if (outcome.reached_end) {
            self.state.ended = 1;
            return false;
        }
        self.state.ended = 0;
        const decoded = outcome.frame orelse return false;
        self.last_produced_pts_us = decoded.pts_us;
        self.resync_pending = false;
        self.publish(decoded);
        return true;
    }

    // Posts asynchronous frame production; the result is collected by
    // schedule(), prepareNext(), or drainPreparation(). Never blocks.
    pub fn prepare(self: *Video, target_us: i64) !bool {
        if (target_us < 0) return error.InvalidArgument;
        const frame_target = if (self.info.duration_us > 0)
            @min(target_us, self.info.duration_us - 1)
        else
            target_us;
        self.worker_mutex.lock();
        defer self.worker_mutex.unlock();
        if (self.worker_busy or self.worker_pending != null or self.worker_result != null) return false;
        try self.ensureWorkerLocked();
        self.worker_pending = .{
            .target_us = frame_target,
            .known_frame_serial = self.state.frame_serial,
            .known_prepared_serial = self.prepared_serial,
            .png_enabled = self.png_enabled,
            .png_options = self.png_options,
        };
        self.worker_wake.signal();
        return true;
    }

    // Test and shutdown helper: waits for in-flight production and collects it.
    pub fn drainPreparation(self: *Video) void {
        self.worker_mutex.lock();
        while (self.worker_busy or self.worker_pending != null) self.worker_done.wait(&self.worker_mutex);
        self.worker_mutex.unlock();
        self.collectPrepared();
    }

    fn ensureWorkerLocked(self: *Video) !void {
        if (self.png_pool == null) {
            const pool = self.allocator.create(std.Thread.Pool) catch return error.OutOfMemory;
            // Deflate parallelism has diminishing returns past a few chunks;
            // the worker also participates while waiting.
            pool.init(.{ .allocator = self.allocator, .n_jobs = @min(4, std.Thread.getCpuCount() catch 4) }) catch {
                self.allocator.destroy(pool);
                return error.OutOfMemory;
            };
            self.png_pool = pool;
        }
        if (self.worker != null) return;
        self.worker = std.Thread.spawn(.{}, workerMain, .{self}) catch return error.OutOfMemory;
    }

    fn workerMain(self: *Video) void {
        while (true) {
            self.worker_mutex.lock();
            while (self.worker_pending == null and !self.worker_quit) self.worker_wake.wait(&self.worker_mutex);
            if (self.worker_quit) {
                self.worker_mutex.unlock();
                return;
            }
            const request = self.worker_pending.?;
            self.worker_pending = null;
            self.worker_busy = true;
            self.worker_mutex.unlock();

            const started = std.time.microTimestamp();
            var outcome = self.produceFrame(request);
            outcome.elapsed_us = @intCast(@min(std.time.microTimestamp() - started, std.math.maxInt(u32)));

            self.worker_mutex.lock();
            if (self.worker_result) |previous| {
                if (previous.frame) |frame| frame.value.deinit();
            }
            self.worker_result = outcome;
            self.worker_busy = false;
            self.worker_done.broadcast();
            self.worker_mutex.unlock();
        }
    }

    // Runs on the worker thread. Touches only the decoder's video stream and
    // the thread-safe allocator; every input is snapshotted in the request.
    fn produceFrame(self: *Video, request: ProduceRequest) ProduceOutcome {
        var pixels: ?[*]const u8 = null;
        var width: u32 = 0;
        var height: u32 = 0;
        var stride: u32 = 0;
        var pts_us: i64 = -1;
        var serial: u64 = 0;
        const result = ot_video_decode_frame(
            self.decoder,
            request.target_us,
            &pixels,
            &width,
            &height,
            &stride,
            &pts_us,
            &serial,
        );
        if (timingEnabled()) {
            std.debug.print("OTVT produce target={d} pts={d} serial={d} known={d}/{d} result={d}\n", .{
                request.target_us, pts_us, serial, request.known_frame_serial, request.known_prepared_serial, result,
            });
        }
        if (result == 1) return .{ .reached_end = true };
        if (result != 0 or pixels == null) return .{ .failed = error.DecodeFailed };
        if (serial == request.known_frame_serial or serial == request.known_prepared_serial) return .{};
        const required = @as(usize, stride) * height;
        const next = image.createFromRgba(self.allocator, pixels.?[0..required], width, height, stride) catch |err|
            return .{ .failed = err };
        if (request.png_enabled) {
            const png_started = std.time.microTimestamp();
            next.encoded_png = png.encode(
                self.allocator,
                self.png_pool.?,
                pixels.?[0..required],
                width,
                height,
                request.png_options,
            ) catch |err| {
                next.deinit();
                return .{ .failed = err };
            };
            if (timingEnabled()) {
                std.debug.print("OTVT png={d:.3}\n", .{@as(f64, @floatFromInt(std.time.microTimestamp() - png_started)) / 1000.0});
            }
        }
        return .{ .frame = .{ .value = next, .pts_us = pts_us, .serial = serial } };
    }

    fn timingEnabled() bool {
        const state = struct {
            var cached: ?bool = null;
        };
        if (state.cached == null) {
            const value = std.posix.getenv("OPENTUI_VIDEO_TIMING");
            state.cached = value != null and std.mem.eql(u8, value.?, "1");
        }
        return state.cached.?;
    }

    // Blocks the caller while the worker produces one frame; used by the
    // synchronous update() path (first frame, seek preview).
    fn produceBlocking(self: *Video, target_us: i64) ProduceOutcome {
        self.worker_mutex.lock();
        // Discard any stale in-flight preparation first.
        self.worker_pending = null;
        while (self.worker_busy) self.worker_done.wait(&self.worker_mutex);
        if (self.worker_result) |previous| {
            if (previous.frame) |frame| frame.value.deinit();
            self.worker_result = null;
        }
        self.ensureWorkerLocked() catch {
            self.worker_mutex.unlock();
            return .{ .failed = error.OutOfMemory };
        };
        self.worker_pending = .{
            .target_us = target_us,
            .known_frame_serial = if (self.current_image != null) self.state.frame_serial else std.math.maxInt(u64),
            .known_prepared_serial = self.prepared_serial,
            .png_enabled = self.png_enabled,
            .png_options = self.png_options,
        };
        self.worker_wake.signal();
        while (self.worker_busy or self.worker_pending != null) self.worker_done.wait(&self.worker_mutex);
        const outcome = self.worker_result orelse ProduceOutcome{};
        self.worker_result = null;
        self.worker_mutex.unlock();
        return outcome;
    }

    // Moves a finished worker result into the prepared slot on the caller.
    fn collectPrepared(self: *Video) void {
        self.worker_mutex.lock();
        const outcome = self.worker_result;
        self.worker_result = null;
        self.worker_mutex.unlock();
        const value = outcome orelse return;
        self.state.prepare_time_us = value.elapsed_us;
        if (value.failed != null) {
            self.captureVideoError();
            return;
        }
        const frame = value.frame orelse return;
        self.preparation_latency.add(value.elapsed_us);
        self.updateSyncLead();
        self.clearPrepared();
        self.prepared_image = frame.value;
        self.prepared_serial = frame.serial;
        self.state.prepared_pts_us = frame.pts_us;
        self.last_produced_pts_us = frame.pts_us;
    }

    // Cancels pending work and waits out in-flight production; the caller may
    // then mutate the decoder's video stream safely.
    fn quiesceWorker(self: *Video) void {
        self.worker_mutex.lock();
        self.worker_pending = null;
        while (self.worker_busy) self.worker_done.wait(&self.worker_mutex);
        if (self.worker_result) |previous| {
            if (previous.frame) |frame| frame.value.deinit();
            self.worker_result = null;
        }
        self.worker_mutex.unlock();
    }

    fn captureVideoError(self: *Video) void {
        const message = std.mem.span(ot_video_stream_error(self.decoder, 0));
        const length = @min(message.len, self.last_error_buf.len);
        @memcpy(self.last_error_buf[0..length], message[0..length]);
        self.last_error_len = length;
    }

    pub fn schedule(self: *Video, fallback_time_us: i64, presentation_interval_us: u32, output_frame: u64, output_write_us: u32) !void {
        if (fallback_time_us < 0 or presentation_interval_us == 0) return error.InvalidArgument;
        self.state.current_time_us = try self.updateAudio(fallback_time_us);
        self.observeOutput(output_frame, output_write_us);
        self.collectPrepared();
        self.updateSyncLead();
        const prepared = self.prepared_image orelse return;
        const prepared_pts = self.state.prepared_pts_us;
        if (prepared_pts < self.state.current_time_us - presentation_interval_us) {
            self.clearPrepared();
            self.resync_pending = true;
            return;
        }
        const deadline = prepared_pts - @as(i64, self.output_latency.maximum()) - self.av_sync_offset_us;
        if (self.state.current_time_us < deadline) return;
        self.prepared_image = null;
        self.publish(.{ .value = prepared, .pts_us = prepared_pts, .serial = self.prepared_serial });
        self.prepared_serial = 0;
        self.state.prepared_pts_us = -1;
    }

    pub fn prepareNext(self: *Video, presentation_interval_us: u32, output_frame: u64, output_write_us: u32) !bool {
        if (presentation_interval_us == 0) return error.InvalidArgument;
        self.observeOutput(output_frame, output_write_us);
        self.collectPrepared();
        if (self.prepared_image != null) return false;
        self.updateSyncLead();
        // Production marches through the source deterministically: one
        // presentation step per produced frame, independent of scheduling
        // jitter. The half-step margin makes the at-or-before frame selection
        // reach the next frame across timestamp rounding. Only a resync
        // (start, seek, reconfiguration, dropped frame) consults the clock.
        const interval: i64 = presentation_interval_us;
        const source_interval: i64 = if (self.info.fps_num > 0)
            @intCast((@as(u64, 1_000_000) * self.info.fps_den + self.info.fps_num - 1) / self.info.fps_num)
        else
            interval;
        const target = if (self.resync_pending or self.last_produced_pts_us < 0)
            self.state.current_time_us + @as(i64, self.state.sync_lead_us) + interval + self.av_sync_offset_us
        else
            self.last_produced_pts_us + @max(interval, source_interval) + @divTrunc(source_interval, 2);
        self.resync_pending = false;
        return self.prepare(@max(0, target));
    }

    fn publish(self: *Video, decoded: PreparedFrame) void {
        if (self.current_image) |previous| previous.deinit();
        self.current_image = decoded.value;
        self.state.frame_pts_us = decoded.pts_us;
        self.state.frame_serial = decoded.serial;
        self.state.has_frame = 1;
        self.last_presented_pts_us = decoded.pts_us;
    }

    pub fn clearPrepared(self: *Video) void {
        if (self.prepared_image) |value| value.deinit();
        self.prepared_image = null;
        self.prepared_serial = 0;
        self.state.prepared_pts_us = -1;
    }

    fn updateSyncLead(self: *Video) void {
        self.state.sync_lead_us = self.preparation_latency.maximum() +| self.output_latency.maximum();
    }

    pub fn frameSubmitted(self: *Video, output_frame: u64) void {
        if (self.output_start_frame == null) self.output_start_frame = output_frame +| 2;
    }

    pub fn resetOutputTiming(self: *Video) void {
        self.quiesceWorker();
        self.output_latency.reset();
        self.output_start_frame = null;
        self.last_output_frame = 0;
        self.updateSyncLead();
        self.clearPrepared();
    }

    fn observeOutput(self: *Video, output_frame: u64, output_write_us: u32) void {
        const start = self.output_start_frame orelse return;
        if (output_frame < start or output_frame == self.last_output_frame or output_write_us == 0) return;
        self.last_output_frame = output_frame;
        self.output_latency.add(output_write_us);
    }

    fn resetScheduler(self: *Video) void {
        self.clearPrepared();
        self.last_presented_pts_us = -1;
        self.last_produced_pts_us = -1;
        self.resync_pending = true;
        self.preparation_latency.reset();
        self.output_latency.reset();
        self.output_start_frame = null;
        self.last_output_frame = 0;
        self.state.sync_lead_us = 0;
    }

    pub fn service(self: *Video, target_us: i64) !void {
        if (target_us < 0) return error.InvalidArgument;
        self.state.current_time_us = try self.updateAudio(target_us);
    }

    pub fn getFrame(self: *Video) ?*image.Image {
        const value = self.current_image orelse return null;
        value.retain();
        return value;
    }

    pub fn getState(self: *Video) State {
        if (self.audio_started) self.state.current_time_us = self.audioTimeUs();
        self.refreshAudioState(self.wants_playback and self.audio_engine != null and !self.audio_started and !self.audio_failed and !self.audio_ended);
        return self.state;
    }

    fn decodeAudio(self: *Video, samples: []f32, capacity_frames: u32) !u32 {
        if (self.info.has_audio == 0) return 0;
        const required = @as(usize, capacity_frames) * self.info.audio_channels;
        if (samples.len < required) return error.InvalidArgument;
        var frames: u32 = 0;
        if (ot_video_read_audio(self.decoder, if (samples.len == 0) null else samples.ptr, capacity_frames, &frames) < 0) {
            return error.DecodeFailed;
        }
        return frames;
    }

    pub fn readAudio(self: *Video, samples: []f32, capacity_frames: u32) !u32 {
        if (self.audio_engine != null) return error.InvalidArgument;
        return self.decodeAudio(samples, capacity_frames);
    }

    pub fn enableAudioTap(self: *Video, enabled: bool, capacity_frames: u32) !void {
        const engine = self.audio_engine orelse return error.InvalidArgument;
        const status = audio.enableTap(engine, enabled, capacity_frames);
        if (status == audio.Status.err_no_space) return error.OutOfMemory;
        if (status != audio.Status.ok) return error.InvalidArgument;
    }

    pub fn readAudioTap(self: *Video, samples: []f32, frame_count: u32, channels: u8, end_frame: *u64) !u32 {
        const engine = self.audio_engine orelse return error.InvalidArgument;
        const required = std.math.mul(usize, @as(usize, frame_count), @as(usize, channels)) catch
            return error.InvalidArgument;
        if (samples.len < required) return error.InvalidArgument;
        var frames_read: u32 = 0;
        const status = audio.readTapPositioned(engine, samples.ptr, frame_count, channels, &frames_read, end_frame);
        if (status != audio.Status.ok) return error.InvalidArgument;
        return frames_read;
    }

    pub fn refillAudio(self: *Video, max_frames: u32) !u32 {
        const engine = self.audio_engine orelse return 0;
        const buffer = self.audio_buffer orelse return 0;
        if (self.audio_ended or max_frames == 0) return 0;
        const queued = audio.getPcmQueuedFrames(engine);
        const writable = audio_capacity_frames -| queued;
        const requested = @min(max_frames, @min(writable, audio_decode_frames));
        if (requested == 0) return 0;
        const decoded = try self.decodeAudio(buffer, requested);
        if (decoded == 0) {
            self.audio_ended = true;
            return 0;
        }
        var written: u32 = 0;
        if (audio.writePcm(engine, buffer.ptr, decoded, &written) != audio.Status.ok or written != decoded) {
            return error.DecodeFailed;
        }
        return written;
    }

    fn audioTimeUs(self: *Video) i64 {
        const engine = self.audio_engine orelse return self.audio_base_us;
        const consumed = audio.getPcmConsumedFrames(engine);
        return self.audio_base_us + @as(i64, @intCast((consumed -| self.audio_consumed_origin) * 1_000_000 / 48_000));
    }

    fn refreshAudioState(self: *Video, buffering: bool) void {
        const engine = self.audio_engine orelse {
            self.state.playing = @intFromBool(self.wants_playback);
            self.state.buffering = 0;
            self.state.audio_active = 0;
            self.state.audio_ended = @intFromBool(self.audio_ended);
            self.state.audio_failed = 0;
            self.state.audio_queued_frames = 0;
            self.state.audio_refill_time_us = 0;
            self.state.audio_consumed_frames = 0;
            self.state.audio_produced_frames = 0;
            self.state.audio_underruns = 0;
            self.state.audio_underrun_frames = 0;
            return;
        };
        self.state.playing = @intFromBool(self.wants_playback);
        self.state.buffering = @intFromBool(buffering);
        self.state.audio_active = @intFromBool(self.audio_started);
        self.state.audio_ended = @intFromBool(self.audio_ended);
        self.state.audio_failed = @intFromBool(self.audio_failed);
        self.state.audio_queued_frames = audio.getPcmQueuedFrames(engine);
        self.state.audio_consumed_frames = audio.getPcmConsumedFrames(engine);
        self.state.audio_produced_frames = self.audio_produced_frames;
        self.state.audio_underruns = audio.getPcmUnderrunEvents(engine);
        self.state.audio_underrun_frames = audio.getPcmUnderrunFrames(engine);
    }

    fn updateAudio(self: *Video, fallback_time_us: i64) !i64 {
        const engine = self.audio_engine orelse {
            self.refreshAudioState(false);
            return fallback_time_us;
        };
        const device_status = self.audio_device_status.load(.acquire);
        if (device_status != 0 and self.audio_start_thread != null) {
            self.audio_start_thread.?.join();
            self.audio_start_thread = null;
        }
        if (device_status < 0) self.audio_failed = true;
        if ((self.audio_offline or device_status > 0) and self.audio_gain_dirty) {
            if (audio.setMasterVolume(engine, if (self.muted) 0 else self.volume) != audio.Status.ok) self.audio_failed = true;
            self.audio_gain_dirty = false;
        }
        if (!self.wants_playback or self.audio_failed) {
            self.refreshAudioState(false);
            return fallback_time_us;
        }

        const underruns = audio.getPcmUnderrunEvents(engine);
        if (self.audio_started and underruns > self.last_audio_underruns) {
            self.audio_base_us = self.audioTimeUs();
            self.audio_consumed_origin = audio.getPcmConsumedFrames(engine);
            audio.suspendMixer(engine);
            self.audio_started = false;
        }
        self.last_audio_underruns = underruns;

        const refill_started = std.time.microTimestamp();
        const produced = try self.refillAudio(audio_decode_frames);
        self.audio_produced_frames += produced;
        self.state.audio_refill_time_us = @intCast(@min(std.time.microTimestamp() - refill_started, std.math.maxInt(u32)));
        const queued = audio.getPcmQueuedFrames(engine);
        const can_start = queued >= audio_start_frames or (self.audio_ended and queued > 0);
        if (!self.audio_started and can_start) {
            self.audio_consumed_origin = audio.getPcmConsumedFrames(engine);
            if (self.audio_offline) {
                if (audio.startMixer(engine) != audio.Status.ok) return error.DecodeFailed;
                self.audio_started = true;
            } else if (device_status > 0) {
                audio.resumeMixer(engine);
                self.audio_started = true;
            }
        }

        if (self.audio_started and self.audio_ended and audio.getPcmQueuedFrames(engine) == 0) {
            self.audio_base_us = self.audioTimeUs();
            self.audio_consumed_origin = audio.getPcmConsumedFrames(engine);
            audio.suspendMixer(engine);
            self.audio_started = false;
        }
        self.refreshAudioState(!self.audio_started and !self.audio_failed and !(self.audio_ended and queued == 0));
        return if (self.audio_started) self.audioTimeUs() else if (self.audio_failed or (self.audio_ended and queued == 0)) fallback_time_us else self.audio_base_us;
    }

    pub fn play(self: *Video) void {
        self.wants_playback = true;
        self.state.ended = 0;
        if (self.audio_engine != null and !self.audio_offline and !self.audio_failed and
            self.audio_device_status.load(.acquire) == 0 and self.audio_start_thread == null)
        {
            self.audio_start_thread = std.Thread.spawn(.{}, startAudioDevice, .{self}) catch null;
            if (self.audio_start_thread == null) self.audio_device_status.store(-1, .release);
        }
        if (self.audio_engine == null) self.state.playing = 1;
    }

    fn startAudioDevice(self: *Video) void {
        const status = audio.startSuspended(self.audio_engine.?, null);
        self.audio_device_status.store(if (status == audio.Status.ok) 1 else -1, .release);
    }

    pub fn pause(self: *Video) void {
        if (self.audio_started) {
            self.audio_base_us = self.audioTimeUs();
            self.audio_consumed_origin = audio.getPcmConsumedFrames(self.audio_engine.?);
            audio.suspendMixer(self.audio_engine.?);
            self.audio_started = false;
        } else {
            self.audio_base_us = self.state.current_time_us;
        }
        self.wants_playback = false;
        self.refreshAudioState(false);
    }

    pub fn setMuted(self: *Video, muted: bool) !void {
        self.muted = muted;
        self.audio_gain_dirty = true;
        if (self.audio_offline or self.audio_device_status.load(.acquire) > 0) if (self.audio_engine) |engine| {
            if (audio.setMasterVolume(engine, if (muted) 0 else self.volume) != audio.Status.ok) return error.DecodeFailed;
            self.audio_gain_dirty = false;
        };
    }

    pub fn setVolume(self: *Video, volume: f32) !void {
        if (!std.math.isFinite(volume) or volume < 0) return error.InvalidArgument;
        self.volume = volume;
        self.audio_gain_dirty = true;
        if (!self.muted) {
            if (self.audio_offline or self.audio_device_status.load(.acquire) > 0) if (self.audio_engine) |engine| {
                if (audio.setMasterVolume(engine, volume) != audio.Status.ok) return error.DecodeFailed;
                self.audio_gain_dirty = false;
            };
        }
    }

    pub fn setAvSyncOffset(self: *Video, offset_us: i64) void {
        self.av_sync_offset_us = offset_us;
        self.quiesceWorker();
        self.clearPrepared();
        self.resync_pending = true;
    }

    pub fn setAudioOffline(self: *Video, offline: bool) void {
        self.audio_offline = offline;
    }

    pub fn lastError(self: *const Video) []const u8 {
        if (self.last_error_len > 0) return self.last_error_buf[0..self.last_error_len];
        return std.mem.span(ot_video_last_error(self.decoder));
    }
};

pub fn statusFromError(err: anyerror) Status {
    return switch (err) {
        error.InvalidArgument => .invalid_argument,
        error.OpenFailed => .open_failed,
        error.SeekFailed => .seek_failed,
        error.OutOfMemory => .out_of_memory,
        else => .decode_failed,
    };
}
