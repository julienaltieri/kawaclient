/**
 * moneyFlowEngine.test.js — properties of the layout that do not need a screen.
 *
 * The engine has no imports, so its pure half (layout/frame) can be asserted directly. These are the
 * invariants that decide whether the picture is readable, as opposed to whether it is correct.
 */
import MoneyFlowEngine, {layout, frame, compose, groupTail, siblingIds} from '../components/MoneyFlowEngine'

const opt = {l1Px:7, l2Px:2, gapShare:0.35, railFrac:0.28, padPx:4, neighbourPx:22,
	softFrac:0.4, leftShare:0.7, cssW:360, worldH:444, tail:"push",
	gapUnit:1000/360, format:v => "$"+Math.round(v)}

// Ragged on purpose: Annual bottoms out a level before its cousins, which is the shape that puts a
// leaf's own column and the end of the view in different places.
const TREE = {
	hubName:"Income",
	in:[{id:"salary",name:"Salary",tone:"income",value:5200,children:[
			{id:"base",name:"Base pay",tone:"income",value:4600,children:null},
			{id:"bonus",name:"Bonus",tone:"income",value:600,children:null}]},
		{id:"side",name:"Side work",tone:"income",value:800,children:null}],
	out:[
		{id:"spd",name:"Spending",tone:"expenses",value:4500,children:[
			{id:"rec",name:"Recurring",tone:"expenses",value:3000,children:[
				{id:"home",name:"Home",tone:"expenses",value:2000,children:[
					{id:"rent",name:"Rent",tone:"expenses",value:1700,children:null},
					{id:"utils",name:"Utilities",tone:"expenses",value:300,children:null}]},
				{id:"living",name:"Living",tone:"expenses",value:1000,children:null}]},
			{id:"annual",name:"Annual",tone:"expenses",value:1500,children:null}]},
		{id:"sav",name:"Savings",tone:"savings",value:1500,children:[
			{id:"buffer",name:"Buffer",tone:"savings",value:1500,children:null}]}],
	inTotal:6000
}

const FOCUSES = [[], ["__inc"], ["__inc","salary"], ["spd"], ["spd","rec"], ["spd","rec","home"], ["sav"]]

describe("a name sits on the bar it names", () => {
	FOCUSES.forEach(f => {
		test("at " + (f.join(">")||"the root"), () => {
			const g = compose(TREE,f,opt).g
			Object.keys(g.names).forEach(key => {
				const n = g.names[key]
				if(!n.rail) return                       // interior names sit beside their own column
				const bar = g.bars["slide:"+n.id]
				expect(bar).toBeDefined()
				// the rail is drawn at the end of the view, and so is the bar it belongs to: if the
				// name is placed from a different column the two part company, the name reads as a
				// stray caption, and the drift rule then gives it up altogether
				expect(n.y).toBeCloseTo(bar.y, 6)
				expect(n.h).toBeCloseTo(bar.h, 6)
			})
		})
	})
})

test("every focus produces the same key set", () => {
	const keys = FOCUSES.map(f => {
		const g = compose(TREE,f,opt).g
		return [Object.keys(g.flows).sort().join("|"), Object.keys(g.bars).sort().join("|")].join("#")
	})
	expect(new Set(keys).size).toBe(1)
})

