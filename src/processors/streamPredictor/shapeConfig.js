/* ==================================================================================================
   THE THREE NUMBERS §3 IS TUNED ON.

   THEY LIVE HERE FOR THE SAME REASON §2's LIVE IN fitConfig.js: each is a judgement that was made by
   looking at what it does to the real portfolio, and a number chosen that way has to keep its
   working next to it. Written into the middle of the classifier it becomes folklore, and the next
   person to ask whether it is still right has to redo the measurement to find out.
   ================================================================================================== */

export const SHAPE_CONFIG = {

	/* HOW SHARP THE FOCUS HAS TO BE before the movements count as landing on a day rather than
	   anywhere in the cycle. Concentration runs 0 to 1: 1 is every movement on the same day, 0 is
	   evenly smeared round the whole cycle.

	   MEASURED OVER THE CAPTURED PORTFOLIO. The streams a person would call lumps sit at the top and
	   the gap below them is wide:

	       Internet          6x4 7x3 8x2                      0.99
	       Car insurance     1x7 2x1 4x1                      0.98
	       Rent              8x1 10x1 11x5 12x2               0.97
	       Utilities         9x1 10x1 11x3 12x2 13x1 14x1     0.96
	       Day care Emile    12x1 14x1 15x2 16x1 17x2 18x1    0.90
	       Wages Julien      4x1 6x6 7x2 8x8 10x1 12x2        0.76
	       ------------------------------------------------------- the bar
	       Day Care Eleonore 13x1 21x1                        0.69
	       Earnin phone      15x1 16x1 17x1 18x1 19x1 23x1... 0.58
	       Plaid             13x1 14x1 16x1 ... 21x1 25x1     0.57
	       Business Expenses 6x3 8x1 15x1 16x1 17x2 29x3      0.15
	       Groceries         0x16 1x18 2x26 3x21 4x23 5x32    0.11

	   Earnin phone arrives exactly once a month and the old rule called it a perfect lump for that
	   reason; it lands anywhere in a two-week window, which is not a day and should not be predicted
	   as one. */
	minConcentration: 0.75,

	/* ---- WHICH READING OF A MODE WINS, AND WHY THERE IS NO KNOB FOR IT ----------------------------
	   A MODE'S MOVEMENTS CAN BE READ THREE WAYS, and the readings are theories rather than settings.
	   All three are tried and scored the same way, so which is right is measured, not gated:

	       everything, as the ledger recorded it        the theory with nothing to prove
	       everything, closures pulled back             only on a real-time account
	       everything, closures pushed on               only on a real-time account

	   THE TIGHTEST FIT SIMPLY WINS. The plain reading is one theory among the three and competes on
	   the same terms; a bar on top of that would be a second opinion about a comparison already
	   made, and every value tried for one either let a marginal reading through or shut out the case
	   the idea came from.

	   THERE WERE ONCE TWO MORE, AND A SHARE THRESHOLD TO POLICE THEM. Back when this stage answered
	   one shape per STREAM, a theory could propose "read only the Conservice half and set the rest
	   aside" - and a reading of four of Groceries' 167 movements lands them beautifully while being
	   a theory about four transactions. `minTheoryShare` existed to refuse those. The stage now
	   splits by payee BEFORE any theory is built, so every theory covers every leg it was handed,
	   every share is 1, and the threshold could only ever pass. It and the payer theories are gone
	   together; what replaced them is the split that made them unnecessary. */

	/* ---- COLLAPSING MODES BACK TOGETHER ------------------------------------------------------------
	   AN ISOLATED PAYEE IS OFTEN THE SAME HABIT UNDER ANOTHER NAME, or the same bill paid another way
	   for one month. Day care Emile is eight cheques and one Zelle transfer - and August has no
	   cheque, because the Zelle IS August's payment. Split apart, the cheques skip a month and the
	   transfer is a mode of one movement; put back, every month has exactly one payment.

	   A STRAY IS ABSORBED WHEN THE MERGED MODE FITS AT LEAST AS WELL AS THE HOST DID ALONE. There is
	   no bar to clear, and that is deliberate: a fixed threshold asks "is the result any good", when
	   the question is "did adding this make it better or worse". Day care's merge reads 0.717 -> 0.756
	   and is absorbed; a stray that lands nowhere near the rhythm widens it and is refused by the same
	   comparison, whatever the numbers happen to be.

	   The earlier form was a bar at 0.80, and it got Day care WRONG - it refused the one payment that
	   completed the year - while passing a merge that degraded a host from 0.95 to 0.88 because both
	   sides of that cleared the bar. */

	/* ---- A PATTERN MAY HAVE ITS OWN EXCEPTIONS -----------------------------------------------------
	   A MODE IS OTHERWISE ALL-OR-NOTHING: either every movement belongs to the pattern or there is no
	   pattern. Real habits are not like that. Julien's savings transfer has a calendar reminder on the
	   15th and that is the whole of the rhythm - but he is sometimes late, the bank's ACH timing moves
	   it, and occasionally he transfers OUT to fund something large. Four transfers on the 14th/15th
	   and two one-off movements is a lump with two exceptions, not a two-lump rhythm, and the second
	   reading is what the model was forced into.

	   SO THE FURTHEST MOVEMENT FROM THE CLAIMED DAY IS DROPPED WHILE DOING SO IMPROVES THE FIT, and
	   what is dropped is the mode's own noise - counted, reported, and part of the stream's baseline
	   rather than thrown away.

	   AT MOST THIS SHARE, because past some point dropping movements is not finding the pattern in a
	   habit, it is inventing one by deleting the evidence. Two of six is a late month; twenty of sixty
	   is a different stream.

	   THE RESULT STILL HAS TO BE A LUMP. Trimming a spread always "improves" a score that rewards
	   landing on a day, and a flow has no day - Grocery Outlet gives up 18 of its 60 shops before the
	   arithmetic stops saying that helps, and it is a spread the entire time. The trim is kept only
	   where it produces a pattern, and a spread is left exactly as it is. */
	maxExceptionShare: 0.34,

	/* ---- A MERGE MAY NOT WANDER OFF ITS ACCOUNT -----------------------------------------------------
	   A PATTERN HAS TO CONCLUDE SOMEWHERE, and where it concludes is an account - a card is settled
	   once a month and a current account moves the day the money does, so the same rhythm read across
	   the two is two different forecasts. A merge is therefore allowed to cross accounts only when the
	   result is plainly ONE account's habit with a few movements that happened elsewhere, and the
	   merged mode is then reported on that account.

	   MEASURED AS A SHARE OF TRANSACTIONS, not of money: one large payment made from the wrong account
	   does not relocate a habit, and a majority of small ones does. Below this share the two are two
	   rhythms and are left apart. */
	minDominantAccountShare: 0.75,

	/* ---- MONEY OUT CANNOT COMPLETE MONEY IN --------------------------------------------------------
	   THE SAVINGS TRANSFER IS THE CASE. Julien moves money to savings on the 15th and occasionally
	   pulls some back to fund something large. The two share an account and very nearly share a payee
	   name, and the pull-backs land on no day at all - so as far as the arithmetic is concerned they
	   are a patternless stray sitting next to a rhythm it could be offered to.

	   A REVERSAL IS NOT A LATE PAYMENT. Absorbing it would let a withdrawal fill a cycle the deposit
	   missed and count as the deposit having happened, which is the one thing it certainly was not.
	   So direction partitions a mode before anything is measured, and no merge crosses it.

	   THIS IS STRUCTURE, NOT A SETTING. `splitByDirection` was a flag here and was never read: the
	   partition happens in `streamModes`, which builds one mode per payee PER DIRECTION, and the
	   merge refuses a direction change outright. There is no code path in which turning it off would
	   have meant anything, so the flag is gone and the rule is stated where it happens. */

	/* ---- HOW SURE IS SURE ENOUGH TO CALL IT A LUMP -------------------------------------------------
	   A DAY IS A PROMISE AND THIS IS THE PRICE OF MAKING ONE. Below the bar the mode still has its
	   money and its movements; what it loses is the right to name a date, and it is forecast as a rate
	   with the rest.

	   PICKED FROM THE BENCH AT 0.60. Below it a mode is not wrong, it is only not a date: Plaid's
	   wandering 42% and Loki's 11% stop naming days they cannot hold, while every bill that actually
	   lands on a day clears it with room. */
	minLumpConfidence: 0.60,

	/* ---- RECENT CYCLES COUNT FOR MORE THAN OLD ONES ------------------------------------------------
	   A HABIT THAT CHANGED IS NOT A HABIT THAT IS UNRELIABLE. The weekly card payment to Robinhood ran
	   on day 0 from December to the 2nd of March and has run on day 4 every week since. Weighed evenly
	   that is two clusters and a 91% claim on the wrong day; weighed by recency it is one payment on
	   day 4, and the twelve old ones are history rather than evidence against it.

	   THE NEWEST CYCLES ARE NOT TAPERED AT ALL. A rhythm needs a few cycles at full weight to be a
	   rhythm - taper inside them and the single newest movement starts to outvote everything, which is
	   how a payee with four movements in a year reads as a confident monthly lump. This many cycles
	   sit at weight 1 before the decay starts.

	   THEN A HALF-LIFE, MEASURED IN CYCLES rather than days, so a weekly stream and a monthly one fade
	   at the same rate relative to their own rhythm. Zero means no taper at all. PICKED FROM THE BENCH
	   AT 3: with the shoulder in front of it that is the newest four cycles at full weight and half
	   weight seven cycles back, which is short enough to follow a habit that moved and long enough
	   that moving is what it takes.

	       weight of a cycle n back  =  1                        while n <= shoulder
	                                 =  0.5 ^ ((n - shoulder) / halfLife)   after that

	   MEASURED at a half-life of 12 cycles: the card payment reads one lump on d4 instead of two, Plaid
	   follows its drift from d13 to d20 (35% -> 58%), and Whole Foods - nothing since the 16th of May -
	   decays from 46% to 43% instead of holding its claim for the rest of the year. */
	taperShoulderCycles: 3,
	taperHalfLifeCycles: 3,

	/* ---- AS MANY CLUSTERS AS THE CYCLE HAS MOVEMENTS -----------------------------------------------
	   A SHAPE THAT NAMES MORE DAYS THAN THE FORECAST WILL USE HAS NOT DECIDED ANYTHING. The Earnin
	   reimbursement is one payment a month landing in one of two windows - d15 to d18, or d26 to d29 -
	   and reading it as three clusters scores the fit of a three-day model while the forecast goes on
	   to name one day. The number flatters a claim nobody is making.

	   SO THE CLUSTER COUNT IS PINNED TO THE CYCLE'S OWN EVENT COUNT, not searched for. A cycle that
	   typically carries one movement is measured against ONE day: it lands on it, and is a lump, or it
	   does not, and is a spread with no day at all. A cycle that carries three is measured against
	   three. Either way the confidence describes the same model the forecast uses.

	   THIS CAN ONLY TAKE LUMPS AWAY, never invent one - the free search already tried every k up to
	   maxLumps and took the first that passed, so pinning tests a subset of what passed before. */
	pinLumpsToEventsPerCycle: true,

	/* ---- HOW MUCH CLOSURE EVIDENCE BEFORE A RAIL IS A RULE -----------------------------------------
	   A RAIL IS LEARNED, NOT ASSUMED, and most modes have barely met a closed day. A monthly bill on
	   the 12th hits a weekend three or four times a year, so the question "which way does it move"
	   has three or four observations behind it and a single disagreement is a third of the evidence.

	   SO A RULE IS CLAIMED ONLY WHEN EVERY OBSERVED CLOSURE AGREED, over at least this many of them.
	   Below it the mode says nothing rather than guessing, which is the honest answer for a bill that
	   has met two Saturdays and dodged both.

	   MEASURED: at 2 the portfolio learns six rails - the payroll pays early 6 times out of 6, Comcast
	   collects late 4 out of 4, GEICO late 2 out of 2, and three card modes post on the closed day
	   itself. Four more modes have three observations each and disagree with themselves; they get no
	   rule, which is correct. */
	minClosureTests: 1,

	/* HOW MANY LUMPS TO LOOK FOR before giving up and calling it a spread. Two clusters half a cycle
	   apart are invisible to a single-cluster measurement - they cancel - so the cycle is wrapped
	   twice, then three times, then four, and the first wrapping that brings the movements into focus
	   says how many lumps there are. Beyond four the shape is a flow whatever the arithmetic says. */
	maxLumps: 4,

	/* HOW OFTEN THE PER-CYCLE COUNT HAS TO REPEAT EXACTLY. No longer decides the shape - concentration
	   does - but it is still reported as evidence, and it is what tells a stream that moves twice
	   every cycle from one that moves twice on average.

	   MEASURED OVER THE CAPTURED PORTFOLIO, and the gap it sits in is wide and empty:

	       Rent          1 1 1 1 1 1 1 1 1                     100%
	       Day care      1 1 1 1 1 1 1 1 1                     100%
	       Utilities     2 2 2 2 2 2 2 2 2                     100%
	       Phone         1 1 1 1 1 1 1 1 1                     100%
	       Wages Julien  1 1 1 3 2 1 1 1 1 1 ...                88%
	       ------------------------------------------------ the cliff
	       Groceries     4 10 1 5 5 6 8 3 6 0 7 2 3 ...        24%
	       Savings       4 6 4 2 0 2 1                          29%
	       Hobby mdm     1 0 0 2 2 1 1                          43%

	   Nothing in this portfolio lands between 43% and 88%, so the value is set in the middle of the
	   empty band rather than tight against either side of it.

	   AND NONE OF IT GATES ANYTHING ANY MORE. `minSteadyShare` and `minBusyShare` were the original
	   way of naming a shape - steady and single meant a lump, unsteady and busy meant a flow - and
	   they are what put groceries and a twice-monthly utility bill in the same bucket, because both
	   typically carry four or fewer movements. FOCUS replaced them: whether the days cluster is a
	   different question from how many there are, and it is the one that separates the two. The
	   thresholds were left declared and unread for a while after; they are gone, and the questions
	   they measured - how steady, how busy - are now asked by ARRIVAL, which has its own confidence
	   and reaches the answer. */
	/* ---- ONE MOVEMENT A CYCLE IS NOT A FLOW -------------------------------------------------------
	   A SPREAD IS WHEN SO MANY MOVEMENTS HAPPEN THAT PRECISION IS NOT WORTH TRYING FOR, and a daily
	   amount is the better approximation. One payment a cycle is the opposite: the money arrives all
	   at once, and smearing $50 across thirty days as $1.67 a day describes nothing that happens.

	   Earnin's internet reimbursement is the case - eight movements in eight cycles, every one exactly
	   $50, landing on days 19, 16, 18, 17, 27, 0, 16, 0. It WILL arrive and there is no telling when.
	   That is a lump with a variable date, not a rate.

	   MEASURED AS A MEAN, NOT A MODE. The old test read `commonest(counts)`, so a stream whose cycles
	   run 1, 1, 1, 2, 5, 8 reported "1 event per cycle" and was refused: Social moves 24 times in 8
	   cycles - three a cycle, every cycle filled - and was called out of focus because its MODAL cycle
	   carries one.

	   TWO A MONTH, NOT ONE. A month carrying a single movement is a payment however irregular its
	   date; it takes two before smearing beats dating. At 1.2 the mean was dragged over the line by a
	   minority of busy cycles - Gas is one fill-up in seven months of nine and four in one, and read
	   1.29 - and every mode that crossed it that way is a lump.

	   MEASURED: above the line sit groceries at 6.8 a month, its remainder at 6.1, Costco at 3.5,
	   Amazon at 3.2, Social at 2.9 and Loki's Grocery Outlet at 2.7. Below it sit Laundry at 1.5, Gas
	   and the Expensify reimbursement at 1.3, and every ordinary bill at 1.0. Nothing sits between
	   1.5 and 2.7, so the line has more than a point of room on either side. */
	minSpreadEventsPerCycle: 2,

	/* THE FEWEST MOVEMENTS THAT CAN BE IN FOCUS. Two points on the same day are perfectly
	   concentrated by construction and so are three - there is nothing for them to disagree with.
	   Groceries on one old card had two movements, both on day 1, and read as a lump at 1.00; Tolls
	   had three and claimed two lumps. Four is the fewest that can be out of focus, which is the
	   same reason §2 wants four transactions before it will name a period. */
	minMovements: 4,

	/* THE FEWEST CYCLES THAT CAN SHOW A REPEAT. One cycle makes its own count the commonest and
	   scores 100% steady by construction: Date had three movements in a single month and claimed
	   three lumps at full confidence, which is one month of history wearing the clothes of a
	   pattern. Two cycles agreeing is a coincidence; three is the fewest that can disagree. */
	minCyclesObserved: 3
};

export default SHAPE_CONFIG;
