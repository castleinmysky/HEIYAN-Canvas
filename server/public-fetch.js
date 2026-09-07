import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cloudDestination } from "./cloud-relay.js";

const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(ip, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  blocked.addSubnet(ip, prefix, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

export async function resolvePublicTarget(
  value,
  { lookup = dns.lookup, hosts = [] } = {},
) {
  const url = cloudDestination(value);
  if (hosts.length && !hosts.includes(url.hostname))
    throw Error("This model host is not allowed by this deployment.");
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !records.length ||
    records.some((record) => !isPublicAddress(record.address))
  )
    throw Error("The model hostname must resolve only to public addresses.");
  return { url, records };
}

/** DNS is checked once and pinned into the TLS connection; never follow redirects. */
export function createPublicFetch({
  hosts = [],
  lookup = dns.lookup,
  requestImpl = https.request,
  timeoutMs = 20 * 60_000,
} = {}) {
  return async (input, options = {}) => {
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(timeoutMs),
    ]);
    signal.throwIfAborted();
    const { url, records } = await resolvePublicTarget(input, {
      lookup,
      hosts,
    });
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const upstream = requestImpl(
        url,
        {
          method: options.method || "GET",
          headers: Object.fromEntries(new Headers(options.headers)),
          agent: false,
          signal,
          lookup: (_hostname, settings, callback) =>
            settings?.all
              ? callback(null, records)
              : callback(null, records[0].address, records[0].family),
        },
        (response) => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const status = response.statusCode || 502;
          const noBody =
            options.method === "HEAD" || [204, 205, 304].includes(status);
          if (noBody) response.resume();
          resolve(
            new Response(noBody ? null : Readable.toWeb(response), {
              status,
              headers,
            }),
          );
        },
      );
      upstream.once("error", reject);
      if (options.body)
        pipeline(Readable.fromWeb(options.body), upstream, { signal }).catch(
          (error) => upstream.destroy(error),
        );
      else upstream.end();
    });
  };
}
