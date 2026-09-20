---
name: orchestrate-life-ui
description: Refine and verify Life Dashboard interfaces using the pinned ED1 design playbooks, adapted to React/Vite, personal data, mobile navigation, charts and editable records. Use for visible UI changes and design reviews in this repository.
---

# Life Dashboard UI pipeline

Adapted from ED1's orchestrate-ed1-ui stack. Start with the local UI/UX Pro Max
skill as required by AGENTS.md, then use this router to resolve direction and
select only the relevant vendor references.

## Context and authority

Read `AGENTS.md`, `docs/design.md`, `src/styles.css`, the target component and
its closest shared component. These satisfy Impeccable's context setup; no
root PRODUCT.md, sidecars or context generator is needed.

Explicit user intent and data correctness take priority, then project rules,
the design contract, current tokens/components and finally vendor advice.
Preserve the blue/amber palette, Fira Sans/Fira Code, Lucide, 8px cards and
existing React/Vite architecture. Vendor font, framework, radius, motion and
dark-mode defaults are optional. Never alter health calculations or imply
medical meaning from a cosmetic color. Preserve persistence, refresh and save
contracts. Keep secrets and personal exports outside tracked artifacts.

Run `npm run design-skills:check` before using a vendor; resolve missing or
modified bundles before applying that vendor's guidance. Bundles are local,
pinned in [vendor-lock.json](references/vendor-lock.json), with licenses.

## Select playbooks

Paths below are relative to `.agents/vendor/ui-skills/`.

- Material UI work: `impeccable/SKILL.md`, then one primary reference:
  `reference/polish.md` for existing UI, `reference/new-work.md` for a new
  visual world, `reference/audit.md` for technical reviews, or
  `reference/critique.md` for hierarchy reviews.
- Mobile adaptation: add `impeccable/reference/adapt.md` to implementation.
- Explicit substantial art direction: add `taste-skill/SKILL.md`; use its
  brief and dials within this project's authority.
- Motion requests: use `emil-design-eng/SKILL.md`, or
  `find-animation-opportunities/SKILL.md`, `improve-animations/SKILL.md`,
  `review-animations/SKILL.md` for that specific phase. Routine dashboard
  updates should feel immediate; add movement only for a concrete purpose.
- Unresolved UX questions: targeted UI/UX Pro Max queries using `--domain ux`,
  `--domain chart` or `--stack react` (at most three results).

## Execute

1. Inspect the actual page at desktop and phone widths. Record functional
   obstacles, hierarchy, overflow, touch targets and disclosure opportunities.
2. State one concise direction: surface, job, what stays, and dials. The
   dashboard's default mode is Operate, variance 3/10, motion 1/10, density
   7/10 desktop and 5/10 mobile. Infer ordinary choices from existing context.
3. Read `impeccable/reference/craft-floor.md` immediately before editing.
   Implement the requested change in the same task, with shared CSS tokens
   and existing components. Keep all data and controls reachable on mobile.
4. Check Russian wrapping, focus, touch/pointer/keyboard interactions,
   empty/loading/error states and reduced motion where affected.
5. Batch visual inspection at 320, 390, 768, 1024 and 1440px. Check all
   affected domains, charts, tables and forms. Verify document overflow,
   bottom safe-area clearance and sticky controls. Use Chromium and WebKit
   when available; distinguish emulation from a real device check.
6. Fix observed defects, confirm once, run `npm run build` and relevant
   behavioral checks. Report what changed, evidence and any unverified state.

## Vendor maintenance

Keep vendor files outside auto-discovered skills. Update bundles in a scoped
maintenance change with an exact upstream commit, preserved license and new
digest; run the verifier. Hooks, Live Mode and automatic source mutation are
opt-in. This pipeline does not authorize deployment or external writes.
