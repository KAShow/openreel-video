# Phone export share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a phone export, one tap saves the video to the photo album or shares it (system share sheet) instead of an automatic download.

**Architecture:** A new export delivery mode `hold` keeps the finished file (OPFS temp file or in-memory blob) in a small store instead of downloading it. The phone export sheet uses `hold` when the browser can share video files and offers "share" and "download as file" on its done screen.

**Tech Stack:** React, zustand, Web Share API (`navigator.share` / `navigator.canShare` with files), vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-phone-export-share-design.md`

## Global Constraints
- All user-facing text in Arabic. Desktop export and browsers without file sharing keep the automatic download.
- `navigator.share` must be called synchronously inside the tap handler (no `await` before it), or iOS refuses it.

## Review Focus
- Share cancelled by the user (AbortError): nothing reported, file still held.
- Closing the sheet or starting a new export releases the previous held file (OPFS entry removed).
- A share that fails for another reason: the done screen offers the download instead.

---

### Task 1: Held export store and share helpers

**Files:** Create `apps/web/src/hawsh/heldExport.ts`, test `apps/web/src/hawsh/heldExport.test.ts`; modify `apps/web/src/services/export-runner.ts` (`ExportDeliveryMode` gains `"hold"`; OPFS and buffered writables take a `deliver(file, filename, release)` callback, default = anchor download).

**Interfaces (produces):**
- `holdExport(file: Blob, filename: string, release?: () => void): void`
- `useHeldExport` (zustand) → `{ file: Blob | null; filename: string | null }`
- `releaseHeldExport(): void`
- `canShareVideo(): boolean`
- `shareHeldExport(): Promise<"shared" | "cancelled" | "failed">`
- `downloadHeldExport(): void`

- [ ] Tests: share passes a `File` named `filename` with type `video/mp4` to `navigator.share`; AbortError → `"cancelled"`; other error → `"failed"`; `releaseHeldExport` calls the release callback once and clears the store; holding a new file releases the old one; `canShareVideo` false without `navigator.canShare`.
- [ ] Implement, run tests, commit.

### Task 2: Phone export sheet

**Files:** Modify `apps/web/src/hawsh/mobile/PhoneExport.tsx`.

- [ ] Delivery `canShareVideo() ? "hold" : "download"`; done screen: primary "احفظ في الأستوديو أو شارك", secondary "نزّله كملف"; footer text says where the file goes; release on close and before a new export.
- [ ] Typecheck, mobile tests, check the sheet in the browser at phone width, commit, PR.
