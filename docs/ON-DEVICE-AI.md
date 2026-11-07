# On-device image tools

Status: phases 1 to 4 are built and work with the real models on a real GPU: the shared runtime and the background remover (phase 1), the upscaler (phase 2), Blur background (phase 3) and Colour pop (phase 4), which need no model of their own: they use the remover's. The first background model, BiRefNet lite, did not run on this machine's graphics card and was replaced by ISNet general-use; see "Why ISNet and not BiRefNet". The upscaler is described in "The upscaler", the blur in "Blur background", the colour pop in "Colour pop". "What was measured" lists what has and has not been shown. The reasoning behind the choices is in [the Canva comparison](../reports/Craftly%20versus%20Canva%20feature%20gaps.md); this file describes what was built and why.

## Goal

Photo tools that use small neural networks, and run them **on the user's own device**: no server, no account, no upload. The first tool is **Remove background**, the second **Upscale**, the third **Blur background** and the fourth **Colour pop**, which use the first one's model. The magic eraser and click-to-select follow the same pattern (see "Later").

Non-goals for phase 1: cloud AI, a WebAssembly (CPU) fallback, a brush to refine the cutout, resumable downloads, video.

## How it works

```
Edit image panel > Tools > Remove background
        |
        v
 service.ts  -- model missing? --> consent prompt --> download.ts --> modelStore.ts (IndexedDB)
        |
        v   photo drawn at 1024 x 1024 (RGBA)
 client.ts  --postMessage-->  worker.ts / engine.ts  (onnxruntime-web, WebGPU)
        |                             |
        |  <-- 1024 x 1024 mask ------+
        v
 compose.ts: photo x mask at the photo's own size  -->  PNG with alpha  -->  new asset
        |
        v
 the image element now points at the new asset, `originalSrc` keeps the old one ("Restore original")
```

The upscaler follows the same path with a loop in the middle:

```
Edit image panel > Tools > Upscale (2x or 4x)
        |
        v
 service.ts  -- model missing? --> consent prompt --> download.ts --> modelStore.ts (IndexedDB)
        |
        v   the photo's own pixels (compose.ts readPixels); transparent pixels take the colour of the nearest solid one (tiles.ts)
 tiles.ts planTiles: equal tiles whose window (the part a tile keeps plus 16 pixels of the picture around it) is at most 256 x 256
        |
        |   for each tile, one at a time (progress, time left, Cancel):
        |      extractTile --> client.ts --postMessage--> engine.ts (the model makes it four times larger) --> keepTile
        |                                       (the context is cut away; 2 x 2 pixels are averaged for 2x) --> canvas.put
        v
 compose.ts createResultCanvas().finish(): through the photo's own opacity, if it had any --> PNG, or JPEG for a JPEG photo --> new asset
        |
        v
 the image element keeps its box; naturalWidth and naturalHeight are the new size; originalSrc keeps the old picture
```

The blur follows the cut-out's path as far as the mask, then works on the photo's pixels:

```
Edit image panel > Tools > Blur background (light, medium or strong)
        |
        v
 service.ts  -- the mask of this very picture was kept from a moment ago? --> use it
        |       otherwise: model missing? --> consent prompt --> download ... --> client.ts --> engine.ts --> 1024 x 1024 mask
        v
 compose.ts readPixels: the photo's pixels, at most 25 megapixels
        |
        |   in pieces of about 262,000 pixels (Cancel is looked at between pieces, the screen gets a turn now and then):
        |      blur.ts addRows (colour x weight of the background pixels, summed into cells of a coarser grid)
        |      blur.ts solve   (three box blurs of the sums, then colour = sum / weight)
        |      blur.ts paintRows (photo x mask + blurred background x (1 - mask)) --> canvas.put
        v
 compose.ts createResultCanvas().finish(): PNG, or JPEG for a JPEG photo without transparency --> new asset
        |
        v
 the image element keeps its box; naturalWidth and naturalHeight are the new size; originalSrc keeps the old picture
```

Colour pop takes the blur's path and changes what is done to the pixels:

```
Edit image panel > Tools > Colour pop (black and white, or faded)
        |
        v   the mask: kept from a moment ago, or from the model (as for the blur)
 compose.ts readPixels: the photo's pixels, at most 25 megapixels
        |
        |   in pieces of about 262,000 pixels, as for the blur:
        |      colourPop.ts paintRows (each background pixel goes toward its grey by (1 - coverage) x the style's amount;
        |                              counts the pixels that changed so that it can be seen) --> canvas.put
        v
 fewer than 0.1 % of the pixels changed? --> nothing is saved: "no colour to take out"
        |
        v
 compose.ts createResultCanvas().finish() --> new asset --> the image element, as for the blur
```

## Decisions

These are calls made while building, not agreements. Each is easy to change.

