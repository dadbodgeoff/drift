//! Fields that are in process only, and the one place that writes them.
//!
//! Some results carry a field no output shows: what `drift investigate` reads of an
//! unknown unit ([`crate::practices::UnitRow::instrument`]). Such a field is left
//! out of everything Drift prints, so no output changes when one is added.
//!
//! A result kept on disk between processes is different: it stands in for the
//! computation, so what is read back must equal what was computed, field for field.
//! A value written without its in-process fields does not read back equal, and a
//! result that does not read back equal is never kept (the practice map of a
//! repository with one such unit was built again by every hook).
//!
//! So a field of this kind is marked
//! `#[serde(default, skip_serializing_if = "crate::in_process::left_out")]`: left
//! out wherever a value is written, except inside [`whole`], which the keeper of
//! results wraps around its own write. Read back, it is there when the bytes hold
//! it and empty when they do not.

use std::cell::Cell;

thread_local! {
    /// Whether this thread is writing a value whole ([`whole`]).
    static WHOLE: Cell<bool> = const { Cell::new(false) };
}

/// `write`, with the in-process fields of what it serialises on this thread written
/// too. For a value kept to be read back in place of its computation, never for
/// output. The earlier state is put back when `write` returns or unwinds.
pub fn whole<R>(write: impl FnOnce() -> R) -> R {
    struct Back(bool);
    impl Drop for Back {
        fn drop(&mut self) {
            WHOLE.with(|w| w.set(self.0));
        }
    }
    let _back = Back(WHOLE.with(|w| w.replace(true)));
    write()
}

/// For `skip_serializing_if`: an in-process field is left out, unless the value is
/// being written whole ([`whole`]).
pub fn left_out<T: ?Sized>(_: &T) -> bool {
    !WHOLE.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use crate::practices::UnitRow;

    fn row() -> UnitRow {
        UnitRow {
            symbol: "handler".into(),
            instrument: "src/auth.ts#requireUser".into(),
            ..UnitRow::default()
        }
    }

    #[test]
    fn output_leaves_the_field_out_and_a_whole_write_reads_back_equal() {
        let row = row();
        // What Drift prints: as before the field could be kept.
        let printed = serde_json::to_string(&row).unwrap();
        assert!(!printed.contains("instrument"), "{printed}");
        let back: UnitRow = serde_json::from_str(&printed).unwrap();
        assert_ne!(back, row);
        assert!(back.instrument.is_empty());
        // What is kept: every field.
        let kept = super::whole(|| serde_json::to_string(&row)).unwrap();
        assert!(
            kept.contains("\"instrument\":\"src/auth.ts#requireUser\""),
            "{kept}"
        );
        assert_eq!(serde_json::from_str::<UnitRow>(&kept).unwrap(), row);
        // Only inside `whole`, also when it is left by a panic.
        assert_eq!(serde_json::to_string(&row).unwrap(), printed);
        let unwound = std::panic::catch_unwind(|| super::whole(|| panic!("mid-write")));
        assert!(unwound.is_err());
        assert_eq!(serde_json::to_string(&row).unwrap(), printed);
        // Nested writes stay whole until the outermost returns.
        let nested = super::whole(|| {
            super::whole(|| ());
            serde_json::to_string(&row)
        })
        .unwrap();
        assert_eq!(nested, kept);
    }
}
