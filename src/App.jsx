import { useEffect, useRef, useState } from 'react'
import { loadAMap, serviceCall, convertPlaces } from './amap'
import './App.css'

const colors = {
  '必须去': '#e53935',
  '一定去': '#fb8c00',
  '可以去': '#43a047',
}

const routeColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#d97706',
  '#db2777',
  '#059669',
]

const UNSCHEDULED = '__unscheduled__'

const itineraryTransportModes = {
  walking: '步行',
  driving: '开车',
}

const samples = [
  {
    id: 1,
    name: '大三巴牌坊',
    priority: '必须去',
    openingHours: '全天',
    address: '',
    tripDate: '',
    lat: 22.1975,
    lng: 113.5407,
  },
  {
    id: 2,
    name: '官也街',
    priority: '一定去',
    openingHours: '全天',
    address: '',
    tripDate: '',
    lat: 22.1537,
    lng: 113.5565,
  },
  {
    id: 3,
    name: '路环市区',
    priority: '可以去',
    openingHours: '全天',
    address: '',
    tripDate: '',
    lat: 22.1168,
    lng: 113.551,
  },
]

function normalizePlace(place) {
  return {
    ...place,
    tripDate: typeof place.tripDate === 'string' ? place.tripDate : '',
  }
}

function validPlaces(value) {
  return (
    Array.isArray(value)
    && value.every(
      place =>
        place
        && typeof place.name === 'string'
        && ['string', 'number'].includes(typeof place.id)
        && Number.isFinite(place.lat)
        && Number.isFinite(place.lng)
        && Math.abs(place.lat) <= 90
        && Math.abs(place.lng) <= 180
        && colors[place.priority]
        && (
          !place.tripDate
          || /^\d{4}-\d{2}-\d{2}$/.test(place.tripDate)
        )
        && (
          !place.coordSystem
          || ['GCJ02', 'WGS84'].includes(place.coordSystem)
        )
    )
    && new Set(value.map(place => String(place.id))).size === value.length
  )
}

function readPlaces() {
  try {
    const saved = JSON.parse(localStorage.getItem('macauPlaces'))
    return validPlaces(saved)
      ? saved.map(normalizePlace)
      : samples.map(normalizePlace)
  } catch {
    return samples.map(normalizePlace)
  }
}

function readItineraryOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('macauItineraryOrder'))
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved
      : {}
  } catch {
    return {}
  }
}

function readItineraryRouteCache() {
  try {
    const saved =
      JSON.parse(localStorage.getItem('macauItineraryRouteCache'))
      || JSON.parse(localStorage.getItem('macauWalkingCache'))

    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved
      : {}
  } catch {
    return {}
  }
}

function readItineraryLegModes() {
  try {
    const saved = JSON.parse(localStorage.getItem('macauItineraryLegModes'))

    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(saved).filter(([, mode]) => itineraryTransportModes[mode])
    )
  } catch {
    return {}
  }
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function groupKey(date) {
  return date || UNSCHEDULED
}

function itineraryRouteKey(startPlace, endPlace, mode) {
  return `${mode}::${String(startPlace.id)}::${String(endPlace.id)}`
}

function itineraryLegModeKey(groupKeyValue, startPlace, endPlace) {
  return `${groupKeyValue}::${String(startPlace.id)}::${String(endPlace.id)}`
}

function transportLabel(mode) {
  return itineraryTransportModes[mode] || '步行'
}

function orderedPlacesForKey(key, places, orderMap) {
  const group = places.filter(place => groupKey(place.tripDate) === key)
  const byId = new Map(group.map(place => [String(place.id), place]))
  const requestedOrder = Array.isArray(orderMap[key]) ? orderMap[key].map(String) : []
  const seen = new Set()
  const ordered = []

  requestedOrder.forEach(id => {
    const place = byId.get(id)
    if (place && !seen.has(id)) {
      ordered.push(place)
      seen.add(id)
    }
  })

  group.forEach(place => {
    const id = String(place.id)
    if (!seen.has(id)) {
      ordered.push(place)
      seen.add(id)
    }
  })

  return ordered
}

function formatDateTitle(date) {
  if (!date) return '未安排'
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' })
    .format(new Date(year, month - 1, day))
  return `${month}月${day}日 · ${weekday}`
}

