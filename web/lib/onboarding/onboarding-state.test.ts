import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
const root=mkdtempSync(path.join(os.tmpdir(),"onb-")); process.env.MENTIKO_GLOBAL_ROOT=root;
import { readOnboardingState, writeOnboardingState, deriveNextAction, nextOperation } from "./onboarding-state";
describe("onboarding backend state",()=>{ const ns=`test-${Date.now()}-${Math.random().toString(36).slice(2)}`,org="o"; afterAll(()=>rmSync(root,{recursive:true,force:true})); it("is scoped and CAS protected",()=>{let s=readOnboardingState(ns,org); expect(deriveNextAction(s)).toBe("provider"); s.provider.status="ready"; s=writeOnboardingState(ns,org,s,s.revision); expect(()=>writeOnboardingState(ns,org,s,0)).toThrow("STATE_CONFLICT"); }); it("deduplicates operations and remains in progress",()=>{const a=nextOperation(ns,org,"provider","k","activation"); const b=nextOperation(ns,org,"provider","k","activation"); expect(a.op.operationId).toBe(b.op.operationId); expect(a.op.status).toBe("in_progress"); expect(b.reused).toBe(true);});});
