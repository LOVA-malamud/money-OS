# iPhone Quick Add touch targeting — 2026-09-16

## Report and investigation

Physical production iPhone PWA: after changing focus between Quick Add's custom
amount keypad and native inputs, a touch on 9 can activate the visually higher 3.
This is a hit-target defect, not delayed amount state. Production records were not
used for testing.

The mobile-quality implementation combined a fixed, negatively translated body
(scroll lock) with a fixed interactive portal. The portal followed raw
`visualViewport.offsetTop` and height independently. No transform was found on an
interactive ancestor; the amount keypad uses ordinary button clicks.

The old code reproducibly retained a 120px offset when a synthetic viewport
transition restored full height but retained the old offset. The regression failed
with expected overlay y=0, actual y=120 before implementation. This proves stale
geometry handling, **not** reproduction of the native compositor/hit-test failure.

WebKit [254861](https://bugs.webkit.org/show_bug.cgi?id=254861) describes visually
restored fixed content with displaced hit targets after keyboard dismissal in an
installed iPadOS app. This supports the suspected fixed-layer mechanism, but does
not establish that this iPhone has the same engine defect.

## Change

- Keep the body in normal document coordinates. Lock background overflow on the
  document/body and preserve inert background, focus trapping and scroll restoration.
- Render the interactive portal with absolute positioning in document coordinates,
  avoiding the fixed interactive layer during keyboard viewport transitions.
- Convert viewport coordinates once: document top = window scrollY + bounded
  visualViewport offsetTop. Bound the pan to layout height minus visual height;
  at full height, there is no remaining pan space. Safe-area padding remains padding.
- Resample geometry on the next animation frame for resize, pan, page scroll,
  focus transitions and pageshow. No timeouts, touch retargeting or device constants.
- Preserve browser pinch zoom and resample after scale returns to one.

Financial code, data, authentication, schema and PWA update guards are unchanged.

## Automated and physical validation

The new regression models viewport heights and offsets, verifies restored geometry
from a scrolled page, and sends coordinate-based pointer/touch events across visible
buttons, inputs and selects throughout the sheet. Each event must hit the element
whose visual bounding box contains the touch. It also enters 9 through a real
coordinate tap and checks that the amount becomes 9.

Synthetic VisualViewport properties do not emulate iOS's native keyboard,
standalone compositor or UI process. Passing desktop WebKit is not proof that the
reported device defect is resolved. Physical iPhone confirmation remains required:

1. Install the deployed update with no unfinished form open.
2. Open Quick Add → Expense; enter an amount.
3. Open details, focus merchant/notes and interact with the native keyboard.
4. Return to the large amount and tap keypad 9: it must activate 9, never 3.
5. Repeat keyboard open/close and focus changes; check every keypad row, categories,
   details fields and close button, including after scrolling the sheet.
6. Check safe areas, background scroll lock and keyboard-visible actions.

Do not save a test transaction to production. Keep this issue open until the
reported physical touch behavior is confirmed corrected by the user.

### Validation results

- TypeScript, ESLint, 94 unit/database tests and production build passed.
- All 108 browser cases passed across mobile Chromium, mobile WebKit and desktop
  Chromium. The first full run had 98 passes and ten WebKit overall timeouts during
  broad local slowdown; all ten passed unchanged on rerun with a 180-second overall
  allowance (nine in 2–6 seconds, the coordinate matrix in 18 seconds).
- Both PWA lifecycle/cache/update tests passed, including dirty-form protection.
- Hebrew/RTL screenshots checked; final diff and changed-file secret-pattern scan
  checked. No production financial records were accessed or modified for validation.
