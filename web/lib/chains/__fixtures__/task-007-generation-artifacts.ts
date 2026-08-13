/**
 * TASK-007 generated-chain artifacts, captured VERBATIM from the run artifacts
 * that parked the task for ~24h on 2026-08-09 (stall-killer spec v2, C1 gate).
 *
 * Both were rejected by the acceptance boundary for a purely FORMAL defect
 * that the repair pass removes without changing what the chain means. They are
 * the acceptance bar for repair-before-reject: both must import clean through
 * /api/jobs/[id]/complete -> auto-run -> chain save.
 *
 * Source: ~/.mentiko/namespaces/default/runs/<run>/artifacts/generation-result.json
 * Do not hand-edit — these are evidence, not test data.
 */

/**
 * run-1786317021952-7df8099d
 *
 * Two-part `version: "1.0"` — the semver rejection (recorded TWICE under the
 * same input_hash). Everything else about the chain is valid.
 */
export const TASK_007_SEMVER_ARTIFACT = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "name": "react-hook-usage-auditor",
  "version": "1.0",
  "description": "Reusable research chain for React hook usage pattern auditing and risk assessment",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "research",
      "acceptance_criteria": "All hook consumers in the target workspace are documented with usage context, execution patterns, and risk assessment relative to proposed modifications. The audit report exists in the artifacts directory and contains file paths, component names, usage patterns, and risk assessments for each analyzed hook consumer."
    }
  },
  "config": {
    "session_prefix": "rha",
    "max_rounds": 1,
    "on_complete": "stop",
    "project_root": "auto",
    "monitor": true,
    "monitor_interval": 60
  },
  "agents": [
    {
      "id": "context-validator",
      "name": "Runtime Context Validator",
      "role": "context-validator",
      "triggers": [
        "manual-start"
      ],
      "emits": "context-validated",
      "deliverable": "Validated runtime task context with required parameters extracted",
      "verification": "TASK_CONTEXT contains all required fields: target_hook_name, search_scope, modification_description, risk_criteria, workspace_path, and output_path",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "prompt": "You are the runtime context validator for React hook usage pattern auditing.\n\n## Your Task\nRead and validate the TASK_CONTEXT provided at runtime. Extract these required parameters:\n- target_hook_name: The React hook to audit (e.g., 'useRetry', 'useEffect')\n- search_scope: Directory pattern to search within (e.g., 'src/components/**/*.tsx')\n- modification_description: Proposed hook modification to assess risks against\n- risk_criteria: Specific risk patterns or conditions to evaluate\n- workspace_path: Root directory of the target workspace\n- output_path: Where artifacts should be written\n\nValidate that all required parameters are present and non-empty. Report any missing or invalid parameters.\n\nWhen validation is complete, emit 'context-validated' with a summary of the extracted parameters.\n\nDo not proceed with any analysis. Your role is validation only."
    },
    {
      "id": "hook-discovery",
      "name": "Hook Discovery Agent",
      "role": "codebase-searcher",
      "triggers": [
        "context-validated"
      ],
      "emits": "hook-usage-discovered",
      "deliverable": "Complete list of all target hook imports and usage locations in the workspace",
      "verification": "Search results include file paths, line numbers, and usage contexts for each discovered hook consumer",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the hook discovery specialist for React hook usage pattern auditing.\n\n## Your Task\nSearch the workspace for all imports and usages of the target hook specified in TASK_CONTEXT.target_hook_name within the scope defined by TASK_CONTEXT.search_scope.\n\n## Discovery Methodology\n1. Use rg/grep to find all imports of the target hook\n2. Search for all usages of the hook in component files\n3. Capture the complete file path and line number for each usage\n4. Identify the component/context where each usage occurs\n5. Note any interesting patterns (conditional usage, nested calls, etc.)\n\n## Output Format\nCreate a structured discovery report with:\n- Total count of hook consumers found\n- For each consumer: file path, line numbers, component name, usage context snippet\n- Any notable patterns observed across usages\n\nWhen discovery is complete, emit 'hook-usage-discovered' with your findings.\n\nYour work is read-only. Do not modify any files.",
      "timeout": 300
    },
    {
      "id": "pattern-analyzer",
      "name": "Usage Pattern Analyzer",
      "role": "pattern-analysis-specialist",
      "triggers": [
        "hook-usage-discovered"
      ],
      "emits": "patterns-analyzed",
      "deliverable": "Detailed analysis of execution behavior assumptions and usage patterns for each hook consumer",
      "verification": "Analysis report contains specific execution patterns, dependency chains, and behavioral assumptions for each discovered usage",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the usage pattern analysis specialist for React hook auditing.\n\n## Your Task\nAnalyze the usage patterns and execution behavior assumptions for each hook consumer discovered by the previous agent.\n\n## Analysis Framework\nFor each hook consumer, examine:\n1. **Execution Context**: How the hook is invoked (event handlers, effects, render-time, etc.)\n2. **Dependency Chains**: What dependencies the hook call depends on\n3. **State Assumptions**: What state or prop conditions the usage assumes\n4. **Lifecycle Timing**: When during component lifecycle the hook executes\n5. **Error Handling**: How errors and retry scenarios are managed\n6. **Concurrency Assumptions**: Any assumptions about exclusive or concurrent execution\n\n## Analysis Process\n1. Read each discovered file containing hook usage\n2. Examine the surrounding component context\n3. Trace the data flow and execution paths\n4. Identify any implicit assumptions about hook behavior\n5. Note patterns that could be affected by the proposed modification\n\n## Output Format\nCreate a structured pattern analysis with:\n- For each consumer: detailed execution pattern description\n- Cross-cutting patterns observed across multiple consumers\n- Specific behavioral assumptions identified\n- Potential interaction points with the proposed modification\n\nWhen analysis is complete, emit 'patterns-analyzed' with your findings.\n\nYour work is analysis only. Do not modify any files.",
      "timeout": 420
    },
    {
      "id": "risk-assessor",
      "name": "Modification Risk Assessor",
      "role": "risk-analysis-specialist",
      "triggers": [
        "patterns-analyzed"
      ],
      "emits": "risks-assessed",
      "deliverable": "Risk assessment for each hook consumer relative to the proposed modification",
      "verification": "Risk report contains specific risk levels, impact descriptions, and mitigation recommendations for each analyzed consumer",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "prompt": "You are the modification risk assessment specialist for React hook usage auditing.\n\n## Your Task\nAssess the risk level and impact potential for each hook consumer based on the proposed modification described in TASK_CONTEXT.modification_description and the risk criteria in TASK_CONTEXT.risk_criteria.\n\n## Risk Assessment Framework\nFor each hook consumer, evaluate:\n1. **Direct Impact**: How directly the modification affects this usage\n2. **Breaking Potential**: Likelihood of behavior change or breakage\n3. **Cascade Effects**: Potential impact on dependent components or flows\n4. **Migration Effort**: Complexity of adapting this usage to the modification\n5. **Testing Needs**: What test coverage would be required to validate safety\n\n## Risk Classification\nUse these risk levels:\n- **CRITICAL**: Will break, requires immediate attention\n- **HIGH**: Likely affected, needs careful review and testing\n- **MEDIUM**: Possibly affected, should be validated\n- **LOW**: Minimal impact, likely safe\n- **NONE**: No impact expected\n\n## Analysis Process\n1. Compare each usage pattern against the modification description\n2. Apply the risk criteria from TASK_CONTEXT\n3. Consider both direct and indirect effects\n4. Identify specific breaking points or concerns\n5. Recommend mitigation strategies where applicable\n\n## Output Format\nCreate a structured risk assessment with:\n- For each consumer: risk level, impact description, specific concerns\n- Summary of overall risk distribution\n- Priority recommendations for addressing higher-risk consumers\n- Specific testing or validation recommendations\n\nWhen assessment is complete, emit 'risks-assessed' with your findings.\n\nYour work is analysis and recommendation only. Do not modify any files.",
      "timeout": 360
    },
    {
      "id": "report-generator",
      "name": "Audit Report Generator",
      "role": "documentation-specialist",
      "triggers": [
        "risks-assessed"
      ],
      "emits": "report-generated",
      "deliverable": "Comprehensive audit report document with all findings and recommendations",
      "verification": "Report document exists at TASK_CONTEXT.output_path and contains all required sections: discovery results, pattern analysis, risk assessment, and recommendations",
      "authorities": {
        "can": [
          "read_files",
          "write_artifacts"
        ]
      },
      "prompt": "You are the audit report generator for React hook usage pattern auditing.\n\n## Your Task\nGenerate a comprehensive audit report that synthesizes all findings from the previous agents into a single, well-structured document.\n\n## Report Structure\nCreate a markdown report with these sections:\n\n### Executive Summary\n- Hook being audited\n- Scope of analysis\n- Key findings overview\n- Overall risk assessment\n\n### Discovery Results\n- Total consumers found\n- Complete list with file paths and line numbers\n- Distribution across components/modules\n\n### Usage Pattern Analysis\n- Execution patterns observed\n- Behavioral assumptions identified\n- Notable patterns and anti-patterns\n- Cross-cutting concerns\n\n### Risk Assessment\n- Risk distribution summary\n- Detailed risk analysis for each consumer\n- Specific concerns and breaking points\n- Priority-ranked issues\n\n### Recommendations\n- High-priority actions\n- Testing recommendations\n- Migration strategies\n- Monitoring suggestions\n\n### Appendix\n- Full discovery data\n- Detailed pattern analysis\n- Risk criteria applied\n\n## Report Requirements\n- Use clear, professional language\n- Include specific file paths and line numbers\n- Provide actionable recommendations\n- Format as well-structured markdown\n- Write to TASK_CONTEXT.output_path\n\nWhen the report is complete and verified, emit 'report-generated'.\n\nYour work creates documentation only. Do not modify any source files.",
      "timeout": 240
    },
    {
      "id": "final-verifier",
      "name": "Final Acceptance Verifier",
      "role": "independent-verifier",
      "triggers": [
        "report-generated"
      ],
      "emits": "audit-complete",
      "deliverable": "Independent verification that audit meets acceptance criteria",
      "verification": "Verification confirms the report exists, contains all required sections, and documents every discovered hook consumer with usage context and risk assessment",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "The audit report exists at the specified output path, contains discovery results, pattern analysis, and risk assessment for all hook consumers, and provides documented findings and recommendations for the proposed modification.",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "prompt": "You are the final independent verifier for React hook usage pattern auditing.\n\n## Your Task\nIndependently verify that the audit report meets all acceptance criteria:\n\n1. **Report Existence**: Confirm the report exists at TASK_CONTEXT.output_path\n2. **Completeness**: Verify the report contains all required sections\n3. **Coverage**: Confirm every discovered hook consumer is documented\n4. **Analysis Depth**: Verify usage context and risk assessment for each consumer\n5. **Actionability**: Confirm findings and recommendations are present\n\n## Verification Process\n1. Read the generated audit report\n2. Cross-reference with discovery findings from earlier agents\n3. Verify each consumer has documented usage context and risk assessment\n4. Confirm the report addresses the proposed modification\n5. Validate that all acceptance criteria are satisfied\n\n## Evidence Required\n- Report file exists and is readable\n- All required sections are present and complete\n- Each discovered consumer has dedicated analysis\n- Risk assessments are specific and actionable\n- Recommendations are provided for high-risk cases\n\n## Success Criteria\nEmit 'audit-complete' only when:\n- Report exists at the correct path\n- Contains discovery, analysis, and risk sections\n- Documents every consumer with context and risk\n- Provides actionable findings and recommendations\n\nIf any criterion is not met, do not emit success. Describe what is missing or inadequate.\n\nYour work is verification only. Do not modify any files.",
      "timeout": 180
    }
  ],
  "branches": {
    "context-validated": "hook-discovery",
    "hook-usage-discovered": "pattern-analyzer",
    "patterns-analyzed": "risk-assessor",
    "risks-assessed": "report-generator",
    "report-generated": "final-verifier"
  }
} as unknown as Record<string, unknown>;

