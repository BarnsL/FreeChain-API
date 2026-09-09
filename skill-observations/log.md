# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue — resolved statuses always carry their resolution date

---

## 2026-08-15

### Observation 1: Separate configuration from reachability

**Status:** OPEN
**Date:** 2026-08-15
**Session context:** Provider failover health audit
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Acceptance reporting

**Issue:** A status command was labelled as ready even though it only checked whether credentials existed. A manual upstream probe exposed retired model identifiers and an unavailable local service that configuration state could not detect.

**Suggested improvement:** Require user-facing status wording to state whether it is configuration-only or a live probe, and use one bounded live request before claiming availability.

**Principle:** Credential presence and service reachability are separate facts and must be reported separately.

### Observation 2: Preserve outer failover for diagnostic error wrappers

**Status:** OPEN
**Date:** 2026-08-15
**Session context:** Nested local-router integration recovery
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Error classification

**Issue:** A nested router used an HTTP client-error status to report its own exhausted upstream pool. The outer failover layer interpreted the status as a malformed caller request and stopped before reaching healthy alternatives.

**Suggested improvement:** Classify errors from nested systems using both the provider identity and a stable diagnostic envelope, and retain a regression test proving ordinary caller errors remain fatal.

**Principle:** HTTP status alone may not identify fault ownership when one router wraps another system's failures.

### Observation 3: Verify model access through the configured route

**Status:** OPEN
**Date:** 2026-08-15
**Session context:** Free-only provider-priority correction
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Provider model selection

**Issue:** A model announcement and a cross-provider catalog suggested a free route, but the configured account's direct endpoint rejected the exact model while a known free control model succeeded.

**Suggested improvement:** For each new provider-model link, record both its public cost classification and a bounded authenticated probe through the exact runtime route before making it a primary fallback.

**Principle:** Model availability is specific to the provider route and account, not merely the model name or client application.

### Observation 4: Separate client credential retention from local service persistence

**Status:** OPEN
**Date:** 2026-08-15
**Session context:** Local AI router integration diagnosis
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Integration lifecycle

**Issue:** A local API endpoint was healthy on a fixed port, but its process had no restart owner and the client intentionally stored its access key only for the current browser session. The resulting failures looked alike despite belonging to different layers.

**Suggested improvement:** For local integrations, report listener health, process supervision, and client credential retention as separate checks, then prescribe a fixed-port supervised service plus the client’s supported secure credential path.

**Principle:** A stable local URL does not guarantee a persistent process or a persistent client authorization state.

### Observation 5: Redact repository-security scan output by construction

**Status:** OPEN
**Date:** 2026-08-16
**Session context:** Repository privacy and API-boundary audit
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Security verification

**Issue:** A conventional text search can echo the very credential it is meant to detect, and a local-only API route can still expose configuration metadata when its access boundary is inconsistent.

**Suggested improvement:** Security verification should report only revision, file, line, and detector type, scan reachable history as well as the working tree, and exercise every claimed authenticated route without a credential.

**Principle:** A secret scan and an access-control check are trustworthy only when their evidence cannot itself disclose a secret.

- 2026-08-16 checkpoint: no new generalizable skill observations; existing observations already cover route verification, nested failover, and model access.

## 2026-08-17

### Observation 6: Prove credential drift without exposing either credential

**Status:** OPEN
**Date:** 2026-08-17
**Session context:** Cross-component RCA for a local API authentication failure
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Root cause evidence

**Issue:** A persisted request dump contained only a deliberately masked credential, while the client and server stored full credentials in separate ignored files. Printing either value would have violated the security boundary, but a simple mismatch claim would not prove which saved credential the failed request actually used.

**Suggested improvement:** In credential-drift RCAs, reproduce the producer's documented masking function locally, compare masked values in memory, report equality booleans only, and pair that evidence with one failed request using the stale client credential plus one successful request using the server's current credential.

