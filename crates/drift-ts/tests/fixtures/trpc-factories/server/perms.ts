import { editor } from './guards';

// Returns a builder of a module its callers do not import.
export function canEdit() {
  return editor;
}
