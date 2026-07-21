import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Byteling — ping
 * Trivial connectivity check. No auth required, so any external client
 * (Base44 widget, Chrome extension background worker) can confirm the
 * backend is reachable before doing anything else.
 *
 * Invoke via the function's public endpoint or:
 *   base44.functions.invoke('ping', {})
 */
Deno.serve(async (req) => {
  try {
    // Touch the SDK so we also confirm it initializes cleanly.
    const base44 = createClientFromRequest(req);

    return Response.json({
      status: 'ok',
      service: 'byteling',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ status: 'error', error: error.message }, { status: 500 });
  }
});