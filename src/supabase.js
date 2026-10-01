const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function requireConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      '缺少 Supabase 配置：请检查 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。'
    )
  }
}

async function rpc(functionName, body) {
  requireConfig()

  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  const rawText = await response.text()
  let payload = null

  if (rawText) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = rawText
    }
  }

  if (!response.ok) {
    const message =
      payload?.message
      || payload?.hint
      || payload?.details
      || (typeof payload === 'string' ? payload : '')
      || `Supabase 请求失败（${response.status}）`

    throw new Error(message)
  }

  return payload
}

export function getSharedTrip(tripId, shareToken) {
  return rpc('get_shared_trip', {
    p_trip_id: tripId,
    p_share_token: shareToken,
  })
}

export function saveSharedTrip(tripId, shareToken, data) {
  return rpc('save_shared_trip', {
    p_trip_id: tripId,
    p_share_token: shareToken,
    p_data: data,
  })
}
