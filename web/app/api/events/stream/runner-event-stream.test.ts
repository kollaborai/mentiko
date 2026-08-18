import {
  runnerEventBelongsToStream,
  runnerStateBelongsToStream,
  jobBelongsToStream,
  type RunnerEventStreamFile,
} from "./runner-event-stream";

// These predicates scope the SSE watchers to a single stream. The dirs they read
// (stateDir / eventsDir / jobsDir) are the SHARED execution root across every org,
// so a false "belongs" here is a cross-tenant leak. The negative cases are the point.

const RUN = "run-alpha";
const OTHER = "run-beta";

describe("runnerEventBelongsToStream", () => {
  const ev = (runId: string): RunnerEventStreamFile => ({
    filename: "x.event", event: "e", source: "s", runId, timestamp: "", processed: false, data: "",
  });
  it("accepts same run, rejects another org's run", () => {
    expect(runnerEventBelongsToStream(ev(RUN), RUN)).toBe(true);
    expect(runnerEventBelongsToStream(ev(OTHER), RUN)).toBe(false);
  });
});

describe("runnerStateBelongsToStream", () => {
  it("accepts a session key carrying this run, rejects one that doesn't", () => {
    expect(runnerStateBelongsToStream({ session: `agent_${RUN}` }, RUN)).toBe(true);
    expect(runnerStateBelongsToStream({ session: `agent_${OTHER}` }, RUN)).toBe(false);
  });
});

describe("jobBelongsToStream", () => {
  it("job-id mode: accepts the subscribed job id", () => {
    expect(jobBelongsToStream("job-1", {}, "job-1")).toBe(true);
    expect(jobBelongsToStream("job-2", {}, "job-1")).toBe(false);
  });
  it("run-id mode: accepts a job owned by the subscribed run", () => {
    expect(jobBelongsToStream("job-1", { runId: RUN }, RUN)).toBe(true);
    expect(jobBelongsToStream("job-1", { runId: OTHER }, RUN)).toBe(false);
  });
  it("rejects a run-less job that is neither the subscribed id nor run", () => {
    expect(jobBelongsToStream("job-9", {}, RUN)).toBe(false);
  });
});
