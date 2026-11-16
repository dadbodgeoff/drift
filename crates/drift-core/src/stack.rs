//! Thread stacks for parsing untrusted files, sized so that no file Drift parses
//! can overflow them.
//!
//! The parsers (oxc, ruff), the semantic pass, Drift's lowering visitors and the
//! recursive `Drop` of a syntax tree each recurse once per nesting level, and a
//! stack overflow aborts the whole process. [`crate::nesting::too_deep`] skips
//! files that nest deeper than real code does, but it is a heuristic over the
//! tokens: a construct it does not count would get past it. So the guarantee does
//! not rest on it. A file nests at most once per source byte, and a file is parsed,
//! lowered and dropped only on a stack of [`stack_bytes_for`] its length: a base
//! for the frames above the parser plus the worst stack cost per byte measured
//! over every way to nest, with margin. The costs, in bytes of stack per source
//! byte (parse, semantic pass, lowering and drop together, the deepest phase
//! counting), on files of the size cap that nest at every opener, left open where
//! the parser then descends twice as deep:
//!
//! | shape | release | debug |
//! |---|---|---|
//! | Python `{{{` (ruff parser) | 1,696 | 5,568 |
//! | Python `(((`, `[[[` | 1,664 | 3,968 |
//! | Python f-string fields `f"{f"{` | 1,104 | 2,208 |
//! | TypeScript tuple types `type T = [[[` | 1,008 | 2,464 |
//! | TypeScript `(((`, `[[[` | 816 | 2,304 |
//! | Python `---`, `~~~` | 680 | 2,624 |
//! | TypeScript blocks `{{{` | 584 | 664 |
//! | TypeScript generics `A<A<` | 292 | 584 |
//! | TypeScript JSX `<a><a>` | 150 | 296 |
//! | every other shape measured (unary, member, call and operator chains, `if`, labels, ...) | less | less |
//!
//! [`STACK_PER_SOURCE_BYTE`] is about 2.4 times the release worst case, so the
//! bound holds through compiler and parser upgrades that make frames somewhat
//! larger. The stack-bound tests lower worst-case files with the nesting guard
//! bypassed and fail when it no longer holds: in release builds (CI's `stack-bound`
//! job) at exactly the size cap on the stack [`with_stack_for`] gives it, in debug
//! builds at an eighth of the cap on a stack scaled down to it. Debug builds allow
//! 1.5 times their worst case: a file of the size cap then needs 8 GiB, which is
//! what a CI runner can reserve, since Linux refuses a single reservation larger
//! than RAM and swap together.
//!
//! Most files are short, so a [`pool`]'s workers have a stack that covers
//! [`WORKER_COVERS_BYTES`] (192 MiB in release builds, 320 MiB in debug builds,
//! against the fixed 64 MiB they had before) and parse those files on it: over
//! 92% of the source files in every dev repo, 98% or more in most. A longer file is parsed on a thread of its
//! own whose stack is sized for that file, up to 4 GiB (release) for one of the
//! size cap, and released as soon as it is done. Address space and commit charge
//! then stay close to what they were with fixed 64 MiB stacks; only a long file's
//! parse reserves more, and only while it runs. A thread per long file costs about
//! 1% more CPU time on a scan (32 KiB covered; 16 KiB cost 5%).
//!
//! The stack is reserved, not committed: on Linux and macOS a thread stack is an
//! anonymous mapping whose pages are backed only once touched, and on Windows Rust
//! creates threads with `STACK_SIZE_PARAM_IS_A_RESERVATION`, so pages are committed
//! as the stack grows. Where reservations count against a limit (`ulimit -v`,
//! strict overcommit, a 32-bit address space), a thread of the size a file needs
//! is only started while [`HEADROOM_BYTES`] can still be reserved besides it, so
//! the heap and the other threads keep room. When that cannot be had, the pool's
//! other long parses are let finish and it is tried once more alone; when it still
//! cannot, the file is not parsed ([`Unavailable`]) and the caller records it as
//! skipped for lack of stack, never as parsed or silently left out.
//!
//! Known limits: the bound is on stack, not time or heap. Some shapes the nesting
//! guard does not count cost time or heap superlinearly in their length (TypeScript
//! call chains `a()()()`, Python f-strings, and the heap of `x=` + `a<` × n + `b` +
//! `>()` × n, about 2.6 GB at 32 KB); a parse of one can be slow or run out of
//! memory, but not overflow its stack.

