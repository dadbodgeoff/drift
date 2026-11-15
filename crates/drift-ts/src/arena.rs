//! The arena every parse of repository content allocates in: fixed-size, so no
//! file can make a parse take more memory than its budget.
//!
//! oxc keeps everything a parse allocates, including what its speculative reads
//! allocated before rewinding, in the file's arena until the parse ends. Files
//! that force long or nested speculation are skipped before parsing
//! ([`drift_core::speculation`]); this is the bound that holds whatever that
//! estimate misses. The arena is one block of [`arena_budget`] bytes reserved up
//! front (address space: pages are only used as the parse writes them, and a thread
//! reuses its block for the next parse), and an allocation that does not fit makes
//! oxc panic with "out of memory", which ends the parse as [`OverBudget`]: the
//! caller skips the file as too costly.
//!
//! Known limit: oxc panics when an AST node does not fit, but aborts the process
//! when growing an arena vector does not fit (`std::alloc::handle_alloc_error`).
//! Either way the arena never exceeds its budget; the abort is what a file the
//! estimate misses can still cause.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::mem::ManuallyDrop;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::ptr::NonNull;

use oxc_allocator::Allocator;

/// Arena bytes a parse of `len` bytes of source may use: 16 MiB plus 256 per
/// byte (272 MiB for a file of `MAX_FILE_BYTES`). Real files use 7 bytes per
/// byte at the median and at most 55 (20 above 16 KB), 15 MiB for a 1 MiB file.
pub fn arena_budget(len: usize) -> usize {
    let bytes = (16 << 20) + len.saturating_mul(256);
    bytes.next_multiple_of(Allocator::RAW_MIN_ALIGN)
}

/// A parse ran out of its arena.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverBudget;

/// The panic message of oxc's arena when an allocation does not fit.
const OUT_OF_MEMORY: &str = "out of memory";

/// True for the panic oxc raises when a budgeted arena is full (so a panic hook
/// can stay quiet about it: the file is skipped and reported, not a crash).
pub fn is_over_budget_panic(payload: &str, file: &str) -> bool {
    payload == OUT_OF_MEMORY && file.contains("oxc_allocator")
}

/// Memory reserved for arenas. oxc frees an arena's block itself only with its
/// `fixed_size` feature, so arenas over a block are never dropped, and the block
/// is freed here. A thread keeps its block between parses ([`SPARE`]), so the next
/// parse writes pages already in memory instead of faulting fresh ones in.
struct Block {
    ptr: NonNull<u8>,
    layout: Layout,
}

impl Block {
    /// A block of `bytes` (a multiple of `RAW_MIN_ALIGN`), or `None` when it cannot
    /// be reserved.
    fn new(bytes: usize) -> Option<Self> {
        if bytes < Allocator::RAW_MIN_SIZE || !bytes.is_multiple_of(Allocator::RAW_MIN_ALIGN) {
            return None;
        }
        let layout = Layout::from_size_align(bytes, Allocator::RAW_MIN_ALIGN).ok()?;
        // SAFETY: `layout` has a non-zero size.
        let ptr = NonNull::new(unsafe { System.alloc(layout) })?;
        Some(Self { ptr, layout })
    }

    /// An arena over the first `bytes` of the block (at most its size, a multiple of
    /// `RAW_MIN_ALIGN`). It must not be dropped, and must be out of use before the
    /// block makes another arena or is freed.
    fn arena(&mut self, bytes: usize) -> ManuallyDrop<Allocator> {
        assert!(bytes <= self.layout.size() && bytes.is_multiple_of(Allocator::RAW_MIN_ALIGN));
        // SAFETY: the region is the start of the block, allocated by `System` with
        // `layout`: it lies within it, is writable and aligned on `RAW_MIN_ALIGN`, and
        // its size is a multiple of `RAW_MIN_ALIGN` and at least `RAW_MIN_SIZE`
        // (every budget is). Arenas over the block are never dropped, so oxc never
        // frees it; `&mut self` keeps one arena at a time, and `Drop` frees the block
        // with the same allocator and layout.
        ManuallyDrop::new(unsafe {
            Allocator::from_raw_parts(self.ptr, bytes, self.ptr, self.layout)
        })
    }
}

