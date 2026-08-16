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
