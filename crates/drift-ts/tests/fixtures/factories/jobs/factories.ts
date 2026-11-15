import { defineJob, withTrace } from "./define";

// Returns a job wrapped in `defineJob`: a factory of jobs.
export function makeCronJob(schedule: string) {
  const label = schedule.trim();
  return defineJob(async (payload: { at: string }) => {
    console.log(label, payload.at);
  });
}

// A concise arrow body, wrapped twice: outermost first.
export const makeTracedJob = (name: string) =>
  withTrace(defineJob(async () => {
    console.log(name);
  }));

// A parameter is no function the lowering can see: not recorded (as for values).
export function makeFromHandler(handler: (p: unknown) => Promise<void>) {
  return defineJob(handler);
}

// Calls the wrapper, but returns something else: not a factory.
export function registerLater(queue: string[]) {
  const job = defineJob(async () => {});
  queue.push(String(job));
  return queue.length;
}

// Returns the wrapper applied to no function: not a wrapped function.
export function notAJob() {
  return withTrace("plain");
}

// The wrapped function is returned from a nested function, not by this one.
export function nested() {
  function inner() {
    return defineJob(async () => {});
  }
  return inner;
}

// A value wrapped in the wrapper is wrapped, not a factory.
export const hourly = defineJob(async () => {});
