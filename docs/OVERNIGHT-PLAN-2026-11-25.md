# Overnight plan (night of 2026-11-24 to 2026-11-25)

Written before an unattended night of about eight hours, with the decisions the owner made beforehand. The morning report is
[`OVERNIGHT-REPORT-2026-11-25.md`](OVERNIGHT-REPORT-2026-11-25.md); it says for every item below whether it was done, how it was
checked, and what was left. The plan of the earlier night is [`OVERNIGHT-PLAN.md`](OVERNIGHT-PLAN.md).

## Decisions made beforehand

- **Commits.** Everything goes to the local branch `overnight-2026-11-25`, made from `fix/review-top-five` at `ba73a0c`, one
  commit per item. Nothing is pushed.
- **Scope.** Testing first, then the video features that the review of Canva, Adobe Express, Kapwing and CapCut on 2026-11-24
  put first (volume and fades, play once or loop, a start time, sound in the editor's preview), then typed captions if there is
  time.
- **Dependencies.** No new npm packages (Mediabunny came in the day before and stays).

## Rules of the night

- Tests first: a test that fails for the right reason, then the change.
- Every item passes types, lint, format and the tests of its area before it is committed; the whole unit suite with the 95 %
  coverage gate, the build and the browser journeys run at the start and at the end of the night, and after any item that
  touches shared code.
- Anything with a face is looked at in the browser pane (the dev server on port 5173): the control, its words in English and
  Hindi, at desktop and phone width, and its effect on the page, in Present and in a video download read back from its file.
- An item that cannot be finished properly is left out, not half done: its changes are taken back and the report says why.
- Nothing is pushed, published or deployed. No accounts, keys or services are created. No file outside the project is touched
  except temporary files.
- What cannot be checked on this machine is named in the report, not assumed (Firefox, Safari, a phone, a person listening).

## Part A: testing

| # | Item | Done when |
| --- | --- | --- |
| A1 | Baseline: types, lint, format, the unit suite with the coverage gate, the build, and every browser journey on the dev server | each passes, or what fails is fixed in its own commit |
| A2 | Video edge cases: a clip with no sound track, a clip whose picture cannot be decoded, a clip of an odd size, two clips sounding at once, a clip in a group, a page of a clip that is hidden, a video download of the longest page allowed; the WebKit journeys if Playwright's WebKit is installed | a test for each, run against the real code where a browser is needed |

## Part B: video features

| # | Item | Done when |
| --- | --- | --- |
| B1 | **Volume and fade in / fade out on a clip** (Canva puts them on the video itself): a volume of 0 to 200 % and fades of up to 5 s, in the clip's toolbar; heard in Present and in the video download | unit tests for the model, the toolbar and the mix; the download's loudness read back from its file at the start, middle and end |
| B2 | **Play once or over and over**: a clip that plays once holds its last frame for the rest of the page and goes quiet | tests; Present and a download read back (last frame held, silence after) |
| B3 | **A start time for a clip on its page**: until then it shows its first frame and makes no sound; the page that follows its clip lasts until the clip has played once from that time | tests; a download read back |
| B4 | **Sound in the editor's Play** on a clip's toolbar (it is silent today) | tests; checked in the pane |
| B5 | **Typed captions** for a clip, if the night allows: lines with a start and an end, shown on the page over the clip, in Present and in downloads | tests; checked in the pane and in a download |

## Part D: added at 00:30, when parts A and B were done

The planned items took about an hour, so the rest of the night goes to these, in this order, under the same rules.

| # | Item | Done when |
| --- | --- | --- |
| D1 | **The sound of a video download mixed in pieces**: a 10-minute page raised the heap by about 345 MB, most of it the whole sound held at once | the heap of the same 10-minute download measured again; the sound read back as before |
| D2 | **Subtitle files for captions**: paste or open an `.srt` file into a clip's captions, and copy them out as `.srt` | tests of the reader and writer (times, several lines of text, a broken file); checked in the pane |
| D3 | **The keyboard through tonight's popovers** (Audio, Trim, Captions): every control reachable with Tab, named for a screen reader, Esc closes and gives the keyboard back to the toolbar | checked in the pane; fixes with tests |

## Part C: the end of the night

| # | Item | Done when |
| --- | --- | --- |
| C1 | Everything again: types, lint, format, the unit suite with the coverage gate, the build, every browser journey | all pass |
| C2 | CHANGELOG, README, TODO and the morning report | written from what was checked, with what nobody has seen named |
