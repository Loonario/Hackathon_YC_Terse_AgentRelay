import type { ApiError } from "@proj/contract";
import { SimError } from "@proj/sim";
import { ZodError } from "zod";
import { log } from "./config";
import { getSimulation, type Simulation } from "./registry";

const STATUS: Record<ApiError["error"]["code"], number> = { not_found: 404, invalid_request: 400, invalid_state: 409, internal: 500 };

export function apiError(code: ApiError["error"]["code"], message: string) {
  return Response.json({ error: { code, message } } satisfies ApiError, { status: STATUS[code] });
}

/** Runs a handler and maps thrown errors to the contract's ApiError shape. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SimError) return apiError(err.code, err.message);
    if (err instanceof ZodError) return apiError("invalid_request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    if (err instanceof SyntaxError) return apiError("invalid_request", "body must be JSON");
    log("api", "unhandled error", { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    return apiError("internal", "internal error");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  return text.trim() ? JSON.parse(text) : {};
}

type Ctx = { params: Promise<{ id: string }> };

/** For `/api/simulations/[id]/...` routes: resolves the simulation, then runs `fn`. */
export function withSimulation(fn: (sim: Simulation, req: Request) => Promise<Response> | Response) {
  return (req: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      return fn(await getSimulation(id), req);
    });
}

export const simulationResponse = (sim: Simulation) => Response.json({ simulation: sim.engine.state });
