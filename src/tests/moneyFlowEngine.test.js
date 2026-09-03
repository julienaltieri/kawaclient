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

	test("an opened Other fills the frame like any other subject", () => {
		// It did not when its MEMBERS had children of their own: the box came out four and a half
		// times the frame, so the whole subtree drew at the scale of the picture it was gathered from.
		const kid = (id,v) => ({id:id,name:id,tone:"expenses",value:v,children:null})
		const t = groupTail({hubName:"Income", inTotal:10000,
			in:[{id:"inc",name:"inc",tone:"income",value:10000,children:null}],
			out:[{id:"p",name:"P",tone:"expenses",value:10000,children:[
				{id:"a",name:"A",tone:"expenses",value:9000,children:null},
				{id:"b",name:"B",tone:"expenses",value:600,children:[kid("b1",400),kid("b2",200)]},
				{id:"c",name:"C",tone:"expenses",value:400,children:[kid("c1",250),kid("c2",150)]}]}]},
			Object.assign({},opt,{otherMin:2, ratio:2.25, neighbourPx:22,
				l1Px:3.5, smallPx:10, bodyPx:12}))
		expect(t.out[0].children.map(n => n.id)).toEqual(["a","other:p"])
		const r = compose(t,["p","other:p"],opt)
		const box = r.g.boxes["other:p"]
		const strip = opt.neighbourPx*(r.cam.w/opt.cssW)
		expect(box.y1-box.y0).toBeCloseTo(r.cam.h-2*strip, 4)
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

describe("the type is decided from the level, not the column", () => {
	// typeOf reads two things off each name: how far below the focus it sits, and whether the stream
	// ends there. Both come from the layout, so they are assertable without a screen.
	const names = f => compose(TREE,f,opt).g.names
	const of = (f,id) => names(f)[id]

	test("a name knows how far below the focus it is", () => {
		expect(of(["spd"],"spd").rel).toBe(0)
		expect(of(["spd"],"rec").rel).toBe(1)
		expect(of(["spd"],"home").rel).toBe(2)
	})

	test("the same stream reports a different level from a different focus", () => {
		// which is the whole point: the column cannot tell these two apart.
		expect(of(["spd"],"rec").rel).toBe(1)
		expect(of(["spd","rec"],"rec").rel).toBe(0)
	})

	test("at the root the categories are one below the hub, and their streams two", () => {
		expect(of([],"spd").rel).toBe(1)
		expect(of([],"rec").rel).toBe(2)
	})

	test("a name says whether its stream ends there", () => {
		expect(of(["spd"],"annual").leaf).toBe(true)
		expect(of(["spd"],"rec").leaf).toBe(false)
	})
})

describe("a stream from outside the portfolio", () => {
	test("trails off rather than stopping dead", () => {
		// From reserves has no children, so among neighbours that do it was the one band cut hard at
		// the front - a notch in the edge of the picture. What is behind it is real, just not modelled.
		const t = {hubName:"Income", inTotal:120,
			in:[{id:"inc",name:"inc",tone:"income",value:100,children:[
					{id:"w",name:"w",tone:"income",value:100,children:null}]},
				{id:"__reserves",name:"From reserves",tone:"alert",value:20,children:null,outside:true}],
			out:[{id:"p",name:"P",tone:"expenses",value:120,children:[
				{id:"a",name:"a",tone:"expenses",value:120,children:null}]}]}
		const bars = compose(t,[],opt).g.bars
		const of = id => Object.keys(bars).map(q => bars[q])
			.filter(b => b.id===id&&b.vis>0.5)[0]
		expect(of("__reserves")).toBeDefined()
		expect(of("__reserves").more).toBe(1)
		// and without the mark it would be cut hard, which is what left the notch
		const plain = JSON.parse(JSON.stringify(t)); delete plain.in[1].outside
		const bars2 = compose(plain,[],opt).g.bars
		expect(Object.keys(bars2).map(q => bars2[q])
			.filter(b => b.id==="__reserves"&&b.vis>0.5)[0].more).toBe(0)
	})
})

describe("a change of basis that reshapes the tree", () => {
	// The value tween animates the UNION of the two trees, paired by id, and that is only a tree while
	// every stream sits under the same parent on both sides. The gathering is decided from the values,
	// so a different window can gather differently - and then a stream is a child of its category on
	// one side and a member of that category's Other on the other. The union holds it in both places
	// and counts it twice; the picture that comes out is not a Sankey of anything.
	const mk = vals => ({hubName:"Income", inTotal:vals.reduce((a,b)=>a+b,0),
		in:[{id:"inc",name:"inc",tone:"income",value:vals.reduce((a,b)=>a+b,0),children:null}],
		out:[{id:"p",name:"P",tone:"expenses",value:vals.reduce((a,b)=>a+b,0),
			children:vals.map((v,i) => ({id:"s"+i,name:"s"+i,tone:"expenses",value:v,children:null}))}]})
	const places = t => {const m={}
		const walk = (l,p) => (l||[]).forEach(n => {(m[n.id]=m[n.id]||[]).push(p); walk(n.children,n.id)})
		walk(t.in,"__in"); walk(t.out,"__out"); return m}

	test("animates from the old values onto the new shape, holding nothing twice", () => {
		const host = document.createElement("div"); document.body.appendChild(host)
		const eng = new MoneyFlowEngine(host,{palette:{income:"#0f0",savings:"#00f",expenses:"#f00",
			alert:"#f00",bodyText:"#fff",bodyTextSecondary:"#999"}, format:v => "$"+Math.round(v)})
		// one window with a long thin tail, another where the same streams are all of a size: the two
		// gather differently, so some stream changes parent between them
		eng.setTree(mk([1000,10,10,10,10,10,10,10,10,10]))       // heavy tail: gathers
		const before = places(eng.shown)
		eng.setTree(mk([500,500,500,500,500,500,500,500,500,500])) // all of a size: gathers otherwise
		const after = places(eng.shown)

		const moved = Object.keys(after).some(id => before[id] && before[id][0] !== after[id][0])
		expect(moved).toBe(true)                       // the fixture really does reshape
		// nothing is held in two places at once - the union of two shapes counted a stream twice, and
		// the picture that came out had ribbons crossing and parents smaller than their children
		Object.keys(after).forEach(id => expect(after[id].length).toBe(1))
		// and it MOVES rather than jumping: the first frame still carries the old values, on the new
		// shape, so the change of window is a change of size the eye can follow
		expect(eng.shown.inTotal).toBeCloseTo(1090, 0)
		expect(eng.tree.inTotal).toBeCloseTo(5000, 0)
		// every parent is still exactly the sum of its children (§1.3), on that first frame too
		const check = l => (l||[]).forEach(n => {
			if(n.children&&n.children.length)
				expect(n.children.reduce((a,b) => a+b.value,0)).toBeCloseTo(n.value,6)
			check(n.children)})
		check(eng.shown.out); check(eng.shown.in)
		host.remove()
	})

	test("a stream the new window does not hold shrinks away, in the place it held", () => {
		// Rebuilt on the destination's shape, a stream the destination does not have was simply dropped:
		// it never reached the union, so it could not travel to zero and blinked out on the first frame
		// instead. From reserves is the one that shows it - an extra band on the in side is itself what
		// makes the gathering differ, so this is the very transition that takes the rebuilt path.
		const mkR = (vals,res) => {const tot = vals.reduce((a,b)=>a+b,0)
			return {hubName:"Income", inTotal:tot,
				in:[{id:"inc",name:"inc",tone:"income",value:tot-res,children:null}].concat(res
					? [{id:"__reserves",name:"From reserves",tone:"alert",value:res,children:null,outside:true}]
					: []),
				out:[{id:"p",name:"P",tone:"expenses",value:tot,
					children:vals.map((v,i) => ({id:"s"+i,name:"s"+i,tone:"expenses",value:v,children:null}))}]}}
		const host = document.createElement("div"); document.body.appendChild(host)
		const eng = new MoneyFlowEngine(host,{palette:{income:"#0f0",savings:"#00f",expenses:"#f00",
			alert:"#f00",bodyText:"#fff",bodyTextSecondary:"#999"}, format:v => "$"+Math.round(v)})
		eng.setTree(mkR([1000,10,10,10,10,10,10,10,10,10],300))    // heavy tail, and money from reserves
		const was = eng.shown.in.map(n => n.id)
		expect(was).toContain("__reserves")
		eng.setTree(mkR([500,500,500,500,500,500,500,500,500,500],0))   // gathers otherwise, and balances

		const now = eng.shown.in.map(n => n.id)
		expect(now).toContain("__reserves")                        // still here on the first frame
		expect(eng.shown.in.filter(n => n.id==="__reserves")[0].value).toBeCloseTo(300,0)  // at its old size
		expect(now).toEqual(was)                                   // and in its old slot, not appended below
		expect(eng.tree.in.some(n => n.id==="__reserves")).toBe(false)  // gone by the end, as it should be
		host.remove()
	})
})

describe("what is left over sits at the top of the savings", () => {
	// It IS savings, just without a stream yet, so it is a child of savings rather than a leaf
	// standing among categories - which is also what makes it an ordinary terminal stream, with the
	// tier place and the amount that come with being one. Its order is the mirror of the Other rule:
	// a remainder goes last, but what the month did not spend is the first thing true about the
	// savings, not an appendix to it. Sorted by size it wandered between windows, and a band that
	// moves for no visible reason has to be found again every time.
	test("first among its siblings, named, and read as the end of a branch", () => {
		const t = {hubName:"Income", inTotal:100,
			in:[{id:"inc",name:"inc",tone:"income",value:100,children:null}],
			out:[{id:"spend",name:"Spending",tone:"expenses",value:60,children:[
				{id:"rent",name:"Rent",tone:"expenses",value:60,children:null}]},
				{id:"sav",name:"Savings",tone:"savings",value:40,children:[
					{id:"buf",name:"Buffer",tone:"savings",value:35,children:null},
					{id:"__unallocated",name:"Unallocated",tone:"savings",value:5,children:null}]}]}
		// the shared `opt` above omits otherMin, and the gathering reads its floor from it
		const uopt = Object.assign({},opt,{otherMin:2, ratio:2.25, smallPx:10, bodyPx:12})
		const grouped = groupTail(t,uopt)
		const sav = grouped.out.filter(n => n.id==="sav")[0]
		expect(sav.children.map(n => n.id)).toEqual(["__unallocated","buf"])  // smallest, and first
		expect(grouped.out.map(n => n.id)).toEqual(["sav","spend"])           // savings above expenses
		// and it is NAMED: it carried label:false at first, so the band was there with nothing on it
		expect(Object.keys(sav.children[0]).indexOf("label")).toBeLessThan(0)
		const g = compose(grouped,[],uopt).g
		const named = Object.keys(g.names).map(k => g.names[k])
		expect(named.map(n => n.name)).toContain("Unallocated")
		// and it reads like every other end of a branch: in the tier, with its amount beside it
		const ua = named.filter(n => n.name==="Unallocated")[0]
		const peer = named.filter(n => n.name==="Buffer")[0]
		expect(ua.rail).toBe(peer.rail)
		expect(ua.vx).toBe(peer.vx)
		expect(ua.leaf).toBe(true)
	})
})

describe("a tap that cannot go deeper", () => {
	// A stream with nothing inside it used to carry no handler at all, so the last level of every
	// branch was a place where tapping did nothing - which reads as a broken control. The spring is
	// the answer; what it must never do is look like a move, so it holds the frame still in every
	// respect but scale. (The behaviour end to end is measured on the bench: jsdom has no layout.)
	test("the nudge holds the frame's centre and proportion, and rests as itself", () => {
		const host = document.createElement("div"); document.body.appendChild(host)
		const eng = new MoneyFlowEngine(host,{palette:{income:"#0f0",savings:"#00f",expenses:"#f00",
			alert:"#f00",bodyText:"#fff",bodyTextSecondary:"#999"}, format:v => "$"+Math.round(v)})
		const cam = {x:10,y:20,w:400,h:200}
		expect(eng.nudged(cam)).toBe(cam)               // nothing in flight: the very same camera
		eng.nudgeT0 = performance.now()-60              // part way into the spring
		const n = eng.nudged(cam)
		expect(n.w).toBeLessThan(cam.w)                 // in, on the way in - a dead end never zooms out
		expect(n.x+n.w/2).toBeCloseTo(cam.x+cam.w/2,6)  // about the centre, so nothing appears to pan
		expect(n.y+n.h/2).toBeCloseTo(cam.y+cam.h/2,6)
		expect(n.w/n.h).toBeCloseTo(cam.w/cam.h,6)      // and the card's proportion is a constant (9.3)
		eng.nudgeT0 = 0
		expect(eng.nudged(cam)).toBe(cam)               // and it gives the camera back untouched
		host.remove()
	})
})

describe("the tail is gathered into Other", () => {
	// The tail is decided by the DISPLAY: how many of a set of siblings can carry a name at once when
	// that set is exploded. §5.3 makes the room a constant — whichever stream you open, its children
	// fill the frame less one strip at each end — so this is still answerable from the values alone.
	const gopt = Object.assign({},opt,{otherMin:2, ratio:2.25, neighbourPx:22,
		l1Px:3.5, smallPx:10, bodyPx:12})
	const N = (id,v,kids) => ({id:id,name:id,tone:"expenses",value:v,children:kids||null})
	const S = (id,v) => ({id:id,name:id,tone:"savings",value:v,children:null})
	const wrap = out => ({hubName:"Income", inTotal:100,
		in:[{id:"inc",name:"inc",tone:"income",value:100,children:null}],
		out:[{id:"p",name:"P",tone:"expenses",value:out.reduce((a,b)=>a+b.value,0),children:out}]})
	const kidsOf = t => t.out[0].children
	const byId = (list,id) => (list||[]).filter(n => n.id===id)[0]
	const sum = a => a.reduce((x,y) => x+y.value,0)

	test("a set whose bands all clear a line of type is left alone", () => {
		const t = groupTail(wrap([N("a",40),N("b",30),N("c",30)]),gopt)
		expect(kidsOf(t).map(n => n.id)).toEqual(["a","b","c"])
	})

	test("a set too crowded to name is gathered", () => {
		const t = groupTail(wrap([N("a",10),N("b",10),N("c",10),N("d",10),N("e",10),N("f",10),N("g",10),N("h",10),N("i",10),N("j",10)]),gopt)
		const ids = kidsOf(t).map(n => n.id)
		expect(ids).toContain("other:p")
		expect(ids.length).toBeLessThan(10)
	})

	test("and not before it must be: the boundary is one stream wide", () => {
		// the rule gathers nothing until the set genuinely cannot be named, so the boundary is sharp.
		// On this fixture's card eight equal streams each clear a line of type and nine do not. The
		// boundary moves with what a line of type actually measures (7.13), which is the point: it is
		// a statement about the type, not a constant.
		const eq = n => Array.from({length:n},(_,i) => N("s"+i,10))
		expect(kidsOf(groupTail(wrap(eq(8)),gopt)).map(n => n.id)).not.toContain("other:p")
		expect(kidsOf(groupTail(wrap(eq(9)),gopt)).map(n => n.id)).toContain("other:p")
	})

	test("a uniform set has no tail to speak of, and the rule says so", () => {
		// Worth pinning because it is this rule's weak case: gathering a TAIL only helps when there
		// is one. With every stream the same size, removing the smallest few leaves the rest exactly
		// as crowded, so it gathers until a single stream stands beside the Other. Real portfolios
		// are heavy-tailed and this does not fire; a uniform one is told, bluntly, that its streams
		// cannot all be named.
		const eq = n => Array.from({length:n},(_,i) => N("s"+i,10))
		expect(kidsOf(groupTail(wrap(eq(10)),gopt)).length).toBe(2)
	})

	test("a stream that declines a name needs no room for one", () => {
		// the leftover carries label:false, and counting it as another label to place is what made
		// the categories at the root look unnameable
		// the same three values twice, differing only in whether the middle one wants a name. Named,
		// it crowds the one below it and the set is gathered; unnamed, it merely pushes them apart.
		const vals = () => [N("a",50),N("x",7),N("b",5)]
		const named = groupTail(wrap(vals()),gopt)
		const quiet = vals(); quiet[1].label = false
		const held = groupTail(wrap(quiet),gopt)
		expect(kidsOf(named).map(n => n.id)).toContain("other:p")
		expect(kidsOf(held).map(n => n.id)).not.toContain("other:p")
	})

	test("the macro categories are never gathered, whatever the arithmetic says", () => {
		const t = groupTail({hubName:"Income", inTotal:100,
			in:[{id:"inc",name:"inc",tone:"income",value:100,children:null}],
			out:[N("big",90),S("s1",4),N("s2",3),N("s3",3)]},gopt)
		expect(t.out.map(n => n.id).filter(id => String(id).indexOf("other:")===0)).toEqual([])
	})

	test("one small stream is not a tail - it would trade its own name for a worse one", () => {
		const t = groupTail(wrap([N("a",60),N("b",39),N("c",1)]),gopt)
		const ids = kidsOf(t).map(n => n.id)
		expect(ids.indexOf("other:p")<0 || byId(kidsOf(t),"other:p").children.length>=2).toBe(true)
	})

	test("something is always left outside it", () => {
		const t = groupTail(wrap([N("a",1),N("b",1),N("c",1),N("d",1)]),gopt)
		expect(kidsOf(t).length).toBeGreaterThan(1)
	})

	test("§1.3 survives it: a parent is still the sum of its children", () => {
		const t = groupTail(wrap([N("a",10),N("b",10),N("c",10),N("d",10),N("e",10),N("f",10),N("g",10),N("h",10),N("i",10),N("j",10)]),gopt)
		expect(sum(kidsOf(t))).toBeCloseTo(100,6)
		const o = byId(kidsOf(t),"other:p")
		if(o)expect(sum(o.children)).toBeCloseTo(o.value,6)
	})

	test("it reaches every level", () => {
		const deep = N("q",100,[N("q1",10),N("q2",10),N("q3",10),N("q4",10),N("q5",10),
			N("q6",10),N("q7",10),N("q8",10),N("q9",10),N("q10",10)])
		const t = groupTail(wrap([deep,N("r",40)]),gopt)
		const q = byId(kidsOf(t),"q")
		expect(q.children.map(n => n.id)).toContain("other:q")
	})

	test("an Other gathers its own members in turn, so no band is left unnamed", () => {
		// Opening an Other is a view like any other and gets the same rule. It used to be exempt, on
		// the grounds that "Other inside Other" says nothing - which meant the one view guaranteed to
		// hold the thinnest streams in the tree was the one view where nothing was gathered, and it
		// showed bands with no name at all.
		const many = Array.from({length:20},(_,i) => N("s"+i,10))
		const t = groupTail(wrap(many),gopt)
		const o = byId(kidsOf(t),"other:p")
		expect(o).toBeDefined()
		expect(o.children.map(n => n.id).filter(id => String(id).indexOf("other:")===0).length)
			.toBeGreaterThan(0)
	})

	test("every set is either nameable or has an Other in it, all the way down", () => {
		const many = Array.from({length:20},(_,i) => N("s"+i,10))
		const t = groupTail(wrap(many),gopt)
		const walk = list => {
			if(!list||list.length<2)return true
			const o = list.filter(n => String(n.id).indexOf("other:")===0)
			// a set that was gathered keeps exactly one Other; either way, recurse into the members
			expect(o.length).toBeLessThanOrEqual(1)
			return list.every(n => walk(n.children))
		}
		expect(walk(kidsOf(t))).toBe(true)
	})

	test("an Other sits at the bottom of its set, whatever it comes to", () => {
		// it is the remainder, not a stream competing for position
		const t = groupTail(wrap([N("a",30),N("b",9),N("c",9),N("d",9),N("e",9),N("f",9),
			N("g",9),N("h",9),N("i",9)]),gopt)
		const ids = kidsOf(t).map(n => n.id)
		const o = ids.filter(id => String(id).indexOf("other:")===0)[0]
		expect(o).toBeDefined()
		expect(ids[ids.length-1]).toBe(o)
		expect(byId(kidsOf(t),o).value).toBeGreaterThan(kidsOf(t)[0].value)
	})

	test("its id names its parent, so it is the same stream between two bases", () => {
		const a = groupTail(wrap([N("a",10),N("b",10),N("c",10),N("d",10),N("e",10),N("f",10),N("g",10),N("h",10),N("i",10),N("j",10)]),gopt)
		const b = groupTail(wrap([N("a",11),N("b",11),N("c",11),N("d",11),N("e",11),N("f",11),N("g",11),N("h",11),N("i",11),N("j",11)]),gopt)
		expect(byId(kidsOf(a),"other:p").id).toBe(byId(kidsOf(b),"other:p").id)
	})

	test("it is a stream like any other: you can open it", () => {
		const t = groupTail(wrap([N("a",10),N("b",10),N("c",10),N("d",10),N("e",10),N("f",10),N("g",10),N("h",10),N("i",10),N("j",10)]),gopt)
		const g = compose(t,["p","other:p"],opt).g
		expect(g.boxes["other:p"]).toBeDefined()
	})
})
