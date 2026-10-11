import { describe, expect, test } from "vitest"
import { SceneIndex, type SpatialEntry } from "./index.js"
const entry = (id:number,x:number,y:number): SpatialEntry<number> =>
  ({id,bounds:{x,y,width:20,height:20}})
describe("hierarchical semantic LOD",()=>{
  test("far zoom clusters and close zoom returns all exact items",()=>{
    const items=Array.from({length:1600},(_,i)=>entry(i,(i%40)*40,Math.floor(i/40)*40))
    const index=new SceneIndex(items)
    const world={x:0,y:0,width:2000,height:2000}
    const distant=index.queryLOD(world,0.03,96,32)
    expect(distant.length).toBeLessThan(10)
    expect(distant.reduce((n,e)=>n+(e.kind==="cluster"?e.count:1),0)).toBe(1600)
    const close=index.queryLOD(world,10,96,32)
    expect(close).toHaveLength(1600)
    expect(close.every(e=>e.kind==="item")).toBe(true)
    expect(()=>index.queryLOD(world,0)).toThrow(RangeError)
  })
  test("modified items and removals cannot hide inside cached clusters",()=>{
    const items=Array.from({length:1024},(_,i)=>entry(i,(i%32)*40,Math.floor(i/32)*40))
    const index=new SceneIndex(items,{rebuildThreshold:2000})
    const world={x:0,y:0,width:30000,height:30000}
    const before=index.queryLOD(world,0.01,96,32)
    expect(before).toHaveLength(1)
    const previous=before[0]!.kind==="cluster" ? before[0]!.key:""
    index.upsert(entry(5,20000,20000))
    index.remove(6)
    const changed=index.queryLOD(world,0.01,96,32)
    expect(changed.some(e=>e.kind==="item"&&e.id===5)).toBe(true)
    expect(changed.some(e=>e.kind==="item"&&e.id===6)).toBe(false)
    expect(changed.reduce((n,e)=>n+(e.kind==="cluster"?e.count:1),0)).toBe(1023)
    index.compact()
    const rebuilt=index.queryLOD(world,0.01,96,32)
    expect(rebuilt.some(e=>e.kind==="item"&&e.id===5)).toBe(true)
    expect(rebuilt.some(e=>e.kind==="cluster"&&e.key===previous)).toBe(false)
  })
})
