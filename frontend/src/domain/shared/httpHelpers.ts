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
