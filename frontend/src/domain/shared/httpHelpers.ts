export function buildHeaders(getToken: () => string | null, json = false): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

/** The Error for a failed response: the API's `detail` message, else `fallback`. */
export async function failure(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  const detail = body?.detail
  return new Error(typeof detail === 'string' ? detail : fallback)
}