describe("a change of basis is a move, not a jump", () => {
	// The two bases do not hold the same streams: one with no transactions this period is absent from
	// the actuals and present in the target. Paired by position, they could not be matched at all and
	// the picture snapped from one to the other.
	const N = (id,v,kids) => ({id:id,name:id,tone:"expenses",value:v,children:kids||null})
	const A = {hubName:"Income", inTotal:100,
		in:[{id:"inc",name:"inc",tone:"income",value:100,children:null}],
		out:[N("keep",60), N("goes",40)]}
	const B = {hubName:"Income", inTotal:250,
		in:[{id:"inc",name:"inc",tone:"income",value:250,children:null}],
		out:[N("keep",150), N("arrives",100)]}
	const flat = t => t.in.concat(t.out)
	const value = (t,id) => (flat(t).filter(n => n.id===id)[0]||{}).value

	let eng, host
	beforeEach(() => {
		host = document.createElement("div"); document.body.appendChild(host)
		eng = new MoneyFlowEngine(host,{palette:{income:"#0f0",savings:"#00f",expenses:"#f00",
			alert:"#f00",bodyText:"#fff",bodyTextSecondary:"#999"}, format:v => String(v)})
		eng.setTree(A)
	})
	afterEach(() => eng.destroy())

	test("what animates is the union of both", () => {
		eng.setTree(B)
		expect(flat(eng.shown).map(n => n.id).sort()).toEqual(["arrives","goes","inc","keep"])
	})

	test("and it starts where it came from, not where it is going", () => {
		eng.setTree(B)
		expect(value(eng.shown,"keep")).toBeCloseTo(60,6)     // its old value, not 150
		expect(value(eng.shown,"goes")).toBeCloseTo(40,6)     // still here, on its way out
		expect(value(eng.shown,"arrives")).toBeCloseTo(0,6)   // grows out of nothing
		expect(eng.shown.inTotal).toBeCloseTo(100,6)
	})

	test("money in equals money out at the moment the move begins", () => {
		eng.setTree(B)
		const sum = a => a.reduce((x,y) => x+y.value,0)
		expect(sum(eng.shown.in)).toBeCloseTo(sum(eng.shown.out),6)
	})

	test("the same tree is not a change", () => {
		const spy = jest.spyOn(window,"requestAnimationFrame")
		eng.setTree(A)
		expect(spy).not.toHaveBeenCalled()
		spy.mockRestore()
	})
})

describe("the subject fills the frame", () => {
	// The room a stream gets used to be the room its own share of the money gave it, so a small
	// stream was framed small - and everything downstream of it was smaller again, until its leaves
	// were hairlines and their names went with them. The subject is what is being explained; it gets
	// the height, less one strip at each end for a neighbour's name.
	const fit = f => {
		const r = compose(TREE,f,opt)
		return {g:r.g, cam:r.cam, box:r.g.boxes[f[f.length-1]]}
	}
	const strip = cam => opt.neighbourPx*(cam.w/opt.cssW)

	;[["spd"],["spd","rec"],["spd","rec","home"],["sav"],["__inc","salary"]].forEach(f => {
		test("at " + f.join(">"), () => {
			const {cam,box} = fit(f)
			expect(box.y1-box.y0).toBeCloseTo(cam.h-2*strip(cam), 4)
			// and it is centred, so the two strips are equal
			expect((box.y0+box.y1)/2).toBeCloseTo(cam.y+cam.h/2, 4)
			// which means nothing of the subject is outside the frame
			expect(box.y0).toBeGreaterThan(cam.y)
			expect(box.y1).toBeLessThan(cam.y+cam.h)
		})
	})

	test("a hub place keeps the whole picture, with no strips to leave", () => {
		const r = compose(TREE,[],opt)
		const all = Object.keys(r.g.bars).map(k => r.g.bars[k]).filter(b => b.vis>0.5)
		const lo = Math.min.apply(null,all.map(b => b.y))
		const hi = Math.max.apply(null,all.map(b => b.y+b.h))
		expect(lo).toBeGreaterThan(r.cam.y)
		expect(hi).toBeLessThan(r.cam.y+r.cam.h)
	})

	test("a focus naming nothing is the whole picture, not a shrunken one", () => {
		// A stale path - a stream that has gone away under a change of basis - used to fall back to
		// fitting the PORTFOLIO's total into the room meant for one stream, so every band came out at
		// a fraction of its size and the fit looked broken rather than the focus. It is a hub place.
		const ghost = compose(TREE,["spd","no-such-stream"],opt)
		const root = compose(TREE,[],opt)
		const span = r => {
			const all = Object.keys(r.g.bars).map(q => r.g.bars[q]).filter(b => b.vis>0.5)
			return Math.max.apply(null,all.map(b => b.y+b.h)) - Math.min.apply(null,all.map(b => b.y))
		}
		expect(span(ghost)/ghost.cam.h).toBeCloseTo(span(root)/root.cam.h, 4)
	})

	test("two subjects at the same level still land at the same x", () => {
		const a = fit(["spd"]).cam, b = fit(["sav"]).cam
		expect(a.x).toBeCloseTo(b.x, 6)
		expect(a.w).toBeCloseTo(b.w, 6)
	})
})

