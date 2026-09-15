/* ==================================================================================================
   THE ROUND TRIP, AS A TEST.

   A thousand streams are written down as truth, grown into a ledger, and handed to the real predictor
   through its front door. Every answer is scored against the parameters that produced it. The floors
   below are where the detector stands today, not where it should end up; they exist so that a change
   which quietly loses five points on shape fails here instead of being noticed in a bench three weeks
   later. Raise them when the number goes up.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {runDnaBench} from './dnaBench';
import {StreamPredictor} from './index';
import {dnaSamples} from './dnaSamples';
import {buildDnaAuditPage} from './buildDnaAuditPage';
import {CYCLE_DAYS} from './syntheticDna';

const OUT_DNA = path.join(__dirname, 'audit-dna.html');

const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

describe('the synthetic round trip', () => {
	test('the detector recovers the DNA it was grown from', () => {
		const r = runDnaBench({count: 1000, cycles: 12, seed: 20260913});
		const t = r.tally;

		//which streams never got a rhythm right - every question after this one is asked inside it
		const lost = new Set(r.misses.filter(m => m.what === 'cycle').map(m => m.stream));
		const cycle = pct(t.cycle.right, t.cycle.right + t.cycle.wrong);
		const shape = pct(t.shape.right, t.shape.right + t.shape.wrong);
		const day = pct(t.day.right, t.day.right + t.day.wrong);
		const rail = pct(t.rail.right, t.rail.right + t.rail.wrong);

		const offs = t.day.offs.slice().sort((a, b) => a - b);
		const exact = pct(offs.filter(x => x === 0).length, offs.length);

		const kinds = Object.keys(t.shape.by).sort().map(k =>
			k + ' ' + pct(t.shape.by[k].right, t.shape.by[k].n) + '%(' + t.shape.by[k].n + ')');

		//the cascade: what shape agreement looks like once the rhythm is right
		let inRhythm = {right: 0, n: 0};
		r.truths.forEach(truth => {
			if(lost.has(truth.id))return;
			truth.modes.forEach(() => {});
		});
		r.misses.filter(m => m.what === 'shape' && !lost.has(m.stream))
			.forEach(() => inRhythm.n++);

		console.log('DNA streams=' + t.streams + ' modes=' + t.modes);
		console.log('DNA cycle=' + cycle + '%  shape=' + shape + '%  day=' + day + '%  rail=' + rail + '%');
		console.log('DNA day offset exact=' + exact + '% median=' + offs[Math.floor(offs.length / 2)]
			+ ' mean=' + (offs.reduce((a, b) => a + b, 0) / offs.length).toFixed(2));
		console.log('DNA shape by kind: ' + kinds.join('  '));

		const why = {};
		r.misses.filter(m => m.what === 'cycle').forEach(m => {
			const k = m.want + '->' + m.got;
			why[k] = (why[k] || 0) + 1;
		});
		console.log('DNA cycle misses: ' + JSON.stringify(why));

		expect(cycle).toBeGreaterThanOrEqual(84);
		expect(shape).toBeGreaterThanOrEqual(78);
		expect(rail).toBeGreaterThanOrEqual(60);
	}, 600000);

	/* THE PAGE IS THE OTHER HALF OF THE MEASUREMENT. A percentage says how often the detector agrees
	   and never says what a disagreement looks like, so the same run is written out one stream at a
	   time with its DNA beside its reading. Fewer streams than the scorecard: the page is for
	   reading, and every sample carries its lanes. */
	test('writes the synthetic bench page', () => {
		const seed = 20260913, months = 12;
		const r = runDnaBench({count: 220, months: months, seed: seed});
		const predictor = new StreamPredictor(r.portfolio);
		const samples = dnaSamples(r, predictor, c => CYCLE_DAYS[c]);
		expect(samples.length).toBeGreaterThan(200);

		const html = buildDnaAuditPage(samples, {seed: seed, months: months});
		fs.writeFileSync(OUT_DNA, html, 'utf8');

		//the page is an artifact fragment, so it must not carry its own document skeleton
		expect(/<!doctype|<html|<body/i.test(html)).toBe(false);

		//THE EMITTED SCRIPT RULE, same as every other bench page
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
			expect(() => new Function(src)).not.toThrow();
		});

		//and every filter the page offers has something behind it, or the button is a dead end
		const miss = samples.filter(s => !s.cycleOk).length;
		const clean = samples.filter(s => s.cycleOk
			&& !s.modes.some(m => m.shapeOk === false)
			&& !s.modes.some(m => m.dayOk === false)).length;
		expect(miss).toBeGreaterThan(0);
		expect(clean).toBeGreaterThan(0);
		console.log('DNA page ' + samples.length + ' samples, ' + miss + ' rhythm misses, '
			+ clean + ' fully clean, ' + Math.round(html.length / 1024) + ' KB');
	}, 600000);

	/* THE SNAPSHOT IS THE ONE THING ON THIS PAGE THAT LEAVES IT, so it is checked by running the
	   page's own script in jsdom rather than by reading the source and hoping. A snapshot that
	   renders "[object Object]" or loses the ledger is useless in exactly the moment it is wanted. */
	test('the page renders a snapshot that carries the whole stream', () => {
		const seed = 20260913, months = 12;
		const r = runDnaBench({count: 40, months: months, seed: seed});
		const predictor = new StreamPredictor(r.portfolio);
		const samples = dnaSamples(r, predictor, c => CYCLE_DAYS[c]);
		const html = buildDnaAuditPage(samples, {seed: seed, months: months});

		document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/g, '');
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g);
		scripts.forEach(b => {
			// eslint-disable-next-line no-new-func
			new Function(b.replace(/^<script>/, '').replace(/<\/script>$/, ''))();
		});

		const text = document.getElementById('snaptext').textContent;
		expect(text).toContain('seed ' + seed);
		//the four lines a follow-up question is asked from, and nothing else
		expect(text).toContain('  truth  ');
		expect(text).toContain('  read   ');
		expect(text).toContain('  next   ');
		expect(text).toContain('  seen   ');
		//no markup survived the strip, and nothing stringified to an object
		expect(text).not.toContain('<span');
		expect(text).not.toContain('&middot;');
		expect(text).not.toContain('[object');
		expect(text).not.toContain('undefined');
		console.log('DNA snapshot ' + text.split(String.fromCharCode(10)).length
			+ ' lines, ' + text.length + ' chars');
		console.log(text.split(String.fromCharCode(10)).slice(0, 16).join(String.fromCharCode(10)));
	}, 600000);
});