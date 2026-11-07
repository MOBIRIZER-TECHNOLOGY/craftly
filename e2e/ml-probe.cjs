/*
 * Tries an ONNX model file on this computer's GPU before it is wired into the app: its inputs and outputs, how long the
 * session takes, whether runs on noise succeed and how long they take, optionally whether it reproduces a reference output,
 * and the graph nodes that bind the most buffers. A GPU shader can bind only 16 buffers on many cards, and BiRefNet lite
 * failed on exactly that (a Concat of 1,024 tensors), see docs/ON-DEVICE-AI.md. Run this first for every candidate model.
 *
 *   npm run build && npm run preview                       (a production build: its runtime files are used here)
 *   BASE=http://127.0.0.1:4173 MODEL=C:/models/isnet_fp16.onnx node e2e/ml-probe.cjs
 *
 * Options (environment variables):
 *   DIM      size of every dynamic dimension except the batch, default 1024 (a picture model: try the tile size it will get)
 *   RUNS     timed runs after the first one, default 2
 *   REF_IN / REF_OUT   two .npy files (float32): one run on REF_IN has to give REF_OUT, the largest difference is reported
 *
 * Nothing is downloaded: MODEL (and REF_IN, REF_OUT) are files you already have. They are served to the page from this
 * process on a local port.
 */
const fs = require("node:fs");
const http = require("node:http");
const { launch, BASE } = require("./lib.cjs");

const MODEL = process.env.MODEL;
const DIM = Number(process.env.DIM) || 1024;
const RUNS = Number(process.env.RUNS) || 2;
const REF_IN = process.env.REF_IN;
const REF_OUT = process.env.REF_OUT;
if (!MODEL || !fs.existsSync(MODEL)) {
  console.log("Set MODEL to the path of an .onnx file, e.g. MODEL=C:/models/model.onnx");
  process.exit(2);
}
if (!!REF_IN !== !!REF_OUT || [REF_IN, REF_OUT].some((f) => f && !fs.existsSync(f))) {
  console.log("Set both REF_IN and REF_OUT to existing .npy files, or neither");
  process.exit(2);
}