impl Drop for Block {
    fn drop(&mut self) {
        // SAFETY: `ptr` was allocated by `System` with `layout`; the arena over it is
        // out of use (see `Block::arena`).
        unsafe { System.dealloc(self.ptr.as_ptr(), self.layout) };
    }
}

/// Arena bytes a thread keeps written for its next parse; a parse that used more
/// gives its block back.
const KEEP_BYTES: usize = 32 << 20;

thread_local! {
    /// The block this thread's last parse used, for its next one.
    static SPARE: Cell<Option<Block>> = const { Cell::new(None) };
}

/// Give back this thread's spare block ([`SPARE`]): the memory it holds written
/// stays in the process until the block is freed. Called on every worker once a
/// scan has lowered its files, so the blocks do not add to what linking and mining
/// hold; a later parse on the thread reserves a new block.
pub fn release_spare() {
    drop(SPARE.with(Cell::take));
}

/// Run `parse` (which parses `len` bytes of source) in an arena of at most
/// [`arena_budget`]`(len)` bytes. `Err(OverBudget)` when the arena filled up.
/// When the memory cannot be reserved (an address-space limit), `parse` runs in an
/// arena that grows as it needs, which that limit bounds instead.
pub fn with_arena<R>(len: usize, parse: impl FnOnce(&Allocator) -> R) -> Result<R, OverBudget> {
    let bytes = arena_budget(len);
    let spare = SPARE.with(Cell::take).filter(|b| b.layout.size() >= bytes);
    let Some(mut block) = spare.or_else(|| Block::new(bytes)) else {
        return run(&Allocator::default(), parse);
    };
    let allocator = block.arena(bytes);
    let result = run(&allocator, parse);
    if result.is_ok() && allocator.used_bytes() <= KEEP_BYTES {
        SPARE.with(|s| s.set(Some(block)));
    }
    result
}

/// `parse(allocator)`, with oxc's panic for a full arena as `OverBudget`.
fn run<R>(allocator: &Allocator, parse: impl FnOnce(&Allocator) -> R) -> Result<R, OverBudget> {
    match catch_unwind(AssertUnwindSafe(|| parse(allocator))) {
        Ok(r) => Ok(r),
        Err(e) => {
            let msg = e
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| e.downcast_ref::<String>().map(String::as_str));
            if msg == Some(OUT_OF_MEMORY) {
                Err(OverBudget)
            } else {
                resume_unwind(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    #[test]
    fn a_parse_within_budget_is_unchanged() {
        let src = "export const f = <T,>(x: T): T => x;";
        let r = with_arena(src.len(), |a| {
            let ret = Parser::new(a, src, SourceType::ts()).parse();
            (ret.diagnostics.is_empty(), ret.program.body.len())
        });
        assert_eq!(r, Ok((true, 1)));
    }

    #[test]
    fn a_parse_over_budget_stops_at_it() {
        // Exponential in oxc 0.157 (more than 3 GB for 300 bytes): stops at 16 MiB.
        let n = 26;
        let src = format!("x={}b{}", "a<(y=\n".repeat(n), ")>()\n".repeat(n));
        let r = with_arena(src.len(), |a| {
            Parser::new(a, &src, SourceType::ts()).parse().fatal_error
        });
        assert_eq!(r, Err(OverBudget));
    }

    #[test]
    fn lowering_over_budget_skips_the_file() {
        let src = format!("x={}b{}", "a<(y=\n".repeat(26), ")>()\n".repeat(26));
        let raw = crate::lower::lower_file("a.ts", &src);
        assert_eq!(raw.skip, Some(drift_core::SkipReason::TooCostly));
        assert!(raw.symbols.is_empty());
        let ok = crate::lower::lower_file("a.ts", "export const a = <T,>(x: T) => x;");
        assert_eq!(ok.skip, None);
        assert!(ok.parse_ok);
    }

    #[test]
    fn other_panics_propagate() {
        let r = catch_unwind(|| with_arena(0, |_| panic!("a bug")));
        assert!(r.is_err());
    }
}
