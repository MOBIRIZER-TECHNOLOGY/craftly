# Report of the night of 2026-11-25

What was done of [`OVERNIGHT-PLAN-2026-11-25.md`](OVERNIGHT-PLAN-2026-11-25.md), how it was checked, and what is left.
Everything is on the local branch `overnight-2026-11-25`, made from `fix/review-top-five` at `ba73a0c`, one commit per item.
Nothing was pushed, published or deployed.

## In one paragraph

Every item of the plan is done: the video edge cases, a clip's volume and fades, playing once, a start time, sound in the
toolbar's Play, typed captions, the sound of a video download mixed in pieces, `.srt` files for captions, and the keyboard
through the clip's popovers. The keyboard check found two faults in shared controls (a popover that lost the keyboard after
Esc in a number field, and number fields that pulled the focus back during a quick walk with Tab), both fixed with tests. The
whole branch passes types, lint, format, the unit suite with the coverage gate, the build and all 27 browser journeys. Nobody
has listened to the sound in Present or in the toolbar's Play, nobody has used the popovers with a screen reader, and the
sound mixed in pieces saved no memory that could be measured: read "What nobody has seen" and "Left over".

## Checks at the end of the night

| Check | Result |
| --- | --- |
| Types (`tsc --noEmit`), format (`prettier --check`) | pass |
| Lint | pass for the project; `npm run lint` itself reports 2,107 errors, all in the leftover worktree `.claude/worktrees/pr9-offline` (see Left over) |
| Unit tests, with coverage | 10,662 passed and 1 expected failure, in 471 files |
| Coverage (gate 95 %) | statements 98.3 %, branches 95.77 %, functions 98.65 %, lines 99.17 % |
| Build | pass |
| Browser journeys, dev server, Chrome (`npm run e2e`) | 27 journeys, 403 of 403 steps, "All journeys passed" |

## The items

| # | Item | Commit | How it was checked |
| --- | --- | --- | --- |
| A2 | Video edge cases | `84a1163` | Tests for a clip without frames, a file that is not media, a mono clip, an empty sound track. In Chrome with clips made in the page: a 321 x 181 clip, two clips at 0.9 at once (peak 0.974 in the MP4), a clip without sound, a page following a 10-minute clip (18,000 frames in 25 s, the pitch right at 0, 4 and 9 minutes). Two faults fixed: a clip's second frame was lost when its first came late; a loud mix was clipped by the encoder. |
| B1 | Volume and fades | `7792024` | Unit tests for the curve, the player and the mix; the popover in the pane in English and Hindi at 375 px; a download at 50 % with 0.5 s fades read back from its file (0.03, 0.13, 0.26, 0.13, 0.03). Volume stops at 100 %, not 200 % as planned: a `<video>` cannot play louder than its file. |
| B2 | Play once | `63ee95a` | Tests; a 5 s download read back (red and sound, blue and sound, then blue and silent from 2.42 s); Present stays on the last frame. |
| B3 | A start time | `7cf197b` | Tests; a download of a clip starting at 1.5 s read back (silent first frame, then 440 Hz red, then 880 Hz blue, 3.93 s long). |
| B4 | Sound in the toolbar's Play | `92239ea` | Tests; in the pane by watching the players (sound on, paused at the end). |
| B5 | Typed captions | `0671a7c` | Tests; the popover in the pane, in Hindi at 375 px; the caption in Play; three frames of a 720p download. |
| (found) | The video download under the security policy | `7e61a1d`, `3d990c2` | Found by the journeys on a production build: a clip with a transparency layer stayed on its first frame. Such clips are now read by seeking a `<video>`. `video.cjs` on a rebuilt production copy: 14 of 14. |
| D1 | The sound of a download mixed in pieces | `3a4487b` | The download read back as before (600 s, the pitch right at 30, 270 and 570 s). The heap was measured again: 318 and 356 MB against 345 MB before, so **no saving shows** (see Left over). |
| D2 | `.srt` files for captions | `519fa63` | Tests of the reader and writer (times, several lines, a broken file, tags, CRLF, a byte-order mark); in the pane a file with a tag and a broken block opened (2 lines, 1 skipped) and saved again. |
| D3 | The keyboard through the clip's popovers | `a5b9845`, `c068d8b` | Trim, Audio and Captions walked with the keyboard alone in Chrome by a Playwright script on the dev server, at 1440 and 390 px, in English and Hindi, Captions also with two lines: every control reached with Tab and named, Tab kept in the panel, Esc in a number field keeps the panel, the next Esc closes it and the focus is back on the toolbar button. Two faults found and fixed, each with a test that fails without the fix (below). |
| C1, C2 | Everything again; CHANGELOG, README, TODO, this report | this commit | The table above. |

### The two keyboard faults (D3)

- **Esc in a number field lost the keyboard.** A number field drops its edit on Esc and lets go of the focus, which went to
  the page itself: the next Esc reached nothing and the popover stayed open. A popover that keeps Tab inside now takes such
  focus back, so the next Esc closes it (`src/ui/Popover.tsx`).
- **A quick walk with Tab was pulled back.** A number field selects its number one frame after it takes the focus, and in
  Chrome `select()` also focuses the field. When Tab moved faster than a frame (Tab held down, a screen reader, a test script)
  every field passed took the focus back in turn. It now selects only while it still has the focus (`src/ui/NumberField.tsx`).
  This control is used in many panels and dialogs, not only the video ones.

## What nobody has seen

- **Sound.** Nobody has listened to a clip in Present or in the toolbar's Play. The players were watched (volume, paused,
  muted), and the downloads were read back from their files, but no person heard anything.
- **Screen readers.** The names were read from the page's accessibility attributes. No screen reader (NVDA, JAWS, VoiceOver)
  was used.
- **Other browsers.** Firefox and Safari were not tried. The commits do not say whether the WebKit journeys ran (A2 planned
  them "if Playwright's WebKit is installed").
- **A phone.** Phone widths were checked in a desktop Chrome window, not on a phone.

## Left over

- **The memory of a long video download.** Mixing the sound in pieces (D1) removed the whole mix and the per-clip copies, but
  the page's JavaScript heap did not fall: the old mix lived in Web Audio buffers, which that measure does not count, and the
  browser's process memory could not be read from the page. What is still held whole is each clip's decoded sound, about
  115 MB a channel for a 10-minute clip. Decoding it window by window needs seeking in a compressed audio stream with pre-roll,
  and is left for later. Measuring the tab's memory in Chrome's task manager would settle whether D1 saved anything.
- **Lint and the leftover worktrees.** `npm run lint` lints `.claude/worktrees/*`, three checkouts of other branches, and fails
  on them (2,107 errors, all in `pr9-offline`). Either add `.claude/**` to the ignores in `eslint.config.js` or clean up the
  worktrees. Neither was done, because the plan did not cover them.
- **Captions** have one look: no font, colour or position of their own, and no automatic captions (`docs/TODO.md`).
- **Volume above 100 %** would need Present to play its clips through Web Audio.