function formatDateTab(date) {
  if (!date) return '未安排'
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

function formatDistance(distance) {
  const value = Number(distance)
  if (!Number.isFinite(value)) return '—'
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} km`
    : `${Math.round(value)} m`
}

function formatMinutes(time) {
  const value = Number(time)
  if (!Number.isFinite(value)) return '—'
  return Math.max(1, Math.ceil(value / 60))
}

function downloadPlan(places, itineraryOrder, itineraryLegModes) {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    places,
    itineraryOrder,
    itineraryLegModes,
  }

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  )

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'macau-trip-plan.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function App() {
  const container = useRef(null)
  const mapRef = useRef(null)
  const engine = useRef(null)
  const routeLayers = useRef([])
  const routeVersion = useRef(0)
  const itineraryCalcVersion = useRef(0)
  const fileInput = useRef(null)

  const initialItineraryRouteCache = useRef(readItineraryRouteCache())
  const itineraryRouteCacheRef = useRef(initialItineraryRouteCache.current)

  const [page, setPage] = useState('map')
  const [places, setPlaces] = useState(readPlaces)
  const [itineraryOrder, setItineraryOrder] = useState(readItineraryOrder)
  const [itineraryLegModes, setItineraryLegModes] = useState(readItineraryLegModes)
  const [itineraryRouteCache, setItineraryRouteCache] = useState(
    initialItineraryRouteCache.current
  )
  const [activeItineraryDate, setActiveItineraryDate] = useState('all')
  const [itineraryBusy, setItineraryBusy] = useState(false)
  const [itineraryError, setItineraryError] = useState('')

  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [draft, setDraft] = useState(null)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [mode, setMode] = useState('walking')
  const [routes, setRoutes] = useState([])
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState('')

  const scheduledDates = Array.from(
    new Set(places.map(place => place.tripDate).filter(Boolean))
  ).sort()

  const hasUnscheduled = places.some(place => !place.tripDate)
  const allItineraryKeys = [
    ...scheduledDates,
    ...(hasUnscheduled ? [UNSCHEDULED] : []),
  ]

  const visibleItineraryKeys = activeItineraryDate === 'all'
    ? allItineraryKeys
    : allItineraryKeys.includes(activeItineraryDate)
      ? [activeItineraryDate]
      : []

  const visibleItineraryGroups = visibleItineraryKeys.map(key => ({
    key,
    places: orderedPlacesForKey(key, places, itineraryOrder),
  }))

  const visibleItinerarySignature = visibleItineraryGroups
    .map(group => {
      const ids = group.places.map(place => String(place.id)).join(',')
      const modes = group.places.slice(0, -1).map((place, index) => {
        const nextPlace = group.places[index + 1]
        const key = itineraryLegModeKey(group.key, place, nextPlace)
        return itineraryLegModes[key] || 'walking'
      }).join(',')
      return `${group.key}:${ids}:${modes}`
    })
    .join('|')

  useEffect(() => {
    let disposed = false
    let map

    loadAMap()
      .then(async AMap => {
        const original = readPlaces()
        const converted = await convertPlaces(AMap, original)
        if (disposed) return

        if (
          original.some(place => place.coordSystem !== 'GCJ02')
          && !localStorage.getItem('macauPlacesBeforeAMap')
        ) {
          localStorage.setItem('macauPlacesBeforeAMap', JSON.stringify(original))
        }

        map = new AMap.Map(container.current, {
          center: [113.55, 22.165],
          zoom: 13,
          resizeEnable: true,
          lang: 'zh_cn',
        })

        map.addControl(new AMap.ToolBar())

        map.on('click', event => {
          setDraft({
            name: '',
            address: '',
            openingHours: '',
            priority: '必须去',
            tripDate: '',
            lng: event.lnglat.getLng(),
            lat: event.lnglat.getLat(),
          })
        })

        engine.current = AMap
        mapRef.current = map
        setPlaces(converted.map(normalizePlace))
        setReady(true)
      })
      .catch(error => {
        if (!disposed) setMapError(error.message)
      })

    return () => {
      disposed = true
      routeVersion.current++
      itineraryCalcVersion.current++
      routeLayers.current.forEach(layer => map?.remove(layer.overlays))
      routeLayers.current = []
      map?.destroy()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem('macauPlaces', JSON.stringify(places))
    } catch {
      queueMicrotask(() => setMapError('浏览器无法保存收藏，请先导出收藏备份。'))
    }
  }, [places, ready])

  useEffect(() => {
    localStorage.setItem('macauItineraryOrder', JSON.stringify(itineraryOrder))
  }, [itineraryOrder])

  useEffect(() => {
    localStorage.setItem(
      'macauItineraryRouteCache',
      JSON.stringify(itineraryRouteCache)
    )
    itineraryRouteCacheRef.current = itineraryRouteCache
  }, [itineraryRouteCache])

  useEffect(() => {
    localStorage.setItem(
      'macauItineraryLegModes',
      JSON.stringify(itineraryLegModes)
    )
  }, [itineraryLegModes])

  useEffect(() => {
    if (
      activeItineraryDate !== 'all'
      && !allItineraryKeys.includes(activeItineraryDate)
    ) {
      setActiveItineraryDate('all')
    }
  }, [activeItineraryDate, places])

  useEffect(() => {
    if (!ready) return

    const AMap = engine.current
    const markers = places.map(place => {
      const dot = document.createElement('div')
      dot.className = 'place-dot'
      dot.style.background = colors[place.priority]

      const marker = new AMap.Marker({
        position: [place.lng, place.lat],
        content: dot,
        anchor: 'center',
        zIndex: 120,
      })

      marker.setLabel({
        content: String(place.name),
        direction: 'top',
        offset: new AMap.Pixel(0, -10),
      })

      marker.on('click', () => {
        mapRef.current?.setZoomAndCenter(17, [place.lng, place.lat])
      })

      return marker
    })

    if (draft) {
      const dot = document.createElement('div')
      dot.className = 'place-dot selected-dot'
      markers.push(
        new AMap.Marker({
          position: [draft.lng, draft.lat],
          content: dot,
          anchor: 'center',
          zIndex: 130,
        })
      )
    }

    const map = mapRef.current
    map.add(markers)

    return () => {
      map?.remove(markers)
    }
  }, [places, draft, ready])

  useEffect(() => {
    if (!ready || page !== 'itinerary') return undefined

    void calculateTransportForGroups(visibleItineraryGroups, false)

    return () => {
      itineraryCalcVersion.current++
    }
  }, [ready, page, visibleItinerarySignature])

  function updateItineraryRouteCache(updater) {
    setItineraryRouteCache(current => {
      const next = typeof updater === 'function' ? updater(current) : updater
      itineraryRouteCacheRef.current = next
      return next
    })
  }

  function getItineraryLegMode(groupKeyValue, startPlace, endPlace) {
    const key = itineraryLegModeKey(groupKeyValue, startPlace, endPlace)
    const savedMode = itineraryLegModes[key]
    return itineraryTransportModes[savedMode] ? savedMode : 'walking'
  }

  function changeItineraryLegMode(groupKeyValue, startPlace, endPlace, newMode) {
    if (!itineraryTransportModes[newMode]) return

    const key = itineraryLegModeKey(groupKeyValue, startPlace, endPlace)

    setItineraryLegModes(current => ({
      ...current,
      [key]: newMode,
    }))
  }

  function openMap(place = null) {
    setPage('map')

    window.setTimeout(() => {
      mapRef.current?.resize?.()
      if (place) {
        mapRef.current?.setZoomAndCenter(17, [place.lng, place.lat])
      }
    }, 80)
  }

  function openItinerary() {
    setPage('itinerary')
  }

  async function searchPlace(event) {
    event.preventDefault()
    if (!search.trim() || !engine.current) return

    setSearchBusy(true)
    setSearchError('')
    setResults([])

    try {
      const service = new engine.current.PlaceSearch({
        city: '澳门',
        citylimit: true,
        pageSize: 20,
        extensions: 'all',
      })

      const data = await serviceCall(service, search.trim())
      const pois = (data.poiList?.pois || []).filter(place => place.location)
      setResults(pois)

      if (!pois.length) {
        setSearchError('没有找到地点，请尝试更短的店名或繁体中文。')
      }
    } catch (error) {
      setSearchError(error.message)
    } finally {
      setSearchBusy(false)
    }
  }

  function choose(place) {
    const lng = place.location.getLng()
    const lat = place.location.getLat()

    setDraft({
      name: place.name,
      address: [
        text(place.pname),
        text(place.cityname),
        text(place.adname),
        text(place.address),
      ]
        .filter((value, index, array) => value && array.indexOf(value) === index)
        .join(' '),
      openingHours:
        text(place.business?.opentime)
        || text(place.biz_ext?.open_time),
      priority: '必须去',
      tripDate: '',
      lng,
      lat,
    })

    mapRef.current?.setZoomAndCenter(17, [lng, lat])
    setResults([])
  }

  function save(event) {
    event.preventDefault()
    if (!draft?.name.trim()) return

    const id = crypto.randomUUID()
    const newPlace = {
      ...draft,
      name: draft.name.trim(),
      tripDate: draft.tripDate || '',
      id,
      coordSystem: 'GCJ02',
    }

    const key = groupKey(newPlace.tripDate)

    setItineraryOrder(current => {
      const currentIds = orderedPlacesForKey(key, places, current)
        .map(place => String(place.id))
      return {
        ...current,
        [key]: [...currentIds, id],
      }
    })

    setPlaces(current => [...current, newPlace])
    setDraft(null)
  }

  function changePlacePriority(placeId, newPriority) {
    if (!colors[newPriority]) return

    const id = String(placeId)

    setPlaces(current =>
      current.map(place =>
        String(place.id) === id
          ? {
              ...place,
              priority: newPriority,
            }
          : place
      )
    )
  }

  function changePlaceDate(placeId, newDate) {
    const id = String(placeId)
    const place = places.find(item => String(item.id) === id)
    if (!place) return

    const oldKey = groupKey(place.tripDate)
    const newKey = groupKey(newDate)

    if (oldKey !== newKey) {
      setItineraryOrder(current => {
        const oldIds = orderedPlacesForKey(oldKey, places, current)
          .map(item => String(item.id))
          .filter(itemId => itemId !== id)

        const newIds = orderedPlacesForKey(newKey, places, current)
          .map(item => String(item.id))
          .filter(itemId => itemId !== id)

        return {
          ...current,
          [oldKey]: oldIds,
          [newKey]: [...newIds, id],
        }
      })
    }

    setPlaces(current =>
      current.map(item =>
        String(item.id) === id
          ? { ...item, tripDate: newDate }
          : item
      )
    )
  }

  function moveItineraryPlace(key, index, direction) {
    const ordered = orderedPlacesForKey(key, places, itineraryOrder)
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= ordered.length) return

    const ids = ordered.map(place => String(place.id))
    ;[ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]

    setItineraryOrder(current => ({
      ...current,
      [key]: ids,
    }))
  }

  async function calculateTransportForGroups(groups, force) {
    if (!engine.current || !ready) return

    const pairs = []
    const seen = new Set()

    groups.forEach(group => {
      if (group.key === UNSCHEDULED) return

      for (let index = 0; index < group.places.length - 1; index += 1) {
        const startPlace = group.places[index]
        const endPlace = group.places[index + 1]
        const mode = getItineraryLegMode(group.key, startPlace, endPlace)
        const key = itineraryRouteKey(startPlace, endPlace, mode)

        if (!seen.has(key)) {
          pairs.push({
            key,
            startPlace,
            endPlace,
            mode,
          })
          seen.add(key)
        }
      }
    })

    if (!pairs.length) {
      setItineraryBusy(false)
      setItineraryError('')
      return
    }

    const version = ++itineraryCalcVersion.current
    setItineraryBusy(true)
    setItineraryError('')

    let failedCount = 0

    for (const pair of pairs) {
      if (version !== itineraryCalcVersion.current) return

      if (!force && itineraryRouteCacheRef.current[pair.key]?.time) {
        continue
      }

      try {
        const AMap = engine.current
        let service
        let data
        let result

        if (pair.mode === 'walking') {
          service = new AMap.Walking()
        } else {
          service = new AMap.Driving()
        }

        data = await serviceCall(
          service,
          [pair.startPlace.lng, pair.startPlace.lat],
          [pair.endPlace.lng, pair.endPlace.lat]
        )

        result = data.routes?.[0]

        if (version !== itineraryCalcVersion.current) return

        if (
          !result
          || !Number.isFinite(Number(result.time))
          || !Number.isFinite(Number(result.distance))
        ) {
          throw new Error(`高德未返回有效的${transportLabel(pair.mode)}时间。`)
        }

        updateItineraryRouteCache(current => ({
          ...current,
          [pair.key]: {
            startId: String(pair.startPlace.id),
            endId: String(pair.endPlace.id),
            mode: pair.mode,
            time: Number(result.time),
            distance: Number(result.distance),
            updatedAt: Date.now(),
          },
        }))
      } catch (error) {
        failedCount += 1

        updateItineraryRouteCache(current => ({
          ...current,
          [pair.key]: {
            startId: String(pair.startPlace.id),
            endId: String(pair.endPlace.id),
            mode: pair.mode,
            error: error.message,
            updatedAt: Date.now(),
          },
        }))
      }
    }

    if (version === itineraryCalcVersion.current) {
      setItineraryBusy(false)

      if (failedCount > 0) {
        setItineraryError(
          `有 ${failedCount} 段路线暂时没有返回数据。可以切换交通方式或点击“重新计算”再试。`
        )
      }
    }
  }

  function recalculateVisibleTransport() {
    void calculateTransportForGroups(visibleItineraryGroups, true)
  }

  async function queryRoute() {
    const startPlace = places.find(place => String(place.id) === start)
    const endPlace = places.find(place => String(place.id) === end)

    if (!startPlace || !endPlace) {
      setRouteError('请先选择起点和终点。')
      return
    }

    if (start === end) {
      setRouteError('起点和终点需要是不同地点。')
      return
    }

    setRouteError('')
    setRouteBusy(true)
    const version = ++routeVersion.current

    try {
      const AMap = engine.current
      const service = mode === 'walking'
        ? new AMap.Walking()
        : new AMap.Driving()

      const data = await serviceCall(
        service,
        [startPlace.lng, startPlace.lat],
        [endPlace.lng, endPlace.lat]
      )

      if (version !== routeVersion.current) return

      const result = data.routes?.[0]
      if (
        !result
        || !Number.isFinite(Number(result.time))
        || !Number.isFinite(Number(result.distance))
      ) {
        throw new Error('高德未返回有效的路线时间。')
      }

      const path = (result.steps || []).flatMap(step => step.path || [])
      if (!path.length) throw new Error('高德没有返回可绘制的路线。')

      const routeColor = routeColors[routeLayers.current.length % routeColors.length]
      const line = new AMap.Polyline({
        path,
        strokeColor: routeColor,
        strokeWeight: 6,
        strokeOpacity: 0.86,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 80,
      })

      const pins = [startPlace, endPlace].map((place, index) => {
        const content = document.createElement('div')
        content.className = 'route-pin'
        content.style.background = routeColor
        content.textContent = index === 0 ? 'A' : 'B'

        return new AMap.Marker({
          position: [place.lng, place.lat],
          content,
          anchor: 'bottom-center',
          zIndex: 180,
        })
      })

      const minutes = formatMinutes(result.time)
      const badge = document.createElement('div')
      badge.className = 'route-time-badge'
      badge.style.borderColor = routeColor
      badge.style.color = routeColor
      badge.innerHTML = `
        <strong>${mode === 'walking' ? '步行' : '驾车'} ${minutes} 分钟</strong>
        <span>${formatDistance(result.distance)}</span>
      `

      const middlePoint = path[Math.floor(path.length / 2)]
      const timeMarker = new AMap.Marker({
        position: middlePoint,
        content: badge,
        anchor: 'center',
        zIndex: 220,
      })

      const overlays = [line, ...pins, timeMarker]
      mapRef.current?.add(overlays)
      mapRef.current?.setFitView(overlays)

      const routeId = crypto.randomUUID()
      routeLayers.current.push({ id: routeId, overlays })

      setRoutes(current => [
        ...current,
        {
          id: routeId,
          startId: String(startPlace.id),
          endId: String(endPlace.id),
          a: startPlace.name,
          b: endPlace.name,
          mode,
          time: Number(result.time),
          distance: Number(result.distance),
          steps: result.steps || [],
          color: routeColor,
        },
      ])
    } catch (error) {
      if (version === routeVersion.current) setRouteError(error.message)
    } finally {
      if (version === routeVersion.current) setRouteBusy(false)
    }
  }

  function removeRoute(routeId) {
    const target = routeLayers.current.find(layer => layer.id === routeId)
    if (target) mapRef.current?.remove(target.overlays)

    routeLayers.current = routeLayers.current.filter(layer => layer.id !== routeId)
    setRoutes(current => current.filter(route => route.id !== routeId))
  }

  function removeRoutesForPlace(placeId) {
    const id = String(placeId)
    const relatedIds = new Set(
      routes
        .filter(route => route.startId === id || route.endId === id)
        .map(route => route.id)
    )

    routeLayers.current
      .filter(layer => relatedIds.has(layer.id))
      .forEach(layer => mapRef.current?.remove(layer.overlays))

    routeLayers.current = routeLayers.current.filter(layer => !relatedIds.has(layer.id))
    setRoutes(current => current.filter(route => !relatedIds.has(route.id)))
  }

  function clearAllRoutes() {
    routeVersion.current++
    routeLayers.current.forEach(layer => mapRef.current?.remove(layer.overlays))
    routeLayers.current = []
    setRoutes([])
    setRouteError('')
    setRouteBusy(false)
  }

  function deletePlace(place) {
    if (!window.confirm(`删除「${place.name}」？`)) return

    const id = String(place.id)
    removeRoutesForPlace(id)

    if (start === id) setStart('')
    if (end === id) setEnd('')

    setItineraryOrder(current => {
      const next = {}
      Object.entries(current).forEach(([key, ids]) => {
        next[key] = Array.isArray(ids)
          ? ids.map(String).filter(itemId => itemId !== id)
          : []
      })
      return next
    })

    updateItineraryRouteCache(current => {
      const next = {}
      Object.entries(current).forEach(([key, value]) => {
        if (value?.startId !== id && value?.endId !== id) {
          next[key] = value
        }
      })
      return next
    })

    setItineraryLegModes(current => {
      const next = {}

      Object.entries(current).forEach(([key, value]) => {
        const parts = key.split('::')
        const startId = parts.at(-2)
        const endId = parts.at(-1)

        if (startId !== id && endId !== id) {
          next[key] = value
        }
      })

      return next
    })

    setPlaces(current => current.filter(item => String(item.id) !== id))
  }

  async function importFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const raw = JSON.parse(await file.text())
      const incomingPlaces = Array.isArray(raw) ? raw : raw?.places
      const incomingOrder = !Array.isArray(raw) && raw?.itineraryOrder
        && typeof raw.itineraryOrder === 'object'
        ? raw.itineraryOrder
        : {}

      const rawIncomingLegModes = !Array.isArray(raw) && raw?.itineraryLegModes
        && typeof raw.itineraryLegModes === 'object'
        ? raw.itineraryLegModes
        : {}

      const incomingLegModes = Object.fromEntries(
        Object.entries(rawIncomingLegModes)
          .filter(([, savedMode]) => itineraryTransportModes[savedMode])
      )

      if (!validPlaces(incomingPlaces)) {
        throw new Error('文件格式不正确，请选择从本程序导出的行程 JSON。')
      }

      if (!window.confirm('导入将替换当前收藏和行程顺序。建议先导出备份。继续吗？')) {
        return
      }

      const converted = await convertPlaces(
        engine.current,
        incomingPlaces.map(normalizePlace)
      )

      clearAllRoutes()
      itineraryCalcVersion.current++
      setStart('')
      setEnd('')
      setPlaces(converted.map(normalizePlace))
      setItineraryOrder(incomingOrder)
      setItineraryLegModes(incomingLegModes)
      updateItineraryRouteCache({})
      setActiveItineraryDate('all')
    } catch (error) {
      window.alert(error.message)
    }
  }

  return (
    <div className="app">
      <div className={page === 'map' ? 'page-panel' : 'page-panel page-hidden'}>
        <header className="header">
          <div className="header-title-row">
            <div>
              <h1>Macau Trip Planner</h1>
              <p>我的澳门旅行收藏地图 · 高德中文搜索</p>
            </div>
            <button type="button" className="header-page-button" onClick={openItinerary}>
              ☰ 行程
            </button>
          </div>

          <div className="legend">
            {Object.keys(colors).map(priority => (
              <span key={priority} style={{ color: colors[priority] }}>
                ● {priority}
              </span>
            ))}
          </div>

          <form className="search-bar" onSubmit={searchPlace}>
            <input
              aria-label="搜索地点"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="输入澳门店名，例如 Apple 澳门银河"
            />
            <button disabled={!ready || searchBusy}>
              {searchBusy ? '搜索中…' : '搜索地点'}
            </button>
          </form>

          {searchError && <p role="alert" className="error">{searchError}</p>}

          {!!results.length && (
            <div className="search-results">
              {results.map(place => (
                <button
                  type="button"
                  className="search-result"
                  key={place.id}
                  onClick={() => choose(place)}
                >
                  <strong>{place.name}</strong>
                  <span>{text(place.adname)} {text(place.address)}</span>
                </button>
              ))}
            </div>
          )}
        </header>

        {mapError && <p role="alert" className="error banner">{mapError}</p>}

        <main className="layout">
          <div className="map-wrapper">
            <div className="map" ref={container} />

            {!ready && !mapError && (
              <div className="loading">正在加载地图并转换旧收藏坐标…</div>
            )}

            {draft && (
              <form className="add-panel" onSubmit={save}>
                <h2>添加收藏</h2>

                <label>
                  地点名称
                  <input
                    required
                    value={draft.name}
                    onChange={event => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>

                <label>
                  地址
                  <textarea
                    value={draft.address}
                    onChange={event => setDraft({ ...draft, address: event.target.value })}
                  />
                </label>

                <label>
                  收藏等级
                  <select
                    value={draft.priority}
                    onChange={event => setDraft({ ...draft, priority: event.target.value })}
                  >
                    {Object.keys(colors).map(priority => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                </label>

                <label>
                  计划日期
                  <input
                    type="date"
                    value={draft.tripDate || ''}
                    onChange={event => setDraft({ ...draft, tripDate: event.target.value })}
                  />
                </label>

                <label>
                  营业时间
                  <input
                    placeholder="接口未提供时可手动填写"
                    value={draft.openingHours}
                    onChange={event => setDraft({ ...draft, openingHours: event.target.value })}
                  />
                </label>

                <div className="actions">
                  <button>保存收藏</button>
                  <button type="button" className="secondary" onClick={() => setDraft(null)}>
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>

          <aside>
            <section>
              <h2>我的收藏（{places.length}）</h2>

              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => downloadPlan(places, itineraryOrder, itineraryLegModes)}
                >
                  导出行程
                </button>

                <button
                  type="button"
                  disabled={!ready}
                  className="secondary"
                  onClick={() => fileInput.current?.click()}
                >
                  导入行程
                </button>

                <input
                  hidden
                  type="file"
                  accept=".json"
                  ref={fileInput}
                  onChange={importFile}
                />
              </div>

              <p className="hint">
                日期、行程顺序和每段交通方式都会保存在当前浏览器，也会包含在导出的行程文件中。
              </p>

              {places.map(place => (
                <article className="favorite" key={place.id}>
                  <strong style={{ color: colors[place.priority] }}>{place.name}</strong>
                  <small>
                    {place.priority} · {place.openingHours || '营业时间暂未填写'}
                  </small>
                  <p>{place.address || '地址暂未填写'}</p>

                  <div className="favorite-edit-fields">
                    <label className="favorite-date">
                      收藏等级
                      <select
                        value={place.priority}
                        onChange={event =>
                          changePlacePriority(place.id, event.target.value)
                        }
                      >
                        <option value="必须去">必须去</option>
                        <option value="一定去">一定去</option>
                        <option value="可以去">可以去</option>
                      </select>
                    </label>

                    <label className="favorite-date">
                      计划日期
                      <input
                        type="date"
                        value={place.tripDate || ''}
                        onChange={event =>
                          changePlaceDate(place.id, event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="actions">
                    <button
                      type="button"
                      disabled={!ready}
                      className="secondary"
                      onClick={() => openMap(place)}
                    >
                      定位
                    </button>


                    {!!place.tripDate && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => changePlaceDate(place.id, '')}
                      >
                        清除日期
                      </button>
                    )}

                    <button
                      type="button"
                      className="danger"
                      disabled={!ready}
                      onClick={() => deletePlace(place)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </aside>
        </main>
      </div>

      <div className={page === 'itinerary' ? 'page-panel itinerary-page' : 'page-panel itinerary-page page-hidden'}>
        <header className="itinerary-header">
          <div>
            <p className="eyebrow">MACAU TRIP</p>
            <h1>澳门行程</h1>
            <p>按日期和顺序查看地点，每一段都可以切换步行或开车。</p>
          </div>
          <button type="button" className="header-page-button" onClick={() => openMap()}>
            🗺 地图
          </button>
        </header>

        <div className="date-tabs" aria-label="行程日期筛选">
          <button
            type="button"
            className={activeItineraryDate === 'all' ? 'date-tab active' : 'date-tab'}
            onClick={() => setActiveItineraryDate('all')}
          >
            全部
          </button>

          {scheduledDates.map(date => (
            <button
              type="button"
              key={date}
              className={activeItineraryDate === date ? 'date-tab active' : 'date-tab'}
              onClick={() => setActiveItineraryDate(date)}
            >
              {formatDateTab(date)}
            </button>
          ))}

          {hasUnscheduled && (
            <button
              type="button"
              className={activeItineraryDate === UNSCHEDULED ? 'date-tab active' : 'date-tab'}
              onClick={() => setActiveItineraryDate(UNSCHEDULED)}
            >
              未安排
            </button>
          )}
        </div>

        <div className="itinerary-toolbar">
          <span>
            {itineraryBusy ? '正在计算交通时间…' : '每一段都可以单独选择步行或开车'}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={!ready || itineraryBusy}
            onClick={recalculateVisibleTransport}
          >
            重新计算
          </button>
        </div>

        {itineraryError && <p role="alert" className="error itinerary-error">{itineraryError}</p>}

        <main className="itinerary-content">
          {!places.length && (
            <div className="empty-state">
              还没有收藏地点。先去地图页搜索并收藏地点。
            </div>
          )}

          {!!places.length && !visibleItineraryGroups.length && (
            <div className="empty-state">这个日期还没有安排地点。</div>
          )}

          {visibleItineraryGroups.map(group => (
            <section className="itinerary-day" key={group.key}>
              <div className="day-heading">
                <div>
                  <span className="day-kicker">
                    {group.key === UNSCHEDULED ? 'TO PLAN' : 'DAY PLAN'}
                  </span>
                  <h2>
                    {group.key === UNSCHEDULED
                      ? '未安排'
                      : formatDateTitle(group.key)}
                  </h2>
                </div>
                <span className="day-count">{group.places.length} 个地点</span>
              </div>

              {group.key === UNSCHEDULED && (
                <p className="unscheduled-hint">
                  这些收藏还没有日期。在地图页的收藏列表里设置日期后，会自动进入对应日期。
                </p>
              )}

              <div className="itinerary-list">
                {group.places.map((place, index) => {
                  const nextPlace = group.places[index + 1]
                  const legMode = nextPlace
                    ? getItineraryLegMode(group.key, place, nextPlace)
                    : 'walking'

                  const leg = nextPlace
                    ? itineraryRouteCache[
                        itineraryRouteKey(place, nextPlace, legMode)
                      ]
                    : null

                  return (
                    <div className="itinerary-item-block" key={place.id}>
                      <article className="itinerary-stop">
                        <button
                          type="button"
                          className="stop-main"
                          onClick={() => openMap(place)}
                        >
                          <span className="stop-number">
                            {String(index + 1).padStart(2, '0')}
                          </span>

                          <span className="stop-info">
                            <strong>{place.name}</strong>
                            <small>
                              <span style={{ color: colors[place.priority] }}>●</span>
                              {' '}{place.priority}
                              {place.openingHours ? ` · ${place.openingHours}` : ''}
                            </small>
                            {place.address && <span className="stop-address">{place.address}</span>}
                          </span>

                          <span className="map-jump" aria-hidden="true">🗺</span>
                        </button>

                        <div className="stop-order-actions" aria-label="调整行程顺序">
                          <button
                            type="button"
                            className="secondary order-button"
                            disabled={index === 0}
                            onClick={() => moveItineraryPlace(group.key, index, -1)}
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="secondary order-button"
                            disabled={index === group.places.length - 1}
                            onClick={() => moveItineraryPlace(group.key, index, 1)}
                            title="下移"
                          >
                            ↓
                          </button>
                        </div>
                      </article>

                      {nextPlace && group.key !== UNSCHEDULED && (
                        <div className="itinerary-leg">
                          <span className="leg-line" aria-hidden="true" />

                          <div className="leg-content">
                            <div
                              className="leg-mode-switch"
                              aria-label={`${place.name} 到 ${nextPlace.name} 的交通方式`}
                            >
                              {Object.entries(itineraryTransportModes).map(
                                ([transportMode, label]) => (
                                  <button
                                    type="button"
                                    key={transportMode}
                                    className={
                                      legMode === transportMode
                                        ? 'leg-mode-button active'
                                        : 'leg-mode-button'
                                    }
                                    onClick={() =>
                                      changeItineraryLegMode(
                                        group.key,
                                        place,
                                        nextPlace,
                                        transportMode
                                      )
                                    }
                                  >
                                    {label}
                                  </button>
                                )
                              )}
                            </div>

                            <div className="leg-badge">
                              {leg?.time ? (
                                <>
                                  <strong>
                                    {transportLabel(legMode)} {formatMinutes(leg.time)} 分钟
                                  </strong>
                                  <span>{formatDistance(leg.distance)}</span>
                                </>
                              ) : leg?.error ? (
                                <>
                                  <strong>{transportLabel(legMode)}暂无数据</strong>
                                  <span>可换一种方式，或点击“重新计算”再试</span>
                                </>
                              ) : (
                                <>
                                  <strong>
                                    {itineraryBusy ? '正在计算…' : '等待计算'}
                                  </strong>
                                  <span>{place.name} → {nextPlace.name}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="主页面切换">
        <button
          type="button"
          className={page === 'map' ? 'bottom-nav-button active' : 'bottom-nav-button'}
          onClick={() => openMap()}
        >
          <span aria-hidden="true">🗺</span>
          <span>地图</span>
        </button>

        <button
          type="button"
          className={page === 'itinerary' ? 'bottom-nav-button active' : 'bottom-nav-button'}
          onClick={openItinerary}
        >
          <span aria-hidden="true">☰</span>
          <span>行程</span>
        </button>
      </nav>
    </div>
  )
}

export default App