use std::cell::Cell;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;

use crate::ingest::MAX_FILE_BYTES;

/// Stack a parse, lowering and drop may use per byte of source, worst case plus margin.
pub const STACK_PER_SOURCE_BYTE: usize = if cfg!(debug_assertions) {
    8 * 1024
} else {
    4 * 1024
};

/// Stack used besides the nesting: the frames above the parser, the work between
/// files, and whatever else runs on the thread.
const BASE_STACK_BYTES: usize = 64 * 1024 * 1024;

/// The longest file a [`pool`] worker parses on its own stack.
pub const WORKER_COVERS_BYTES: usize = 32 * 1024;

/// A pool worker's stack: [`stack_bytes_for`] [`WORKER_COVERS_BYTES`].
const WORKER_STACK_BYTES: usize = BASE_STACK_BYTES + WORKER_COVERS_BYTES * STACK_PER_SOURCE_BYTE;

/// The stack a file of [`MAX_FILE_BYTES`] that nests at every byte is parsed on:
/// 4 GiB in release builds, 8 GiB in debug builds, whose frames are larger.
#[cfg(target_pointer_width = "64")]
pub const PARSE_STACK_BYTES: usize =
    BASE_STACK_BYTES + MAX_FILE_BYTES as usize * STACK_PER_SOURCE_BYTE;

/// Address space that must still be free beside a newly reserved stack, for the
/// heap and the other threads, where reservations count against a limit.
/// A parse's own heap is a fraction of this (under 100 MiB for a file of the size
/// cap), so it also covers the other workers' parses while the thread runs.
pub const HEADROOM_BYTES: usize = if cfg!(target_pointer_width = "64") {
    512 << 20
} else {
    128 << 20
};

/// The stack that provably holds a parse, lowering and drop of `len` bytes of
/// source; `None` when that does not fit the address space's word size.
pub const fn stack_bytes_for(len: usize) -> Option<usize> {
    match len.checked_mul(STACK_PER_SOURCE_BYTE) {
        Some(n) => n.checked_add(BASE_STACK_BYTES),
        None => None,
    }
}

/// No thread with a stack that covers the file could be started, with room left
/// for the heap: the file was not parsed. Callers record it as skipped
/// ([`crate::SkipReason::StackUnavailable`]) or fall back to a path that does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("no thread stack large enough to parse the file could be reserved")]
pub struct Unavailable;

thread_local! {
    /// Bytes of source the current thread's stack covers: 0 on threads this module
    /// did not start.
    static COVERS: Cell<usize> = const { Cell::new(0) };
    /// The current thread is a [`pool`] worker.
    static POOLED: Cell<bool> = const { Cell::new(false) };
}

/// Run `f`, which parses, lowers or drops a syntax tree of at most `len` bytes of
/// source, on a stack that covers it: on the current thread when its stack does
/// (a [`pool`] worker and a file of at most [`WORKER_COVERS_BYTES`]), otherwise on
/// a thread of its own whose stack is [`stack_bytes_for`] `len`, waited for.
/// [`Unavailable`] when that thread cannot be started with [`HEADROOM_BYTES`]
/// to spare; a panic in `f` is passed on.
pub fn with_stack_for<T: Send>(len: usize, f: impl FnOnce() -> T + Send) -> Result<T, Unavailable> {
    crate::work::note(crate::work::Work::Parse);
    if len <= COVERS.get() {
        return Ok(f());
    }
    // A thread of its own covers at least what a worker's stack does.
    let covers = len.max(WORKER_COVERS_BYTES);
    let size = stack_bytes_for(covers).ok_or(Unavailable)?;
    let pooled = POOLED.get();
    let mut f = f;
    // Started next to the other workers' long parses, unless one is waiting to go
    // alone.
    if LONG.enter(!pooled) {
        // Counted out on every way out, a panic in `f` included.
        let r = {
            let _counted = Counted(&LONG);
            start(size, covers, f, has_headroom)
        };
        match r {
            Ok(t) => return Ok(t),
            Err(back) if pooled => f = back,
            Err(_) => return Err(Unavailable),
        }
    }
    // A pool worker tries once more once no other long parse runs. This makes the
    // outcome less dependent on which long files happened to be parsed at the same
    // time, not independent of it: the other workers' heap still varies, so near a
    // limit the set of files skipped for lack of stack can differ between runs. Every
    // reader of facts treats those files as unknown (`drift_mine::unchecked`).
    let _turn = ALONE.lock().unwrap_or_else(|e| e.into_inner());
    let _alone = LONG.wait_alone();
    start(size, covers, f, has_headroom).map_err(|_| Unavailable)
}