| Decision | Choice | Why |
| --- | --- | --- |
| Runtime | `onnxruntime-web` 1.31.1 (MIT), exact version, WebGPU build | Full control of the download, cache and pre/post-processing. Transformers.js 4.3.2 pulls a development build of the same runtime plus `sharp` and `onnxruntime-node`. |
| Where inference runs | One module Web Worker, ended after 5 idle minutes | The editor stays responsive; GPU memory is released when the tool is not in use. |
| Background remover model | ISNet general-use, fp16 (Apache-2.0) | Plain convolutions: runs on any graphics card with half-precision shaders. The first choice, BiRefNet lite, did not (see below). |
| CPU fallback | None | The background model's half-precision file cannot run on the CPU provider, and the upscaler's full-precision one would be far slower there (no threads without cross-origin isolation). Without WebGPU (and, for the background model, its half-precision feature) a tool says so and offers nothing to download. |
| Where weights come from | Hugging Face, pinned to a commit, size and SHA-256 checked | Nothing is bundled (88 MB would be seventeen times the app). `VITE_CRAFTLY_MODEL_BASE` points the app at your own host instead, and "Add from a file" (File > On-device models) works offline. |
| When it downloads | Only after the user clicks the tool and accepts a prompt that names the host and size | Apart from loading itself and the image addresses an SVG export fetches, the app makes no other network request; this stays an explicit choice. |
| Where weights are stored | Their own IndexedDB (`craftly-models`), `navigator.storage.persist()` requested | A separate database cannot disturb designs or uploads. |
| Result | A new PNG asset; the element keeps its box, crop and filters; `originalSrc` remembers the old picture | Works with every exporter unchanged. A mask applied at paint time would need new paths in the SVG, PDF and animation exporters. |
| Output size | At most 25 megapixels (Canva's own upload limit) | A larger PNG with alpha is too heavy to store and export. |
| Where it lives in the UI | A "Tools" tab in the Edit image panel, and "On-device models" in the File menu | Canva puts its photo tools in the same panel. |
| Upscaler model | Real-ESRGAN general x4 v3, full precision (BSD-3-Clause), 4.9 MB | The small upscaler of the Real-ESRGAN project (1.2 million weights), made for photographs that are noisy, blurred or compressed. It needs WebGPU but not half-precision shaders. See "The upscaler". |
| Factors | 2x and 4x | The network makes everything four times larger; 2x averages 2 x 2 pixels of that. |
| Tiles | Equal tiles in windows of at most 256 x 256 pixels, their 16 pixels of context on every side included (a tile keeps at most 224 x 224) | A whole photo would not fit in graphics memory, and a tile is the unit of progress and of Cancel. 16 pixels leave no difference above 4 levels of 255 (table below). |
| Transparency | The model sees the colours of the nearest solid pixels; the opacity is put back at the end | A network that sees black around an object draws a dark fringe along its edge. |
| File of the result | JPEG (quality 0.95) when the photo was a JPEG and has no transparency, otherwise PNG | A lossless file of a four times larger photograph is several times the size. |
| Blur background | The remover's model finds the subject; the blur is arithmetic in the page (`blur.ts`), not a second model | A blur needs no network, so the tool costs no download, and the arithmetic can be pinned by tests with numbers worked out by hand. |
| What is blurred | Only the pixels behind the subject: a weighted average, weight 1 behind it and 0 on it | A blur of the whole picture draws a halo of the subject's colours around its outline. |
| Strengths | Light, medium, strong: 0.5, 1.2 and 2.5 % of the longer side as a standard deviation, at least 2 pixels | The same look at any resolution; three choices need no preview. |
| The mask is kept | The last mask stays in memory, for the picture and the model | Undo and another strength must not cost another 5 seconds. |
| Colour pop | The remover's model finds the subject; the colour goes out of the background by arithmetic (`colourPop.ts`), not by a second model | Nothing to download, and the arithmetic can be pinned by tests with numbers worked out by hand. |
| The grey | The weights of the CSS `grayscale()` filter: 0.2126, 0.7152, 0.0722 | It is the grey of the Filters panel's own black and white. |
| Styles | Black and white (all the colour of the background) and Faded (60 % of it) | Two choices need no preview, and a second try is quick because the mask is kept. |
| What the background jobs share | `coverage.ts` (the mask stretched over the picture, the checks of the buffers) and, in `service.ts`, `locateSubject`, `pieceRunner` and `paintAndApply` | Remove background, Blur background and Colour pop start the same way, and the last two finish the same way. |
| One job at a time | The four tools share it | One graphics card, one worker, and one photo at a time to reason about; Cancel in the Tools tab is for the job that runs. |

## Why ISNet and not BiRefNet

The report picked BiRefNet lite (MIT, 114.5 MB). It downloads and verifies correctly, and the session is created, but the first run fails on this machine's graphics card (an integrated Intel Gen-12LP, a typical laptop GPU):

```
webgpu/shader_helper.cc: numbers_storage_buffers_ <= limits_.maxStorageBuffersPerShaderStage was false.
Too many storage buffers in shader. Current: 17, Max is 16
```

The model's graph has 16,446 nodes, among them a `Concat` that joins **1,024** tensors, two more with 256 and 64, and about fifty `Split` nodes with 32 outputs (they unfold the image into patches). A GPU shader can bind a limited number of buffers; this adapter allows 16, which is also the usual limit on integrated graphics. What was tried, with the real model on the real GPU:

| Attempt | Result |
| --- | --- |
| Default session | the error above |
| Request a device with the adapter's full limits | the same error: 16 is the adapter's own maximum |
| Graph optimisation `basic`, `extended` and `disabled` | the same error: the node is in the original graph, not made by a fusion |
| Run the 54 widest nodes (50 `Split`, 4 `Concat`) on the CPU | gets past the error, then `std::bad_alloc`: the 1,024-way patch join runs out of WebAssembly memory |

Not tried: rewriting the graph in memory so that no node joins more than a handful of tensors (a project of its own, with no promise that memory then suffices), and the 224 MB fp32 export (same graph). ISNet general-use is a U-Net made of convolutions; the largest join in its graph has two inputs. It runs on this card in about 5 seconds per photo.

Trade-offs to know: ISNet's edges are softer than BiRefNet's on hair and fur, and it keeps a contact shadow as part of the subject (visible in the test photo). Its half-precision build needs the GPU's `shader-f16` feature, which the support check tests for. BiRefNet could come back as an optional high-quality model on big GPUs once there is an export without the wide nodes.

## The upscaler

### Which file

The report picked Real-ESRGAN General x4v3 (Qualcomm's card) and warned that it "needs your own browser export and tiling". Qualcomm's Hugging Face repository holds no ONNX file (a licence, a readme and a list of release assets), and the 64 MB files that turn up first in a search are the larger x4plus network. Of the community exports of `realesr-general-x4v3` found on 2026-11-06, the one chosen is [skillsafe-ai/realesr-general-x4v3](https://huggingface.co/skillsafe-ai/realesr-general-x4v3) at commit `042a40bc`, because it says where it comes from: the official `realesr-general-x4v3.pth` of release v0.2.5.0 (SHA-256 `8dc7edb9...6292`), the recipe and toolchain that made it, a comparison with PyTorch (largest difference 4.4e-6 in full precision), and a reference input and output to check a copy of the file against. The other exports (`vlad-grig`, `Saimon8420`, `CoderViking`) look as good but say less; `Tomoali`'s are fixed-size or bfloat16 files and `techycoder`'s is the denoise-strength variant. It is a stranger's conversion, like ISNet's: the pinned hash proves it is the file that was tested, not more.

The file is full precision (4.9 MB). The same repository has a half-precision one (2.4 MB). It needs the graphics card's `shader-f16` feature and ran about 1.5 times as fast here (below), which is not worth a second registry entry, a second code path and fewer graphics cards that can use the tool.

### What was checked on a real graphics card

`e2e/ml-probe.cjs` on the machine of phase 1 (Chrome, integrated Intel Gen-12LP, WebGPU, ONNX Runtime Web 1.31.1):

| Check | Result |
| --- | --- |
| The graph's widest node | 4 buffers (a convolution): far from the limit of 16 that stopped BiRefNet |
| The authors' reference input (64 x 64) | The answer (256 x 256) differs from their reference output by 4.3e-6 at most and 5.3e-7 on average, so the graphics card computes what PyTorch computed |
| Creating the session | 1.4 to 1.8 s |
| One tile, full precision | 64 x 64: 135 ms; 128: 0.5 s; 192: 1.19 s; 256: 2.09 s; 384: 4.3 s; 512: 7.5 s. About 30 microseconds a pixel whatever the size |
| One tile, half precision | 128: 0.3 s; 256: 1.34 s. About 20 microseconds a pixel |

### Tiles and context

A whole photograph does not go through the network at once: it would not fit in graphics memory, and a tile is a good unit for a progress bar and for Cancel. The photo is cut into equal tiles, each in a window of at most 256 x 256 pixels (not full tiles and a sliver, so no run is mostly wasted): the part a tile keeps is at most 224 x 224, and the window adds 16 pixels of the picture around it, mirrored where the photo ends. Each of the network's 34 convolutions looks one pixel further, so a pixel depends on its 34 neighbours on every side; with fewer pixels of context the tiles differ a little from what one piece of the picture would give. Measured with the real model on a 480 x 360 picture, 6 tiles, against one run with 48 pixels of mirrored surroundings:

| Context (pixels) | Largest difference (of 255) | Average | Time of the tiles |
| --- | --- | --- | --- |
| 0 | 57 | 0.224 | 4.2 s |
| 4 | 31 | 0.133 | 4.8 s |
| 8 | 16 | 0.073 | 4.7 s |
| **16** | **4** | **0.020** | **5.5 s** |
| 24 | 1 | 0.003 | 6.3 s |
| 34 | 0 | 0 | 7.6 s |

16 is the choice: the largest difference of 4 levels of 255 is below what an eye can see, and 24 would cost 15 % more time for the last three levels. At 34 the tiles give exactly what one piece gives, as the arithmetic says.

### Transparency

The network reads colours only. A transparent pixel is stored as black (or white, or anything), and a network that sees black around an object draws a dark fringe along its edge. So before the tiles are cut, every pixel that is mostly transparent takes the colour of the nearest solid pixel (`bleedColours`, nearest first, 48 pixels far; what is further gets the average colour). The opacity is not enlarged by the network: it is kept as it was, drawn through at the end with the browser's own scaling (`destination-in`), the way the cut-out job does it. With the real model, a 160 x 160 orange disc on nothing at all became 320 x 320 with 1,952 soft edge pixels, none of them off-colour.

### The result

- **Factors.** The network makes everything four times larger. 2x averages 2 x 2 pixels of that, which is what the Real-ESRGAN project does when it resizes the 4x result for `--outscale 2`. The work per photo is the same for both, so 2x is cheaper only in the size of the file.
- **File.** A JPEG photograph without transparency becomes a JPEG (quality 0.95), anything else a PNG: a lossless file of a four times larger photograph is several times the size.
- **Size.** At most 25 megapixels and 16,384 pixels a side, the same limits as the cut-out. The tool checks the photo's recorded size before anything is downloaded and the pixels it read again afterwards; a 2x result of a 6.25-megapixel photo and a 4x result of a 1.5-megapixel one are the largest there are.
- **Time.** Roughly 30 to 40 seconds per megapixel of the original on this graphics card (the tiles' context costs about a third on top of the pixels themselves). The Tools tab shows a bar, the share done and, once the third tile is done, the time left (the first tile also starts the engine and builds the session, so the pace is taken from the tiles after it).
- **The picture on the page** keeps its size, crop, filters and mask: only `naturalWidth` and `naturalHeight` change, and the picture behind it has more pixels. Exports use them at once.

### What the model does and does not do

On a 240 x 180 picture of a mug, softened the way a small photograph is, the 2x result had edges 7.4 times as sharp as a plain stretch of the original by the energy of the differences between neighbouring pixels, and its colours were within 3.3 levels of 255 of the stretch on average. It also draws a faint light halo along very soft synthetic edges: the network was trained to undo blur, noise and compression of real photographs, and it overshoots on the rest. It draws plausible detail where there was none; it can redraw small text and faces convincingly but not faithfully.

## Blur background

### What it does

Keeps the subject of a photo as it is and blurs everything behind it, like the "auto focus" of other editors. It uses the remover's model for the mask, so there is nothing more to download, and does the blur itself, in plain code in the page: a blur is arithmetic, and a model is not needed for it. The result is a new picture as large as the photo (or the 25-megapixel budget, whichever is smaller), the element keeps its box, `originalSrc` keeps the old picture, and applying it is one undo step.

### Only the background is averaged

A plain blur of the whole picture pulls the subject's colours into the background around its outline: a halo of the subject. Here every pixel gets a weight, 1 well behind the subject and 0 on it (`1 - 2 x coverage`, so a pixel that is mostly subject weighs nothing), and the blurred colour is the sum of colour x weight over the sum of the weights: a weighted average ("normalised convolution"). A background of one plain colour therefore stays exactly that colour right up to the outline (tested pixel for pixel), and no colour in the blur lies outside the colours that were behind the subject. Pixels that are not there (transparent) weigh nothing either, so a hole does not darken what is around it. The result is the sharp photo where the mask says subject and the blur where it says background, mixed in proportion to the mask (coverage c: `c x photo + (1 - c) x blur`). Where the model's coverage is 1 the pixels are the photo's, byte for byte; with the real model that was every number inside the mug.

### A coarser grid

A wide blur is smooth, so it is worked out on a grid of cells of `step` x `step` pixels (`step` is the standard deviation divided by 4, at most 16, so the blur is four to eight cells wide) and stretched back with bilinear blending. Three box blurs of two sizes stand in for the Gaussian (the usual "three boxes" method: within about 4 % of the standard deviation asked for, 12 % at the very smallest), over windows that stop at the edge of the picture: what is not there is not counted, and the weights are summed the same way, so the average is right at the edges too. The cost then depends on how smooth the result is, not on how many pixels the photo has. Measured in Node on this machine, adding the rows, solving and painting a 25-megapixel picture took 1.1 to 1.2 s in all (about 0.4 s, 0.04 to 0.1 s, 0.65 s), a 12-megapixel one 0.5 to 0.6 s and a 1-megapixel one 0.05 to 0.2 s. A straight ramp of colour comes out of it unchanged, across and down (tested): that is what shows the grid is not shifted against the picture.

### Strengths

Light, medium (the default) and strong: a standard deviation of 0.5 %, 1.2 % and 2.5 % of the photo's longer side, and at least 2 pixels, so the look is the same at any resolution (6, 14 and 30 pixels on a photo 1,200 pixels wide). It is one blur at every distance, not the changing blur of a real lens: a mask has no depth in it.

### The mask is kept

The case this tool exists for is "Undo, then try another strength", and the model would make the person wait 4 to 5 seconds again for the same answer. So the last mask is kept in memory, for the picture a job began with (a source names its pixels) and the model, and Remove background uses it as well. It goes when the model is removed, when the page is closed, or when another photo is worked on (one is kept). A retry then takes under a second (0.8 s with the real model, a 960 x 720 photo).

### Edges

Where the model's outline is soft (hair, fur, glass, a contact shadow) the mask lies between 0 and 1 for a few pixels, and the sharp background is mixed in in that proportion. With a very regular wall the effect can be seen: a thin ring of the wall's dots stays visible, faintly, where they touch the outline (`e2e/ml-real.cjs` writes the close-up as `blur-rim-original-medium-strong.png`). A harder mask would cut the thin parts of the subject, a softer one would leave more of the sharp background; it is left as the model gave it, and there is no brush yet.

### Transparency

A photo with transparency keeps the opacity of every pixel. If everything around the subject is transparent, or is only the faint rim of an anti-aliased edge (less than 0.1 % of the picture is background that is at least half there), there is nothing to blur: the tool says so and makes no picture. The same goes for a photo that is all subject (99.9 % or more of the mask), as with the cut-out.

### Time and the screen

The model takes as long as it does for the cut-out (the first photo after a page load also builds the session). The pixel work is done in pieces of about 262,000 pixels (under 20 ms each): between them the job looks at Cancel and, about every 30 ms, gives the browser a turn through a message channel (a timer would be held back to once a second by a tab in the background). With a 12-megapixel photo the page was never blocked for more than 193 ms at a time, and the whole job took 2.7 s on one graphics card and 4.7 to 6.3 s on another (below).

### What was checked

With the real model on a drawn photo of a mug in front of a wall covered in small dots (`e2e/ml-real.cjs`, `ONLY=blur-background`): the dots were gone (the average difference of a pixel from its neighbours fell from 1.96 to 0.02 on a scale of 255), the wall kept its colour, the wall next to the mug had the colour of the wall far from it (no halo), no number inside the mug had changed, and the second try took 0.8 s because the model was not asked again. A cut-out sticker was left alone with a message that says why, and a 12-megapixel photo was done in 2.7 to 6.3 s. With a hand-made stand-in for the model in a real browser (`e2e/ml.cjs`): not one number inside the subject changed, the wall's stripes fell from steps of 60 to 8 (strong) and 16 (light), its colour was kept, the opacity was kept, and the model was asked once for two tries.

## Colour pop

### What it does

Keeps the subject of a photo in colour and takes the colour out of everything behind it: the "colour pop" or "colour splash" look. It is the blur's path with simpler arithmetic: the remover's model finds the subject (nothing more to download), and `colourPop.ts` moves every pixel behind the subject toward its own grey. The result is a new picture as large as the photo (or the 25-megapixel budget, whichever is smaller), the element keeps its box, `originalSrc` keeps the old picture, and applying it is one undo step.

### The grey, and the two styles

The grey of a pixel is 0.2126 red + 0.7152 green + 0.0722 blue: the weights of the CSS `grayscale()` filter, which the Filters panel already uses, so a colour pop and the "black and white" of that panel agree. **Black and white** takes all the colour out of the background, **Faded** takes out 60 % of it. Where the model's outline is soft (coverage c between 0 and 1) a pixel goes `1 - c` of the way, so the colour fades out over the pixels the mask fades over. The subject (coverage 1) is never touched, byte for byte (with the real model: every number inside the mug), the opacity never is, and pixels that are not there (transparent) keep their colour.

### Nothing to do

A picture is saved only when the background really changed: at least 0.1 % of the pixels have to be background that is at least half there and that moved by two levels or more in some channel. So a photo that is black and white behind the subject already, a cut-out with nothing behind it, and a cut-out with only the faint rim of an anti-aliased edge are left alone, with a message that says why; so is a photo that is all subject (99.9 % or more of the mask), as with the cut-out. The grey that a soft outline puts on the subject's own edge does not count: a sticker is not "changed" because its edge went a little grey (the first real run on a sticker saved a picture for exactly that reason; the count now looks at the background side of the outline only).

### Edges and what stays in colour

At the outline the mix is in proportion to the mask, so the first two or three pixels of the subject's edge are a little greyer than the rest, and a faint band of the wall's colour stays on the wall right next to the subject: with the real model the wall within six pixels of the mug kept 3 of a colour spread of 92 (the largest 24), and ten pixels away it kept none (`e2e/ml-real.cjs` writes the close-up, `colour-pop-rim-original-bw-faded.png`). The model keeps a contact shadow as part of the subject, so the shadow under the mug stays in colour (it stays in the cut-out too).

### What was checked

With the real model on a drawn mug in front of a teal-to-green wall (`e2e/ml-real.cjs`, `ONLY=colour-pop`): the wall's colour spread fell from 119 on average to 0 (black and white) and 47 (faded), no number inside the mug changed, the second try took 0.8 s because the kept mask was used, a sticker was left alone with the message, and a 12-megapixel photo took 4.0 s in all with the page never blocked for more than 101 ms. With the hand-made stand-in model in a real browser (`e2e/ml.cjs`): not one number inside the subject changed, the wall's stripes fell from a spread of 60 to 5 (black and white) and 27 (faded), the model was asked once for the two tries, and a grey wall was left alone.

## Model manifest

| Model | Task | File | Size | Licence | Copyright | Source |
| --- | --- | --- | --- | --- | --- | --- |
| ISNet general-use (fp16) | Remove background, Blur background, Colour pop | `onnx/model_fp16.onnx` | 88,141,111 bytes | Apache-2.0 | the DIS authors (Xuebin Qin et al.); the ONNX export comes from [rembg](https://github.com/danielgatis/rembg) (MIT, (c) 2020 Daniel Gatis) | [Ko033/isnet-general-use-onnx](https://huggingface.co/Ko033/isnet-general-use-onnx), revision `5349b617911fd60c619b52f32e2b593517b78df3`, from [xuebinqin/DIS](https://github.com/xuebinqin/DIS) |
| Real-ESRGAN general x4 v3 (full precision) | Upscale | `model.onnx` | 4,866,428 bytes | BSD-3-Clause | Copyright (c) 2021, Xintao Wang | [skillsafe-ai/realesr-general-x4v3](https://huggingface.co/skillsafe-ai/realesr-general-x4v3), revision `042a40bc4c918349ad3e2e607a68ae509a4c27b5`, converted from the official [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) release v0.2.5.0 |

SHA-256 `0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c`, read from the Hugging Face file listing on 2026-11-05. The DIS licence file is the unfilled Apache-2.0 text (no holder named). The conversion (auxiliary outputs removed, half precision) was made by an individual uploader; the pinned hash proves it is the file that was tested, not that it is trustworthy beyond that. The input is `input_image` (float32, 1 x 3 x 1024 x 1024, `x / 255 - 0.5`), the output `output_image` (float32, 1 x 1 x 1024 x 1024, already a probability, stretched to the full range per photo as the authors recommend).

The upscaler's SHA-256 is `a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e`, read from the Hugging Face file listing on 2026-11-06 and checked on the downloaded file. The input is `input` (float32, 1 x 3 x height x width, RGB from 0 to 1), the output `output` (float32, 1 x 3 x 4 height x 4 width, opset 17). The licence is the upstream BSD 3-Clause text ("Copyright (c) 2021, Xintao Wang", read at commit `a4abfb29`), which asks for the notice to be kept: the models dialog shows it.

File > On-device models shows each model's size, licence, copyright line, credit and links (the file, revision and hash stay in this table and in the registry). A model joins the registry (`src/ml/registry.ts`) only with its licence, copyright line, source, size and hash. Not to be used: RMBG 1.4 and 2.0 (non-commercial), `@imgly/background-removal` (AGPL-3.0), EdgeSAM, 4x-UltraSharp, CodeFormer (see the report).

## Privacy and network

- The photo never leaves the device. It is read, resized and masked in the page and its worker.
- The only requests are the one-time model download (to `huggingface.co`, or to your own host if the build sets `VITE_CRAFTLY_MODEL_BASE`, and the file host a redirect leads to; sent without a referrer or cookies) and, on first use, the runtime file (28.7 MB, from the app's own origin).
- After that, the tool works offline.

## Failure modes and where they are tested

| Input or condition | Expected behaviour | Test |
| --- | --- | --- |
| No WebGPU, or no adapter | The tool says why and offers nothing to download | `device.test.ts`, `ToolsTab.test.tsx`, `ModelsDialog.test.tsx` |
| Offline or blocked download, wrong size, wrong hash | Nothing is stored; a plain message; trying again works | `download.test.ts`, `service.dom.test.ts` |
| Disk quota too small, or a disk that fills up while saving | Refused before downloading; a full disk is reported as "not enough space" | `service.dom.test.ts`, `modelStore.test.ts` |
| Cancel while downloading or running | Download stops; the worker is ended; no half-installed model | `download.test.ts`, `client.test.ts`, `service.dom.test.ts` |
| Photo replaced or deleted while the model runs, or the person turned to another page | The result is dropped, never applied to the wrong picture; on another page it still lands on the right photo | `service.dom.test.ts`, `storeActions.test.ts` |
| Second click while a job runs | Refused with a message; the first job is untouched | `service.dom.test.ts`, `client.test.ts` |
| Very large photo | Result is capped at 25 megapixels, with a message | `compose.dom.test.ts`, `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Transparent PNG | The model sees it on white; transparency that was already there is kept | `compose.dom.test.ts` |
| Photo with no size (an SVG without dimensions), or a PNG the browser cannot encode | "That picture could not be read", nothing changes | `compose.dom.test.ts`, `service.dom.test.ts` |
| No subject found, or the whole photo is the subject | A message; no new picture is made | `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Locked photo, or a design that is view-only (also when that happens while the model works) | Refused before anything is downloaded or run; never reported as done; no stray picture is left in Uploads | `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Cancel after the mask came back (cutting out, saving) | Honoured: nothing is applied and the new picture is removed | `service.dom.test.ts` |
| Cancel while the engine is prepared after a download | The downloaded model stays; only the preparing stops | `service.dom.test.ts`, `ToolsTab.test.tsx`, `ModelsDialog.test.tsx` |
| The picture cannot be saved (disk full) | The message about free space ("There isn't enough free space on this device to store the model."), not "the model failed" | `service.dom.test.ts` |
| The ONNX runtime's own file does not load (offline, blocked) | "The tool's engine could not be loaded"; the worker is ended, because the runtime remembers a failed start and would repeat it | `engine.test.ts`, `client.test.ts` |
| The model returns NaN (half precision overflowing on some cards) | A failure with the reason in the console, never "no subject found" | `engine.test.ts` |
| A model file is added from disk | It is checked, stored, and the engine is prepared so the runtime file is stored while there is a connection | `service.dom.test.ts` |
| A photo whose result would be over 25 megapixels | Refused before anything is downloaded (by the size the photo is recorded with), and again by the pixels read; the Tools tab does not offer a factor that cannot fit | `tiles.test.ts`, `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Transparent picture | The model sees colours, not black; the opacity is put back; no dark fringe | `tiles.test.ts`, `service.dom.test.ts`, `e2e/ml.cjs`, `e2e/ml-real.cjs` |
| Cancel in the middle of the tiles | Ends the worker; nothing is applied and no stray picture is left; the next job starts a new worker | `service.dom.test.ts`, `client.test.ts`, `e2e/ml.cjs` |
| One tile fails (out of graphics memory, a number that is not one) | The job ends with a plain message and the reason in the console; the canvas is freed; the photo is untouched. A single bad number is enough, because it would be a black dot in the photograph | `engine.test.ts`, `service.dom.test.ts` |
| A vector picture (SVG) | Explained: it stays sharp at any size; nothing is downloaded | `service.dom.test.ts` |
| Tiles that do not fit together (a tile put in the wrong place, context left in) | Cannot go unnoticed: the stand-in model makes every pixel a block of pixels, so the stitched result has to equal the original's pixels exactly | `service.dom.test.ts`, `e2e/ml.cjs` |
| A graphics card without half-precision shaders | The upscaler is still offered (only the background model needs them, so Remove background, Blur background and Colour pop are held back) | `ModelsDialog.test.tsx`, `ToolsTab.test.tsx` |
| A same-origin mirror of the model, or a host that answers any path with its home page | The service worker neither copies the model nor stores a page under a `.wasm` name | `e2e/ml.cjs` (production build) |
| GPU runs out of memory or the device is lost | A plain message; the failed session is dropped and the next try builds a new one | `engine.test.ts` |
| Worker fails to start, crashes, or a request cannot be sent | An error, not a hang; the client is free for the next job | `client.test.ts` |
| Model on disk is not the file the registry now pins | Treated as outdated and downloaded again after a yes | `state.test.ts`, `service.dom.test.ts` |
| Design saved as `.craftly` after a cutout | The original picture travels with it, so "Restore original" survives | `projectFormat.test.ts` |
| Replacing a cut-out photo by hand | `originalSrc` is cleared | `storeActions.test.ts` |
| Blur: the subject's colour bleeding into the blurred background | Cannot happen: only background pixels are averaged, so a plain background stays exactly as it was and no blurred colour leaves the range of the colours behind the subject | `blur.test.ts` |
| Blur: the grid the blur is worked out on shifted against the picture | A ramp of colour comes out as it went in, across and down; so do the mask's values | `blur.test.ts` |
| Blur: the work split into pieces | The same picture however the rows are split; a tall picture is put together from two pieces | `blur.test.ts`, `service.dom.test.ts` |
| Blur: nothing to blur (all subject; or the surround is transparent or only a faint rim) | A message; no new picture; the picture is not even read in the first case | `blur.test.ts`, `service.dom.test.ts`, `ToolsTab.test.tsx`, `e2e/ml-real.cjs` |
| Blur: Cancel while the pixels are worked on | Honoured at the next piece; the canvas is freed, nothing is applied, no stray picture | `service.dom.test.ts` |
| Blur: another try after Undo | The model is not asked again; the kept mask is not used for another picture, and goes when the model is removed | `service.dom.test.ts`, `e2e/ml.cjs`, `e2e/ml-real.cjs` |
| Blur: a photo with transparency | The opacity of every pixel is kept; transparent pixels add no colour; never saved as a JPEG | `blur.test.ts`, `service.dom.test.ts` |
| Blur: a photo over 25 megapixels | Reduced to 25 with a message | `compose.dom.test.ts`, `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Two tools share a model that is being downloaded | The download is shown once, under the tool that asked for it; the others wait | `service.dom.test.ts`, `ToolsTab.test.tsx` |
| Colour pop: nothing to change (all subject; a background that is grey already, transparent or only a faint rim; colour only on the subject's own soft outline) | A message; no new picture (the picture is not even read in the first case); what was painted is thrown away and the canvas freed | `colourPop.test.ts`, `service.dom.test.ts`, `ToolsTab.test.tsx`, `e2e/ml-real.cjs` |
| Colour pop: the subject | Untouched, byte for byte; the grey of a soft outline goes only as far as the mask says | `colourPop.test.ts`, `e2e/ml.cjs`, `e2e/ml-real.cjs` |
| Colour pop: opacity and pixels that are not there | The opacity of every pixel is kept; transparent pixels keep their colour; never saved as a JPEG | `colourPop.test.ts`, `service.dom.test.ts` |
| Colour pop: the work split into pieces; Cancel between them | The same picture and the same count however the rows are split; Cancel is honoured at the next piece, the canvas freed, nothing applied | `colourPop.test.ts`, `service.dom.test.ts` |
| The mask of the last photo, asked for by three tools | One wait for the model for Remove background, Blur background and Colour pop on the same photo | `service.dom.test.ts` |

## Tasks

- [x] Registry, errors, pixel maths (`registry.ts`, `errors.ts`, `pixels.ts`)
- [x] Download with progress and verification, model store (`download.ts`, `modelStore.ts`)
- [x] Device check (`device.ts`)
- [x] Engine, worker host and client (`engine.ts`, `workerHost.ts`, `worker.ts`, `client.ts`)
- [x] Compositing (`compose.ts`)
- [x] State and service (`state.ts`, `service.ts`)
- [x] Document changes: `originalSrc`, project file, "tools" tab, "models" dialog, `updateElementsOnPage`
- [x] UI: Tools tab, On-device models dialog, progress bar, the About dialog's wording
- [x] Build: worker format, runtime file, service worker caching
- [x] Browser check with a stand-in model on a real GPU (`e2e/ml.cjs`, dev server and production build, including offline)
- [x] Browser check with the real model (`e2e/ml-real.cjs`; downloads 88.1 MB once, keeps it in a test profile): download, verify, install, run, cut-out, restore, second run
- [x] Independent review, and its findings fixed (worker restart after a failed runtime start, locked photos, Cancel until the end, import prepares the engine, service worker rules, consent text names the real host, quieter screen-reader announcements, focus on Cancel)
- [x] Docs: README, CHANGELOG, DESIGN, ROADMAP, notices
- [x] Phase 2, the upscaler: the model chosen, downloaded with permission and checked on a real graphics card (`e2e/ml-probe.cjs`: reference output, timings); `tiles.ts`, `limits.ts`; tile requests in the engine and the client; `readPixels` and the canvas the tiles are put together on in `compose.ts`; the job and its progress in `service.ts`; the Upscale section of the Tools tab and a models dialog that handles several models; browser checks with a hand-made upscaler (`e2e/ml.cjs`) and with the real one (`e2e/ml-real.cjs`, `ONLY=upscale`)
- [x] Phase 3, Blur background: `blur.ts` (the weights, the three box blurs on a coarser grid, the strengths, rows in pieces); `readPixels` with a budget of pixels and the result canvas under a name that fits both jobs; the job in `service.ts` with the kept mask; the Blur background section of the Tools tab, one note for a tool that is working and the shared model's download under the tool that asked; browser checks with the hand-made mask model (`e2e/ml.cjs`) and with the real one (`e2e/ml-real.cjs`, `ONLY=blur-background`)
- [x] Phase 4, Colour pop: `coverage.ts` (the mask stretched over the picture, shared with the blur), `colourPop.ts` (the grey, the two styles, the count of what changed), the three background jobs on shared helpers in `service.ts` (`locateSubject`, `pieceRunner`, `paintAndApply`), the Colour pop section of the Tools tab; browser checks with the hand-made mask model (`e2e/ml.cjs`) and with the real one (`e2e/ml-real.cjs`, `ONLY=colour-pop`)
- [x] Final verification of phase 1 (2026-11-06): type-check; the whole suite with coverage (5,721 tests in 270 files, 99.4 % statements, 97.1 % branches); the 554 tests of the files this work touched again while 36 spinning processes kept the 24-core machine busy; 87 browser checks on the dev server and 92 on a production build (all seven journeys, and the offline one on the build); the real model once more on the final build
- [x] Final verification of phase 2 (2026-11-06): type-check; the whole suite with coverage (5,871 tests in 273 files, 99.4 % statements, 97.1 % branches, 99.7 % functions, 99.9 % lines); 25 deliberate breakages of the upscaler's code, each caught by a test; the 997 tests of the 44 files this work and the dashboard helpers touched again while 36 spinning processes kept the 24-core machine busy; 96 browser checks (90 on the dev server, 94 on a production build, and the offline journey on the build); both real models once more on the final build, through the app's own download dialog (`e2e/ml-real.cjs`: Remove background gave the same cut-out as before the rework, Upscale the same sharpness)
- [x] Final verification of phase 3 (2026-11-06): type-check; the whole suite with coverage (5,963 tests in 274 files, 99.4 % statements, 97.1 % branches, 99.7 % functions, 99.9 % lines); 35 deliberate breakages of the blur code and of the service and Tools tab code around it, each caught by a test (one needed a test added first); the 492 tests of the 19 files of the on-device work again while 36 spinning processes kept the 24-core machine busy; 98 browser checks (92 on the dev server, 95 on a production build, and the offline journey on the build); the real model once more on the final build for Remove background and Blur background. The real upscaler was not run again: it needs its own 4.9 MB download, and its code changed only by a rename and a budget of pixels that the hand-made upscaler of `e2e/ml.cjs` checks exactly.
- [x] Final verification of phase 4 (2026-11-06): type-check; the whole suite with coverage (6,029 tests in 276 files, 99.4 % statements, 97.2 % branches, 99.7 % functions, 99.9 % lines); 26 deliberate breakages of the colour pop code, of the mask sampler it shares with the blur, and of the service and Tools tab code around them, each caught by a test; the 558 tests of the 21 files of the on-device work again while 36 spinning processes kept the 24-core machine busy; 100 browser checks (94 on the dev server, 96 on a production build, and the offline journey on the build); both real models on the final build, all four tools in one run of `e2e/ml-real.cjs` (Remove background, Blur background, Colour pop, then Upscale with its own 4.9 MB download), with one request to the model host in all.

## What was measured

All of this is on one machine: Chrome on Windows 11 with an integrated Intel Gen-12LP GPU (the blur's rows also name the machine's NVIDIA card, which Chrome chose in some of the later runs). Treat it as one data point, not a benchmark.

| What | Result | How |
| --- | --- | --- |
| Runtime and GPU set-up, then a run | First run 740-970 ms, the next 3-6 ms | A hand-made 64 x 64 model in the real worker (`e2e/ml.cjs`). The first run includes loading the WebAssembly file and creating the WebGPU session |
| The job layer end to end | 63-268 ms for a 320 x 240 photo | Same model: install into IndexedDB, mask, full-size cut-out PNG, new asset, undo and restore |
| Plumbing accuracy | The disc the model returns is exactly the expected 1,257 pixels; the PNG is transparent outside it and solid inside | Same journey, pixels read back |
| Offline | The worker ran with the network off, using the service worker's copy of the runtime | Production build |
| Requests to the model host while the person says no | 0 | Same journey |
| Code added to the first-visit download | 126 KB of JavaScript (the worker, 4.5 KB when this was measured and 6.7 KB in the final build, and the runtime loader, 121.7 KB); the Editor chunk grew by 22.6 KB (8.5 KB gzipped) | `npm run build` |
| The runtime file | 28.7 MB (7.2 MB gzipped), fetched on first use | `npm run build` |
| The real model: first use | 25.7 s from the click (download of 88.1 MB, size and SHA-256 check, storing it, creating the WebGPU session, the first photo) | `e2e/ml-real.cjs` on a home connection |
| The real model: a photo | 4.5-4.9 s for the first photo after a page load (the engine is set up then), 3.7 s for the next one on the same page; no request to the model host once it is installed | Same journey, a 960 x 720 photo, four runs with the model already installed (the 3.7 s figure comes from the last two) |
| The real model: the result | A 960 x 720 PNG; the mug, its handle and its shadow stay, the wall is transparent (28.4 % of the pixels solid, 6,142 soft edge pixels) | Same journey, pixels read back and the screenshot looked at |
| Creating the session | about 13 s for BiRefNet lite (16,446 nodes), part of the 4.7 s here for ISNet | `e2e/ml-probe.cjs` |
| The upscaler: the file against its authors' reference | Largest difference 4.3e-6, average 5.3e-7 | `e2e/ml-probe.cjs` with `REF_IN` and `REF_OUT` |
| The upscaler: one tile | 2.09 s for 256 x 256 in full precision (about 30 microseconds a pixel at any size), 1.34 s in half precision; the session takes 1.4-1.8 s | `e2e/ml-probe.cjs` |
| The upscaler: context of a tile | A difference from one piece of at most 4 levels of 255 with 16 pixels of context, 1 with 24, 0 with 34 | The experiment in "Tiles and context" |
| The upscaler with a stand-in model, 2x and 4x | Every pixel of the result equals the original's pixel it comes from, over 6 tiles, in the unit tests and in the browser | `e2e/ml.cjs` |
| The real upscaler: first use | 17.1 to 18.6 s from the click (download of 4.9 MB, size and SHA-256 check, storing it, the session, two tiles, saving) | `e2e/ml-real.cjs` with `ONLY=upscale`, and as the last of the four tools in one run, on a home connection |
| The real upscaler: the result | A 240 x 180 soft picture became 480 x 360; its edges are 7.4 times as sharp as a plain stretch, its colours within 3.3 of 255 of the stretch | Same journey |
| The real upscaler: a picture with transparency | 160 x 160 became 320 x 320 with 1,952 soft edge pixels, none off-colour | Same journey |
| Code added by the upscaler to the first-visit download | The Editor chunk grew by about 4 KB gzipped (137 to 141 KB); the model (4.9 MB) is not part of the build | `npm run build` |
| Remove background again on the same photo (after Restore original) | 0.12 to 0.14 s: the kept mask is used, the model is not asked | `e2e/ml-real.cjs` |
| Code added by Blur background to the first-visit download | The Editor chunk grew by about 7 KB (423 to 430 KB; gzipped 141 to 143 KB); there is no new model | `npm run build` |
| Blur background: the arithmetic | 25 megapixels: 1.1 to 1.2 s in all (add 0.4 s, solve 0.04 to 0.1 s, paint 0.65 s); 12 megapixels 0.5 to 0.6 s; 1 megapixel 0.05 to 0.2 s. The slowest piece of rows took 17 ms | A temporary timing test in Node, three strengths on each size |
| Blur background: with the real model, a 960 x 720 photo | 26.0 s for the first photo with the 88.1 MB download, 4.6 to 6.3 s without it (the first photo after a page load builds the session), 0.8 s for a second try with another strength | `e2e/ml-real.cjs` with `ONLY=blur-background` |
| Blur background: a 12-megapixel photo | 4.7 to 6.3 s in all on the integrated Intel card, 2.7 s on an NVIDIA card (Chrome chose a different one in different runs); the page was never blocked for more than 193 ms at a time | Same journey, long-task observer in the page |
| Blur background: what it did to the picture | The dots on the wall: 1.96 to 0.02 (average difference from the neighbours, of 255). The wall's colour within 6 levels, the wall next to the mug the colour of the wall far from it (no halo), no number inside the mug changed | Same journey, pixels read back |
| Colour pop with the real model, a 960 x 720 photo | 24.5 s for the first photo with the 88.1 MB download, 4.5 to 4.7 s without it, 0.8 s for a second try with the other style | `e2e/ml-real.cjs` with `ONLY=colour-pop` |
| Colour pop: what it did to the picture | The wall's colour (the spread between its red, green and blue, on average): 119 to 0 in black and white, 47 faded. No number inside the mug changed. The wall within six pixels of the mug kept 3 of 92 (largest 24), ten to twenty-four pixels away none | Same journey, pixels read back |
| Colour pop: a 12-megapixel photo | 4.0 s in all on the integrated Intel card; the page was never blocked for more than 101 ms at a time | Same journey, long-task observer in the page |
| Colour pop: the arithmetic | 25 megapixels: 0.37 to 0.43 s in all; 12 megapixels 0.18 to 0.19 s; 1 megapixel 15 to 24 ms. The slowest piece of rows took 13 ms | A temporary timing test in Node, both styles on each size |
| Code added by Colour pop to the first-visit download | The Editor chunk grew by about 3 KB (430 to 433 KB; gzipped 143 to 144 KB); there is no new model | `npm run build` |

Not measured yet: speed and memory on other machines (and the peak memory of a 25-megapixel result), quality on real photographs (hair, glass, shadows, small text, faces, a photo that is not a drawing), Safari, Firefox, phones, a graphics card without `shader-f16`.

## Adding a model

0. Try the file on a real GPU before anything else: `BASE=<a production preview> MODEL=<file> node e2e/ml-probe.cjs` lists its inputs and outputs, creates the session, runs it on noise and names the graph's widest nodes. A model that fails here will fail in the app. For a model that makes pictures larger, give the tile size it will get (`DIM=256`), a number of timed runs (`RUNS`) and, when its authors published one, a reference input and output (`REF_IN`, `REF_OUT`, `.npy` files): the answer has to match.
1. Find the model's licence first. It has to allow commercial use without a signed agreement, and its weights licence has to be readable (see "Not to be used" above).
2. Read the file listing from `https://huggingface.co/api/models/<repo>?blobs=true`: the head `sha` is the revision to pin, and the file's `lfs.sha256` and size are the hash and size to pin. Do not copy them from a model card.
3. Add an entry to `src/ml/registry.ts` with all of it: repository, revision, file, bytes, sha256, tensor names, normalisation, licence (name, URL, copyright line) and credit. `registry.test.ts` rejects an entry with a malformed hash or revision.
4. A new kind of model (not picture to mask, not picture to larger picture) needs its own task module next to `pixels.ts` and `tiles.ts`, an `io` kind in `types.ts` and a request in `engine.ts`; keep the maths pure and test it with literals. A model that makes a picture larger from the same family only needs a registry entry.
5. Add the job to `service.ts` (same shape as the four jobs, `removeBackground`, `blurBackground`, `colourPop` and `upscale`: all go through `runPhotoJob`, which checks the browser, finds the model and asks for it, and `applyResult`, which applies as one undo step and never to a changed photo; a new look at the background reuses `locateSubject`, `pieceRunner` and `paintAndApply` and needs no model of its own) and a section to the Tools tab.
6. Put the model in the README and in this file, and run the real model through `e2e/ml-real.cjs` (adapt it) before shipping.

## Known limits

- WebGPU only; the background model (Remove background, Blur background and Colour pop) also needs half-precision shaders. Its half-precision file cannot run on the CPU provider. A full-precision file (ISNet's is 176 MB) for cards without `shader-f16`, or a small portrait model with a WebAssembly fallback, are the obvious next additions. The upscaler's full-precision file could run on the CPU provider (slowly: one thread without cross-origin isolation); it has no fallback yet and says so without WebGPU.
- The upscaler takes about 30 to 40 seconds per megapixel of the original on an integrated graphics card, so a six-megapixel photograph takes minutes; the Tools tab warns from 1.5 megapixels. The half-precision file is about 1.5 times as fast on cards with `shader-f16`, and not used.
- Upscaling draws detail that was not there: plausible, not faithful (small text and faces especially). The result is a new picture in Uploads, as large as the result (tens of megabytes as a PNG at 25 megapixels), and repeated tries pile up there until they are deleted. The peak memory of the largest allowed jobs was not measured.
- No resume for an interrupted download, no brush to touch up the edge, no choice between a small and a large model.
- Blur background is one blur at every distance, not the changing blur of a lens, and there is no live preview: a strength is tried with Undo and another click (the mask is kept, so that takes about a second). Where the outline is soft a thin ring of the sharp background can show along it. A photo of more than 25 megapixels is reduced to 25.
- Colour pop keeps a contact shadow in colour, because the model counts it as part of the subject; it is one grey for the whole background (no depth, no brush), and the faint band of the wall's colour next to a soft outline is what the mask's softness leaves.
- The kept mask is one picture's: working on another photo makes the first one's retry wait for the model again.
- The input is the whole photo squeezed into 1024 x 1024; a very wide photo loses detail at the edges of the subject.
- Safari may remove script-written data after seven days without a visit; the app asks the browser to keep the models, and the dialog says when the browser has not promised to.
- The service worker keeps one runtime file per version of the runtime; an old one is removed when a build that no longer lists it installs.
- Deleting the original upload in Uploads makes "Restore original" fail with a message (the cut-out stays). Every undone or repeated cut-out leaves its PNG in Uploads (several MB at 25 megapixels).
- The 25-megapixel cap is above what some iPhones can draw on a canvas (about 16.7 megapixels on older iOS); untested there.
- The download is checked in memory, which holds the file about three times at once (about 265 MB for ISNet).
- Whether the WebGPU check on the page predicts WebGPU inside a worker in every browser (Firefox 141 on Windows) is unverified.

## Later

Decision (2026-11-06): the AI tools to come run on this device too; a hosted service such as fal.ai (Flux) was offered and not chosen. Every model is a download, so a feature that reuses an installed model (anything built on the cut-out mask) comes before one that needs another. BiRefNet (or another large model) as an optional high-quality choice, once there is an export that fits a 16-buffer GPU or the graph is rewritten at load time. Then, in the order of the report: magic eraser (LaMa 207.5 MB, or MI-GAN once its weights licence is settled) with a shared brush-and-mask interface, click-to-select (EdgeTAM or SlimSAM). Each adds a registry entry, a task module like `pixels.ts` plus a service function, and a section in the Tools tab. For the upscaler: a WebAssembly fallback for cards without WebGPU, the half-precision file where `shader-f16` exists, Real-ESRGAN x4plus (63.9 MB) as a quality tier, and the denoise-strength variant of the same network. For the blur: a live preview of the strength (the mask is kept, so the blur could be redone on a reduced copy while a slider moves), a blur that grows with the distance from the subject, and a brush to correct the mask where the model is wrong. The background jobs share the mask, so other looks for the background cost little: dimmed, darkened, tinted, or a plain colour in its place.
