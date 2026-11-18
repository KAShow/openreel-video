# Phone export: save to the photo album or share (design)

Approved by the owner on 2026-11-18.

## Why
After an export on the phone the video went to Downloads (on iPhone: the Files app), not to the photo
album, and could not be sent to WhatsApp, Instagram or TikTok without digging it out. CapCut users expect
"save to album" and "share" right on the export screen.

## Constraint
A web page cannot write to the photo album or hand a file to WhatsApp by link. The only route is the
system share sheet (Web Share API with a file): on iPhone its first row is "Save Video", then WhatsApp,
Instagram, TikTok…; Android is similar. The sheet opens only from a tap, so it cannot open by itself when
the export ends.

## Approaches
- **Share sheet after export (chosen).** One big button on the done screen opens the sheet with the
  video. Works on iPhone and Android with no native app.
- Separate WhatsApp / TikTok buttons: rejected, each would open the same sheet (no deep link takes a file).
- Keep auto-download and add a share button: rejected on phones, it leaves a duplicate file in Downloads.

## Design
- Phones that can share video files: the export is held in memory (new delivery mode `hold`) instead of
  downloaded. The done screen shows "احفظ في الأستوديو أو شارك" (opens the share sheet) and a small
  "نزّله كملف" (the old download).
- Computers and browsers without file sharing: unchanged (automatic download).
- The held file is released when the sheet closes (OPFS temp file removed). "احفظ في مكتبتي" stays for
  signed-in users.

## Left to the builder
Wording of the done screen, the share title/text, and how a cancelled share is reported (silently).
