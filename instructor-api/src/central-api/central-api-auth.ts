// central-api is not reachable from the internet; it only accepts calls that
// carry this shared token, and instructor-api is the only caller.
export function centralApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, 'X-Service-Token': process.env.CENTRAL_API_SERVICE_TOKEN ?? '' };
}
