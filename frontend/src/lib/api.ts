export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson<ResponseBody>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const responseText = await response.text()
  let responseBody: { error?: string } = {}

  if (responseText.trim()) {
    try {
      responseBody = JSON.parse(responseText) as { error?: string }
    } catch {
      throw new ApiError(
        response.ok ? 'Invalid server response' : 'API server unavailable. Check the dev terminal.',
        response.status,
      )
    }
  }

  if (!response.ok) {
    throw new ApiError(
      getApiErrorMessage(responseBody.error, response.status),
      response.status,
    )
  }

  return responseBody as ResponseBody
}

function getApiErrorMessage(errorMessage: string | undefined, status: number) {
  if (
    status === 404 &&
    errorMessage?.includes('The requested URL was not found on the server')
  ) {
    return 'API route unavailable. Stop npm run dev and start it again.'
  }

  return errorMessage || 'API server unavailable'
}
