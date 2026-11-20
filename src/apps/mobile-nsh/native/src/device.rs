//! What this phone is called: the name the account's other devices show
//! for it (the directory's device name and Link's display name), from the
//! platform's own model facts. No product rules; nothing the user typed.

/// The phone's name for the account's device lists.
///
/// - Android: the manufacturer and model (`Build.MANUFACTURER`,
///   `Build.MODEL`, read from `ro.product.*`), e.g. `Google Pixel 9`.
/// - iOS: the simulator's device name, else the hardware model
///   (`hw.machine`, e.g. `iPhone (iPhone17,1)`).
pub(crate) fn display_name() -> String {
    platform_name()
        .map(|name| clean(&name))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| fallback_name().to_string())
}

fn fallback_name() -> &'static str {
    if cfg!(target_os = "ios") {
        "iPhone"
    } else if cfg!(target_os = "android") {
        "Android phone"
    } else {
        "Phone"
    }
}

/// One line, no control characters, at most 64 characters.
fn clean(name: &str) -> String {
    let single: String = name
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut words = single.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some((index, _)) = words.char_indices().nth(64) {
        words.truncate(index);
    }
    words.trim().to_string()
}

/// `manufacturer model`, without repeating a manufacturer the model already
/// names (`samsung` + `SM-S921B` → `Samsung SM-S921B`; `Google` + `Pixel 9`
/// → `Google Pixel 9`; `OnePlus` + `OnePlus 12` → `OnePlus 12`).
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
fn android_name(manufacturer: &str, model: &str) -> Option<String> {
    let manufacturer = manufacturer.trim();
    let model = model.trim();
    if model.is_empty() {
        return None;
    }
    if manufacturer.is_empty()
        || model
            .to_ascii_lowercase()
            .starts_with(&manufacturer.to_ascii_lowercase())
    {
        return Some(model.to_string());
    }
    let mut chars = manufacturer.chars();
    let manufacturer = match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
        None => String::new(),
    };
    Some(format!("{manufacturer} {model}"))
}

#[cfg(target_os = "android")]
fn platform_name() -> Option<String> {
    android_name(
        &android_property("ro.product.manufacturer").unwrap_or_default(),
        &android_property("ro.product.model")?,
    )
}

#[cfg(target_os = "ios")]
fn platform_name() -> Option<String> {
    // The simulator names itself (`iPhone 16 Pro`).
    if let Ok(name) = std::env::var("SIMULATOR_DEVICE_NAME") {
        return Some(name);
    }
    let machine = sysctl_string(c"hw.machine")?;
    let family = ["iPhone", "iPad", "iPod"]
        .into_iter()
        .find(|family| machine.starts_with(family))
        .unwrap_or("iPhone");
    Some(format!("{family} ({machine})"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn platform_name() -> Option<String> {
    None
}

#[cfg(target_os = "ios")]
fn sysctl_string(name: &std::ffi::CStr) -> Option<String> {
    let mut size: libc::size_t = 0;
    // SAFETY: a size query with a valid NUL-terminated name.
    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || size == 0 {
        return None;
    }
    let mut buffer = vec![0u8; size];
    // SAFETY: `buffer` holds `size` bytes.
    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 {
        return None;
    }
    buffer.truncate(size);
    let text = std::ffi::CStr::from_bytes_until_nul(&buffer).ok()?;
    Some(text.to_string_lossy().into_owned())
}

/// An Android system property (`ro.product.model`, `debug.openbitfun.log`),
/// `None` when unset or empty.
#[cfg(target_os = "android")]
pub(crate) fn android_property(name: &str) -> Option<String> {
    let name = std::ffi::CString::new(name).ok()?;
    // PROP_VALUE_MAX is 92 bytes with the NUL.
    let mut value = [0 as std::ffi::c_char; 92];
    // SAFETY: a valid NUL-terminated name and a PROP_VALUE_MAX buffer.
    let length = unsafe { libc::__system_property_get(name.as_ptr(), value.as_mut_ptr()) };
    if length <= 0 {
        return None;
    }
    // SAFETY: the call wrote a NUL-terminated value into `value`.
    let text = unsafe { std::ffi::CStr::from_ptr(value.as_ptr()) };
    Some(text.to_string_lossy().trim().to_string()).filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_names_join_manufacturer_and_model_once() {
        assert_eq!(
            android_name("Google", "Pixel 9").as_deref(),
            Some("Google Pixel 9")
        );
        assert_eq!(
            android_name("samsung", "SM-S921B").as_deref(),
            Some("Samsung SM-S921B")
        );
        assert_eq!(
            android_name("OnePlus", "OnePlus 12").as_deref(),
            Some("OnePlus 12")
        );
        assert_eq!(android_name("", "Pixel").as_deref(), Some("Pixel"));
        assert_eq!(android_name("Google", " "), None);
    }

    #[test]
    fn names_are_one_short_line() {
        assert_eq!(clean("  Pixel\n9\t Pro "), "Pixel 9 Pro");
        assert_eq!(clean(&"x".repeat(100)).chars().count(), 64);
        assert!(!display_name().is_empty());
    }
}
