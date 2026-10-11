import { describe, expect, test } from "vitest"
import { CameraController } from "@zoomport/core"
import { connectDOMCulling } from "./culling.js"

const scheduler = { request: () => 1, cancel: () => {} }
function scene() {
  const viewport = document.createElement("div")
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
  })
  document.body.append(viewport)
  const engine = new CameraController({ scheduler })
  engine.setViewport(100,100)
  const nodes = Array.from({length:100}, () => document.createElement("div"))
  for(const node of nodes) viewport.append(node)
  return { viewport, engine, nodes }
}
describe("DOM scene culling",()=>{
  test("hides offscreen shapes and restores authored display on disposal",()=>{
    const {viewport,engine,nodes}=scene()
    nodes[0]!.style.display="inline-block"
    const layer=connectDOMCulling(engine,viewport,nodes.map((node,id)=>({
      id,node,bounds:{x:id*100,y:0,width:20,height:20}
    })),{overscanPx:0,cacheMarginPx:0,observeResize:false})
    expect(nodes[0]!.style.display).toBe("inline-block")
    expect(nodes[1]!.style.display).toBe("")
    expect(nodes[2]!.style.display).toBe("none")
    const previous=layer.visibility.getVisible()
    engine.jumpTo({x:-300,y:0,scale:1})
    expect(layer.visibility.getVisible()).not.toBe(previous)
    expect(nodes[0]!.style.display).toBe("none")
    expect(nodes[3]!.style.display).toBe("")
    expect(nodes[4]!.style.display).toBe("")
    layer.pin(0)
    expect(nodes[0]!.style.display).toBe("inline-block")
    layer.pin(0,false)
    expect(nodes[0]!.style.display).toBe("none")
    layer.dispose()
    expect(nodes[0]!.style.display).toBe("inline-block")
    expect(nodes[15]!.style.display).toBe("")
    engine.destroy()
    viewport.remove()
  })
  test("upsert, replacement, removal, resize and cleanup",()=>{
    const {viewport,engine,nodes}=scene()
    const layer=connectDOMCulling(engine,viewport,[{id:"a",node:nodes[0]!,bounds:{x:999,y:999,width:10,height:10}}],
      {overscanPx:0,cacheMarginPx:0,observeResize:false})
    expect(nodes[0]!.style.display).toBe("none")
    layer.upsert({id:"a",node:nodes[0]!,bounds:{x:1,y:1,width:5,height:5}})
    expect(nodes[0]!.style.display).toBe("")
    layer.upsert({id:"a",node:nodes[1]!,bounds:{x:1000,y:0,width:5,height:5}})
    expect(nodes[0]!.style.display).toBe("")
    expect(nodes[1]!.style.display).toBe("none")
    expect(layer.remove("a")).toBe(true)
    expect(nodes[1]!.style.display).toBe("")
    expect(layer.remove("a")).toBe(false)
    layer.upsert({id:"b",node:nodes[2]!,bounds:{x:500,y:500,width:5,height:5}})
    expect(nodes[2]!.style.display).toBe("none")
    engine.jumpTo({x:-500,y:-500,scale:1})
    expect(nodes[2]!.style.display).toBe("")
    layer.dispose()
    layer.dispose()
    engine.jumpTo({x:0,y:0,scale:1})
    expect(nodes[2]!.style.display).toBe("")
    engine.destroy()
    viewport.remove()
  })
})