/** Runs in the page: the graph's widest nodes, then a session, runs on noise and the reference check. */
async function probe({ modelUrl, ortUrl, wasmUrl, dim, runs, refInUrl, refOutUrl }) {
  const report = { steps: [] };
  const note = (s) => report.steps.push(s);
  try {
    const bytes = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
    note(`model ${bytes.length} bytes`);

    // --- the widest nodes of the graph (a minimal protobuf walk: ModelProto.graph = field 7, GraphProto.node = field 1)
    const dec = new TextDecoder();
    const read = (start, end) => {
      const out = [];
      let i = start;
      const varint = () => {
        let r = 0;
        let s = 0;
        for (;;) {
          const b = bytes[i++];
          r += (b & 0x7f) * 2 ** s;
          if (!(b & 0x80)) return r;
          s += 7;
        }
      };
      while (i < end) {
        const key = varint();
        const field = Math.floor(key / 8);
        const wire = key % 8;
        if (wire === 0) out.push({ field, value: varint() });
        else if (wire === 2) {
          const len = varint();
          out.push({ field, start: i, end: i + len });
          i += len;
        } else if (wire === 1) i += 8;
        else if (wire === 5) i += 4;
        else throw new Error("unexpected wire type " + wire);
      }
      return out;
    };
    const graph = read(0, bytes.length).find((f) => f.field === 7);
    const nodes = [];
    for (const g of read(graph.start, graph.end)) {
      if (g.field !== 1) continue;
      let buffers = 0;
      let name = "";
      let op = "";
      for (const p of read(g.start, g.end)) {
        if (p.field === 1 || p.field === 2) buffers++;
        else if (p.field === 3) name = dec.decode(bytes.subarray(p.start, p.end));
        else if (p.field === 4) op = dec.decode(bytes.subarray(p.start, p.end));
      }
      nodes.push({ op, name, buffers });
    }
    report.nodes = nodes.length;
    report.widest = nodes.sort((a, b) => b.buffers - a.buffers).slice(0, 5);

    // --- the runtime that the production build ships
    const ort = await import(ortUrl);
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = 1;
    const adapter = await navigator.gpu.requestAdapter();
    report.gpu = {
      adapter: [adapter.info.vendor, adapter.info.architecture, adapter.info.description].filter(Boolean).join(" / "),
      shaderF16: adapter.features.has("shader-f16"),
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
      maxBufferSizeMB: Math.round(adapter.limits.maxBufferSize / 1048576),
    };

    let t = performance.now();
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    note(`session created in ${Math.round(performance.now() - t)} ms`);
    const describe = (list) => list.map((m) => `${m.name}: ${m.isTensor ? m.type + " [" + m.shape.join(", ") + "]" : "not a tensor"}`);
    report.inputs = describe(session.inputMetadata);
    report.outputs = describe(session.outputMetadata);

    const stats = (data) => {
      let min = Infinity;
      let max = -Infinity;
      let nan = 0;
      for (let k = 0; k < data.length; k++) {
        const v = data[k];
        if (Number.isNaN(v)) nan++;
        else {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      return { min, max, nan };
    };

    // --- the reference check: one run on a known input has to give the known output (.npy, float32, C order)
    const npy = async (url) => {
      const buf = await (await fetch(url)).arrayBuffer();
      const view = new DataView(buf);
      if (view.getUint8(0) !== 0x93 || String.fromCharCode(...new Uint8Array(buf, 1, 5)) !== "NUMPY") throw new Error("not an .npy file");
      const headerLength = view.getUint8(6) === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
      const start = (view.getUint8(6) === 1 ? 10 : 12) + headerLength;
      const header = new TextDecoder().decode(new Uint8Array(buf, start - headerLength, headerLength));
      if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error("only float32, C order: " + header);
      const shape = (header.match(/'shape':\s*\(([^)]*)\)/)[1] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      return { shape, data: new Float32Array(buf.slice(start)) };
    };
    if (refInUrl) {
      const refIn = await npy(refInUrl);
      const refOut = await npy(refOutUrl);
      const name = session.inputNames[0];
      t = performance.now();
      const out = await session.run({ [name]: new ort.Tensor("float32", refIn.data, refIn.shape) });
      const got = out[session.outputNames[0]];
      let max = 0;
      let sum = 0;
      for (let k = 0; k < refOut.data.length; k++) {
        const d = Math.abs(got.data[k] - refOut.data[k]);
        if (d > max) max = d;
        sum += d;
      }
      report.reference = {
        inputShape: refIn.shape.join(" x "),
        outputShape: got.dims.join(" x "),
        expectedShape: refOut.shape.join(" x "),
        sameShape: got.dims.join(",") === refOut.shape.join(","),
        maxAbsDifference: max,
        meanAbsDifference: sum / refOut.data.length,
        ms: Math.round(performance.now() - t),
      };
      got.dispose();
    }

    // --- runs on noise: every dynamic dimension becomes 1 (batch) or `dim` (sizes)
    const feeds = {};
    for (const meta of session.inputMetadata) {
      const dims = meta.shape.map((d, i) => (typeof d === "number" && d > 0 ? d : i === 0 ? 1 : dim));
      const count = dims.reduce((a, b) => a * b, 1);
      const noise = new Float32Array(count);
      for (let k = 0; k < count; k++) noise[k] = ((k * 2654435761) % 1000) / 1000 - 0.5;
      if (meta.type === "float32") feeds[meta.name] = new ort.Tensor("float32", noise, dims);
      else throw new Error(`the probe feeds float32 only; input ${meta.name} is ${meta.type}`);
    }
    t = performance.now();
    const out = await session.run(feeds);
    note(`first run in ${Math.round(performance.now() - t)} ms (input ${Object.values(feeds)[0].dims.join(" x ")})`);
    const times = [];
    for (let r = 0; r < runs; r++) {
      t = performance.now();
      await session.run(feeds);
      times.push(Math.round(performance.now() - t));
    }
    note(`next ${runs} run(s): ${times.join(", ")} ms`);
    report.outputStats = {};
    for (const name of session.outputNames) {
      report.outputStats[name] = { type: out[name].type, dims: out[name].dims.join(" x "), ...stats(out[name].data) };
    }
    await session.release();
    report.ok = true;
  } catch (e) {
    report.error = String(e && e.message ? e.message : e).slice(0, 800);
  }
  return report;
}

(async () => {
  // the files are served under fixed names, from this process
  const files = { "/model.onnx": MODEL, ...(REF_IN ? { "/ref-in.npy": REF_IN, "/ref-out.npy": REF_OUT } : {}) };
  const server = http.createServer((req, res) => {
    const file = files[req.url.split("?")[0]];
    if (!file) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/octet-stream", "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  const pre = await page.evaluate(() =>
    fetch("/precache.json")
      .then((r) => r.json())
      .catch(() => null),
  );
  if (!pre) {
    console.log("BASE has to serve a production build (npm run build && npm run preview): there is no precache.json at " + BASE);
    process.exit(2);
  }
  const ortFile = pre.files.find((f) => /^assets\/ort\.webgpu\.bundle\.min-.*\.js$/.test(f));
  const wasmFile = pre.runtime.find((f) => f.endsWith(".wasm"));
  const report = await page.evaluate(probe, {
    modelUrl: origin + "/model.onnx",
    ortUrl: BASE + "/" + ortFile,
    wasmUrl: BASE + "/" + wasmFile,
    dim: DIM,
    runs: RUNS,
    refInUrl: REF_IN ? origin + "/ref-in.npy" : null,
    refOutUrl: REF_OUT ? origin + "/ref-out.npy" : null,
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
  if (!report.ok) process.exitCode = 1;
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
