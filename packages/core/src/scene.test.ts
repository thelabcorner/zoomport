import { describe, expect, test } from "vitest"
import { SceneIndex, SceneVisibility, type SpatialEntry, type Bounds } from "./index.js"

const entry = (id: number, x: number, y: number, w = 20, h = 20): SpatialEntry<number> =>
  ({ id, bounds: { x, y, width: w, height: h } })
const brute = (items: SpatialEntry<number>[], b: Bounds) =>
  items.filter(v => v.bounds.x <= b.x + b.width && v.bounds.x + v.bounds.width >= b.x &&
    v.bounds.y <= b.y + b.height && v.bounds.y + v.bounds.height >= b.y).map(v => v.id).sort((a,b)=>a-b)

describe("SceneIndex spatial culling", () => {
  test("empty, points, intersections and edge inclusion", () => {
    const index = new SceneIndex<number>()
    expect(index.query({ x:0, y:0, width:1, height:1 })).toEqual([])
    index.upsert(entry(1, 0, 0, 1, 1))
    index.upsert(entry(2, 1, 1, 0, 0))
    index.upsert(entry(3, 10, 10))
    expect(index.query({x:1,y:1,width:0,height:0}).sort()).toEqual([1,2])
    expect(index.query({x:0,y:0,width:5,height:5}).sort()).toEqual([1,2])
    expect(index.size).toBe(3)
    expect(index.remove(1)).toBe(true)
    expect(index.remove(1)).toBe(false)
    expect(index.size).toBe(2)
    expect(index.query({x:0,y:0,width:5,height:5})).toEqual([2])
    index.clear()
    expect(index.size).toBe(0)
  })
  test("adversarial coincident centers, duplicated IDs, zero extents", () => {
    const items = Array.from({length:513}, (_, i) => entry(i, 100-i%5,100-i%5, i%5*2, i%5*2))
    const index = new SceneIndex(items, { leafSize: 3 })
    const query = {x:99,y:99,width:2,height:2}
    expect(index.query(query).sort((a,b)=>a-b)).toEqual(brute(items,query))
    index.upsert(entry(1, 10000, 10000))
    expect(index.query(query)).not.toContain(1)
    expect(index.query({x:10000,y:10000,width:1,height:1})).toEqual([1])
  })
  test("randomized BVH vs exhaustive scan, mutations and compaction", () => {
    let seed=0xabcdef01
    const rand=()=>{ seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
    const rows = Array.from({length:2200},(_,i)=>entry(i,(rand()-.5)*100000,(rand()-.5)*100000,rand()*800,rand()*800))
    const map = new Map(rows.map(v=>[v.id,v]))
    const index = new SceneIndex(rows, { leafSize: 11, rebuildThreshold: 70 })
    for(let i=0;i<320;i++){
      if(i%7===0){
        const id = Math.floor(rand()*2700)
        if(i%14===0) { index.remove(id); map.delete(id) }
        else { const updated=entry(id,(rand()-.5)*100000,(rand()-.5)*100000,rand()*1000,rand()*1000); index.upsert(updated); map.set(id,updated) }
      }
      const area={x:(rand()-.5)*100000,y:(rand()-.5)*100000,width:rand()*10000,height:rand()*10000}
      const found = index.query(area).sort((a,b)=>a-b)
      expect(found).toEqual(brute([...map.values()],area))
      expect(new Set(found).size).toBe(found.length)
    }
    index.compact()
    expect(index.size).toBe(map.size)
  })
  test("bounding-box validation and finite overflow", () => {
    expect(()=>new SceneIndex([entry(1, NaN, 0)])).toThrow(RangeError)
    expect(()=>new SceneIndex([entry(1, 0, 0, -1)])).toThrow(RangeError)
    expect(()=>new SceneIndex([entry(1, 1e308, 0, 1e308)])).toThrow(RangeError)
    expect(()=>new SceneIndex([], {leafSize:1})).toThrow(RangeError)
    const i = new SceneIndex<number>()
    expect(()=>i.query({x:0,y:0,width:-1,height:1})).toThrow(RangeError)
  })
})

describe("SceneVisibility incremental camera interest", () => {
  const index = new SceneIndex([entry(1,0,0),entry(2,120,0),entry(3,300,0),entry(4,600,0)])
  test("pans without querying inside guard, then diffs and supports pins", () => {
    const visibility = new SceneVisibility(index, { overscanPx:0, cacheMarginPx:25 })
    const viewport = {width:100,height:100}
    let result = visibility.update({x:0,y:0,scale:1},viewport)
    expect(result.requeried).toBe(true)
    expect([...visibility.getVisible()].sort()).toEqual([1,2])
    const original=visibility.getVisible()
    result=visibility.update({x:-10,y:0,scale:1},viewport)
    expect(result.requeried).toBe(false)
    expect(visibility.getVisible()).toBe(original)
    result=visibility.update({x:-210,y:0,scale:1},viewport)
    expect(result.requeried).toBe(true)
    expect(result.added).toContain(3)
    expect(result.removed).toContain(1)
    visibility.pin(1)
    result=visibility.update({x:-210,y:0,scale:1},viewport)
    expect(result.added).toContain(1)
    visibility.pin(1,false)
    result=visibility.update({x:-210,y:0,scale:1},viewport)
    expect(result.removed).toContain(1)
  })
  test("zoom-out invalidates guard and index revisions bypass cache",()=>{
    const i=new SceneIndex([entry(1, 0,0),entry(2,150,0)])
    const v=new SceneVisibility(i,{overscanPx:0,cacheMarginPx:1})
    const viewport={width:100,height:100}
    v.update({x:0,y:0,scale:1},viewport)
    expect(v.getVisible().has(2)).toBe(false)
    expect(v.update({x:0,y:0,scale:0.5},viewport).requeried).toBe(true)
    expect(v.getVisible().has(2)).toBe(true)
    i.upsert(entry(2, 1000,0))
    const diff=v.update({x:0,y:0,scale:0.5},viewport)
    expect(diff.requeried).toBe(true)
    expect(diff.removed).toEqual([2])
  })
  test("zooming deeply into a cached large world must shrink candidate set", () => {
    const entries = Array.from({length:2500},(_,id)=>entry(id,(id%50)*40,Math.floor(id/50)*40))
    const v = new SceneVisibility(new SceneIndex(entries),{overscanPx:0,cacheMarginPx:250})
    const viewport={width:500,height:500}
    v.update({x:0,y:0,scale:0.2},viewport)
    expect(v.size).toBe(2500)
    const change=v.update({x:-100,y:-100,scale:2},viewport)
    expect(change.requeried).toBe(true)
    expect(v.size).toBeLessThan(200)
  })
})
