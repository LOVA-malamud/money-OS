# Phase A mobile quality pass — 2026-09-15

## Scope and evidence

The owner reported on a physical iPhone that Money screen content entered the status-bar/notch region. This report is treated as a real defect. No physical-device screenshots were attached to this pass, and browser emulation cannot certify the physical fix.

Fresh baseline and revised screenshots were captured from the running application with disposable PGlite fixture data. Production was inspected read-only. No production financial records were read as test fixtures, created, changed, deleted, seeded or restored. Recovery emails and credentials were left untouched.

## Reviewed journey

| Step | Screen / interaction | Finding and treatment |
| --- | --- | --- |
| 1 | Login and recovery | Preserve private Auth/recovery behavior. Keep an update from reloading an unfinished password entry; distinguish password-update progress from login progress. Recovery tests use only local credentials. |
| 2 | Overview and calculation details | Preserve dominant current available money, secondary after-obligations amount, inspectable month-end arithmetic and exact financial distinctions. Missing openings name the affected accounts and link to completing balances. Partial-month spending/income explain the tracking period. Net-worth copy is shorter. |
| 3 | History, filters, correction and refund | Preserve existing search/filter/edit/void/undo/refund behavior. Shared sheets now isolate background content, retain focus and protect keyboard-visible actions. Existing transaction tests cover each financial effect. |
| 4 | Quick Add | Amount → category → Save stays one screen. Categories precede the compact source selector; the date moves under “פרטים נוספים” and remains visible as today/date in its summary. Keep the source directly editable, the last confirmed Cash/card source, persisted drafts, acknowledgement and undo. Recent categories lead, followed by pinned/frequently used choices. |
| 5 | Income and transfers | Keep explicit source, destination and date controls because these determine the meaning of the action. No transfer is reclassified as income or spending. |
| 6 | Commitments: payments, monthly repeats, debts | Replace redundant unknown empty totals with useful empty explanations and actions. Unknown coverage still requires explicit owner review. Pending items precede paid/cancelled items. Tabs have panel relationships, roving focus and RTL arrow-key behavior. Debt balances can use their own line instead of breaking into a narrow column. |
| 7 | Money, Cash, accounts and assets | Shared persistent top protection addresses the physical report across the application. Cash wallet language and ledger behavior remain. Give Cash funding/deposit actions distinct spacing. Account settings, reconciliation and manual valuations retain their semantics. |
| 8 | Settings and backup | Move full JSON backup ahead of the long category list, explain private Files storage and show download feedback near the action. A blocked local export-date preference cannot invalidate a successful download. Keep preview, safety export, snapshot concurrency checks and atomic restore unchanged. If the Auth SDK signs out locally after a remote sign-out error, the warning survives on the login screen and requested local-draft cleanup still runs. |

## Shared mobile and accessibility fixes

- Safe-area tokens cover top, bottom and sides. A fixed opaque top strip remains while content scrolls; top padding alone scrolled away under iOS's translucent status bar.
- Bottom navigation measures its actual occupied height, including home-indicator space and enlarged text, so content/toasts reserve the correct space.
- Sheets follow `visualViewport` height/offset when the keyboard resizes the usable area. Pinch zoom is not counteracted. Save footers use the visible sheet boundary; negative sticky offsets and negative footer margins were removed. Compact mobile spacing keeps all twelve keypad keys and Save visible at 390×844 with 59px top / 34px bottom insets, including a restored draft.
- Portaled dialogs make the app background inert, lock body scrolling on iOS, trap keyboard focus and restore the trigger/scroll position on close. Background toasts no longer cover active sheets.
- Wrapped headings, balances, tabs and actions preserve content at narrow widths and 200% root text. Existing number formatting remains centralized and exact.
- PWA updates wait for active dialogs, pending/busy financial commands, restore previews, unsaved tracking-date changes and password entry. Closed expense drafts remain in their existing storage; no offline write queue was added.
- Error mapping handles both structured HTTP status/codes and human-readable messages. Unknown/offline/paused/expired/unauthorized data still never becomes a zero dashboard.

## Financial and production safety

No changes to financial-domain implementation, SQL migrations, owner identity, Supabase configuration, RLS, API exposure or Vercel services. Cash and the three categories remain in the existing account/category system. No new migration was needed.

Fresh live read-only PostgreSQL inspection confirmed seven RLS tables and seven owner-scoped SELECT policies; zero unexpected anonymous/direct authenticated write grants; anonymous RPC denial; authenticated RPC grants; one unchanged owner; and exact bigint arithmetic (`9007199254740993 + 1290 = 9007199254742283`). GitHub repository visibility remains private. Public production verification checks signup/anonymous restrictions and rejects the private Data API profile.

Source/history/artifact scanning is a scoped pattern check, not proof about every vendor-retained historical log. No production privileged credential was obtained. `.env.local` remains ignored, mode 600, with only the public URL/publishable-key variables. Production financial history was not altered or exported for testing.

## Performance and intentionally unchanged behavior

Backup validation/Settings now load as a separate chunk. Initial application JavaScript is roughly 568 KB (159 KB gzip), down from roughly 671 KB (188 KB gzip). PWA installation still precaches static chunks in the background; this is not a claim that the total offline asset set shrank or that physical-device latency was benchmarked. A non-blocking Vite >500 KB entry-chunk advisory remains.

Quiet Balance, the ledger, integer money, payment allocation, idempotency/revisions, account/debt/asset semantics, owner isolation, backup format and restore protocol are unchanged. No charts, Phase B/C features, CSV exporter, paid services, external analytics or speculative architecture were added. JSON is the existing complete backup; no CSV report currently exists to relabel.

## Verification and device limits

Final validation: 89 unit/database tests, 93 browser cases, TypeScript, ESLint and production build passed. PWA lifecycle/cache/update and read-only production HTTPS/browser smoke each passed. All 26 hosted build files match the tested build. Production dependency audit: zero known vulnerabilities. See deployment-status.md for deployment identity and scoped security evidence. Regression coverage includes financial/database behavior, Cash transfers/categories, keyboard geometry, persistent safe areas, bottom navigation, 320/375/390/430px widths, short viewport, 200% root text and long Hebrew account names, dialog focus/background isolation, drafts, empty states, network failures, JSON backup/restore, storage failures, partial sign-out errors/local cleanup and waiting PWA updates. Production browser smoke uses fresh contexts with real API traffic blocked; public security probes are read-only.

Screenshots are saved locally under `.local/quality/before/` and `.local/quality/after/`, numbered 01–18, using only fictional fixture data. Their source capture script is also ignored. The audit does not assert full WCAG compliance, physical VoiceOver order, actual iOS Dynamic Type, native keyboard behavior or Add to Home Screen completion.

Remaining owner checks: update the installed app after finishing active work; scroll Money and all main screens in Safari and standalone to confirm status-bar/home-indicator clearance; open optional fields with the native keyboard; check 200% text/VoiceOver; background/resume a draft; and retain a JSON backup in private Files. Do not restore over real data merely to check the file picker or preview.
