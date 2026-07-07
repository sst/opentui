const host = @import("clipboard/host.zig");

pub const Handle = host.Handle;
pub const OperationStatus = host.OperationStatus;
pub const StartStatus = host.StartStatus;
pub const CancelStatus = host.CancelStatus;
pub const CopyStatus = host.CopyStatus;
pub const DestroyStatus = host.DestroyStatus;
pub const ShutdownStatus = host.ShutdownStatus;

pub const createService = host.createService;
pub const beginServiceShutdown = host.beginServiceShutdown;
pub const pollServiceShutdown = host.pollServiceShutdown;
pub const destroyService = host.destroyService;
pub const drainService = host.drainService;

pub const startTestOperation = host.startTestOperation;
pub const startReadOperation = host.startReadOperation;
pub const startWriteOperation = host.startWriteOperation;
pub const startClearOperation = host.startClearOperation;
pub const pollOperation = host.pollOperation;
pub const cancelOperation = host.cancelOperation;
pub const resultMimeLength = host.resultMimeLength;
pub const resultMimeCopy = host.resultMimeCopy;
pub const resultDataLength = host.resultDataLength;
pub const resultDataCopy = host.resultDataCopy;
pub const resultErrorCode = host.resultErrorCode;
pub const resultDiagnosticLength = host.resultDiagnosticLength;
pub const resultDiagnosticCopy = host.resultDiagnosticCopy;
pub const destroyOperation = host.destroyOperation;
