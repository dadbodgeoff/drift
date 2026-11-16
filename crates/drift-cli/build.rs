//! Asks Windows for the main-thread stack the other platforms give.
//!
//! Mining runs on the main thread. Linux and macOS give that thread 8 MiB of
//! stack; Windows gives it 1 MiB unless the executable asks for more, and every
//! command that mines (`init`, `census`, `setup`, `practices`, `security`, ...)
//! overflowed it there: the process died with `STATUS_STACK_OVERFLOW` and no
//! output. The size is written into the executable's header by the linker, so it
//! is asked for here and nowhere else. It is a reservation: pages are committed
//! only as the stack grows.
//!
//! Nothing changes on Linux or macOS.

/// What the main thread has on Linux and macOS (and what `card.rs` gives the
/// thread it mines on): 8 MiB.
const MAIN_STACK_BYTES: usize = 8 * 1024 * 1024;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    // The MSVC linker and the GNU one spell the same header field differently.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bins=/STACK:{MAIN_STACK_BYTES}");
    } else {
        println!("cargo:rustc-link-arg-bins=-Wl,--stack,{MAIN_STACK_BYTES}");
    }
}
