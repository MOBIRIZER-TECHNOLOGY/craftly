/**
 * Reads the text format of Prometheus back, as far as the server writes it: for the tests that scrape a real server, which
 * should find out that the text is not the format before a real scraper does. Not part of the server bundle (nothing of the
 * server imports it).
 */

export interface ParsedMetrics {
  /** Every sample by its name with its labels, as written: `name` or `name{label="value"}`. */
  samples: Map<string, number>;
  /** The type of every metric that has a TYPE line. */
  types: Map<string, string>;
  /** What is wrong with the text as the format goes; empty when nothing is. */
  problems: string[];
}

const SAMPLE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[a-zA-Z_][a-zA-Z0-9_]*="[^"\\\n]*"\})? (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/;

export function parseMetrics(text: string): ParsedMetrics {
  const samples = new Map<string, number>();
  const types = new Map<string, string>();
  const helps = new Set<string>();
  const problems: string[] = [];
  if (!text.endsWith("\n")) problems.push("the text does not end with a line end");
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const help = /^# HELP ([a-zA-Z_:][a-zA-Z0-9_:]*) \S.*$/.exec(line);
    const type = /^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*) (counter|gauge|summary|histogram|untyped)$/.exec(line);
    if (help) helps.add(help[1]);
    else if (type) types.set(type[1], type[2]);
    else {
      const sample = SAMPLE.exec(line);
      if (!sample) {
        problems.push(`not a sample: ${JSON.stringify(line)}`);
        continue;
      }
      const key = sample[1] + (sample[2] ?? "");
      if (samples.has(key)) problems.push(`${key} is there twice`);
      samples.set(key, Number(sample[3]));
      // the sum and the count of a summary belong to the metric without the ending
      const family = types.has(sample[1]) ? sample[1] : sample[1].replace(/_(sum|count)$/, "");
      if (!types.has(family)) problems.push(`${sample[1]} has no TYPE line`);
      if (!helps.has(family)) problems.push(`${sample[1]} has no HELP line`);
    }
  }
  return { samples, types, problems };
}
