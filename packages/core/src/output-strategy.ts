import type { Pointer } from "bun:ffi";
import type { RenderLib } from "./zig";

enum NativeWriteTarget {
	TTY = 0,
	BUFFER = 1,
}

export interface OutputStrategyOptions {
	stdout: NodeJS.WriteStream;
	stdin: NodeJS.ReadStream;
	lib: RenderLib;
	rendererPtr: Pointer;
	emitFlush: (event: { bytes: number; reason: string }) => void;
	onDrain: () => void;
}

export interface OutputStrategy {
	flush(reason: string): void;
	canRender(): boolean;
	setup(
		useAlternateScreen: boolean,
		processCapabilityResponse: (data: string) => void,
	): Promise<void>;
	teardown(): void;
	render(force: boolean): void;
	destroy(): void;
}

async function setupTerminalWithCapabilities(
	stdin: NodeJS.ReadStream,
	onCapability: (data: string) => void,
	setupFn: () => void,
): Promise<void> {
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			stdin.off("data", capListener);
			resolve();
		}, 100);
		const capListener = (str: string) => {
			clearTimeout(timeout);
			onCapability(str);
			stdin.off("data", capListener);
			resolve();
		};
		stdin.on("data", capListener);
		setupFn();
	});
}

class NativeOutputStrategy implements OutputStrategy {
	constructor(private options: OutputStrategyOptions) {}

	flush(_reason: string): void {
		// no-op - native handles flushing
	}

	canRender(): boolean {
		return true; // never blocked
	}

	async setup(
		useAlternateScreen: boolean,
		processCapabilityResponse: (data: string) => void,
	): Promise<void> {
		await setupTerminalWithCapabilities(
			this.options.stdin,
			processCapabilityResponse,
			() => this.options.lib.setupTerminal(this.options.rendererPtr, useAlternateScreen),
		);
	}

	teardown(): void {
		// no-op - handled elsewhere
	}

	render(force: boolean): void {
		this.options.lib.render(this.options.rendererPtr, force);
	}

	destroy(): void {
		// no-op - nothing to clean up
	}
}

class JavaScriptOutputStrategy implements OutputStrategy {
	private nativeWriteBuffer: Uint8Array = new Uint8Array(0);
	private awaitingDrain: boolean = false;
	private drainListener: (() => void) | null = null;

	constructor(private options: OutputStrategyOptions) {
		options.lib.setWriteTarget(options.rendererPtr, NativeWriteTarget.BUFFER);
	}

	flush(reason: string): void {
		const chunk = this.readNativeBuffer();
		if (!chunk || chunk.length === 0) {
			return;
		}
		const wrote = this.options.stdout.write(chunk);
		this.options.emitFlush({ bytes: chunk.length, reason });
		if (!wrote) {
			this.scheduleDrain();
		}
	}

	canRender(): boolean {
		return !this.awaitingDrain;
	}

	async setup(
		useAlternateScreen: boolean,
		processCapabilityResponse: (data: string) => void,
	): Promise<void> {
		await setupTerminalWithCapabilities(
			this.options.stdin,
			(str: string) => {
				processCapabilityResponse(str);
				this.flush("capabilities");
			},
			() => {
				this.options.lib.setupTerminalToBuffer(this.options.rendererPtr, useAlternateScreen);
				this.flush("setup");
			},
		);
	}

	teardown(): void {
		this.options.lib.teardownTerminalToBuffer(this.options.rendererPtr);
		this.flush("teardown");
	}

	render(force: boolean): void {
		this.options.lib.renderIntoWriteBuffer(this.options.rendererPtr, force);
		this.flush("frame");
	}

	destroy(): void {
		if (this.awaitingDrain && this.drainListener) {
			this.options.stdout.off?.("drain", this.drainListener);
			this.drainListener = null;
			this.awaitingDrain = false;
		}
	}

	private ensureNativeWriteBufferSize(size: number): void {
		if (this.nativeWriteBuffer.length >= size) {
			return;
		}
		const nextSize = Math.max(
			size,
			this.nativeWriteBuffer.length > 0
				? this.nativeWriteBuffer.length * 2
				: 4096,
		);
		this.nativeWriteBuffer = new Uint8Array(nextSize);
	}

	private readNativeBuffer(): Buffer | null {
		const length = this.options.lib.getWriteBufferLength(
			this.options.rendererPtr,
		);
		if (!length) {
			return null;
		}
		this.ensureNativeWriteBufferSize(length);
		const copied = this.options.lib.copyWriteBuffer(
			this.options.rendererPtr,
			this.nativeWriteBuffer,
		);
		if (!copied) {
			return null;
		}
		const chunk = this.nativeWriteBuffer.subarray(0, copied);
		return Buffer.from(chunk);
	}

	private scheduleDrain(): void {
		if (this.awaitingDrain || typeof this.options.stdout.once !== "function") {
			return;
		}
		this.awaitingDrain = true;
		this.drainListener = this.handleDrain;
		this.options.stdout.once("drain", this.handleDrain);
	}

	private handleDrain = (): void => {
		this.awaitingDrain = false;
		if (this.drainListener) {
			this.drainListener = null;
		}
		this.options.onDrain();
	};
}

export type OutputMode = 'native' | 'javascript';

export function createOutputStrategy(
	mode: OutputMode,
	options: OutputStrategyOptions,
): OutputStrategy {
	if (mode === 'javascript') {
		return new JavaScriptOutputStrategy(options);
	}
	return new NativeOutputStrategy(options);
}
