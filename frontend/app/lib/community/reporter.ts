import { createHash } from "node:crypto";

/** A guest reporter is identified by a salted IP hash: no raw IP is stored and
 *  a client cannot choose someone else's identity. */
export function reporterHashFor(ip: string): string {
  return createHash("sha256").update(`${ip}|kumori-community-report`).digest("hex");
}
