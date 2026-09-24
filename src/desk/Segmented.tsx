import React from "react";

/**
 * Segmented control — the app's single two-or-three-way choice affordance.
 *
 * Used by the hard-gate Pass/Fail rows, the conflict prompt, and the mandate
 * form's archetype / priority pickers, so a segmented choice looks and
 * behaves the same everywhere.
 *
 * Presentation lives in nocturne.css (.seg / .seg-opt). This component owns
 * the markup and the ARIA: a radiogroup of role="radio" buttons whose
 * aria-checked drives the selected styling, which means the visual state and
 * the accessible state cannot drift apart — the previous hand-rolled markup
 * styled selection with an inline color while telling assistive tech
 * nothing.
 *
 * Options are compared with Object.is, so `value` may be a boolean, string,
 * or number. Booleans are the common case: the hard gates store a polarity-
 * mapped boolean where "Pass" is whichever value clears that specific gate.
 */

export interface SegmentedOption<T> {
  label: string;
  value: T;
  /** Optional per-option tooltip. */
  title?: string;
}

export function Segmented<T>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  block = false,
  disabled = false,
  onFocus,
  style,
}: {
  options: readonly SegmentedOption<T>[];
  /** Current selection. `undefined` renders every option unselected. */
  value: T | undefined;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Stretch the control to fill its container. */
  block?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      className={block ? "seg seg-block" : "seg"}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      style={style}
    >
      {options.map((opt) => {
        const checked = value !== undefined && Object.is(opt.value, value);
        return (
          <button
            key={opt.label}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            className="seg-opt"
            title={opt.title}
            onFocus={onFocus}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
