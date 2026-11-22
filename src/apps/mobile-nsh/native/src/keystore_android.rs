//! The Android Keystore protection of the keystore record.
//!
//! NSH does not hand native modules the app's JVM, but the process has
//! exactly one, and `libnativehelper.so` (an NDK public library from
//! Android 12, API 31) exports `JNI_GetCreatedJavaVMs`. With it this module
//! attaches its threads and uses the framework's own classes, which the
//! system class loader of an attached native thread finds:
//!
//! - an AES-256-GCM key in the `AndroidKeyStore` (`KeyGenParameterSpec`,
//!   encrypt and decrypt, no user authentication so the phone stays
//!   reachable in the background); the key never leaves the Keystore (TEE or
//!   StrongBox where the phone has one);
//! - the record sealed with it (`Cipher` `AES/GCM/NoPadding`, a fresh IV the
//!   Keystore picks, the record version as associated data) into
//!   `controller/identity.sealed` (0600, see [`crate::keystore::SealedRecord`]).
//!
//! A plaintext record from an older build (`controller/identity.json`) is
//! sealed on first read and then removed. Where the JVM cannot be found
//! (Android 8 to 11 without the public `libnativehelper`), the app keeps the
//! owner-only private file and reports `private_file`. A record the Keystore
//! cannot open (restored onto another phone, Keystore reset) is kept and
//! reported unreadable; the next sign-in replaces it.

use std::sync::OnceLock;

use jni::objects::{JByteArray, JObject, JValue};
use jni::{JNIEnv, JavaVM};

use crate::keystore::{RecordSealer, SealedFileStore, SealedRecord, SecretStore};

/// The Keystore alias of the record key.
const KEY_ALIAS: &str = "com.openbitfun.mobile.controller.record.v1";
/// Associated data bound into every sealed record.
const RECORD_AAD: &[u8] = b"openbitfun-mobile-record-v1";
/// `Cipher.ENCRYPT_MODE`, `Cipher.DECRYPT_MODE`.
const ENCRYPT_MODE: i32 = 1;
const DECRYPT_MODE: i32 = 2;
/// `KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT`.
const PURPOSE_ENCRYPT_DECRYPT: i32 = 1 | 2;

/// The process's JVM, found once.
fn java_vm() -> Option<&'static JavaVM> {
    static VM: OnceLock<Option<JavaVM>> = OnceLock::new();
    VM.get_or_init(|| {
        // SAFETY: looks up and calls the JNI invocation API's
        // `JNI_GetCreatedJavaVMs` with its documented signature.
        let found = unsafe { find_java_vm() };
        match &found {
            Some(_) => log::info!("Android Keystore: the app's JVM is reachable"),
            None => log::warn!(
                "Android Keystore: the app's JVM is not reachable from the native module (needs Android 12 or later); the device key stays in an owner-only private file"
            ),
        }
        found
    })
    .as_ref()
}

unsafe fn find_java_vm() -> Option<JavaVM> {
    type GetCreatedJavaVms = unsafe extern "system" fn(
        *mut *mut jni::sys::JavaVM,
        jni::sys::jsize,
        *mut jni::sys::jsize,
    ) -> jni::sys::jint;
    // SAFETY: dlsym/dlopen with valid NUL-terminated names.
    let mut symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"JNI_GetCreatedJavaVMs".as_ptr()) };
    if symbol.is_null() {
        // SAFETY: as above; the handle is kept for the process's lifetime.
        let handle = unsafe { libc::dlopen(c"libnativehelper.so".as_ptr(), libc::RTLD_NOW) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: as above.
        symbol = unsafe { libc::dlsym(handle, c"JNI_GetCreatedJavaVMs".as_ptr()) };
    }
    if symbol.is_null() {
        return None;
    }
    // SAFETY: the symbol is `JNI_GetCreatedJavaVMs` (jni.h).
    let get_created: GetCreatedJavaVms = unsafe { std::mem::transmute(symbol) };
    let mut vm: *mut jni::sys::JavaVM = std::ptr::null_mut();
    let mut count: jni::sys::jsize = 0;
    // SAFETY: room for one VM pointer and the count.
    let status = unsafe { get_created(&mut vm, 1, &mut count) };
    if status != jni::sys::JNI_OK || count < 1 || vm.is_null() {
        return None;
    }
    // SAFETY: a live VM pointer from the invocation API.
    unsafe { JavaVM::from_raw(vm) }.ok()
}

