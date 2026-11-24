// What a dialog tells the fields inside it, and what they tell it back.
//
// A dialog someone has typed into must not vanish on a stray click beside it:
// `ModalDialog` stops closing on its backdrop once a field reports an edit, so
// only Escape, the close button or the dialog's own buttons close it. The
// first editable field of a dialog takes the focus on desktop (so typing can
// start at once), and Return in a single-line field runs the dialog's primary
// action when the field has none of its own.

import { context } from "nsh";

export interface ModalFormBinding {
  /** A field inside the dialog was edited by the user. */
  markEdited(): void;
  /** Whether this field should take the focus: true once per opening, for the first field that asks. */
  claimAutoFocus(): boolean;
  /** The dialog's primary action, run by Return in a single-line field without its own submit. */
  submit(): void;
  /** Whether the dialog declared a primary action. */
  hasSubmit(): boolean;
}

export const ModalFormContext = context<ModalFormBinding | null>(null);
