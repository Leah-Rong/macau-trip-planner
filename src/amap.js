let loading
export function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_AMAP_KEY
    const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (!key || !securityJsCode) {
      reject(new Error('请在项目根目录的 .env.local 中填写高德 Key 和安全密钥，然后重启 npm run dev。'))
      return
    }
    window._AMapSecurityConfig = { securityJsCode }
    const script = document.createElement('script')
    const timer = setTimeout(() => reject(new Error('高德地图加载超时，请检查网络后刷新页面。')), 20000)
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.PlaceSearch,AMap.Walking,AMap.Driving,AMap.ToolBar`
    script.onload = () => { clearTimeout(timer); window.AMap ? resolve(window.AMap) : reject(new Error('高德地图加载失败')) }
    script.onerror = () => { clearTimeout(timer); reject(new Error('无法加载高德地图，请检查网络。')) }
    document.head.appendChild(script)
  })
  return loading
}
export function serviceCall(service, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('查询超时，请重试。')), 20000)
    service.search(...args, (status, result) => {
      clearTimeout(timer)
      if (status === 'complete') resolve(result)
      else reject(new Error(status === 'no_data' ? '高德未返回结果，澳门部分地点或路线可能暂无覆盖。' : `查询失败：${typeof result === 'string' ? result : result?.info || status}。请检查 Key、安全密钥、域名白名单和配额。`))
    })
  })
}
export async function convertPlaces(AMap, places) {
  const pending = places.filter(p => p.coordSystem !== 'GCJ02')
  if (!pending.length) return places
  const locations = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('旧收藏坐标转换超时，原数据已保留，请刷新重试。')), 20000)
    AMap.convertFrom(pending.map(p => [p.lng, p.lat]), 'gps', (status, result) => {
      clearTimeout(timer)
      if (status === 'complete' && result.locations?.length === pending.length) resolve(result.locations)
      else reject(new Error('旧收藏坐标转换失败，原数据已保留，请刷新重试。'))
    })
  })
  let index = 0
  return places.map(p => {
    if (p.coordSystem === 'GCJ02') return p
    const point = locations[index++]
    return { ...p, lng: point.getLng(), lat: point.getLat(), coordSystem: 'GCJ02' }
  })
}
