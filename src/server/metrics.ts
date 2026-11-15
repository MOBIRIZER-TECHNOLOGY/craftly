/**
 * What the server counts about itself, and how it says it: the text format that Prometheus reads (version 0.0.4), written by
 * hand because it is a few lines and the server has one dependency. Everything here is a number that goes up (a counter), a
 * number that is read when it is asked for (a gauge, given by the caller), or the sum and count of how long saves took.
 *
 * A label has a value from a short list that is fixed here, never one that comes from outside: not a room, not an address, not
 * a path. A series for each of those would grow without end, and would put the ids of rooms, which are half of a secret, into
 * whatever stores the metrics. Every series exists from the start with the value 0, so that a rate can be computed from the
 * first scrape on.
 */

const PREFIX = "craftly_live_";

/** Counters with no label: what each counts, as Prometheus shows it. */
const COUNTERS = {
  messages_received_total: "WebSocket messages received from browsers.",
  bytes_received_total: "Bytes of WebSocket messages received from browsers.",
  batches_applied_total: "Batches of edits that were applied, saved and acknowledged.",
  batches_rejected_total: "Batches of edits that were refused: not well formed, not allowed, or not saved.",
  saves_total: "Room records written to the storage.",
  edit_groups_total: "Groups of edit batches taken from a room's inbox to be saved with one write (group commit); batches applied per group is batches_applied_total over this.",
  save_failures_total: "Room records that could not be written to the storage.",
  rooms_created_total: "Rooms made (POST /api/rooms answered 201).",
  rooms_removed_total: "Rooms removed by their owner (stop sharing) or by the operator.",
  rooms_expired_total: "Rooms removed because nobody used them for longer than rooms may live.",
  presence_dropped_total: "Presence messages (pointers, selections) that were not passed on because a connection sent them faster than it may.",
} as const;

/** Counters with one label, and every value that label can have. */
const LABELLED = {
  connections_closed_total: {
    help: "WebSocket connections the server closed for a limit: a reader that was too slow, too many messages or bytes, too many joins, a message that was too big, no answer to pings, too many waiting at a room, too many edits waiting to be saved in a room.",
    label: "reason",
    values: ["slow_reader", "rate", "join_rate", "size", "silent", "waiting", "queue"],
  },
  upgrades_refused_total: {
    help: "WebSocket connections refused before they were made: too many connections, or a page of an origin that is not allowed.",
    label: "reason",
    values: ["connections", "origin"],
  },
  http_responses_total: {
    help: "HTTP responses by class of status code (this endpoint included).",
    label: "class",
    values: ["2xx", "3xx", "4xx", "5xx"],
  },
} as const;

/** Numbers that are read when the metrics are asked for. One that is not known (undefined) is left out of the answer. */
const GAUGES = {
  uptime_seconds: "Seconds since the server process started.",
  rooms_in_memory: "Rooms that are in memory now.",
  rooms_stored: "Rooms in the storage (counted at most every few seconds).",
  connections: "WebSocket connections that are open now.",
  peers_joined: "Connections that have shown a key and are in a room now.",
} as const;

export type CounterName = keyof typeof COUNTERS;
export type LabelledName = keyof typeof LABELLED;
export type LabelOf<N extends LabelledName> = (typeof LABELLED)[N]["values"][number];
export type GaugeName = keyof typeof GAUGES;

export interface Metrics {
  count(name: CounterName, by?: number): void;
  /** Counts one for a value of the label. A value that is not on the list is not counted: a label never takes a value from outside. */
  countBy<N extends LabelledName>(name: N, value: LabelOf<N>): void;
  /** One more save took this long, whether it succeeded or not. */
  saveTook(seconds: number): void;
  /** Everything, in the text format of Prometheus, with the gauges as they are now. */
  text(gauges: Partial<Record<GaugeName, number | undefined>>): string;
}

/** The media type of the text format, as a scraper expects it. */
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** A number as the format writes it. What is not a finite number is written as 0: nothing here should ever be one. */
const value = (n: number): string => (Number.isFinite(n) ? String(n) : "0");

export function createMetrics(): Metrics {
  const counters = new Map<CounterName, number>();
  for (const name of Object.keys(COUNTERS) as CounterName[]) counters.set(name, 0);
  const labelled = new Map<LabelledName, Map<string, number>>();
  for (const name of Object.keys(LABELLED) as LabelledName[]) labelled.set(name, new Map(LABELLED[name].values.map((v) => [v, 0])));
  let saveSeconds = 0;
  let saveCount = 0;

  return {
    count(name, by = 1) {
      counters.set(name, (counters.get(name) as number) + by);
    },
    countBy(name, label) {
      const series = labelled.get(name) as Map<string, number>;
      const now = series.get(label);
      if (now !== undefined) series.set(label, now + 1);
    },
    saveTook(seconds) {
      saveSeconds += Math.max(0, seconds);
      saveCount++;
    },
    text(gauges) {
      const lines: string[] = [];
      const head = (name: string, help: string, type: string) => lines.push(`# HELP ${PREFIX}${name} ${help}`, `# TYPE ${PREFIX}${name} ${type}`);
      for (const name of Object.keys(GAUGES) as GaugeName[]) {
        const now = gauges[name];
        if (now === undefined) continue;
        head(name, GAUGES[name], "gauge");
        lines.push(`${PREFIX}${name} ${value(now)}`);
      }
      for (const [name, now] of counters) {
        head(name, COUNTERS[name], "counter");
        lines.push(`${PREFIX}${name} ${value(now)}`);
      }
      for (const [name, series] of labelled) {
        head(name, LABELLED[name].help, "counter");
        for (const [label, now] of series) lines.push(`${PREFIX}${name}{${LABELLED[name].label}="${label}"} ${value(now)}`);
      }
      head("save_duration_seconds", "How long writing a room record took, successful or not: the sum and the number of writes.", "summary");
      lines.push(`${PREFIX}save_duration_seconds_sum ${value(saveSeconds)}`, `${PREFIX}save_duration_seconds_count ${value(saveCount)}`);
      return `${lines.join("\n")}\n`;
    },
  };
}