**Principle:** Authentication drift can be proven conclusively through masked equivalence and control requests without revealing credential material.

### Observation 7: Gate irreversible workflow steps on verification success

**Status:** OPEN
**Date:** 2026-08-17
**Session context:** Committing reviewed design specifications in a dirty multi-repository workspace
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Commit gate

**Issue:** A whitespace check and commit were placed in one shell invocation with unconditional command separation. The check reported a defect, but the later commit still ran because its execution was not conditional on the verification exit code.

**Suggested improvement:** Verification recipes that precede a commit, publish, deploy, or other state change must use separate tool calls or explicit success-conditional execution. Never place the state-changing command after an unconditional separator.

**Principle:** A verification step is a gate only when failure structurally prevents the state-changing step from running.

- 2026-08-17 secure-journal checkpoint: no new generalizable skill observation; the test-first boundary, dirty-worktree preservation, and credential-redaction practices are already covered above.

### Observation 8: Enforce telemetry privacy with an allowlist at persistence

**Status:** OPEN
**Date:** 2026-08-17
**Session context:** Privacy-safe request journal implementation
**Skill:** test-driven-development
**Type:** open-source
**Phase/Area:** Observability security

**Issue:** Route-level redaction alone can regress when a later caller passes a whole request, response, attempt, or error object into a logger. Raw provider details and credentials can then enter persistence even though the original integration was careful.

**Suggested improvement:** Give the persistence boundary a fixed allowlist schema and regression sentinels. Route code may supply richer objects for convenience, but serialization must rebuild records from approved scalar metadata and drop unknown fields by construction.

**Principle:** Sensitive telemetry is safest when persistence can only express approved metadata, not when every caller must remember what to redact.

### Observation 9: Review operational dashboards in motion and at narrow widths

**Status:** OPEN
**Date:** 2026-08-17
**Session context:** Secure request journal dashboard review
**Skill:** impeccable
**Type:** open-source
**Phase/Area:** Operational UI verification

**Issue:** Static structure and style checks passed while automatic refresh still collapsed expanded records, storage controls were not discoverable, summary naming hid visible metadata from assistive technology, and secondary navigation displaced the primary workflow on narrow screens.

**Suggested improvement:** Pair structural UI checks with one stateful browser review that expands a row across refresh, verifies pause behavior, reads the accessible tree, and captures both desktop and narrow viewports.

**Principle:** An operational dashboard is only verified when its live state, accessible names, and constrained layout remain usable together.

### Observation 10: Preserve multi-word CLI arguments on Windows

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Provider integration discovery with GitNexus
**Skill:** gitnexus-cli
**Type:** open-source
**Phase/Area:** Windows command invocation

**Issue:** Passing a quoted multi-word value as a separate `--query` argument through a project runner that launches with a shell can lose the grouping and reach the CLI as several positional arguments. The documented quoted form then fails with a misleading too-many-arguments error.

**Suggested improvement:** Document the Windows-safe equals form, such as `--query="provider routing"`, alongside the normal quoted form, and verify argument preservation in runner tests.

**Principle:** A shell-backed cross-platform runner must test that spaces in option values survive every process boundary.

### Observation 11: Define an observer anchor for pre-project work

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Research and design for a new tool spanning several existing repositories
**Skill:** task-observer
**Type:** open-source
**Phase/Area:** Session start protocol

**Issue:** A substantive session began before its new project directory existed and touched several related repositories only for read-only discovery. The observer required an immediate workspace log but did not define whether to use the multi-project parent, a related dirty repository, or defer until the project anchor was chosen.

**Suggested improvement:** Add an anchoring decision tree for pre-project and multi-repository work. Prefer an explicitly configured stable log, otherwise defer the first write until the target project is selected, and never create observer state in an unrelated dirty repository solely to satisfy session startup.

**Principle:** Observability metadata needs an explicit ownership boundary before it writes into a shared or multi-project workspace.

