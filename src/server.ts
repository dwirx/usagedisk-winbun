import { getErrorMessage, hasErrorCode } from "./error";
import indexHtml from "./index.html";
import {
  cleanTargetStream,
  getDiskInfo,
  getTargetById,
  openTargetFolder,
  scanSingleTarget,
  TARGETS,
} from "./scanner.ts";
import type { CleanResult } from "./types";

interface CleanRequestBody {
  ids: string[];
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function isCleanRequestBody(value: unknown): value is CleanRequestBody {
  if (typeof value !== "object" || value === null || !("ids" in value)) {
    return false;
  }
  const ids = (value as { ids?: unknown }).ids;
  return (
    Array.isArray(ids) &&
    ids.every((item) => typeof item === "string" && item.length > 0)
  );
}

function startServer(port: number): void {
  try {
    const server = Bun.serve({
      port,
      idleTimeout: 255,
      routes: {
        "/": indexHtml,
        "/api/targets": {
          GET: () => jsonResponse(TARGETS),
        },
        "/api/diskinfo": {
          GET: async () => {
            const info = await getDiskInfo();
            return jsonResponse(info);
          },
        },
        "/api/scan/:id": {
          GET: async (req) => {
            try {
              const id = new URL(req.url).pathname.split("/").pop();
              if (!id) {
                return jsonResponse({ error: "id tidak valid" }, 400);
              }
              const result = await scanSingleTarget(id);
              if (!result) {
                return jsonResponse({ error: "target tidak ditemukan" }, 404);
              }
              return jsonResponse(result);
            } catch (error) {
              return jsonResponse(
                { error: getErrorMessage(error, "Gagal memindai target") },
                500,
              );
            }
          },
        },
        "/api/open/:id": {
          POST: async (req) => {
            try {
              const id = new URL(req.url).pathname.split("/").pop();
              if (!id) {
                return jsonResponse({ error: "id tidak valid" }, 400);
              }

              const result = await openTargetFolder(id);
              if (!result) {
                return jsonResponse({ error: "target tidak ditemukan" }, 404);
              }

              if (!result.opened) {
                return jsonResponse(result, 409);
              }
              return jsonResponse(result);
            } catch (error) {
              return jsonResponse(
                { error: getErrorMessage(error, "Gagal membuka folder") },
                500,
              );
            }
          },
        },
        "/api/clean/stream": {
          POST: async (req) => {
            try {
              const body = (await req.json()) as unknown;
              if (!isCleanRequestBody(body) || body.ids.length === 0) {
                return jsonResponse(
                  { error: "ids harus berupa array string non-kosong" },
                  400,
                );
              }

              const ids = body.ids;
              let closed = false;
              const stream = new ReadableStream({
                async start(controller) {
                  const encoder = new TextEncoder();
                  const send = (payload: object) => {
                    if (closed) {
                      return;
                    }
                    try {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
                      );
                    } catch {
                      closed = true;
                    }
                  };

                  send({ type: "start", total: ids.length });

                  for (let index = 0; index < ids.length; index++) {
                    if (closed) {
                      break;
                    }

                    const id = ids[index];
                    if (!id) {
                      continue;
                    }
                    const target = getTargetById(id);
                    send({
                      type: "progress",
                      current: index + 1,
                      id,
                      name: target?.name ?? id,
                    });

                    await cleanTargetStream(id, (result: CleanResult) => {
                      send({
                        type: "result",
                        current: index + 1,
                        id,
                        result,
                      });
                    });
                  }

                  send({ type: "done" });
                  if (!closed) {
                    controller.close();
                  }
                },
                cancel() {
                  closed = true;
                },
              });

              return new Response(stream, {
                headers: {
                  "Cache-Control": "no-cache",
                  Connection: "keep-alive",
                  "Content-Type": "text/event-stream",
                  "X-Accel-Buffering": "no",
                },
              });
            } catch (error) {
              return jsonResponse(
                { error: getErrorMessage(error, "Terjadi kesalahan stream") },
                500,
              );
            }
          },
        },
      },
      development: { hmr: false, console: true },
    });

    writeStdout("");
    writeStdout("=".repeat(54));
    writeStdout(`Buka browser: http://localhost:${server.port}`);
    writeStdout("=".repeat(54));
    writeStdout("");
  } catch (error) {
    if (hasErrorCode(error, "EADDRINUSE")) {
      writeStdout(`Port ${port} dipakai. Mencoba port ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    writeStderr(getErrorMessage(error, "Server gagal dijalankan"));
  }
}

startServer(3000);