/// Start a thread with a stack of `size` bytes, check `room` while it is alive, and
/// only then hand it `f` and wait for it; `f` back when the thread cannot be
/// started or `room` fails.
fn start<T: Send, F: FnOnce() -> T + Send>(
    size: usize,
    covers: usize,
    f: F,
    room: impl Fn() -> bool,
) -> Result<T, F> {
    std::thread::scope(|s| {
        let (tx, rx) = std::sync::mpsc::sync_channel::<F>(1);
        let spawned = std::thread::Builder::new()
            .stack_size(size)
            .spawn_scoped(s, move || {
                let f = rx.recv().ok()?;
                COVERS.set(covers);
                Some(f())
            });
        let Ok(handle) = spawned else {
            return Err(f);
        };
        if !room() {
            drop(tx);
            let _ = handle.join();
            return Err(f);
        }
        if let Err(back) = tx.send(f) {
            let _ = handle.join();
            return Err(back.0);
        }
        match handle.join() {
            Ok(Some(t)) => Ok(t),
            Ok(None) => unreachable!("the thread received its work"),
            Err(panic) => std::panic::resume_unwind(panic),
        }
    })
}

/// Whether [`HEADROOM_BYTES`] can be reserved now. Reserving (not touching) it
/// costs no memory, and under Linux's default overcommit heuristic always succeeds
/// on a machine with that much memory: it fails only where reservations add up
/// against a limit.
fn has_headroom() -> bool {
    let mut room: Vec<u8> = Vec::new();
    let ok = room.try_reserve_exact(HEADROOM_BYTES).is_ok();
    // The reservation must happen: an allocation never used may be optimised out.
    std::hint::black_box(&mut room);
    ok
}

/// Long parses running on threads of their own.
static LONG: Long = Long {
    state: Mutex::new(LongState {
        running: 0,
        alone: false,
    }),
    changed: Condvar::new(),
};
/// Held by the pool worker whose long parse is waiting to run alone.
static ALONE: Mutex<()> = Mutex::new(());

struct Long {
    state: Mutex<LongState>,
    changed: Condvar,
}

struct LongState {
    running: usize,
    /// A pool worker is waiting for the others' long parses to finish.
    alone: bool,
}

fn lock(l: &Long) -> MutexGuard<'_, LongState> {
    l.state.lock().unwrap_or_else(|e| e.into_inner())
}

impl Long {
    /// Count a long parse in, unless a pool worker waits to run alone (`always`:
    /// regardless). Whether it was counted.
    fn enter(&self, always: bool) -> bool {
        let mut s = lock(self);
        let go = always || !s.alone;
        if go {
            s.running += 1;
        }
        go
    }

    fn leave(&self) {
        lock(self).running -= 1;
        self.changed.notify_all();
    }

    /// Wait until no other long parse runs, and keep new ones from starting next to
    /// this one until the guard is dropped.
    fn wait_alone(&self) -> Alone<'_> {
        let mut s = lock(self);
        s.alone = true;
        while s.running > 0 {
            s = self.changed.wait(s).unwrap_or_else(|e| e.into_inner());
        }
        Alone(self)
    }

    fn done_alone(&self) {
        lock(self).alone = false;
        self.changed.notify_all();
    }
}

/// A long parse counted in by [`Long::enter`]: counted out when dropped, so a panic
/// in the parse cannot leave a count behind for [`Long::wait_alone`] to wait on.
struct Counted<'a>(&'a Long);

impl Drop for Counted<'_> {
    fn drop(&mut self) {
        self.0.leave();
    }
}

/// A pool worker running its long parse alone: [`Long::done_alone`] when dropped.
struct Alone<'a>(&'a Long);

