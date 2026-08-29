CC ?= cc
CFLAGS ?= -O2 -g
PACKAGES = vulkan egl glesv2 gbm libdrm
BUILD = .build
WEBGPU_NODE_MODULES ?= ../../../node_modules
DAWN_LIBRARY = $(abspath $(WEBGPU_NODE_MODULES)/bun-webgpu-linux-x64/libwebgpu_wrapper.so)

.PHONY: all test clean
all: $(BUILD)/native-sharing

$(BUILD):
	mkdir -p $@

$(BUILD)/producer_spv.h: producer.comp | $(BUILD)
	glslangValidator -V --vn producer_spv -o $@ $<

$(BUILD)/native-sharing: native-sharing.c protocol.h $(BUILD)/producer_spv.h
	$(CC) $(CFLAGS) -std=c11 -Wall -Wextra -Werror -I$(BUILD) $(shell pkg-config --cflags $(PACKAGES)) $< -o $@ $(shell pkg-config --libs $(PACKAGES))

test: all
	timeout --kill-after=2s 30s $(BUILD)/native-sharing /dev/dri/renderD128 65 33
	timeout --kill-after=2s 30s $(BUILD)/native-sharing /dev/dri/renderD128 640 360

clean:
	rm -rf $(BUILD)

$(BUILD)/dawn/generated/include/dawn/webgpu.h: dawn-headers.sh | $(BUILD)
	bash dawn-headers.sh

$(BUILD)/dawn-consumer.so: dawn-consumer.c protocol.h $(BUILD)/dawn/generated/include/dawn/webgpu.h $(DAWN_LIBRARY)
	$(CC) $(CFLAGS) -std=c11 -Wall -Wextra -Werror -shared -fPIC -I$(BUILD)/dawn/generated/include $(shell pkg-config --cflags libdrm vulkan) $< -o $@ $(DAWN_LIBRARY)

.PHONY: dawn-test
dawn-test: all $(BUILD)/dawn-consumer.so
	WEBGPU_NODE_MODULES=$(abspath $(WEBGPU_NODE_MODULES)) timeout --kill-after=2s 30s $(BUILD)/native-sharing /dev/dri/renderD128 65 33 $(abspath dawn-consumer.ts)
	WEBGPU_NODE_MODULES=$(abspath $(WEBGPU_NODE_MODULES)) timeout --kill-after=2s 30s $(BUILD)/native-sharing /dev/dri/renderD128 640 360 $(abspath dawn-consumer.ts)

.PHONY: verify
verify: all $(BUILD)/dawn-consumer.so
	WEBGPU_NODE_MODULES=$(abspath $(WEBGPU_NODE_MODULES)) bun verify.ts .build/evidence.json
