// Test helper utilities

/** Create a mock File object from a string */
export function createMockFile(
  name: string,
  content: string,
  type = "application/octet-stream",
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

/** Create a minimal mock Response object */
export function mockResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Wait for microtasks to flush */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
