use std::sync::Mutex;

type LogCallback = unsafe extern "C" fn(level: u8, msg_ptr: *const u8, msg_len: usize);

static LOG_CALLBACK: Mutex<Option<LogCallback>> = Mutex::new(None);

pub fn set_log_callback(callback: Option<LogCallback>) {
    let mut cb = LOG_CALLBACK.lock().unwrap();
    *cb = callback;
}

fn log_message(level: u8, msg: &str) {
    let cb = LOG_CALLBACK.lock().unwrap();
    if let Some(callback) = *cb {
        unsafe {
            callback(level, msg.as_ptr(), msg.len());
        }
    }
}

#[allow(dead_code)]
pub fn debug(msg: &str) {
    log_message(0, msg);
}

#[allow(dead_code)]
pub fn info(msg: &str) {
    log_message(1, msg);
}

pub fn warn(msg: &str) {
    log_message(2, msg);
}

pub fn err(msg: &str) {
    log_message(3, msg);
}
