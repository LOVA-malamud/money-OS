# Quiet Balance — Phase A QA

Historical visual baseline: passed

The owner subsequently reported a physical-iPhone safe-area defect. The 2026-09-15 follow-up is documented in [mobile-quality-pass.md](docs/mobile-quality-pass.md); [deployment-status.md](docs/deployment-status.md) is the current release record. Physical-device confirmation of the follow-up remains required.

This result covers the local implementation and its visual comparison. Production provisioning and a physical iPhone installation remain release gates; they are not implied by this visual pass.

## Visual truth and evidence

- Source: [Quiet Balance reference](docs/design/quiet-balance-reference.png), 1536 × 1024 generated concept board. Its three screen regions are approximately 440 × 880 pixels; the surrounding white presentation canvas is not application UI.
- Mobile CSS viewport: 390 × 844, device scale factor 1, Hebrew locale, Asia/Jerusalem timezone, Chromium and WebKit.
- [Mobile Overview](docs/design/qa/mobile-webkit-overview.png): 390 × 1720 full-page capture, containing the continuation below the initial 844px viewport.
- [Mobile Quick Add](docs/design/qa/mobile-webkit-quick-add.png): 390 × 844 viewport capture.
- [Desktop Overview](docs/design/qa/desktop-chromium-overview.png): 1440 × 1094 full page, CSS viewport 1440 × 1024.
- [Desktop Quick Add](docs/design/qa/desktop-chromium-quick-add.png): 1440 × 1024.
- [Accounts and assets](docs/design/qa/mobile-webkit-money.png): 390 × 1513.
- Equivalent Chromium mobile captures are retained in `docs/design/qa/`.

The source and implementation images were opened together in combined comparison inputs, including focused Quick Add comparisons. The source is a concept board, not a pixel-exact CSS frame: comparison accounts for the roughly 390/440 panel-width ratio without stretching the source or treating canvas padding as UI. Implementation captures are 1:1 CSS pixels. The two source Overview panels correspond to one scrollable page. A fixed bottom bar appearing in the middle of a full-page capture is the original viewport's fixed navigation, not a second navigation element.

State: authenticated fictional test owner; real PostgreSQL postings in a disposable local fixture. The source's illustrative amounts differ from the fixture's balanced dataset. Both represent populated, known balances and an ordinary ₪68 expense with a selected category. Recent-category order is intentionally data-dependent. The local test banner is absent from a configured production build.

## Comparison history and fixes

1. **P1 — amount entry did not receive initial focus.** The dialog selected the first matching button in document order. Focus now explicitly prioritizes the amount input; its accessible label is explicit. Browser checks verify this on all three targets.
2. **P2 — keypad/footer overlap and amount alignment.** The initial capture hid part of the final keypad row and reserved excessive width for a short amount. The amount now sizes to its characters and centers with the currency symbol. Category expansion shares its heading row; spacing was adjusted. Post-fix captures show all twelve keys and the save button. Tests assert the bottom keys do not overlap save.
3. **P2 — weak distinction between the two primary numbers.** Increased the available-balance token to restore the source's dominant first number, while leaving the secondary result mint and smaller. The dashboard remains a sequence of aligned sections, not a card grid.
4. **P2 — native WebKit control differences and clipped payment suffix.** Standardized the native select's visible frame and chevron. The selected payment name may ellipsize, while its isolated last four digits retain their own width. The native picker still exposes full option names. The final WebKit Quick Add capture shows all four digits at readable size.
5. **P2 — a rapid second tap reopened Quick Add after acknowledgment in WebKit.** The underlying add button now has a 400ms post-save guard. No duplicate financial operation occurred; the fix also preserves the previous screen. The double-tap/undo browser case passes in Chromium and WebKit.

The final captures linked above are post-fix evidence. No actionable P0/P1/P2 visual finding remains in the reviewed states.

## Required fidelity surfaces

| Surface | Review result |
| --- | --- |
| Fonts and typography | Self-hosted Heebo, warm off-white body text, strong sans-serif numeric hierarchy, tabular isolated money, readable Hebrew labels. Available money dominates; Quick Add centers its amount. No serif numerals. |
| Spacing and layout | Right-aligned RTL rows, 24px mobile page margins, spacious dashboard sections, reachable bottom navigation/save, quiet separators. Desktop adapts to a right-side navigation rail and two content columns. |
| Colors and tokens | Graphite base, restrained raised surfaces and mint emphasis. Warning/danger are semantic. Flat surfaces intentionally follow the user's prohibition on unnecessary gradients and glow. |
| Image and icon quality | No decorative raster imagery in the application. Consistent maintained Lucide icons, clear category symbols, sharp PWA PNGs generated from the same icon family. The reference board is documentation only. |
| Copy and content | Natural Hebrew; transfers, income, spending, principal, obligations and net worth remain separate. Unknown/incomplete states explain their causes. The remaining calculation has an explicit horizon, deduction subtotal, exact items and result; it does not promise safe spending. |

The primary balance, monthly pair and lower financial rows were inspected in the full-page comparisons. Focused Quick Add comparisons examined amount alignment, category labels/icons, selected payment suffix, date, keypad and save. Focus outlines, dialog focus containment, readable number direction and horizontal overflow were also exercised in browser tests.

## Functional verification

- **75 unit/PostgreSQL integration tests passed**: 51 domain tests and 24 PostgreSQL tests, including ledger invariants, exact money, dates, corrections, allocations, owner permissions, idempotency and atomic restore.
- **45 browser cases passed** across mobile Chromium, mobile WebKit and desktop Chromium: the 39 core cases plus six targeted borrowing/asset/card-credit cases.
- After the final payment-label styling change, the three affected Quick Add visual/draft/double-tap cases passed again.
- TypeScript, ESLint and production build passed. A dummy privileged-key build was rejected before bundling.
- PWA manifest is Hebrew/RTL/standalone, icon dimensions match the manifest, and the generated service worker uses an app-shell precache without a financial API runtime cache.
- Browser developer logs were inspected during local login troubleshooting; no financial data logging was added. The development HMR multiple-auth-client warning was confined to live reload. Real browser flow failures were fixed or corrected where a test had selected the wrong account.

## Release checklist

2026-09-14 production audit: [deployment-status.md](docs/deployment-status.md) is the current release record. The original visual review above is historical; the latest full run passes 60 browser cases plus 75 unit/PostgreSQL tests, with additional PWA lifecycle coverage.

- [x] Quiet Balance dashboard and practical Quick Add implemented.
- [x] Financial, PostgreSQL and core browser checks pass.
- [x] Validated JSON recovery with a required safety export and concurrent-change rejection.
- [x] PWA build, icons and responsive desktop layout.
- [x] Apply migrations to the user's Supabase Free project; provision and verify the sole owner and Auth settings.
- [x] Configure the public environment values and final HTTPS frontend URL.
- [x] Verify real password recovery, owner access and an export/restore rehearsal against that project. A fresh owner login remains pending because the user no longer knows the subsequently changed password; further recovery requests are paused.
- [ ] Install and smoke-test on the physical iPhone, including Safari picker behavior and system accessibility settings.

Physical-device Dynamic Type/VoiceOver remain unverified. Hosted Supabase evidence and its limits are recorded separately in the production audit; local fixture tests do not substitute for physical-device checks. No Phase B/C implementation is included.
