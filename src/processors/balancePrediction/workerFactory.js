/* ==================================================================================================
   THE ONE LINE THAT NEEDS A REAL ES MODULE, SPLIT OUT ON ITS OWN.

   `import.meta.url` IS HOW WEBPACK 5 FINDS scheduleWorker.js TO BUNDLE IT AS A WORKER CHUNK, and it
   is also a SYNTAX ERROR the moment Jest's babel config (CommonJS modules, for `require()`) tries to
   parse this file - not a runtime failure a `typeof Worker` guard could catch, a parse-time one.

   SO THIS FILE IS NEVER STATICALLY IMPORTED. `schedulePool.js` reaches it only through a dynamic
   `import()`, guarded behind `typeof Worker !== 'undefined'` - a check that is false under Jest's
   jsdom, so the dynamic import line never executes there and Jest never has to parse this file at
   all. Under the real webpack build, the same dynamic import is a normal code-split chunk and
   `import.meta.url` is native syntax webpack has always understood. */
export function makeScheduleWorker(){
	return new Worker(new URL('./scheduleWorker.js', import.meta.url));
}

export default makeScheduleWorker;