describe("the rules of the picture are a fixed size; the money stretches", () => {
	// A separation is a number of screen pixels. It used to be converted against the world once and
	// then carried through the vertical fit like any other length, so zooming into a small stream
	// multiplied the gaps by the same factor as the streams: a seven-pixel separation arrived at
	// seventy and ate the room the fit had just been arranged to give the subject.
	const gapBelow = (r,a,b) => {
		const sa = r.g.selfBox[a], sb = r.g.selfBox[b]
		return (sb.y0 - sa.y1) / (r.cam.w/opt.cssW)          // in screen pixels
	}
	const cases = [
		[["spd"], "rec", "annual"],                          // the subject's children, one level down
		[["spd","rec"], "home", "living"],                   // and two
		[["sav"], "buffer", null]
	]
	test("the separation between a subject's children is the same wherever you are", () => {
		const seen = []
		cases.forEach(([f,a,b]) => {
			if(!b)return
			seen.push(gapBelow(compose(TREE,f,opt),a,b))
		})
		seen.forEach(px => expect(px).toBeCloseTo(opt.l1Px, 1))
	})

	test("and it does not grow when the subject is small", () => {
		// Home is a fraction of the portfolio, and framing it fills the card - so its own separations
		// are the ones most at risk of being magnified by the fit.
		const big = compose(TREE,["spd"],opt), deep = compose(TREE,["spd","rec","home"],opt)
		expect(gapBelow(deep,"rent","utils")).toBeCloseTo(gapBelow(big,"rec","annual"), 1)
	})

	test("the subject still fills the frame, gaps included", () => {
		const r = compose(TREE,["spd"],opt)
		const box = r.g.boxes.spd
		const strip = opt.neighbourPx*(r.cam.w/opt.cssW)
		expect(box.y1-box.y0).toBeCloseTo(r.cam.h-2*strip, 4)
	})
})

test("no number in the scene is ever NaN", () => {
	// The separations are asked for in pixels and converted with the view's scale. One of the three
	// branches that hands one back was left converting against a constant that no longer existed, and
	// the whole income side came out NaN - invisible, and every invariant still passing, because NaN
	// compares false with everything. This is the cheapest possible guard against that class.
	FOCUSES.forEach(f => {
		const g = compose(TREE,f,opt).g
		const bad = []
		const check = (where,o,keys) => keys.forEach(q => {
			if(o[q]!==undefined && !Number.isFinite(o[q]))bad.push(where+"."+q)})
		Object.keys(g.flows).forEach(q => check("flow "+q,g.flows[q],["x0","y0","x1","y1","th"]))
		Object.keys(g.bars ).forEach(q => check("bar "+q, g.bars[q], ["x","y","h"]))
		Object.keys(g.names).forEach(q => check("name "+q,g.names[q],["x","y","h","maxW"]))
		Object.keys(g.boxes).forEach(q => check("box "+q, g.boxes[q],["x0","y0","x1","y1"]))
		check("scene",g,["frontIn","frontOut","hubX","endX","otherX","pitch"])
		expect({focus:f.join(">")||"root", bad:bad}).toEqual({focus:f.join(">")||"root", bad:[]})
	})
})

