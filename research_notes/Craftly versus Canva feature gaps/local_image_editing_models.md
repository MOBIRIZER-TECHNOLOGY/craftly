# Local and in-browser AI models for photo editing, plus classical editing tools, for Craftly (state as of 2026-11-05)

> Method notes (read first)
> - Research date 2026-11-05. "MB" = decimal (1 MB = 1,000,000 bytes), computed from exact byte counts in Hugging Face model-API JSON (`/api/models/<id>?blobs=true`). Those sizes, plus "lastModified" and download counts, are reliable for the fetch date.
> - Narrative facts (licences, speeds) were extracted from pages by a fetch-time summariser. "Not stated" means not found in the fetched text, not proof of absence upstream.
> - WebSearch hit a shared per-turn budget limit part-way through. The remaining gaps (TF.js status, DDColor, ORT large-model limits, Photopea feature pages) were closed by fetching primary sources directly. About 70 tool calls were used because the scope has nine sub-questions.
> - Browser (WebGPU / WASM) timings: almost no controlled benchmarks exist. Community or anecdotal numbers are labelled UNVERIFIED. Licence readings are plain-text readings, not legal advice.

---

## 1. Background removal / matting (RMBG, BiRefNet, MODNet, IS-Net / U2Net, @imgly/background-removal, Transformers.js)

### Takeaway
The commercially usable in-browser choices are BiRefNet (MIT; lite fp16 114.5 MB, full fp16 489.7 MB), BEN2 (MIT tag; 222.9 MB ONNX) and MODNet (Apache-2.0; 6.6 to 25.9 MB, portraits only). RMBG-1.4 and RMBG-2.0 are non-commercial without a Bria agreement, and @imgly/background-removal is AGPL-3.0 (other terms by contacting img.ly). Browser timing data is anecdotal only.

### Cited Findings

