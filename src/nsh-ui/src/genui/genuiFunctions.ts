// The pure `@Function(...)` builtins of the GenUI libraries (`library.json`
// `functions`), evaluated on plain values. An unknown name answers `undefined`
// so the evaluator can report it instead of inventing a value.

import { display, toNumber, truthy } from "./openuiLang";

type Row = Record<string, unknown>;

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numbers(value: unknown): number[] {
  return list(value).map(toNumber);
}

function field(row: unknown, name: unknown): unknown {
  if (typeof name !== "string" || !row || typeof row !== "object") return row;
  return (row as Row)[name];
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  return toNumber(left) - toNumber(right);
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** Math.max(0, Math.min(10, Math.floor(decimals)));
  return Math.round(value * factor) / factor;
}

function aggregate(values: number[], agg: unknown): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "avg":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "count":
      return values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return values.reduce((sum, value) => sum + value, 0);
  }
}

function groupBy(rows: unknown[], key: unknown, valueField: unknown, agg: unknown): Array<{ key: string | number; value: number }> {
  const groups = new Map<string, { key: string | number; values: number[] }>();
  for (const row of rows) {
    const raw = field(row, key);
    const groupKey = typeof raw === "number" ? raw : display(raw);
    const id = String(groupKey);
    const entry = groups.get(id) ?? { key: groupKey, values: [] };
    entry.values.push(valueField === undefined || valueField === null ? 1 : toNumber(field(row, valueField)));
    groups.set(id, entry);
  }
  return [...groups.values()].map(entry => ({
    key: entry.key,
    value: aggregate(entry.values, valueField === undefined || valueField === null ? "count" : agg),
  }));
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number") return new Date(value);
  if (typeof value !== "string" || !value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(value: unknown, style: unknown): string {
  const date = parseDate(value);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  switch (style) {
    case "short":
      return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    case "long":
      return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    case "weekday":
      return WEEKDAYS[date.getDay()];
    case "month":
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case "time":
      return time;
    case "datetime":
      return `${isoDay(date)} ${time}`;
    case "iso":
      return date.toISOString();
    default:
      return isoDay(date);
  }
}

function formatNumber(value: number, kind: unknown, decimals: unknown, currency: unknown): string {
  const places = typeof decimals === "number" ? Math.max(0, Math.min(10, decimals)) : kind === "currency" ? 2 : undefined;
  const grouped = (n: number) => {
    const fixed = places === undefined ? String(round(n, 6)) : n.toFixed(places);
    const [whole, fraction] = fixed.split(".");
    const sign = whole.startsWith("-") ? "-" : "";
    const digits = sign ? whole.slice(1) : whole;
    return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
  };
  switch (kind) {
    case "currency": {
      const code = typeof currency === "string" && currency ? currency.toUpperCase() : "USD";
      const symbol: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };
      return `${symbol[code] ?? `${code} `}${grouped(value)}`;
    }
    case "percent":
      return `${grouped(value)}%`;
    case "compact": {
      const abs = Math.abs(value);
      if (abs >= 1e9) return `${round(value / 1e9, 1)}B`;
      if (abs >= 1e6) return `${round(value / 1e6, 1)}M`;
      if (abs >= 1e3) return `${round(value / 1e3, 1)}K`;
      return String(round(value, 1));
    }
    default:
      return grouped(value);
  }
}

const UNITS: Record<string, [string, number]> = {
  mm: ["length", 0.001], cm: ["length", 0.01], m: ["length", 1], km: ["length", 1000],
  in: ["length", 0.0254], ft: ["length", 0.3048], yd: ["length", 0.9144], mi: ["length", 1609.344],
  g: ["mass", 1], kg: ["mass", 1000], mg: ["mass", 0.001], lb: ["mass", 453.59237], oz: ["mass", 28.349523125],
  ml: ["volume", 0.001], l: ["volume", 1], cup: ["volume", 0.2365882365], tbsp: ["volume", 0.01478676478125],
  tsp: ["volume", 0.00492892159375], gal: ["volume", 3.785411784],
  s: ["time", 1], min: ["time", 60], h: ["time", 3600], day: ["time", 86400],
};

function convert(value: number, from: unknown, to: unknown): number | null {
  const source = String(from).toLowerCase();
  const target = String(to).toLowerCase();
  const temperature = new Set(["c", "f", "k"]);
  if (temperature.has(source) && temperature.has(target)) {
    const celsius = source === "c" ? value : source === "f" ? (value - 32) * (5 / 9) : value - 273.15;
    return target === "c" ? celsius : target === "f" ? celsius * (9 / 5) + 32 : celsius + 273.15;
  }
  const left = UNITS[source];
  const right = UNITS[target];
  if (!left || !right || left[0] !== right[0]) return null;
  return (value * left[1]) / right[1];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Runs one builtin; `undefined` when the name is not a builtin. */
export function callBuiltin(name: string, args: unknown[]): unknown {
  const [a, b, c, d, e] = args;
  switch (name) {
    case "Count":
      return list(a).length;
    case "First":
      return list(a)[0] ?? null;
    case "Last": {
      const items = list(a);
      return items[items.length - 1] ?? null;
    }
    case "Sum":
      return numbers(a).reduce((sum, value) => sum + value, 0);
    case "Avg": {
      const values = numbers(a);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }
    case "Min":
      return numbers(a).length ? Math.min(...numbers(a)) : 0;
    case "Max":
      return numbers(a).length ? Math.max(...numbers(a)) : 0;
    case "Sort": {
      const sorted = [...list(a)].sort((left, right) => compareValues(field(left, b), field(right, b)));
      return c === "desc" ? sorted.reverse() : sorted;
    }
    case "Filter":
      return list(a).filter(row => {
        const value = field(row, b);
        switch (c) {
          case "!=":
            return !same(value, d);
          case ">":
            return compareValues(value, d) > 0;
          case "<":
            return compareValues(value, d) < 0;
          case ">=":
            return compareValues(value, d) >= 0;
          case "<=":
            return compareValues(value, d) <= 0;
          case "contains":
            return display(value).toLowerCase().includes(display(d).toLowerCase());
          default:
            return same(value, d);
        }
      });
    case "Round":
      return round(toNumber(a), toNumber(b));
    case "Abs":
      return Math.abs(toNumber(a));
    case "Floor":
      return Math.floor(toNumber(a));
    case "Ceil":
      return Math.ceil(toNumber(a));
    case "Append":
      return [...list(a), b];
    case "Prepend":
      return [b, ...list(a)];
    case "Concat":
      return [...list(a), ...list(b)];
    case "Remove":
      return list(a).filter(row => !same(field(row, b), c));
    case "RemoveAt":
      return list(a).filter((_, index) => index !== toNumber(b));
    case "Update":
      return list(a).map(row =>
        same(field(row, b), c) && row && typeof row === "object" ? { ...(row as Row), [String(d)]: e } : row,
      );
    case "Toggle":
      return list(a).some(item => same(item, b)) ? list(a).filter(item => !same(item, b)) : [...list(a), b];
    case "Includes":
      return typeof a === "string" ? a.includes(display(b)) : list(a).some(item => same(item, b));
    case "Find":
      return list(a).find(row => same(field(row, b), c)) ?? null;
    case "IndexOf":
      return list(a).findIndex(item => same(item, b));
    case "Take": {
      const count = toNumber(b);
      return count < 0 ? list(a).slice(count) : list(a).slice(0, count);
    }
    case "Slice":
      return typeof a === "string"
        ? a.slice(toNumber(b), c === undefined || c === null ? undefined : toNumber(c))
        : list(a).slice(toNumber(b), c === undefined || c === null ? undefined : toNumber(c));
    case "Unique": {
      const seen: unknown[] = [];
      for (const item of list(a)) if (!seen.some(entry => same(entry, item))) seen.push(item);
      return seen;
    }
    case "Reverse":
      return [...list(a)].reverse();
    case "Range": {
      const start = toNumber(a);
      const end = toNumber(b);
      const step = toNumber(c) || (end >= start ? 1 : -1);
      const out: number[] = [];
      for (let value = start; step > 0 ? value < end : value > end; value += step) {
        out.push(value);
        if (out.length >= 10_000) break;
      }
      return out;
    }
    case "Pick": {
      const items = list(a);
      return items.length ? items[Math.floor(Math.random() * items.length)] : null;
    }
    case "Shuffle": {
      const items = [...list(a)];
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [items[index], items[swap]] = [items[swap], items[index]];
      }
      return items;
    }
    case "Flatten":
      return list(a).flatMap(item => (Array.isArray(item) ? item : [item]));
    case "Chunk": {
      const size = Math.max(1, Math.floor(toNumber(b)));
      const items = list(a);
      const out: unknown[][] = [];
      for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
      return out;
    }
    case "Pow":
      return toNumber(a) ** toNumber(b);
    case "Sqrt":
      return Math.sqrt(Math.max(0, toNumber(a)));
    case "Sin":
      return Math.sin(toNumber(a));
    case "Cos":
      return Math.cos(toNumber(a));
    case "Tan":
      return Math.tan(toNumber(a));
    case "Random": {
      const min = toNumber(a);
      const max = toNumber(b);
      const value = min + Math.random() * (max - min);
      return truthy(c) ? Math.floor(value) : value;
    }
    case "Clamp":
      return Math.min(toNumber(c), Math.max(toNumber(b), toNumber(a)));
    case "Percent": {
      const total = toNumber(b);
      return total === 0 ? 0 : (toNumber(a) / total) * 100;
    }
    case "Lerp":
      return toNumber(a) + (toNumber(b) - toNumber(a)) * toNumber(c);
    case "Allocate": {
      const weights = numbers(b);
      const sum = weights.reduce((total, value) => total + value, 0);
      return weights.map(weight => round(sum === 0 ? 0 : (toNumber(a) * weight) / sum, typeof c === "number" ? c : 2));
    }
    case "Payment": {
      const principal = toNumber(a);
      const rate = toNumber(b);
      const periods = Math.max(1, toNumber(c));
      return rate === 0 ? principal / periods : (principal * rate) / (1 - (1 + rate) ** -periods);
    }
    case "Convert":
      return convert(toNumber(a), b, c);
    case "Format":
      return formatNumber(toNumber(a), b, c, d);
    case "Join":
      return list(a).map(item => display(c === undefined || c === null ? item : field(item, c))).join(typeof b === "string" ? b : ", ");
    case "Plural": {
      const count = toNumber(a);
      const word = display(b);
      return `${display(count)} ${count === 1 ? word : typeof c === "string" && c ? c : `${word}s`}`;
    }
    case "Pad":
      return display(a).padStart(Math.max(0, toNumber(b)), typeof c === "string" && c ? c : " ");
    case "Upper":
      return display(a).toUpperCase();
    case "Lower":
      return display(a).toLowerCase();
    case "Trim":
      return display(a).trim();
    case "Capitalize":
      return display(a).replace(/\b\p{L}/gu, letter => letter.toUpperCase());
    case "Split":
      return display(a)
        .split(typeof b === "string" && b ? b : ",")
        .map(part => part.trim())
        .filter(Boolean);
    case "Replace":
      return display(a).split(display(b)).join(display(c));
    case "Duration": {
      const total = Math.max(0, Math.floor(toNumber(a)));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (b === "clock") {
        const pad = (value: number) => String(value).padStart(2, "0");
        return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
      }
      return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", seconds || total === 0 ? `${seconds}s` : ""]
        .filter(Boolean)
        .join(" ");
    }
    case "Default":
      return a === null || a === undefined || a === "" || (Array.isArray(a) && a.length === 0) ? b : a;
    case "MixColor": {
      const from = hexToRgb(display(a));
      const to = hexToRgb(display(b));
      if (!from || !to) return display(a);
      const t = Math.min(1, Math.max(0, toNumber(c)));
      const mix = from.map((value, index) => Math.round(value + (to[index] - value) * t));
      return `#${mix.map(value => value.toString(16).padStart(2, "0")).join("")}`;
    }
    case "Now":
      return new Date().toISOString();
    case "Today":
      return isoDay(new Date());
    case "FormatDate":
      return formatDate(a, b);
    case "AddDays": {
      const date = parseDate(a);
      if (!date) return null;
      date.setDate(date.getDate() + toNumber(b));
      return isoDay(date);
    }
    case "AddMonths": {
      const date = parseDate(a);
      if (!date) return null;
      date.setMonth(date.getMonth() + toNumber(b));
      return isoDay(date);
    }
    case "DaysBetween": {
      const from = parseDate(a);
      const to = parseDate(b);
      if (!from || !to) return null;
      const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      return Math.round((day(to) - day(from)) / 86_400_000);
    }
    case "MonthsBetween": {
      const from = parseDate(a);
      const to = parseDate(b);
      if (!from || !to) return null;
      let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
      if (to.getDate() < from.getDate()) months -= 1;
      return months;
    }
    case "StartOf": {
      const date = parseDate(a);
      if (!date) return null;
      if (b === "year") return `${date.getFullYear()}-01-01`;
      if (b === "month") return isoDay(new Date(date.getFullYear(), date.getMonth(), 1));
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return isoDay(monday);
    }
    case "GroupBy":
      return groupBy(list(a), b, c, d);
    case "Pivot": {
      const rows = list(a);
      const out = new Map<string, Row>();
      const buckets = new Map<string, number[]>();
      for (const row of rows) {
        const rowKey = display(field(row, b));
        const colKey = display(field(row, c));
        const entry = out.get(rowKey) ?? { [String(b)]: field(row, b) };
        out.set(rowKey, entry);
        const bucketKey = `${rowKey}\u0000${colKey}`;
        const values = buckets.get(bucketKey) ?? [];
        values.push(d === undefined || d === null ? 1 : toNumber(field(row, d)));
        buckets.set(bucketKey, values);
      }
      for (const [bucketKey, values] of buckets) {
        const [rowKey, colKey] = bucketKey.split("\u0000");
        const entry = out.get(rowKey);
        if (entry) entry[colKey] = aggregate(values, d === undefined || d === null ? "count" : e);
      }
      return [...out.values()];
    }
    case "Top": {
      const sorted = [...list(a)].sort((left, right) => compareValues(field(right, b), field(left, b)));
      const ordered = d === "asc" ? sorted.reverse() : sorted;
      return ordered.slice(0, Math.max(0, toNumber(c)));
    }
    case "Between":
      return list(a).filter(row => {
        const value = field(row, b);
        if (c !== undefined && c !== null && compareValues(value, c) < 0) return false;
        if (d !== undefined && d !== null && compareValues(value, d) > 0) return false;
        return true;
      });
    case "Bucket": {
      const keyed = list(a).map(row => {
        const date = parseDate(field(row, b));
        let bucket = "";
        if (date) {
          if (c === "month") bucket = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          else if (c === "week") bucket = callBuiltin("StartOf", [isoDay(date), "week"]) as string;
          else bucket = isoDay(date);
        }
        return { ...(row && typeof row === "object" ? (row as Row) : {}), __bucket: bucket };
      });
      return groupBy(keyed, "__bucket", d, e).sort((left, right) => compareValues(left.key, right.key));
    }
    case "Cumulative": {
      let total = 0;
      return list(a).map(row => {
        total += toNumber(field(row, b));
        return { ...(row && typeof row === "object" ? (row as Row) : {}), [String(b)]: total };
      });
    }
    case "MovingAvg": {
      const rows = list(a);
      const size = Math.max(1, Math.floor(toNumber(c)));
      return rows.map((row, index) => {
        const window = rows.slice(Math.max(0, index - size + 1), index + 1).map(entry => toNumber(field(entry, b)));
        return {
          ...(row && typeof row === "object" ? (row as Row) : {}),
          [String(b)]: window.reduce((sum, value) => sum + value, 0) / window.length,
        };
      });
    }
    case "Change": {
      const previous = toNumber(b);
      return previous === 0 ? null : ((toNumber(a) - previous) / Math.abs(previous)) * 100;
    }
    case "Histogram": {
      const values = numbers(a);
      const bins = Math.max(1, Math.floor(toNumber(b)));
      if (!values.length) return [];
      const min = c === undefined || c === null ? Math.min(...values) : toNumber(c);
      const max = d === undefined || d === null ? Math.max(...values) : toNumber(d);
      const width = (max - min) / bins || 1;
      const counts = Array.from({ length: bins }, (_, index) => ({ from: min + index * width, to: min + (index + 1) * width, count: 0 }));
      for (const value of values) {
        if (value < min || value > max) continue;
        const index = Math.min(bins - 1, Math.floor((value - min) / width));
        counts[index].count += 1;
      }
      return counts;
    }
    case "Stats": {
      const values = numbers(a).sort((left, right) => left - right);
      if (!values.length) return { count: 0, min: 0, max: 0, mean: 0, median: 0, stdev: 0 };
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return { count: values.length, min: values[0], max: values[values.length - 1], mean, median, stdev: Math.sqrt(variance) };
    }
    default:
      return undefined;
  }
}