### Observation 12: Verify streamed protocol outcomes beyond HTTP status

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Provider failover incident investigation
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Live provider verification

**Issue:** A provider returned HTTP 200 and began an event stream, but its first meaningful event was an explicit upstream error. Header-only probes classified the route as successful even though the client received no usable completion and retried the same route.

**Suggested improvement:** For streamed provider verification, consume a bounded first meaningful event and require either valid content, a tool-call delta, or a clean terminal event. Treat an error event, an empty early close, or a malformed first event as a failed route even when the HTTP status is 200.

**Principle:** A successful transport handshake is not proof of a successful streamed application result.

### Observation 13: Account-family expansion can defeat visible route ordering

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Provider credential demotion without credential deletion
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Provider routing

**Issue:** Moving a provider row to the bottom did not demote one bad credential because a bare provider-family link expanded every numbered account slot at each earlier occurrence. The visible chain order and the effective candidate order were different.

**Suggested improvement:** When one credential must be retained but demoted, inspect candidate expansion before editing the chain. Pin healthy and unhealthy account slots explicitly, then test the effective provider-model tuples at the first and final positions.

**Principle:** Route ordering is only reliable when tests assert the expanded candidate order, not just the visible link list.

### Observation 14: Treat package and lockfile metadata as one release contract

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** FreeChain v0.6.0 release preparation
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Release metadata

**Issue:** The package manifest had advanced while the lockfile root still reported an older version and omitted a newly exposed command. A source-only version check would have published internally inconsistent release metadata.

**Suggested improvement:** Before tagging, validate the version and root command map in both the package manifest and lockfile. Regenerate the lockfile with lifecycle scripts disabled, then rerun tests and artifact inspection.

**Principle:** Release metadata is a multi-file contract, not a single version field.

### Observation 15: Populate every data-heavy workspace before geometry sign-off

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** FreeChain v0.6.1 installed-release UI verification
**Skill:** impeccable
**Type:** open-source
**Phase/Area:** Responsive dashboard verification

**Issue:** Overview passed hostile-string checks at desktop and mobile widths, but the populated Logs workspace still placed fixed-grid controls outside 100 record cards at 1280 px. A shared-shell pass did not exercise the page with the densest real data.

**Suggested improvement:** Populate each data-heavy workspace with maximum-length metadata before release sign-off, activate that workspace, and run the canonical card geometry check there. Include record controls and secondary labels, not only page-level overflow.

**Principle:** Responsive verification is page-state coverage, not merely viewport coverage.

<!-- 2026-08-23 checkpoint after the third incident-plan completion: no new skill observations; the relevant streamed-protocol principle is already captured in Observation 12. -->

### Observation 16: Verify repository visibility before push

**Status:** OPEN
**Date:** 2026-08-23
**Session context:** Completed bug-fix handoff to a Git remote
**Skill:** finishing-a-development-branch
**Type:** open-source
**Phase/Area:** Remote delivery preflight

**Issue:** The push workflow assumed the configured origin was an acceptable destination. A live repository check showed that the requested private destination was actually public, so executing the documented push step would have crossed the intended publication boundary.

**Suggested improvement:** Before staging or pushing, verify the exact remote URL, authenticated repository visibility, current branch, upstream, and ahead/behind state. Stop before any external write when the destination conflicts with the user's publication policy.

**Principle:** Verify destination properties live before every external delivery; a familiar remote name does not prove an acceptable publication boundary.

### Observation 17: Gate progressive tool disclosure on provider count limits

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Cross-system RCA for an agent request rejected by multiple model providers
**Skill:** New skill candidate: provider-schema-budgeting
**Type:** open-source
**Phase/Area:** Model request assembly

**Issue:** Progressive tool disclosure activated only when schemas crossed a context-token percentage. A very large-context model therefore received more tool definitions than a provider's hard array limit even though schema tokens were below the configured percentage.