impl Drop for Alone<'_> {
    fn drop(&mut self) {
        self.0.done_alone();
    }
}

/// A thread pool whose workers parse files of up to [`WORKER_COVERS_BYTES`] on their
/// own stacks (and longer ones through [`with_stack_for`]). Where reservations count
/// against a limit and `threads` workers do not fit with [`HEADROOM_BYTES`] to
/// spare, the pool has one worker (output does not depend on the worker count).
pub fn pool(threads: usize) -> anyhow::Result<Pool> {
    match build(threads) {
        Ok(p) if p.current_num_threads() == 1 || has_headroom() => Ok(p),
        Ok(p) => {
            // Its workers are joined, so their stacks are released, before the retry.
            drop(p);
            build(1)
        }
        Err(_) if threads != 1 => build(1),
        Err(e) => Err(e),
    }
}

fn build(threads: usize) -> anyhow::Result<Pool> {
    let handles: Mutex<Vec<JoinHandle<()>>> = Mutex::new(Vec::new());
    let built = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .spawn_handler(|worker| {
            let mut b = std::thread::Builder::new().stack_size(WORKER_STACK_BYTES);
            if let Some(name) = worker.name() {
                b = b.name(name.to_string());
            }
            let h = b.spawn(move || {
                COVERS.set(WORKER_COVERS_BYTES);
                POOLED.set(true);
                worker.run();
            })?;
            handles.lock().unwrap_or_else(|e| e.into_inner()).push(h);
            Ok(())
        })
        .build();
    let handles = handles.into_inner().unwrap_or_else(|e| e.into_inner());
    match built {
        Ok(pool) => Ok(Pool {
            pool: Some(pool),
            handles,
        }),
        Err(e) => {
            // The workers started before the failure exit once the pool is torn down.
            join(handles);
            Err(e.into())
        }
    }
}

fn join(handles: Vec<JoinHandle<()>>) {
    for h in handles {
        let _ = h.join();
    }
}

/// A [`pool`]. Dropping it waits for its workers to exit, so their stacks are
/// released before anything else reserves its own.
pub struct Pool {
    pool: Option<rayon::ThreadPool>,
    handles: Vec<JoinHandle<()>>,
}

impl Pool {
    /// Run `op` on the pool, as [`rayon::ThreadPool::install`].
    pub fn install<R: Send>(&self, op: impl FnOnce() -> R + Send) -> R {
        match &self.pool {
            Some(pool) => pool.install(op),
            None => op(),
        }
    }

    fn current_num_threads(&self) -> usize {
        self.pool.as_ref().map_or(0, |p| p.current_num_threads())
    }
}

/// `a` and `b`, both run to their end, side by side on the workers of the pool this
/// is called on ([`Pool::install`]); one after the other, `a` first, where the pool
/// has one worker or this is called on no pool. A panic in either is passed on.
pub fn both<A: Send, B: Send>(
    a: impl FnOnce() -> A + Send,
    b: impl FnOnce() -> B + Send,
) -> (A, B) {
    rayon::join(a, b)
}

impl Drop for Pool {
    fn drop(&mut self) {
        drop(self.pool.take());
        join(std::mem::take(&mut self.handles));
        // What the workers parsed and dropped stays free in their allocator arenas,
        // which the threads that come next (mining, on the main thread) do not
        // allocate from: give those pages back, so they do not add to its peak.
        release_free_memory();
    }
}

/// Return the allocator's free pages to the system (glibc's `malloc_trim`, which
/// trims every arena). Changes no value the program computes; elsewhere a no-op.
pub fn release_free_memory() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        unsafe extern "C" {
            fn malloc_trim(pad: usize) -> std::ffi::c_int;
        }
        // SAFETY: `malloc_trim` takes no pointers and is safe to call at any time.
        unsafe {
            malloc_trim(0);
        }
    }
}