/// The record store for Android: sealed with a Keystore key when the JVM is
/// reachable, the owner-only private file otherwise (Android 8 to 11).
pub(crate) fn store(data_dir: &std::path::Path) -> Box<dyn SecretStore> {
    let directory = data_dir.join("controller");
    let legacy = directory.join("identity.json");
    match java_vm() {
        Some(vm) => Box::new(SealedFileStore::new(
            AndroidKeystore { vm },
            directory.join("identity.sealed"),
            legacy,
        )),
        None => Box::new(crate::keystore::PrivateFile { path: legacy }),
    }
}

struct AndroidKeystore {
    vm: &'static JavaVM,
}

impl AndroidKeystore {
    fn with_env<T>(
        &self,
        work: impl FnOnce(&mut JNIEnv<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut env = self
            .vm
            .attach_current_thread()
            .map_err(|error| format!("the JVM refused this thread: {error}"))?;
        // A frame of its own, so a thread that stays attached keeps no
        // local references.
        env.with_local_frame(32, |env| work(env).map_err(Failure))
            .map_err(|failure| failure.0)
    }
}

impl RecordSealer for AndroidKeystore {
    fn seal(&self, plaintext: &[u8]) -> Result<SealedRecord, String> {
        self.with_env(|env| {
            let key = record_key(env, true)?.ok_or("the Keystore made no key")?;
            let cipher = cipher(env)?;
            call(env, |env| {
                env.call_method(
                    &cipher,
                    "init",
                    "(ILjava/security/Key;)V",
                    &[JValue::Int(ENCRYPT_MODE), JValue::Object(&key)],
                )
            })?;
            update_aad(env, &cipher)?;
            let iv = call(env, |env| {
                env.call_method(&cipher, "getIV", "()[B", &[])?.l()
            })?;
            let iv = env
                .convert_byte_array(JByteArray::from(iv))
                .map_err(|error| error.to_string())?;
            let data = do_final(env, &cipher, plaintext)?;
            Ok(SealedRecord::new(KEY_ALIAS, &iv, &data))
        })
    }

