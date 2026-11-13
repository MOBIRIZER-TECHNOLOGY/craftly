/** The numbers the server keeps about itself, and the text it hands to a scraper. */
import { describe, expect, it } from "vitest";
import { createMetrics } from "./metrics";
import { parseMetrics } from "./metricsText";

describe("the text a scraper reads", () => {
  it("has every series from the start, at 0, each with a line that says what it is and one that says its type", () => {
    const text = createMetrics().text({ uptime_seconds: 1.5, rooms_in_memory: 0, rooms_stored: 0, connections: 0, peers_joined: 0 });
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseMetrics(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.samples.get("craftly_live_uptime_seconds")).toBe(1.5);
    expect(parsed.types.get("craftly_live_uptime_seconds")).toBe("gauge");
    for (const name of [
      "messages_received_total",
      "bytes_received_total",
      "batches_applied_total",
      "batches_rejected_total",
      "saves_total",
      "save_failures_total",
      "rooms_created_total",
      "rooms_removed_total",
      "rooms_expired_total",
    ]) {
      expect(parsed.samples.get(`craftly_live_${name}`), name).toBe(0);
      expect(parsed.types.get(`craftly_live_${name}`), name).toBe("counter");
    }
    for (const reason of ["slow_reader", "rate", "join_rate", "size", "silent", "waiting"])
      expect(parsed.samples.get(`craftly_live_connections_closed_total{reason="${reason}"}`), reason).toBe(0);
    for (const reason of ["connections", "origin"]) expect(parsed.samples.get(`craftly_live_upgrades_refused_total{reason="${reason}"}`)).toBe(0);
    for (const kind of ["2xx", "3xx", "4xx", "5xx"]) expect(parsed.samples.get(`craftly_live_http_responses_total{class="${kind}"}`)).toBe(0);
    expect(parsed.types.get("craftly_live_save_duration_seconds")).toBe("summary");
    expect(parsed.samples.get("craftly_live_save_duration_seconds_sum")).toBe(0);
    expect(parsed.samples.get("craftly_live_save_duration_seconds_count")).toBe(0);
  });

  it("counts what it is told, by one or by more, and adds up how long saves took", () => {
    const metrics = createMetrics();
    metrics.count("messages_received_total");
    metrics.count("messages_received_total");
    metrics.count("bytes_received_total", 1500);
    metrics.countBy("connections_closed_total", "rate");
    metrics.countBy("connections_closed_total", "rate");
    metrics.countBy("http_responses_total", "4xx");
    metrics.saveTook(0.25);
    metrics.saveTook(0.5);
    metrics.saveTook(-1); // a clock that went back: counted as a save that took no time
    const { samples, problems } = parseMetrics(metrics.text({}));
    expect(problems).toEqual([]);
    expect(samples.get("craftly_live_messages_received_total")).toBe(2);
    expect(samples.get("craftly_live_bytes_received_total")).toBe(1500);
    expect(samples.get('craftly_live_connections_closed_total{reason="rate"}')).toBe(2);
    expect(samples.get('craftly_live_connections_closed_total{reason="size"}')).toBe(0);
    expect(samples.get('craftly_live_http_responses_total{class="4xx"}')).toBe(1);
    expect(samples.get("craftly_live_save_duration_seconds_sum")).toBe(0.75);
    expect(samples.get("craftly_live_save_duration_seconds_count")).toBe(3);
  });

  it("never makes a series for a label that is not on its list: no room, address or path can become one", () => {
    const metrics = createMetrics();
    const before = metrics.text({});
    for (const outside of ["TW-FaxWt8edjpnT-bGQyjA", "203.0.113.9", '"} 1\nfake_metric 1', "constructor", "1xx"]) {
      metrics.countBy("connections_closed_total", outside as never);
      metrics.countBy("http_responses_total", outside as never);
    }
    expect(metrics.text({})).toBe(before);
  });

  it("leaves out a gauge that is not known, and writes 0 for a number that is none", () => {
    const { samples, problems } = parseMetrics(createMetrics().text({ rooms_in_memory: 3, rooms_stored: undefined, connections: Number.NaN }));
    expect(problems).toEqual([]);
    expect(samples.get("craftly_live_rooms_in_memory")).toBe(3);
    expect(samples.has("craftly_live_rooms_stored")).toBe(false);
    expect(samples.has("craftly_live_uptime_seconds")).toBe(false);
    expect(samples.get("craftly_live_connections")).toBe(0);
  });
});

describe("reading the text back (what the tests of the server use)", () => {
  it("finds what is wrong with text that is not the format", () => {
    expect(parseMetrics("a_metric 1\n").problems).toEqual(["a_metric has no TYPE line", "a_metric has no HELP line"]);
    expect(parseMetrics("# HELP a_total Counts.\n# TYPE a_total counter\na_total one\n").problems).toEqual(['not a sample: "a_total one"']);
    expect(parseMetrics("# HELP a_total Counts.\n# TYPE a_total counter\na_total 1\na_total 2\n").problems).toEqual(["a_total is there twice"]);
    expect(parseMetrics("# HELP a_total Counts.\n# TYPE a_total counter\na_total 1").problems).toEqual(["the text does not end with a line end"]);
    expect(parseMetrics('# HELP a Counts.\n# TYPE a summary\na_sum 1.5\na_count 2\n# HELP b B.\n# TYPE b gauge\nb{x="y"} -3\n').problems).toEqual([]);
  });
});
