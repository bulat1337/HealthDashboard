# Life Dashboard design contract

## Direction

A personal dashboard for quick checks and daily input. Mode: Operate.
Use a quiet, dense workspace: white surfaces on a cool neutral canvas,
blue data, amber selection accents, clear Russian labels and tabular numbers.
Keep card radii at 8px, Fira Sans for interface text, Fira Code for detailed
measurements and Lucide for controls. Prefer borders to broad decorative shadows.
`src/styles.css` owns tokens; existing components own behavior.

## Responsive behavior

- Desktop: compact header and horizontal domain navigation; charts and details
  share columns where space allows, with independent panel heights.
- Phone (up to 760px): four persistent bottom destinations, safe-area padding,
  compact header, two-column metrics and vertically stacked panels. Navigation
  returns to the beginning of the selected domain.
- Charts measure their actual container using `useChartSize`; keep readable
  axes, fewer x ticks on narrow screens and pointer support. Preserve vertical
  page scrolling over charts. Health points select the exact source record;
  arrows/Home/End select from the keyboard. A date/time selector, adjacent-record
  buttons and return-to-latest action expose the complete measurement history.
  Same-minute records have distinguishing labels. Pointer hover graphics never
  intercept clicks. Money points retain keyboard selection.
- Show six fields of the selected health measurement initially. A labeled
  disclosure reveals every remaining field without changing values.
- Money history retains one data/editing path: desktop table, labeled mobile
  record cards. Inputs and actions remain reachable without horizontal scrolling.
- On phones, choosing a sport calendar day moves to the entry controls, with
  an explicit return to the calendar and focus restored to the selected day.
- The sport streak is a primary element above the calendar and entry form.
  Keep its count and clickable week visible in a sticky panel, including while
  the activity catalogue is expanded. Use a compact phone layout and measure
  the panel height so date navigation clears it after scrolling.
- Sport entry shows recorded activities and a searchable, bounded catalogue
  behind Add activity. Strength variants are mutually exclusive. Distance and
  repetition inputs appear for relevant activities; save errors retain records.
  Weekly streak days are real date shortcuts. Calendars use only the weeks
  occupied by the selected month. Icons and additional-activity counts replace
  the unbounded legend; repeated summaries and empty-day badges are omitted.
- Relationship headings use Fira Sans. Backend setup details stay outside the
  money dashboard; operational errors still use the normal error feedback.
- Use 44px action targets where possible, 16px mobile inputs, visible focus and
  text/semantic state alongside color. Seven-column calendars retain their
  familiar layout even at 320px.

## Pipeline

`.agents/skills/orchestrate-life-ui/SKILL.md` adapts ED1's Impeccable, Taste,
Emil and UI/UX Pro Max workflow to this repository. Start with local UI/UX
Pro Max as required by AGENTS.md. The router loads specialists progressively.
Use `npm run design-skills:check` to verify six pinned vendor bundles and
licenses. No runtime frontend dependencies are added by this workflow.

For previews use the configured local port; if macOS Control Center occupies
5000, run `PORT=5001 HOST=127.0.0.1 MONEY_SYNC_ENABLED=false npm run dev`.
Keep UI checks read-only against personal data or use isolated fixtures.

## Verification baseline — 2026-09-20

Chromium and WebKit passed layout checks for all four domains at 320, 390,
768, 1024 and 1440px. Desktop and phone screenshots were inspected. Neither
browser reported page overflow or JavaScript errors in those flows.

Behavioral checks covered profile/metric switching, expanded/collapsed health
fields, chart keyboard inspection, persistent touch tooltips, money edit/cancel
and mobile calendar navigation/focus. Mocked source responses covered initial
error recovery, empty measurements and transition to a single-point chart.
Data-writing API requests were blocked during browser checks. Production build,
vendor integrity verification and skill validation passed. Physical phones,
production deployment and live financial/training writes were outside this pass.

The subsequent deeper review covered all 12 browser comments. Chromium and
WebKit passed the revised flows at 320, 390, 768, 1087 and 1440px, including
the exact review width. Mocked sport saves exercised adding/removing activities,
exclusive strength variants, distance/repetition persistence, sick-day toggling
and failed saves. Health checks covered exact point identity, adjacent records,
return to latest and keyboard selection. A catalogue with 80 additional fixture
items remained bounded and searchable at 320px. The existing streak regressions
and production build passed. All test writes used in-memory responses.

The streak placement follow-up passed Chromium and WebKit checks at 320, 390,
768, 1024, 1087 and 1440px: initial visibility, sticky positioning with the
catalogue expanded, weekly date selection, phone return to calendar and no
horizontal overflow. Desktop, phone and scrolled phone screenshots were
inspected. Production build and vendor integrity checks passed.
