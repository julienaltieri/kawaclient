# Fixtures

`portfolio.json` is a capture of the real portfolio: master stream, transactions, accounts, stored
balances and the as-of date. It is **gitignored** — it is a ledger, and it does not belong in a
repository.

To make one: open the bench, press **Save fixture**, and drop the file here as `portfolio.json`.

Every test that reads it must skip when it is absent. Use `describeWithPortfolio` from
`../portfolioFixture` — a suite that goes red on a machine without the file is a suite nobody else can
run.
