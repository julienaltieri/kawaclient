/**
 * moneyFlowEngine.test.js — properties of the layout that do not need a screen.
 *
 * The engine has no imports, so its pure half (layout/frame) can be asserted directly. These are the
 * invariants that decide whether the picture is readable, as opposed to whether it is correct.
 */
import {layout, frame, siblingIds} from '../components/MoneyFlowEngine'

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
