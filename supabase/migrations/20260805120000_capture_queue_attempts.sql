-- Retry accounting for the Desk's drain-queue worker.
--
-- Without this, a permanently-bad URL (404, unsupported site, private host) is
-- retried on every cycle forever: the queue never empties and every run reports
-- a failure. The worker only increments this on a 4xx — a 5xx or a connection
-- error means the Desk was asleep, which must not burn an attempt or a closed
-- laptop would quietly discard the queue.
--
-- Still no select policy: the phone page writes and can never read back, and
-- the worker reads with the service-role key, which bypasses RLS by design.

alter table public.capture_queue
  add column if not exists attempts integer not null default 0;
