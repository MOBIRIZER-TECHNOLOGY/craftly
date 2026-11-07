# Canva video editor, audio features and photo editor (non-AI): state as of 2026-11-05

> **Read first: how these notes were gathered.**
> 1. The fetch tool returned HTTP 403 for every canva.com page tried (video-editor, photo-editor, upload requirements, Help articles, pricing), and web.archive.org is blocked at tool level. **Every canva.com citation below therefore comes from a WebSearch result summary of that page** (a tool-generated paraphrase, not verbatim). The page's own last-updated date was usually not visible, and the search index labelled several Help articles (download-as-video, creating-and-editing-videos, resize) as roughly 1,200-2,400 days old, so some limits may predate Video 2.0. Re-check in the live product before relying on exact numbers.
> 2. Pages read in full via fetch: brendacadman.com, webeducationservices.com, keepcanva.com, fluxnote.io, bityclips.com, bestmediainfo.com, siliconangle.com. All other links (including all canva.com links) were read through search summaries only.
> 3. The shared web-search budget ran out before three planned queries (the "New Canva Photo Editor" Help page, "What's New in Canva July 2026", a curves/selective-adjustment search). Affected items are listed under Gaps.
> 4. FluxNote sells a competing video product, and BityClips uses referral links; their claims are flagged and weighted below Canva's own Help text.
> 5. Everything accessed 2026-11-05. Scope: non-AI features in detail; AI features appear only as one-line "AI pointer" bullets (another researcher covers them).

## 1. Video editor and audio (editing model, clip operations, transitions, effects, resize, audio, captions, stock, recording, collaboration, mobile, export and limits)

### Takeaway
Canva rebuilt its video editor as a multi-track timeline ("Video 2.0": keynote 2025-10-30, live for some users by about 2025-10-19, still labelled beta in Help): a gapless main track, overlay tracks above it, up to 50 audio tracks, trim/split, 0.25x-2x speed, crop/flip, main-track-only transitions, filters/adjust, volume/fade/Balance all, and Beat Sync (Pro). It exports only MP4 or GIF (Free: 1080p and 30 min; paid: 4K and 2 h), accepts uploads up to 1 GB, and reviewers describe it as a short-form tool lacking chroma key, strong keyframing and real colour grading.

### Cited Findings

