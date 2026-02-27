import indexHtml from "./index.html";
import { TARGETS, scanSingleTarget, getDiskInfo, cleanTargetStream } from "./scanner.ts";

function startServer(port: number) {
  try {
    const server = Bun.serve({
      port,
      idleTimeout: 255,
      routes: {
        "/": indexHtml,
        "/api/targets": {
          GET: () => new Response(JSON.stringify(TARGETS), {
            headers: { "Content-Type": "application/json" }
          })
        },
        "/api/diskinfo": {
          GET: async () => {
            const info = await getDiskInfo();
            return new Response(JSON.stringify(info), {
              headers: { "Content-Type": "application/json" }
            });
          }
        },
        "/api/scan/:id": {
          GET: async (req) => {
            try {
              const id = new URL(req.url).pathname.split("/").pop();
              if (!id) return new Response("Bad Request", { status: 400 });
              const result = await scanSingleTarget(id);
              return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" }
              });
            } catch {
              return new Response(JSON.stringify({ error: "Gagal memindai" }), { status: 500 });
            }
          }
        },

        // SSE endpoint — streaming progress per folder
        "/api/clean/stream": {
          POST: async (req) => {
            try {
              const body = await req.json() as { ids: string[] };
              if (!Array.isArray(body.ids) || body.ids.length === 0)
                return new Response("ids required", { status: 400 });

              const ids = body.ids;
              let closed = false;

              const stream = new ReadableStream({
                async start(controller) {
                  const enc = new TextEncoder();

                  const send = (obj: object) => {
                    if (closed) return;
                    try { controller.enqueue(enc.encode("data: " + JSON.stringify(obj) + "\n\n")); }
                    catch { closed = true; }
                  };

                  // Kirim total dulu
                  send({ type: "start", total: ids.length });

                  // Proses sekuensial agar progress bermakna (satu per satu)
                  for (let i = 0; i < ids.length; i++) {
                    if (closed) break;
                    send({ type: "progress", index: i, id: ids[i] });
                    await cleanTargetStream(ids[i]!, result => send({ type: "result", index: i, result }));
                  }

                  send({ type: "done" });
                  try { controller.close(); } catch { /* ignore */ }
                },
                cancel() { closed = true; }
              });

              return new Response(stream, {
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  "Connection": "keep-alive",
                  "X-Accel-Buffering": "no",
                }
              });
            } catch (e: any) {
              return new Response(e?.message ?? "Error", { status: 500 });
            }
          }
        }
      },
      development: { hmr: false, console: true }
    });

    console.log(`\n${"=".repeat(54)}`);
    console.log(`🚀 Buka browser: http://localhost:${server.port}`);
    console.log(`${"=".repeat(54)}\n`);
  } catch (error: any) {
    if (error?.code === "EADDRINUSE") {
      console.log(`⚠️  Port ${port} dipakai. Mencoba port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(error);
    }
  }
}

startServer(3000);
