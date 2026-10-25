import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { acquireLock, finishRun } from "./lock";
export async function runDiscovery(request: Request, job: string, work: () => Promise<any>) {
  try {
    const locked = await acquireLock(job, 4);
    if (!locked) return NextResponse.json({ error: "locked", job }, { status: 409 });
    const execute = async () => {
      try {
        const stats = await work();
        await finishRun(job, { ok: true, stats, windowEnd: new Date().toISOString() });
        return stats;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishRun(job, { ok: false, stats: {}, error: message });
        throw error;
      }
    };
    if (new URL(request.url).searchParams.get("wait") === "1") {
      try { return NextResponse.json(await execute()); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error), job }, { status: 500 }); }
    }
    waitUntil(execute().catch(() => undefined));
    return NextResponse.json({ started: true, job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), job }, { status: 500 });
  }
}
