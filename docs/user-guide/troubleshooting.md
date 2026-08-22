# Troubleshooting

Symptom-first fixes. The Guide inside the app carries the same list.

## The model ignores one of my rules

- Reduce the rule count. Five to eight beats twenty.
- Remove duplicates and rules that restate each other.
- Put required rules in priority order.
- Convert prose into an explicit output constraint.
- Test against the weakest model in your chain, not the strongest.

## JSON comes back invalid

- State the exact shape in Output style, with a short example.
- Ask for the object alone, with no prose around it.
- Validate in your client and retry once. FreeChain does not validate response shape.
- On smaller models, prefer a flat object over a deeply nested schema.

## One provider returns 400 while others might work

- Check whether a Harness generation default is unsupported by that provider.
- Top K in particular is honoured by some providers and rejected by others.
- Clear the setting and retry to confirm which field caused it.
- Check Logs for the attempt list and the error classification.

## Tool calls never execute

- Confirm your application implements the tool loop. FreeChain does not.
- Confirm the client validates arguments before acting.
- Confirm the client asks for approval where it should.
- Do not add permission language to Tool policy as a substitute. It grants nothing.

## My Harness edits are not affecting live traffic

- Check the line above Make active on the Harness page.
- Editing a Harness is not the same as activating it.
- The dropdown marks the live one with "active".

---

_Generated from `src/webui/guide-content.js`._
