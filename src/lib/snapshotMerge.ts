import type { DashboardSnapshotData, WidgetDataSnapshot } from '@/lib/cloudSnapshots'

export interface DashboardSyncSnapshot {
  dashboard: DashboardSnapshotData
  widgetData: WidgetDataSnapshot
  backgroundPath: string | null
  backgroundSignature: string | null
}

export interface SnapshotConflict {
  path: string
  label: string
  type: 'background' | 'delete-edit' | 'list' | 'value'
}

export interface SnapshotMergeResult {
  backgroundSource: 'local' | 'remote'
  conflicts: SnapshotConflict[]
  merged: DashboardSyncSnapshot
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '__undefined__'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

function equalJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pathToLabel(path: string[]) {
  return path.length ? path.join('.') : 'snapshot'
}

function addConflict(conflicts: SnapshotConflict[], path: string[], type: SnapshotConflict['type']) {
  conflicts.push({
    label: pathToLabel(path),
    path: pathToLabel(path),
    type,
  })
}

function isObjectWithStringKey(value: unknown, key: 'i' | 'id') {
  return isPlainObject(value) && typeof value[key] === 'string'
}

function detectArrayKey(items: unknown[]): 'i' | 'id' | null {
  const objects = items.filter((item) => isPlainObject(item))
  if (objects.length === 0 || objects.length !== items.length) return null
  if (objects.every((item) => isObjectWithStringKey(item, 'id'))) return 'id'
  if (objects.every((item) => isObjectWithStringKey(item, 'i'))) return 'i'
  return null
}

function mapByKey(items: unknown[], key: 'i' | 'id') {
  const map = new Map<string, unknown>()
  for (const item of items) {
    if (isObjectWithStringKey(item, key)) map.set((item as Record<'i' | 'id', string>)[key], item)
  }
  return map
}

function orderedKeys(localItems: unknown[], remoteItems: unknown[], baseItems: unknown[], key: 'i' | 'id') {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const source of [localItems, remoteItems, baseItems]) {
    for (const item of source) {
      if (!isObjectWithStringKey(item, key)) continue
      const itemKey = (item as Record<'i' | 'id', string>)[key]
      if (seen.has(itemKey)) continue
      seen.add(itemKey)
      keys.push(itemKey)
    }
  }
  return keys
}

function mergePrimitiveArray(
  baseItems: unknown[],
  localItems: unknown[],
  remoteItems: unknown[],
  path: string[],
  conflicts: SnapshotConflict[]
) {
  if (![baseItems, localItems, remoteItems].every((items) =>
    items.every((item) => ['boolean', 'number', 'string'].includes(typeof item))
  )) {
    addConflict(conflicts, path, 'list')
    return cloneJson(localItems)
  }

  const values = new Set([...baseItems, ...localItems, ...remoteItems].map((item) => stableStringify(item)))
  const byStableValue = new Map([...baseItems, ...localItems, ...remoteItems].map((item) => [stableStringify(item), item]))
  const next: unknown[] = []

  for (const stableValue of values) {
    const value = byStableValue.get(stableValue)
    const baseHas = baseItems.some((item) => equalJson(item, value))
    const localHas = localItems.some((item) => equalJson(item, value))
    const remoteHas = remoteItems.some((item) => equalJson(item, value))

    if (localHas === remoteHas) {
      if (localHas) next.push(value)
      continue
    }
    if (localHas === baseHas) {
      if (remoteHas) next.push(value)
      continue
    }
    if (remoteHas === baseHas) {
      if (localHas) next.push(value)
      continue
    }

    addConflict(conflicts, [...path, String(value)], 'value')
  }

  return next
}