    fn open(&self, sealed: &SealedRecord) -> Result<Vec<u8>, String> {
        let (iv, data) = sealed.parts()?;
        self.with_env(|env| {
            let key = record_key(env, false)?.ok_or(
                "the Keystore holds no key for this record (restored from another phone, or the Keystore was reset)",
            )?;
            let iv = env
                .byte_array_from_slice(&iv)
                .map_err(|error| error.to_string())?;
            let spec = call(env, |env| {
                env.new_object(
                    "javax/crypto/spec/GCMParameterSpec",
                    "(I[B)V",
                    &[JValue::Int(128), JValue::Object(&*iv)],
                )
            })?;
            let cipher = cipher(env)?;
            call(env, |env| {
                env.call_method(
                    &cipher,
                    "init",
                    "(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V",
                    &[
                        JValue::Int(DECRYPT_MODE),
                        JValue::Object(&key),
                        JValue::Object(&spec),
                    ],
                )
            })?;
            update_aad(env, &cipher)?;
            do_final(env, &cipher, &data)
        })
    }
}

/// A failure inside a local frame (the frame needs `From<jni::errors::Error>`).
struct Failure(String);

impl From<jni::errors::Error> for Failure {
    fn from(error: jni::errors::Error) -> Self {
        Self(error.to_string())
    }
}

/// Runs a JNI call; a pending Java exception becomes its `toString()`.
fn call<'local, T>(
    env: &mut JNIEnv<'local>,
    work: impl FnOnce(&mut JNIEnv<'local>) -> jni::errors::Result<T>,
) -> Result<T, String> {
    match work(env) {
        Ok(value) => Ok(value),
        Err(jni::errors::Error::JavaException) => Err(java_exception(env)),
        Err(error) => {
            if env.exception_check().unwrap_or(false) {
                Err(java_exception(env))
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn java_exception(env: &mut JNIEnv<'_>) -> String {
    let Ok(throwable) = env.exception_occurred() else {
        return "a Java exception".to_string();
    };
    let _ = env.exception_clear();
    let text = env
        .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .map(jni::objects::JString::from)
        .and_then(|value| {
            env.get_string(&value)
                .map(|text| text.to_string_lossy().into_owned())
        });
    let _ = env.exception_clear();
    text.unwrap_or_else(|_| "a Java exception".to_string())
}

/// The record key, made when `create` and missing.
fn record_key<'local>(
    env: &mut JNIEnv<'local>,
    create: bool,
) -> Result<Option<JObject<'local>>, String> {
    let store_type = env
        .new_string("AndroidKeyStore")
        .map_err(|error| error.to_string())?;
    let store = call(env, |env| {
        env.call_static_method(
            "java/security/KeyStore",
            "getInstance",
            "(Ljava/lang/String;)Ljava/security/KeyStore;",
            &[JValue::Object(&*store_type)],
        )?
        .l()
    })?;
    call(env, |env| {
        env.call_method(
            &store,
            "load",
            "(Ljava/security/KeyStore$LoadStoreParameter;)V",
            &[JValue::Object(&JObject::null())],
        )
    })?;
    let alias = env
        .new_string(KEY_ALIAS)
        .map_err(|error| error.to_string())?;
    let key = call(env, |env| {
        env.call_method(
            &store,
            "getKey",
            "(Ljava/lang/String;[C)Ljava/security/Key;",
            &[JValue::Object(&*alias), JValue::Object(&JObject::null())],
        )?
        .l()
    })?;
    if !key.is_null() {
        return Ok(Some(key));
    }
    if !create {
        return Ok(None);
    }
    let builder = call(env, |env| {
        env.new_object(
            "android/security/keystore/KeyGenParameterSpec$Builder",
            "(Ljava/lang/String;I)V",
            &[
                JValue::Object(&*alias),
                JValue::Int(PURPOSE_ENCRYPT_DECRYPT),
            ],
        )
    })?;
    let modes = string_array(env, "GCM")?;
    call(env, |env| {
        env.call_method(
            &builder,
            "setBlockModes",
            "([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;",
            &[JValue::Object(&modes)],
        )
    })?;
    let paddings = string_array(env, "NoPadding")?;
    call(env, |env| {
        env.call_method(
            &builder,
            "setEncryptionPaddings",
            "([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;",
            &[JValue::Object(&paddings)],
        )
    })?;
    call(env, |env| {
        env.call_method(
            &builder,
            "setKeySize",
            "(I)Landroid/security/keystore/KeyGenParameterSpec$Builder;",
            &[JValue::Int(256)],
        )
    })?;
    let spec = call(env, |env| {
        env.call_method(
            &builder,
            "build",
            "()Landroid/security/keystore/KeyGenParameterSpec;",
            &[],
        )?
        .l()
    })?;
    let algorithm = env.new_string("AES").map_err(|error| error.to_string())?;
    let generator = call(env, |env| {
        env.call_static_method(
            "javax/crypto/KeyGenerator",
            "getInstance",
            "(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;",
            &[JValue::Object(&*algorithm), JValue::Object(&*store_type)],
        )?
        .l()
    })?;
    call(env, |env| {
        env.call_method(
            &generator,
            "init",
            "(Ljava/security/spec/AlgorithmParameterSpec;)V",
            &[JValue::Object(&spec)],
        )
    })?;
    let key = call(env, |env| {
        env.call_method(&generator, "generateKey", "()Ljavax/crypto/SecretKey;", &[])?
            .l()
    })?;
    log::info!("Android Keystore: made the device key record key");
    Ok(Some(key))
}

fn string_array<'local>(env: &mut JNIEnv<'local>, value: &str) -> Result<JObject<'local>, String> {
    let value = env.new_string(value).map_err(|error| error.to_string())?;
    let array = call(env, |env| {
        env.new_object_array(1, "java/lang/String", &value)
    })?;
    Ok(array.into())
}

fn cipher<'local>(env: &mut JNIEnv<'local>) -> Result<JObject<'local>, String> {
    let transformation = env
        .new_string("AES/GCM/NoPadding")
        .map_err(|error| error.to_string())?;
    call(env, |env| {
        env.call_static_method(
            "javax/crypto/Cipher",
            "getInstance",
            "(Ljava/lang/String;)Ljavax/crypto/Cipher;",
            &[JValue::Object(&*transformation)],
        )?
        .l()
    })
}

fn update_aad(env: &mut JNIEnv<'_>, cipher: &JObject<'_>) -> Result<(), String> {
    let aad = env
        .byte_array_from_slice(RECORD_AAD)
        .map_err(|error| error.to_string())?;
    call(env, |env| {
        env.call_method(cipher, "updateAAD", "([B)V", &[JValue::Object(&*aad)])
    })?;
    Ok(())
}

fn do_final(env: &mut JNIEnv<'_>, cipher: &JObject<'_>, input: &[u8]) -> Result<Vec<u8>, String> {
    let input = env
        .byte_array_from_slice(input)
        .map_err(|error| error.to_string())?;
    let output = call(env, |env| {
        env.call_method(cipher, "doFinal", "([B)[B", &[JValue::Object(&*input)])?
            .l()
    })?;
    env.convert_byte_array(JByteArray::from(output))
        .map_err(|error| error.to_string())
}
