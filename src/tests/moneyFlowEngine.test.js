/**
 * moneyFlowEngine.test.js — properties of the layout that do not need a screen.
 *
 * The engine has no imports, so its pure half (layout/frame) can be asserted directly. These are the
 * invariants that decide whether the picture is readable, as opposed to whether it is correct.
 */
import MoneyFlowEngine, {layout, frame, siblingIds} from '../components/MoneyFlowEngine'

const opt = {l1:7, l2:2, gapShare:0.35, railFrac:0.28, padPx:4, reachFrac:0.15,
	softFrac:0.4, leftShare:0.7, cssW:360, worldH:444, tail:"push",
	format:v => "$"+Math.round(v)}

// Ragged on purpose: Annual bottoms out a level before its cousins, which is the shape that puts a
// leaf's own column and the end of the view in different places.
const TREE = {
	hubName:"Income",
	in:[{id:"salary",name:"Salary",tone:"income",value:6000,children:[
			{id:"base",name:"Base pay",tone:"income",value:5200,children:null},
			{id:"bonus",name:"Bonus",tone:"income",value:800,children:null}]}],
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
			const g = layout(TREE,f,opt)
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
		const g = layout(TREE,f,opt)
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