/// Run `f` on a new thread whose stack is the allowance for `bytes` of source,
/// [`STACK_PER_SOURCE_BYTE`] each, with no base, and wait for it. For tests that
/// check the allowance per byte on files shorter than the size cap; a stack
/// overflow aborts the process.
pub fn run_scaled<T: Send>(bytes: usize, f: impl FnOnce() -> T + Send) -> Option<T> {
    std::thread::scope(|s| {
        std::thread::Builder::new()
            .stack_size(bytes * STACK_PER_SOURCE_BYTE)
            .spawn_scoped(s, f)
            .ok()?
            .join()
            .ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_files_parse_on_the_worker_and_long_ones_on_their_own_stack() {
        let here = || COVERS.get();
        // Not a parse thread: even a short file gets a thread of its own.
        assert_eq!(with_stack_for(10, here), Ok(WORKER_COVERS_BYTES));
        assert_eq!(with_stack_for(100_000, here), Ok(100_000));
        let p = pool(2).unwrap();
        assert_eq!(
            p.install(|| with_stack_for(10, here)),
            Ok(WORKER_COVERS_BYTES)
        );
        assert_eq!(
            p.install(|| with_stack_for(WORKER_COVERS_BYTES + 1, here)),
            Ok(WORKER_COVERS_BYTES + 1)
        );
        // Nested: a thread of its own covers what it was sized for.
        assert_eq!(
            with_stack_for(50_000, || with_stack_for(40_000, here)),
            Ok(Ok(50_000))
        );
        assert_eq!(run_scaled(1024, || 4), Some(4));
        assert_eq!(stack_bytes_for(usize::MAX), None);
    }

    #[test]
    fn a_panic_in_the_parse_is_passed_on_and_leaves_no_count_behind() {
        let r = std::panic::catch_unwind(|| with_stack_for(100_000, || panic!("caught")));
        assert!(r.is_err());
        // A leaked count would keep a later alone-retry waiting forever.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            drop(LONG.wait_alone());
            let _ = tx.send(());
        });
        assert!(
            rx.recv_timeout(std::time::Duration::from_secs(30)).is_ok(),
            "a long parse is still counted after its panic"
        );
    }

    #[test]
    fn no_room_means_unavailable_and_the_work_back() {
        // A stack that cannot be reserved at all (1 PiB).
        #[cfg(target_pointer_width = "64")]
        {
            let r = start(1 << 50, 1, || 1, || true);
            assert_eq!(r.map_err(|f| f()), Err(1));
        }
        // A stack that can, but leaves no room: the thread never runs the work.
        let ran = std::sync::atomic::AtomicBool::new(false);
        let r = start(
            1 << 20,
            1,
            || ran.store(true, std::sync::atomic::Ordering::SeqCst),
            || false,
        );
        assert!(r.is_err());
        assert!(!ran.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(start(1 << 20, 1, || 2, || true).ok(), Some(2));
    }

    #[test]
    #[cfg(target_pointer_width = "64")]
    fn the_stack_for_a_file_of_the_cap_is_the_parse_stack() {
        assert_eq!(
            stack_bytes_for(MAX_FILE_BYTES as usize),
            Some(PARSE_STACK_BYTES)
        );
        assert_eq!(
            stack_bytes_for(WORKER_COVERS_BYTES),
            Some(WORKER_STACK_BYTES)
        );
        assert_eq!(stack_bytes_for(0), Some(BASE_STACK_BYTES));
    }

    /// Both run to their end, on the pool's workers when called on one (each on a
    /// worker's stack), and here, one after the other, when not.
    #[test]
    fn both_run_on_the_pool_they_are_called_on() {
        let pooled = || POOLED.get();
        assert_eq!(both(|| 1, || 2), (1, 2));
        assert_eq!(both(pooled, pooled), (false, false));
        for threads in [1, 3] {
            let p = pool(threads).unwrap();
            assert_eq!(p.install(|| both(pooled, pooled)), (true, true));
            // Inside each, the pool's own parallel work still runs on it.
            let sum = |n: u64| {
                use rayon::prelude::*;
                (0..n).into_par_iter().sum::<u64>()
            };
            assert_eq!(p.install(|| both(|| sum(1000), || sum(10))), (499_500, 45));
        }
    }

    #[test]
    fn a_dropped_pool_has_joined_its_workers() {
        let p = pool(3).unwrap();
        let n = p.install(rayon::current_num_threads);
        assert!(n == 3 || n == 1);
        drop(p);
        // Nothing to observe portably but that drop returned: the handles were joined.
    }
}
