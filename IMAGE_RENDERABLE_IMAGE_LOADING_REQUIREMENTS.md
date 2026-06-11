# ImageRenderable Image Loading Requirements

## Scope

This document covers only loading encoded image data for an `ImageRenderable` and decoding it into the existing native image representation.

Terminal rendering protocols, buffer drawing, image placement, layout behavior, animation playback, and additional image manipulation APIs are out of scope.

## Existing Foundation

The existing native image API already provides:

- PNG decoding.
- Canonical RGBA8 pixel storage.
- Image dimensions and metadata.
- Native image handles and disposal.
- Image resizing and basic image operations.

`ImageRenderable` must use this existing native image API rather than introduce a separate image representation or decoder path.

## Supported Sources

`ImageRenderable` must be able to load an image from:

- A local filesystem path.
- A `file:` URL.
- An `http:` URL.
- An `https:` URL.
- Encoded image bytes supplied as a `Uint8Array` or `ArrayBuffer`.

Local paths and `file:` URLs must be read as bytes. HTTP and HTTPS URLs must be fetched as bytes. Encoded bytes from every source must be passed to the same native decoder path.

Image format detection must be based on the encoded data, not the filename extension, URL suffix, or HTTP `Content-Type` header.

## Loading Behavior

Loading from a local path or remote URL must be asynchronous.

Loading must:

- Report filesystem read failures.
- Report unsuccessful HTTP responses.
- Report network failures.
- Report unsupported image formats separately from malformed image data when the native decoder provides that distinction.

## Required Encoded Formats

The native image decoder must support:

- PNG.
- JPEG.
- WebP.
- GIF, decoding the first frame only.

All successful decodes must produce the same canonical image representation already used by `NativeImage`:

- RGBA8 pixels.
- Straight alpha.
- Top-left image origin.
- Correct decoded width and height.
- A native image handle usable by the existing image operations.

## Format-Specific Requirements

### PNG

Existing PNG behavior must continue to work.

### JPEG

JPEG decoding must:

- Accept ordinary encoded JPEG image data.
- Produce opaque RGBA8 output.
- Report malformed JPEG data as a decode failure.

### WebP

WebP decoding must:

- Accept lossy WebP images.
- Accept lossless WebP images.
- Preserve alpha when the image contains alpha.
- Produce RGBA8 output.
- Report malformed WebP data as a decode failure.

Animated WebP playback is out of scope.

### GIF

GIF decoding must:

- Decode the first displayed frame.
- Preserve GIF transparency in the RGBA8 output.
- Return the logical image dimensions associated with the decoded output.
- Report malformed GIF data as a decode failure.

Animation playback, frame timing, and frame iteration are out of scope.

## Public Image Metadata

The public image format type and native image metadata must identify decoded PNG, JPEG, WebP, and GIF images distinctly.

The metadata returned by `imageInfo` and `NativeImage.info()` must remain consistent with the decoded image, including:

- Output width.
- Output height.
- Source width.
- Source height.
- Encoded format.
- Whether the decoded image has alpha.

`imageInfo` must recognize every supported encoded format without creating a persistent native image handle.

## Native API Consistency

`NativeImage.decode()` must accept all required encoded formats through one API.

The following behavior must be consistent across PNG, JPEG, WebP, and GIF:

- The decoder returns a `NativeImage` on success.
- The image owns its decoded pixel allocation.
- `raw()` returns canonical RGBA8 or requested BGRA8 pixels.
- Existing resize, extract, transform, composite, clone, and disposal operations work on the decoded image.
- Unsupported formats and malformed supported formats produce the appropriate existing image status.
- Existing encoded-size, dimension, pixel-count, and decoded-memory limits apply.

## ImageRenderable Integration

`ImageRenderable` must use one source-loading path that resolves a local path, URL, or encoded byte array to a `NativeImage`.

It must:

- Accept the supported source types.
- Begin loading when given a path, URL, or encoded bytes.
- Retain the successfully decoded `NativeImage` for drawing.
- Request a render after loading succeeds.
- Report loading and decoding failures.

No format-specific behavior should be required from `ImageRenderable` after decoding. PNG, JPEG, WebP, and GIF must all result in the same `NativeImage` interface.

## Required Tests

Tests must cover:

- Loading an image from a local filesystem path.
- Loading an image from a `file:` URL.
- Loading an image from an HTTP or HTTPS response.
- Loading directly from encoded bytes.
- Successful PNG decoding.
- Successful JPEG decoding.
- Successful lossy WebP decoding.
- Successful lossless WebP decoding.
- Successful WebP alpha decoding.
- Successful first-frame GIF decoding.
- GIF transparency.
- Malformed data for each supported format.
- Unsupported encoded data.
- HTTP error responses.
- Existing image operations on images decoded from each supported format.

Test fixtures should be small encoded files committed to the test suite so decoding behavior is deterministic and does not depend on external network resources.

## Completion Criteria

This work is complete when an `ImageRenderable` can receive a local path, file URL, HTTP or HTTPS URL, or encoded byte array and resolve it to the existing native RGBA image representation for PNG, JPEG, WebP, and the first frame of GIF images.