/**
 * run-1786317074936-afa68f8b
 *
 * Valid semver, but `branches["context-validation-failed"]` is keyed on an
 * event no agent emits or consumes — the dangling-branch rejection.
 */
export const TASK_007_DANGLING_BRANCH_ARTIFACT = {
  "name": "react-hook-usage-auditor",
  "version": "1.0.0",
  "description": "Reusable research chain for React hook usage pattern auditing and risk assessment",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "research",
      "acceptance_criteria": "All target hook consumers in the specified codebase scope are documented with usage context and risk assessment for the proposed modification"
    }
  },
  "config": {
    "session_prefix": "rha",
    "max_rounds": 3,
    "on_complete": "stop",
    "project_root": "auto",
    "monitor": true,
    "monitor_interval": 60
  },
  "agents": [
    {
      "id": "context-validator",
      "name": "Runtime Context Validator",
      "role": "context-validator",
      "triggers": [
        "manual-start"
      ],
      "emits": "context-validated",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "deliverable": "Validated runtime task context with extracted hook name, search scope, modification description, and risk criteria",
      "verification": "TASK_CONTEXT contains non-empty target_hook_name, search_scope, modification_description, risk_criteria, and workspace_path values",
      "prompt": "You are the runtime context validation specialist for React hook usage pattern auditing.\n\n## Your Task\nRead and validate the typed runtime task context provided in TASK_CONTEXT. Extract the following fields:\n- target_hook_name: The React hook to audit (e.g., 'useRetry', 'useEffect')\n- search_scope: Directory or file pattern to search within the workspace\n- modification_description: Proposed hook changes to assess risk against\n- risk_criteria: Specific risk factors to evaluate (e.g., 'concurrent execution', 'memory leaks', 'race conditions')\n- workspace_path: Absolute path to the target React codebase\n- output_path: Where to write the final audit report\n\n## Validation Steps\n1. Confirm TASK_CONTEXT exists and is readable\n2. Extract all required fields from TASK_CONTEXT\n3. Validate that target_hook_name is a non-empty string matching React hook naming convention (use*, useContext*, etc.)\n4. Validate that search_scope is a valid directory path or glob pattern\n5. Validate that workspace_path exists and is accessible\n6. Confirm risk_criteria contains specific, actionable risk factors\n7. Emit 'context-validated' only when all validations pass\n\n## Error Handling\nIf any field is missing, empty, or invalid, emit 'context-validation-failed' with specific error details.\n\n## Deliverable\nA validated runtime context object ready for hook usage searching.",
      "timeout": 120
    },
    {
      "id": "hook-consumer-discovery",
      "name": "Hook Consumer Discovery Agent",
      "role": "codebase-searcher",
      "triggers": [
        "context-validated"
      ],
      "emits": "hook-consumers-found",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "deliverable": "A comprehensive list of all files and components that import or use the target hook within the search scope",
      "verification": "List includes file paths, component names, line numbers, and import/usage context for every hook consumer found in search scope",
      "prompt": "You are the hook consumer discovery specialist for React codebases.\n\n## Your Task\nSearch the codebase for all consumers of the target hook specified in runtime context.\n\n## Discovery Process\n1. Read target_hook_name and search_scope from validated TASK_CONTEXT\n2. Use rg (ripgrep) to search for hook imports: `rg 'import.*{target_hook_name}' {search_scope}`\n3. Use rg to search for hook usage patterns: `rg 'target_hook_name\\s*\\(' {search_scope}`\n4. For each match, extract:\n   - File path (relative to workspace root)\n   - Component name (if inside a component function)\n   - Line number of import/usage\n   - Import statement (if found)\n   - Usage context (function call with arguments)\n5. Read each matching file to capture full usage context (surrounding 10-15 lines)\n6. Compile results into a structured list with: file_path, component_name, import_line, usage_lines, usage_context\n\n## Search Strategy\n- Search for both named imports: `import { target_hook_name } from 'react'` and namespace imports: `import * as React from 'react'`\n- Check for aliased imports: `import { target_hook_name as alias }`\n- Look for hook usage in functional components, custom hooks, and utility functions\n- Handle hook calls with and without leading React. prefix\n\n## Output Format\nProduce a JSON-serializable discovery result with structure:\n{\n  \"hook_name\": \"target_hook_name\",\n  \"search_scope\": \"searched_path\",\n  \"total_consumers\": N,\n  \"consumers\": [\n    {\n      \"file_path\": \"src/components/Example.tsx\",\n      \"component_name\": \"ExampleComponent\",\n      \"import_line\": 5,\n      \"usage_lines\": [12, 15],\n      \"import_statement\": \"import { useRetry } from '@/hooks/retry'\",\n      \"usage_context\": \"const { retry, isLoading } = useRetry(fn, options)\"\n    }\n  ]\n}\n\nEmit 'hook-consumers-found' with this discovery result.",
      "timeout": 300
    },
    {
      "id": "pattern-analysis",
      "$ref": "pattern-analyzer",
      "triggers": [
        "hook-consumers-found"
      ],
      "emits": "patterns-analyzed",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "deliverable": "Detailed analysis of usage patterns, execution behavior assumptions, and anti-patterns for each hook consumer",
      "verification": "Analysis includes pattern categorization, dependency tracking, execution flow assumptions, and identified anti-patterns for each consumer",
      "prompt": "You are the pattern analysis specialist for React hook usage auditing.\n\n## Your Task\nAnalyze usage patterns and execution behavior assumptions for each hook consumer discovered in the previous stage.\n\n## Analysis Process\nFor each consumer in the discovery result:\n1. **Pattern Classification**: Categorize the usage pattern:\n   - Basic/single usage: Simple hook call with minimal configuration\n   - Conditional usage: Hook called inside conditionals or loops (anti-pattern)\n   - Nested usage: Hook used within other hooks or complex callbacks\n   - Custom hook wrapper: Hook wrapped in another custom hook\n   - Concurrent usage: Multiple hook instances in same component\n\n2. **Execution Behavior Analysis**: Identify assumptions about:\n   - When the hook runs (mount, update, dependency changes)\n   - Cleanup behavior (useEffect returns, unsubscribe logic)\n   - State updates and batching assumptions\n   - Async operation handling (promises, timeouts, intervals)\n   - Error handling expectations\n\n3. **Dependency Tracking**: Document:\n   - React state dependencies (useState, useContext sources)\n   - External dependencies (API clients, services, event emitters)\n   - Prop/context dependencies that trigger re-renders\n\n4. **Anti-pattern Detection**: Look for:\n   - Hooks called conditionally or in loops\n   - Missing dependency arrays in useEffect/useCallback/useMemo\n   - Stale closures referencing old state\n   - Memory leak patterns (unsubscriptions missing)\n   - Race condition prone patterns (overlapping async operations)\n\n## Output Structure\nFor each consumer, produce:\n{\n  \"file_path\": \"src/components/Example.tsx\",\n  \"component_name\": \"ExampleComponent\",\n  \"pattern_type\": \"basic-single-usage\",\n  \"execution_assumptions\": [\"Runs on mount\", \"Cleans up on unmount\"],\n  \"dependencies\": [\"apiClient\", \"userContext\"],\n  \"anti_patterns\": [],\n  \"risk_factors\": [\"no error handling\", \"assumes single execution\"]\n}\n\nEmit 'patterns-analyzed' with this pattern analysis result.",
      "timeout": 360
    },
    {
      "id": "risk-assessment",
      "name": "Risk Assessment Agent",
      "role": "risk-analyst",
      "triggers": [
        "patterns-analyzed"
      ],
      "emits": "risks-assessed",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "deliverable": "Risk assessment for each hook consumer relative to the proposed modification criteria",
      "verification": "Each consumer has documented risk level, specific risk factors, and mitigation recommendations",
      "prompt": "You are the risk assessment specialist for React hook modifications.\n\n## Your Task\nAssess risks for each hook consumer based on the proposed modification described in runtime context.\n\n## Risk Assessment Process\n1. Read modification_description and risk_criteria from TASK_CONTEXT\n2. For each consumer from pattern analysis, evaluate:\n   **Severity Classification**:\n   - CRITICAL: Breaks core functionality, data loss, security vulnerability\n   - HIGH: Major functionality break, significant UX degradation\n   - MEDIUM: Partial functionality loss, edge case failures\n   - LOW: Cosmetic issues, minor edge cases\n   - NONE: No impact expected\n\n   **Specific Risk Factors** (map to risk_criteria):\n   - Concurrent execution: Multiple hook instances overlapping\n   - Memory leaks: Unreleased resources, missing cleanup\n   - Race conditions: Timing-dependent state inconsistencies\n   - Breaking changes: API signature changes affecting consumers\n   - Performance degradation: Slower execution, redundant operations\n   - State synchronization: Stale state, closure issues\n   - Error handling: Unhandled promise rejections, async errors\n\n3. **Impact Analysis** for each consumer:\n   - How the modification affects current behavior\n   - Which execution assumptions become invalid\n   - Required code changes in consumer components\n   - Testing requirements to validate safety\n\n4. **Mitigation Recommendations**:\n   - Specific code changes needed per consumer\n   - Migration path if gradual rollout required\n   - Testing strategy (unit, integration, e2e)\n   - Monitoring/alerting recommendations\n\n## Output Structure\nFor each consumer:\n{\n  \"file_path\": \"src/components/Example.tsx\",\n  \"component_name\": \"ExampleComponent\",\n  \"risk_level\": \"HIGH\",\n  \"risk_factors\": [\"concurrent execution\", \"race conditions\"],\n  \"impact_description\": \"Adding concurrent guard requires wrapping hook call in useRef to track execution state\",\n  \"required_changes\": [\"Add execution tracking\", \"Handle concurrent calls gracefully\"],\n  \"testing_needs\": [\"unit test for concurrent calls\", \"integration test for race scenarios\"],\n  \"mitigation_priority\": \"must-fix-before-deployment\"\n}\n\nEmit 'risks-assessed' with complete risk assessment.",
      "timeout": 360
    },
    {
      "id": "audit-report-generator",
      "name": "Audit Report Generator",
      "role": "report-writer",
      "triggers": [
        "risks-assessed"
      ],
      "emits": "audit-report-complete",
      "authorities": {
        "can": [
          "write_artifacts",
          "read_files"
        ]
      },
      "deliverable": "Comprehensive audit report document with findings and recommendations",
      "verification": "Report exists at output_path and contains: executive summary, all consumers with context, pattern analysis, risk assessment, and actionable recommendations",
      "prompt": "You are the audit report generator for React hook usage pattern auditing.\n\n## Your Task\nGenerate a comprehensive audit report combining all analysis stages.\n\n## Report Structure\n1. **Executive Summary**:\n   - Hook name being audited\n   - Search scope and methodology\n   - Total consumers found\n   - Overall risk distribution (CRITICAL/HIGH/MEDIUM/LOW counts)\n   - Top recommendations prioritized\n\n2. **Consumer Catalog**: For each consumer:\n   - File path and component name\n   - Usage context (import and code snippet)\n   - Pattern classification\n   - Current behavior assumptions\n\n3. **Pattern Analysis Summary**:\n   - Common patterns across consumers\n   - Anti-patterns detected\n   - Execution behavior assumptions catalog\n\n4. **Risk Assessment Matrix**:\n   - Risk level distribution with counts\n   - Risk factor heatmap (which risks affect which consumers)\n   - Consumer-by-consumer risk details\n   - Required changes per consumer\n\n5. **Recommendations**:\n   - Prioritized mitigation roadmap\n   - Migration strategy if breaking changes\n   - Testing requirements\n   - Monitoring recommendations\n\n6. **Appendices**:\n   - Detailed findings data\n   - Code snippets referenced\n   - Testing checklist\n\n## Report Format\n- Use Markdown format for readability\n- Include tables for risk matrix and consumer catalog\n- Use code blocks for all snippets\n- Add TOC for navigation\n- Include severity badges (🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🟢 LOW)\n\n## Output Location\nWrite the report to the output_path specified in TASK_CONTEXT.\n\nEmit 'audit-report-complete' with confirmation of report location and summary statistics.",
      "timeout": 240
    },
    {
      "id": "final-acceptance-verifier",
      "name": "Final Acceptance Verifier",
      "role": "independent-verifier",
      "triggers": [
        "audit-report-complete"
      ],
      "emits": "acceptance-verified",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "deliverable": "Independent verification that acceptance criteria are proven by evidence",
      "verification": "Report exists and contains all required sections; each consumer has documented context and risk assessment",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "All target hook consumers in the specified codebase scope are documented in the audit report with usage context and risk assessment for the proposed modification",
      "prompt": "You are the final independent acceptance verifier for React hook usage pattern auditing.\n\n## Your Task\nIndependently verify that all acceptance criteria are proven by the generated evidence.\n\n## Verification Process\n1. **Read the audit report** from the output_path in TASK_CONTEXT\n2. **Verify completeness**:\n   - Report file exists and is readable\n   - Executive summary present with total consumer count\n   - Consumer catalog section exists\n   - Pattern analysis section exists\n   - Risk assessment section exists\n   - Recommendations section exists\n\n3. **Verify acceptance criteria compliance**:\n   For EVERY target hook consumer discovered:\n   - Usage context is documented (file path, component name, code snippet)\n   - Risk assessment is present (risk level, specific factors)\n   - Impact of modification is explained\n   - Mitigation recommendations are provided\n\n4. **Cross-reference discovery results**:\n   - Compare consumer count in report vs. discovery stage\n   - Verify no consumers are missing from the report\n   - Confirm all listed consumers have complete documentation\n\n5. **Evidence verification**:\n   - Risk assessments reference specific code patterns\n   - Recommendations are tied to identified risks\n   - Testing requirements map to risk factors\n   - Report contains actionable, non-generic guidance\n\n## Success Conditions\nEmit 'acceptance-verified' ONLY when:\n- Report exists at the specified output_path\n- Every discovered hook consumer has documented usage context\n- Every consumer has a complete risk assessment\n- Risk criteria from TASK_CONTEXT are addressed\n- Recommendations are specific and actionable\n\n## Failure Conditions\nIf verification fails, emit 'acceptance-failed' with specific gaps:\n- Missing consumers (list which ones are absent)\n- Incomplete documentation (which consumers lack context or risk assessment)\n- Missing report sections\n- Generic or non-actionable recommendations\n\nYou are the final gate. Do not emit success unless evidence proves the acceptance criteria.",
      "timeout": 180
    }
  ],
  "branches": {
    "context-validation-failed": "context-validator"
  }
} as unknown as Record<string, unknown>;