function mergeArray(
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  path: string[],
  conflicts: SnapshotConflict[]
) {
  const baseItems = Array.isArray(baseValue) ? baseValue : []
  const localItems = Array.isArray(localValue) ? localValue : []
  const remoteItems = Array.isArray(remoteValue) ? remoteValue : []
  const key = detectArrayKey([...baseItems, ...localItems, ...remoteItems])

  if (!key) return mergePrimitiveArray(baseItems, localItems, remoteItems, path, conflicts)

  const baseByKey = mapByKey(baseItems, key)
  const localByKey = mapByKey(localItems, key)
  const remoteByKey = mapByKey(remoteItems, key)
  const next: unknown[] = []

  for (const itemKey of orderedKeys(localItems, remoteItems, baseItems, key)) {
    const baseHas = baseByKey.has(itemKey)
    const localHas = localByKey.has(itemKey)
    const remoteHas = remoteByKey.has(itemKey)
    const baseItem = baseByKey.get(itemKey)
    const localItem = localByKey.get(itemKey)
    const remoteItem = remoteByKey.get(itemKey)
    const itemPath = [...path, itemKey]

    if (!baseHas) {
      if (localHas && remoteHas) {
        next.push(mergeValue(undefined, localItem, remoteItem, itemPath, conflicts))
      } else if (localHas) {
        next.push(cloneJson(localItem))
      } else if (remoteHas) {
        next.push(cloneJson(remoteItem))
      }
      continue
    }

    if (!localHas && !remoteHas) continue

    if (!localHas) {
      if (equalJson(remoteItem, baseItem)) continue
      addConflict(conflicts, itemPath, 'delete-edit')
      continue
    }

    if (!remoteHas) {
      if (equalJson(localItem, baseItem)) continue
      addConflict(conflicts, itemPath, 'delete-edit')
      next.push(cloneJson(localItem))
      continue
    }

    next.push(mergeValue(baseItem, localItem, remoteItem, itemPath, conflicts))
  }

  return next
}

function mergeObject(
  baseValue: unknown,
  localValue: Record<string, unknown>,
  remoteValue: Record<string, unknown>,
  path: string[],
  conflicts: SnapshotConflict[]
) {
  const baseObject = isPlainObject(baseValue) ? baseValue : {}
  const keys = new Set([
    ...Object.keys(baseObject),
    ...Object.keys(localValue),
    ...Object.keys(remoteValue),
  ])
  const next: Record<string, unknown> = {}

  for (const key of keys) {
    const merged = mergeValue(baseObject[key], localValue[key], remoteValue[key], [...path, key], conflicts)
    if (merged !== undefined) next[key] = merged
  }

  return next
}

function mergeValue(
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  path: string[],
  conflicts: SnapshotConflict[]
): unknown {
  if (equalJson(localValue, remoteValue)) return cloneJson(localValue)
  if (equalJson(localValue, baseValue)) return cloneJson(remoteValue)
  if (equalJson(remoteValue, baseValue)) return cloneJson(localValue)

  if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
    return mergeArray(baseValue, localValue, remoteValue, path, conflicts)
  }

  if (isPlainObject(localValue) && isPlainObject(remoteValue)) {
    return mergeObject(baseValue, localValue, remoteValue, path, conflicts)
  }

  addConflict(conflicts, path, 'value')
  return cloneJson(localValue)
}

export function mergeDashboardSnapshots(
  base: DashboardSyncSnapshot,
  local: DashboardSyncSnapshot,
  remote: DashboardSyncSnapshot
): SnapshotMergeResult {
  const conflicts: SnapshotConflict[] = []
  const dashboard = mergeValue(base.dashboard, local.dashboard, remote.dashboard, ['dashboard'], conflicts)
  const widgetData = mergeValue(base.widgetData, local.widgetData, remote.widgetData, ['widgetData'], conflicts)

  const localBackgroundChanged =
    local.backgroundPath !== base.backgroundPath ||
    local.backgroundSignature !== base.backgroundSignature
  const remoteBackgroundChanged =
    remote.backgroundPath !== base.backgroundPath ||
    remote.backgroundSignature !== base.backgroundSignature
  const sameBackground =
    local.backgroundPath === remote.backgroundPath &&
    local.backgroundSignature === remote.backgroundSignature

  let backgroundSource: SnapshotMergeResult['backgroundSource'] = 'local'
  let backgroundPath = local.backgroundPath
  let backgroundSignature = local.backgroundSignature

  if (sameBackground) {
    backgroundSource = 'local'
  } else if (!localBackgroundChanged && remoteBackgroundChanged) {
    backgroundSource = 'remote'
    backgroundPath = remote.backgroundPath
    backgroundSignature = remote.backgroundSignature
  } else if (localBackgroundChanged && remoteBackgroundChanged) {
    addConflict(conflicts, ['background'], 'background')
  }

  return {
    backgroundSource,
    conflicts,
    merged: {
      backgroundPath,
      backgroundSignature,
      dashboard: dashboard as DashboardSnapshotData,
      widgetData: widgetData as WidgetDataSnapshot,
    },
  }
}
