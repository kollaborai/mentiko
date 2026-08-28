import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
const root=mkdtempSync(path.join(os.tmpdir(),"onb-")); process.env.MENTIKO_GLOBAL_ROOT=root;
import { readOnboardingState, writeOnboardingState, deriveNextAction, nextOperation } from "./onboarding-state";
describe("onboarding backend state",()=>{ const ns="n",org="o"; afterAll(()=>rmSync(root,{recursive:true,force:true})); it("is scoped and CAS protected",()=>{let s=readOnboardingState(ns,org); expect(deriveNextAction(s)).toBe("provider"); s.provider.status="ready"; s=writeOnboardingState(ns,org,s,s.revision); expect(()=>writeOnboardingState(ns,org,s,0)).toThrow("STATE_CONFLICT"); }); it("deduplicates operations",()=>{const a=nextOperation(ns,org,"provider","k","activation"); const b=nextOperation(ns,org,"provider","k","activation"); expect(a.op.operationId).toBe(b.op.operationId);});});