**Suggested improvement:** Treat model-facing schema budgets as the intersection of token pressure, provider item-count ceilings, and always-visible core tools. Activate existing progressive disclosure when any hard boundary would be crossed, and verify both visible count and deferred-call reachability.

**Principle:** Context capacity cannot override a transport's hard item-count contract; request assembly must satisfy every downstream limit before dispatch.

### Observation 18: Verify every downstream gate and the final outbound contract

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Reviewed cross-system repair for Discord reply admission and model tool-array budgeting
**Skill:** requesting-code-review
**Type:** open-source
**Phase/Area:** Boundary verification

**Issue:** Focused tests proved the first Discord admission helper and the pre-assembly tool-count trigger, but independent review found that later guild and recovery gates could still reject the admitted reply. It also found that retained direct tools plus bridge schemas needed their own final-count guarantee after progressive disclosure.

**Suggested improvement:** For a policy or request-shaping repair, enumerate every sequential rejection gate and every transformation between source and sink. Test the full production path, include anti-loop negative cases, and assert the final model-visible payload against hard provider limits rather than only the input that activates the transformation.

**Principle:** A boundary fix is complete only when valid input survives every downstream gate and the final outbound payload satisfies the external contract.

### Observation 19: Tie user-visible proof to the final deployed process

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Final verification after a reviewed Nous Man gateway replacement
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Deployment evidence

**Issue:** A real Discord reply and official read-back proved the repaired path on an earlier replacement process, but a later reviewer correction required another managed restart. Reusing the older reply as proof for the final process would blur source correctness, deployment correctness, and user-visible runtime correctness.

**Suggested improvement:** Record the final process start time before the last smoke test. Require every claimed post-deploy request, journal entry, and delivery read-back to carry a later timestamp, or state explicitly which boundary was not re-exercised.

**Principle:** Runtime proof belongs to a specific deployed artifact and process epoch; evidence from an earlier epoch is supporting history, not final deployment proof.

### Observation 20: Never use contextual grep on secret-bearing configuration

**Status:** OPEN
**Date:** 2026-09-02
**Session context:** Read-only provider-capability RCA using a local YAML configuration
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Evidence collection and sanitization

**Issue:** A contextual search targeted safe model and reasoning fields, but surrounding lines contained plaintext provider credentials. The search result therefore copied secrets into diagnostic tool output even though no secret field was requested.

**Suggested improvement:** Treat credential-bearing configuration as structured sensitive data. Parse and emit an explicit allowlist of safe fields, or search without context and redact before output. Ban context flags around matches in files that may colocate secrets.

**Principle:** Sanitization must apply to neighboring context as well as the requested match; safe search terms do not make adjacent configuration safe to print.

### Observation 21: Distinguish launcher metadata from request identity

**Status:** OPEN
**Date:** 2026-09-08
**Session context:** Repairing a provider rejection attributed to a missing client session
**Skill:** systematic-debugging
**Type:** open-source
**Phase/Area:** Root-cause tracing across desktop and HTTP boundaries

**Issue:** A desktop shortcut was suspected to contain identifiers needed by an upstream provider, but inspection showed only executable metadata while an exact failed request and the provider implementation showed that the required identity is generated dynamically per request.

**Suggested improvement:** When a failure names a missing session or request identifier, inspect both the launcher and the final outbound HTTP contract. Classify each discovered value as install-time, process-time, conversation-time, or request-time before deciding where it should be sourced or persisted.

**Principle:** Identity must be recovered at the lifecycle boundary that creates it; static launcher metadata cannot substitute for dynamic request context.

<!-- 2026-09-08 OpenCode identity checkpoint after the second completed task batch: no new generalizable skill observation; request lifecycle identity is already captured in Observation 21. -->

<!-- 2026-09-08 release-gate checkpoint: no new generalizable skill observation; remote visibility, deployed-process proof, and request identity are already captured in Observations 16, 19, and 21. -->
