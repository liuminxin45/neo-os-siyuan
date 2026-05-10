# Siyuan Addon Constitution

## Core Principles

### I. Personal AI Workspace First

This plugin is currently built for the owner's personal use. Design decisions may assume a trusted private workspace, fast iteration, and owner-controlled configuration. The codebase should still keep a clean structure so the plugin can later be prepared for public release.

### II. Default Online AI Operation

AI features may call configured LLM services by default once the plugin has usable provider settings. The product is allowed to prioritize convenience and continuity over repeated confirmation prompts. Network-dependent features must still fail gracefully when providers are unavailable.

### III. Private Plugin Data May Store Secrets

API keys, MCP environment variables, provider settings, and related credentials may be stored in this plugin's private Siyuan plugin data. The UI should mask secrets where practical, and plugin-authored logs must avoid intentionally printing secrets. Before any public release, secret storage and disclosure behavior must be reviewed again.

### IV. Always-Allow MCP Tool Use

Configured and enabled MCP servers are trusted by default. The AI may automatically call MCP tools without per-call confirmation. Implementation must clearly separate configuration, connection, discovery, and execution logic so future permission policies can be added if the project becomes public-facing.

### V. TypeScript And Vite Are Allowed

The project may introduce TypeScript, Vite, tests, and runtime dependencies when they improve maintainability or feature delivery. Build tooling is acceptable even though the initial plugin was a minimal CommonJS skeleton. Generated build artifacts must remain predictable for Siyuan plugin loading.

### VI. Complete Spec-Kit Workflow Is Mandatory

Every new feature must follow the full spec-kit workflow before implementation:

1. `spec.md`
2. `plan.md`
3. `research.md` when decisions need evidence
4. `data-model.md` when data is involved
5. `contracts/` when structured inputs, outputs, or configuration are involved
6. `tasks.md`
7. implementation
8. `quickstart.md` verification

Bug fixes may be smaller only when they do not introduce new behavior, new settings, data-model changes, AI behavior, or MCP behavior.

### VII. Context-Aware UI/UX Selection

UI/UX design must be selected according to the feature context instead of copying a single fixed style. The reference pool is `awesome-design-md` and its product design patterns. For this project, the default product classification is an embedded personal productivity AI workspace inside Siyuan.

The default UI direction is:

- **Base**: Native Siyuan plugin surfaces, spacing, typography rhythm, settings patterns, dock behavior, and i18n conventions.
- **Workspace feel**: Notion-like calm information hierarchy for notes, settings, and structured context.
- **Chat feel**: Intercom-like message clarity, input ergonomics, error recovery, and conversation state readability.
- **Command/tool feel**: Raycast/Cursor-like compact controls, fast keyboard flows, tool status visibility, and low-friction AI actions.
- **Motion**: Subtle micro-interactions only when they clarify state, such as loading, sending, validation, success, error, and tool-call progress.

Every feature plan that changes UI must include a short "UI/UX Selection" note explaining which reference style was chosen and why. If a feature is primarily configuration-heavy, prefer dense but calm productivity UI. If a feature is primarily conversational, prioritize readable chat flow and low-friction input. If a feature is primarily tool execution, prioritize status transparency, auditability, and quick interruption.

## Technical Constraints

- Target runtime is Siyuan's plugin system.
- Desktop Siyuan is the primary target while the project is personal-use first.
- TypeScript and Vite may be introduced as the main development toolchain.
- LLM providers, chat state, MCP servers, and secrets may be persisted with Siyuan plugin data APIs.
- MCP automatic execution is allowed for enabled servers.
- UI must avoid marketing-page patterns inside the plugin. The first screen of a feature should be the usable workspace, not a landing page.
- Icons should use a consistent SVG icon system when practical; emojis must not be used as primary controls.
- Interactive controls must have clear hover, focus, disabled, loading, success, and error states.
- Text and controls must remain usable at narrow dock widths and must not overlap or resize unpredictably during streaming or MCP tool execution.
- Motion must respect reduced-motion preferences when implemented.
- Public release preparation must include a security and privacy review that may amend this constitution.

## Development Workflow

Development must proceed through explicit stage gates. The assistant must not skip stages or automatically rewrite downstream artifacts after an upstream decision changes.

1. **Constitution Gate**: Confirm the global project constitution is current and available from the main branch baseline.
2. **Specify Gate**: Create or update the feature specification under `specs/` and describe user-visible behavior only.
3. **Clarify Gate**: Ask and resolve requirement questions before planning whenever ambiguity affects UX, data, AI behavior, secrets, MCP tool execution, or release scope.
4. **Checklist Gate**: Review the feature specification for completeness, contradictions, testability, and constitution alignment.
5. **Plan Gate**: Write the implementation plan, including architecture, dependency choices, UI/UX selection, and Constitution Check.
6. **Design Gate**: Create research notes, data model, contracts, and quickstart only when the current feature needs them.
7. **Tasks Gate**: Generate task lists grouped by independently testable user stories.
8. **Analyze Gate**: Check specs, plans, contracts, and tasks for inconsistency, missing coverage, and scope drift before implementation.
9. **Implement Gate**: Implement in task order and user-story priority after the owner approves moving into implementation.
10. **Validate Gate**: Verify through tests, build checks, and the feature quickstart before marking work done.

At each gate, the assistant must stop and summarize what changed, what remains uncertain, and what explicit approval is needed to continue.

## Branch Governance

The constitution is a global project artifact, not a feature-local decision.

- The authoritative constitution must live on the main branch baseline.
- Feature branches must be created from a main branch that already contains the accepted constitution.
- Constitution changes should be made on the main branch or a dedicated governance branch, then merged into main before new feature branches are created.
- Feature branches must not casually change the constitution as part of feature implementation.
- If a feature reveals that the constitution is wrong or incomplete, implementation pauses and a constitution amendment is handled as a separate governance step.
- Existing feature branches must merge or rebase the latest accepted constitution before continuing work that depends on it.
- Specs, plans, tasks, and implementation are subordinate to the constitution currently accepted on main.

## Assistant Conduct

The assistant is responsible for guiding the owner through the process without taking hidden shortcuts.

- The assistant must not infer unstated product policy, release policy, MCP permission policy, data-retention policy, or UI direction when those decisions are still being defined.
- The assistant must not automatically propagate an upstream change into `spec.md`, `plan.md`, `tasks.md`, contracts, or implementation without first explaining the impact and getting approval for that stage.
- The assistant must keep each step narrow: complete the current gate, summarize, then wait for approval before advancing.
- The assistant must call out when a requested action would skip a required spec-kit gate.
- The assistant must preserve traceability from constitution principles to specs, plans, tasks, and validation.
- The assistant may recommend next steps, but the owner decides when to proceed.

## Governance

This constitution is the highest-priority project rule for feature development. Specs, plans, and tasks must conform to it. Any exception must be documented in the feature `plan.md` under Complexity Tracking with the reason, risk, and simpler alternative considered.

Because the project is currently personal-use first, several AI and MCP defaults are intentionally permissive. Before publishing the plugin for other users, this constitution must be reviewed and amended for public distribution, especially around default networking, secret storage, and MCP auto-execution.

**Version**: 1.2.0 | **Ratified**: 2026-05-10 | **Last Amended**: 2026-05-10
