import { describe, it, expect, beforeEach } from 'vitest'
import { RadarStore } from '../RadarStore'
import type { IBenchmarkRepository } from '../../benchmark/IBenchmarkRepository'
import type { IRadarPresetRepository } from '../IRadarPresetRepository'

// The scoping logic touches only localStorage + the observables, never the repos.
const benchmarkRepo = {} as unknown as IBenchmarkRepository
const presetRepo = {} as unknown as IRadarPresetRepository

function makeStore(): RadarStore {
  return new RadarStore(benchmarkRepo, presetRepo)
}

describe('RadarStore favorites — per-account scoping', () => {
  beforeEach(() => localStorage.clear())

  it('keeps each account\'s favorites separate on a shared browser', () => {
    const store = makeStore()

    // Account 1 favorites AAA.
    store.scopeToUser(1)
    store.addSymbol('aaa')
    expect(store.symbols$.get()).toEqual(['AAA'])

    // Switching to account 2 shows a clean list — not account 1's.
    store.scopeToUser(2)
    expect(store.symbols$.get()).toEqual([])
    store.addSymbol('bbb')
    expect(store.symbols$.get()).toEqual(['BBB'])

    // Back to account 1 restores its own favorites from storage.
    store.scopeToUser(1)
    expect(store.symbols$.get()).toEqual(['AAA'])
  })

  it('clears favorites on logout and does not persist while logged out', () => {
    const store = makeStore()
    store.scopeToUser(7)
    store.setFavoritesOnly(true)
    store.addSymbol('AAA')

    store.scopeToUser(null) // logout
    expect(store.symbols$.get()).toEqual([])
    expect(store.favoritesOnly$.get()).toBe(false)

    // Mutations while logged out are not persisted.
    store.addSymbol('ZZZ')
    expect(localStorage.getItem('asistrader:radar:symbols:null')).toBeNull()

    // Account 7's favorites survived the logout untouched.
    store.scopeToUser(7)
    expect(store.symbols$.get()).toEqual(['AAA'])
    expect(store.favoritesOnly$.get()).toBe(true)
  })

  it('a fresh store does not hydrate favorites until scoped to a user', () => {
    const store = makeStore()
    expect(store.symbols$.get()).toEqual([])
    expect(store.favoritesOnly$.get()).toBe(false)
  })
})
