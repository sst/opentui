#!/bin/sh
set -eu

zig build test --summary all "$@"
(cd examples/hello && zig build run)
