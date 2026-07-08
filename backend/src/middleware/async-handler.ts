import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers — an unhandled
 * rejection hangs the request until it times out. Wrapping every async handler
 * forwards the rejection to the error middleware instead.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
