use std::sync::Mutex;

type EventCallback =
    unsafe extern "C" fn(name_ptr: *const u8, name_len: usize, data_ptr: *const u8, data_len: usize);

static EVENT_CALLBACK: Mutex<Option<EventCallback>> = Mutex::new(None);

pub fn set_event_callback(callback: Option<EventCallback>) {
    let mut cb = EVENT_CALLBACK.lock().unwrap();
    *cb = callback;
}

#[allow(dead_code)]
pub fn emit_event(name: &str, data: &str) {
    let cb = EVENT_CALLBACK.lock().unwrap();
    if let Some(callback) = *cb {
        unsafe {
            callback(name.as_ptr(), name.len(), data.as_ptr(), data.len());
        }
    }
}