#### Editing model, tracks, versions
- Canva introduced Video 2.0 during its World Tour announcements on 2025-10-30, pitched as giving creators more control through a multi-track timeline (post published 2025-11-12, last modified 2026-06-18) — [Brenda Cadman](https://brendacadman.com/how-to-turn-off-canvas-video-2-0-editor/)
- Canva's own support account replied on X that its video editor now has a multi-track timeline for layering content (only the result title was seen; the post date was not shown, but the status ID decodes by my calculation to 2025-10-19, so rollout to some users preceded the 10-30 keynote) — [Canva on X](https://x.com/canva/status/1979979854859710483)
- Press coverage of the 2025-10-30/31 "Creative Operating System" launch calls Video 2.0 part of the rebuilt Visual Suite, offering professional-grade editing with a simplified timeline plus AI for trimming, syncing and effects; global rollout of the suite from 2025-10-31 (no separate Video 2.0 date given) — [BestMediaInfo, 2025-10-31](https://bestmediainfo.com/mediainfo/mediainfo-digital/canva-launches-creative-operating-system-with-design-ai-video-20-and-all-new-affinity-10608968)
- Timeline structure per Help: the main track holds primary video/photo clips that play one after another with no gaps; upper tracks hold text, graphics and overlays that play simultaneously; clips on higher tracks render over lower ones; drag left/right to change timing and up/down to change layer; audio sits in its own section — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Zoom: pinch on trackpad, Ctrl/Cmd + scroll, or the zoom control at the bottom of the editor — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/); a Design School lesson covers precise multi-track editing and fine timing of transitions, captions and effects — [Canva Design School: Video Timeline](https://www.canva.com/en/design-school/resources/video-timeline)
- Beta-era description: playhead, time ruler, waveforms on audio, frame-level zoom, templates now timeline-based; old editor was a slide-deck-like page model — [Web Education Services, 2025-11-06](https://www.webeducationservices.com/canva-video-editor-2-0-beta) (promotional blog)
- Designs created before October 2025 keep the page-based structure and are not auto-converted; Help describes the multi-track editor as beta; page view settings let a user leave the timeline and return to page editing — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/), [Canva Help: Page view settings](https://www.canva.com/help/page-view-settings/)
- Opt-out path: Profile > Settings > Video editing > toggle "Use new multi-track video editor (beta)"; classic editor still available when written; Canva had not said if it will stay — [Brenda Cadman](https://brendacadman.com/how-to-turn-off-canvas-video-2-0-editor/). Conflicts: switching can reset clip order ([Web Education Services](https://www.webeducationservices.com/canva-video-editor-2-0-beta)); turning the beta off did not restore the old editor for the author ([KeepCanva, 2025-11-21](https://www.keepcanva.com/2025/11/the-new-canva-video-editor-beta-is-a-complete-mess.html)).
- "Edit as Video" (Feb 2026 What's New) converts presentations, social posts and custom designs into animated graphics on the new timeline — [Canva newsroom: What's New Feb 2026](https://www.canva.com/newsroom/news/whats-new-february-2026/), [Canva Help: Convert designs to video](https://www.canva.com/help/edit-as-video/)

#### Clip operations
- Trim: drag clip edges on the timeline; the separate trim tool was removed from video designs; Auto-trim is temporarily unavailable in video designs; an older article still describes a toolbar trim icon for videos placed in static designs — [Canva Help: Trim videos](https://www.canva.com/help/trim-videos/)
- Split: playhead, then More menu > Split, or press S — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Speed: Playback > speed slider or typed value, **0.25x (slowest) to 2x (fastest)**; different speeds per segment after splitting — [Canva Help (UK): Adjust video playback](https://www.canva.com/en_gb/help/adjust-video-playback/), [Canva: Speed up video](https://www.canva.com/features/speed-up-video/). No source supports a 4x maximum.
- Crop: the clip must sit in its own bounding box (not attached to the page background) before it can be cropped — [Canva Learn: Edit video quickly](https://www.canva.com/learn/easily-edit-video-fast/)
- Flip: toolbar Flip, horizontal or vertical (same Learn page); Flip is unavailable for text, charts, empty grids, frames, shapes and grouped elements; rotate by handle or exact degrees under Position — [Canva Help: Flip and rotate elements](https://www.canva.com/help/flip-and-rotate/)
- Element timing: drag trim handles on an element's timeline edge; locked elements cannot be changed until unlocked — [Canva Help: Edit element timing in your video](https://www.canva.com/help/element-timing-video/)
- Filters (one click, Intensity slider, Remove) and Adjust (brightness, contrast, saturation, tint) apply to video; "Apply to all media" copies a filter across clips — [Canva Help: Apply or remove filters](https://www.canva.com/help/filters/), [Canva Help: Adjust image and video settings](https://www.canva.com/help/image-settings/)
- The visual Effects panel (drop, glow, echo, glitch) applies to frames and frame-based elements, not plain videos; some effects are not supported in video export and the download menu warns about it — [Canva Help: Apply visual effects and quick styles](https://www.canva.com/help/effects-quick-styles/)
- Editor playback: File > Settings > Video playback quality Low/Medium/High/Auto; Help says the editor supports up to 1080p Full HD and larger source files may play poorly — [Canva Help: My video won't play back](https://www.canva.com/help/my-video-wont-playback/)

#### Transitions and animation
- Transitions: hover between two **main-track** clips > Add transition > pick from the Transitions panel > set duration and direction; not possible between clips on upper tracks; not available in page mode for video designs — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Page-transition duration slider range 0.1-2.5 s — [Canva Help: Use page transitions](https://www.canva.com/help/page-transitions/)
- On mobile, transitions exist only on video templates — [Canva Design School: How to edit videos like a pro](https://www.canva.com/design-school/resources/how-to-edit-videos-like-a-pro-in-canva/)
- Named styles: dissolves, slides, wipes — [Canva: Video transitions](https://www.canva.com/features/video-transitions/); a competitor review says only fade, slide and dissolve exist (no camera-style, motion-blur or 3D transitions) — [FluxNote, 2026-07-26](https://fluxnote.io/guides/canva-video-editor-review)
- With Beat Sync on, transitions start and end on the nearest beat — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Element animations (intro/outro, speed, duration) are set in the Animate panel — [Canva Help: Add animations](https://www.canva.com/en_in/help/add-animation/)

#### Green screen and background removal
- Video Background Remover: one click, no green screen needed, works on library and uploaded clips; path Edit video > Tools > Background remover; presented as a Pro feature — [Canva: Video Background Remover](https://www.canva.com/features/video-background-remover/), [Canva Pro: Video Background Remover](https://www.canva.com/pro/video-background-remover/), [Canva Help: Remove photo and video backgrounds](https://www.canva.com/help/background-remover/)
- "Green Screen Maker" works on photos only (cuts out subject, fills chroma green #00B140 or #00FF00) — [Canva: Green screen maker](https://www.canva.com/features/green-screen-maker/)
- A competitor review states Canva has no chroma-key compositing — [FluxNote, 2026-07-26](https://fluxnote.io/guides/canva-video-editor-review)
- AI pointer: video background removal is ML-based (covered by the AI researcher).

#### Aspect-ratio resizing
- Resize on the toolbar: social presets or custom pixels, resize in place or "Copy & resize"; Resize is listed for Pro, Business, Enterprise, Education, Higher education, Nonprofits and Teams; Magic Switch is Pro-only; design size limits 40 x 40 px minimum to 8000 x 3125 px maximum; bulk resize up to 50 designs, 5 sizes each, 250 outputs — [Canva: Video Resizer](https://www.canva.com/features/video-resize/), [Canva Help: Resize designs and size limits](https://www.canva.com/help/resize/)
- Conflict: an older Help sentence says Magic Resize will return to video designs soon, while a newer page says it resizes video to 16:9, 9:16 and 1:1 — [Canva Help: Resize](https://www.canva.com/help/resize/), [Canva: Video converter](https://www.canva.com/features/video-converter/)

#### Audio, music, voiceover
- **Up to 50 audio tracks per design**; beyond that, duplicate the design and delete the other pages — [Canva Help: Add audio tracks and sound effects](https://www.canva.com/help/stock-music/)
- Audio sources: music library, sound effects, uploaded audio, generated AI voice — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Volume: select track > volume icon > slider/text box; a Balance all button evens levels across all audio and video in the design — [Canva Help: Edit and trim audio tracks](https://www.canva.com/help/trim-audio-and-adjust-volume/)
- Fades: select the audio track > Fade (or Audio effects) > slider; fading a video's own sound on iOS needs app version 4.126.0 or later — [Canva Help: Edit and trim audio tracks](https://www.canva.com/help/trim-audio-and-adjust-volume/), [Canva: Add music to video](https://www.canva.com/features/add-music-to-video/)
- Beat Sync: button above the editor, automatic, **Pro**; free users can place beat markers manually — [Canva Help: Syncing audio with video](https://www.canva.com/help/syncing-audio-with-video/), [Canva: CapCut alternative](https://www.canva.com/create/capcut-alternative/)
- Voiceover recorded in the editor (microphone/camera test page exists) — [Canva Help: Record voiceover](https://www.canva.com/en_gb/help/record-voiceover/), [Canva Help: Test your microphone and camera](https://www.canva.com/help/test-microphone-camera/)
- Audio upload: M4A, MP3, WAV plus AAC, FLAC, OGG, WMA, WEBM; up to 250 MB — [Canva Help: Upload formats and requirements](https://www.canva.com/help/upload-formats-requirements/)
- Popular music: Pro or Education only; a Free user who buys a premium track may use it in one design; each popular track previews 30 s and runs up to 60 s once added; one audio licence is generated per design — [Canva Help: Add popular music](https://www.canva.com/help/adding-popular-music-to-designs/), [Canva Help: Purchase and get licences for Pro audio](https://www.canva.com/help/verify-music/)
- Library scale: 500,000+ popular songs when launched — [Canva newsroom: popular music library](https://www.canva.com/newsroom/news/popular-music-library/); Pro page cites 75+ million premium images, videos, graphics, GIFs and audio — [Canva Pro: Premium content](https://www.canva.com/pro/premium-content/); an older Canva release (2021) cites 100 million assets — [Canva Video Suite release](https://www.canva.com/newsroom/news/canva-launches-video-suite-empower-everyone-create-edit-record-stunning-videos/) (exact page not isolated in the summary)
- Utilities exist for extracting and removing audio from video — [Canva: Extract audio](https://www.canva.com/features/extract-audio/), [Canva: Remove audio](https://www.canva.com/features/remove-audio-from-video/)
- Conflict: BityClips claims no multi-track audio editing, which contradicts the 50-track Help statement — [BityClips, 2026-05-31](https://bityclips.com/blog/canva-video-review-2026) (referral-linked blog; Canva Help preferred)
- AI pointer: generated music/SFX/voiceover ([Help](https://www.canva.com/help/generate-ai-music-sound-effects-and-voiceovers/)), voice cloning, audio enhancer, noise cancellation in the online voice recorder (Pro) — [Canva: Voice recorder](https://www.canva.com/features/voice-recorder/)

#### Captions and subtitles
- Captions: Text > Dynamic text > Captions > choose style pack > Generate captions; spoken language auto-detected; optional translate-into language (Translate is Pro); style packs exist for English, Spanish, Portuguese, French, Indonesian, German; many spoken languages recognised (e.g. English, Spanish, French, German, Japanese, Korean, Hindi, Arabic); captions export with the video — [Canva Help: Generate and animate captions](https://www.canva.com/help/generate-edit-captions-on-videos/), [Canva: Auto caption generator](https://www.canva.com/features/auto-caption/)
- Viewer-side accessibility/view-only captions can be switched on for videos and audio — [Canva Help: Enable captions](https://www.canva.com/help/enable-captions/)
- An older Help page says captions cannot be edited; newer pages say they can — [Canva Help: Generate and animate captions](https://www.canva.com/help/generate-edit-captions-on-videos/)
- AI pointer: caption generation is speech-to-text; video translator supports 100+ languages — [Canva: Video translator](https://www.canva.com/features/video-translator/)

#### Stock video
- Free stock-video page advertises clips in HD and 4K — [Canva: Free stock videos](https://www.canva.com/features/free-stock-videos/); Pro unlocks the premium library (75M+ assets across types) — [Canva Pro: Premium content](https://www.canva.com/pro/premium-content/)
- AI pointers: Magic Video builds 60-second videos from clips/prompts ([Help](https://www.canva.com/help/magic-video/)); Create a Video Clip makes 8-second clips with sound via Veo 3 ([newsroom](https://www.canva.com/newsroom/news/veo3-canva-ai-video/)); Image to Video makes 5-second clips and supports human faces since the May 2026 update ([What's New May 2026](https://www.canva.com/newsroom/news/whats-new-may-2026/)); Canva I2V is its own image-to-video model ([SiliconANGLE, 2026-04-16](https://siliconangle.com/?p=739587))

#### Screen and webcam recording ("Canva Studio")
- Record yourself (Uploads tab): webcam, screen, or both inside the editor; options Camera and Screen / Screen only; result saved to Uploads and placed as an editable video element — [Canva Help: Record videos in the editor](https://www.canva.com/help/recording-videos/)
- Screen Recorder (desktop app: Create > Quick Actions > Screen Recorder): recording becomes a new Canva video design; **max 25 min and 1 GB per recording**; needs the desktop app, OS screen-recording permission and a working microphone — [Canva Help: Record your screen](https://www.canva.com/help/screen-recorder/), [Canva: Screen recorder](https://www.canva.com/screen-recorder/)
- Canva pages disagree on whether screen capture is desktop-app-only or also in the browser editor — [Canva Help: Record videos in the editor](https://www.canva.com/help/recording-videos/) vs [Canva: Screen recorder](https://www.canva.com/screen-recorder/)
- Talking presentations (Present > Present and record > recording studio): computer only; one recording per design; a public view link is created automatically even if the recording is not saved; speaker notes show while recording but not in the output; viewers can turn on auto subtitles — [Canva Help: Record and delete talking presentations](https://www.canva.com/help/talking-presentations/)
- No Canva product literally called "Canva Studio" turned up; "recording studio" is the label inside Present and record, and "Canvas Studio" is an unrelated learning-system tool — [Canva Help: talking presentations](https://www.canva.com/help/talking-presentations/)

#### Collaboration on video
- Share link with Can edit / Can comment / Can view; live updates while others edit; comments with replies and resolve; guests must sign in to add or resolve comments — [Canva: Share video](https://www.canva.com/features/share-video/), [Canva Help: Share your design and collaborate](https://www.canva.com/help/collaborate-with-anyone/). This is generic design collaboration; no source describes timecode-pinned comments.

#### Mobile apps
- Template-first quick video creation (swap media, export without opening the full editor) exists only in "Canva Classic" on iOS/Android, not "Canva Lite", rolling out gradually; media-first timeline editing exists on mobile (a Design School lesson covers the mobile timeline), but parity with desktop is unverified; Record yourself works in the mobile app — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/), [Canva Design School: Video Timeline on mobile](https://www.canva.com/en/design-school/resources/video-timeline-mobile), [Canva Help: Record videos in the editor](https://www.canva.com/help/recording-videos/)

#### Export, formats, duration, upload limits
- Download as **MP4 or GIF**; MP4 quality 480p / 720p / 1080p / 4K, with **4K on desktop only** — [Canva Help: Downloading designs as video or GIF](https://www.canva.com/help/download-as-video/)
- **Free: MP4 up to 30 min, max 1920 x 1080; GIF up to 1 min. Paid (Pro, Teams, Nonprofits, Education): MP4 up to 2 h, max 3840 x 2160; GIF up to 2 min** — [Canva Help: Downloading designs as video or GIF](https://www.canva.com/help/download-as-video/)
- Free users can download at the default 1080p; picking another quality prompts an upgrade; pages can also be downloaded as separate video files — [Canva Help: Download design pages as separate video files](https://www.canva.com/help/download-video-as-separate-files/)
- Corroboration of 30 min / 1080p vs 2 h / 4K: [Sparxno comparison](https://sparxno.com/blog/canva-video-editor); a 2026 review says Free exports 1080p with no watermark, 4K needs Pro, Pro adds priority rendering — [FluxNote, 2026-07-26](https://fluxnote.io/guides/canva-video-editor-review). Conflicting (unreliable): BityClips says Free 720p / Pro 1080p ([BityClips](https://bityclips.com/blog/canva-video-review-2026)); a Japanese blog reportedly says 5 min Free / 15 min Pro (reported in search summary only, not opened).
- Known download-failure causes: more than 10 pages in a design, videos of typically 10+ minutes, frame rates of 60 fps or higher, embedded YouTube videos — [Canva Help: I can't download my design or video](https://www.canva.com/help/cant-download-design-or-video/)
- Upload: MOV, GIF, MP4, MPEG, MKV, WEBM, **1 GB max per file**; uploaded 4K is downscaled to 1080p even though export can be 4K — [Canva Help: Upload formats and requirements](https://www.canva.com/help/upload-formats-requirements/), [Canva: Upload video](https://www.canva.com/features/upload-video/)
- Storage: Free 5 GB media; Pro 100 GB per the video-upload page (another Help page and BityClips say 1 TB for Pro); Business 500 GB per team; Enterprise 1-5 TB per team; Pro Lite 50 GB — [Canva: Upload video](https://www.canva.com/features/upload-video/), [Canva Help: Pro Lite](https://www.canva.com/help/pro-lite/)
- Sharing to third-party platforms: MP4/GIF up to 250 MB — [Canva Help: Sharing on social media limitations](https://www.canva.com/help/sharing-social-media-limitations/)
- Frame rate: Canva documents no export frame-rate setting; a 2023 blog claims up to 60 fps export (low authority) — [Advert Tech blog](https://adverttech.blogspot.com/2023/07/export-60fps-canva.html)
- Transparent video: a Canva profile-picture page suggests GIF when a clip needs a transparent background, and no alpha MP4/WebM export is documented in what I could read — [Canva: YouTube profile picture maker](https://www.canva.com/create/youtube-profile-pictures/)

### Inferences
- Canva's documented model is deliberately simpler than an NLE: one gapless main track, free-floating overlay tracks, an audio track list capped at 50, transitions only between main-track neighbours, and no documented ripple/track-targeting/nesting. That is a bounded parity target for Craftly's first timeline.
- The limits cluster around short-form: Canva's own Help lists 10+ minute videos, 60 fps and 10+ pages as failure causes, editor playback tops out at 1080p, and a reviewer rates videos up to about 3 minutes as working well and 10+ minutes as unwieldy. A Craftly v1 capped at roughly 1080p/30 fps and a few minutes would sit at Canva's sweet spot.
- Canva documents only MP4 and GIF output; WebM export (which Craftly has) is not something Canva advertises, while MP4 is the missing parity format.
- Canva gates compute- or library-heavy items (Beat Sync, video background removal, 4K and 2 h export, premium audio, Magic Switch resize) behind paid plans, while core timeline operations are Free; a no-backend tool would have to run any beat detection or segmentation client-side.
- The decoded 2025-10-19 date for Canva's X reply plus the Help note that designs created before October 2025 keep the page model suggest the timeline reached users in early/mid October 2025, ahead of the keynote.

### Gaps
- Primary Canva pages were unreadable (HTTP 403); numbers above rely on search summaries, some of pages the index called 1,200-2,400 days old. Free 30 min/1080p and paid 2 h/4K are the best available figures but should be re-verified in the live Download menu.
- Export frame rate, codec, bitrate, and any non-MP4/GIF container (WebM, MOV, ProRes, alpha video) are undocumented in what I could read.
- Maximum number of video/overlay tracks, maximum clips, and maximum timeline length (as opposed to export length) not found.
- Whether Video 2.0 has exited beta by November 2026, and whether the classic editor is retired, is unconfirmed (only 2025-11 to 2026-06 sources).
- Keyframe support in Video 2.0 is not confirmed either way (reviewers say limited; no Help page seen).
- Caption plan gating (Free vs Pro) and caption-editor depth not confirmed; stock-video library size not found; auto-ducking/EQ/non-AI noise reduction not found.
- Mobile timeline parity, and timecode-pinned video comments, not verified.
- The 1.5 million popular-tracks figure appeared in a search summary attributed to Canva's newsroom, but the exact page was not isolated, so it is not listed above.

## 2. Photo editor and image tools (Adjust, Filters, Effects, Retouch, Autofocus, crop/straighten/flip/mask, frames, mockups, PDF, transparent PNG, colour extraction, export)

### Takeaway
Canva's photo editor is a parametric, per-element toolset reached through Edit on the image toolbar: Adjust sliders (brightness, contrast, saturation, tint confirmed), Filters (Duotone at the end), Tools (Blur with a brush, Auto Focus, Face Retouch), Shadows, non-destructive crop with Smart Crop and 45-degree straighten snapping, flip, and frames/grids as masks. Export covers PNG/JPG/PDF/SVG with transparent background, size limiting and compression gated to paid plans; real pixel work (RAW, curves, layers) lives in the separate, free Affinity app.

### Cited Findings

#### Where the tools live (non-AI)
- Select image > Edit > Tools / Filters / Shadows; Blur, Auto Focus and Face Retouch sit under Tools; Duotone is at the end of Filters; Adjust holds brightness, contrast and related sliders; the single "Effects" section no longer exists (older pages still mention an Effects tab) — [Canva Help: Edit photos with Canva photo editor](https://www.canva.com/help/image-editor/), [Canva Help: Edit and enhance images](https://www.canva.com/help/edit-images/)
- A separate Help page, "New Canva Photo Editor", exists and says colour-adjustment tools and cropping are listed there and that Auto-Focus and Shadows remain (seen only as a search-summary description; launch date and full tool list unread) — [Canva Help: New Canva Photo Editor](https://www.canva.com/help/new-canva-photo-editor/)
- Adjust: brightness, contrast, saturation, tint (shifts overall hue cool/warm), plus an Auto-adjust with adjustable intensity; Help intro also mentions perspective; Adjust has a "See all" expander — [Canva Help: Adjust image and video settings](https://www.canva.com/help/image-settings/), [Canva: Photo effects](https://www.canva.com/features/photo-effects/)
- Sliders **not verified** because summaries conflict: highlights, shadows, warmth/temperature, vignette (one summary says vignette is filter-based), blur/sharpen direction, X-Process (described as enhancing hue separation) — [Canva Help: Edit and enhance images](https://www.canva.com/help/edit-images/), [Canva Help: Adjust image and video settings](https://www.canva.com/help/image-settings/)
- Filters: one click with an Intensity slider — [Canva Help: Apply or remove filters](https://www.canva.com/help/filters/)
- Blur: whole image, or a Brush tool to blur specific areas — [Canva Help: Blur photos](https://www.canva.com/help/blur-photos/)
- Auto Focus: dedicated Help article "Sharpen your photo with Auto Focus" exists (steps unread) — [Canva Help: Edit photos with Canva photo editor](https://www.canva.com/help/image-editor/)
- Shadows and other quick styles (drop, glow, etc.) — [Canva Help: Apply visual effects and quick styles](https://www.canva.com/help/effects-quick-styles/)
- AI pointers (one line each): Background Remover (Help says paid plans; marketing page mentions limited free downloads; a Learn page says up to 500 images per 24 h; sources conflict) — [Help](https://www.canva.com/help/background-remover/), [Learn](https://www.canva.com/learn/background-remover/); Magic Edit, Magic Eraser (cleaner removals since the May 2026 update — [What's New May 2026](https://www.canva.com/newsroom/news/whats-new-may-2026/)), Magic Grab, Magic Layers ([Help](https://www.canva.com/help/editable-magic-layers/)), AI photo enhancer ([Canva: AI photo editing](https://www.canva.com/features/ai-photo-editing/))

#### Crop, straighten, flip, mask
- Crop from the toolbar; cropped-away parts are kept and can be re-adjusted later; for media inside frames/grids, double-click to adjust — [Canva Help: Resize and crop elements precisely](https://www.canva.com/help/resize-and-crop/)
- Smart Crop auto-crops to the most interesting region, also inside frames and grids — [Canva Help: Instantly crop photos](https://www.canva.com/help/crop-photos-instantly/)
- Straighten: drag the rotate anchor beneath the photo (snaps every 45 degrees); suggested trick is adding a ruler element to line up a horizon; images inside frames/grids rotate via a Rotate slider in Crop mode — [Canva: Photo straightener](https://www.canva.com/features/photo-straightener/), [Canva Help: Flip and rotate elements](https://www.canva.com/help/flip-and-rotate/)
- Flip horizontal/vertical; not for text, charts, empty grids, frames, shapes, grouped elements — [Canva Help: Flip and rotate elements](https://www.canva.com/help/flip-and-rotate/)
- Masking is done by frames (crop a photo/video into a shape) and grids (several slots, adjustable spacing, corner-drag resizing); no layer-mask or brush-mask editor is documented — [Canva Design School: Exploring the element library](https://www.canva.com/design-school/resources/using-and-editing-elements/), [Canva Learn: Using grids](https://www.canva.com/learn/use-grids-canva/)

#### Mockups
- Canva Mockups is the former Smartmockups, which joined Canva in February 2021 with Kaleido; one release cites 6,000+ mockup types, a later one 2,000+ templates for Free and 8,000+ for Pro/Teams — [Canva newsroom: Kaleido and Smartmockups](https://www.canva.com/newsroom/news/kaleido-smartmockups/), [Canva newsroom: Smartmockups tool](https://www.canva.com/newsroom/news/canva-launches-smartmockups-tool/)
- Custom mockup templates can be made from your own photo (Canva finds placement surfaces); that step is Pro; premium stock photos cannot be used; flat, simple photos work best — [Canva Help: Create mockups](https://www.canva.com/help/mockup-design/)

#### PDF editing
- PDF import: up to 500 pages and 300 MB, up to 1,400 elements and images; scanned PDFs arrive as one flattened image; unsupported fonts are substituted; layouts may shift; a different Help page says pages import as individual images in an A4 design (conflict); Magic Layers does not accept PDFs — [Canva Help: Import and edit PDFs](https://www.canva.com/help/import-and-edit-pdfs-canva/), [Canva Help: Upload formats and requirements](https://www.canva.com/help/upload-formats-requirements/)

#### Transparent PNG, compression, export limits
- File types: JPG (small, photos), PNG (supports transparency), SVG (scalable), PDF Standard/Print, MP4, GIF — [Canva Help: Choose the right download file type](https://www.canva.com/help/download-file-types/)
- Transparent PNG: choose PNG (or WebP), toggle Transparent background; first set the page background to white or delete it; **paid only** (Pro, Teams, Business, Education, Nonprofits) — [Canva Help: Download design with transparent background](https://www.canva.com/help/transparent-background/)
- JPG/PNG "Limit size" (KB) and PDF compression are paid features; the file-size limit works for single-page downloads only — [Canva Help: Choose the right download file type](https://www.canva.com/help/download-file-types/)
- Design dimensions 40 x 40 px to 8000 x 3125 px (8000 x 3125 = 25.0 megapixels by my arithmetic, which suggests a 25 MP area cap; unverified); PNG download can scale 0.5x to 3.125x; one summary lists a 1,000,000 KB JPG/PNG file-size ceiling — [Canva Help: Resize designs and size limits](https://www.canva.com/help/resize/), [Canva Help: Choose the right download file type](https://www.canva.com/help/download-file-types/)
- Image upload: JPEG, PNG, HEIC/HEIF, static WebP; under 50 MB; capped at 250 million total pixels; no RAW formats appear in the supported list — [Canva Help: Upload formats and requirements](https://www.canva.com/help/upload-formats-requirements/)

#### Colour extraction
- Colour palette generator builds a palette (with hex codes) from an uploaded photo and can download it to a Brand Kit — [Canva: Colour palette generator](https://www.canva.com/colors/color-palette-generator/)
- Brand Kit palette limits: Free 1 palette of up to 3 colours; Pro, Teams, Business, Education, Enterprise and Nonprofits up to 100 palettes of up to 100 colours — [Canva Help: Brand Kit colour palettes](https://www.canva.com/help/color-palettes/)

#### Affinity, Canva's pro photo path (separate app)
- On 2025-10-30 Canva merged Affinity Photo, Designer and Publisher into one app with Pixel, Vector and Layout studios, free for Mac and Windows (iPad version still to come at the time); a Canva account is needed to download but not to stay signed in; Canva AI features inside it (Generative Fill, Expand & Edit, Remove Background) require a paid Canva plan; one commentator reads the terms as letting Canva change or disable access later — [Canva newsroom: all-new Affinity](https://www.canva.com/newsroom/news/all-new-affinity/), [PetaPixel, 2025-10-30](https://petapixel.com/2025/10/30/all-new-all-in-one-affinity-app-for-creative-pros-is-available-now-for-free), [ProVideo Coalition](https://www.provideocoalition.com/affinity-new-version-is-free-forever-for-everyone/)
- Affinity 3.2 added RAW masks (object, hue range, luminosity, compound) and Capture One integration; Affinity 3.3 (2026-09-15) improved RAW exposure/shadow/highlight processing, made Curves hue-preserving, added separate saturation and hue curves and global presets for batch editing — [PetaPixel, 2026-09-15](https://petapixel.com/2026/09/15/affinity-3-3-powers-up-the-free-apps-raw-photo-processing/)
- ProSuite announcement lists a noise-reduction tool, wavelet denoise, batch imports and reusable looks — [Canva newsroom: Canva ProSuite](https://www.canva.com/newsroom/news/canva-prosuite-launch/)
- Affinity assets can be moved into Canva for collaboration and publishing — [BestMediaInfo, 2025-10-31](https://bestmediainfo.com/mediainfo/mediainfo-digital/canva-launches-creative-operating-system-with-design-ai-video-20-and-all-new-affinity-10608968)

### Inferences
- Per the brief, Craftly already has crop, filters, adjustments, duotone, shadow, blur, corner radius and borders. Canva items not in that list: straighten with snapping, Smart Crop, Auto Focus (sharpen), Face Retouch, brush-limited blur, frames/grids as masks, transparent-PNG toggle, 0.5x-3.125x export scaling, KB-targeted export, palette-from-photo, PDF import, mockups, background remover and Magic Eraser. (Whether Craftly has flip, frames or export scaling was not in the brief.)
- Canva's confirmed Adjust set is only four sliders plus Auto-adjust; treat longer slider lists as unverified until checked in the live editor.
- Canva's own photo tooling stays parametric and non-pixel, with depth (RAW, curves, layers, masks, denoise) provided by Affinity, so the lack of pixel layers in Craftly mirrors a deliberate product split at Canva rather than a missing basic.

### Gaps
- The "New Canva Photo Editor" Help page, the date it launched, and its full tool list were not read; the July 2026 and December "What's New" posts were not read.
- Exact Adjust slider list (highlights, shadows, temperature, vignette, sharpen/clarity) unconfirmed.
- Retouch and Auto Focus parameters/steps unread; whether Face Retouch is classed as AI by Canva is unknown.
- Maximum export dimensions: the 8000 x 3125 figure and the 250-million-pixel upload figure look inconsistent in scale; confirm in the product.
- In-editor "photo colours" auto-extraction from a selected image was not verified.
- Whether Affinity's iPad version has shipped by November 2026 is unknown.

## 3. What Canva deliberately does not do, and what users and reviewers complain about (vs CapCut, Premiere, Photoshop)

### Takeaway
Canva keeps its editor design-first (a competitor review describes its video editing as slide-based) and sends pro work to separately branded apps (Affinity for pixel/vector/layout, Cavalry for motion), so chroma key, strong keyframing, real colour grading, pixel layers, curves and RAW are not part of the Canva editor as far as any source shows. Complaints concentrate on the Video 2.0 beta (bugs, lost page duplication, reorder/corruption reports) and on instability or limits for long, high-fps or heavy projects.

### Cited Findings

#### Video gaps reported by reviewers
- FluxNote (competitor, 2026-07-26): no chroma key; no curves/wheels/scopes colour grading; only basic filter-style grading; transitions limited to fade/slide/dissolve; no codec/container/bitrate control; CapCut's free tier offers green screen, keyframes, speed curves and a richer effects set; AI clips max out at 8 s; calls the product a design tool with video added on — [FluxNote](https://fluxnote.io/guides/canva-video-editor-review)
- BityClips (2026-05-31, referral-linked): keyframe controls limited, colour grading basic, no timeline effects layering, 10+ minute projects unwieldy, social videos up to about 3 minutes work well; recommends Premiere Pro, DaVinci Resolve or CapCut Desktop for long or complex work; says CapCut's short-form effects and free tier are stronger — [BityClips](https://bityclips.com/blog/canva-video-review-2026)
- KeepCanva (2025-11-21, opinion): Video 2.0 beta removed page duplication, elements misalign, older projects reported rearranged or corrupted, audio editing harder, editing slower, disabling the beta does not restore the old editor, support bot gave generic answers; the author's claims of mass user backlash are unsupported — [KeepCanva](https://www.keepcanva.com/2025/11/the-new-canva-video-editor-beta-is-a-complete-mess.html)
- Web Education Services (2025-11-06, promotional): switching between editors can reset clip order, so save versions; beta text-to-video output is short looping B-roll — [Web Education Services](https://www.webeducationservices.com/canva-video-editor-2-0-beta)
- Comparison blogs say CapCut wins on auto-captions, timeline precision and native TikTok export (search summary of a comparison page; weak source) — [tlinky: CapCut vs Canva 2026](https://tlinky.com/capcut-vs-canva/)
- A TechRadar review of an earlier Canva Video version reportedly found the only way to apply some effects was exporting and re-importing (older version; page body not retrievable) — [TechRadar: Canva Video review](https://www.techradar.com/reviews/canva-video)

#### Limits Canva itself documents
- Trim tool removed and Auto-trim unavailable in video designs — [Canva Help: Trim videos](https://www.canva.com/help/trim-videos/)
- Transitions not allowed between upper-track clips or in page mode — [Canva Help: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/)
- Effects panel does not apply to plain videos, and some effects do not survive video export — [Canva Help: Apply visual effects and quick styles](https://www.canva.com/help/effects-quick-styles/)
- Editor playback supports up to 1080p; downloads fail more often with 60 fps+, 10+ minute videos, 10+ pages, embedded YouTube — [Canva Help: My video won't play back](https://www.canva.com/help/my-video-wont-playback/), [Canva Help: I can't download my design or video](https://www.canva.com/help/cant-download-design-or-video/)

#### Photo-side absences
- No source documents curves, levels, HSL, pixel layers, healing/clone or RAW in the Canva editor; the Help tool lists show Adjust sliders, Filters, Blur brush, Auto Focus, Face Retouch and Shadows only, and the upload-format list has no RAW (absence is inferred, not stated by Canva) — [Canva Help: Edit photos with Canva photo editor](https://www.canva.com/help/image-editor/), [Canva Help: Upload formats and requirements](https://www.canva.com/help/upload-formats-requirements/)
- General Canva-vs-Photoshop comparisons say Photoshop leads on curves, selective colour correction, layer and mask depth and Select-and-Mask edge control, while Canva suits quick template-led work; none tests Canva's curves directly and several are low quality — [Aiarty](https://www.aiarty.com/knowledge-base/canva-vs-photoshop.htm), [Style Factory Productions](https://www.stylefactoryproductions.com/blog/canva-vs-photoshop), [Techjockey](https://www.techjockey.com/blog/canva-vs-photoshop)
- Affinity (free) supplies RAW development, hue-preserving curves, saturation/hue curves, RAW masks, denoise, layers — see section 2 — [PetaPixel, 2026-09-15](https://petapixel.com/2026/09/15/affinity-3-3-powers-up-the-free-apps-raw-photo-processing/)

#### Canva's stated direction for pro tools
- Canva Create 2026 (2026-04-16, Los Angeles) launch post: Canva Offline, Pro Design, Learn Grid, Print Shop; Cavalry free for all creatives; Brand System inside Affinity publishing to the Canva Brand Kit; Capture One and DaVinci Resolve now read Affinity's .af files; Affinity's AI Scene Decomposition splits a flat image into layers — [Canva newsroom: Create 2026 launches](https://www.canva.com/newsroom/news/canva-create-2026-launches/)
- ProSuite bundles Affinity, Cavalry, Flourish and Leonardo for Business/Enterprise; Affinity and Cavalry are free for individuals — [Canva newsroom: Canva ProSuite](https://www.canva.com/newsroom/news/canva-prosuite-launch/), [Canva newsroom: Cavalry](https://www.canva.com/newsroom/news/cavalry/)
- Canva AI 2.0 launched as a research preview on 2026-04-16 to the first 1 million users (AI pointer) — [SiliconANGLE, 2026-04-16](https://siliconangle.com/?p=739587)

### Inferences
- Canva's own reviews and Help text show the video editor is intentionally shallow (no chroma key, thin keyframes, basic grading), so "Craftly has no video timeline" is a real gap, while "Craftly has no chroma key/colour grading" is a gap Canva shares.
- Canva's pro photo path is a different product (Affinity); the Canva editor's photo depth is probably closer to Craftly's current adjustments than to Photoshop. Pixel layers, RAW and curves are therefore the part of the gap Canva itself does not close in-app.
- Most video criticism is from sources with a stake (FluxNote, BityClips) or from beta-era opinion posts; independent hands-on tests of the 2026 timeline are scarce.

### Gaps
- No Reddit, Trustpilot or G2 data was retrieved (search budget exhausted), so frequency of complaints is unknown.
- No independent outlet's 2026 hands-on review of the new timeline was readable (TechRadar page body truncated; Medium review returned 403).
- Whether Video 2.0 fixed the 2025 beta bugs by November 2026 is unknown.
- What "Pro Design" and "Canva Offline" contain (relevant to a local-first comparison) was not read beyond headlines.

## 4. Pro / Teams (paid-plan) gating

### Takeaway
Core timeline operations and 1080p/30-minute MP4 export are Free; 4K and 2-hour MP4, Beat Sync, video and image background removal, Magic Switch resize, transparent PNG, file-size limiting, popular music and the premium library are paid. Teams appears to have been replaced by Business, a cheaper Pro Lite tier exists in 11 countries, and third-party price figures conflict.

### Cited Findings
- Free: MP4 up to 30 min at 1080p, GIF up to 1 min, default-quality download — [Canva Help: Downloading designs as video or GIF](https://www.canva.com/help/download-as-video/)
- Paid (Pro, Teams, Nonprofits, Education): MP4 up to 2 h at 4K (desktop), GIF up to 2 min — [Canva Help: Downloading designs as video or GIF](https://www.canva.com/help/download-as-video/)
- Beat Sync is Pro; manual beat markers are free — [Canva: CapCut alternative](https://www.canva.com/create/capcut-alternative/)
- Video Background Remover is Pro — [Canva Pro: Video Background Remover](https://www.canva.com/pro/video-background-remover/)
- Image Background Remover: Help says paid plans, marketing mentions a limited free allowance, a Learn page says 500 per 24 h (conflict) — [Canva Help: Remove photo and video backgrounds](https://www.canva.com/help/background-remover/), [Canva Learn: Background remover](https://www.canva.com/learn/background-remover/)
- Magic Switch (resize) is Pro; Resize is available to Pro, Business, Enterprise, Education, Higher education, Nonprofits, Teams — [Canva: Video Resizer](https://www.canva.com/features/video-resize/), [Canva Help: Resize designs and size limits](https://www.canva.com/help/resize/)
- Magic Grab is listed among the Pro tools for every task — [Canva Pro](https://www.canva.com/pro/)
- Transparent-background download: Pro, Teams, Business, Education, Nonprofits — [Canva Help: Download design with transparent background](https://www.canva.com/help/transparent-background/)
- Limit file size (KB) and Compress PDF: paid (Compress PDF: Pro, Teams, Education, Nonprofits) — [Canva Help: Choose the right download file type](https://www.canva.com/help/download-file-types/)
- Popular music: Pro or Education; premium audio licences otherwise bought per design — [Canva Help: Add popular music](https://www.canva.com/help/adding-popular-music-to-designs/)
- Premium stock library: Pro (75M+ assets) — [Canva Pro: Premium content](https://www.canva.com/pro/premium-content/)
- Caption translation (Translate) is Pro; style-pack caption generation plan not confirmed — [Canva Help: Generate and animate captions](https://www.canva.com/help/generate-edit-captions-on-videos/)
- Custom mockup template creation is Pro; Free gets 2,000+ mockup templates versus 8,000+ for Pro/Teams — [Canva Help: Create mockups](https://www.canva.com/help/mockup-design/), [Canva newsroom: Smartmockups tool](https://www.canva.com/newsroom/news/canva-launches-smartmockups-tool/)
- Brand Kit palettes: Free 1 palette x 3 colours; paid 100 x 100 — [Canva Help: Brand Kit colour palettes](https://www.canva.com/help/color-palettes/)
- Storage: Free 5 GB, Pro 100 GB or 1 TB (sources conflict), Business 500 GB per team, Enterprise 1-5 TB per team — [Canva: Upload video](https://www.canva.com/features/upload-video/), [BityClips](https://bityclips.com/blog/canva-video-review-2026)
- Canva Pro Lite: only for Free accounts in Argentina, Chile, Colombia, Costa Rica, Ecuador, Guatemala, India, Indonesia, Mexico, Panama, Peru; includes premium templates/images/fonts/videos/audio, CMYK export, Background Remover, Magic Resize, Magic Eraser, Magic Grab; 3 Brand Kits and 50 GB; AI draws on the Free allowance and excludes Canva AI conversational design — [Canva Help: About Canva Pro Lite](https://www.canva.com/help/pro-lite/)
- Canva's upgrade page is titled "Upgrade to Canva Pro or Canva Business" (no Teams); a search summary of 2026 pricing roundups says Teams was rebranded to Business and closed to new sign-ups (the specific guide was not identified; Miracamp is one roundup returned) — [Canva Help: Upgrade to Canva Pro or Canva Business](https://www.canva.com/help/upgrade-to-canva-pro-or-business/), [Miracamp: Canva pricing 2026](https://www.miracamp.com/learn/canva/pricing-plans)
- Price figures conflict: Pro US$12.99/month and Teams from US$10/user/month (min 3) in a 2026-05-31 blog ([BityClips](https://bityclips.com/blog/canva-video-review-2026)); Pro US$14.99/month in a 2026-07-26 review ([FluxNote](https://fluxnote.io/guides/canva-video-editor-review)); a search summary of the most recent pricing roundup (stated as checked on 2026-09-08; the specific URL was not identified) gave Pro US$18/month or US$180/year and Business US$25/month or US$250/year per person, while other guides gave Business US$20/month (roundups returned included [Miracamp](https://www.miracamp.com/learn/canva/pricing-plans) and [Designrr](https://designrr.io/canva-pricing/))
- AI usage allowances are governed separately — [Canva Help: Understanding your AI usage](https://www.canva.com/help/ai-access/)
- Affinity is free; its Canva AI features need a paid Canva plan — [Canva newsroom: all-new Affinity](https://www.canva.com/newsroom/news/all-new-affinity/)

### Inferences
- The gating pattern is: depth and scale (4K/2 h, library, brand, background removal) behind payment, basic editing free. A local-first tool without libraries has no equivalent paywall, so gating mainly tells which Canva features are costly to Canva (server-side processing and licensed assets).
- Because prices and plan names moved during 2026, planning documents should cite plan category (Free vs paid) rather than dollar amounts.

### Gaps
- Canva's own pricing page could not be read (HTTP 403), so current prices, the exact Teams/Business status, and per-plan feature tables are unverified; the Sept-2026 price source could not be tied to a specific URL.
- Caption generation gating and the Free allowance for Background Remover and Magic Eraser remain unresolved.

## 5. Share of Canva users who use video

### Takeaway
Canva has not published a share-of-users figure for video that I could find; the closest official data are 260M monthly users and an old 2021 count of 480M video publishes. A 12%-of-designs figure circulates on aggregator blogs but has no traceable primary source.

### Cited Findings
- Canva reported 260 million people using it monthly and USD 3.5 billion revenue in its 2025 review; the same 260M MAU figure appears in press coverage of the 2025-10-30 launch — [Canva newsroom: 2025 in review](https://www.canva.com/newsroom/news/canva-2025-wrap/), [BestMediaInfo, 2025-10-31](https://bestmediainfo.com/mediainfo/mediainfo-digital/canva-launches-creative-operating-system-with-design-ai-video-20-and-all-new-affinity-10608968)
- 480 million video publishes in 2021 (Canva's 2021 numbers post, per search summary) — [Canva newsroom: 2021 by the numbers](https://www.canva.com/newsroom/news/canva-in-numbers-2021/)
- 6 billion+ new designs created in 2023 across all formats, not video-specific — [Canva newsroom: 2023 wrap](https://www.canva.com/newsroom/news/canva-2023-wrap/)
- Earlier milestones: 75M MAU in 2021, 135M in 2023 — [Canva newsroom: 10-year timeline](https://www.canva.com/newsroom/news/canva-10-year-timeline/)
- Canva's 2024 review exists but no video figure was surfaced — [Canva newsroom: 2024 wrap](https://www.canva.com/newsroom/news/canva-2024-wrap/)

### Inferences
- With no official video share, the usable proxies are scale (260M MAU), the 2021 video-publish count, and Canva's investment signal (a rebuilt timeline in Oct 2025, Edit as Video in Feb 2026, mobile timeline, AI video models). Video is clearly strategic but its user share is unpublished.

### Gaps
- Unverified, secondary: aggregator blogs claim video is about 12% of all Canva designs (up from 6% in 2023) with 120% year-over-year growth, and ~1 billion videos since 2021. No primary source could be traced, and the 2021 and cumulative figures do not reconcile. Candidate roundup pages that appeared in the search: [The Social Shepherd](https://thesocialshepherd.com/blog/canva-statistics), [Expanded Ramblings](https://expandedramblings.com/index.php/canva-statistics-and-facts). Treat as low confidence.
- No Canva-published percentage of users who edit video, per-format design counts for 2024-2026, or video-export counts were found.