#### Licences (commercial-use flags)
- RMBG-2.0: card says "released under a CC BY-NC 4.0 license for non-commercial use"; "Commercial use is subject to a commercial agreement with BRIA"; metadata licence name `bria-rmbg-2.0`; access is gated behind a form and login. The card's marketing copy suggests commercial suitability, but the licence section restricts the open weights to non-commercial. — [RMBG-2.0 card](https://huggingface.co/briaai/RMBG-2.0), [HF API](https://huggingface.co/api/models/briaai/RMBG-2.0?blobs=true)
- RMBG-1.4: licence `bria-rmbg-1.4`, "source-available model for non-commercial use"; a commercial licence must be purchased from Bria. — [RMBG-1.4 card](https://huggingface.co/briaai/RMBG-1.4), [HF API](https://huggingface.co/api/models/briaai/RMBG-1.4?blobs=true)
- BiRefNet: MIT licence (HF card and GitHub README). — [HF card](https://huggingface.co/ZhengPeng7/BiRefNet), [GitHub](https://github.com/ZhengPeng7/BiRefNet)
- BEN2 (PramaLLC): licence tag MIT; arXiv 2501.06230; lastModified 2025-12-31; 108,359 downloads. — [HF API](https://huggingface.co/api/models/PramaLLC/BEN2?blobs=true)
- MODNet: Apache-2.0 for "code, models, and demos" (official repo); the Xenova ONNX port is tagged apache-2.0. — [MODNet GitHub](https://github.com/ZHKKKe/MODNet), [Xenova/modnet API](https://huggingface.co/api/models/Xenova/modnet?blobs=true)
- IS-Net / DIS: "Our code and evaluation metric use Apache License 2.0"; the DIS5K dataset has separate terms; `isnet-general-use.pth` released 2022-08-17. — [DIS GitHub](https://github.com/xuebinqin/DIS)
- @imgly/background-removal: README says "The software is free for use under the AGPL License" and points to support@img.ly for other licensing; the repo LICENSE.md is the GNU AGPL v3 text; npm `license` field is "SEE LICENSE IN LICENSE.md". The fetched text does not say whether bundled model weights carry a separate licence. — [README](https://raw.githubusercontent.com/imgly/background-removal-js/main/packages/web/README.md), [LICENSE.md](https://raw.githubusercontent.com/imgly/background-removal-js/main/LICENSE.md), [npm registry](https://registry.npmjs.org/@imgly/background-removal/latest)

#### Model sizes (exact files)
- RMBG-1.4 (IS-Net based, 44.1M params, 1024x1024 input): onnx/model.onnx 176.15 MB, model_fp16.onnx 88.22 MB, model_quantized.onnx 44.40 MB; lastModified 2025-07-06; 265,185 downloads. — [HF API](https://huggingface.co/api/models/briaai/RMBG-1.4?blobs=true), [card](https://huggingface.co/briaai/RMBG-1.4)
- RMBG-2.0 (BiRefNet architecture, 0.2B params, 1024x1024 input, 8-bit alpha matte output, trained on >15,000 manually labelled images): model.onnx 1,024.33 MB; fp16 513.58 MB; int8 / quantized / uint8 366.09 MB; q4 367.45 MB; bnb4 355.29 MB; q4f16 233.82 MB; lastModified 2026-10-21; 401,714 downloads. — [HF API](https://huggingface.co/api/models/briaai/RMBG-2.0?blobs=true), [card](https://huggingface.co/briaai/RMBG-2.0)
- BiRefNet ONNX (onnx-community/BiRefNet-ONNX, MIT): model.onnx 972.67 MB, model_fp16.onnx 489.67 MB; lastModified 2025-03-07. — [HF API](https://huggingface.co/api/models/onnx-community/BiRefNet-ONNX?blobs=true)
- BiRefNet_lite ONNX (onnx-community/BiRefNet_lite-ONNX, MIT): model.onnx 224.01 MB, model_fp16.onnx 114.54 MB; lastModified 2025-10-26; 23,562 downloads. — [HF API](https://huggingface.co/api/models/onnx-community/BiRefNet_lite-ONNX?blobs=true)
- BEN2: BEN2_Base.onnx 222.93 MB; model.safetensors 380.58 MB; BEN2_Base.pth 1,134.58 MB. — [HF API](https://huggingface.co/api/models/PramaLLC/BEN2?blobs=true)
- MODNet (Xenova/modnet): model.onnx 25.89 MB; fp16 12.98 MB; q4f16 11.80 MB; q4 23.13 MB; quantized/uint8 6.63 MB; lastModified 2025-10-26; 120,496 downloads. — [HF API](https://huggingface.co/api/models/Xenova/modnet?blobs=true)
- @imgly/background-removal: npm v1.7.0, peer-depends on onnxruntime-web 1.21.0 (old); three models `isnet`, `isnet_fp16` (default), `isnet_quint8`; README gives only two size tiers (~40 MB "small" quantized, ~80 MB "medium" default); data package `@imgly/background-removal-data` v1.4.5 is 221.5 MB unpacked in 62 files; `device: 'gpu'` uses WebGPU when available (default device not stated); assets default to a staticimgly.com CDN `publicPath`, self-hostable by serving the data package `dist` folder; SharedArrayBuffer (COOP/COEP) affects speed; output png/jpeg/webp, type foreground/background/mask; Next.js support limited to v15; no benchmark numbers given. — [README](https://raw.githubusercontent.com/imgly/background-removal-js/main/packages/web/README.md), [npm web](https://registry.npmjs.org/@imgly/background-removal/latest), [npm data](https://registry.npmjs.org/@imgly/background-removal-data/latest)

#### BiRefNet variants, quality metrics, desktop speed (README)
- Variants and dates: BiRefNet_lite-2K (2024-09-24, inputs up to 2560x1440); BiRefNet-matting (2024-10-06, trimap-free); BiRefNet_HR (2025-02-01, 2048x2048); BiRefNet_HR-matting (2025-02-12); BiRefNet_dynamic (2025-03-31, 256x256 to 2304x2304). — [GitHub](https://github.com/ZhengPeng7/BiRefNet)
- DIS-VD metrics (higher S / wF better, lower HCE better): swin_v1_large S 0.927, wF 0.894, HCE 881; swin_v1_tiny S 0.882, wF 0.830, HCE 1175. General matting (TE-P3M-500-NP) S 0.979, wF 0.988; portrait matting (P3M-500-P) S 0.983, wF 0.989. — [GitHub](https://github.com/ZhengPeng7/BiRefNet)
- Desktop speed: 17 FPS at 1024x1024 on one RTX 4090 in FP16 (README claim dated 2025-01-06). PyTorch table as extracted (FP32 / FP16 order inferred, README says devices differ from the paper): A100 86.8 / 69.4 ms, RTX 4090 95.8 / 57.7 ms, V100 384 / 152 ms. ONNX at 1024x1024 on A100: SwinL ~165 ms (about 90% slower than PyTorch), SwinT ~93.8 ms. Third-party TensorRT on RTX 4080S: avg 0.11 s (TensorRT) vs 4.43 s (ONNX) vs 0.15 s (PyTorch). GPU memory for inference: 4.8 GB FP32, 3.5 GB FP16. README notes ONNX outputs differ slightly from PyTorch ("acceptable"). — [GitHub](https://github.com/ZhengPeng7/BiRefNet)
- Hair / transparency: the README has no direct statements on hair or transparent objects (images only). It notes RMBG-2.0 weights are "not aware of transparency" because training focused on binary masks. — [GitHub](https://github.com/ZhengPeng7/BiRefNet)
- MODNet is intended for real-time portrait matting from RGB with no trimap; limitations on non-portrait subjects are not stated. — [MODNet GitHub](https://github.com/ZHKKKe/MODNet)

#### Browser speed (UNVERIFIED, community-reported)
- BiRefNet full (Swin-L) 1024 fp16 on a WebGPU build: ~800 ms per image once warm, ~4.3 s load, on a Radeon RX 9070 XT in Chrome. BiRefNet_lite at 640x640: ~0.5 s per frame on a laptop RTX 3050 (ORT Web 1.30). Several community repos report the stock 1024 export fails in browsers (std::bad_alloc on WebGPU with fp16; fp16 export needs graph surgery because fp16 defeats in-browser constant folding) and recommend a 512 variant. These are search-snippet-level statements about HF community re-exports; the repos were not opened. — [runes/birefnet-lite-webgpu](https://huggingface.co/runes/birefnet-lite-webgpu), [wonfy/BiRefNet-ONNX-webgpu](https://huggingface.co/wonfy/BiRefNet-ONNX-webgpu), [NardoCreations/birefnet-lite-webgpu](https://huggingface.co/NardoCreations/birefnet-lite-webgpu), [camclo/birefnet-lite-512](https://huggingface.co/camclo/birefnet-lite-512), [jiabins0303/birefnet-lite-1024-webgpu](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu)
- RMBG-1.4 via Transformers.js WebGPU: one social post says ~9 s dropped to ~180 ms per image (no GPU or image size given); a DEV article lists 1 to 5 s per image on GPU and 5 to 30 s first-time model load (no hardware named); a Backblaze sample downloads ~176 MB on first run. — [bookmark of post](https://mike-gold.pages.dev/notes/x-bookmarks/ai/webgpu-background-removal-breakthrough), [DEV article](https://dev.to/linmingren/building-a-browser-based-ai-background-removal-tool-1fk), [Backblaze sample](https://github.com/backblaze-b2-samples/b2-transformerjs-background-removal)
- ducan-ne/remove-bg (MIT repo) runs RMBG-1.4 through Transformers.js on WebGPU with CPU fallback; no timing numbers; maintainers acknowledge browser-crash reports. — [GitHub](https://github.com/ducan-ne/remove-bg)

#### Transformers.js pipelines
- Transformers.js has a `background-removal` pipeline (class BackgroundRemovalPipeline) whose docs example is `pipeline('background-removal', 'Xenova/modnet')` returning a 4-channel RawImage; default model for the task is not documented. Other image tasks listed: depth-estimation, image-segmentation, image-to-image (docs example `Xenova/swin2SR-classical-sr-x2-64`), image-to-text, object-detection, zero-shot variants. The RMBG-2.0 card shows `pipeline('image-segmentation', 'briaai/RMBG-2.0')`. `mask-generation` was not visible in the (truncated) docs page. — [pipelines docs](https://huggingface.co/docs/transformers.js/api/pipelines), [RMBG-2.0 card](https://huggingface.co/briaai/RMBG-2.0)

### Inferences
- For a product that may be commercial, BiRefNet_lite fp16 (114.5 MB, MIT) is the best default; BiRefNet full fp16 (489.7 MB) is an opt-in "high quality" tier; MODNet q8 (6.6 MB) is a tiny portrait-only fallback. BEN2 (MIT tag) is the main alternative, but training-data provenance was not checked.
- RMBG-1.4/2.0 should be treated as off-limits unless Bria is paid. Using @imgly in a closed-source Craftly would, on a plain reading of AGPL, require releasing Craftly's source under AGPL-compatible terms or buying a licence from img.ly.
- Because the fp16 / 1024 exports have reported browser failures, budget time to produce and test your own fixed-shape (512 to 1024) fp16 export and confirm it on Chrome, Safari 26 and a low-end GPU.
- Soft hair is plausible with BiRefNet / matting variants; glass and translucent objects remain a known weakness (RMBG-2.0 "not aware of transparency"), so ship a feather / refine-edge brush rather than promising perfect alpha.

### Gaps
- No controlled in-browser benchmarks (ms, WebGPU vs WASM) for RMBG, BiRefNet, MODNet or ISNet; WASM timings not found at all.
- No head-to-head hair / transparent-object comparison of BiRefNet-lite, BEN2, MODNet and imgly isnet.
- U2-Net licence and file sizes, and IS-Net weight file sizes, not verified (DIS page states no sizes). imgly per-model sizes only approximate (~40 / ~80 MB tiers); whether imgly model weights have a licence separate from the AGPL code is unresolved.
- Web-ready ONNX for BiRefNet-matting / HR-matting not verified. BiRefNet training-data licences not checked.

---

## 2. Segmentation and click-to-select (SAM 2, SAM 3, MobileSAM, EdgeSAM, SlimSAM, EdgeTAM)

### Takeaway
Transformers.js-ready ONNX builds exist for SlimSAM-77 (13.8 MB q8 / 20.7 MB fp16, Apache-2.0), EdgeTAM (14.2 / 20.6 MB, Apache-2.0) and SAM 2.1 Tiny (34 MB q4f16 / 78 MB fp16). SAM 3's tracker encoder is 296 to 1,869 MB and its licence is custom; EdgeSAM is under the non-commercial NTU S-Lab licence. No browser timings were published.

### Cited Findings

#### Browser-ready builds (exact sizes)
- Xenova/slimsam-77-uniform (Apache-2.0, lastModified 2026-03-18, 84,855 downloads): vision_encoder 23.28 MB fp32 / 12.17 MB fp16 / 8.88 MB q8; prompt_encoder_mask_decoder 16.56 / 8.55 / 4.90 MB. Totals: 39.8 MB fp32, 20.7 MB fp16, 13.8 MB q8. — [HF API](https://huggingface.co/api/models/Xenova/slimsam-77-uniform?blobs=true)
- onnx-community/sam2.1-hiera-tiny-ONNX (created 2025-11-18; 14,498 downloads; no licence tag on the ONNX repo): vision_encoder weights 134.08 MB fp32 / 67.01 fp16 / 52.57 int8 / 43.76 q4 / 42.09 bnb4 / 28.53 q4f16 (plus ~0.3 MB graph files); decoder weights 20.96 / 10.45 / 8.66 / 7.13 / 6.87 / 4.56 MB. Totals incl. graphs: ~78.0 MB fp16, ~33.7 MB q4f16. — [HF API](https://huggingface.co/api/models/onnx-community/sam2.1-hiera-tiny-ONNX?blobs=true)
- onnx-community SAM-family repos (all created 2025-11-17/18 unless noted): sam2.1-hiera-{tiny,small,base-plus,large}-ONNX, sam2-hiera-{tiny,small,base-plus,large}-ONNX, sam3-tracker-ONNX (1,407 downloads), sam-vit-base-ONNX (created 2026-07-11). No EdgeSAM, MobileSAM or SlimSAM conversions in that org. — [HF API list](https://huggingface.co/api/models?author=onnx-community&search=sam&limit=60&sort=downloads&direction=-1)
- onnx-community/EdgeTAM-ONNX (Apache-2.0, lastModified 2025-11-14, 9,901 downloads): vision_encoder weights 19.53 MB fp32 / 9.74 fp16 / 4.91 int8; decoder 20.96 / 10.45 / 8.66 MB. Totals incl. graphs: ~20.6 MB fp16, ~14.2 MB int8, ~14.7 MB q4f16. — [HF API](https://huggingface.co/api/models/onnx-community/EdgeTAM-ONNX?blobs=true)
- onnx-community/sam3-tracker-ONNX (lastModified 2025-11-19, no licence tag): vision_encoder weights 1,869.47 MB fp32 / 934.73 fp16 / 527.11 int8 / 368.95 q4 / 341.17 bnb4 / 295.62 q4f16; decoder 22.07 / 11.01 / 9.78 / 5.12 MB (q4f16). — [HF API](https://huggingface.co/api/models/onnx-community/sam3-tracker-ONNX?blobs=true)
- Transformers.js 3.8.0 (published 19 Nov, year not shown, consistent with Nov 2025) added EdgeTAM (PR #1454) and SAM2 + SAM3 Tracker (PR #1461). Transformers.js 4.x release notes do not mention SAM, depth or background removal. — [3.8.0 release](https://github.com/huggingface/transformers.js/releases/tag/3.8.0), [releases](https://github.com/huggingface/transformers.js/releases)

#### Licences
- SAM 2 / 2.1: "model checkpoints, demo code and training code are under Apache 2.0" (repo also contains BSD-3-Clause parts, cc_torch-derived code under its own licence). — [facebookresearch/sam2](https://github.com/facebookresearch/sam2)
- SAM 3 "SAM License" (last updated 2025-11-19): non-exclusive, worldwide, non-transferable, royalty-free right to use, copy, modify and create derivatives; bans reverse engineering, ITAR / military / warfare / nuclear / espionage / weapons uses; recipients must get a copy of the licence; research publications must acknowledge use; Meta may terminate for breach and may modify the agreement (effective on posting); no user-count threshold. The extracted text does not explicitly address commercial use. A Roboflow licensing page summarises it as permitting commercial use with conditions. — [LICENSE](https://huggingface.co/facebook/sam3/blob/main/LICENSE), [Roboflow summary](https://roboflow.com/model-licenses/segment-anything-3)
- MobileSAM: Apache-2.0. — [GitHub](https://github.com/ChaoningZhang/MobileSAM)
- EdgeSAM: "licensed under NTU S-Lab License 1.0" (not Apache). The text of that licence as shipped in CodeFormer's repo (same name, S-Lab, 2022) covers "Redistribution and use for non-commercial purpose" and says to contact contributors for commercial use; EdgeSAM's own LICENSE file was not read. — [EdgeSAM](https://github.com/chongzhou96/EdgeSAM), [S-Lab LICENSE text](https://raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE)
- SlimSAM-77 (Xenova): apache-2.0 tag. EdgeTAM ONNX: apache-2.0 tag. — [SlimSAM API](https://huggingface.co/api/models/Xenova/slimsam-77-uniform?blobs=true), [EdgeTAM API](https://huggingface.co/api/models/onnx-community/EdgeTAM-ONNX?blobs=true)

#### Speed (desktop / native; no browser numbers found)
- SAM 2.1 (A100, torch 2.5.1, CUDA 12.4, video FPS): hiera_tiny 38.9M params 91.2 FPS; small 46M 84.8 FPS; base_plus 80.8M 64.1 FPS; large 224.4M 39.5 FPS. SAM 2 released 2024-07-29, SAM 2.1 released 2024-09-29/30. — [SAM 2 repo](https://github.com/facebookresearch/sam2)
- MobileSAM: ~9.66M params (encoder ~5M, decoder 3.876M); ~12 ms per image on one GPU (~8 ms encoder + ~4 ms decoder) vs ~456 ms for original SAM; ONNX export supported; HF Space on CPU ~3 s on a Mac i5. — [GitHub](https://github.com/ChaoningZhang/MobileSAM)
- EdgeSAM: 9.6M params; FPS (encoder+decoder, single prompt) iPhone 14 38.7 vs MobileSAM 4.9; RTX 2080 Ti 164.3 vs MobileSAM 103.5 vs SAM 4.3; COCO mask AP 42.2 vs MobileSAM 39.4; ONNX and CoreML exports provided; web demo is Gradio / ONNX, no WebGPU. — [GitHub](https://github.com/chongzhou96/EdgeSAM)

#### Existing in-browser projects
- websam (pre-alpha): WebGPU first with WASM fallback; default model EdgeTAM (Apache-2.0); SAM 3 Tracker as opt-in for users accepting the SAM licence; reports a SAM 2 graph-optimiser crash on a transpose pass, worked around by shipping pre-optimised .ort files; SlimSAM-77 INT8 (~14 MB) as the WASM fallback. — [GitHub](https://github.com/Rushour0/websam), [project page](https://xevion.dev/projects/websam)
- HF Spaces "Segment Anything WebGPU" (webml-community) use SlimSAM (`Xenova/slimsam-77-uniform`) with fp16 on WebGPU; a "SAM3 Tracker WebGPU" Space exists. — [Space source](https://huggingface.co/spaces/webml-community/segment-anything-webgpu/raw/main/index.html), [webml-community spaces](https://huggingface.co/webml-community/spaces)

### Inferences
- The encoder runs once per image (heavy part); the decoder runs per click (4.8 to 21 MB, interactive). The encoder dominates download and latency, so model choice = encoder choice.
- Defaults: EdgeTAM or SlimSAM-77 (14 to 21 MB, Apache-2.0); SAM 2.1 Tiny q4f16 (~34 MB) as quality tier; SAM 3 is impractical for browsers (>=296 MB encoder at 4-bit) and EdgeSAM is licence-blocked for commercial use.
- Canva "Magic Grab" equivalent = SAM mask -> cut-out layer -> inpaint the hole (see section 3).

### Gaps
- No in-browser timings (WebGPU or WASM) for any SAM variant; no quality comparison of SlimSAM vs EdgeTAM vs SAM 2.1 Tiny on single images (EdgeTAM is a video tracker).
- Sizes of SAM 2.1 small / base-plus / large ONNX not fetched. SAM 3 parameter count not verified. EdgeSAM LICENSE file not read directly; MobileSAM / EdgeSAM have no onnx-community conversion (self-export needed).

---

## 3. Inpainting and object removal (LaMa, MI-GAN, ZITS, diffusion inpainting)

### Takeaway
Two practical in-browser erasers: MI-GAN (28.1 to 29.5 MB ONNX, MIT code, 512x512 internal) and LaMa (207.5 MB fp32 ONNX, Apache-2.0 cards, fixed 512x512). Both depend on Places-family training data whose terms the model cards flag, and MI-GAN's upstream repo says weights have a separate licence file whose terms I could not confirm. Diffusion inpainting is desktop-GPU territory.

### Cited Findings
- Carve/LaMa-ONNX: lama.onnx 207.48 MB, lama_fp32.onnx 208.05 MB; tag apache-2.0; lastModified 2024-05-15; 74 likes. — [HF API](https://huggingface.co/api/models/Carve/LaMa-ONNX?blobs=true)
- edgetools/lama (big-lama export for onnxruntime-web, WASM or WebGPU EP): inputs `image` float32 [1,3,512,512] and `mask` float32 [1,1,512,512] (1 = erase); output float32 [1,3,512,512] in 0..255, to be composited over the original; fixed 512x512 so callers resize; Apache-2.0; no browser timings given; no mask dilation or crop-around-mask guidance. — [HF card](https://huggingface.co/edgetools/lama)
- LaMa upstream: trained at 256x256, "generalizes surprisingly well to much higher resolutions (~2k)"; Big-LaMa trained on Places (Places365-Standard + Places Challenge); paper WACV 2022 (arXiv 2109.07161). README does not state licence or dataset licence terms in the fetched text. — [advimman/lama](https://github.com/advimman/lama)
- MI-GAN (Picsart, ICCV 2023): code MIT; weights "see LICENSE-WEIGHTS" (separate); released migan-256 (Places2, FFHQ) and migan-512 (Places2); ONNX pipeline script; paper timings exclude pre/post-processing; no ms figures on the README. A direct fetch of LICENSE-WEIGHTS returned only the MIT software text, so the weights terms are unconfirmed. — [GitHub](https://github.com/Picsart-AI-Research/MI-GAN), [raw LICENSE-WEIGHTS fetch](https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS)
- MI-GAN ONNX files: andraniksargsyan/migan has migan.onnx 29.55 MB and migan_pipeline_v2.onnx 28.08 MB, tag MIT, lastModified 2026-09-14. imagingforgood/mi-gan-512-onnx: migan.onnx 29.55 MB; uint8 inputs image [1,3,H,W] and mask [1,1,H,W] (255 = keep, 0 = fill), uint8 output; "any size" but 512x512 internally; card says MIT for code and weights but warns Places2 terms are non-commercial research / education, so check fit. — [HF API](https://huggingface.co/api/models/andraniksargsyan/migan?blobs=true), [card](https://huggingface.co/imagingforgood/mi-gan-512-onnx)
- CONFLICT on MI-GAN size: a DEV article says "~80MB (MIGAN v2)" while the HF file listing shows 28.08 MB. The article gives only unmeasured estimates (2 to 10 s inference, 10 to 30 s load), uses `['webgpu','wasm']`, caps canvas at 1024 px, stretches the image to 512x512 and contains code bugs, so treat it as low reliability. — [DEV article](https://dev.to/linmingren/building-a-browser-based-ai-image-inpainting-tool-j61)
- Existing browser inpainting apps: lxfater/inpaint-web (WebGPU + WASM, derived from cleanup.pictures; forks list LaMa as roadmap; xesxz fork names MI-GAN). — [inpaint-web](https://github.com/lxfater/inpaint-web), [xesxz fork](https://github.com/xesxz/inpaint-web)
- IOPaint (formerly lama-cleaner): Apache-2.0, archived read-only 2025-08-13; Erase uses LaMa; also PowerPaint / V2, BrushNet, SD inpainting checkpoints (runwayml SD inpainting, SDXL inpainting 0.1), AnyText, Paint-by-Example; runs CPU, CUDA, Apple Silicon. — [GitHub](https://github.com/Sanster/IOPaint)
- Diffusion inpainting: stable-diffusion-v1-5/stable-diffusion-inpainting tag creativeml-openrail-m, repo ~15.2 GB, last modified 2024-09-06, still public. — [HF API](https://huggingface.co/api/models/stable-diffusion-v1-5/stable-diffusion-inpainting)
- SD-Turbo text-to-image runs in-browser on ORT Web WebGPU "within one second on an RTX 4090" (Microsoft, Feb 2024; snippet-level); the web-txt2img library requires WebGPU at 512x512; a planning document estimates ~2 GB download (estimate, not measured); no in-browser diffusion *inpainting* demo was found. — [Microsoft blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/), [web-txt2img listing](https://awesome.ecosyste.ms/projects/github.com%2Flacerbi%2Fweb-txt2img)

### Inferences
- Because both erasers are fixed-size 512x512, the editor must crop a context window around the mask, run the model, and composite only the hole back (feathered). Full-image resize (as in the DEV article) will blur large photos.
- MI-GAN is ~7x smaller than LaMa and is the better default for mobile / first-load; LaMa is the quality tier. Confirm MI-GAN weights terms with Picsart before shipping commercially; Places2 training-data terms apply to both.
- Diffusion inpainting should be treated as out of scope for a static, no-backend build.

### Gaps
- No measured browser (WebGPU / WASM) or desktop-GPU timings for LaMa or MI-GAN.
- ZITS licence and ONNX availability not verified (not researched beyond this); MAT / FcF not researched.
- MI-GAN LICENSE-WEIGHTS content not retrieved; LaMa upstream LICENSE file not read directly (Apache-2.0 comes from HF cards); no fp16 / int8 LaMa ONNX verified.

---

## 4. Upscaling and restoration (Real-ESRGAN, SwinIR / Swin2SR, UltraSharp-style, CodeFormer, GFPGAN, browser implementations)

### Takeaway
Real-ESRGAN General x4v3 is the standout browser upscaler (1.21M params, 4.65 MB fp32, BSD-3-Clause); x4plus is 63.9 MB. Swin2SR ONNX via Transformers.js is 15.5 to 54 MB. UltraSharp-style models (CC BY-NC-SA 4.0) and CodeFormer (NTU S-Lab, non-commercial) are not commercially usable. The popular web-realesrgan project is GPL-2.0 and TF.js-based; UpscalerJS (MIT) shows no releases and rides on a stalled TF.js.

### Cited Findings

#### Real-ESRGAN family
- Real-ESRGAN General x4v3: 1.21M params; 4.65 MB float (1.25 MB w8a8); licence BSD-3-Clause; input 128x128; Qualcomm-exported ONNX (float, w8a8) exists; NPU latency per 128x128 tile (float): 2.74 ms Snapdragon 8 Elite Gen 5, 3.49 ms 8 Elite, 4.54 ms 8 Gen 3, 6.18 ms X Elite, 9.61 ms 8 Gen 1 (ONNX, native NPU, not browser). — [Qualcomm card](https://huggingface.co/qualcomm/Real-ESRGAN-General-x4v3)
- Real-ESRGAN x4plus: 16.7M params; 63.9 MB float (16.7 MB w8a8); BSD-3-Clause; input 128x128; ONNX float 26.36 ms on Snapdragon 8 Elite Gen 5 (NPU), 65.2 ms on X Elite. — [Qualcomm card](https://huggingface.co/qualcomm/Real-ESRGAN-x4plus)
- A community browser ONNX of Real-ESRGAN x2plus (23-block RRDBNet) is BSD-3-Clause and uses `executionProviders: ['webgpu','wasm']`. — [skillsafe-ai/realesrgan-x2plus](https://huggingface.co/skillsafe-ai/realesrgan-x2plus)
- xororz/web-realesrgan runs on TensorFlow.js (WebGL default, WebGPU in Chrome, no WASM mention); fp16 model sizes: Real-ESRGAN anime_fast 1.3 MB, anime_plus 9.2 MB, general_fast 2.5 MB, general_plus 34.2 MB; Real-CUGAN 2x 2.6 MB, 4x 2.9 MB; browser WebGPU runs "roughly half the speed of local"; fp16 gives no speed-up on tfjs-webgpu; tiles stitched with default 12 px overlap; models cached in IndexedDB and a fixed input size means one download per tile size; Real-CUGAN described as 5x to 10x faster than Real-ESRGAN at similar quality; licence GPL-2.0. — [GitHub](https://github.com/xororz/web-realesrgan/)
- UpscalerJS: MIT, 904 stars, GitHub shows no releases; topics tensorflow / tfjs; patch-based processing; maintenance status not stated. — [GitHub](https://github.com/thekevinscott/UpscalerJS)

#### Transformer SR (SwinIR / Swin2SR)
- Xenova/swin2SR-classical-sr-x2-64 (x2): onnx/model.onnx 54.43 MB, fp16 32.43, q4 23.19, q8 21.47, uint8 19.03, q4f16 15.61 MB; no licence tag; lastModified 2025-07-07. — [HF API](https://huggingface.co/api/models/Xenova/swin2SR-classical-sr-x2-64?blobs=true)
- Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr (x4 real-world): model.onnx 52.77 MB, fp16 32.36, q4f16 15.54, q8 21.44, uint8 19.00 MB; no licence tag; 2,901 downloads. — [HF API](https://huggingface.co/api/models/Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr?blobs=true)
- SwinIR: "released under the Apache 2.0 license" (code based on Swin Transformer and KAIR, whose licences also apply); variants SwinIR-M classical x2/x3/x4/x8, SwinIR-S lightweight, SwinIR-M-GAN and SwinIR-L-GAN real-world x4; classical x4 model 788.6G FLOPs (RCAN comparison table); file sizes not stated. — [GitHub](https://github.com/JingyunLiang/SwinIR)

#### Licence traps and face restoration
- 4x-UltraSharp: README licence CC BY-NC-SA 4.0; the author says the model may not be used commercially and outputs probably also not (flagged as debated, not legal advice); custom permissions only by asking the author. — [UltraSharp README](https://huggingface.co/Kim2091/UltraSharp), [HF discussion](https://huggingface.co/Kim2091/UltraSharp/discussions/4)
- A permissive ESRGAN-architecture alternative on OpenModelDB: 4xNomos8kSC, CC-BY-4.0, 63.9 MB; OpenModelDB shows a licence and "Rights" section (commercial use, credit etc.) per model. — [OpenModelDB](https://openmodeldb.info/models/4x-Nomos8kSC)
- CodeFormer: NTU S-Lab License 1.0; LICENSE text limits "Redistribution and use for non-commercial purpose" and says contact the contributors for commercial purpose. — [GitHub](https://github.com/sczhou/CodeFormer), [LICENSE](https://raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE)
- GFPGAN: README states "released under Apache License Version 2.0"; v1.3 / v1.4 models; README says nothing on training-data (FFHQ) or dependency licences, and gives no file sizes. — [GitHub](https://github.com/TencentARC/GFPGAN)
- Pica (MIT): high-quality image resize in browsers (default filter mks2013, Lanczos3 legacy), uses WebAssembly + Web Workers; createImageBitmap resize disabled by default (buggy in Chrome). Useful as the non-AI resampler. — [GitHub](https://github.com/nodeca/pica)

### Inferences
- Default upscaler: Real-ESRGAN General x4v3 via ORT Web WebGPU with tiling (128 to 256 px tiles, ~12 to 16 px overlap, matching web-realesrgan's default); x4plus (63.9 MB) as an optional quality tier. Qualcomm's ONNX is NPU-oriented fixed 128x128, so you will probably re-export your own dynamic or fixed-tile fp16 graph.
- Do not copy web-realesrgan code (GPL-2.0) into Craftly; reuse only the idea. UpscalerJS is not recommended as a base (TF.js stall, see section 7).
- Face restoration: GFPGAN is the only permissively licensed option found, but sizes and training-data licensing are unverified, so treat as "later".

### Gaps
- No browser WebGPU-vs-WASM timings for any upscaler; web-realesrgan gives no seconds. No desktop-GPU numbers for Real-ESRGAN.
- Real-ESRGAN upstream LICENSE file not read directly (BSD-3-Clause comes from Qualcomm card metadata and a community card). Swin2SR upstream licence not verified (Xenova cards carry no licence tag). HAT / DAT / SPAN / Real-CUGAN licences not researched. OpenModelDB's commercial-use flags were not machine-readable in the fetch.
- CodeFormer / GFPGAN ONNX sizes not found.

---

## 5. Generative editing (FLUX Kontext, FLUX.2 klein, Qwen-Image-Edit, InstructPix2Pix)

### Takeaway
Open generative editors need desktop GPUs: Qwen-Image-Edit-2511 (20B, Apache-2.0) and FLUX.2 klein 4B (Apache-2.0, ~13 GB VRAM) are commercially usable; FLUX.1 Kontext [dev] (12B) is non-commercial for the model itself (outputs usable commercially). None can run in a browser today because ORT Web cannot load models over 4 GB.

### Cited Findings
- FLUX.1 Kontext [dev]: 12B params (BF16); licence "FLUX.1 [dev] Non-Commercial License"; card does not state VRAM or timings; paper arXiv 2506.15742, published 2025-06-17. — [HF card](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev)
- Kontext licence text: s2(b) allows access / use / distribution / derivatives only for Non-Commercial Purposes, defined (s1(c)) to exclude revenue-generating activity, use affecting end users, and training or distilling models for commercial use; s2(d) "You may use Output for any purpose (including for commercial purposes), except as expressly prohibited herein", but not to train / fine-tune / distil a competing model; s2(e) requires content-filtering measures; commercial licence must be requested from the company (fee or revenue share possible); s3 distribution needs licence copy and attribution. — [LICENSE.md](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/blob/main/LICENSE.md)
- FLUX.2 [klein] (released 2026-01-15): 4B distilled and 4B Base under Apache 2.0; 9B distilled and 9B Base under the FLUX Non-Commercial License (renamed from "FLUX [dev] Non-Commercial License", no material changes); 4B fits ~13 GB VRAM (RTX 3090 / 4070 and up); FP8 uses up to 40% less VRAM, NVFP4 up to 55% less; claims generation or editing under 0.5 s on "modern hardware" (GPU unspecified; Elo-vs-latency charts on GB200 bf16); quantised speed-ups at 1024x1024 t2i on RTX 5080 / 5090: FP8 up to 1.6x, NVFP4 up to 2.7x; 4B supports text-to-image, image-to-image and multi-reference editing; 9B is step-distilled to 4 steps. — [BFL blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)
- CONFLICT on klein 4B VRAM: BFL blog and HF card say ~13 GB; the flux2 GitHub wiki says ~8 GB (unconfirmed outlier). — [BFL blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence), [wiki](https://github.com/black-forest-labs/flux2/wiki)
- Qwen-Image-Edit-2511: "Qwen-Image is licensed under Apache 2.0"; 20B params (BF16); changes vs 2509: less image drift, better character consistency, integrated LoRA effects, industrial-design and geometric reasoning; recommended 40 steps, true_cfg_scale 4.0, guidance_scale 1.0; GPU memory not stated on the card; model tree lists 34 quantisations. — [HF card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)
- Qwen-Image-Edit-2511 local sizes (third-party guide, unofficial): GGUF (unsloth) Q4_K_M ~13.2 GB for 16 GB cards, Q4_0 ~11.9 GB for 12 GB cards, plus a separate ~9 GB text encoder; Macs need 32 GB (48 GB+ comfortable). — [guide](https://localaimaster.com/blog/qwen-image-edit-local-guide)
- Nunchaku (SVDQuant 4-bit): 4-bit Qwen-Image-Edit with 4/8-step Lightning variants released 2025-09-09; README claims Qwen-Image VRAM can drop to ~3 GiB with async offloading; FLUX.1 Kontext supported since June 2025; supports sm_80/86/89 GPUs (INT4) and RTX 50 series (FP4); general FLUX.1 claim 3.5x less memory and 3.0x speed-up vs NF4 W4A16 on RTX 4090. No seconds-per-image figures for Kontext or Qwen-Edit found. — [Nunchaku](https://github.com/nunchaku-ai/nunchaku)
- InstructPix2Pix (timbrooks): licence tag MIT; 0.9B params (F32 safetensors); example uses 10 inference steps in fp16; base model, resolution and VRAM not stated on the card. — [HF card](https://huggingface.co/timbrooks/instruct-pix2pix)
- Browser feasibility limit: ORT Web docs state WASM memory is limited to 4 GB (32-bit addressing), "Currently, there is no way for ONNX Runtime Web to run models larger than 4GB", Chrome's max ArrayBuffer is ~2 GB, protobuf limit 2 GB, Memory64 not supported yet. — [ORT large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)

### Inferences
- Weights arithmetic (not sourced): 12B BF16 is about 24 GB and 20B BF16 about 40 GB, so Kontext and Qwen-Edit cannot ship to browsers; even 4-bit klein 4B (~2 to 3 GB of transformer weights plus text encoder) is unproven in ORT Web.
- For "generative edit" in a no-backend product the only options are (a) skip it, (b) a user-configured local endpoint (e.g. their own ComfyUI / diffusers server) or BYO-API key, or (c) tiny SD-Turbo-class text-to-image. Licence-wise, prefer klein 4B or Qwen-Image-Edit-2511 (Apache-2.0) over Kontext [dev].

### Gaps
- Other open editors (Step1X-Edit, OmniGen2, Z-Image-Edit, LongCat-Image-Edit, HiDream-E1, FLUX.1 Fill) were not researched.
- No seconds-per-image numbers for Kontext or Qwen-Image-Edit; no official VRAM figure for Qwen-Image-Edit-2511; no WebGPU port of klein or Qwen found; InstructPix2Pix base model (SD 1.5 per the paper) not confirmed on the card.

---

## 6. Other helpful models: depth estimation, colourisation, text detection / OCR

### Takeaway
Depth Anything V2 Small (Apache-2.0, 19 to 99 MB ONNX) and Depth Anything 3 Small/Base (Apache-2.0) are the commercial-safe depth options; V2 Base and DA3 Large are CC-BY-NC-4.0. DDColor (Apache-2.0) has an ONNX export script but no browser build was verified. PP-OCRv5 mobile ONNX is only 4.8 MB (detector) + 16.5 MB (recogniser).

### Cited Findings
- onnx-community/depth-anything-v2-small (Apache-2.0, lastModified 2026-04-14, 134,422 downloads): model.onnx 99.06 MB; fp16 49.64; q4 27.40; int8 / quantized / uint8 27.26; bnb4 26.08; q4f16 19.13 MB. — [HF API](https://huggingface.co/api/models/onnx-community/depth-anything-v2-small?blobs=true)
- Depth-Anything-V2-Base-hf: licence tag cc-by-nc-4.0; 97.47M params. (Large / Giant V2 licences not fetched.) — [HF API](https://huggingface.co/api/models/depth-anything/Depth-Anything-V2-Base-hf)
- Depth Anything 3 (Nov 2025): DA3-SMALL apache-2.0, model.safetensors 137.25 MB (lastModified 2025-11-13, 193,638 downloads); DA3-BASE apache-2.0, 541.52 MB (2025-11-15); DA3-LARGE cc-by-nc-4.0, 1,643.84 MB (2025-11-19). — [DA3-SMALL](https://huggingface.co/api/models/depth-anything/DA3-SMALL?blobs=true), [DA3-BASE](https://huggingface.co/api/models/depth-anything/DA3-BASE?blobs=true), [DA3-LARGE](https://huggingface.co/api/models/depth-anything/DA3-LARGE?blobs=true)
- Third-party DA3 conversions (unverified): a Small LiteRT build at FP16 55 MB; a Base ONNX export of ~394 MB fp32 / ~198 MB fp16 (differs from the 541.5 MB official safetensors, likely different artefact scope). — [LiteRT](https://huggingface.co/mlboydaisuke/Depth-Anything-3-Small-LiteRT), [SpatialHub ONNX](https://huggingface.co/SpatialHub/depth-anything-3-onnx)
- Transformers.js has a `depth-estimation` pipeline (DepthEstimationPipeline); the v3 launch post lists Apple Depth Pro for monocular depth. — [pipelines docs](https://huggingface.co/docs/transformers.js/api/pipelines), [v3 blog](https://huggingface.co/blog/transformersjs-v3)
- DDColor: Apache-2.0; variants ddcolor_paper, ddcolor_modelscope, ddcolor_artistic, ddcolor_paper_tiny (tiny released 2023-12-13); ONNX export script `scripts/export_onnx.py` (uses the tiny model); piddnad/ddcolor_paper_tiny pytorch_model.bin is 220.37 MB (apache-2.0 tag). CodeFormer also offers colourisation but is non-commercial. — [DDColor](https://github.com/piddnad/DDColor), [HF API](https://huggingface.co/api/models/piddnad/ddcolor_paper_tiny?blobs=true)
- PP-OCRv5 mobile ONNX for onnxruntime-web (community repo nakamura196/ppocrv5-mobile-web-onnx, tag apache-2.0, lastModified 2026-10-14): PP-OCRv5_mobile_det.onnx 4.77 MB; PP-OCRv5_mobile_rec.onnx 16.54 MB; latin rec 8.04 MB; dictionaries ~0.1 MB. Official PaddleOCR.js browser SDK exists per search listing (docs page returned 404 on fetch); ppu-paddle-ocr auto-enables WebGPU; ffocr tries webgpu -> webnn -> webgl -> wasm. — [HF API](https://huggingface.co/api/models/nakamura196/ppocrv5-mobile-web-onnx?blobs=true), [PaddleOCR browser docs (search result)](https://www.paddleocr.ai/latest/en/version3.x/deployment/browser.html)
- Tesseract.js: Apache-2.0, WebAssembly port of Tesseract, v7 appears latest (needs Node 16+ for server use); v5 cut default file sizes 54% (English) / 73% (Chinese); v6 fixed a memory leak. — [GitHub](https://github.com/naptha/tesseract.js)
- Transformers.js 4.0.0 added LightOnOCR and GLM-OCR; v3 supports Florence-2 (captioning / OCR-style tasks); `image-to-text` pipeline covers OCR. — [releases](https://github.com/huggingface/transformers.js/releases), [v3 blog](https://huggingface.co/blog/transformersjs-v3)

### Inferences
- Depth is a "nice to have" for Craftly (depth-aware blur / fake bokeh, 3D parallax): Depth Anything V2 Small q4f16 (19 MB) is the cheapest entry point.
- OCR / text detection would enable "edit text in image" features: PP-OCRv5 detector + recogniser (~21 MB combined) is small enough to bundle.

### Gaps
- No speed numbers for depth, colourisation or OCR in browsers. DDColor browser ONNX size and quality not verified; DeOldify licence not checked. Depth Anything V2 Large / Giant licences and DA3 Giant not fetched. PaddleOCR upstream licence not re-verified (HF repo tag only).

---

## 7. Browser runtime status in 2026 (ORT Web, Transformers.js v3/v4, WebNN, TF.js, caching, memory, mobile Safari)

### Takeaway
ONNX Runtime Web 1.31.1 and Transformers.js 4.3.2 (C++ WebGPU runtime, Safari 26 WebGPU enabled) are current; WebGPU now ships in Chrome / Edge, Firefox (Windows 141, macOS 145 ARM) and Safari 26. WebNN is still a W3C Candidate Recommendation behind an origin trial; TF.js has had no stable release since Oct 2024. Browser storage allows large model caches, but iOS memory pressure remains undocumented and anecdotal.

### Cited Findings

#### ONNX Runtime Web
- npm `onnxruntime-web` latest 1.31.1 (MIT), dev tag 1.32.0-dev.20261102, package 150.6 MB unpacked. — [npm latest](https://registry.npmjs.org/onnxruntime-web/latest), [dist-tags](https://registry.npmjs.org/-/package/onnxruntime-web/dist-tags)
- Stock 1.31.1 binaries: ort-wasm-simd-threaded.wasm 14.85 MB; ...jsep.wasm (WebGPU) 29.52 MB; ...jspi.wasm 17.92 MB; ...asyncify.wasm 28.75 MB; JS bundles ort.min.js 371.8 KB, ort.webgpu.min.js 70.8 KB, ort.wasm.min.js 53.8 KB. — [jsDelivr listing](https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat)
- ORT release notes (months only, years not shown): 1.31.1 (26 Oct), 1.31.0 (09 Oct: WebGPU generative-AI ops, explicit session-stream concurrency, AMD subgroup-matrix kernels), 1.30.0 (10 Sep: improved WebGPU PagedAttention); WebGPU plugin EP v0.5.0 (29 Oct). No Memory64 or Safari items on the page. — [ORT releases](https://github.com/microsoft/onnxruntime/releases)
- Docs: import `onnxruntime-web/webgpu`, set `executionProviders: ['webgpu']`; graph capture for static shapes; IO binding / `preferredOutputLocation` to keep tensors on GPU; WASM threads need `crossOriginIsolated` (numThreads default = min(4, hardwareConcurrency/2)); `env.wasm.proxy` does not work with the WebGPU EP; `freeDimensionOverrides` fixes free dims; `wasmPaths` must match the JS build. The ORT WebGPU page still says Firefox is flag-only and Safari Technology Preview only, which is stale versus web.dev (below). — [env flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html), [WebGPU EP](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- Large models: protobuf 2 GB limit; WASM 4 GB limit; use `externalData` and cache with Cache API or OPFS; Memory64 not supported (doc undated). — [ORT large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)

#### Transformers.js
- v3 (2024-10-22): WebGPU "up to 100x faster than WASM" (unspecified models), 120 architectures, 1,200+ pre-converted models, dtypes fp32 / fp16 / q8 / int8 / uint8 / q4 / bnb4 / q4f16; package `@huggingface/transformers`. — [v3 blog](https://huggingface.co/blog/transformersjs-v3)
- v4: preview blog dated 2026-02-09; new WebGPU runtime rewritten in C++ with the ONNX Runtime team, tested on ~200 architectures, runs in browsers, Node, Bun and Deno; BERT embeddings ~4x faster via MultiHeadAttention; `transformers.web.js` 53% smaller; build time 2 s -> 200 ms; `ModelRegistry` (get_pipeline_files, get_file_metadata, is_pipeline_cached, clear_pipeline_cache, get_available_dtypes); `env.useWasmCache` for offline use; blog does not mention image models. — [v4 blog](https://huggingface.co/blog/transformersjs-v4)
- GitHub releases (years not shown): 4.0.0 (30 Mar), 4.1.0 and 4.2.0 (23 Apr; q1/q2 dtypes added in 4.1.0), 4.3.0 (16 Sep: "WebGPU for Safari 26+"), 4.3.1 (07 Oct), 4.3.2 (28 Oct, latest on page). WebNN not mentioned in any 4.x note. — [releases](https://github.com/huggingface/transformers.js/releases)
- Runtime payload: the HF Cross-Origin Storage post says Transformers.js's `ort-wasm-simd-threaded.asyncify.wasm` is 4,733 kB and shared by all Transformers.js apps; stock onnxruntime-web 1.31.1 ships a 28.75 MB file of the same name (different build). — [COS post](https://huggingface.co/blog/cross-origin-storage), [jsDelivr listing](https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat)

#### WebGPU availability (web.dev, 2025-11-25)
- Chrome / Edge: since 113 on Windows (D3D12), macOS, ChromeOS; Chrome Android since 121 on Android 12+ with Qualcomm / ARM GPUs; Linux in progress. Firefox: Windows since 141; macOS Tahoe 26 on ARM64 since 145; Intel Macs, Linux, Android in progress. Safari 26: macOS Tahoe 26, iOS 26, iPadOS 26, visionOS 26. — [web.dev](https://web.dev/blog/webgpu-supported-major-browsers)

#### WebNN
- W3C Candidate Recommendation Snapshot 2026-01-22; a later Candidate Recommendation Draft dated 2026-03-27; additions include a third wave of operators for transformers, the MLTensor API and device selection. Chrome ran an Intent to Experiment / origin trial (Android excluded from the origin trial on 2026-02-13 due to immaturity); no source found confirming default-on in stable Chrome; one August 2026 blog says not enabled by default as of mid-2026. ORT Web has a WebNN EP (device types cpu / gpu / npu). — [W3C CR 2026-01-22](https://www.w3.org/TR/2026/CR-webnn-20260122/), [W3C spec](https://www.w3.org/TR/webnn), [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98), [ORT WebNN EP](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)

#### TensorFlow.js
- Latest stable `@tensorflow/tfjs` 4.22.0 published 2024-10-21; only a 4.23.0-rc.0 (2025-01-08) after it; GitHub marks 4.22.0 "Latest" (a WebGPU adapter-info fix); no stated end-of-support. — [deps.dev](https://api.deps.dev/v3/systems/npm/packages/@tensorflow%2Ftfjs), [GitHub releases](https://github.com/tensorflow/tfjs/releases)

#### Caching and storage
- Per-origin quotas (MDN): Chromium up to 60% of total disk; Firefox best-effort min(10% of disk, 10 GiB) and persistent up to 50% of disk; Safari (browser apps, macOS 14 / iOS 17+) ~60% of disk, embedded WebViews ~15%; IndexedDB, Cache API and OPFS share one pool; `navigator.storage.persist()` auto-decides in Chromium / Safari and prompts in Firefox; Safari deletes script-created data for origins with no user interaction in 7 days when tracking prevention is on; eviction is all-or-nothing per origin; writes over quota raise `QuotaExceededError`. — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- Cross-Origin Storage (WICG proposal, `navigator.crossOriginStorage`, files addressed by hash): guest post by Chrome's Thomas Steiner, 2026-06-23; no browser implements it natively yet (extension polyfill only); Transformers.js has `env.experimental_useCrossOriginStorage = true` with fallback to the Cache API; a second-origin Whisper load re-downloaded ~177 MB. — [HF post](https://huggingface.co/blog/cross-origin-storage), [WICG spec](https://wicg.github.io/cross-origin-storage/)
- Transformers.js 4.x adds `env.useWasmCache`, `is_pipeline_cached`, `clear_pipeline_cache`, and (4.3.0) an updated Cross-Origin Storage integration. — [releases](https://github.com/huggingface/transformers.js/releases), [v4 blog](https://huggingface.co/blog/transformersjs-v4)

#### Memory limits and mobile Safari (anecdotal)
- No official Apple figure for an iOS Safari memory cap was found. Reports: iOS enforces a policy-based cap rather than a physical limit; tabs reload with no catchable JS error under model load (iPhone 11 Pro Max, iOS 18.7 with WebLLM / wllama); one iPhone reported WebGPU `maxBufferSize` 715,827,880 bytes; advice is to shard .onnx external data, use fp16 / quantised weights and release GPU buffers. WebKit bugs 300782 (texture-heavy pages killed under memory pressure) and 302711 (iOS WebGPU crash accumulating over time, Metal resource tracking). — [HN thread](https://hackernews-dynamic.seasondane.workers.dev/news/48624985), [WebKit 300782](https://bugs.webkit.org/show_bug.cgi?id=300782), [WebKit 302711](https://bugs.webkit.org/show_bug.cgi?id=302711), [Show HN thread](https://brianlovin.com/hn/47995037)

### Inferences
- Use Transformers.js v4 for Hugging Face-hosted pipelines (smaller runtime, Safari 26 WebGPU enabled, ModelRegistry cache helpers) and raw ORT Web where custom pre/post-processing is needed (MI-GAN, Real-ESRGAN, SlimSAM decoder loops). Whether both can share one ORT build is unverified.
- Static hosting without header control cannot enable WASM threads (COOP/COEP); the WebGPU path does not need cross-origin isolation, so make WebGPU the primary path and accept single-thread WASM as a fallback only for the smallest models.
- Budget iOS conservatively: keep each loaded model under ~100 to 150 MB, unload models after use, and test on real devices (this threshold is a judgement, not a sourced limit).
- Safari's 7-day eviction means returning users may re-download models; call `navigator.storage.persist()` and show cache status via `is_pipeline_cached`.

### Gaps
- ORT Web feature status for Memory64 and the WebGPU EP's fp16 / `shader-f16` handling in 2026 not confirmed; ORT release years not displayed on the fetched page (versions cross-checked against npm).
- No data on Firefox / Safari WebGPU performance relative to Chrome, nor Android Chrome real-world model support. WebNN stable-Chrome status unresolved. No firm iOS memory budget.

---

## 8. Classical (non-AI) photo-editing tools: libraries and what Photopea / Pixlr implement

### Takeaway
Canvas 2D already gives Craftly 15 native blend modes; curves, levels, sharpen and denoise are straightforward LUT / convolution / WebGL work (glfx.js, Photon, OpenCV.js give reference implementations). Healing and clone need OpenCV.js `inpaint` (whitelisted) or a custom build for Poisson `seamlessClone`; liquify has no maintained open-source browser library found. Photopea (proprietary, JS, ad-supported) is a full Photoshop-class clone; Pixlr leans on AI tools.

### Cited Findings

#### Photopea
- Proprietary, written in JavaScript, runs in browsers, created by Ivan Kutskir, first release 2013-09-14, Wikipedia lists latest stable 5.6 dated 2024-09-26 (the Photopea blog post for 5.6 is dated 2024-04-22, a minor mismatch); free with ads, premium ad-free plan, self-hosted corporate edition $500 to $2,000 per month; formats PSD, JPEG, PNG, DNG, GIF, SVG, PDF. — [Wikipedia](https://en.wikipedia.org/wiki/Photopea)
- Photopea docs: raster + vector, multiple colour spaces (ICC profiles), 8 / 16 / 32-bit depth, works offline with files staying on the device; topic list includes Layers, Masks, Layer Styles, Smart Objects, Other Layers, Free Transform, Adjustments & Filters, Selections (Make, Advanced, Refine Edge, Channels), Brush Tools, Basic / Advanced / Smart Tools, Text, Vector Graphics, Video, Actions, Scripts, Artboards, Color Spaces, Vanishing Point Filter, Blur Gallery Filter, Layer Comps. — [Learn index](https://www.photopea.com/learn/)
- Adjustments page names Levels (Ctrl+L), Curves (Ctrl+M), Hue / Saturation (Ctrl+U); no other adjustment is named there. — [Adjustments & Filters](https://www.photopea.com/learn/adjustments-filters)
- Smart Tools: Spot Healing Brush (paint over objects, fills from surroundings), Healing Brush (clone-like, blends after release), Patch (select area, drag to source, blends on release); Photopea says these "use artificial intelligence" without naming a model; Clone Stamp is the manual comparison. — [Smart Tools](https://www.photopea.com/learn/bt-smart)
- Advanced Tools: Blur, Sharpen, Dodge, Burn, Smudge, Sponge brushes. — [Advanced Tools](https://www.photopea.com/learn/bt-advanced)
- Layers: blend mode selector and opacity at top of the Layers panel (blend-mode list not on page), raster-mask button, layer folders (nestable), locks for Transparency / Pixels / Position / All. — [Layers](https://www.photopea.com/learn/layers)
- Blog milestones: Puppet Warp 4.7 (2020-03-01), Shadows / Highlights 4.8 (2020-06-11), Vanishing Point + Peadrive 5.4 (2022-11-22), Blur Gallery 5.5 (2023-12-31), Advanced Color Depth 5.6 (2024-04-22); scripts since 2.9 (2017). No 2025 / 2026 posts or AI-feature posts were visible in the fetched blog page. — [Photopea blog](https://blog.photopea.com/)

#### Pixlr
- Home page lists AI tools: Remove Background, Generative Fill, Generative Expand, Remove Object, Super Scale (up to 25 megapixels), Face Swap, Image Generator, Generative Transform, Super Sharp, Remove Noise, Skin Enhancer, Colorize, Backdrop, Sticker Maker, Instruct Editor, Extract Layers; classical items named: layers, masks, filters, effects, brightness / contrast, text, overlays, portrait retouching; free tier works without an account, paid from $1.99 per month. Blend modes, curves, levels and liquify are not named on the page. — [pixlr.com](https://pixlr.com/)
- History: rebuilt in HTML5 in 2019 (Pixlr X / E / M); Dec 2021 added brushes, Heal tool, animation and 50-image batch upload; Pixlr Group formed Nov 2023. — [Wikipedia](https://en.wikipedia.org/wiki/Pixlr)

#### Libraries and primitives
- Canvas 2D `globalCompositeOperation` supports 15 blend modes (multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity) plus 11 Porter-Duff operators; Baseline "widely available" since July 2015; unsupported strings are ignored. — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)
- glfx.js (MIT, WebGL, 3.5k stars, 44 commits, no releases, last activity date not shown): curves ("an arbitrary function"), brightnessContrast, hueSaturation, vibrance, denoise ("9x9 box filter weighted by color intensity, similar to a bilateral filter"), unsharpMask, noise, sepia, vignette, lensBlur, triangleBlur, zoomBlur, tiltShift, bulgePinch, swirl, perspective, matrixWarp, plus stylised filters. — [GitHub](https://github.com/evanw/glfx.js), [docs](https://evanw.github.io/glfx.js/docs/)
- Photon (Apache-2.0, Rust to WASM, v0.3.2): 96 functions; HSL / LCh / sRGB manipulation; Sobel / Laplace / blur convolutions and sharpening; channel ops; 10 blending techniques; resize / crop / rotate / flip; PNG, JPEG, BMP, ICO, TIFF, WEBP; benchmarks only linked. — [GitHub](https://github.com/silvia-odwyer/photon)
- OpenCV.js default build whitelist (4.x branch): modules core, imgproc, objdetect, video, dnn, features2d, photo, calib3d; photo exposes `inpaint` and `createMergeMertens` only; `fastNlMeansDenoising`, `fastNlMeansDenoisingColored` and `seamlessClone` are not whitelisted; imgproc includes bilateralFilter, GaussianBlur, medianBlur, warpAffine, remap, createCLAHE, grabCut, watershed. — [opencv_js.config.py](https://raw.githubusercontent.com/opencv/opencv/4.x/platforms/js/opencv_js.config.py)
- Pica (MIT) for high-quality resampling, see section 4. — [GitHub](https://github.com/nodeca/pica)

### Inferences
- Tool-to-implementation map (judgement): Curves / Levels = 256-entry per-channel LUT built from a monotone cubic spline, applied in WebGL or on `ImageData` in a worker; HSL / selective colour = per-hue range weights; Blend modes = native `globalCompositeOperation` if the renderer composites layers on a 2D canvas; Clone stamp = offset copy with soft brush; Healing = `cv.inpaint` (Telea / NS) now, Poisson blending via custom OpenCV.js build or own WebGL later; Sharpen = unsharp mask (glfx or own shader); Denoise = bilateral (`cv.bilateralFilter`) or a small NN denoiser; Liquify = GPU displacement-field warp (no maintained library found, build in-house); Resize = pica.
- Copy Photopea's order of priorities: Levels / Curves / Hue-Saturation, then Spot Healing / Clone, then Dodge / Burn / Sharpen / Blur brushes. Both Photopea and Pixlr market "AI" in healing / removal, which maps onto section 3 models.

### Gaps
- Photopea and Pixlr full classical feature lists could not be verified: Photopea docs did not list Selective Color, Liquify, Unsharp Mask, noise reduction or the blend-mode names; Pixlr page named no blend modes, curves, levels or liquify. Photopea's AI-feature history (2025 to 2026) not found.
- OpenCV.js licence and bundle size not fetched; glfx.js and Photon last-commit dates not shown; no open-source browser liquify implementation located.

---

## 9. Recommended minimal stack for a Craftly "Photo tools" panel (downloads, effort, licence flags)

### Takeaway
A commercially clean default set is about 168 MB of one-time model downloads: BiRefNet_lite fp16 (background), EdgeTAM fp16 (click-to-select), MI-GAN (magic eraser) and Real-ESRGAN General x4v3 (upscale), with a ~51 MB low-bandwidth set. All four run through ORT Web / Transformers.js on WebGPU with Cache API storage. Estimated solo effort is roughly 13 to 20 working days for the four features plus 2 to 3 days of shared infrastructure (judgement, not sourced). Generative editing should be deferred or handled via a user-supplied local endpoint.

### Cited Findings (candidate table; sizes and licences from earlier sections)

| Feature | Default model and precision | Download (MB) | Licence flag | Source |
|---|---|---|---|---|
| Background remover | BiRefNet_lite fp16 | 114.54 | MIT (OK) | [HF API](https://huggingface.co/api/models/onnx-community/BiRefNet_lite-ONNX?blobs=true) |
| Background remover, low-bandwidth / portraits | MODNet q8 | 6.63 | Apache-2.0 (OK) | [HF API](https://huggingface.co/api/models/Xenova/modnet?blobs=true) |
| Background remover, quality tier | BiRefNet fp16 | 489.67 | MIT (OK) | [HF API](https://huggingface.co/api/models/onnx-community/BiRefNet-ONNX?blobs=true) |
| Click-to-select | EdgeTAM fp16 (enc + dec) | ~20.6 | Apache-2.0 (OK) | [HF API](https://huggingface.co/api/models/onnx-community/EdgeTAM-ONNX?blobs=true) |
| Click-to-select, low-bandwidth | EdgeTAM int8 or SlimSAM-77 q8 | ~14.2 or ~13.8 | Apache-2.0 (OK) | [EdgeTAM](https://huggingface.co/api/models/onnx-community/EdgeTAM-ONNX?blobs=true), [SlimSAM](https://huggingface.co/api/models/Xenova/slimsam-77-uniform?blobs=true) |
| Click-to-select, quality tier | SAM 2.1 Tiny fp16 (or q4f16 ~33.7) | ~78.0 | Apache-2.0 (OK) | [HF API](https://huggingface.co/api/models/onnx-community/sam2.1-hiera-tiny-ONNX?blobs=true) |
| Magic eraser | MI-GAN (migan_pipeline_v2.onnx) | 28.08 | MIT code; weights terms unconfirmed; Places2 caveat (CHECK) | [HF API](https://huggingface.co/api/models/andraniksargsyan/migan?blobs=true), [GitHub](https://github.com/Picsart-AI-Research/MI-GAN) |
| Magic eraser, quality tier | LaMa fp32 | 207.48 | Apache-2.0 per cards; Places dataset caveat | [HF API](https://huggingface.co/api/models/Carve/LaMa-ONNX?blobs=true) |
| Upscaler | Real-ESRGAN General x4v3 (fp32; fp16 ~2.4 by arithmetic) | 4.65 | BSD-3-Clause (OK) | [Qualcomm card](https://huggingface.co/qualcomm/Real-ESRGAN-General-x4v3) |
| Upscaler, quality tier | Real-ESRGAN x4plus | 63.9 | BSD-3-Clause (OK) | [Qualcomm card](https://huggingface.co/qualcomm/Real-ESRGAN-x4plus) |
| Runtime | Transformers.js v4 wasm ~4.7 MB, or stock ORT Web 14.85 to 29.52 MB | 4.7 to 29.5 | MIT (ORT Web) | [COS post](https://huggingface.co/blog/cross-origin-storage), [jsDelivr](https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat) |

- Avoid list with reasons: RMBG-1.4 / 2.0 (non-commercial, Bria agreement) — [RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0); @imgly/background-removal (AGPL-3.0) — [README](https://raw.githubusercontent.com/imgly/background-removal-js/main/packages/web/README.md); EdgeSAM (NTU S-Lab, non-commercial) — [EdgeSAM](https://github.com/chongzhou96/EdgeSAM); 4x-UltraSharp (CC BY-NC-SA 4.0) — [README](https://huggingface.co/Kim2091/UltraSharp); CodeFormer (S-Lab) — [LICENSE](https://raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE); web-realesrgan code (GPL-2.0) — [GitHub](https://github.com/xororz/web-realesrgan/); FLUX.1 Kontext [dev] and FLUX.2 klein 9B (non-commercial model licence) — [Kontext LICENSE](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/blob/main/LICENSE.md), [BFL blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence); SAM 3 (custom licence, >=296 MB) — [LICENSE](https://huggingface.co/facebook/sam3/blob/main/LICENSE).

### Inferences
- Default download set (computed): 114.54 (BiRefNet_lite fp16) + 20.6 (EdgeTAM fp16) + 28.08 (MI-GAN) + 4.65 (Real-ESRGAN x4v3) = ~167.9 MB, plus 4.7 to 29.5 MB of runtime. Low-bandwidth set (computed): 6.63 (MODNet q8) + 14.2 (EdgeTAM int8) + 28.08 (MI-GAN) + ~2.4 (Real-ESRGAN fp16) = ~51.3 MB. Download each model only when its tool is first opened (lazy), never at app start.
- Architecture: one module Web Worker owning the runtime and model cache; WebGPU primary path, WASM fallback only for MODNet / SlimSAM / Real-ESRGAN-general; fixed-shape fp16 exports to avoid WebGPU shape-inference problems; tile + overlap for upscaling; crop-around-mask for erasing; encoder-once / decoder-per-click for selection; results returned as masks / ImageBitmaps into the existing layer model; persist cache via `navigator.storage.persist()`.
- Effort estimates (solo, my judgement, not sourced; assumes workers / IndexedDB infrastructure already exist): background remover 2 to 3 days (pipeline, worker, progress UI, edge refine / feather); click-to-select 4 to 6 days (separate encoder / decoder, point and box prompts, multi-click refine, mask-to-layer); magic eraser 4 to 6 days (brush UI, mask dilation, crop / composite, undo); upscaler 3 to 5 days (ONNX re-export, tiling, memory management, progress); shared infra (model manager, licence/attribution screen, device capability check, fallbacks) 2 to 3 days. Total ~15 to 23 days; classical tools (curves / levels / HSL, healing / clone, blend modes) are separate, ~2 to 4 days each.
- Cross-origin isolation headers should be a hosting requirement if WASM threads are wanted (GitHub Pages cannot set them; Netlify / Cloudflare Pages can; this hosting detail is from general knowledge, not sourced here).
- Add a "Credits and licences" screen listing model licences (Apache-2.0 / MIT / BSD-3 notices) to satisfy attribution clauses.

### Gaps
- None of the four defaults has a measured in-browser benchmark; a small harness measuring warm-up + per-image latency on a mid-range laptop, a phone and Safari 26 is needed before committing to UX targets.
- Real-ESRGAN General x4v3 and MI-GAN require your own browser-tuned export / verification (no verified onnx-community build in this session); BiRefNet_lite ONNX usage (processor, normalisation, 1024 input) not read.
- MI-GAN weights licence and Places2 / Places training-data commercial status are unresolved and should be checked with the authors (or replaced by LaMa) before a commercial launch.
- Generative edit (klein 4B / Qwen-Image-Edit) is not browser-feasible today; no tested bring-your-own-endpoint pattern was researched.