describe("the tail is gathered into Other", () => {
	const N = (id,v,kids) => ({id:id,name:id,tone:"expenses",value:v,children:kids||null})
	const opt2 = Object.assign({},opt,{otherShare:0.10, otherMin:2})
	const wrap = out => ({hubName:"Income", inTotal:100,
		in:[{id:"inc",name:"inc",tone:"income",value:100,children:null}], out:out})
	const byId = (list,id) => (list||[]).filter(n => n.id===id)[0]
	const sum = a => a.reduce((x,y) => x+y.value,0)

	test("the smallest streams adding to a tenth or less are gathered; the rest are not", () => {
		const t = groupTail(wrap([N("big",70),N("mid",22),N("a",4),N("b",3),N("c",1)]),opt2)
		expect(t.out.map(n => n.id)).toEqual(["big","mid","other:__out"])
		const o = byId(t.out,"other:__out")
		expect(o.children.map(n => n.id).sort()).toEqual(["a","b","c"])
		expect(o.value).toBeCloseTo(8,6)          // 8 of 100, under the tenth
	})

	test("it stops at the tenth rather than swallowing the next one up", () => {
		const t = groupTail(wrap([N("big",70),N("mid",20),N("a",6),N("b",4)]),opt2)
		// a+b is 10, exactly the cap; adding mid would be 30
		expect(byId(t.out,"other:__out").children.map(n => n.id).sort()).toEqual(["a","b"])
	})

	test("one small stream is not a tail - it would trade its own name for a worse one", () => {
		const t = groupTail(wrap([N("big",95),N("small",5)]),opt2)
		expect(t.out.map(n => n.id)).toEqual(["big","small"])
	})

	test("a set that is entirely tail is not a tail", () => {
		const t = groupTail(wrap([N("a",1),N("b",1)]),opt2)
		expect(t.out.map(n => n.id)).toEqual(["a","b"])
	})

	test("§1.3 survives it: a parent is still the sum of its children", () => {
		const t = groupTail(wrap([
			N("big",60,[N("b1",50),N("b2",4),N("b3",3),N("b4",3)]),
			N("mid",30),N("a",5),N("b",3),N("c",2)]),opt2)
		const check = n => {
			if(!n.children)return
			expect(n.value).toBeCloseTo(sum(n.children),6)
			n.children.forEach(check)
		}
		t.out.forEach(check)
		expect(sum(t.out)).toBeCloseTo(100,6)
	})

	test("it reaches every level", () => {
		const t = groupTail(wrap([N("big",100,[N("b1",88),N("b2",5),N("b3",4),N("b4",3)])]),opt2)
		const inner = byId(byId(t.out,"big").children,"other:big")
		expect(inner).toBeDefined()
		expect(inner.children.map(n => n.id).sort()).toEqual(["b3","b4"])
	})

	test("an Other is never gathered inside another Other", () => {
		const many = [N("big",90)]
		for(let i=0;i<12;i++)many.push(N("t"+i,10/12))
		const t = groupTail(wrap(many),opt2)
		const o = byId(t.out,"other:__out")
		expect(o.children.length).toBe(12)
		expect(o.children.filter(n => /^other:/.test(n.id))).toEqual([])
	})

	test("its id names its parent, so it is the same stream between two bases", () => {
		const a = groupTail(wrap([N("big",70),N("mid",22),N("x",5),N("y",3)]),opt2)
		const b = groupTail(wrap([N("big",60),N("mid",32),N("x",4),N("y",4)]),opt2)
		expect(byId(a.out,"other:__out").id).toBe(byId(b.out,"other:__out").id)
	})

	test("it is a stream like any other: you can open it", () => {
		const t = groupTail(wrap([N("big",70),N("mid",22),N("a",5),N("b",3)]),opt2)
		const g = compose(t,["other:__out"],opt2).g
		expect(g.nodeAt(["other:__out"])).toBeTruthy()
		expect(g.names["a"]).toBeDefined()
		expect(g.names["b"]).toBeDefined()
	})
})
